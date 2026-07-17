from dotenv import load_dotenv
from pathlib import Path
import os

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, BeforeValidator, ConfigDict, EmailStr
from typing import List, Optional, Annotated
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from bson import ObjectId
import logging
import asyncio
import bcrypt
import jwt
import secrets
import zoho_sync

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_ALGORITHM = "HS256"
TAX_RATE = 0.13  # Canadian HST default

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PyObjectId = Annotated[str, BeforeValidator(str)]


# ---------------- Auth helpers ----------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email,
               "exp": datetime.now(timezone.utc) + timedelta(minutes=60), "type": "access"}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id,
               "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "refresh"}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def set_auth_cookies(response: Response, access: str, refresh: str):
    response.set_cookie("access_token", access, httponly=True, secure=False,
                        samesite="lax", max_age=3600, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=False,
                        samesite="lax", max_age=604800, path="/")


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user["id"] = str(user["_id"])
        user.pop("_id", None)
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ---------------- Models ----------------
class RegisterInput(BaseModel):
    email: EmailStr
    password: str
    name: str


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class ProductInput(BaseModel):
    name: str
    sku: str
    category: str
    unit: str = "each"
    price: float = 0.0
    cost: float = 0.0
    stock_qty: float = 0.0
    low_stock_threshold: float = 10.0
    image_url: Optional[str] = None


class AdjustmentInput(BaseModel):
    product_id: str
    change: float
    reason: str
    note: Optional[str] = None


class CustomerInput(BaseModel):
    name: str
    company: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None


class InvoiceItemInput(BaseModel):
    product_id: str
    qty: float


class InvoiceInput(BaseModel):
    customer_id: str
    items: List[InvoiceItemInput]
    date: Optional[str] = None
    notes: Optional[str] = None


def serialize(doc: dict) -> dict:
    doc = dict(doc)
    doc["id"] = str(doc.pop("_id"))
    return doc


# ---------------- Auth routes ----------------
@api_router.post("/auth/register")
async def register(data: RegisterInput, response: Response):
    email = data.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    doc = {"email": email, "password_hash": hash_password(data.password),
           "name": data.name, "role": "staff", "created_at": datetime.now(timezone.utc).isoformat()}
    res = await db.users.insert_one(doc)
    uid = str(res.inserted_id)
    set_auth_cookies(response, create_access_token(uid, email), create_refresh_token(uid))
    return {"id": uid, "email": email, "name": data.name, "role": "staff"}


@api_router.post("/auth/login")
async def login(data: LoginInput, request: Request, response: Response):
    email = data.email.lower()
    ident = f"{request.client.host}:{email}"
    attempt = await db.login_attempts.find_one({"identifier": ident})
    if attempt and attempt.get("count", 0) >= 5:
        locked_until = attempt.get("locked_until")
        if locked_until and datetime.fromisoformat(locked_until) > datetime.now(timezone.utc):
            raise HTTPException(status_code=429, detail="Too many attempts. Try again later.")
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(data.password, user["password_hash"]):
        await db.login_attempts.update_one(
            {"identifier": ident},
            {"$inc": {"count": 1},
             "$set": {"locked_until": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()}},
            upsert=True)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    await db.login_attempts.delete_one({"identifier": ident})
    uid = str(user["_id"])
    set_auth_cookies(response, create_access_token(uid, email), create_refresh_token(uid))
    return {"id": uid, "email": email, "name": user["name"], "role": user.get("role", "staff")}


@api_router.post("/auth/logout")
async def logout(response: Response, user: dict = Depends(get_current_user)):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"message": "Logged out"}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


# ---------------- Products / Inventory ----------------
@api_router.get("/products")
async def list_products(user: dict = Depends(get_current_user)):
    docs = await db.products.find().sort("name", 1).to_list(1000)
    return [serialize(d) for d in docs]


@api_router.post("/products")
async def create_product(data: ProductInput, user: dict = Depends(get_current_user)):
    doc = data.model_dump()
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    res = await db.products.insert_one(doc)
    return serialize(await db.products.find_one({"_id": res.inserted_id}))


