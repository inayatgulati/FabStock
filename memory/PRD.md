# FabStock — Inventory & Customer Intelligence (PRD)

## Original Problem Statement
Business owner selling fabrication tools & materials to fabrication shops in Canada needs an app to track inventory (auto-updated on invoice, plus manual adjustments for off-invoice sales), track customer buying patterns (monthly sales, most-ordered products, product consumption/reorder timeline, order frequency), and get AI insights for upselling. CAD currency, secure login, low-stock alerts.

## Architecture
- Backend: FastAPI + MongoDB (motor). JWT auth via httpOnly cookies. Collections: users, products, customers, invoices, inventory_adjustments, login_attempts.
- Frontend: React 19 + React Router + React Query + Tailwind + shadcn/ui + Recharts. Dark industrial theme (zinc/orange/emerald/blue).
- AI: Claude Sonnet 4.6 via emergentintegrations (EMERGENT_LLM_KEY) for customer sales insights.

## User Personas
- Business owner / staff managing inventory, customers, invoices.

## Core Requirements (static)
- Secure email/password login (owner/staff)
- Inventory tracking with manual adjustments and low-stock alerts (CAD)
- In-app invoicing that auto-deducts stock (13% HST)
- Customer analytics: monthly sales, top products, reorder timeline, order frequency
- AI upsell/reorder insights per customer

## Implemented (2026-07-16)
- JWT cookie auth + admin seeding; login/logout/me
- Dashboard: KPIs, 6-month revenue line chart, top products bar chart, low-stock table
- Inventory: product CRUD, search, manual stock adjustment with reason log
- Customers: list with spend/orders, detail with metrics, 12-month sales chart, consumption/reorder table, order history
- Invoices: create with line items, subtotal/HST/total, auto stock deduction
- AI insights (Claude Sonnet 4.6): buying pattern / reorder predictions / upsell opportunities
- Seed data: 10 fabrication products, 3 customers, ~18 invoices (9 months)
- Tested: 12/12 backend, 9/9 frontend flows pass

## Backlog / Remaining
- P1: Role-based access (restrict catalog mutations to admin)
- P1: Invoice PDF export / Zoho sync
- P2: Deterministic seed data, edit/delete customers UI, adjustment history view page
- P2: Inventory-wide AI reorder report; email low-stock alerts

## Next Tasks
- Gather user feedback on analytics depth and whether Zoho integration is needed.
