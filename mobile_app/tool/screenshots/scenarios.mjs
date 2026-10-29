// Roles and screen scenarios for capture.mjs.
//
// ROLES[name].user is the identity baked into a locally signed JWT (no login,
// no password is used or changed). `prefs` are extra shared_preferences values
// seeded before the app starts (written to localStorage as "flutter.<key>" =
// JSON-encoded value, which is how shared_preferences_web stores them).
//
// The seeded session mirrors what AuthProvider.login() persists:
//   token (String), user (String: jsonEncode(User.toJson())). No refresh_token.
// `cart: { storeId, count }` seeds cart_items_v1 from live GET /api/stores/:id.
//
// IDs below exist in servenow_local (copy of production). Change them here if
// the data set changes.

const EN = { customer_dashboard_language: 'en', customer_dashboard_language_initialized: true };
const URDU = { customer_dashboard_language: 'ur', customer_dashboard_language_initialized: true };
const GUEST = { id: 900000001, email: 'guest-900000001@guest.servenow.local', user_type: 'guest', first_name: 'Guest', last_name: 'User' };
const CUSTOMER = { id: 484, email: 'taishataisha1234@gmail.com', user_type: 'customer', first_name: 'Tehreem', last_name: 'Ayesha' };
const CART = { storeId: 71, count: 2 };

export const ROLES = {
  guest_anon: { user: null, prefs: { ...EN } },
  guest_anon_ur: { user: null, prefs: { ...URDU } },
  // Same token shape /api/auth/guest-login issues, but signed locally so no login_logs row is written.
  guest: { user: GUEST, prefs: { ...EN } },
  guest_cart: { user: GUEST, prefs: { ...EN }, cart: CART },
  customer: { user: CUSTOMER, prefs: { ...EN }, cart: CART },
  customer_ur: { user: CUSTOMER, prefs: { ...URDU }, cart: CART },
  // riders table id 3 (riders are a separate table; user_type 'rider')
  rider: { user: { id: 3, email: 'faizanaziz@servenow.pk', user_type: 'rider', first_name: 'Faizan Aziz', last_name: '' }, prefs: { ...EN } },
  // users.id 410 -> store_id 71 (Imran Broast), the store owner with the most order items
  store_owner: { user: { id: 410, email: 'imranbroast@servenow.pk', user_type: 'store_owner', first_name: 'Imran', last_name: 'Broast' }, prefs: { ...EN } },
  // users.id 1, on the hard-coded allowlist, so the restricted admin sections are visible
  admin: { user: { id: 1, email: 'admin@servenow.com', user_type: 'admin', first_name: 'Admin', last_name: 'User' }, prefs: { ...EN } },
};

// ---------------------------------------------------------------------------
// Each scenario: { name, session?, steps?, expect?, wait?, bootWait?, raw?, mock? }
//  - expect: a label that must be visible at the end, otherwise the scenario fails
//  - output file: <out>/<role>/<name>.png; session defaults to the role key
//  - every scenario starts from a fresh app load with that session
//  - mock: canned JSON for write endpoints ("POST /api/...") so screens behind
//    them can be reached; all other writes are blocked by capture.mjs
// Steps: see runSteps() in capture.mjs.
//
// Coordinates (CSS px in the 390x844 viewport) are used only where the widget
// has no semantics label (customer dashboard hamburger, top-bar cart and its
// custom bottom nav). Update them if the redesign moves those widgets.
const DASH_MENU = 'xy:28,48';
const DASH_CART = 'xy:357,48';
const DASH_STORES_TAB = 'xy:149,815';
const DASH_ORDERS_TAB = 'xy:241,815';
// The auto-scrolling Featured carousel also contains store names, so a store is opened by
// searching for it and tapping the single remaining "View" button (works in EN and UR).
const OPEN_STORE = ['xy:195,470', 'type:Imran', 'wait:1000', 'tapx:View'];
// Urdu is RTL: the dashboard top bar and bottom nav are mirrored.
const UR_MENU = 'xy:362,48';
const UR_CART = 'xy:33,48';
const UR_ORDERS_TAB = 'xy:149,815';
const OK_MOCK = { success: true, message: 'ok (mocked by screenshot tool)' };

