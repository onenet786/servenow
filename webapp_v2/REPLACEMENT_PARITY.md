# ServeNow Web Replacement Parity

This document is the current source of truth for replacing the existing web app with `webapp_v2` without guessing.

## Goal

`webapp_v2` should eventually replace the whole current web platform, not only the customer storefront.

The current live web system includes these role experiences:

- Customer web app
- Rider web app
- Admin and staff web app
- Store-owner capabilities and workflows

## Current Live Web App Map

### Role routing in the current app

Current login routing in `js/app.js`:

- `admin` -> `admin.html`
- `standard_user` -> `admin.html`
- `rider` -> `rider.html`
- `customer` -> `index.html`
- `store_owner` -> `index.html`

Important nuance:

- `store_owner` is a real backend role with dedicated permissions and APIs.
- But the current frontend does not appear to have a separate `store-owner.html`.
- Store owners are currently routed into the customer-facing shell and rely on role-based backend behavior plus admin/store tooling.

### Current customer-facing pages

Core pages:

- `index.html`
- `stores.html`
- `store.html`
- `cart.html`
- `checkout.html`
- `orders.html`
- `wallet.html`
- `profile.html`
- `login.html`
- `register.html`
- `forgot-password.html`
- `reset-password.html`
- `order-confirmation.html`

Core scripts:

- `js/app.js`
- `js/stores.js`
- `js/store.js`
- `js/checkout.js`
- `js/orders.js`
- `js/wallet.js`

Current customer capability groups:

- Home page, categories, featured and nearby stores
- Store listing and store search
- Store detail and product browsing
- Cart management
- Checkout and order creation
- Order listing and basic tracking
- Wallet balance and transactions
- Wallet top-up and payment methods
- Auto-recharge
- Wallet transfers
- Profile and password change
- Login, register, email verification, logout
- Global delivery status and live promotions

Primary customer API families currently used:

- `/api/auth/*`
- `/api/categories`
- `/api/stores`
- `/api/products`
- `/api/orders`
- `/api/wallet/*`

### Current rider app

Dedicated rider page:

- `rider.html`

Core script:

- `js/rider.js`

Current rider capability groups:

- Rider login and access control
- Rider profile
- Rider wallet summary
- Assigned deliveries
- Completed deliveries
- Delivery detail modal
- GPS capture and location tracking
- Push rider location to active orders
- Mark delivery complete
- Update payment status
- Change password

Primary rider API families currently used:

- `/api/orders/rider/profile`
- `/api/orders/rider/deliveries`
- `/api/orders/:id/rider-location`
- `/api/orders/:id/deliver`
- `/api/orders/:id/payment-status`
- `/api/wallet/balance`
- `/api/auth/change-password`

### Current admin and staff app

Dedicated admin page:

- `admin.html`

Core script:

- `js/admin.js`

Current admin sections found in `admin.html`:

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

Current admin capability groups observed in `js/admin.js` and route files:

- Dashboard metrics and recent activity
- User creation, editing, deletion, and role assignment
- Store-owner account linking
- Rider management and rider fuel history
- Stores CRUD and store images
- Product CRUD and product images
- Category CRUD and images
- Unit CRUD
- Size CRUD
- Order listing, detail, status update, rider assignment
- Manual admin order creation
- Delivery fee configuration
- Global delivery switch
- Customer notifications and customer push notifications
- Live promotions
- Offer campaigns
- Flash messages
- Payments admin views
- Wallet admin views and wallet adjustment
- Permission groups and user/group mapping
- Diagnostics and transactional cleanup
- Backup, restore, and database maintenance
- Reports across orders, riders, stores, inventory, sales, and finance
- Financial operations including vouchers, settlements, expenses, rider cash, and journal flows

Primary admin API families currently used:

- `/api/admin/*`
- `/api/users`
- `/api/riders`
- `/api/stores`
- `/api/products`
- `/api/categories`
- `/api/units`
- `/api/sizes`
- `/api/orders`
- `/api/permissions/*`
- `/api/financial/*`

### Current store-owner capabilities

There is not yet a clean dedicated store-owner web shell in the current frontend, but store-owner-specific behavior exists in the backend and admin tooling.

Confirmed store-owner APIs and capabilities:

- `/api/stores/bank-options`
- `/api/stores/status-message`
- `/api/stores/offer-campaigns`
- `/api/stores` create and update as store owner
- `/api/stores/upload-image`
- `/api/orders/store-owner/financial-history`
- `/api/orders/store-dashboard`
- Store-owner-scoped order access and order status updates in `routes/orders.js`

Implication for replacement:

- `webapp_v2` needs an intentional store-owner workspace.
- Reusing the customer shell is not enough if future replacement should be complete.

## `webapp_v2` Status Today

Current implemented areas in `webapp_v2`:

