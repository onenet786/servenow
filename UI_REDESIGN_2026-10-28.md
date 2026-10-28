# ServeNow UI redesign – 2026-10-28

The look is "fresh market, calm and fast": white and light-grey surfaces, one accessible green
(`#15803D`, white text contrast 5.0:1), pill badges for order status, and Plus Jakarta Sans.
Most of the work is CSS. The JS changes cover only the UX fixes the brief lists and a few bugs
found along the way. Element ids, JS-referenced classes, `name` attributes, inline handlers,
`data-*` attributes and the script order are unchanged.

## Deploy checklist (upload these files)

**New**
- `css/servenow-ui.css`: the design system. It is linked **last** on every page as `?v=1`.

**Changed HTML**: `index`, `stores`, `store`, `products`, `cart`, `checkout`, `orders`, `order-confirmation`,
`wallet`, `profile`, `login`, `register`, `forgot-password`, `reset-password`, `data-deletion`, `rider`, `admin` (`.html`)

**Changed JS**: `js/app.js` (v=22), `js/store.js` (v=7), `js/rider.js` (v=4), `js/checkout.js` (v=4),
`js/wallet.js` (v=2), `js/orders.js` (v=2), `js/financial.js` (v=22)

## Changes to every page
- After `aginv-theme.css` each page now loads a Google Fonts `<link>` (Plus Jakarta Sans 400/500/600/700, `display=swap`) and then `css/servenow-ui.css?v=1`. The server CSP already allows fonts.googleapis.com and fonts.gstatic.com. If the font can't load, the page falls back to the system font.
- `<body>` gets scoping classes: `sn-ui` plus `sn-customer` / `sn-auth` / `sn-page-*`, `sn-rider` or `sn-admin`. No JS assigns `body.className`. app.js only uses `classList`, so these classes are safe.
- `app.js?v=20/21` is now `app.js?v=22` on every page.
- On pages that hard-code a Logout `<li>` (cart, orders, wallet), that `<li>` now has `class="nav-logout"`. `updateNavigation()` already checks for `.nav-logout`, so it no longer adds a second "Logout" item.

## Design system (`css/servenow-ui.css`)
- Tokens live on `:root` (`--sn-green-50…800`, neutrals, status colours, radii, shadows).
- The legacy tokens are re-mapped (`--primary`, `--primary-gradient`, `--dark-gradient`, `--bg-body`, `--border-color`, …). Older components therefore lose the purple and orange gradients.
- Admin themes still work. `body[data-theme=…]` beats `:root`, so ocean, emerald and the other themes keep their own sidebar and background variables. **Default** (no `data-theme`) is the new design: a dark-neutral `#111827` sidebar with a green active item.
- Shared components:
  - Buttons: primary green, secondary white outline, danger red. All are at least 44px tall.
  - Inputs: 10px radius and a green focus ring.
  - Toasts, which now also have styling on the rider page.
  - Modals: white header, no gradient.
  - Status pills: identical on customer, rider and admin pages (`pending`, `confirmed`, `preparing`, `ready`, `picked_up`, `out_for_delivery`, `delivered`, `cancelled`, plus `active`, `inactive`, `paid` and so on).
  - Open/Closed badges.
- Accessibility: visible `:focus-visible` rings, tap targets of at least 44px on phones, and `prefers-reduced-motion` support.

## UX fixes

### Customer shell
- **Top app bar (new, injected by `snBuildCustomerChrome()` in app.js):**
  - ServeNow brand on the left, shown at 1024px and below.
  - On the right: the notifications bell, a cart link with a live item-count badge, and an account link (`profile.html`, or `login.html` for guests).
- **Sidebar:** white, with a green-50 background on the active item. If a page didn't mark an active link, JS now adds `.active` to the matching one (store → Stores, checkout → Cart).
- **Phone bottom navigation (≤768px):** Home / Stores / Cart (with badge) / Orders / Account. These are plain links to existing pages and need no new handlers. The hamburger drawer stays for Wallet, Change Password and Logout.
- **Footer:** slim and muted.

### Image fallbacks (app.js)
- Capture-phase `error`/`load` listeners plus a MutationObserver (customer pages only) add `.sn-img-missing` to the image's host element (`.category-card`, `.product-image`, `.sn-media`, `.store-image-container`, `.serving-dish`).
- The host also gets this class when the image is the brand-logo placeholder.
- CSS then shows a neutral grey tile with a green Font Awesome icon. Broken-image alt text no longer appears.