// Urdu labels (from lib/utils/customer_language.dart) for taps in customer_ur
const UR = {
  checkout: 'چیک آؤٹ پر جائیں',
  viewDetails: 'تفصیل دیکھیں',
  changePassword: 'پاس ورڈ تبدیل کریں',
};

export const SCENARIOS = {};

SCENARIOS.guest = [
  { name: '01_splash', session: 'customer', raw: true, bootWait: 0, wait: 0 },
  { name: '02_login', session: 'guest_anon' },
  { name: '03_login_language_sheet', session: 'guest_anon', steps: ['tapx:EN'] },
  { name: '04_login_validation_errors', session: 'guest_anon', steps: ['tapx:LOGIN'] },
  { name: '05_register', session: 'guest_anon', steps: ['tap:Register Here'] },
  { name: '06_register_scrolled', session: 'guest_anon', steps: ['tap:Register Here', 'scroll:700'] },
  { name: '07_register_dob_picker', session: 'guest_anon', steps: ['tap:Register Here', 'tap:Date of Birth'] },
  { name: '08_verify_email', session: 'guest_anon',
    mock: { 'POST /api/auth/register': { success: true, requires_verification: true, message: 'Verification code sent' } },
    steps: ['tap:Register Here', 'tap:Full Name', 'type:Demo Customer', 'tap:Email Address', 'type:demo.customer@example.com',
      'tap:Password', 'type:Demo12345!', 'tap:Date of Birth', 'tap?:Select', 'tap:Phone Number', 'type:001234567',
      'tap:Address', 'type:Kot Addu', 'tapx:Register'] },
  { name: '09_forgot_password', session: 'guest_anon', steps: ['tap:Forgot Password?'] },
  { name: '10_reset_otp', session: 'guest_anon',
    mock: { 'POST /api/auth/forgot-password': OK_MOCK },
    steps: ['tap:Forgot Password?', 'tap:Email', 'type:demo.customer@example.com', 'tap:SEND CODE'] },
  { name: '11_reset_password', session: 'guest_anon',
    mock: { 'POST /api/auth/forgot-password': OK_MOCK, 'POST /api/auth/verify-reset-otp': { success: true, reset_token: 'mock-token' } },
    steps: ['tap:Forgot Password?', 'tap:Email', 'type:demo.customer@example.com', 'tap:SEND CODE', 'wait:1500',
      'tap:000000', 'type:123456', 'tap:VERIFY OTP'] },
  { name: '12_guest_home' },
  { name: '13_guest_menu', steps: [DASH_MENU] },
  { name: '14_guest_store', steps: [...OPEN_STORE], expect: 'Store Details' },
  { name: '15_guest_cart', session: 'guest_cart', steps: [DASH_CART] },
  { name: '16_guest_register_required', session: 'guest_cart', steps: [DASH_CART, 'tap:Proceed to Checkout'] },
  { name: '17_guest_orders', steps: [DASH_ORDERS_TAB] },
];

