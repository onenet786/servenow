# ServeNow Project Module Analysis

Generated: 2026-05-21

This document describes the current ServeNow project by module. It separates the web and mobile applications, then explains the shared backend/API layer that both clients depend on. No runtime code is changed by this document.

## 1. Project Overview

ServeNow is a grocery and local delivery platform with:

- A Node.js/Express backend API.
- A current multipage web app served from the repository root.
- A separate `/next` single-page alternative web app in `webapp_v2`.
- A Flutter mobile app in `mobile_app`.
- MySQL persistence, wallet/payment modules, real-time notifications, rider tracking, store-owner workflows, admin dashboards, reports, and offer campaign support.

Top-level areas:

| Area | Path | Purpose |
| --- | --- | --- |
| Backend entry | `server.js` | Express app, Socket.IO, MySQL pool, middleware, static file serving, route mounting |
| API routes | `routes/` | Domain-specific backend modules |
| Web pages | `*.html` | Current production-style multipage web app |
| Web scripts | `js/` | Browser JavaScript for current web app |
| Web styles | `css/`, `style/` | Current app styling |
| Alternative web app | `webapp_v2/` | `/next` SPA and auth pages |
| Mobile app | `mobile_app/` | Flutter application |
| Shared backend helpers | `middleware/`, `services/`, `utils/`, `config/` | Auth, push/email, validators, offer campaign pricing, response helpers |
| Database assets | `database/`, root migration/check scripts | Schema backups, diagnostic scripts, migration helpers |
| Uploaded/static media | `uploads/`, `images/` | Product/store/rider uploaded assets and brand images |

## 2. Shared Backend/API Layer

The backend is a Node.js Express application. `server.js` loads `.env`, creates the Express app and HTTP server, attaches Socket.IO, creates a MySQL connection pool, configures security and performance middleware, serves static assets, then mounts API routes.

### 2.1 Server Bootstrap

Main file: `server.js`

Responsibilities:

- Loads environment variables using `dotenv`.
- Forces `PORT` from CLI, `.env`, or fallback.
- Creates Express and HTTP server.
- Creates Socket.IO server with websocket and polling transports.
- Adds compression, CORS, security headers, request body limits, Morgan logging, and rate limits.
- Serves `/uploads`, `/images`, and `/next`.
- Creates MySQL pool and attaches `req.db`.
- Attaches Socket.IO instance to `req.io`.
- Mounts domain routes under `/api/*`.
- Serves root web pages and fallback static HTML files.

Important server routes and static mounts:

| Mount | Purpose |
| --- | --- |
| `/health` | Basic server and Socket.IO health response |
| `/uploads` | Uploaded files |
| `/images` | Static images and brand assets |
| `/next` | Alternative web app from `webapp_v2` |
| `/api/auth` | Authentication |
| `/api/users` | User management and deletion |
| `/api/stores` | Stores, store status, promotions, offer campaigns |
| `/api/products` | Products, images, product variants, offers |
| `/api/orders` | Orders, rider deliveries, store-owner dashboards |
| `/api/categories` | Category catalog |
| `/api/riders` | Rider CRUD and fuel history |
| `/api/admin` | Admin dashboard, reports, utilities, diagnostics |
| `/api/units` | Product units |
| `/api/sizes` | Product sizes |
| `/api/payments` | Stripe/card/payment flows |
| `/api/wallet` | Wallet, top-ups, transfers, auto-recharge |
| `/api/financial` | Accounting, vouchers, ledgers, reports |
| `/api/permissions` | Permission groups and role restrictions |

### 2.2 Real-Time Notifications

Implemented with Socket.IO in `server.js`.

Socket behavior:

- Clients identify themselves using `identify_user`.
- User-specific rooms are created as `user_<id>` and `<user_type>_<id>`.
- Admin users also join `admins`.
- Server emits heartbeat events for debugging/connection monitoring.

Used by:

- Web notification bell in `js/notifications.js`.
- Mobile notification provider through `socket_io_client`.
- Order assignment and status updates.
- Rider notifications.
- Admin live refresh scenarios.

### 2.3 Authentication and Permissions

Backend files:

- `routes/auth.js`
- `middleware/auth.js`
- `routes/permissions.js`

