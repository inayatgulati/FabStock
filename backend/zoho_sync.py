"""Zoho Books sync engine. Pulls contacts, items and invoices into the app.
Keeps the app's own stock ledger and subtracts Zoho sales going forward.
"""
import os
import httpx
import asyncio
from datetime import datetime, timezone
from bson import ObjectId

_cache = {"token": None, "expires_at": 0, "api_domain": None}
_sync_lock = asyncio.Lock()


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
    delay = 2
    for attempt in range(5):
        await asyncio.sleep(0.7)  # throttle to stay under ~100 req/min
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(f"{api_domain}/books/v3{path}", params=params,
                                 headers={"Authorization": f"Zoho-oauthtoken {token}"})
        if r.status_code == 429:
            if r.headers.get("x-rate-limit-remaining") == "0":
                reset = r.headers.get("x-rate-limit-reset", "?")
                raise RuntimeError(f"Zoho daily API limit (1000/day) reached. Resets in ~{reset}s.")
            retry_after = int(r.headers.get("Retry-After", delay))
            await asyncio.sleep(min(retry_after, 30))
            delay = min(delay * 2, 30)
            continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError("Zoho rate limit: retries exhausted")


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


DETAIL_WINDOW_DAYS = 180
MAX_DETAIL_PER_SYNC = 120


def _header_doc(head, cust):
    total = float(head.get("total", 0) or 0)
    sub = float(head.get("sub_total", total) or total)
    return {
        "invoice_number": head.get("invoice_number", head["invoice_id"]),
        "customer_id": str(cust["_id"]) if cust else None,
        "customer_name": head.get("customer_name", "Zoho Customer"),
        "date": head.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "items": [],
        "subtotal": sub,
        "tax": round(total - sub, 2) if total >= sub else 0.0,
        "total": total,
        "notes": None,
        "source": "zoho",
        "off_books": False,
        "zoho_invoice_id": head["invoice_id"],
        "detailed": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


async def _fetch_detail_items(db, inv_id, deduct):
    full = (await zoho_get(f"/invoices/{inv_id}")).get("invoice", {})
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
        if deduct and prod:
            await db.products.update_one({"_id": prod["_id"]}, {"$inc": {"stock_qty": -qty}})
    return items


async def sync_invoices(db, baseline: bool):
    heads = await _paginate("/invoices", "invoices")
    today = datetime.now(timezone.utc).date()
    new_count = 0
    detail_budget = MAX_DETAIL_PER_SYNC
    for head in heads:
        inv_id = head["invoice_id"]
        existing = await db.invoices.find_one({"zoho_invoice_id": inv_id})
        try:
            inv_date = datetime.fromisoformat((head.get("date") or "")[:10]).date()
        except Exception:
            inv_date = today
        recent = (today - inv_date).days <= DETAIL_WINDOW_DAYS

        if not existing:
            cust = await db.customers.find_one({"zoho_contact_id": head.get("customer_id")})
            doc = _header_doc(head, cust)
            if not baseline:
                # genuinely new sale -> full detail + deduct stock
                doc["items"] = await _fetch_detail_items(db, inv_id, deduct=True)
                doc["detailed"] = True
            elif recent and detail_budget > 0:
                # baseline: fetch detail for recent invoices only (no deduction)
                doc["items"] = await _fetch_detail_items(db, inv_id, deduct=False)
                doc["detailed"] = True
                detail_budget -= 1
            try:
                await db.invoices.insert_one(doc)
                new_count += 1
            except Exception:
                pass  # unique index race -> already inserted
        elif not existing.get("items") and recent and detail_budget > 0:
            # backfill detail for recent header-only invoices
            items = await _fetch_detail_items(db, inv_id, deduct=False)
            await db.invoices.update_one({"_id": existing["_id"]},
                                         {"$set": {"items": items, "detailed": True}})
            detail_budget -= 1
    return len(heads), new_count


async def sync_incremental(db, deduct: bool):
    """Lightweight: fetch newest invoices (sorted desc), stop once we hit
    invoices already in the DB. ~1-3 API calls per run."""
    new_count = 0
    page = 1
    while page <= 20:
        data = await zoho_get("/invoices", {"page": page, "per_page": 200,
                                            "sort_column": "date", "sort_order": "D"})
        heads = data.get("invoices", [])
        if not heads:
            break
        hit_known = False
        for head in heads:
            if await db.invoices.find_one({"zoho_invoice_id": head["invoice_id"]}):
                hit_known = True
                continue
            cust = await db.customers.find_one({"zoho_contact_id": head.get("customer_id")})
            if not cust and head.get("customer_id"):
                await db.customers.update_one(
                    {"zoho_contact_id": head["customer_id"]},
                    {"$set": {"name": head.get("customer_name", "Zoho Customer"), "source": "zoho"},
                     "$setOnInsert": {"created_at": datetime.now(timezone.utc).isoformat()}},
                    upsert=True)
                cust = await db.customers.find_one({"zoho_contact_id": head["customer_id"]})
            doc = _header_doc(head, cust)
            doc["items"] = await _fetch_detail_items(db, head["invoice_id"], deduct=deduct)
            doc["detailed"] = True
            try:
                await db.invoices.insert_one(doc)
                new_count += 1
            except Exception:
                pass
        if hit_known:
            break  # older invoices already imported
        page += 1
    return new_count


async def run_incremental(db):
    if not is_configured():
        return {"ok": False, "error": "not_configured"}
    if _sync_lock.locked():
        return {"ok": False, "error": "already_running"}
    async with _sync_lock:
        state = await db.zoho_sync_state.find_one({"_id": "state"}) or {}
        deduct = state.get("baseline_done", False)
        new = await sync_incremental(db, deduct=deduct)
        await db.zoho_sync_state.update_one(
            {"_id": "state"},
            {"$set": {"baseline_done": True, "last_sync": datetime.now(timezone.utc).isoformat(),
                      "last_result": {"invoices_new": new, "mode": "incremental"}}},
            upsert=True)
        return {"ok": True, "invoices_new": new, "mode": "incremental"}


async def run_full_sync(db):
    if not is_configured():
        return {"ok": False, "error": "not_configured"}
    if _sync_lock.locked():
        return {"ok": False, "error": "already_running"}
    async with _sync_lock:
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
