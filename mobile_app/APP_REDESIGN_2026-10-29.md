# ServeNow app redesign (2026-10-29)

Same brand as the website redesign (`UI_REDESIGN_2026-10-28.md`, `css/servenow-ui.css`): **"fresh market, calm and fast"**. White and light-grey surfaces, one green accent, Plus Jakarta Sans, Noto Nastaliq Urdu for Urdu.

The work is split into phases so the app is never left broken:

| Phase | Scope | Status |
|---|---|---|
| **A** | Design system, root theme for all roles, all customer and guest screens, customer bug fixes | **Done (this document)** |
| **B** | Rider and store-owner screens | **Done (see "Phase B" below)** |
| **C** | Admin consistency pass and the remaining bug list | **Done (see "Phase C" below)** |

---

## 1. Design system

Everything lives in `lib/theme/` and `lib/widgets/ui/`. Screens import one file: `import '../widgets/ui/ui.dart';`.

### Tokens

| File | Contents |
|---|---|
| `lib/theme/app_colors.dart` | `AppColors`: brand green `primary #15803D` (white text 5.0:1), `primaryPressed #166534`, tints `#F0FDF4 / #DCFCE7 / #BBF7D0`; neutrals `background #F6F7F9`, `surface #FFFFFF`, `border #E5E7EB`, `text #111827`, `text2 #4B5563`, `muted #6B7280`; status pairs (warning, danger, info, success) and the order-status pairs used by the website. |
| `lib/theme/app_spacing.dart` | `AppSpace` (4-pt scale, 16 gutter, 48 tap target), `AppRadius` (cards 16, controls 12, chips pill), `AppMotion` (150/220 ms, ease-out). |
| `lib/theme/app_text.dart` | `AppText` styles (display, h1, h2, title, body, small, caption, label, price) and the font families. Prices use tabular figures. |
| `lib/theme/app_theme.dart` | `AppTheme.light()`: the single `ThemeData` for every role. `ColorScheme` is built explicitly from the tokens (not `fromSeed`). Themes AppBar (white, hairline bottom border), NavigationBar, buttons (48 dp min height), inputs, chips, cards (1px border, no elevation), dialogs, bottom sheets, snackbars, tabs, list tiles, date picker, badges. `AppTheme.urdu()` is the same theme with line height 1.85 for Nastaliq. |
| `lib/theme/customer_palette.dart` | Kept as a thin alias of `AppColors`, so the ~490 remaining `CustomerPalette.*` references (mostly admin and rider history) turn green without code changes. |

### Fonts (bundled, no runtime downloads)

`assets/fonts/`: Plus Jakarta Sans 400/500/600/700/800 and Noto Nastaliq Urdu 400/700 (static TTFs, SIL OFL; licence files included). Declared in `pubspec.yaml`. Latin text uses Plus Jakarta Sans; any Urdu glyph falls back to Noto Nastaliq Urdu through `fontFamilyFallback`, including Urdu text on staff screens. The web build no longer needs to download Noto from fonts.gstatic.com for Urdu.

### Shared widgets (`lib/widgets/ui/`)

| Widget | Use |
|---|---|
| `StatusPill`, `OrderStatusStyle` | One status vocabulary everywhere: Pending, Confirmed, Preparing, Ready, Picked up, Out for delivery, Delivered, Cancelled (plus Urdu labels). Normalises raw values (`out_for_delivery`, `completed`, `canceled`...). Never shows a raw status. |
| `OpenBadge`, `TonePill` | Store open/closed badge (solid green / dark grey like the website) and generic tone pills. |
| `PriceText` | `Rs 1,160`, tabular figures, optional struck-through original price. |
| `AppNetworkImage`, `ImagePlaceholder` | `cached_network_image` with disk + memory cache, decode sized to the display size (`memCacheWidth`), neutral tile + green icon while loading or on error. |
| `Shimmer`, `SkeletonBox`, `SkeletonCard`, `SkeletonList` | Skeleton loaders: one animation and one `RepaintBoundary` per skeleton, no Opacity layers. |
| `EmptyState` | Friendly empty / error / guest state with one clear action. |
| `SectionHeader`, `InfoRow`, `AppCard` | Section titles, label/value rows, the base bordered card. |
| `QuantityStepper` | `− n +` stepper; collapses to an ADD button at 0. Light haptic on add. |
| `PrimaryButton` | Full-width primary action with loading state. |
| `SwipeToConfirm` | For the rider app in phase B. |
| `CartBar` | Sticky green "View cart · n items · Rs total" bar. |
| `StoreCard`, `ProductCard` | Store card (16:9 image, name, area, rating, ETA, delivery fee, open/closed) and menu tile (image, name, option hint, price, action). |
| `LanguageScope` | Wraps a customer screen in the right text direction and, for Urdu, the tall-line-height theme. Sheets and dialogs opened from customer screens are wrapped too, so they mirror correctly in RTL. |
| `AppVersionText` | "ServeNow v1.2.2 (42)" for Account/About and drawer footers. |

Other shared pieces:

