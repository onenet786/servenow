# ServeNow app redesign (2026-10-29)

Same brand as the website redesign (`UI_REDESIGN_2026-10-28.md`, `css/servenow-ui.css`): **"fresh market, calm and fast"**. White and light-grey surfaces, one green accent, Plus Jakarta Sans, Noto Nastaliq Urdu for Urdu.

The work is split into phases so the app is never left broken:

| Phase | Scope | Status |
|---|---|---|
| **A** | Design system, root theme for all roles, all customer and guest screens, customer bug fixes | **Done (this document)** |
| B | Rider and store-owner screens | Not started. They inherit the new theme. |
| C | Admin consistency pass and the remaining bug list | Not started. Admin inherits the new theme. |

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