Core features:

- Login/register.
- Guest login.
- Google login support in mobile API service.
- Email verification and resend code.
- Forgot/reset password OTP flow.
- Refresh tokens.
- Current user lookup through `/api/auth/me`.
- Profile and password endpoints.
- Push device token registration and unregistering.
- Permission groups for admin/staff UI restrictions.

Web and mobile both persist the auth token client-side and send `Authorization: Bearer <token>`.

### 2.4 Store Module

Backend file: `routes/stores.js`

Core features:

- Public store listing and store details.
- Store-owner/admin store creation and updates.
- Store image upload.
- Store open/closed status and status messages.
- Global delivery status widget.
- Customer push notifications and notification target management.
- App update status.
- Live promotions/events widget.
- Customer flash message.
- Store grace alerts and mute flow.
- Store payment terms and bank details.
- Store offer campaigns.

Store detail API enriches products with active offer pricing and variant pricing.

### 2.5 Product/Catalog Module

Backend files:

- `routes/products.js`
- `routes/categories.js`
- `routes/units.js`
- `routes/sizes.js`

Core features:

- Product listing and product detail.
- Product CRUD for staff/admin/store-owner workflows.
- Product image upload and optional resized image variants.
- Product category/unit/size setup.
- Product size variant pricing.
- Product discount fields.
- Active offer campaign enrichment:
  - `original_price`
  - `promotional_price`
  - `has_active_offer`
  - `offer_badge`
  - `offer_meta`

### 2.6 Order Module

Backend file: `routes/orders.js`

Core features:

- Delivery fee config.
- Customer order creation.
- Customer order history.
- Order details.
- Admin order listing/filtering.
- Store-owner order dashboard.
- Order status updates.
- Rider assignment.
- Rider delivery listing.
- Rider profile, location update, location history.
- Rider wallet stats and financial history.
- Rider day close.
- Mark delivered.
- Payment status updates.
- Product/item-level order support.
- Customer support contact.

The order module is central to customer, rider, store-owner, and admin workflows.

### 2.7 Rider Module

Backend files:

- `routes/riders.js`
- rider endpoints in `routes/orders.js`

Core features:

- Rider CRUD.
- Rider profile images and ID upload.
- Vehicle types.
- Rider active/availability status.
- Rider assigned and completed delivery lists.
- Rider location tracking.
- Rider fuel history.
- Rider cash and wallet reporting via financial/order endpoints.

### 2.8 Wallet and Payment Modules

Backend files:

- `routes/wallets.js`
- `routes/payments.js`

Wallet features:

- Wallet balance.
- Wallet transactions.
- Top-up.
- Saved payment methods.
- Auto-recharge settings.
- Send/receive money transfers.
- Accept/reject/cancel transfers.

Payment features:

- Payment process endpoint.
- Stripe webhook.
- Payment detail lookup.
- Refunds.
- Payment listing.

### 2.9 Financial Module

Backend file: `routes/financial.js`

This is the largest accounting/reporting module.

Core areas:

- Financial dashboard.
- Cash ledger.
- Transactions.
- Payment vouchers.
- Receipt vouchers.
- Journal vouchers.
- Rider cash movements.
- Store settlements.
- Expense categories and expenses.
- Financial reports.
- Platform summary.
- Top products.
- Rider performance.
- Store performance.
- Cash flow.
- Category sales.
- Rider and store detailed reports.
- Bank setup.

It supports admin reporting and operational accounting views in web and mobile.

### 2.10 Admin Module

Backend file: `routes/admin.js`

Core areas:

- Visitor stats.
- Recent activity.
- Dashboard stats.
- Sales summaries.
- Reports and analytics.
- Payments and wallet stats.
- Wallet adjustments.
- Data diagnostics.
- Clear transactional data utilities.
- Database shrink/optimization helper.
- Store/admin operational endpoints.

This powers the large web admin dashboard and parts of the mobile admin dashboard.

### 2.11 Store Offer Campaigns

Backend files:

- `utils/offerCampaigns.js`
- `routes/stores.js`
- `routes/products.js`

Tables auto-created:

- `store_offer_campaigns`
- `store_offer_campaign_products`