- `lib/utils/formatters.dart` (`Fmt`): money with thousands separators, human dates ("28 Oct, 8:38 PM"), store hours ("12:00 PM – 11:00 PM"), ETA clean-up ("35 Minute min" → "35 min"), payment method and delivery-time labels (never raw `cash` / `asap`), order numbers, and `Fmt.isolate()` (Unicode LRI…PDI) for Latin/number runs inside Urdu text.
- `lib/utils/cart_counts.dart`: `cart.totalUnits` and `cart.quantityOf(productId)`, read-only extension methods. Every cart badge and the cart bar now show the same number (total units). `CartProvider` itself is unchanged.
- `lib/widgets/customer_bottom_nav.dart`: `CustomerBottomNav` + `CustomerNav`. One M3 NavigationBar (Home, Stores, Cart with badge, Orders, Account) used on Home, Cart and Orders, with semantics labels and tooltips on every destination.
- `lib/config/support_contact.dart`: the single support-contact source and the one "Contact support" sheet (see §4).
- `lib/utils/i18n/ur_shop.dart`, `ur_orders.dart`, `ur_auth.dart`: new Urdu strings, looked up by the existing `CustomerLanguage.tr` after its built-in map.

---

## 2. Screen changes (customer and guest)

All customer screens: white AppBar from the theme, tokens only (no orange/teal/brown, no blur orbs), `LanguageScope` instead of bare `Directionality`, formatted money/dates/statuses, skeletons instead of spinners for content, friendly empty and error states that never show raw exception text.

### Home: `customer_dashboard_test_screen.dart`

The file and class names were kept (`CustomerDashboardTestScreen`). `/home` and `/customer-test-dashboard` point at it, and the admin role ribbon and the screenshot tool use the route, so a rename is not worth the risk now. Nothing visible says "test". All data loading, polling, the flash-message dialog, global-status and promotion timers, location lookup and filtering logic are unchanged.

- **Top bar:** Menu (quick actions), greeting + area, Language (EN / اردو), Notifications, cart with badge. Every control has a semantics label/tooltip ("Menu", "Language", "Notifications", "Open cart").
- Search field, category chips with icons, delivery-pause and out-of-area notices in the status colours.
- **Featured** carousel: promotion cards keep the photo with a dark scrim; store cards are now a white card with the logo shown on one side and dark text on the other (no more white text on busy logos, no cropped names).
- **Order again** row (new): up to 6 recent non-cancelled orders from distinct stores, from the existing `GET /api/orders/my-orders`; store logo, 2 item names, total, "Reorder" opens the store. Hidden for guests.
- **Popular Stores** (top-rated open stores, horizontal) and **All stores** (vertical `SliverList`, 2–3 columns on wide screens). Store cards: 16:9 image, name, area, rating, ETA ("45–50 min"), delivery fee ("Rs 100 delivery", from the existing `GET /api/orders/delivery-fee-config`), Open/Closed badge, closed reason.
- While searching or filtering only the results list is shown, titled `Results for "broast"` (it used to keep saying "Popular Stores").
- Load error: "Could not load stores" with Retry (was the raw `Error: <exception>`). Empty: friendly empty state with "Show all stores".
- **Bottom navigation** (`CustomerBottomNav`): Home, **Stores (now works: a full store list with search and categories)**, Cart (badge), Orders, **Account (new)**. The highlight can no longer get stuck on Orders/Cart.
- **Account tab** (new): profile card, My Orders, My Cart, Change Password (customers), Language, Contact Us, Logout, and the app version at the bottom. Guests see "Register to place orders" with a Register button.
- Quick-actions sheet and language sheet are mirrored in Urdu.

### Store: `store_screen.dart`

