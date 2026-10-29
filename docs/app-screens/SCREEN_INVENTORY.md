# ServeNow mobile app: screen inventory ("before" redesign)

This inventory covers every file in `mobile_app/lib/screens/` (31 files): who uses it, how it is reached, what it does, its main actions, and the UX problems visible in the screenshots or the code.

- **Source.** Notes come from reading the code at branch `28Oct2026Security`, commit `ca99256`.
- **Screenshots.** They are in `docs/app-screens/before/<role>/NN_<screen>.png`, taken at 390x844 @2x on a Flutter web build against `servenow_local`. A file reference like `customer/13` means `before/customer/13_*.png`.
- **Regenerating.** Use `mobile_app/tool/screenshots/` (see its README).

## How routing works (lib/main.dart)

- **Start-up.** `MaterialApp.home` is `AuthWrapper`. It shows `SplashScreen` while it runs `tryAutoLogin()`, then sends each user to a home route:

  | User | Route |
  |---|---|
  | `admin` / `standard_user` | `/admin` |
  | `rider` | `/rider` |
  | `store_owner` | `/store_owner` |
  | everyone else (customer, guest) | `/home` |
  | no token | `/login` |

- **`/home` is `CustomerDashboardTestScreen`.** The "test" dashboard is the production customer and guest home. `/customer-test-dashboard` is a second route to the same class, and nothing navigates to it.
- **`/wallet` is the legacy `HomeScreen`, not `WalletScreen`.** It is commented "Redirect to home". Only the admin drawer item "Wallet" navigates there.
- **Routes have no role guard.** The admin "role ribbon" opens the Customer, Store Owner and Rider dashboards while still using the admin token.
- **Overlays on every screen:**
  - a version badge `v1.2.2+42` at bottom-right
  - an app-update banner and a once-a-day dialog
  - a session guard that sends the user to `/login` with "Session expired. Please log in again."
- **Restricted admin features** are gated on a hard-coded email allowlist (`admin@servenow.com`, `nazir@servenow.pk`) in `admin_dashboard_screen.dart`. They are:
  - Daily Sales
  - Rider Day
  - Live Rider Tracker
  - Reset terminal orders
- **Urdu toggle** (`lib/utils/customer_language.dart`):
  - Stored in shared_preferences as `customer_dashboard_language` (`'en'` or `'ur'`), plus `customer_dashboard_language_initialized` (true).
  - The toggle appears in only two places: the `EN`/`UR` pill on Login, and the `EN`/`اردو` button on the customer dashboard top bar.
  - Each screen reads the setting once in `initState`. Strings missing from the ~200-entry map stay in English.

---

## 1. Customer and guest screens

### customer_dashboard_test_screen.dart: `CustomerDashboardTestScreen`, the production customer home

| | |
|---|---|
| **Route** | `/home` (and the unused alias `/customer-test-dashboard`) |
| **Roles** | customer, guest; admin via the role ribbon "Customer" |
| **Reached by** | landing after login, guest login or registration; Home on the Cart/Orders bottom nav |
| **Shots** | `customer/01–08`, `guest/12–13`, `customer_ur/01–04`, `admin/25` |

**What it does.** A location-aware store browser in one scrolling column:

- hero card: "Welcome, <name>", "N Stores", city pill
- "Featured" auto-scrolling banner carousel of stores and promotions
- category strip
- search "Search store by name or area"
- "Popular Stores" grid in 2 columns; each card has OPEN/CLOSED and "View", and opens StoreScreen

It polls global status every 5 s. It shows the update, delivery-pause and out-of-delivery-area banners, plus a once-per-message "ServeNow Flash Message" dialog.

**Actions:**

- **Top bar:**
  - hamburger, which opens the Quick Actions sheet: "My Orders", "My Cart", "Change Password", "Contact Us", "Logout"
  - language `EN`/`اردو`
  - bell
  - cart with badge
- **Hero:** "My Orders", "Contact Us" (Call / WhatsApp / Email sheet)
- **Bottom nav:**

  | Item | What it does |
  |---|---|
  | Home | sets the index only |
  | **Stores** | **does nothing** (`customer/07`) |
  | Orders | pushes `/orders` |
  | Cart | pushes `/cart` |

**UX problems:**

- **Naming.** "Test" is in the class and file names of the live screen.
- **Broken or stale navigation.**
  - The Stores tab is a no-op.
  - The bottom-nav highlight stays on Orders or Cart after returning, because `_bottomIndex` is never reset.
  - The hamburger, top-bar cart and the whole custom bottom nav have **no accessibility labels**, so screen readers cannot use them. The screenshot tool has to tap these by coordinates.
- **Version badge.** The `v1.2.2+42` badge sits on top of the "Cart" label in the bottom nav, on every customer screen (`customer/01`).
- **Redundant, inconsistent cart counters.** Three counters appear at once: the top-bar badge, a pink "2" pill in the hero card, and the bottom-nav badge. All show the number of lines (2), while the cart holds 3 items. The top-bar badge is also clipped by the edge of its button.
- **Featured banner.**
  - White store names sit directly on busy logo artwork with only a weak gradient, which is hard to read (`customer/01`, `03`).
  - Logos are cropped ("&MORE", "Manpassand" cut off).