@api_router.put("/products/{product_id}")
async def update_product(product_id: str, data: ProductInput, user: dict = Depends(get_current_user)):
    await db.products.update_one({"_id": ObjectId(product_id)}, {"$set": data.model_dump()})
    return serialize(await db.products.find_one({"_id": ObjectId(product_id)}))


@api_router.delete("/products/{product_id}")
async def delete_product(product_id: str, user: dict = Depends(get_current_user)):
    await db.products.delete_one({"_id": ObjectId(product_id)})
    return {"message": "deleted"}


@api_router.post("/inventory/adjust")
async def adjust_inventory(data: AdjustmentInput, user: dict = Depends(get_current_user)):
    product = await db.products.find_one({"_id": ObjectId(data.product_id)})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    new_qty = product["stock_qty"] + data.change
    await db.products.update_one({"_id": ObjectId(data.product_id)}, {"$set": {"stock_qty": new_qty}})
    adj = {"product_id": data.product_id, "product_name": product["name"], "change": data.change,
           "reason": data.reason, "note": data.note, "resulting_stock": new_qty,
           "created_at": datetime.now(timezone.utc).isoformat(), "user": user["name"]}
    await db.inventory_adjustments.insert_one(adj)
    return {"stock_qty": new_qty}


@api_router.get("/inventory/adjustments")
async def list_adjustments(user: dict = Depends(get_current_user)):
    docs = await db.inventory_adjustments.find().sort("created_at", -1).to_list(200)
    return [serialize(d) for d in docs]


# ---------------- Customers ----------------
@api_router.get("/customers")
async def list_customers(user: dict = Depends(get_current_user)):
    docs = await db.customers.find().sort("name", 1).to_list(5000)
    all_invoices = await db.invoices.find({}, {"customer_id": 1, "total": 1, "date": 1}).to_list(200000)
    invoice_map = defaultdict(list)
    for inv in all_invoices:
        invoice_map[inv.get("customer_id")].append(inv)
    out = []
    for c in docs:
        cid = str(c["_id"])
        invoices = invoice_map.get(cid, [])
        total = sum(i["total"] for i in invoices)
        last = max([i["date"] for i in invoices], default=None)
        item = serialize(c)
        item["total_spent"] = round(total, 2)
        item["order_count"] = len(invoices)
        item["last_order"] = last
        out.append(item)
    return out


@api_router.post("/customers")
async def create_customer(data: CustomerInput, user: dict = Depends(get_current_user)):
    doc = data.model_dump()
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    res = await db.customers.insert_one(doc)
    return serialize(await db.customers.find_one({"_id": res.inserted_id}))


@api_router.put("/customers/{customer_id}")
async def update_customer(customer_id: str, data: CustomerInput, user: dict = Depends(get_current_user)):
    await db.customers.update_one({"_id": ObjectId(customer_id)}, {"$set": data.model_dump()})
    return serialize(await db.customers.find_one({"_id": ObjectId(customer_id)}))