Supported campaign types:

- `discount`: fixed amount or percentage discount.
- `bxgy`: Buy X Get Y, represented as an effective unit price.

Supported scopes:

- `all_products`
- `selected_products`

Runtime behavior:

- Active campaigns are filtered by `is_enabled`, `start_at <= NOW()`, and `end_at >= NOW()`.
- Product APIs compute the best active campaign per product/variant.
- If multiple campaigns apply, the lowest promotional price wins.
- Buy X Get Y creates a badge like `Buy 2 Get 1` and computes effective unit price, not a separate free cart line.

## 3. Current Web App

The current web app is a multipage HTML/CSS/JavaScript application served from the repository root. Pages are traditional HTML files that load shared scripts and page-specific modules.

### 3.1 Web Structure

Primary page files:

| Page | Purpose |
| --- | --- |
| `login.html` | User login |
| `register.html` | User registration |
| `forgot-password.html` | Password recovery start |
| `reset-password.html` | Password reset |
| `index.html` | Customer home/store discovery |
| `stores.html` | Store listing |
| `store.html` | Store details and product browsing |
| `products.html` | Product listing |
| `cart.html` | Customer cart |
| `checkout.html` | Checkout and order placement |
| `order-confirmation.html` | Order confirmation |
| `orders.html` | Customer orders |
| `wallet.html` | Wallet management |
| `profile.html` | Profile |
| `rider.html` | Rider dashboard |
| `admin.html` | Admin/staff operations dashboard |
| `customer_tile_demo.html` | Admin/customer tile visual preview |
| `data-deletion.html` | Play Store compliance deletion page |
| `socket-test.html` | Socket.IO testing page |

### 3.2 Shared Web Scripts

| Script | Purpose |
| --- | --- |
| `js/app.js` | Shared web helpers, auth/session utilities, cart helpers, global delivery status helpers |
| `js/notifications.js` | Socket.IO notification bell, browser notifications, event listeners |
| `js/lazy-loader.js` | Lazy script/style loading helpers |
| `js/financial_helpers.js` | Dynamic financial entity selection helpers |

### 3.3 Customer Web Modules

Customer-facing files:

- `index.html`
- `stores.html`
- `store.html`
- `products.html`
- `cart.html`
- `checkout.html`
- `orders.html`
- `order-confirmation.html`
- `wallet.html`
- `profile.html`

Customer scripts:

- `js/stores.js`
- `js/store.js`
- `js/checkout.js`
- `js/orders.js`
- `js/order-confirmation.js`
- `js/wallet.js`
- `js/confirmation.js`

Main customer capabilities:

- Browse stores and store products.
- View effective promotional prices from backend offer campaigns.
- Add items and product variants to local cart.
- Review cart and checkout.
- Calculate delivery fee with multi-store support.
- Check global delivery block before checkout.
- Place orders through `/api/orders`.
- Track orders.
- Manage wallet, top-ups, transfers, auto-recharge, and transactions.
- Receive live order and system notifications.

### 3.4 Rider Web Module

Files:

- `rider.html`
- `js/rider.js`
- `css/rider.css`

Main rider capabilities:

- Rider profile display.
- Current location display and refresh.
- Active and completed delivery tabs.
- Delivery cards with customer, store, address, phone, payment, totals, and item summary.
- Contact actions: call, SMS, WhatsApp.
- Mark payment received.
- Mark delivered.
- Push rider location to active delivery.
- Auto location tracking for active deliveries.
- Wallet balance display.
- Profile image and ID card display.

### 3.5 Admin Web Module

Files:

- `admin.html`
- `js/admin.js`
- `js/financial.js`
- `js/inventory-report.js`
- `css/admin.css`
- `css/style.css`

Admin dashboard areas in `admin.html`:

- Dashboard.
- Users.
- Riders.
- User rights and permissions.
- Stores.
- Store status.
- Delivery notice.
- Push broadcast.
- Promotions/events.
- Store offer campaigns.
- Customer flash message.
- Customer tile demo link.
- Products.
- Orders.
- Payments.
- Wallets.
- Order reports.
- Inventory report.
- Sale reports.
- Rider reports.
- Store reports.
- Store payment term reports.
- Financial reports.
- Financial dashboard.
- Categories.
- Units.
- Sizes.
- Financial vouchers and accounting utilities.
- Rider cash.
- Diagnostics and data maintenance utilities.