- Customer home
- Store listing
- Store detail
- Cart
- Checkout
- Orders
- Wallet
- Profile
- Login and register
- Guest login
- Initial admin workspace:
  - Admin dashboard summary
  - Admin recent activity
  - Admin orders list
  - Admin stores list
  - Admin users list
  - Admin products list

Current major gaps in `webapp_v2`:

- No rider workspace
- No dedicated store-owner workspace
- No admin CRUD forms yet
- No admin category, unit, or size management
- No admin rider management UI
- No admin payment and wallet operations UI
- No admin reports UI
- No admin financial module UI
- No permissions and rights management UI
- No DB backup, restore, or diagnostics UI
- No forgotten-password and reset-password flow
- No full parity for order detail operations from admin/staff side

## Replacement Parity Matrix

### Customer

- Home and discovery: `Partially done in webapp_v2`
- Stores list and search: `Done`
- Store detail and products: `Done`
- Cart: `Done`
- Checkout: `Done`
- Orders list and tracking: `Done`
- Wallet balance and transactions: `Done`
- Wallet top-up, transfers, auto-recharge: `Done`
- Profile and password change: `Done`
- Login, register, guest login: `Done`
- Email verification: `Missing`
- Forgot password and reset password: `Missing`
- Order confirmation page parity: `Missing or merged into SPA flow`
- Promotions and global delivery messaging parity: `Partial`

### Rider

- Rider dashboard shell: `Missing`
- Assigned deliveries: `Missing`
- Completed deliveries: `Missing`
- Rider profile: `Missing`
- Rider wallet summary: `Missing`
- Rider location tracking: `Missing`
- Rider payment status update: `Missing`
- Rider delivery completion: `Missing`
- Rider password change: `Missing`

### Store owner

- Dedicated store-owner shell: `Missing`
- Store dashboard: `Missing`
- Store-owner financial history: `Missing`
- Store status message management: `Missing`
- Bank options management: `Missing`
- Offer campaigns management: `Missing`
- Store editing workflow: `Missing`
- Store-owner order operations: `Missing`

### Admin and staff

- Dashboard summary: `Done`
- Recent activity: `Done`
- Orders list: `Done`
- Stores list: `Done`
- Users list: `Done`
- Products list: `Done`
- User create, edit, delete: `Missing`
- User rights and group management: `Missing`
- Rider management: `Missing`
- Store create and edit: `Missing`
- Product create and edit: `Missing`
- Category management: `Missing`
- Unit management: `Missing`
- Size management: `Missing`
- Order detail and advanced order actions: `Missing`
- Manual order creation: `Missing`
- Delivery fee settings: `Missing`
- Global delivery controls: `Missing`
- Push notifications: `Missing`
- Live promotions and flash messages: `Missing`
- Payments admin: `Missing`
- Wallet admin: `Missing`
- Reports module: `Missing`
- Financial module: `Missing`
- Settings: `Missing`
- DB backup and restore: `Missing`
- Diagnostics and problem tools: `Missing`

## Recommended Migration Order

This order reduces risk while moving toward true replacement:

1. Finish customer parity gaps
2. Build dedicated rider workspace
3. Build dedicated store-owner workspace
4. Expand admin from read-only lists into operational CRUD
5. Migrate admin reports and financial modules
6. Migrate diagnostics, backup, restore, and maintenance tools

## Phase Plan For `webapp_v2`

### Phase 1: Complete customer parity

- Email verification flow
- Forgot password and reset password
- Better order detail flow
- Promotions and global delivery parity cleanup

### Phase 2: Add rider app inside `webapp_v2`

- Rider login routing
- Rider deliveries
- Rider profile and wallet
- Rider GPS and active location updates
- Rider delivery completion and payment updates

### Phase 3: Add store-owner workspace

- Store dashboard
- Store financial history
- Store status message
- Bank options
- Offer campaigns
- Store-owner order management

### Phase 4: Expand admin operations

- Users CRUD
- Riders CRUD
- Stores CRUD
- Products CRUD
- Categories, units, sizes
- Full order detail and assignment actions
- Delivery fee controls

### Phase 5: Admin advanced modules

- Reports
- Payments and wallets admin
- Permissions
- Financial dashboard and vouchers
- Diagnostics
- Backup and restore

## Implementation Notes

- Keep the current app at `/` untouched while `webapp_v2` continues at `/next`.
- Add dedicated route spaces inside the new app for each role instead of hiding everything inside one mixed screen set.
- Treat admin, rider, and store-owner as first-class workspaces in the replacement architecture.
- Use the existing backend APIs first, then only add backend changes when the current API is insufficient.

## Immediate Next Build Target

The next practical implementation target should be:

1. Finish customer auth parity
2. Add rider workspace in `webapp_v2`
3. Add store-owner workspace in `webapp_v2`
4. Then continue admin CRUD migration

This sequence gets `webapp_v2` much closer to replacing the whole live web platform instead of only replacing the customer site.
