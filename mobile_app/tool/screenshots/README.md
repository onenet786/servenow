# ServeNow app screenshot tool

Captures every reachable screen of the Flutter app, per user role, as 390x844 @2x
PNGs (phone viewport, mobile emulation). It runs against a Flutter **web** build in
headless Chrome, driven over the DevTools protocol. Re-run it after a redesign
with a different `--out` folder to get matching "after" shots.

```
tool/screenshots/
  capture.mjs     runner: static server + Chrome/CDP driver + session seeding
  scenarios.mjs   roles (accounts) and the list of screens, with the steps to reach each
  README.md
```

Nothing in `lib/` or `pubspec.yaml` is changed. The tool needs Node 22 or later
(it uses the global `fetch` and `WebSocket`), Google Chrome, and `jsonwebtoken`,
which is loaded from the repo root `node_modules`.

## 1. Backend

You need a local backend with a copy of production data, plus **a JWT secret you
know**. The tool signs its own tokens, so no password is ever used or changed.

```bash
cd D:/GIT-HUB/servenow
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))" > /path/to/jwt.txt
DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=root DB_PASSWORD= DB_NAME=servenow_local \
PORT=3098 NODE_ENV=development JWT_SECRET=$(cat /path/to/jwt.txt) \
ALLOWED_ORIGINS=http://localhost:3098 LEDGER_SYNC=off node server.js
```

In development mode the server's CORS allows any localhost or 127.0.0.1 origin.

## 2. Build the app for web

The API URL is compiled into the build.

```bash
cd D:/GIT-HUB/servenow/mobile_app
flutter build web --release --dart-define=SERVENOW_API_BASE_URL=http://127.0.0.1:3098 -o build/web_screens
```

The build takes about 2.5 minutes. `build/` is git-ignored.

## 3. Capture

```bash
cd D:/GIT-HUB/servenow/mobile_app
node tool/screenshots/capture.mjs \
  --out ../docs/app-screens/before \
  --api http://127.0.0.1:3098 \
  --jwt-secret-file /path/to/jwt.txt
```

### Options

| Option | Default | Meaning |
|---|---|---|
| `--out DIR` | `../docs/app-screens/before` | Output folder. Files land in `DIR/<role>/NN_<screen>.png`, plus `DIR/capture-log.json`. Use e.g. `--out ../docs/app-screens/after` after the redesign. |
| `--roles a,b` | all | Only these roles: `guest`, `customer`, `customer_ur`, `rider`, `store_owner`, `admin`. |
| `--only 05_,cart` | all | Only scenarios whose name contains one of these strings. |
| `--api URL` | `$SERVENOW_API_BASE_URL` or `http://127.0.0.1:3099` | Must equal the URL compiled into the build. |
| `--jwt-secret-file F` | `$JWT_SECRET` | Must equal the backend's `JWT_SECRET`. |
| `--build DIR` | `build/web_screens` | Flutter web build to serve. |
| `--port N` | `8090` | Port for the static server that serves the build. |
| `--geo lat,lng` | `30.4686,70.9661` (Kot Addu) | Emulated GPS position. The stores in the data set are in Kot Addu. |
| `--images-from URL` | `https://servenow.pk` | Local DB copies have no `uploads/` files, so image GETs to `API/uploads/*` are served from this site. Pass `none` to disable. |
| `--verbose` | off | Logs steps, browser console output, and blocked or mocked requests. |

The full run (108 scenarios) takes roughly 25–30 minutes. Each scenario
starts from a fresh page load, so one failure does not cascade. A failed
scenario leaves `DIR/<role>/_failed_<name>.png` showing where it got stuck.
The process exits non-zero if anything failed.

### Exploring and debugging steps

Use `--dump` to print every visible semantics label (with x,y position) after
running some steps. Steps are separated by `|`:

```bash
node tool/screenshots/capture.mjs --dump customer --steps "tap:My Orders|tapx:View details" \
  --api http://127.0.0.1:3098 --jwt-secret-file /path/to/jwt.txt --shot /tmp/x.png
```

## How it works

**Sessions.** For each scenario the tool writes the same keys `AuthProvider`
persists through `shared_preferences`. On web these live in `localStorage` as
`flutter.<key>` with a JSON-encoded value:

- `token`: a JWT `{id, email, user_type, first_name, last_name, is_guest}` signed
  with the backend secret, the same payload as `/api/auth/login`
- `user`: `jsonEncode(User.toJson())`
- `customer_dashboard_language` (`'en'` or `'ur'`) and
  `customer_dashboard_language_initialized` (`true`): the Urdu toggle
- `cart_items_v1`: a pre-filled cart built from `GET /api/stores/71`