Admin script behavior:

- Maintains large `AppState` object.
- Loads dashboard stats and activity.
- Loads/filters CRUD tables.
- Manages stores, products, riders, users, catalog setup.
- Manages order filtering, rider assignment, and order status updates.
- Loads payments and wallet summaries.
- Manages financial entries and reports.
- Applies role restrictions based on `/api/permissions/my-permissions`.
- Manages store offer campaigns through `/api/stores/offer-campaigns`.

### 3.6 Store Owner Web Support

The current web app contains store-owner related backend support and some shared web behaviors, while the most explicit store-owner UI appears stronger in mobile and `/next`.

Related areas:

- Store CRUD in admin/store screens.
- Store status message endpoints.
- Store-owner financial endpoints.
- Store offer campaign endpoints.
- Store order dashboard endpoints.
- Product management where permission allows staff/store-owner behavior.

### 3.7 Customer Tile Demo

Files:

- `customer_tile_demo.html`
- `js/customer_tile_demo.js`
- `css/customer-tile-demo.css`

Purpose:

- Visual preview of customer-facing store and product tile presentation.
- Loads live stores and store details from backend.
- Shows product offers and effective promotional pricing.
- Useful for admin review without entering the full customer checkout flow.

## 4. Alternative Web App: `/next`

Path: `webapp_v2/`

This is a separate, newer single-page web app served under `/next`. It does not replace the current web app.

### 4.1 Files

| File | Purpose |
| --- | --- |
| `webapp_v2/index.html` | SPA shell with customer, rider, store-owner, and admin views |
| `webapp_v2/assets/app.js` | SPA state, routing, API calls, render functions |
| `webapp_v2/assets/app.css` | SPA styling |
| `webapp_v2/login.html` | Alternative login page |
| `webapp_v2/register.html` | Alternative registration page |
| `webapp_v2/forgot-password.html` | Alternative forgot password page |
| `webapp_v2/reset-password.html` | Alternative reset password page |
| `webapp_v2/assets/auth.js` | Auth page behavior |
| `webapp_v2/assets/auth.css` | Auth page styling |

### 4.2 SPA State and Routing

Main script: `webapp_v2/assets/app.js`

State areas:

- Customer:
  - stores
  - featured stores
  - current store
  - cart
  - orders
  - wallet
  - transfers
  - profile
- Rider:
  - profile
  - wallet
  - stats
  - assigned deliveries
  - completed deliveries
  - financial history
- Store owner:
  - stats
  - orders
  - financial history
  - status message
  - banks
  - campaigns
- Admin:
  - visitor stats
  - recent activity
  - orders
  - stores
  - users
  - products
  - riders
  - catalog data
  - permissions
  - payments
  - wallets
  - financial dashboard

Route groups:

- Customer: `home`, `stores`, `cart`, `orders`, `wallet`, `profile`
- Rider: `rider-dashboard`, `rider-financial`
- Store owner: `store-dashboard`, `store-financial`
- Admin: `admin-dashboard`, `admin-orders`, `admin-stores`, `admin-users`, `admin-products`, `admin-riders`, `admin-catalog`, `admin-permissions`, `admin-payments`, `admin-wallets`, `admin-financial`

### 4.3 `/next` Capabilities

Customer:

- Store discovery and search.
- Store detail rendering.
- Product cards and cart handling.
- Checkout and order creation.
- Order list filters.
- Wallet, top-up, transfers, auto-recharge.
- Profile/password management.

Rider:

- Assigned and completed deliveries.
- Push location.
- Mark delivered.
- Update payment status.
- Rider financial summary.

Store owner:

- Dashboard stats and store orders.
- Store financial history.
- Store status and campaigns data loading.

Admin:

- Dashboard stats.
- Recent activity.
- Orders with update/assign actions.
- Stores/users/products/riders summaries.
- Catalog summaries.
- Permissions overview.
- Payments/wallets/financial sections.

## 5. Flutter Mobile App

Path: `mobile_app/`