def compute_customer_analytics(customer, invoices):
    invoices = sorted(invoices, key=lambda i: i["date"])
    total_spent = sum(i["total"] for i in invoices)
    order_count = len(invoices)

    # Monthly sales last 12 months
    monthly = defaultdict(float)
    for inv in invoices:
        month = inv["date"][:7]
        monthly[month] += inv["total"]
    now = datetime.now(timezone.utc)
    months = []
    for k in range(11, -1, -1):
        d = (now.replace(day=1) - timedelta(days=1))
        y = now.year
        m = now.month - k
        while m <= 0:
            m += 12
            y -= 1
        key = f"{y:04d}-{m:02d}"
        months.append({"month": key, "sales": round(monthly.get(key, 0.0), 2)})

    # Product level stats
    prod_dates = defaultdict(list)
    prod_qty = defaultdict(float)
    prod_rev = defaultdict(float)
    prod_names = {}
    for inv in invoices:
        for it in inv["items"]:
            pid = it["product_id"]
            prod_names[pid] = it["name"]
            prod_qty[pid] += it["qty"]
            prod_rev[pid] += it["line_total"]
            prod_dates[pid].append(inv["date"])

    products = []
    for pid, qty in prod_qty.items():
        dates = sorted(prod_dates[pid])
        order_n = len(dates)
        avg_gap = None
        if order_n >= 2:
            gaps = []
            for a, b in zip(dates, dates[1:]):
                da = datetime.fromisoformat(a[:10])
                db_ = datetime.fromisoformat(b[:10])
                gaps.append((db_ - da).days)
            avg_gap = round(sum(gaps) / len(gaps), 1)
        last_ordered = dates[-1]
        # predicted next order date
        next_due = None
        if avg_gap:
            next_due = (datetime.fromisoformat(last_ordered[:10]) + timedelta(days=avg_gap)).strftime("%Y-%m-%d")
        products.append({
            "product_id": pid, "name": prod_names[pid], "total_qty": round(qty, 2),
            "revenue": round(prod_rev[pid], 2), "order_count": order_n,
            "avg_days_between_orders": avg_gap, "last_ordered": last_ordered[:10],
            "predicted_next_order": next_due,
        })
    products.sort(key=lambda p: p["revenue"], reverse=True)

    # Overall order frequency
    order_freq = None
    if order_count >= 2:
        dts = [datetime.fromisoformat(i["date"][:10]) for i in invoices]
        gaps = [(b - a).days for a, b in zip(dts, dts[1:])]
        order_freq = round(sum(gaps) / len(gaps), 1)

    avg_monthly = round(total_spent / 12, 2) if invoices else 0.0
    return {
        "total_spent": round(total_spent, 2),
        "order_count": order_count,
        "avg_monthly_sales": avg_monthly,
        "order_frequency_days": order_freq,
        "last_order": invoices[-1]["date"] if invoices else None,
        "monthly_sales": months,
        "products": products,
    }


@api_router.get("/customers/{customer_id}")
async def get_customer(customer_id: str, user: dict = Depends(get_current_user)):
    c = await db.customers.find_one({"_id": ObjectId(customer_id)})
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    invoices = await db.invoices.find({"customer_id": customer_id}).to_list(1000)
    analytics = compute_customer_analytics(c, invoices)
    return {"customer": serialize(c), "analytics": analytics,
            "invoices": sorted([serialize(i) for i in invoices], key=lambda x: x["date"], reverse=True)}


# ---------------- Invoices ----------------
@api_router.get("/invoices")
async def list_invoices(user: dict = Depends(get_current_user)):
    docs = await db.invoices.find().sort([("date", -1), ("created_at", -1)]).to_list(1000)
    return [serialize(d) for d in docs]


@api_router.post("/invoices")
async def create_invoice(data: InvoiceInput, user: dict = Depends(get_current_user)):
    customer = await db.customers.find_one({"_id": ObjectId(data.customer_id)})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    items = []
    subtotal = 0.0
    for it in data.items:
        product = await db.products.find_one({"_id": ObjectId(it.product_id)})
        if not product:
            raise HTTPException(status_code=404, detail=f"Product {it.product_id} not found")
        line_total = round(product["price"] * it.qty, 2)
        subtotal += line_total
        items.append({"product_id": it.product_id, "name": product["name"], "sku": product["sku"],
                      "qty": it.qty, "unit_price": product["price"], "line_total": line_total})
        # deduct inventory
        new_qty = product["stock_qty"] - it.qty
        await db.products.update_one({"_id": ObjectId(it.product_id)}, {"$set": {"stock_qty": new_qty}})
    tax = round(subtotal * TAX_RATE, 2)
    total = round(subtotal + tax, 2)
    count = await db.invoices.count_documents({})
    inv_number = f"INV-{1000 + count + 1}"
    doc = {"invoice_number": inv_number, "customer_id": data.customer_id,
           "customer_name": customer["name"], "date": data.date or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
           "items": items, "subtotal": round(subtotal, 2), "tax": tax, "tax_rate": TAX_RATE,
           "total": total, "notes": data.notes, "source": "manual", "off_books": False,
           "created_at": datetime.now(timezone.utc).isoformat()}
    res = await db.invoices.insert_one(doc)
    return serialize(await db.invoices.find_one({"_id": res.inserted_id}))