`AuthWrapper` then calls `tryAutoLogin()`, which runs `GET /api/auth/me`, and
routes the user to the role's home screen.

**Guest.** The guest session is a locally signed `user_type: 'guest'` token. It
does not call `/api/auth/guest-login`, which would insert a `login_logs` row.

**Navigation.** Flutter web draws on a canvas, so the tool clicks the hidden
"Enable accessibility" placeholder. That makes Flutter build its
`flt-semantics` DOM tree. Steps find widgets by label in that tree and send
real mouse events to the centre of each one. If a widget is off-screen, the
tool scrolls it into view first.

**Read-only guard.** Chrome request interception is on for `API/*`:

- Every POST, PUT, PATCH or DELETE is answered with a fake 403, so a capture
  run can never write to the database.
- A scenario can supply canned responses (`mock`) for specific write endpoints.
  This is how the register-to-verification and forgot-password-to-OTP-to-reset
  screens are reached.
- All blocked requests are listed in `capture-log.json`.

### Step language (`scenarios.mjs`)

| Step | Meaning |
|---|---|
| `tap:Label` | Tap the best match: exact, then prefix, then substring; in view preferred, top-most first. |
| `tapx:Label` | Exact match only. |
| `tapl:Label` | Last match, e.g. a bottom-nav item whose label also appears in a drawer. |
| `tap?:Label` | Optional; skipped if not found within 3 s. |
| `xy:x,y` | Tap CSS-pixel coordinates. Use only for widgets with no semantics label. |
| `type:text` | Insert text into the focused field. |
| `scroll:dy` | Mouse-wheel scroll at the middle of the screen. |
| `wait:ms` | Wait. |
| `until:Label` | Wait until a label appears. |
| `back` | Tap the AppBar back button. |
| `dismiss` | Close common dialogs (OK, Later, Close, Dismiss). Runs automatically first. |

A scenario can also set `expect: 'Label'`. The run then fails, instead of
silently saving the wrong screen, when that label is not visible at the end.

A store is opened by typing "Imran" into the dashboard search and tapping
the single remaining `View` button. The auto-scrolling Featured carousel also
contains store names, so tapping a name directly is unreliable.

Coordinate taps are used only on the customer dashboard. Its hamburger,
top-bar cart icon and custom bottom nav have no semantics labels. If the
redesign moves them, update `DASH_*` in `scenarios.mjs`. Urdu is RTL, so
there are mirrored `UR_*` coordinates for it. Better still, give
those widgets a `tooltip` or `Semantics(label:)` and switch to `tap:` steps.

After a redesign that renames labels, run `--dump` on the affected screen and
update the step labels.

## Screens and how each is reached

Each entry is `NN_name`: the steps from a fresh load of that role's session.

### guest (not signed in, and guest session)

| # | Screen | Steps |
|---|---|---|
| 01 | splash | screenshot taken immediately at boot |
| 02 | login | none |
| 03 | login_language_sheet | `EN` pill |
| 04 | login_validation_errors | `LOGIN` with empty fields |
| 05 | register | `Register Here` |
| 06 | register_scrolled | `Register Here`, then scroll |
| 07 | register_dob_picker | `Register Here`, then `Date of Birth` |
| 08 | verify_email | Register form filled, then `Register` (register POST mocked with `requires_verification`) |
| 09 | forgot_password | `Forgot Password?` |
| 10 | reset_otp | `Forgot Password?`, email, `SEND CODE` (mocked) |
| 11 | reset_password | as 10, then OTP and `VERIFY OTP` (mocked) |
| 12 | guest_home | guest session |
| 13 | guest_menu | guest session, hamburger |
| 14 | guest_store | guest session, `Imran Broast` card |
| 15 | guest_cart | guest session with a seeded cart, cart icon |
| 16 | guest_register_required | as 15, then `Proceed to Checkout` (dialog) |
| 17 | guest_orders | guest session, bottom-nav Orders |

### customer (id 484) and customer_ur (same customer, Urdu)

| # | Screen | Steps |
|---|---|---|
| 01 | home | none |
| 02 | home_scrolled | scroll |
| 03 | quick_actions_menu | hamburger |
| 04 | language_sheet | `EN` |
| 05 | contact_us | `Contact Us` |
| 06 | notifications | bell |
| 07 | stores_tab_noop | bottom-nav Stores, which does nothing |
| 08 | search_stores | type `broast` |
| 09 | store | `Imran Broast` |
| 10 | store_products | `Imran Broast`, then scroll |
| 11 | product_detail | `Imran Broast`, then `Chicken Chest Broast` |
| 12 | product_detail_scrolled | as 11, then scroll |
| 13 | cart | cart icon |
| 14 | clear_cart_dialog | cart icon, then AppBar delete |
| 15 | checkout | cart icon, then `Proceed to Checkout` |
| 16 | checkout_payment | as 15, then scroll |
| 17 | orders | bottom-nav Orders |
| 18 | orders_history_filter | as 17, then `History` chip |
| 19 | order_details | `My Orders`, then `View details` |
| 20 | order_details_actions | as 19, then scroll |
| 21 | track_order | as 19, then `Track Order` |
| 22 | order_contact_support | as 19, then `Contact Support` |
| 23 | change_password | hamburger, then `Change Password` |