The mobile app is a Flutter application named `servenow`, version `1.2.2+37`.

### 5.1 Mobile Dependencies

Important packages:

- `provider`: state management.
- `http`: backend API calls.
- `shared_preferences`: persisted auth/cart/wallet cache/language settings.
- `logger`: logging.
- `geolocator`, `background_location_2`, `geocoding`: rider location tracking.
- `flutter_stripe`: wallet/card payment integration.
- `intl`: date/time formatting.
- `url_launcher`: phone, SMS, WhatsApp, links.
- `socket_io_client`: real-time events.
- `flutter_local_notifications`: local notifications.
- `firebase_core`, `firebase_messaging`: push notifications.
- `google_sign_in`: Google auth.
- `package_info_plus`: app version badge/update checks.
- `flutter_map`, `latlong2`: rider history map.

### 5.2 Mobile Entry and App Shell

Main file: `mobile_app/lib/main.dart`

Responsibilities:

- Initializes Flutter.
- Initializes Firebase and background notification handling when not on web.
- Creates notification channel.
- Sets up `MultiProvider`.
- Defines app theme using `CustomerPalette`.
- Adds session guard and app update overlay.
- Shows app version badge.
- Routes users by role after auth check.

Providers:

- `AuthProvider`
- `CartProvider`
- `WalletProvider`
- `NotificationProvider`

Important named routes:

| Route | Screen |
| --- | --- |
| `/login` | `LoginScreen` |
| `/register` | `RegisterScreen` |
| `/home` | `CustomerDashboardTestScreen` |
| `/admin` | `AdminDashboardScreen` |
| `/store-balances` | `StoreBalancesScreen` |
| `/rider` | `RiderDashboardScreen` |
| `/store_owner` | `StoreOwnerDashboardScreen` |
| `/orders` | `OrdersScreen` |
| `/cart` | `CartScreen` |
| `/checkout` | `CheckoutScreen` |
| `/inventory-report` | `InventoryReportScreen` |
| `/manage-stores` | `ManageStoresScreen` |
| `/manage-products` | `ManageProductsScreen` |
| `/manage-users` | `ManageUsersScreen` |
| `/manage-riders` | `ManageRidersScreen` |
| `/rider-history` | `RiderHistoryScreen` |
| `/change-password` | `ChangePasswordScreen` |
| `/forgot-password` | `ForgotPasswordScreen` |
| `/customer-tile-demo` | `CustomerTileDemoScreen` |

### 5.3 Mobile Services

#### `ApiService`

File: `mobile_app/lib/services/api_service.dart`

Main role:

- Central HTTP client for the mobile app.
- Handles auth headers.
- Handles token refresh through `refreshAccessToken`.
- Normalizes API responses and errors.
- Groups methods by backend module.

Major method groups:

- Auth:
  - login
  - Google login
  - guest login
  - register
  - verify email
  - forgot/reset password
  - change password
  - profile
  - delete account
  - push token registration
- Stores:
  - list stores
  - store details
  - store status messages
  - global delivery status
  - live promotions
  - customer flash message
  - app update status
- Orders:
  - admin orders
  - customer orders
  - order details
  - order creation
  - delivery fee config
  - update status
  - mark delivered
  - update payment status
- Rider:
  - profile
  - deliveries
  - wallet stats
  - financial history
  - close day
  - update location
  - location history
- Store owner:
  - store orders
  - financial history
- Wallet:
  - balance
  - transactions
  - auto recharge
  - top-up
  - payment methods
  - transfers
- Admin:
  - visitor stats
  - recent activity
  - sales summary
  - users
  - stores
  - wallets
  - inventory/store sales reports
  - rider assignment
  - grace alerts
- Offer campaigns:
  - get/create/update/delete store offer campaigns.

#### `RiderBackgroundTrackingService`

File: `mobile_app/lib/services/rider_background_tracking_service.dart`

Purpose:

- Keeps rider location tracking active for assigned deliveries.
- Stores tracking token and enabled state.
- Sends coordinates to backend.
- Throttles repeated location sends.
- Uses background location notification on Android.

#### `Notifier`

File: `mobile_app/lib/services/notifier.dart`

Purpose:

- Shared user feedback/snackbar helper.
- Sanitizes messages.
- Provides error/success/info-style messaging.

#### `ImageCacheService`

File: `mobile_app/lib/services/image_cache_service.dart`

Purpose:

- Lightweight image cache helper.

### 5.4 Mobile Providers

#### `AuthProvider`

File: `mobile_app/lib/providers/auth_provider.dart`

Responsibilities:

- Login/register/guest/Google login.
- Persist auth token, refresh token, and user.
- Auto-login/session restore.
- Token refresh integration with `ApiService`.
- Logout.
- User role helpers:
  - admin
  - rider
  - store owner
  - guest/customer
- Starts/stops rider background tracking based on rider session.

#### `CartProvider`

File: `mobile_app/lib/providers/cart_provider.dart`

Responsibilities:

- Maintains cart items.
- Persists cart to shared preferences.
- Restores cart on startup.
- Enforces product stock limits.
- Supports product variants.
- Computes total from `CartItem.unitPrice`.
- Uses promotional effective price when product/variant has active offer.

#### `WalletProvider`

File: `mobile_app/lib/providers/wallet_provider.dart`

Responsibilities:

- Wallet balance.
- Transaction loading and pagination.
- Transaction filtering.
- Cached wallet/transactions/payment methods.
- Auto-recharge settings.
- Wallet top-up.
- Saved card top-up.
- Payment method primary/delete operations.
- Send money.
- Sent and received transfer lists.
- Accept/reject/cancel transfers.

#### `NotificationProvider`

File: `mobile_app/lib/providers/notification_provider.dart`

Responsibilities:

- Socket.IO connection and event handling.
- Firebase Cloud Messaging integration.
- Local notification display.
- Notification bell state.
- Event listener registration for screens.
- Filters rider/user/admin notification targeting.
- Handles refresh-style events.

### 5.5 Mobile Models

| Model | File | Purpose |
| --- | --- | --- |
| `Product`, `ProductVariant` | `models/product.dart` | Product data, variants, promotional pricing, offer badges |
| `CartItem` | `models/cart_item.dart` | Cart line item and API serialization |
| `User` | `models/user.dart` | Authenticated user data |
| `WalletModel` | `models/wallet_model.dart` | Wallet balance and metadata |
| `WalletTransactionModel` | `models/transaction_model.dart` | Wallet transaction row |
| `WalletTransferModel` | `models/transfer_model.dart` | Wallet transfer state |
| `PaymentMethodModel` | `models/payment_method_model.dart` | Saved payment methods/cards |

### 5.6 Mobile Customer Modules

Main screens:

- `CustomerDashboardTestScreen`
- `CustomerTileDemoScreen`
- `HomeScreen`
- `StoreScreen`
- `CartScreen`
- `CheckoutScreen`
- `OrdersScreen`
- `OrderDetailsScreen`
- `WalletScreen`

Customer capabilities:

- Browse stores and categories.
- View customer dashboard tiles.
- View store detail and products.
- See product variants and promotional prices.
- Add products to cart.
- Check stock limits.
- Checkout with delivery address/time/payment method.
- Respect global delivery blocking and store open/closed state.
- Track order history.
- View order details.
- Manage wallet and transfers.
- Receive live notifications.
- Switch language preference with Urdu support in selected copy.

### 5.7 Mobile Authentication Modules

Screens:

- `SplashScreen`
- `LoginScreen`
- `RegisterScreen`
- `VerificationScreen`
- `ForgotPasswordScreen`
- `OtpResetVerificationScreen`
- `ResetPasswordScreen`
- `ChangePasswordScreen`

Capabilities:

- Login by email/password.
- Guest login.
- Google login support.
- Register account.
- Email verification OTP.
- Forgot password OTP.
- Reset password.
- Change password after login.
- Session guard redirects unauthenticated users back to login.

### 5.8 Mobile Rider Module

Screen:

- `RiderDashboardScreen`

Capabilities:

- Rider profile card.
- Assigned and completed delivery tabs.
- Wallet and daily delivery fee stats.
- Rider financial history.
- Current location and background tracking.
- Push current rider location.
- Contact customer by phone/SMS/WhatsApp.
- View order summary and item details.
- Mark payment received.
- Mark delivered after payment is paid.
- Receive socket/push notifications and refresh assignments.
- Assigned/completed orders are grouped by date and sorted newest first.

