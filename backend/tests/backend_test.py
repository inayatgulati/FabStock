"""Backend API tests for FabSupply inventory / customer / invoice / AI insights app."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://fab-tools-hub-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "owner@fabsupply.ca"
ADMIN_PASSWORD = "FabSupply2026!"


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def auth_client(client):
    r = client.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    assert "access_token" in client.cookies, "access_token cookie not set"
    return client


# ---------------- Auth ----------------
class TestAuth:
    def test_login_success(self, auth_client):
        r = auth_client.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_login_bad_password(self, client):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong-pw"})
        assert r.status_code in (401, 429)

    def test_me_requires_auth(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401


# ---------------- Dashboard ----------------
class TestDashboard:
    def test_stats(self, auth_client):
        r = auth_client.get(f"{API}/dashboard/stats")
        assert r.status_code == 200
        d = r.json()
        for k in ["total_products", "low_stock_count", "customers_count", "month_revenue",
                  "inventory_value", "low_stock_items", "revenue_chart", "top_products"]:
            assert k in d
        assert d["customers_count"] >= 3
        assert d["total_products"] >= 10
        assert len(d["revenue_chart"]) == 6


# ---------------- Products / Inventory ----------------
class TestProducts:
    def test_list(self, auth_client):
        r = auth_client.get(f"{API}/products")
        assert r.status_code == 200
        prods = r.json()
        assert len(prods) >= 10
        assert all("id" in p and "_id" not in p for p in prods)

    def test_create_and_persist(self, auth_client):
        payload = {"name": "TEST_Widget", "sku": "TEST-SKU-1", "category": "TEST", "unit": "each",
                   "price": 9.99, "cost": 5.0, "stock_qty": 20, "low_stock_threshold": 5}
        r = auth_client.post(f"{API}/products", json=payload)
        assert r.status_code == 200
        pid = r.json()["id"]
        # verify in list
        r2 = auth_client.get(f"{API}/products")
        assert any(p["id"] == pid and p["name"] == "TEST_Widget" for p in r2.json())
        # cleanup
        auth_client.delete(f"{API}/products/{pid}")

    def test_adjust_inventory(self, auth_client):
        # create a product to adjust
        r = auth_client.post(f"{API}/products", json={"name": "TEST_Adj", "sku": "TEST-ADJ",
                             "category": "TEST", "unit": "each", "price": 1.0, "cost": 0.5,
                             "stock_qty": 50, "low_stock_threshold": 5})
        pid = r.json()["id"]
        r2 = auth_client.post(f"{API}/inventory/adjust", json={"product_id": pid, "change": -5,
                              "reason": "Manual sale", "note": "test"})
        assert r2.status_code == 200
        assert r2.json()["stock_qty"] == 45
        auth_client.delete(f"{API}/products/{pid}")


# ---------------- Customers ----------------
class TestCustomers:
    def test_list(self, auth_client):
        r = auth_client.get(f"{API}/customers")
        assert r.status_code == 200
        c = r.json()
        assert len(c) >= 3
        assert all("total_spent" in x and "order_count" in x for x in c)

    def test_detail_analytics(self, auth_client):
        cs = auth_client.get(f"{API}/customers").json()
        cid = cs[0]["id"]
        r = auth_client.get(f"{API}/customers/{cid}")
        assert r.status_code == 200
        d = r.json()
        assert "customer" in d and "analytics" in d and "invoices" in d
        a = d["analytics"]
        assert len(a["monthly_sales"]) == 12
        assert "products" in a


# ---------------- Invoices ----------------
class TestInvoices:
    def test_list(self, auth_client):
        r = auth_client.get(f"{API}/invoices")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_invoice_deducts_stock(self, auth_client):
        prods = auth_client.get(f"{API}/products").json()
        custs = auth_client.get(f"{API}/customers").json()
        p = next(x for x in prods if x["stock_qty"] > 5)
        before = p["stock_qty"]
        payload = {"customer_id": custs[0]["id"],
                   "items": [{"product_id": p["id"], "qty": 2}]}
        r = auth_client.post(f"{API}/invoices", json=payload)
        assert r.status_code == 200
        inv = r.json()
        expected_sub = round(p["price"] * 2, 2)
        expected_tax = round(expected_sub * 0.13, 2)
        assert inv["subtotal"] == expected_sub
        assert inv["tax"] == expected_tax
        assert inv["total"] == round(expected_sub + expected_tax, 2)
        # verify stock deducted
        p2 = next(x for x in auth_client.get(f"{API}/products").json() if x["id"] == p["id"])
        assert p2["stock_qty"] == before - 2


# ---------------- AI Insights ----------------
class TestAI:
    def test_customer_insights(self, auth_client):
        cs = auth_client.get(f"{API}/customers").json()
        cid = cs[0]["id"]
        r = auth_client.get(f"{API}/customers/{cid}", timeout=60)
        assert r.status_code == 200
        r2 = auth_client.get(f"{API}/insights/customer/{cid}", timeout=90)
        assert r2.status_code == 200, f"AI insight failed: {r2.text}"
        txt = r2.json()["insights"]
        assert "Buying Pattern" in txt or "Reorder" in txt or "Upsell" in txt