- Compact header: logo (whole, not cropped), name, area, "Open now"/"Closed" badge, closed reason, rating, ETA, hours as "12:00 PM – 11:00 PM" (was "Open: 12:00  Close: 23:00"), offers as green pills.
- Pinned category chips (All + the store's product categories) when the store has more than one category.
- **Product cards show the price** (was "1 Options"): single price, struck-through original price for offers, "from Rs X" + "3 sizes" for multi-size products, unit hint ("1 Piece").
- **One-tap ADD, then an inline − n + stepper.** Products with one size are added directly; products with several sizes open a bottom sheet with the sizes, prices, quantity and "Add · Rs total". The add uses exactly the checks of the product page (global pause, store closed, outside hours, out of stock, stock limit, buy-X-get-Y step). Unavailable items show the reason (Closed, Out of stock, Outside Hours) instead of a button.
- **Sticky green cart bar** "View cart · n items · Rs total".
- Loading skeleton, error state with Retry, "No products yet" empty state. No emoji status strip.

### Product detail: `product_detail_screen.dart`

- AppBar shows the store name (the product name was duplicated); large 4:3 image with cached loading and placeholder; offer badge.
- Price with struck-through original and "You save Rs X". The raw stock count ("In Stock (2000)") is gone; only low stock ("Only 3 left"), out of stock, outside hours or store closed are shown.
- The description keeps its own direction (English descriptions no longer get flipped punctuation in Urdu).
- Size options as selectable rows with prices; quantity stepper; related items with prices visible (no longer hidden behind the bottom bar).
- Bottom bar: Total + "Add to Cart"; when the item cannot be added, the button says why. The add-to-cart logic is unchanged.

### Cart: `cart_screen.dart`

- Lines grouped by store with thumbnail, unit ("1 Piece"), "Rs 840 each", quantity stepper and line total (was "1Piece • PKR 840.00").
- Summary: subtotal, delivery fee and the **all-in total**, "All-in price. No hidden charges at checkout." The fee comes from the same read-only fee config and formula checkout uses.
- Sticky bar with total and "Proceed to Checkout". Clear-cart dialog: red "Clear" vs neutral "Cancel" (was identical "No"/"Yes").
- The guest "Register Required" dialog keeps "Later" / "Register". Empty cart: "Browse stores".

### Checkout: `checkout_screen.dart`

- One page: order summary per store with **inline quantity steppers** (cart editable from checkout), all-in total in a sticky bottom bar with "Place Order" and a loading state.
- Payment options as selectable cards; Cash on Delivery is the default (it already was); the wallet card shows the balance.
- "Delivery Fee (n stores)" only appears for more than one store (was "Delivery Fee (1 Stores)").
- **The order payload, `createOrder` call, wallet check, store-open and global-pause checks are unchanged.** One fix: the insufficient-wallet path used to leave the spinner running forever; it now resets.

### Orders: `orders_screen.dart`

- **Guests get "Sign in to see your orders" with Sign in / Register** (was a red "Failed to load orders"). Errors show a friendly retry state.
- Slim Total / Active / Completed row; All / Active / History chips; compact cards: store, `#Ord…` (no more "Orders #Ord…"), date ("28 Oct, 8:38 PM"), items, payment ("Cash on delivery", never `cash`), status pill, total, "View details".
- **In-app review:** after orders load, if the customer has 2 or more delivered orders and has not been asked before (`in_app_review_requested_v1`), `InAppReview.requestReview()` is called once. Never behind a button, skipped on web.

### Order details and tracking: `order_details_screen.dart`

- Compact header (store, order number, date, status pill) instead of the big logo.
- ETA window "Expected 8:40 PM – 8:55 PM" for active ASAP orders (created time + the 30–45 min checkout promise; hidden once past).
- Status stepper (Pending, Confirmed, Preparing, Out for delivery, Delivered; a cancelled order shows one red state).
- Rider card with Call / WhatsApp when the order has a rider.
- **Payment block:** COD shows "Pay rider: Rs X" + "keep change ready"; paid shows "PAID — nothing to pay".
- Items, totals, delivery info with formatted values, address shown once. "Track Order" opens a sheet with the stepper, rider and a readable "Last updated" (no raw timestamps or coordinates). "Cancel Order" asks for confirmation; when cancelling is not allowed, a short explanation replaces the faded button. "Contact Support" uses the shared support sheet.

### Auth: splash, login, register, verify, forgot, OTP, reset, change password

- **Splash:** white background, logo on the first frame, small green spinner (no peach gradient/blobs).
- **Login:** small logo, always-visible EN / اردو pill, email/password with show-password toggle, one green "Log in" button, "Continue with Google" (outlined, labelled), "Continue as Guest", "Register Here". Strings that stayed English in Urdu are translated (Continue as Guest, Or continue with, Select Language, Selected...).
- **Register:** plain form with language toggle; the phone field has a fixed "+92 3" prefix and keeps 9 digits (the value sent is still `+923XXXXXXXXX`, same validator); post-register routing now also handles store owners.
- **Verify email / OTP reset:** same style; the reset screen now says "Enter reset code" (it said "Verify Your Email" during a password reset). No blue.
- **Forgot / reset password:** consistent sentence-case buttons ("Send code", "Verify code", "Update Password"), Urdu support.
- **Change password:** rules hint, field icons, show/hide toggles; Urdu for customers (staff stay English).
- **Notifications panel** (`notification_bell_widget.dart`, shared by all roles): restyled with tokens, unread tint, readable dates, friendly empty state; public API and behaviour unchanged.

---

## 3. Bug and content fixes (phase A)

| Problem (from the inventory) | Fix |
|---|---|
| Stores tab did nothing | Stores is a real tab: full store list with search and category chips. |
| Three cart counters disagreed and counted lines, not items | One counter everywhere: total units (`cart.totalUnits`) on the top-bar badge, bottom-nav badge, store/product AppBar and the cart bar. The pink hero counter is gone. |
| Product cards showed "1 Options", no price | Prices on every card; inline ADD/stepper; sizes sheet for multi-size products. |
| Version badge `v1.2.2+42` overlapped the bottom nav on every role | Global overlay removed from `main.dart`. The version is shown in the customer Account tab and at the bottom of the rider and admin drawers (`AppVersionText`). Store owner: see §6. |
| `ui_test_home_screen.dart` with hard-coded personal data | File deleted and the `/ui-test-home` route removed. |
| Mixed English/Urdu text scrambled | Money, ETAs, hours, phone numbers, e-mails and order numbers inside Urdu text are wrapped in Unicode isolates (`Fmt.isolate`) or rendered as separate widgets; English product descriptions keep LTR. Sheets and dialogs from customer screens now mirror in RTL. |
| Untranslated strings in Urdu | Featured, Popular Stores, Continue as Guest, Order Details headings, Change Password, OTP, Reset Password and ~150 more strings added in `lib/utils/i18n/`. |
| "35 Minute min", "45-50 Minutes …" | `Fmt.eta` → "35 min", "45–50 min". |
| No thousands separators / raw ISO dates / raw `cash`, `asap`, `out_for_delivery` | `Fmt.money`, `Fmt.dateTime`, `Fmt.paymentMethod`, `Fmt.deliveryTime`, `StatusPill` everywhere on customer screens. |
| Personal Gmail shown as support | See §4. |
| Dashboard hamburger, cart and bottom nav had no accessibility labels | All have semantics labels/tooltips; the screenshot tool now taps them by label instead of coordinates. |
| Guests opening Orders saw a red error | Friendly "Sign in to see your orders" state. |
| Images were blank white boxes while loading | `AppNetworkImage` placeholder (neutral tile + green icon), cached and decoded at display size. |
| Store hours "Open: 12:00 Close: 23:00" | "12:00 PM – 11:00 PM". |
| OTP reset screen titled "Verify Your Email" | "Enter reset code". |
| Clear-cart "No"/"Yes" looked identical | Neutral "Cancel" and red "Clear". |
| Checkout "Delivery Fee (1 Stores)" | Store count only shown for multi-store orders. |
| Checkout spinner stuck after "insufficient wallet balance" | Loading state reset. |

## 4. Support contact (owner action needed)

The personal Gmail address was **not hard-coded in the app**: `GET /api/orders/customer-support-contact` returns the `support_phone`, `support_whatsapp`, `support_email` and `support_name` rows of `system_settings`, and when they are empty the server falls back to the **first admin user's** phone and e-mail (`routes/orders.js`, `getCustomerSupportContact`). That fallback is where the Gmail came from.

The app now reads support details through one place, `lib/config/support_contact.dart`:

- `SupportContact.load(token)` / `SupportContact.fromServer(map)` and the single `showSupportContactSheet(...)` used by Home (Contact Us) and Order details (Contact Support).
- `SupportContactConfig.override*` constants are **empty on purpose** (no new address or number was invented). A non-empty override wins over the server value.

**Owner:** set the four `support_*` rows in `system_settings` to the official ServeNow phone/WhatsApp/e-mail (no app release needed), or fill the overrides in `support_contact.dart` before the next release. No backend code was changed.

## 5. New dependencies

| Package | Why | Android notes |
|---|---|---|
| `cached_network_image ^3.4.1` | Disk + memory image cache, sized decode (`memCacheWidth`) | Pulls in `flutter_cache_manager`, `sqflite`, `path_provider`. No manifest or Gradle change needed; works with the Flutter default minSdk. |
| `in_app_review ^2.0.12` | Play in-app review after the 2nd delivered order | Uses the Play Core review API; needs the app installed from Play (internal testing track works) to actually show the dialog. Nothing to configure. |

No shimmer package: the skeleton shimmer is hand-rolled (`lib/widgets/ui/skeleton.dart`). Fonts are bundled assets (≈ 1.1 MB: five Plus Jakarta Sans weights + two Noto Nastaliq Urdu weights).

`macos/Flutter/GeneratedPluginRegistrant.swift` changed automatically because of the new plugins.

## 6. Not done / follow-ups

- **Rider, store-owner and admin screens** (phases B and C) were not restructured. They inherit the new theme: white AppBars with dark icons where the screen did not set its own colours, green buttons/inputs/chips, the Plus Jakarta Sans font, and `CustomerPalette` now green. Screens that hard-code their own colours still show them until phase B/C: the rider header card and buttons (orange), raw `OUT_FOR_DELIVERY` / `asap` / ISO dates on rider cards, the store-owner header and bottom bar (orange icons on the now-green header), the admin role ribbon, "Live Radar … Lahore" card and indigo drawer header. Spot-checked on web (rider home + drawer, store-owner home, admin home): nothing is broken or unreadable, they are just mixed-palette until restyled.
- The AppBar theme deliberately sets no title/icon colours, so AppBars that pass their own `foregroundColor` (e.g. the green store-owner bar with white text) keep it.
- **Store owner has no version display** now that the floating badge is gone; it will go into the store-owner "More" sheet in phase B.
- The customer home file/class still has "test" in its name (`customer_dashboard_test_screen.dart`, `CustomerDashboardTestScreen`); only visible labels were fixed. A rename can be done safely in a later phase (update `main.dart` routes and the import in any screen that references it).
- **Order again** opens the store; it does not refill the cart with the old items (that would need product objects the orders API does not return).
- The location line shows the city from the phone's geocoder; on web it falls back to "Your area".
- Android native launch screen (`android/app/src/main/res`) still uses the old colours; switching it to white needs a drawable change and a device test.
- Card payment still has no card-entry UI in checkout (pre-existing; not in scope).
- The in-app review can only be verified on a Play-installed build.

## 7. Verification

- `flutter analyze`: no issues.
- `flutter test`: passes.
- `flutter build web --release --dart-define=SERVENOW_API_BASE_URL=http://127.0.0.1:3098`: succeeds.
- Screenshots: `docs/app-screens/after/{guest,customer,customer_ur}/`, taken with `tool/screenshots/capture.mjs` against a local backend and the production data copy (read-only: every write is blocked by the tool). `tool/screenshots/scenarios.mjs` was updated for the new labels (no more coordinate taps on the customer home).

### Screenshot-tool changes (`tool/screenshots/scenarios.mjs`)

- Customer home controls are tapped by label: `Menu`, `Language`, `Open cart`, and the bottom nav by exact label (`tapx:Stores`, `tapx:Orders`, `tapx:Account`; Urdu `مینو`, `کارٹ کھولیں`, `آرڈرز`, `اکاؤنٹ`, `دکانیں`). The `DASH_*`/`UR_*` coordinate constants are gone.
- A store is opened by searching "Imran" and tapping the `Imran Broast` card (`OPEN_STORE` / `UR_OPEN_STORE`).
- Renamed labels: `LOGIN` → `Log in`, `SEND CODE` → `Send code`, `VERIFY OTP` → `Verify code`; clear-cart icon tapped via its tooltip `Clear Cart?`; order details reached through the Orders tab and scrolled before `Track Order` / `Contact Support`.
- Renamed / new shots: `customer/07_stores_tab` (was `07_stores_tab_noop`), `customer/24_account`, `customer/25_store_add_item`, `customer_ur/13_change_password` (was `13_change_password_not_translated`), `customer_ur/14_account`, `customer_ur/15_stores_tab`.

---

## Phase B: rider and store-owner screens

UI only. Location tracking (foreground stream and `RiderBackgroundTrackingService`), the 15 s assignment refresh, socket/notification handling, every API call and every status transition (`markPaymentReceived` → `markOrderAsDelivered`, store `ready` / `picked_up`, Close Day, price updates, campaign create/update/delete) are the same methods as before; only the widgets around them changed.

### Staff building blocks (`lib/widgets/staff/`)

| File | Contents |
|---|---|
| `staff_ui.dart` | Re-exports `widgets/ui/ui.dart` and adds: `StaffTone` (neutral / green / amber / red / blue only, no rainbow cards), `StaffDates` (`Today` / `Yesterday` / `Wed, 28 Oct`, and `dateOnly()` for DATE columns), `StaffStat` + `StaffStatGrid`, `MoneyRow` (label + `Rs 1,160` with optional +/− sign), `StaffSection` (bordered card, optionally collapsible), `DayStepper` (‹ Today · 29 Oct 2026 ›), `ContactButton` (56 dp Call / WhatsApp / Maps), `CashCallout` (rider cash display), `StaffSheet` (sheet title row + scroll body), `showStaffMoreSheet` / `StaffMoreItem`, `StaffListSkeleton`. |
| `store_financial_sheet.dart` | `StoreFinancialSheet`: store-owner financial history in one sheet (see below). Same `getStoreOwnerFinancialHistory` call. |

### Rider: `rider_dashboard_screen.dart`

- **Header:** white AppBar whose title follows the tab (Deliveries / History / Wallet / Profile). The orange header card that repeated on every tab is gone; a compact rider strip (name, ID · vehicle, Active / Delivered / Wallet with separators) is the first item of the Deliveries list only and scrolls away.
- **Bottom nav:** M3 `NavigationBar` (theme size labels, was 9 px), Home shows a badge with the number of active deliveries.
- **Loading:** skeleton list instead of a spinner/blank screen. The Summary sheet opens instantly (it never fetched; the blank white delay was the full-screen loading state).
- **Delivery card (active):** order number + human time + `StatusPill` (no more `OUT_FOR_DELIVERY`); amber notice for special instructions (blinking dot kept) and for a non-ASAP preferred time (`asap` is no longer shown as a notice or as raw text); **Pick up** (store, area) and **Drop off** (customer, address, phone) blocks; **cash display**: amber "Collect cash · Rs 150" when unpaid, green "Cash collected" after the rider confirms, green "PAID — do not collect" for card/wallet orders; three big buttons **Call / WhatsApp / Maps** (Maps opens Google Maps search for the delivery address, new, UI-only); "Summary · n items"; **one primary action per state** as a swipe-to-confirm: unpaid → "Cash received · Rs X" (`_markPaymentReceived`), paid → "Swipe to deliver" (`_markAsDelivered`). Orders not yet out for delivery show "Waiting for pickup · Preparing" instead of a disabled button. SMS moved into the Summary sheet.
- **History cards:** compact (number, status pill, time · store · customer, payment method, total), tap opens the summary; no Call/SMS/WhatsApp and no "My Location: 30.46, 70.96" coordinates.
- **Summary sheet:** status + payment pills, customer block with Call/SMS/WhatsApp, items per store with `2×`, size label and formatted line totals, pricing breakdown with `MoneyRow`.
- **Wallet tab:** wallet balance card (no gradient), "Daily cash" with `DayStepper`, **Cash in pocket** hero with the formula as signed rows (Advance +, COD +, Stores −, Fuel −, Returned −) instead of the run-on `Advance (+0) + COD (+0) - Store (-0)…` text, buttons "Return Cash to Admin" / "Day Slip"; cash movements and delivered-orders breakdown as clean rows with readable dates and statuses; Financial statistics with a full-width segmented control and two stat tiles. All amounts `Rs 422,690.20`-style.
- **Day Transactions sheet** (drawer / Day Slip): `DayStepper`, "Expected cash with you" hero, six neutral stat tiles (Not submitted opens the list of unsubmitted cash orders), Daily Summary rows, Close day as a `PrimaryButton` (same confirm dialog and `closeRiderDay` call). Dates as "29 Oct 2026", payment method/status as pills.
- **Profile:** avatar (photo or initial), stacked label/value rows (the e-mail no longer breaks mid-word), current location with Refresh, ID card shown once (hidden when it is the same image as the photo), Day Transactions / Change Password / Logout, app version at the bottom.
- **Drawer:** white, profile header, selected-tab highlight, version footer kept.
- **Urdu:** ~110 new rider strings in the screen's local `_tr` map; counts use `Fmt.isolate` so numbers stay intact in RTL. The screen now uses `LanguageScope` (Nastaliq line height).
- Error snackbars no longer show raw exceptions (`Failed to update status: Exception…`) — friendly text, details go to the logger.

### Store owner: `store_owner_dashboard_screen.dart`

- **Header shrunk** from ~45% of the screen to ~2 short rows: AppBar title = store name; under it "Store #71 · owner" + payment term pill, then Net receivable / Total orders / Delivered / In progress with separators. E-mail and phone moved to the More sheet.
- **Tabs** New / Active / History with count badges (New in green).
- **Order cards:** number, date-time, `StatusPill` (store's `item_status` still wins), items as `2× Chicken Chest (Neck) · 1 Piece`, customer, rider ("No rider yet" only on open orders), **store total** (sum of this store's items — history cards used to have no total or time). One full-width primary action: **Mark Ready** or **Confirm Picked Up**; ready orders without a rider show "Ready. Waiting for a rider to be assigned."
- **Empty states** per tab with Refresh (was a bare "No orders found"); skeleton on first load, thin progress bar on refresh.
- **Bottom bar: 5 items** — Orders, Products, Offers, Financial, **More**. More sheet: Store status (same dialog), Refresh orders, Change Password, Logout, owner details and the **app version** (the floating badge used to overlap "Password").
- **Financial history:** opens straight away on the last 7 days (the old default range) with chips Today / Last 7 days / Last 30 days / Custom (one date-range picker) instead of two date pickers before any data. Entries show `StatusPill`, "28 Oct 2026" (the `order_date` DATE column was shown as "19:00" through a timezone conversion; it is now shown as a date only) and formatted Gross / Paid by rider.

### Products: `manage_products_screen.dart` (store owner and admin)

- Store owners get the flat list directly (no collapsed store header to expand); admin keeps By store / List, and a single store group opens expanded.
- Cards: cached image, name, store (admin) · category · stock with separators (red when out of stock), price `Rs 440 · 1 Piece`, "from Rs X · 3 sizes" for multi-size products with size chips; green outlined **Edit price** (was indigo "Edit").
- **Edit price sheet:** product name, `Rs` prefix fields per size, "Save price" with loading state; validation and `updateProduct` payloads unchanged.
- Skeleton loading, empty / no-match states with "Clear filters".

### Offers: `offer_campaigns_screen.dart` (store owner and admin)

- **Existing campaigns first**, the form below (users had to scroll past the whole form). Campaign cards: name, Live / Scheduled / Ended / Off pill, offer badge ("10% off", "Buy 2 get 1"), dates "20 May, 7:51 PM – 21 May, 8:51 PM" (were raw ISO), scope "All products" / "Selected products (3)" (was `selected_products`), edit and delete icons. Edit scrolls to the form and outlines the card; delete now asks for confirmation.
- Form: segmented controls for type, % / Rs and scope, `Rs`/`%` affixes, date tiles, product checklist with prices and a selected count, "Campaign on" switch, `PrimaryButton` Create/Update. Payload and validation unchanged.

### Rider-related admin screens

- `admin_rider_day_transactions_screen.dart`: rider dropdown + `DayStepper`, green "Expected cash with rider" headline (+ unsubmitted), collapsible Cash position / Daily summary / Order-wise ledger / Cash movement log with `MoneyRow`, readable movement names (`CASH COLLECTION` → "Cash collected") and dates, store/payment-term pills; skeleton loading. A permission error now reads "You do not have access to rider day transactions." with Retry (was the raw server message).
- `rider_history_screen.dart` (admin Ride History): tokens instead of `#F6F8FC`/Tailwind colours, dates "Today · 29 Oct 2026" / "28 Oct, 8:38 PM" (was `29/10/2026` and `29/10 8:38 pm`), status label instead of raw status, empty states instead of a blank map card, skeleton while loading. Map and route logic untouched.

### Screenshot tool

`tool/screenshots/scenarios.mjs`, rider and store_owner blocks only: rider bottom nav tapped with `tapx:` (the header strip also contains "Wallet"); new `rider/01b_home_scrolled`. Store owner: `tap:Active` / `tap:History` (tabs carry counts), `tapl:Products` / `tapl:Offers` / `tapl:Financial`, `tap:Edit price` (no store header to expand, `05_products_expanded` removed), new `08_more_sheet`, `08b_store_status_dialog` and `11_change_password` through More, `09_financial_history` (no date pickers) and `09b_financial_history_30_days`.

Shots: `docs/app-screens/after/rider/` and `docs/app-screens/after/store_owner/`.

### Phase B: not done / notes

- `SwipeToConfirm` (shared widget) always drags left-to-right, also in Urdu; not changed because `lib/widgets/ui` is shared. Its Semantics tap still works for accessibility.
- Store-owner Urdu: labels go through the existing `CustomerLanguage.tr`; strings it does not know stay English (staff screens may stay English per the brief). Products and Offers are English.
- Live actions (swipe "Cash received" / "Swipe to deliver", Mark Ready, Close day, Save price, campaign save/delete) were not executed in the capture run: the tool blocks every write. Their handlers are the original methods.
- "Maps" searches the delivery address text (orders have no customer coordinates).
- The financial `order_date` is a DATE column serialised as an ISO timestamp; it is shown in the device's local zone, which is correct for devices in Pakistan.
- Verification: `flutter analyze` clean; `flutter build web --release --dart-define=SERVENOW_API_BASE_URL=http://127.0.0.1:3097 -o build/web_phase_b` succeeds.

---

## Phase C: admin consistency pass

A presentation pass on the in-app admin, not a rebuild. Every API call, the socket/live-refresh timers, the order assignment, reset and status flows, the store-status dialog and the live tracker's map logic are unchanged; only what is drawn changed. The one addition is a single read-only `GET` to learn whether the server allows rider day transactions (see below).

### New shared admin widgets: `lib/widgets/admin/admin_ui.dart`

| Widget / helper | Use |
|---|---|
| `AdminStatTile`, `AdminTileGrid` | One value per tile, scaled to fit, tabular figures; equal-width rows. Replaces the side-by-side values that ran together. |
| `AdminBreakdownBar` | A real proportion bar (delivered / out for delivery / open / cancelled) drawn from the counts. With zero orders it says "No orders yet" instead of drawing anything. |
| `AdminCountChip` | Tappable "12 / Delivered" chip; label wraps instead of "Out Delive...". |
| `AdminQuickMenuBar` | Bottom quick menu: all entries visible at once (no hidden horizontal scroll), 11 px labels, 58 dp bar, semantics labels. |
| `AdminPanel`, `AdminIconBadge` | White 16-radius bordered section; green icon badge on the light tint. |
| `showAdminAccessNotice`, `adminIsPermissionError` | Friendly "not available for your account" dialog instead of a raw "Permission denied: ..." message. |
| `adminStatusLabel`, `adminFlag`, `adminHumanize` | Shared status vocabulary (`OrderStatusStyle`), tolerant `1/true/"1"` flags, `store_owner` -> `Store owner`. |

### Admin dashboard (`admin_dashboard_screen.dart`)

- **Theme everywhere:** default white AppBar, `AppColors.background`, green accents. Removed the peach gradient backdrop with blurred orbs, the translucent "glass" container, the orange role ribbon highlight, the indigo avatar and the indigo/blue drawer header. Remaining hard-coded slate/indigo/orange colours were mapped to tokens (63 replacements); the per-route colours of the live tracker are kept because they tell routes apart.
- **Loading:** dashboard skeleton instead of a spinner on the gradient.
- **Header:** "SERVENOW ADMIN / Operations overview / 29 Oct 2026" (was "SERVENOW.PK MOBILE ADMIN / Live Radar & Fleet Oversight").
- **Live map card:** title "Live riders · n on the road" (was "Live Radar: Lahore Fleet (flutter_map)"). Light map, green rider pins. With riders the camera fits their positions; with none it centres on the stores' area (Kot Addu) and shows "No riders on a delivery right now" instead of a fake "Lahore Fleet Active" pin. Buttons "Recentre" (fits riders, else the service area; was "Lahore") and "Full map" (only when riders have a location, so it can no longer open an empty map of Punjab). Riders on an active order without any shared location give "Rider locations are not shared yet".
- **Fleet cards:** no invented numbers. "Manage Stores" no longer says "2 Active" (that was the length of the *recent new stores* list, and 18 when empty); it describes the screen. "Manage Riders" shows the real number of riders on the road for accounts that can see the live tracker ("None on the road" when 0), otherwise "Riders & availability" (was 12 when empty).
- **Tabs:** "Dispatch / Daily sales / Tools" - short labels that fit at 390 px (was "Orders & Dispa...", "Daily Sales & C..."), 44 dp targets, semantics.
- **Daily sales:** amounts as `Rs 422,690` (were `PKR 422690`), date as "Today · 29 Oct 2026", 2-column stat tiles, outlined 44 dp prev/next day buttons with tooltips. Non-allowlisted accounts see a friendly "Daily sales are limited" state.
- **Tools tab metric cards:** no decorative charts. The rising line chart (drawn even with 0 orders), the unlabelled bar chart, the fixed 78% donut and the fake leaderboard are gone. "Today's orders" and "All orders" show a real proportion bar and 2 x 2 / 3-up count chips (Delivered, Pending, Cancelled, **Out for delivery**) that still open the order lists. "Active users" shows only its values. "Operations pulse" became **"Open orders"** (orders not yet delivered or cancelled) with the recent new users/stores as a footer. No more "↑ +0 pending" arrows.
- **Today's order list sheet:** opens in 220 ms with a fade (was a 2.5 s "hanging on ropes" drop), card shadow, readable title ("Today's out for delivery orders").
- **Recent activity / New orders:** cards with status pills ("Out for delivery", never `out_for_delivery`), `Rs 1,160 · No rider yet · 28 Oct, 8:38 PM`, friendly empty states.
- **Order assignment dialog:** status dropdown shows "Out for delivery", "Ready for pickup"... (the values sent to the API are unchanged), total as `Rs 1,160.50`, title "Order #Ord…".
- **Manage Orders page:** status pills, `Rs` amounts, 12-hour times, date button "29 Oct 2026", friendly error state with Retry (was the raw exception) and empty state.
- **Admin order details:** status label, payment "Cash on delivery (Pending)" instead of `cash (pending)`, readable dates.
- **Live tracker (Tools tab):** green header, status labels on rider markers/details, empty state. The debug line "Orders 6653 | Trackable 0 | Visible 0" now shows only in debug builds.
- **Drawer:** light green header with name, e-mail and an "Admin" pill; grouped sections (Orders, Stores, Riders, Account); version at the bottom. **Removed "Customer Tile Demo" and "Wallet".**
- **Bottom quick menu:** Stores, Products, Orders, (Rider Day), Inventory, Status, Offers - all visible; **"Tile Demo" removed**.

### Rider Day permission

The client shows Rider Day to the two allowlisted e-mails, but the server (`routes/orders.js`, `GET /api/orders/rider/financial-history`) only allows e-mails listed in the `PRIVILEGED_ADMIN_EMAILS` environment variable, so `admin@servenow.com` got "Permission denied" when that variable does not list it. The app cannot read the server's list, so on dashboard start it makes **one read-only request** to that endpoint for today. If the server answers with a permission error, the Rider Day entries (drawer, quick menu, wide-screen side panel and Tools quick actions) are hidden for the session. If someone taps the entry before the check finishes, the same check runs first and a friendly dialog explains that rider day transactions are limited to the owner accounts set on the server (no raw error). Nothing in the backend changed.

### "Wallet" drawer item

It opened `/wallet`, which is the legacy customer `HomeScreen`. There is no admin wallet screen in the app; store wallet balances already live in **Store Balances** (in the drawer and on the dashboard), so the item was removed rather than pointed at a duplicate. The `/wallet` route now opens the real customer home (`CustomerDashboardTestScreen`) for any old deep link, and `home_screen.dart` is no longer referenced anywhere (kept on disk; safe to delete later).

### Customer Tile Demo

Removed from the drawer and the quick menu. The `/customer-tile-demo` route is registered only in debug builds (`kDebugMode`), and the demo screen no longer prints the backend URL in its error text.

### Other admin screens

| Screen | Changes |
|---|---|
| Manage Stores (`manage_stores_screen.dart`) | Title "Stores", count line "67 stores · 67 active", skeleton, error state with Retry (no raw exception). Card: name, Open/Closed badge (closed when the store is inactive), an "Inactive" pill from `is_active` and "Hidden from customers" from `is_customer_visible` only when they apply (the old card showed "inactive" on every store because the API has no `status` field), hours "12:00 PM – 7:30 AM (next day)" for overnight hours, reason when closed, phone/e-mail/address rows. Open/closed uses the server's `is_open` when present. |
| Manage Riders | Title "Riders". Status from `is_active` / `is_available` (Active, Inactive, Available, Off duty); filters All / Active / Available now / Inactive now actually filter (the API has no `status` field, so "Active" used to match nobody); search also by phone. Shows vehicle, wallet balance (`Rs`) and join date. **Removed "Deliveries 0" and "Rating N/A"**. No 15-character truncation. |
| Manage Users | Title "Users", role pills (Customer, Store owner, Rider, Admin, Staff), Verified / Not verified and Inactive from the real booleans (the old "Status: active" was a default), phone, join date, user count, Admins filter, no truncation. |
| Inventory report | Stat tiles: Products, Units in stock, Stock value `Rs 1,666,428,172`, Average price `Rs 1,038,920` - each value on its own tile, so they no longer run together or clip. Store and category cards with thousands separators and "per unit" prices; "Categories" (the store breakdown is per category, it was labelled "items"). Skeleton and error states. |
| Store Balances | No duplicated title; filters as outlined dropdowns; chips "With delivered / With pending / With cancelled" (they filter stores, not orders); summary tiles Stores / Orders / Net sales; card with balance coloured by sign, Delivered/Pending/Cancelled count chips, sales rows with separators, recent orders with status pills and dates. Skeleton and error state with Retry. |

### Data issues for the owner (not app bugs, not changed)

- **66 vs 67 stores.** Checked against the local copy: there are 67 stores, all active, one of them hidden from customers (`is_customer_visible = 0`). The customer store list returns 66; admin lists (Store Balances, Manage Stores) return 67. Both numbers are right; Manage Stores now marks the hidden store "Hidden from customers".
- **Rider deliveries and ratings.** `GET /api/riders` has no delivery count or rating column, so the old "Deliveries 0 / Rating N/A" were defaults. The app now shows only fields the API returns. To show per-rider deliveries or rating in the admin, the API would need to return them.
- **Rider Day for `admin@servenow.com`.** Add the owner e-mails to `PRIVILEGED_ADMIN_EMAILS` on the server if they should see rider day transactions; until then the app hides the entry for them. (Daily sales use a different check in `routes/admin.js` that lets every `admin` user in.)
- **Inventory totals** (3.5 million units, Rs 1.67 billion) still look like products defaulting to a 2,000 stock; the app now displays them readably but cannot correct them.
- The client-side allowlist (`admin@servenow.com`, `nazir@servenow.pk`) for daily sales, the live tracker and "Reset to new" is still hard-coded in `admin_dashboard_screen.dart`; moving it to a server permission is a backend task.

### Not done in phase C

- Admin screens owned by phase B (Products, Offers, Rider history, Rider day transactions) were not touched here.
- The store-status dialog and the dead in-file "rider day ledger" page (`_openAdminRiderDayTransactions`, not reachable from any menu) only got the token colour mapping and `Rs` formatting, not a re-layout.
- `home_screen.dart` and `customer_tile_demo_screen.dart` stay on disk (no production entry points).

### Phase C verification

- `flutter analyze`: no issues (whole project).
- `flutter build web --release --dart-define=SERVENOW_API_BASE_URL=http://127.0.0.1:3096 -o build/web_phase_c`: succeeds.
- Screenshots: `docs/app-screens/after/admin/` (27 shots, all captured, 0 write attempts) against a local backend on port 3096 and the production data copy. `tool/screenshots/scenarios.mjs` admin block updated: tabs `tapx:Daily sales` / `tapx:Tools`, role ribbon `tapx:Open Customer view` etc., `until:Net sales`; removed `21_wallet_item_opens_legacy_home`, `23/24_customer_tile_demo*`; `10_full_live_tracker` became `10_live_rider_tracker` (Tools tab, scrolled); `17_rider_day_transactions` became `17_rider_day_hidden_in_drawer` (the local server has no `PRIVILEGED_ADMIN_EMAILS`, so the entry is hidden); new `18b_inventory_report_scrolled`.