Related screen:

- `RiderHistoryScreen`

Rider history capabilities:

- Admin-facing route map review by date.
- Select rider and ride/order.
- Display route points using map dependencies.
- Combines order timing with rider location history.

### 5.9 Mobile Store Owner Module

Screen:

- `StoreOwnerDashboardScreen`

Capabilities:

- Store-owner dashboard.
- Store order tabs:
  - new orders
  - active orders
  - history
- Update order statuses.
- View store financial totals.
- Store status message controls.
- Navigate to manage products.
- Navigate to offer campaign management.
- Change password and logout.
- Notification bell integration.

Related screens:

- `ManageProductsScreen`
- `OfferCampaignsScreen`

### 5.10 Mobile Admin Module

Screen:

- `AdminDashboardScreen`

Capabilities:

- Admin dashboard tiles.
- Navigation to management screens.
- Offers management.
- Store balances.
- Rider history.
- Inventory report.
- Store/user/product/rider management.
- Wallet/admin report access.
- Notification bell integration.

Admin management screens:

- `ManageStoresScreen`
- `ManageProductsScreen`
- `ManageUsersScreen`
- `ManageRidersScreen`
- `InventoryReportScreen`
- `StoreBalancesScreen`
- `OfferCampaignsScreen`
- `RiderHistoryScreen`

### 5.11 Mobile Offer Campaign Module

Screen:

- `OfferCampaignsScreen`

Used by:

- Admin dashboard.
- Store owner dashboard.

Capabilities:

- Admin can choose store.
- Store owner uses own store.
- Create/update/delete campaigns.
- Campaign type:
  - discount
  - Buy X Get Y
- Scope:
  - all products
  - selected products
- Enable/disable campaign.
- Start and end date-time selection.
- Discount type:
  - percentage
  - fixed amount
- Buy/Get quantity fields.
- Product checklist when scope is selected products.
- Existing campaign cards with edit/delete actions.

### 5.12 Mobile Wallet Module

Screen:

- `WalletScreen`

Widgets:

- `WalletBalanceCard`
- `TopupForm`
- `AutoRechargeSettings`
- `PaymentMethodCard`
- `SendMoneyForm`
- `TransactionListItem`

Capabilities:

- Display wallet balance.
- Load and filter transactions.
- Top up wallet.
- Save cards.
- Manage saved cards.
- Auto-recharge settings.
- Send money.
- Sent transfers.
- Received transfers.
- Accept/reject/cancel transfer.

### 5.13 Mobile UI/Theme/Localization

Theme:

- `theme/customer_palette.dart`

Localization utility:

- `utils/customer_language.dart`

Notes:

- The app uses a warm customer palette.
- Urdu translations exist for many common labels.
- Directionality is applied based on language setting in several screens.
- Shared snackbars use `Notifier`.

## 6. Web vs Mobile Comparison

| Domain | Current Web | `/next` Web | Mobile |
| --- | --- | --- | --- |
| Customer store browsing | Yes | Yes | Yes |
| Product offers display | Yes | Yes | Yes |
| Cart | Yes | Yes | Yes |
| Checkout | Yes | Yes | Yes |
| Orders | Yes | Yes | Yes |
| Wallet | Yes | Yes | Yes |
| Rider dashboard | Yes | Yes | Yes |
| Rider background tracking | Browser foreground/geolocation | Basic location push | Full mobile/background tracking |
| Store owner dashboard | Partial/current backend-supported | Yes | Yes |
| Admin dashboard | Very extensive | Lightweight alternative | Mobile admin hub |
| Financial module | Extensive web admin | Summary/alternative views | Selected admin/store/rider views |
| Offer campaigns | Full admin web controls | Store-owner campaign data loaded | Full admin/store-owner mobile screen |
| Permissions management | Extensive web admin | Overview | Mostly role-based routing |
| Notifications | Socket.IO web bell | Not full bell equivalent | Socket.IO + Firebase + local notifications |

## 7. Key Data Flows

### 7.1 Customer Order Flow