### Home
- **Search:** one compact line (input + category select + icon-only Clear).
- **Categories:**
  - Phones: a horizontally scrolling row of round tiles.
  - Desktop: two tidy rows that scroll sideways, so stores stay above the fold.
  - The whole tile is the tap target, via the existing "Shop Now" link stretched over it.
- **Stores:** a consistent card family with an Open/Closed badge.
- **Search results fix:** `#searchResultsSection` has inline `display:none` and app.js only toggles `.hidden`, so results never appeared. CSS now shows the section whenever `.hidden` is removed. No JS change was needed.

### Store page
- **Container collapse fixed:** the "empty pink strip" was the store banner collapsing to 2px, because a flex child with `overflow:hidden` shrinks. Children of `.app-content` now have `flex-shrink:0`.
- **Store header:** logo tile, name, an Open/Closed pill top-right, then location, rating, delivery time and hours as compact meta. The generic "Store Details" heading is now visually hidden (still in the DOM for screen readers), and "Menu" is a small section title.
- **Product grid:** 2 columns on phones and 3–5 on desktop. The image is now wrapped in `<div class="sn-media">` in `store.js` (only the template string changed).
- **Sticky cart bar:** a full-width green "Add" button on each product, and a sticky green **"View cart (n) · PKR total"** bar on phones and tablets (`#snCartBar`). It is updated from `updateCartCount()`, so it changes immediately after an Add.

### Cart
- **Empty state:** `displayCart()` now hides `.cart-section` (`hidden` attribute), shows `#emptyCart`, and marks the checkout link `aria-disabled`. An empty cart no longer shows "Total: PKR 0.00" with an enabled checkout button.
- **Empty-state copy:** new icon and wording, with the button changed to **Browse stores** (`stores.html`).
- **Cart lines:** thumbnail, name, remove button, and a −/+ stepper. The duplicate range slider is hidden but stays in the DOM.
- **Summary:** sticky on desktop, a fixed bottom checkout bar on phones.

### Checkout
- **Payment cards:** large selectable cards (`.sn-pay-options`, built in `checkout.js` from the `<select>` options).
  - `#paymentMethod` stays the source of truth: clicking a card sets `select.value` and dispatches the normal `change` event, so `handlePaymentMethodChange()` and form submit behave as before.
  - The select is visually hidden but still focusable.
- **Layout:** form and summary as sections, with the summary sticky on desktop.
- **Security:** item names in the summary are now escaped.

### Orders and order confirmation
- **Order cards:** card styling, pill status, and a readable status label (`out_for_delivery` → "out for delivery", escaped). The scroll box inside each card is removed, and rider contact buttons are neutral.
- **Empty state:** "No orders found" is styled as an empty-state card.
- **Confirmation page:** centred card with a green check.

### Wallet
- **Balance card:** green, with a big tabular number.
- **Balance fix:** wallet.js looked for `#balanceAmount`, which doesn't exist on wallet.html, so the balance never loaded. It now also fills `#walletBalance`.
- **Transactions fix:** wallet.js looked for `#transactionsBody`, but the page uses `#transactionsList`, so the list never rendered. It now falls back to `#transactionsList`.
- **Table header:** fixed to match the five row columns (Date, Type, Amount, Description, Balance).
- **Amount colouring:** amounts get `+`/`−` and green/red via `.wallet-amount--in` / `.wallet-amount--out`.
- **Init crash fixed:** optional controls that aren't on this page (`#paymentMethod`, `#topupForm`, …) are now bound with `?.`. Before, init threw and the quick-amount buttons never worked. `loadPaymentMethods()` and wallet's own `showError()` no longer throw when their containers are missing.

### Auth pages
- Centred white card, contained brand logo, labelled inputs, one green primary button, and muted links.

### Rider
- **Location problem shown once:**
  - New `showRiderLocationProblem()` turns the existing `.rider-info-bar` into one compact amber banner (`.rider-info-bar--warning`), with the Refresh button beside it.
  - The 10-second red toast and the second red message are gone.
  - The trigger is unchanged: the same `getCurrentLocation()` promise in the same places.
  - `updateLocationDisplay()` clears the warning once a fix arrives.