- **Store cards.**
  - Fixed height with a large empty white area under the name.
  - Logo images are top-cropped, and the "OPEN" pill covers the logo.
  - Delivery-time chips repeat units ("30 minute min", "35 Minute  min") and are truncated ("45-50 Minutes …").
  - Cards whose image is still loading are blank white for several seconds (`customer/02`).
- **Data and states.**
  - The location pill says "Home" instead of the area.
  - Searching keeps the heading "Popular Stores" (no "Results for ...").
  - Errors are shown as the raw `Error: <exception>` with no retry.
  - It keeps its own translation map that duplicates `CustomerLanguage`.
- **Styling.** Many hard-coded colours (backdrop orbs, badges).
- **Urdu (`customer_ur/01-03`).**
  - "Featured", "Fresh offers...", "Popular Stores", "Tap any store...", "Groceries, food & more" and "View" stay in English.
  - Delivery chips are garbled by mixed bidi ("minute min 30").
  - The Quick Actions sheet is not mirrored: icons stay on the left and the Urdu text sits left-aligned.
- **Support contact.** The contact sheet shows a personal Gmail address (`jeero.sahib@gmail.com`) as ServeNow support. Its design also differs from the "Contact Support" sheet on Order Details (coloured round icons vs plain icons).

### home_screen.dart: `HomeScreen` (legacy customer home)

| | |
|---|---|
| **Route** | `/wallet` (the name does not match the content) |
| **Role** | admin only, in practice; drawer item **"Wallet"** (`admin/21`). No customer path reaches it. |

**What it does.** The older customer home: AppBar "ServeNow", a store grid, the support sheet, and a guest prompt "Register to Order".

**Actions.** AppBar: bell, cart, "My Orders", "Contact Us", logout.

**UX problems:**

- The "Browse Stores" heading wraps onto two lines in a narrow column (`admin/21`).
- It is dead for customers.
- Admins reach it through a mislabelled "Wallet" item.
- Five AppBar actions plus a title on a phone.
- Hard-coded pastel colours that are off-palette.
- No Urdu.

### store_screen.dart: `StoreScreen(storeId)`

| | |
|---|---|
| **Route** | none |
| **Roles** | customer, guest |
| **Reached by** | a store card or "View" on the dashboard (or HomeScreen) |
| **Shots** | `customer/09–10`, `guest/14`, `customer_ur/06` |

**What it does.**

- AppBar "Store Details" with a cart icon.
- Header card: banner image, OPEN/CLOSED strip, name, location, open/close times, rating.
- "Active Store Promotions".
- "Products" grid. Each card has an "Options", "Add", "Select", "Unavailable", "Outside Hours" or "Out of stock" button. Tapping it opens ProductDetail.

**UX problems:**

