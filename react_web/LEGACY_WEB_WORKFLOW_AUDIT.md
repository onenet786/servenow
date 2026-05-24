# Legacy Web Workflow Audit

This React workspace is being aligned to the existing root web app, not invented from a blank dashboard.

## Old Admin Entry

Files read:

- `admin.html`
- `js/admin.js`
- `js/financial.js`
- `js/inventory-report.js`
- `js/financial_helpers.js`
- `js/orders.js`
- `routes/admin.js`
- `routes/financial.js`
- `routes/orders.js`
- `routes/products.js`
- `routes/users.js`
- `routes/riders.js`
- `routes/categories.js`
- `routes/units.js`
- `routes/sizes.js`
- `routes/permissions.js`
- `PROJECT_MODULE_ANALYSIS.md`
- `webapp_v2/REPLACEMENT_PARITY.md`

## Admin Tabs In The Old App

- Dashboard
- Accounts
- Riders
- User Rights
- Stores
- Store Status
- Store Status Delivery
- Store Status Broadcast
- Store Status Live Promotions
- Store Status Offer Campaigns
- Store Status Flash Message
- Products
- Orders
- Payments
- Wallets
- Order Reports
- Inventory Report
- Sale Reports
- Rider Reports
- Store Reports
- Store Payment Term Reports
- Financial Reports
- Financial Dashboard
- Categories
- Units
- Sizes
- Payment Vouchers
- Store Settlements
- Expenses
- Receipt Vouchers
- Rider Cash
- Bank Payment Vouchers
- Bank Receipt Vouchers
- Journal Vouchers
- Settings
- DB Backup
- Problems

## Core Workflow Families

- Operations: dashboard, orders, rider assignment, order status, manual orders, delivery fee settings.
- Catalog: products, categories, units, sizes, inventory and sales reports.
- People: accounts/users, riders, rider fuel, user rights and permissions.
- Stores: stores, store status, global delivery, broadcast notifications, live promotions, offer campaigns, flash messages.
- Payments and wallet: payment list/stats, wallet list/stats, manual wallet adjustment.
- Financial: dashboard, cash ledger, transactions, payment vouchers, receipt vouchers, bank vouchers, journal vouchers, rider cash, store settlements, expenses, generated reports, cash flow, platform/product/rider/store reports.
- Utilities: app settings, DB backup/restore, diagnostics/problems.

## React Migration Rule

The React app must preserve role-specific workspaces and expose every old module as a first-class admin area before individual forms are polished.

## Business Logic Mapped Into React

- Product pricing reads store `payment_term`.
- Discount stores use product discount settings unless `store_discount_apply_all_products` is enabled, then the store discount percent is used.
- Cash only and credit stores use profit settings to derive cost price.
- Automatic product cost is rounded the same way as the old admin/product API helper.
- Manual product cost and manual variant cost override flags are sent to the existing product API.
- Admin order management loads `/api/orders/:id/items`.
- Admin can add order items after placement through `/api/orders/:id/items/add`.
- Admin can remove order items after placement through `/api/orders/:id/items/:itemId`.
- Admin can update customer, delivery address, and instructions through `/api/orders/:id/customer`.
- Admin can save manual delivery charges or trigger automatic recalculation through `/api/orders/:id/delivery-fee`.