- **Segmented control:** Active/Completed is a full-width two-way control on phones.
- **Order card template (`displayRiderDeliveries`), in order:**
  - Header: order number, status pill, info button.
  - Customer / pick-up / deliver-to / phone block.
  - Money block: subtotal, fee, a prominent **Grand total**, and **"Collect cash PKR X"** when the order is cash and unpaid.
  - Items in a `<details>`.
  - A full-width **Call / WhatsApp / SMS** row of 52px buttons.
  - A big green **Mark as Delivered** at the bottom, with Mark Payment Received as secondary.
- **What was preserved and fixed in the card:** all handlers (`openOrderInfo`, `markDelivered`, `updatePaymentStatus`, `viewDeliveryDetails`) and the `.order-status` / `.payment-status` classes are unchanged. The WhatsApp icon class was fixed (`fab`), and all server values are escaped.

### Admin and store owner
- **Sidebar:**
  - Default theme: dark-neutral, with a green active item.
  - Dropdown parents (Accounts, Stores, Reports…) were centred between the icon and the chevron; they are now left-aligned.
  - The brand text is white.
- **Stat cards:** flat white with a 4px left accent per meaning (info/success/warning/danger). The gradient top bar and gradient text are removed.
- **Financial dashboard tiles:** `financial.js` now sets a white background, and its purple/indigo accents became slate/blue.
- **Tables:** light sticky header, green hover row, tabular numbers, and wide tables scroll inside `.table-container` (checked: page `scrollWidth` equals its width on GL and the Financial dashboard).
- **General Ledger:** `glTable()` now adds `class="num"` to money columns, so they are right-aligned.
- **Buttons, modals and footer:** gradients removed. Primary is green, danger red, secondary white outline. Modal headers are white, the footer is slim and muted, and the purple border is gone. The Pick & Drop button is flat amber.
- **Purple sweep:** hard-coded violet accents (filter apply buttons, period pills, settlement controls, report icons, the manual-order and add-product modal headers) are now green or neutral.
- **Filter inputs:** the icons that sat under the Orders filter inputs are realigned.
- **Hash links:** `.tab-content` gets `scroll-margin-top` so titles opened via `#hash` aren't hidden under the mobile header.

## Elements added (all new, nothing renamed)
| Element | Where | Notes |
|---|---|---|
| `a.sn-header-brand`, `a.sn-header-cart` (`.sn-cart-badge`), `a.sn-header-account` | customer `.app-header` (JS) | static markup, no user data |
| `nav.sn-bottom-nav` | customer pages, end of `<body>` (JS) | links only |
| `a#snCartBar.sn-cart-bar` | store.html / products.html (JS) | counts via `textContent` |
| `div.sn-media` | wraps store product `<img>` (store.js) | `productCard.querySelectorAll('img')` still works; `applyImageBgFromImage` targets `.product-image` only, so behaviour is unchanged |
| `.sn-pay-options` / `button.sn-pay-option` | after `#paymentMethod` (checkout.js) | built with DOM APIs; `walletBalanceInfo` is still appended to the same parent |
| `.sn-empty-icon` | cart.html `#emptyCart` | static |
| `.rider-block*`, `.rider-line*`, `.rider-collect`, `.rider-contact-btn*`, `details.order-items-summary` | rider card template | no JS queries depend on the old structure (checked: rider.js only queries `#orderInfoBody`, `.tab-content`, `.sidebar-nav a`) |

## JS hooks verified (grep in `js/`)
- `cartCount`, `cartItems`, `cartTotal`, `emptyCart` and `.cart-section` are used only by app.js. Elements are hidden, never removed.
- `storeInfo`, `storeProducts`, `price-<id>`, `offer-<id>`, `add-btn-<id>`, and the variant radio `name`s are unchanged.
- `#paymentMethod` `change` listener and `#cardDetails` toggle: tested (card → `#cardDetails` shown and fields required; cash → hidden).
- `#themeSelect` / `applyAdminTheme()`: tested ocean → `data-theme="ocean"` with its own sidebar colour; default → attribute removed and the new design returns.
- `#currentLocation`, `refreshLocation()`, `switchDeliveryTab()`, and `#assignedTab`/`#completedTab(2)`: unchanged.