- **Product cards show no price.** Every card says "1 Options" with an "Options" button. Users must open each product to see what it costs (`customer/09`).
- "1 Options" is grammatically wrong.
- The store banner image is cropped (the logo's text is cut off at the bottom).
- Product images load late and show as **plain white boxes with no placeholder or shimmer** (`customer/10`).
- The "OPEN" strip uses the 🟢 emoji.
- There is no empty state when a store has no products.
- The background is `#FFF6EC` instead of the palette's `#FFF4EA`.

### product_detail_screen.dart: `ProductDetailScreen`

| | |
|---|---|
| **Route** | none |
| **Roles** | customer, guest |
| **Reached by** | tapping a product in StoreScreen, or a "Related Items" card (it pushes itself) |
| **Shots** | `customer/11–12`, `customer_ur/07` |

**What it does.**

- Product image, "In Stock (2000)", price, "Description".
- "Select Variant / Size" chips, "Quantity" stepper.
- "Related Items" horizontal list.
- Bottom bar: "Total" and **"Add to Cart"**.

**UX problems:**

- **Blank image.** The large image area is a blank white box until the image arrives, with no placeholder (seen on first load).
- **Duplicated title.** The product name appears twice: in the AppBar and as the heading.
- **Stock count exposed.** Customers see the raw count "In Stock (2000)". 2000 looks like a default value rather than real stock.
- **Prices hidden.** Related Items prices are clipped behind the sticky "Total / Add to Cart" bar (`customer/12`).
- **Urdu.** "Quantity", "Outside Hours" and the product description stay in English. The description's punctuation flips in RTL ("!flavor", `customer_ur/07`).
- Hard-coded colours.

### cart_screen.dart: `CartScreen`

| | |
|---|---|
| **Route** | `/cart` |
| **Roles** | customer, guest |
| **Reached by** | dashboard cart icon, bottom "Cart", menu "My Cart" |
| **Shots** | `customer/13–14`, `guest/15–16`, `customer_ur/08` |

**What it does.**

- Items grouped by store, with − / + steppers.
- "Total PKR …", "Total Stores", "Total Products".
- **"Proceed to Checkout"**.
- AppBar delete icon, which opens "Clear Cart?" with "No" / "Yes".
- For guests, checkout opens the "Register Required" dialog with "Later" / "Register".

**UX problems:**

- Line price shows `1Piece • PKR 840.00`: there is no space in "1Piece", and the line total is shown where a unit price is expected.
- The "Clear Cart?" dialog's "No" and "Yes" buttons look identical; the destructive choice is not highlighted (`customer/14`).
- The bottom nav "Stores" goes to `/home`, the same as "Home".
- Navigation uses `pushReplacement`, so Back does not return to the store.
- The version badge overlaps the active "Cart" label.

### checkout_screen.dart: `CheckoutScreen`

| | |
|---|---|
| **Route** | `/checkout` |
| **Role** | customer (guests are blocked) |
| **Reached by** | Cart, then "Proceed to Checkout" |
| **Shots** | `customer/15–16`, `customer_ur/09–10` |

**What it does.**

- "Order Summary" per store: Subtotal, Delivery Fee, Grand Total.
- "Delivery Details": Full Name, Phone Number, Delivery Address, Preferred Delivery Time, Special Instructions.
- "Payment Method": Cash on Delivery, Credit/Debit Card, Wallet.
- **"Place Order"**. On success it goes to `/orders`.

**UX problems:**

- "Credit/Debit Card" is offered, but there is no card-entry UI in this screen.
- **No balance on Wallet.** The Wallet option shows no balance.
- **Button below the fold.** "Place Order" starts below the fold.
- **Grammar.** "Delivery Fee (1 Stores)".
- **Low contrast.** The delivery-fee row is light grey and hard to read.
- **Nested cards.** Cards sit inside a card, wasting width.
- **Inconsistent AppBar.** It is light here and on Cart and Store, but solid orange on Orders and Change Password.
- **Phone format.** The phone is prefilled as `0336...`, while Register forces `+923...`.
- **Code leftovers.** `debugPrint` calls remain in the code.
- **Guest notice colours.** It uses raw `Colors.orange.*`.
- **What works.** Name, phone and address are prefilled from the profile.

### orders_screen.dart: `OrdersScreen`

| | |
|---|---|
| **Route** | `/orders` |
| **Role** | customer (guests get a message) |
| **Reached by** | bottom "Orders", hero or menu "My Orders", after checkout |
| **Shots** | `customer/17–18`, `guest/17`, `customer_ur/11` |

**What it does.**

- AppBar "My Orders" with bell and refresh.
- Summary card: Total, Active, Completed.
- Filter chips: All, Active, History.
- Order cards: number, date, status, Subtotal, Delivery, Grand Total, Address, Stores, Payment. **"View details"** opens the details screen.

**UX problems:**

- **Guests see an error screen**: a red ⚠ icon, "Failed to load orders" and a **Retry** button, for what is really "please register" (`guest/17`). The empty state should offer "Register".
- Card titles read "Orders #Ord2610280020" ("Orders" plus a number that already contains "Ord").
- Payment shows the raw value "cash".
- The check mark on the selected filter chip is dark on dark brown and almost invisible.
- Status colours are raw Material colours (orange, indigo, teal, green).
- Each order card is very tall (about 2 per screen).

### order_details_screen.dart: `OrderDetailsScreen`

| | |
|---|---|
| **Route** | none |
| **Role** | customer |
| **Reached by** | Orders, then "View details" |
| **Shots** | `customer/19–22`, `customer_ur/12` |

**What it does.**

- Status pill.
- "Order Summary" lines, Subtotal, Delivery Fee, Total.
- "Delivery Information": Order, Preferred Time, Address, Instructions, Rider Location.
- Buttons **"Track Order"** (status dialog), **"Cancel Order"** and **"Contact Support"** (Call / WhatsApp / Email).

**UX problems:**

- **Wasted space.** A large brand-logo header takes the top third of the screen (`customer/19`).
- **Cancel Order.** It is rendered as faded grey text with no explanation when cancelling is not allowed (out-for-delivery order, `customer/20`).
- **Raw values.**
  - "Preferred Time" shows the raw value `asap`.
  - The address is repeated, once in the info rows and again in a map-style card that has no map.
- **Track Order.** It is a text sheet with no map. "Rider Location: Live rider location is not available yet." appears even for an out-for-delivery order. "Last Updated" is a raw `2026-10-28 20:40:14` timestamp (`customer/21`).
- **Urdu (`customer_ur/12`).**
  - "Order Details", "Delivery Information", the status and the labels stay in English.
  - Item lines are bidi-garbled ("x Chicken Karahi (250 1 / Grams)").
  - Colons are misplaced (":Order").
- The "WhatsApp" label is hard-coded in English.
- Hard-coded colours.

### change_password_screen.dart: `ChangePasswordScreen`

| | |
|---|---|
| **Route** | `/change-password` |
| **Roles** | customer, rider, store_owner, admin |
| **Reached by** | customer menu, rider drawer, store-owner bottom "Password", admin drawer |
| **Shots** | `customer/23`, `customer_ur/13`, `rider/13`, `store_owner/11`, `admin/29` |

**What it does.** Current Password, New Password and Confirm New Password fields, with an **"Update Password"** button.

**UX problems:**

- **No Urdu.** The screen is English even when the customer chose Urdu (`customer_ur/13`).
- A bare form with no guidance on password rules.
- There are no field icons or show-password toggles, unlike Login and Reset Password.

---

## 2. Authentication screens (guest / not signed in)

### splash_screen.dart: `SplashScreen`

| | |
|---|---|
| **Route** | `MaterialApp.home` via `AuthWrapper` |
| **Role** | everyone, at start-up |
| **Shot** | `guest/01` |

**What it does.** A peach gradient with the brand logo while auto-login runs.

**UX problems.** The first frames (`guest/01`) are an **empty gradient with two blobs**: the logo image loads after the background. On a slow network the user sees a blank screen.

### login_screen.dart: `LoginScreen`

| | |
|---|---|
| **Route** | `/login` |
| **Role** | not signed in |
| **Shots** | `guest/02–04`, `customer_ur/05` (Urdu) |

**What it does.**

- Orange hero with logo and an `EN`/`UR` language pill.
- "Welcome Back" / "Sign in to continue".
- Email and Password fields.
- "Forgot Password?" link.
- **LOGIN** button.
- **"Continue as Guest"**, which calls `POST /api/auth/guest-login`.
- "Or continue with" and a Google "G" button.
- "Don't have an account? **Register Here**".

**UX problems:**

- "Continue as Guest", "Or continue with", "Select Language", "English" and "Urdu" are not translated.
- The language sheet's "Selected" is in English.
- **The Google button does not work on web** ("available only on Android/iPhone builds").
- The Google button is a lone "G" with no label.

### register_screen.dart: `RegisterScreen`

| | |
|---|---|
| **Route** | `/register` |
| **Role** | guest / new user |
| **Reached by** | Login "Register Here"; the "Register" button in guest dialogs |
| **Shots** | `guest/05–07` |

**What it does.**

- "Register for ServeNow" form: Full Name, Email Address, Password, Date of Birth (date picker), Phone Number (pre-filled `+923`), Address.
- **"Register"** button and "Already have an account? Login here".
- When verification is required it goes to VerificationScreen.

**UX problems:**

- The Date of Birth picker defaults to exactly 18 years ago.
- The phone field's `+923` prefix is editable text, so typing a full number gives "+923+92300…" (seen while scripting).
- There is no store_owner routing branch after auto-login.

### verification_screen.dart: `VerificationScreen(email)`

| | |
|---|---|
| **Route** | none |
| **Reached by** | Register, when the server returns `requires_verification` |
| **Shot** | `guest/08` (reached with a mocked register response) |

**What it does.** "Verify Email" / "Please enter the 6-digit code sent to <email>", a code field, **"Verify"** and **"Resend Code"**.

**UX problems:**

- It uses the register screen's style, which is not the style of the OTP screen below. The two code-entry screens look unrelated.
- Part of the text is not in the Urdu map.

### forgot_password_screen.dart: `ForgotPasswordScreen`

| | |
|---|---|
| **Route** | `/forgot-password` |
| **Reached by** | Login, "Forgot Password?" |
| **Shot** | `guest/09` |

**What it does.** An email field, **"SEND CODE"**, then "Reset OTP sent to your email", and "Back to Login".

**UX problems.** It uses all-caps button styles that differ from Register's.

### otp_reset_verification_screen.dart: `OTPResetVerificationScreen(email)`

| | |
|---|---|
| **Route** | none |
| **Reached by** | Forgot Password, after SEND CODE |
| **Shot** | `guest/10` (mocked) |

**What it does.** A 6-digit OTP field, **"VERIFY OTP"**, and "Didn't receive the code? **Resend Code**".

**UX problems:**

- **The title says "Verify Your Email"** and "We've sent a 6-digit verification code" during a *password reset*, which is confusing.
- The icon circle is light blue (`Colors.blue` family), which is off-palette.
- A plain white page, unlike the gradient auth screens.
- No Urdu.

### reset_password_screen.dart: `ResetPasswordScreen(token)`

| | |
|---|---|
| **Route** | none |
| **Reached by** | the OTP screen |
| **Shot** | `guest/11` (mocked) |

**What it does.** "Create New Password" / "Security Check", New Password and Confirm Password fields, and **"UPDATE PASSWORD"**.

**UX problems:**

- **It shows the old blue "ServeNow" app icon** (`assets/icon/servenow.png`) instead of the current brand logo.
- The faded gradient header differs from Login.
- `Colors.blueAccent` is in the code.
- No Urdu.

---

## 3. Rider

### rider_dashboard_screen.dart: `RiderDashboardScreen` (4,031 lines)

| | |
|---|---|
| **Route** | `/rider` |
| **Role** | rider; admin via the ribbon "Rider" |
| **Shots** | `rider/01–12`, `admin/27` |

**What it does.** The rider's delivery workflow, with foreground and background location tracking and auto-refresh.

- **Header card:** "Welcome Rider", name, "ID | Vehicle", and Assigned / Completed / Wallet mini-stats.
- **Bottom nav:**

  | Tab | Content |
  |---|---|
  | Home | assigned deliveries |
  | History | completed deliveries |
  | Wallet | "Rider Digital Wallet", "Daily Cash Flow & Shift", "Net Cash In Pocket", **"Return Cash to Admin"**, **"Day Slip"**, "Shift Movements Timeline", "Financial Statistics" (Daily / Weekly / Monthly) |
  | Profile | name, email, phone, vehicle, photo and ID images, "Refresh" |

- **Drawer:** Home, History, Wallet, **Day Transactions** (cash pills, "Not Submitted Cash Orders", **"Close Day"**), Profile, Refresh, Change Password, Logout.
- **Delivery card:** "Order #…", status, customer, store, **Summary** (order dialog), **Call / SMS / WhatsApp**, **"Payment Recvd"**, then **"Mark Delivered"**.

**UX problems:**

- **Tiny text.** Bottom-nav labels are 9 px with 18 px icons.
- **Abbreviation.** The button label is "Payment Recvd".
- **Off-palette header.** The orange is deep Material `#E65100`/`#BF360C`, not the brand `#E06A2E`.
- **No grouping in the header.** The header stat "PKR 422690" has no thousands separators.
- **Cramped action row.** A delivery card has five action buttons in two rows.
- **English only.** Many labels are hard-coded in English despite the Urdu setting.
- **Inconsistent logout.** Logout uses `pushReplacement(LoginScreen)` instead of the named route.
- **Background tracking does not run on web.** `background_location_2` is skipped when `kIsWeb`.
- **Persistent header.** The big orange header card (about 25% of the screen) repeats on every tab, including Wallet and Profile (`rider/05`, `09`).
- **Summary loads late.** "Summary" fetches before showing its sheet. For 2-3 s the screen goes blank white with no spinner (seen in the first capture).
- **Raw values shown to riders:**
  - statuses `OUT_FOR_DELIVERY`, `out_for_delivery`, `pending`
  - `My Location: 30.4657, 70.9692` on History cards
  - `-0` values in the cash formula
- **Unneeded buttons.** History cards still show Call / SMS / WhatsApp for delivered orders.
- **Profile layout.** The email wraps mid-word ("...@servenow.p / k"). The same photo is shown for the profile picture and the ID card.
- **Rainbow cards.** Wallet and Day Transactions use rainbow-coloured stat cards (green, orange, blue, purple, teal).

---

## 4. Store owner

### store_owner_dashboard_screen.dart: `StoreOwnerDashboardScreen`

| | |
|---|---|
| **Route** | `/store_owner` |
| **Role** | store_owner; admin via the ribbon "Store Owner" |
| **Shots** | `store_owner/01–10`, `admin/26` |

**What it does.**

- AppBar "Store Dashboard" with bell, "Financial History" and logout.
- Header: store name and ID, owner, email, phone, "Net Receivable", Total / Delivered / Preparing / Ready counts, payment term ("Cash Only").
- Tabs **New Orders / Active / History**. Order actions are **"Mark Ready"** and **"Confirm Picked Up"**.
- A bottom action bar with six items:

  | Item | Opens |
  |---|---|
  | **Products** | ManageProductsScreen in store-owner mode |
  | **Offers** | OfferCampaignsScreen |
  | **Status** | "Update Store Status" dialog: "Mark as Closed", status message |
  | **Financial** | date-range financial history |
  | **Refresh** | reloads orders |
  | **Password** | Change Password |

**UX problems:**

- **Cramped bottom bar.** Six actions at a 10.5 px font; "Refresh" and "Password" do not belong in a primary nav.
- **Unhelpful empty state.** It is a bare "No orders found" in the middle of a large blank area (`store_owner/01`).
- **Header is a wall of text.** Owner email and phone are repeated as text lines.
- **Off-palette colours.** Deep-orange `#E65100` plus blue, purple, indigo and cyan status colours.
- **English only.** Bottom-bar and button labels are not translated.
- **Header too tall.** The header card takes about 45% of the screen, so only 1-2 orders are visible (`store_owner/03`).
- **Thin history cards.** History cards show items and customer, but no total or time.
- **Financial is a two-step chore.** It opens two date pickers in a row ("Select Start Date", then end) before any data appears (`store_owner/09`).
- **Financial list times.** Every order shows the time "19:00" (`store_owner/09b`). This looks like a date-only value rendered through a timezone conversion.
- **Products need expanding.** Products are collapsed under the store header, so the owner of a single store must expand it first.
- **Off-brand buttons.** The "Edit" buttons are indigo (`store_owner/05`).
- **Version badge.** It overlaps the "Password" label.

---

## 5. Admin

### admin_dashboard_screen.dart: `AdminDashboardScreen` (9,018 lines)

| | |
|---|---|
| **Route** | `/admin` |
| **Roles** | admin, standard_user |
| **Shots** | `admin/01–10, 16, 19, 25–28` |

**What it does.** The single-scroll "Mobile Admin" console:

- **Role ribbon:** Customer, Store Owner, Rider, Mobile Admin.
- **Hero:** "SERVENOW.PK MOBILE ADMIN / Live Radar & Fleet Oversight".
- **Live radar map** (OpenStreetMap through flutter_map) with "Lahore" and "Full Tracker" buttons.
- **Fleet cards:** Manage Stores, Manage Riders, Offer Campaigns, Store Balances.
- **Segmented tabs:**
  - **Orders & Dispatch:** Recent Activity, with New Orders / New Users / New Stores chips. An order opens the **"Order #N Assignment"** dialog (rider dropdown, Reset to New, Save).
  - **Daily Sales & Closing:** daily sale summary; allowlist only.
  - **Admin Tools:** metric cards and mini actions.
- **Bottom quick menu:** Stores, Products, Orders, Rider Day, Inventory, Status, Offers, **Tile Demo**.
- **Drawer:** Dashboard, Manage Stores, Store Balances, Store Status, Products & Variants, **Customer Tile Demo**, Manage Users, **Wallet**, Riders, Rider Day Transactions, Ride History, Inventory Reports, Manage Orders, Change Password, Logout.
- **Screens defined in this file:** the "Manage Orders" page, the "Store Status" dialog (per-store close, website-wide message, block ordering), and the full-screen "Live Rider Tracker".

**UX problems:**

- **Debug text in the UI.** The map overlay reads "Live Radar: **Lahore** Fleet (flutter_map)", although the operation is in Kot Addu.
- **Lahore is hard-coded.** The recentre button is labelled "Lahore".
- **Fake numbers.** When data is empty the cards show 18 stores and 12 riders, and the map shows a "Lahore Fleet Active" pin. With real data the hero card shows "Manage Stores – 2 Active" while there are 66 stores.
- **Demo entries in production navigation:** "Customer Tile Demo" and "Tile Demo".
- **Mislabelled item.** Drawer "Wallet" opens the legacy customer HomeScreen.
- **Clipped quick menu.** The bottom menu scrolls horizontally, and "Tile Demo" is off-screen with no scroll hint.
- **Off-palette and mixed styling:**
  - indigo/blueAccent drawer header and indigo avatar
  - slate/sky map overlay
  - the AppBar is translucent white, while every other screen's is orange
- **Restricted features.** They are gated on hard-coded emails, not on a role.
- **Mixed feedback.** Snackbars use two different mechanisms.
- **Truncated labels.** Segmented tab labels are cut off: "Orders & Dispa...", "Daily Sales & C...", "Out Delive...".
- **Decorative charts.** The "Today's Orders" line chart rises with 0 orders. The "All Orders" bar chart has no axes or labels (`admin/07`).
- **Rider Day is broken for the main admin.** `admin@servenow.com` is on the client allowlist, so the entry is shown. The server then answers "Permission denied: restricted rider day transactions access required." (`admin/17`).
- **Full Tracker is useless when idle.** With no riders it shows all of Punjab and Kashmir (`admin/10`).
- **Raw status values.** Recent Activity and the assignment dialog show raw values ("out_for_delivery").
- **Version badge.** It overlaps the "Offers" quick-menu item.

### admin_rider_day_transactions_screen.dart: `AdminRiderDayTransactionsScreen`

| | |
|---|---|
| **Route** | none |
| **Role** | admin on the allowlist |
| **Reached by** | quick menu "Rider Day", or drawer "Rider Day Transactions" |
| **Shot** | `admin/17` |

**What it does.**

- "Select Rider" dropdown and a date picker.
- Sections: "Cash Position", "Daily Summary", "Order-wise Ledger", "Cash Movement Log".
- Refresh, and Retry on error.

**UX problems.** Tailwind-style slate, blue and purple colours, unrelated to the brand palette. Dense numeric tables.

### manage_stores_screen.dart: `ManageStoresScreen`

| | |
|---|---|
| **Route** | `/manage-stores` |
| **Role** | admin |
| **Reached by** | the "Manage Stores" card, drawer, quick menu "Stores" |
| **Shot** | `admin/11` |

**What it does.** A read-only store list with search ("Search store by name, id, location..."). Each card shows OPEN/CLOSED, hours, email and status.

**UX problems:**

- Called "Manage" but has no actions at all.
- **Contradictory badges.** Every card shows a green "OPEN" next to an orange "inactive" (`admin/11`).
- **Overnight hours unclear.** A closing time of "07:30" is shown with no indication that it is overnight.
- `Colors.grey[100]` background and blue icons.

### manage_products_screen.dart: `ManageProductsScreen`

| | |
|---|---|
| **Route** | `/manage-products` |
| **Roles** | admin, store_owner |
| **Reached by** | admin drawer "Products & Variants" or quick menu "Products"; store-owner bottom "Products" |
| **Shots** | `admin/15`, `store_owner/04–05` |

**What it does.**

- Title "Manage Products", or "My Products (Price Update)" for a store owner.
- Store filter, "Store-wise" / "List" toggle, "Only products with variants".
- **"Edit"** opens the "Update Price" sheet: Price (PKR) or per-variant prices, Cancel / Save.

**UX problems.** Indigo accents. No Urdu for store owners. Only prices can be edited (no stock or availability).

### manage_users_screen.dart: `ManageUsersScreen`

| | |
|---|---|
| **Route** | `/manage-users` |
| **Role** | admin |
| **Reached by** | drawer "Manage Users" |
| **Shot** | `admin/20` |

**What it does.** A read-only user list with search and chips: All, Customer, Store Owner, Rider.

**UX problems.** Values are truncated to 15 characters with "...". Indigo styling. No actions.

### manage_riders_screen.dart: `ManageRidersScreen`

| | |
|---|---|
| **Route** | `/manage-riders` |
| **Role** | admin |
| **Reached by** | drawer "Riders", or the "Manage Riders" card |
| **Shot** | `admin/12` |

**What it does.** A read-only rider list with search and chips: All, Active, Inactive, Suspended.

**UX problems:**

- **Wrong figures.** Every rider shows "Deliveries 0" and "Rating N/A". Faizan Aziz has 2,353 completed deliveries in the rider app (`admin/12`).
- Indigo styling.
- No actions despite the "Manage" name.

### store_balances_screen.dart: `StoreBalancesScreen`

| | |
|---|---|
| **Route** | `/store-balances` |
| **Role** | admin |
| **Reached by** | the "Store Balances" card, or the drawer |
| **Shot** | `admin/14` |

**What it does.**

- Summary: Stores, Orders, Net Sales.
- Store search and filter, and a balance filter (All / Positive / Negative / Zero).
- Expandable per-store order lists.

**UX problems:**

- **Duplicated title.** "Store Balances" appears in the AppBar and again as the heading.
- **Inconsistent store count.** It reports 67 stores, while the dashboard reports 66.
- **Slow load.** A plain spinner shows for several seconds.
- Indigo, blue, purple and teal colours.
- Large numbers without grouping.

### inventory_report_screen.dart: `InventoryReportScreen`

| | |
|---|---|
| **Route** | `/inventory-report` |
| **Role** | admin |
| **Reached by** | quick menu "Inventory", or drawer "Inventory Reports" |
| **Shot** | `admin/18` |

**What it does.** "Total Inventory Summary", "Inventory by Store" (expandable breakdown), "Inventory by Category".

**UX problems:**

- **Overflow bug.** In the summary card, "Total Value" and "Average Price" run together as `PKR 1666428172.00PKR 1038920.31`, with the second value clipped at the right edge (`admin/18`).
- **Unreadable numbers.** Values have no thousands separators.
- **Implausible data.** The totals (3,531,918 units, PKR 1.67 billion) look like products defaulting to 2000 stock.
- The indigo gradient header is off-palette.

### offer_campaigns_screen.dart: `OfferCampaignsScreen(isAdmin)`

| | |
|---|---|
| **Route** | none |
| **Roles** | admin, store_owner |
| **Reached by** | admin "Offer Campaigns" card or quick menu "Offers"; store-owner bottom "Offers" |
| **Shots** | `admin/13`, `store_owner/06–07` |

**What it does.**

- A long create/edit form: Store, Campaign Name, Description, Type (Discount / Buy X Get Y), Scope, Enable Campaign, Discount Type and Value, Buy/Get Qty, start/end, product checklist.
- **"Create Campaign"** / **"Update Campaign"**, and **"Reset"**.
- An "Existing Campaigns" list with edit and delete.

**UX problems:**

- The existing campaigns are below a very long form; users must scroll past the whole form to see them.
- Campaign dates are raw ISO strings (`2026-05-20T19:51:00.000Z -> ...`), and the scope is the raw value `selected_products` (`admin/13`).
- No Urdu.
- Plain Material form styling.

### rider_history_screen.dart: `RiderHistoryScreen`

| | |
|---|---|
| **Route** | `/rider-history` |
| **Role** | admin only (not in the rider app) |
| **Reached by** | drawer "Ride History" |
| **Shot** | `admin/22` |

**What it does.**

- "Ride History" stats: Riders, Rides, Points, Distance, Last Update.
- "Select Rider With Rides" and "Select Ride / Order" dropdowns.
- A map of the selected ride's GPS trail.

**UX problems:**

- The date format is `29/10/2026` here but `2026-10-29` everywhere else.
- The empty state is a large blank map card.
- `#F6F8FC` and Tailwind colours.
- The name suggests a rider-facing screen.

---

## 6. Test, demo and unreachable screens

| Screen | Route | Reachable in production? | Notes |
|---|---|---|---|
| `customer_dashboard_test_screen.dart` | `/home`, `/customer-test-dashboard` | **Yes: it is the real customer and guest home** | Only the name says "test". Rename it before the redesign. The `/customer-test-dashboard` alias is dead. |
| `customer_tile_demo_screen.dart` (`CustomerTileDemoScreen`) | `/customer-tile-demo` | **Yes, for admins** (drawer "Customer Tile Demo", quick menu "Tile Demo") | See below. Shots: `admin/23–24`. |
| `ui_test_home_screen.dart` (`UiTestHomeScreen`) | `/ui-test-home` | **No** | See below. Not captured. |
| `wallet_screen.dart` (`WalletScreen`) | none | **No** (never constructed) | See below. Not captured. |
| `home_screen.dart` (`HomeScreen`) | `/wallet` | Admins only, via the drawer "Wallet" | A legacy customer home reached through a wrong label. Shot: `admin/21`. |

**`customer_tile_demo_screen.dart`.** An alternate store and product browse prototype ("Live demo using real stores from the current database.").

- It uses its own blue and gold palette (`#0D4F96` and similar).
- Delivery-time pills clip their text ("35 Minute / min"), and the numbered badges overlap the tiles (`admin/23`).
- It has no add-to-cart.
- Its error text leaks the backend URL ("Store load failed from <baseUrl>").
- It should be removed from production navigation or put behind a debug flag.

**`ui_test_home_screen.dart`.** A static mock-up of an electricity-bill app, unrelated to ServeNow.

- It hard-codes a real-looking person's name, father's name and reference number ("AQEEL UL REHMAN S/O …", "Ref No.: 16113160813534").
- It includes a bill of Rs.19,452.
- Every button does nothing.
- Nothing navigates to it. On web, a deep link to it is replaced by `AuthWrapper`'s redirect.
- **Delete it.** The hard-coded personal data should not ship.

**`wallet_screen.dart`.** A full customer wallet (Balance / Top Up / Payments / Transfers / History tabs) in purple `#667eea`.

- It is dead code: `/wallet` maps to HomeScreen.
- Either wire it up or delete it.

---

## 7. Screens not captured, and why

| Screen or state | Reason |
|---|---|
| `WalletScreen`, `UiTestHomeScreen` | Unreachable in the app (see section 6). |
| Live order flows: Place Order success, rider "Mark Delivered", store "Mark Ready", admin "Save" assignment, "Close Day", "Return Cash" submit, Cancel Order | Need write requests. The tool blocks all writes to keep `servenow_local` untouched; only the dialogs and forms leading up to them are captured. |
| Store-owner "New Orders" / "Active" with content | Store 71 had no open orders in the data copy. The empty states were captured. |
| Push notifications, Google sign-in, Stripe card sheet, rider background location | Native-only plugins, inactive on web (see the tool README). |
| App-update banner / "Update Available" dialog | Only shown when the server's `latest_version` is newer than the build's 1.2.2+42. It did not appear with this data. |
| Customer "Flash Message" dialog, delivery-pause and out-of-area banners | Depend on live admin settings and location; not active in this data set. |

---

## 8. Top UX problems (across the app)

1. **Labels say "test", "demo" and "Lahore" in production.**
   - The customer home is a class named `CustomerDashboardTestScreen`.
   - Admins see "Customer Tile Demo" and "Tile Demo".
   - The admin map says "Live Radar: Lahore Fleet (flutter_map)", with a "Lahore" button, for a Kot Addu operation.
2. **Broken or misleading navigation.**
   - The customer "Stores" tab does nothing.
   - Cart and Orders "Stores" go Home.
   - The bottom-nav highlight goes stale.
   - The admin "Wallet" item opens a legacy customer home.
   - `pushReplacement` breaks Back.
3. **Product cards in a store show no prices.** Every card says "1 Options" / "Options", so the customer must open each product to see what it costs.
4. **The version badge (`v1.2.2+42`) overlaps the bottom navigation** on every screen. It covers the "Cart" label on the customer dashboard, cart and orders.
5. **Inconsistent brand colours.**
   - The customer screens use the `CustomerPalette` orange `#E06A2E`.
   - The rider and store-owner screens use Material deep orange `#E65100`.
   - The admin screens use indigo, blue and slate.
   - The OTP screen is blue-tinted, and the tile demo is blue and gold.
   - Reset Password shows the old blue app icon.
6. **Weak or incorrect empty and error states.**
   - Guests opening Orders get a red "Failed to load orders" and Retry instead of "Register to see orders".
   - Errors show raw exception text (`Error: Exception: …`).
   - Store owners get a bare "No orders found".
   - Stores with no products show nothing.
   - Admin cards show invented numbers (18 / 12) when data is empty.
   - Images load late into plain white boxes with no placeholder.
7. **Store cards and the banner.**
   - Logos are cropped, and the OPEN badge covers them.
   - Fixed-height cards leave large empty white areas.
   - Delivery-time chips repeat units ("35 Minute min") and are truncated.
   - Banner titles are white text on busy artwork.
   - Images pop in late, so cards are blank white at first.
8. **Urdu support is partial.**
   - Change Password, OTP, Reset Password, Offers, Products and all admin screens ignore the setting.
   - Dashboards and Login keep many English literals ("Continue as Guest", "Payment Recvd", "Quantity", "Selected").
   - The language changes only for screens opened after the switch.
9. **Tiny, crowded controls on staff screens.**
   - The rider bottom nav is 9 px.
   - The store-owner bar has six items at 10.5 px, mixing navigation with "Refresh" and "Password".
   - The rider delivery card has five action buttons.
   - The admin quick menu hides items off-screen.
10. **Accessibility gaps.**
    - The customer dashboard's hamburger, cart icon and entire bottom nav have no semantics labels; TalkBack cannot announce them.
    - Low-contrast text sits on images.
    - Small tap targets on staff screens.
    - Duplicate cart counters (three on one screen) that disagree with the number of items in the cart.

Other notes:

- **Data and permission bugs found while capturing:**
  - Admin "Rider Day" is denied by the server for `admin@servenow.com`.
  - Manage Riders shows 0 deliveries for every rider.
  - The Inventory summary values overflow into each other.
  - Store-owner financial history shows every order at 19:00.
  - Offer campaigns show raw ISO dates.
- Support contact is a personal Gmail address.

- `ui_test_home_screen.dart` ships hard-coded personal data and should be deleted.
- The rider header shows "PKR 422690" without thousands separators.
- Cart lines read "1Piece • PKR 840.00".
- "Cancel Order" appears on delivered orders.
- The OTP screen for a password reset is titled "Verify Your Email".