# ---------------- Cash Sales (off-books) ----------------
class CashSaleInput(BaseModel):
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    items: List[InvoiceItemInput]
    date: Optional[str] = None
    note: Optional[str] = None


@api_router.post("/cash-sales")
async def create_cash_sale(data: CashSaleInput, user: dict = Depends(get_current_user)):
    # Resolve or create a cash-sale customer
    cust_id = data.customer_id
    cust_name = data.customer_name
    if cust_id:
        c = await db.customers.find_one({"_id": ObjectId(cust_id)})
        if not c:
            raise HTTPException(status_code=404, detail="Customer not found")
        cust_name = c["name"]
    elif cust_name:
        existing = await db.customers.find_one({"name": cust_name, "is_cash": True})
        if existing:
            cust_id = str(existing["_id"])
        else:
            res = await db.customers.insert_one({"name": cust_name, "company": "Cash Buyer", "email": None,
                                                 "phone": None, "address": None, "is_cash": True, "source": "cash",
                                                 "created_at": datetime.now(timezone.utc).isoformat()})
            cust_id = str(res.inserted_id)
    else:
        raise HTTPException(status_code=400, detail="Provide a customer or a cash buyer name")

    items = []
    subtotal = 0.0
    for it in data.items:
        product = await db.products.find_one({"_id": ObjectId(it.product_id)})
        if not product:
            raise HTTPException(status_code=404, detail=f"Product {it.product_id} not found")
        line_total = round(product["price"] * it.qty, 2)
        subtotal += line_total
        items.append({"product_id": it.product_id, "name": product["name"], "sku": product["sku"],
                      "qty": it.qty, "unit_price": product["price"], "line_total": line_total})
        await db.products.update_one({"_id": ObjectId(it.product_id)}, {"$set": {"stock_qty": product["stock_qty"] - it.qty}})
    count = await db.invoices.count_documents({})
    doc = {"invoice_number": f"CASH-{1000 + count + 1}", "customer_id": cust_id, "customer_name": cust_name,
           "date": data.date or datetime.now(timezone.utc).strftime("%Y-%m-%d"), "items": items,
           "subtotal": round(subtotal, 2), "tax": 0.0, "tax_rate": 0.0, "total": round(subtotal, 2),
           "notes": data.note, "source": "cash", "off_books": True,
           "created_at": datetime.now(timezone.utc).isoformat()}
    res = await db.invoices.insert_one(doc)
    return serialize(await db.invoices.find_one({"_id": res.inserted_id}))


# ---------------- Zoho Integration ----------------
@api_router.get("/zoho/status")
async def zoho_status(user: dict = Depends(get_current_user)):
    state = await db.zoho_sync_state.find_one({"_id": "state"}) or {}
    return {"configured": zoho_sync.is_configured(), "org_id": os.environ.get("ZOHO_ORG_ID"),
            "region": os.environ.get("ZOHO_ACCOUNTS_URL"),
            "baseline_done": state.get("baseline_done", False),
            "last_sync": state.get("last_sync"), "last_result": state.get("last_result"),
            "zoho_invoice_count": await db.invoices.count_documents({"source": "zoho"})}


@api_router.post("/zoho/sync")
async def zoho_sync_now(user: dict = Depends(get_current_user)):
    if not zoho_sync.is_configured():
        raise HTTPException(status_code=400, detail="Zoho is not configured. Add your Client ID, Client Secret and Refresh Token.")
    try:
        result = await zoho_sync.run_incremental(db)
        return result
    except Exception as e:
        logger.error(f"Zoho sync failed: {e}")
        raise HTTPException(status_code=502, detail=f"Zoho sync failed: {str(e)}")


