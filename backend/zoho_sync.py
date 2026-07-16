"""Zoho Books sync engine. Pulls contacts, items and invoices into the app.
Keeps the app's own stock ledger and subtracts Zoho sales going forward.
"""
import os
import httpx
from datetime import datetime, timezone
from bson import ObjectId

_cache = {"token": None, "expires_at": 0, "api_domain": None}


def is_configured() -> bool:
    return bool(os.environ.get("ZOHO_CLIENT_ID") and os.environ.get("ZOHO_CLIENT_SECRET")
               and os.environ.get("ZOHO_REFRESH_TOKEN") and os.environ.get("ZOHO_ORG_ID"))


async def get_access_token():
    now = datetime.now(timezone.utc).timestamp()
    if _cache["token"] and _cache["expires_at"] > now + 60:
        return _cache["token"], _cache["api_domain"]
    accounts_url = os.environ.get("ZOHO_ACCOUNTS_URL", "https://accounts.zohocloud.ca").rstrip("/")
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{accounts_url}/oauth/v2/token", params={
            "grant_type": "refresh_token",
            "client_id": os.environ["ZOHO_CLIENT_ID"],
            "client_secret": os.environ["ZOHO_CLIENT_SECRET"],
            "refresh_token": os.environ["ZOHO_REFRESH_TOKEN"],
        })
        r.raise_for_status()
        data = r.json()
        if "access_token" not in data:
            raise RuntimeError(f"Zoho token error: {data}")
        _cache["token"] = data["access_token"]
        _cache["api_domain"] = data.get("api_domain", "https://www.zohoapis.ca")
        _cache["expires_at"] = now + int(data.get("expires_in", 3600))
        return _cache["token"], _cache["api_domain"]


async def zoho_get(path: str, params: dict | None = None):
    token, api_domain = await get_access_token()
    params = {**(params or {}), "organization_id": os.environ["ZOHO_ORG_ID"]}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{api_domain}/books/v3{path}", params=params,
                             headers={"Authorization": f"Zoho-oauthtoken {token}"})
        r.raise_for_status()
        return r.json()


async def _paginate(path: str, key: str, max_pages: int = 20):
    out, page = [], 1
    while page <= max_pages:
        data = await zoho_get(path, {"page": page, "per_page": 200})
        out.extend(data.get(key, []))
        ctx = data.get("page_context", {})
        if not ctx.get("has_more_page"):
            break
        page += 1
    return out


async def sync_customers(db):
    contacts = await _paginate("/contacts", "contacts")
    for c in contacts:
        doc = {
            "name": c.get("contact_name") or c.get("company_name") or "Unnamed",
            "company": c.get("company_name"),
            "email": c.get("email"),
            "phone": c.get("phone") or c.get("mobile"),
            "address": (c.get("billing_address") or {}).get("address") if isinstance(c.get("billing_address"), dict) else None,
            "zoho_contact_id": c["contact_id"],
            "source": "zoho",
        }
        await db.customers.update_one(
            {"zoho_contact_id": c["contact_id"]},
            {"$set": doc, "$setOnInsert": {"created_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True)
    return len(contacts)


async def sync_items(db, baseline: bool):
    items = await _paginate("/items", "items")
    for it in items:
        existing = await db.products.find_one({"zoho_item_id": it["item_id"]})
        if not existing:
            # try match by SKU
            sku = it.get("sku") or ""
            match = await db.products.find_one({"sku": sku}) if sku else None
            base = {
                "name": it.get("name", "Unnamed"),
                "sku": sku or it["item_id"],
                "category": "Zoho Import",
                "unit": it.get("unit") or "each",
                "price": float(it.get("rate", 0) or 0),
                "cost": float(it.get("purchase_rate", 0) or 0),
                "low_stock_threshold": float(it.get("reorder_level", 10) or 10),
                "zoho_item_id": it["item_id"],
                "image_url": None,
            }
            if match:
                await db.products.update_one({"_id": match["_id"]}, {"$set": {"zoho_item_id": it["item_id"]}})
            else:
                # new product: seed starting stock from Zoho on baseline import
                base["stock_qty"] = float(it.get("available_stock", it.get("stock_on_hand", 0)) or 0)
                base["created_at"] = datetime.now(timezone.utc).isoformat()
                await db.products.insert_one(base)
        else:
            await db.products.update_one({"_id": existing["_id"]},
                                         {"$set": {"price": float(it.get("rate", existing["price"]) or existing["price"])}})
    return len(items)


async def _app_product_for_line(db, line):
    prod = None
    if line.get("item_id"):
        prod = await db.products.find_one({"zoho_item_id": line["item_id"]})
    if not prod and line.get("sku"):
        prod = await db.products.find_one({"sku": line["sku"]})
    return prod


async def sync_invoices(db, baseline: bool):
    invoices = await _paginate("/invoices", "invoices")
    new_count = 0
    for head in invoices:
        inv_id = head["invoice_id"]
        if await db.invoices.find_one({"zoho_invoice_id": inv_id}):
            continue  # already imported (idempotent)
        # fetch full invoice for line items
        full = (await zoho_get(f"/invoices/{inv_id}")).get("invoice", head)
        customer = await db.customers.find_one({"zoho_contact_id": full.get("customer_id")})
        cust_id = str(customer["_id"]) if customer else None
        items = []
        for line in full.get("line_items", []):
            prod = await _app_product_for_line(db, line)
            qty = float(line.get("quantity", 0) or 0)
            rate = float(line.get("rate", 0) or 0)
            items.append({
                "product_id": str(prod["_id"]) if prod else (line.get("item_id") or "unknown"),
                "name": line.get("name") or (prod["name"] if prod else "Item"),
                "sku": line.get("sku") or (prod["sku"] if prod else ""),
                "qty": qty, "unit_price": rate,
                "line_total": float(line.get("item_total", rate * qty) or 0),
            })
            # subtract stock only for invoices arriving after baseline
            if not baseline and prod:
                await db.products.update_one({"_id": prod["_id"]}, {"$inc": {"stock_qty": -qty}})
        doc = {
            "invoice_number": full.get("invoice_number", inv_id),
            "customer_id": cust_id,
            "customer_name": full.get("customer_name", "Zoho Customer"),
            "date": full.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "items": items,
            "subtotal": float(full.get("sub_total", 0) or 0),
            "tax": float(full.get("tax_total", 0) or 0),
            "total": float(full.get("total", 0) or 0),
            "notes": full.get("notes"),
            "source": "zoho",
            "off_books": False,
            "zoho_invoice_id": inv_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.invoices.insert_one(doc)
        new_count += 1
    return len(invoices), new_count


async def run_full_sync(db):
    if not is_configured():
        return {"ok": False, "error": "not_configured"}
    state = await db.zoho_sync_state.find_one({"_id": "state"}) or {}
    baseline = not state.get("baseline_done", False)
    customers_n = await sync_customers(db)
    items_n = await sync_items(db, baseline)
    invoices_total, invoices_new = await sync_invoices(db, baseline)
    await db.zoho_sync_state.update_one(
        {"_id": "state"},
        {"$set": {"baseline_done": True, "last_sync": datetime.now(timezone.utc).isoformat(),
                  "last_result": {"customers": customers_n, "items": items_n,
                                  "invoices_total": invoices_total, "invoices_new": invoices_new,
                                  "was_baseline": baseline}}},
        upsert=True)
    return {"ok": True, "baseline": baseline, "customers": customers_n, "items": items_n,
            "invoices_total": invoices_total, "invoices_new": invoices_new}
