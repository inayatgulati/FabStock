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
- Zoho Books sync — LIVE (connected 2026-07-16). Org 110000477883, Canada (.ca). Imported ~1180 invoices (Nov 2024→Jul 2026, full line items), 123 customers, 221 linked products. Rate-limit-safe design: header-only + capped detail; lightweight incremental sync (newest-first, stops at known) every 30 min + Sync Now. NOTE: Zoho plan cap is 1000 API calls/day; initial bulk import hit the cap once (resets daily) — steady-state usage is well under.
- Cash Sales (off-books): /api/cash-sales deducts stock, creates/links cash customer, source='cash'; UI modal with source badges.
- Tested: 17/17 backend, all frontend flows pass (iterations 1 & 2)

## Backlog / Remaining
- BLOCKER for Zoho live: user must provide Zoho Self Client → Client ID, Client Secret, Refresh Token (added to backend/.env: ZOHO_CLIENT_ID/SECRET/REFRESH_TOKEN)
- P1: Role-based access (restrict catalog mutations to admin)
- P1: Zoho webhook (real-time) instead of/alongside 5-min poll
- P2: per-source revenue breakdown (cash vs zoho vs manual); prevent negative stock; invoice PDF export

## Next Tasks
- Gather user feedback on analytics depth and whether Zoho integration is needed.