async def zoho_scheduler():
    while True:
        await asyncio.sleep(1800)  # every 30 min (stays well within Zoho's 1000 calls/day)
        try:
            if zoho_sync.is_configured():
                state = await db.zoho_sync_state.find_one({"_id": "state"}) or {}
                if state.get("baseline_done"):
                    res = await zoho_sync.run_incremental(db)
                    logger.info(f"Zoho auto-sync: {res}")
        except Exception as e:
            logger.error(f"Zoho auto-sync error: {e}")


# ---------------- Dashboard ----------------
@api_router.get("/dashboard/stats")
async def dashboard_stats(user: dict = Depends(get_current_user)):
    products = await db.products.find().to_list(1000)
    customers_count = await db.customers.count_documents({})
    invoices = await db.invoices.find().to_list(2000)

    low_stock = [serialize(p) for p in products if p["stock_qty"] <= p.get("low_stock_threshold", 10)]
    inventory_value = round(sum(p["stock_qty"] * p.get("cost", 0) for p in products), 2)

    now = datetime.now(timezone.utc)
    this_month = now.strftime("%Y-%m")
    month_revenue = round(sum(i["total"] for i in invoices if i["date"][:7] == this_month), 2)
    total_revenue = round(sum(i["total"] for i in invoices), 2)

    # revenue chart last 6 months
    monthly = defaultdict(float)
    for i in invoices:
        monthly[i["date"][:7]] += i["total"]
    chart = []
    for k in range(5, -1, -1):
        y = now.year
        m = now.month - k
        while m <= 0:
            m += 12
            y -= 1
        key = f"{y:04d}-{m:02d}"
        chart.append({"month": key, "revenue": round(monthly.get(key, 0.0), 2)})

    # top products by revenue
    prod_rev = defaultdict(float)
    prod_qty = defaultdict(float)
    names = {}
    for i in invoices:
        for it in i["items"]:
            prod_rev[it["product_id"]] += it["line_total"]
            prod_qty[it["product_id"]] += it["qty"]
            names[it["product_id"]] = it["name"]
    top_products = sorted(
        [{"name": names[p], "revenue": round(r, 2), "qty": round(prod_qty[p], 2)} for p, r in prod_rev.items()],
        key=lambda x: x["revenue"], reverse=True)[:5]

    return {
        "total_products": len(products),
        "low_stock_count": len(low_stock),
        "customers_count": customers_count,
        "invoice_count": len(invoices),
        "month_revenue": month_revenue,
        "total_revenue": total_revenue,
        "inventory_value": inventory_value,
        "low_stock_items": low_stock,
        "revenue_chart": chart,
        "top_products": top_products,
    }


# ---------------- AI Insights ----------------
@api_router.get("/insights/customer/{customer_id}")
async def customer_insights(customer_id: str, user: dict = Depends(get_current_user)):
    c = await db.customers.find_one({"_id": ObjectId(customer_id)})
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    invoices = await db.invoices.find({"customer_id": customer_id}).to_list(1000)
    if not invoices:
        return {"insights": "No purchase history yet for this customer. Once they place orders, AI insights on reorder timing and upsell opportunities will appear here."}
    analytics = compute_customer_analytics(c, invoices)
    all_products = await db.products.find().to_list(1000)
    catalog = [{"name": p["name"], "category": p["category"], "price": p["price"]} for p in all_products]

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=os.environ["EMERGENT_LLM_KEY"],
            session_id=f"insights-{customer_id}",
            system_message=("You are a sales analyst for a Canadian fabrication tools & materials supplier. "
                            "Given a customer's purchase analytics and the full product catalog, produce concise, "
                            "actionable insights for the business owner. Use CAD currency. Be specific and practical. "
                            "Structure your response in three short sections with these exact markdown headers: "
                            "'### Buying Pattern', '### Reorder Predictions', '### Upsell Opportunities'. "
                            "Keep each section to 2-4 bullet points. No preamble.")
        ).with_model("anthropic", "claude-sonnet-4-6")
        import json
        prompt = (f"Customer: {c['name']} ({c.get('company','')})\n\n"
                  f"Analytics JSON:\n{json.dumps(analytics, default=str)}\n\n"
                  f"Full product catalog:\n{json.dumps(catalog, default=str)}\n\n"
                  "Generate the insights now.")
        text = await chat.send_message(UserMessage(text=prompt))
        return {"insights": text, "analytics": analytics}
    except Exception as e:
        logger.error(f"AI insights error: {e}")
        raise HTTPException(status_code=500, detail=f"AI insight generation failed: {str(e)}")