`customer_ur` captures the main subset of these with the Urdu preference seeded,
plus the login screen in Urdu.

### rider (riders.id 3)

| # | Screen | Steps |
|---|---|---|
| 01 | home_assigned | none |
| 02 | order_summary_dialog | `Summary`, waiting for the sheet to load |
| 03 | drawer | drawer |
| 04 | history | bottom `History` |
| 05 | wallet | bottom `Wallet` |
| 06, 07 | wallet scrolled | `Wallet`, then scroll |
| 08 | return_cash_dialog | `Wallet`, then `Return Cash to Admin` |
| 09 | profile | bottom `Profile` |
| 10, 11 | day_transactions | drawer, then `Day Transactions` |
| 12 | notifications | bell |
| 13 | change_password | drawer, then `Change Password` |

### store_owner (users.id 410, store 71)

| # | Screen | Steps |
|---|---|---|
| 01 | dashboard_new_orders | none |
| 02 | active_orders | `Active` tab |
| 03 | history_orders | `History` tab |
| 04 | products_price_update | bottom `Products` |
| 05 | products_expanded | `Products`, then the store header |
| 05b | edit_price_sheet | as 05, then `Edit` |
| 06, 07 | offer_campaigns | `Offers` |
| 08 | store_status_dialog | `Status` |
| 09 | financial_history | `Financial` (first date picker) |
| 09b | financial_history_result | `Financial`, then `OK`, then `OK` |
| 10 | notifications | bell |
| 11 | change_password | `Password` |

### admin (users.id 1, on the restricted-feature allowlist)

| # | Screen | Steps |
|---|---|---|
| 01 | dashboard | none |
| 02 | dashboard_recent_activity | scroll |
| 03 | order_assignment_dialog | an `Order Ord…` row |
| 04, 05 | daily_sales_tab | `Daily Sales & Closing` |
| 06, 07 | admin_tools_tab | `Admin Tools` |
| 08, 09 | drawer | drawer |
| 10 | full_live_tracker | `Full Tracker` |
| 11 | manage_stores | hero card |
| 12 | manage_riders | hero card |
| 13 | offer_campaigns | hero card |
| 14 | store_balances | hero card |
| 15 | manage_products | quick menu `Products` |
| 16 | manage_orders | quick menu `Orders` |
| 17 | rider_day_transactions | quick menu `Rider Day` |
| 18 | inventory_report | quick menu `Inventory` |
| 19 | store_status_dialog | quick menu `Status` |
| 20 | manage_users | drawer |
| 21 | wallet_item_opens_legacy_home | drawer `Wallet`, which opens the legacy HomeScreen |
| 22 | ride_history | drawer |
| 23, 24 | customer_tile_demo | drawer `Customer Tile Demo`, then a store |
| 25 | role_customer_view | role ribbon `Customer` |
| 26 | role_store_owner_view | role ribbon `Store Owner` |
| 27 | role_rider_view | role ribbon `Rider` |
| 28 | notifications | bell |
| 29 | change_password | drawer |

### Not captured: unreachable in the app

- `wallet_screen.dart`: never constructed.
- `ui_test_home_screen.dart`: only registered as `/ui-test-home`. Nothing
  navigates to it, and on web a deep link is replaced by `AuthWrapper`'s
  `pushReplacementNamed`.
- `/customer-test-dashboard`: an alias of `/home`.

## Web-only limitations

The capture is a web build, so some native behaviour cannot appear:

- **Push notifications.** Firebase is not initialised on web (`main.dart`
  skips it), so there is no push token and no push toasts.
- **Rider background location** (`background_location_2`). Tracking is a no-op
  on web (`RiderBackgroundTrackingService` returns early when `kIsWeb`).
  Foreground `geolocator` uses the emulated GPS position.
- **Google sign-in.** It throws "available only on Android/iPhone builds" on
  web; the button still renders.
- **Stripe card payments.** Not exercised, because the tool never places an
  order.
- **Fonts.** Text is rendered by CanvasKit with Roboto and Noto fallback fonts
  downloaded from fonts.gstatic.com. Urdu glyphs need network access.
- **App update banner and dialog.** These compare the web `version.json` with
  the server's `latest_version`, the same way the phone app does.