## Known leftovers (not changed on purpose)
- **Wallet top-up:** wallet.js still expects controls that wallet.html doesn't have (`#topupForm`, saved cards, auto-recharge), so **Top Up Now is not wired**. This was already broken before the redesign. Only the crash-proofing and the display fixes were done.
- **Store owners:** `updateNavigation()` redirects `store_owner` away from `admin.html`. This was existing behaviour and was left untouched.
- **Fixed in passing:** some other unescaped values in older templates (`loadHomeCategories`, `buildStoreCardHtml`, the checkout item name) are now escaped. Other legacy templates were not audited.

## Follow-up fixes (owner request, 2026-10-29)
- **Store hours:**
  - `js/store.js` (v=8) has new `formatStoreTime()` / `formatStoreHours()`. They turn `12:00:00` / `23:00:00` into **"12:00 PM – 11:00 PM"** (12-hour, no seconds).
  - If either time is null, empty or unparsable, the hours line is hidden.
  - Store list cards (`buildStoreCardHtml`) don't show hours, so nothing changed there.
- **Readable order statuses (display only):**
  - **Admin:** `js/admin.js` (v=48) has new `formatOrderStatusLabel()` and `orderStatusPillHtml()`. They render `<span class="order-status status-<raw>">Out for delivery</span>` in these places:
    - the Orders table status column and the multi-store status tooltip;
    - the order "View" modal;
    - Dashboard → Recent Activity → New Orders. That subtitle used to be the server string `out_for_delivery - PKR 1160.00` (inserted unescaped). It is now built from `item.details.Status` / `item.details.Amount` as a status pill plus the amount, and every other subtitle is escaped.
  - **Customer and rider:** `snStatusLabel()` in `js/app.js` (v=23) gives the same sentence-case labels on customer orders (`js/orders.js` v=3) and in rider cards (`js/rider.js` v=5).
  - **Raw values are untouched:** status `<select>` option values (e.g. `#orderStatus`), filters, data attributes and API calls still use the raw value. Verified that `#orderStatus` options are still `pending, confirmed, …, out_for_delivery, delivered, cancelled`.
  - **CSS:** `.order-status` no longer uses `text-transform: capitalize`, so labels read "Out for delivery". Recent Activity subtitles lay out the pill and the amount inline.

## Evaluation round 1 fixes (2026-10-29)
- **Admin at ≤1024px:**
  - The page title was hidden under the fixed 52px header. `.app-content` now gets top padding equal to the header height plus 0.75rem; the title top is now at 64px against a header bottom of 52px, checked at 390 and 768.
  - The hamburger was #e5e7eb on white, about 1.2:1 contrast. It is now dark text (#111827) and at least 44px.
  - The header is a flat white bar.
- **Customer orders card** (`js/orders.js` v=4):
  - The header shows the order number, the order date (`created_at`) and an overall status pill.
  - A summary block shows the store (or "Multiple stores", no longer blue), the item count and a prominent **Total PKR x** in tabular figures. Shipments follow in their own block.
  - The "Customer:" line is shown to staff only.
  - Every value is escaped: order number, rider name and rider location were unescaped before.
- **Admin orders table:**
  - Statuses already show readable labels (previous round).
  - The pulsing pink "attention" customer cell is now a calm amber tint with no animation.
  - View is a white outline button, Edit is green, and Reset New is a red outline button.
- **Admin dashboard:**
  - The section titles ("Today's Orders" and the others) are now 18px semibold grey under the 26px page title.
  - Recent-activity cards are white with only the 4px accent; the gradients are removed.
- **Home on desktop:**
  - Categories wrap into a compact grid (48px tiles) instead of a horizontal strip that was cut off at the right edge.
  - The stores row (≥769px) has a right-edge fade and fixed 280px cards.
- **Product cards:**
  - Removed the forced blank line under the name, and the unit text uses the neutral muted colour.
  - The grid is 3 columns from 600 to 1024px.
- **Sidebar order** (`js/app.js` v=24): Profile and Change Password are now inserted before the hard-coded Logout, so Logout is always last.
- **profile.html:** the duplicate header logout icon is hidden. The page's own `#logoutBtn` is kept, and the shared `#headerLogoutBtn` is hidden by CSS.
- **Modals:** violet inline icons (for example the Special Instructions icon) are now green.
- **checkout** (`js/checkout.js` v=5): Full Name is pre-filled as `[first, last].filter(Boolean).join(' ')`, so a missing last name no longer shows "Ali undefined".