1. Customer logs in or uses guest browsing.
2. Customer loads stores from `/api/stores`.
3. Customer opens store detail from `/api/stores/:id`.
4. Backend enriches products with active offer pricing.
5. Customer adds product/variant to cart.
6. Checkout loads delivery fee config and global delivery status.
7. Customer creates order through `/api/orders`.
8. Backend creates order and order items.
9. Notifications can be emitted to admins/store/rider/customer.
10. Customer tracks order through orders screen.

### 7.2 Rider Delivery Flow

1. Rider logs in.
2. App loads rider profile and deliveries.
3. Active deliveries trigger location tracking.
4. Rider location is sent to backend.
5. Rider contacts customer if needed.
6. Rider marks payment received.
7. Rider marks order delivered.
8. Wallet/financial stats refresh.

### 7.3 Store Owner Flow

1. Store owner logs in.
2. Dashboard loads store orders and stats.
3. Store owner updates order statuses.
4. Store owner manages store status and products.
5. Store owner manages offer campaigns.
6. Store financial history is available through backend endpoints.

### 7.4 Admin Flow

1. Admin logs in.
2. Admin dashboard loads stats and recent activity.
3. Admin manages operational entities:
   - users
   - riders
   - stores
   - products
   - catalog
   - orders
4. Admin assigns riders and updates statuses.
5. Admin reviews payments, wallets, reports, and financial records.
6. Admin controls permissions and system utilities.

### 7.5 Offer Campaign Pricing Flow

1. Admin/store owner creates campaign.
2. Campaign is stored in `store_offer_campaigns`.
3. Selected products are stored in `store_offer_campaign_products`.
4. Product/store APIs load active campaigns.
5. Backend filters campaigns by store, time, enabled state, and product scope.
6. Backend computes promotional price and badge.
7. Web/mobile clients display promotional price.
8. Cart uses effective price when adding items.

## 8. Operational Notes

### 8.1 Environment

The backend depends on `.env` values for:

- Database host/user/password/name/port.
- JWT secret.
- Port.
- CORS origins in production.
- Payment/push/email credentials where configured.

### 8.2 Database

The project includes:

- `database/schema.sql`
- database backups
- many root-level check/debug/fix scripts

Some backend modules auto-create or patch required columns/tables at runtime, especially operational features such as offer campaigns, rider logs, financial tables, and supporting metadata.

### 8.3 Assets

Static and uploaded assets are split:

- `images/`: brand and bundled static images.
- `uploads/`: runtime uploaded store/product/rider images.
- `mobile_app/assets/`: packaged Flutter assets.

### 8.4 Notifications

There are three notification paths:

- Web Socket.IO events and web bell.
- Mobile Socket.IO events.
- Mobile Firebase Cloud Messaging/local notifications.

### 8.5 Security and Roles

Roles used across the project include:

- customer
- guest/customer-like user
- rider
- store_owner
- admin
- standard/staff-like user in some admin paths

Permissions in the web admin can hide or restrict features beyond simple role checks.

## 9. Suggested Reading Order For Future Developers

1. `server.js`
2. `middleware/auth.js`
3. `routes/auth.js`
4. `routes/orders.js`
5. `routes/stores.js`
6. `routes/products.js`
7. `utils/offerCampaigns.js`
8. `js/admin.js`
9. `js/app.js`
10. `webapp_v2/assets/app.js`
11. `mobile_app/lib/main.dart`
12. `mobile_app/lib/services/api_service.dart`
13. `mobile_app/lib/providers/auth_provider.dart`
14. `mobile_app/lib/providers/notification_provider.dart`
15. Role-specific Flutter screens:
    - `customer_dashboard_test_screen.dart`
    - `rider_dashboard_screen.dart`
    - `store_owner_dashboard_screen.dart`
    - `admin_dashboard_screen.dart`

## 10. Module Summary

ServeNow currently has broad feature coverage across web and mobile. The backend is the system center, with both web clients and the Flutter app calling the same API. The current web app contains the deepest admin/financial surface. The mobile app provides more complete role-based operational workflows for customer, rider, store owner, and admin usage, especially notifications and rider tracking. The `/next` web app is an alternative SPA that reuses the live backend while staying isolated from the current web app.