SCENARIOS.customer = [
  { name: '01_home', wait: 3500 },
  { name: '02_home_scrolled', steps: ['scroll:900'] },
  { name: '03_quick_actions_menu', steps: [DASH_MENU] },
  { name: '04_language_sheet', steps: ['tapx:EN'] },
  { name: '05_contact_us', steps: ['tapx:Contact Us'] },
  { name: '06_notifications', steps: ['tapx:Notifications'] },
  { name: '07_stores_tab_noop', steps: [DASH_STORES_TAB] },
  { name: '08_search_stores', steps: ['tap:Search store by name or area', 'type:broast', 'wait:800'] },
  { name: '09_store', steps: [...OPEN_STORE], expect: 'Store Details' },
  { name: '10_store_products', steps: [...OPEN_STORE, 'scroll:700'], expect: 'Store Details' },
  { name: '11_product_detail', steps: [...OPEN_STORE, 'tap:Chicken Chest Broast'], expect: 'Add to Cart', wait: 6000 },
  { name: '12_product_detail_scrolled', steps: [...OPEN_STORE, 'tap:Chicken Chest Broast', 'wait:4000', 'scroll:600'] },
  { name: '13_cart', steps: [DASH_CART] },
  { name: '14_clear_cart_dialog', steps: [DASH_CART, 'xy:357,28'] },
  { name: '15_checkout', steps: [DASH_CART, 'tap:Proceed to Checkout'] },
  { name: '16_checkout_payment', steps: [DASH_CART, 'tap:Proceed to Checkout', 'scroll:700'] },
  { name: '17_orders', steps: [DASH_ORDERS_TAB] },
  { name: '18_orders_history_filter', steps: [DASH_ORDERS_TAB, 'tapx:History'] },
  { name: '19_order_details', steps: ['tap:My Orders', 'tapx:View details'] },
  { name: '20_order_details_actions', steps: ['tap:My Orders', 'tapx:View details', 'scroll:800'] },
  { name: '21_track_order', steps: ['tap:My Orders', 'tapx:View details', 'tap:Track Order'] },
  { name: '22_order_contact_support', steps: ['tap:My Orders', 'tapx:View details', 'tap:Contact Support'] },
  { name: '23_change_password', steps: [DASH_MENU, 'tap:Change Password'] },
];

SCENARIOS.customer_ur = [
  { name: '01_home', wait: 3500 },
  { name: '02_home_scrolled', steps: ['scroll:900'] },
  { name: '03_quick_actions_menu', steps: [UR_MENU] },
  { name: '04_language_sheet', steps: ['tapx:اردو'] },
  { name: '05_login_urdu', session: 'guest_anon_ur' },
  { name: '06_store', steps: [...OPEN_STORE] },
  { name: '07_product_detail', steps: [...OPEN_STORE, 'tap:Chicken Chest Broast'], wait: 6000 },
  { name: '08_cart', steps: [UR_CART] },
  { name: '09_checkout', steps: [UR_CART, `tap:${UR.checkout}`] },
  { name: '10_checkout_payment', steps: [UR_CART, `tap:${UR.checkout}`, 'scroll:700'] },
  { name: '11_orders', steps: [UR_ORDERS_TAB] },
  { name: '12_order_details', steps: [UR_ORDERS_TAB, `tapx:${UR.viewDetails}`] },
  { name: '13_change_password_not_translated', steps: [UR_MENU, `tap:${UR.changePassword}`] },
];

SCENARIOS.rider = [
  { name: '01_home_assigned', wait: 3500 },
  { name: '02_order_summary_dialog', steps: ['tapx:Summary', 'until:Pricing Breakdown'] },
  { name: '03_drawer', steps: ['tap:Open navigation menu'] },
  { name: '04_history', steps: ['tapl:History'] },
  { name: '05_wallet', steps: ['tapl:Wallet'] },
  { name: '06_wallet_scrolled', steps: ['tapl:Wallet', 'scroll:800'] },
  { name: '07_wallet_scrolled_more', steps: ['tapl:Wallet', 'scroll:800', 'scroll:900'] },
  { name: '08_return_cash_dialog', steps: ['tapl:Wallet', 'tap:Return Cash to Admin'] },
  { name: '09_profile', steps: ['tapl:Profile'] },
  { name: '10_day_transactions', steps: ['tap:Open navigation menu', 'tap:Day Transactions'] },
  { name: '11_day_transactions_scrolled', steps: ['tap:Open navigation menu', 'tap:Day Transactions', 'scroll:800'] },
  { name: '12_notifications', steps: ['tapx:Notifications'] },
  { name: '13_change_password', steps: ['tap:Open navigation menu', 'tap:Change Password'] },
];