# ---------------- Seed ----------------
async def seed_admin():
    admin_email = os.environ["ADMIN_EMAIL"].lower()
    admin_password = os.environ["ADMIN_PASSWORD"]
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        await db.users.insert_one({"email": admin_email, "password_hash": hash_password(admin_password),
                                   "name": "Business Owner", "role": "admin",
                                   "created_at": datetime.now(timezone.utc).isoformat()})
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})


async def seed_data():
    if await db.products.count_documents({}) > 0:
        return
    products = [
        {"name": "3/32\" 7018 Welding Electrodes (50lb)", "sku": "WE-7018-332", "category": "Welding Consumables", "unit": "box", "price": 189.99, "cost": 120.0, "stock_qty": 45, "low_stock_threshold": 10},
        {"name": "ER70S-6 MIG Wire 0.035\" (33lb Spool)", "sku": "MIG-70S6-035", "category": "Welding Consumables", "unit": "spool", "price": 89.50, "cost": 55.0, "stock_qty": 8, "low_stock_threshold": 12},
        {"name": "Argon/CO2 75/25 Shielding Gas (Cyl)", "sku": "GAS-AR-CO2", "category": "Gases", "unit": "cylinder", "price": 74.00, "cost": 40.0, "stock_qty": 22, "low_stock_threshold": 6},
        {"name": "4.5\" Cutting Wheel (Type 1) 25pk", "sku": "AB-CW-45", "category": "Abrasives", "unit": "pack", "price": 42.99, "cost": 22.0, "stock_qty": 6, "low_stock_threshold": 15},
        {"name": "40 Grit Flap Disc 4.5\" (10pk)", "sku": "AB-FD-40", "category": "Abrasives", "unit": "pack", "price": 38.50, "cost": 19.0, "stock_qty": 30, "low_stock_threshold": 10},
        {"name": "1/4\" A36 Steel Plate (4x8 ft)", "sku": "ST-PL-025", "category": "Steel Stock", "unit": "sheet", "price": 320.00, "cost": 210.0, "stock_qty": 14, "low_stock_threshold": 5},
        {"name": "2\"x2\" HSS Square Tube (20ft)", "sku": "ST-HSS-22", "category": "Steel Stock", "unit": "length", "price": 96.00, "cost": 58.0, "stock_qty": 3, "low_stock_threshold": 8},
        {"name": "Auto-Darkening Welding Helmet", "sku": "PPE-HELM-AD", "category": "Safety / PPE", "unit": "each", "price": 149.99, "cost": 82.0, "stock_qty": 18, "low_stock_threshold": 5},
        {"name": "Leather Welding Gloves (Pair)", "sku": "PPE-GLV-LE", "category": "Safety / PPE", "unit": "pair", "price": 24.99, "cost": 11.0, "stock_qty": 60, "low_stock_threshold": 20},
        {"name": "Contact Tips 0.035\" (25pk)", "sku": "MIG-CT-035", "category": "Welding Consumables", "unit": "pack", "price": 18.75, "cost": 8.0, "stock_qty": 9, "low_stock_threshold": 15},
    ]
    for p in products:
        p["image_url"] = None
        p["created_at"] = datetime.now(timezone.utc).isoformat()
    res = await db.products.insert_many(products)
    pids = [str(i) for i in res.inserted_ids]
    prod_docs = await db.products.find().to_list(100)
    pmap = {str(p["_id"]): p for p in prod_docs}

    customers = [
        {"name": "Mike Dawson", "company": "Dawson Metalworks", "email": "mike@dawsonmetal.ca", "phone": "416-555-0142", "address": "12 Industrial Rd, Toronto, ON"},
        {"name": "Sarah Chen", "company": "Precision Fab Inc.", "email": "sarah@precisionfab.ca", "phone": "905-555-0198", "address": "88 Steelcase Dr, Mississauga, ON"},
        {"name": "Rob Tremblay", "company": "Tremblay Welding Ltd.", "email": "rob@tremblayweld.ca", "phone": "514-555-0177", "address": "45 Rue Fabrication, Montreal, QC"},
    ]
    for c in customers:
        c["created_at"] = datetime.now(timezone.utc).isoformat()
    cres = await db.customers.insert_many(customers)
    cids = [str(i) for i in cres.inserted_ids]

    import random
    now = datetime.now(timezone.utc)
    inv_count = 0
    # generate ~9 months of history per customer
    for cid, cust in zip(cids, customers):
        # each customer has preferred products
        prefs = random.sample(pids, 4)
        for month_back in range(8, -1, -1):
            # some months skipped to create frequency variation
            if random.random() < 0.25:
                continue
            date = (now - timedelta(days=month_back * 30 + random.randint(0, 12)))
            chosen = random.sample(prefs, random.randint(1, 3))
            items = []
            subtotal = 0.0
            for pid in chosen:
                p = pmap[pid]
                qty = random.randint(1, 6)
                line = round(p["price"] * qty, 2)
                subtotal += line
                items.append({"product_id": pid, "name": p["name"], "sku": p["sku"],
                              "qty": qty, "unit_price": p["price"], "line_total": line})
            tax = round(subtotal * TAX_RATE, 2)
            inv_count += 1
            await db.invoices.insert_one({
                "invoice_number": f"INV-{1000 + inv_count}", "customer_id": cid,
                "customer_name": cust["name"], "date": date.strftime("%Y-%m-%d"),
                "items": items, "subtotal": round(subtotal, 2), "tax": tax, "tax_rate": TAX_RATE,
                "total": round(subtotal + tax, 2), "notes": None,
                "created_at": date.isoformat()})


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.login_attempts.create_index("identifier")
    # dedupe any duplicate zoho invoices, then enforce uniqueness
    pipeline = [{"$match": {"zoho_invoice_id": {"$exists": True}}},
                {"$group": {"_id": "$zoho_invoice_id", "ids": {"$push": "$_id"}, "n": {"$sum": 1}}},
                {"$match": {"n": {"$gt": 1}}}]
    async for g in db.invoices.aggregate(pipeline):
        for extra in g["ids"][1:]:
            await db.invoices.delete_one({"_id": extra})
    await db.invoices.create_index("zoho_invoice_id", unique=True, sparse=True)
    await db.invoices.create_index("customer_id")
    await db.invoices.create_index("source")
    await seed_admin()
    await seed_data()
    asyncio.create_task(zoho_scheduler())
    cred = Path("/app/memory/test_credentials.md")
    cred.parent.mkdir(exist_ok=True)
    cred.write_text(
        f"# Test Credentials\n\n## Admin (Owner)\n- Email: {os.environ['ADMIN_EMAIL']}\n"
        f"- Password: {os.environ['ADMIN_PASSWORD']}\n- Role: admin\n\n"
        "## Auth Endpoints\n- POST /api/auth/register\n- POST /api/auth/login\n"
        "- POST /api/auth/logout\n- GET /api/auth/me\n")


app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("FRONTEND_URL", "http://localhost:3000"), "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown():
    client.close()