SCENARIOS.store_owner = [
  { name: '01_dashboard_new_orders', wait: 3500 },
  { name: '02_active_orders', steps: ['tapx:Active'] },
  { name: '03_history_orders', steps: ['tapx:History'] },
  { name: '04_products_price_update', steps: ['tapx:Products'] },
  { name: '05_products_expanded', steps: ['tapx:Products', 'wait:1500', 'tap:Imran Broast'] },
  { name: '05b_edit_price_sheet', steps: ['tapx:Products', 'wait:1500', 'tap:Imran Broast', 'tap:Edit'] },
  { name: '06_offer_campaigns', steps: ['tapx:Offers'] },
  { name: '07_offer_campaigns_scrolled', steps: ['tapx:Offers', 'scroll:900'] },
  { name: '08_store_status_dialog', steps: ['tapx:Status'] },
  { name: '09_financial_history', steps: ['tapx:Financial'] },
  { name: '09b_financial_history_result', steps: ['tapx:Financial', 'tapx:OK', 'wait:800', 'tapx:OK', 'wait:2500'] },
  { name: '10_notifications', steps: ['tapx:Notifications'] },
  { name: '11_change_password', steps: ['tapx:Password'] },
];

SCENARIOS.admin = [
  { name: '01_dashboard', wait: 4500 },
  { name: '02_dashboard_recent_activity', steps: ['scroll:700'] },
  { name: '03_order_assignment_dialog', steps: ['scroll:700', 'tap:Order Ord'] },
  { name: '04_daily_sales_tab', steps: ['tap:Daily Sales & Closing', 'wait:1500'] },
  { name: '05_daily_sales_scrolled', steps: ['tap:Daily Sales & Closing', 'wait:1500', 'scroll:700'] },
  { name: '06_admin_tools_tab', steps: ['tap:Admin Tools', 'wait:1000'] },
  { name: '07_admin_tools_scrolled', steps: ['tap:Admin Tools', 'wait:1000', 'scroll:800'] },
  { name: '08_drawer', steps: ['tap:Open navigation menu'] },
  { name: '09_drawer_scrolled', steps: ['tap:Open navigation menu', 'scroll:600'] },
  { name: '10_full_live_tracker', steps: ['tap:Full Tracker'] },
  { name: '11_manage_stores', steps: ['tap:Manage Stores'] },
  { name: '12_manage_riders', steps: ['tap:Manage Riders'] },
  { name: '13_offer_campaigns', steps: ['tap:Offer Campaigns'] },
  { name: '14_store_balances', steps: ['tap:Store Balances', 'until:Net Sales'], wait: 2500 },
  { name: '15_manage_products', steps: ['tapx:Products'] },
  { name: '16_manage_orders', steps: ['tapx:Orders'] },
  { name: '17_rider_day_transactions', steps: ['tapx:Rider Day'] },
  { name: '18_inventory_report', steps: ['tapx:Inventory'] },
  { name: '19_store_status_dialog', steps: ['tapx:Status'] },
  { name: '20_manage_users', steps: ['tap:Open navigation menu', 'tap:Manage Users'] },
  { name: '21_wallet_item_opens_legacy_home', steps: ['tap:Open navigation menu', 'tapx:Wallet'] },
  { name: '22_ride_history', steps: ['tap:Open navigation menu', 'scroll:600', 'tap:Ride History'] },
  { name: '23_customer_tile_demo', steps: ['tap:Open navigation menu', 'tap:Customer Tile Demo'] },
  { name: '24_customer_tile_demo_store', steps: ['tap:Open navigation menu', 'tap:Customer Tile Demo', 'wait:1500', 'tap:Imran Broast'] },
  { name: '25_role_customer_view', steps: ['tapx:Customer'] },
  { name: '26_role_store_owner_view', steps: ['tapx:Store Owner'] },
  { name: '27_role_rider_view', steps: ['tapx:Rider'] },
  { name: '28_notifications', steps: ['tapx:Notifications'] },
  { name: '29_change_password', steps: ['tap:Open navigation menu', 'scroll:600', 'tap:Change Password'] },
];
