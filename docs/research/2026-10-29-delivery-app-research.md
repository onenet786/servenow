# ServeNow: delivery app research (UX, Material 3/Flutter, performance, Play Store ASO)

Date: 2026-10-29
Scope: customer, rider, store-owner and admin apps (Flutter), Pakistan (Kot Addu / Faisalabad), cash on delivery (COD), English and Urdu.
Brand: white / light-grey surfaces, green accent `#15803D`, Plus Jakarta Sans on web.

**How to read this.** Every claim based on a source carries a link. Anything tagged **[Judgement]** is my own recommendation and has not been verified by a source. Most competitor UX material online is vendor blogs and portfolio case studies. Baymard's research is mostly paywalled, so this report uses only its public summaries. Treat the competitor-pattern specifics as patterns to check against the live apps, not as documented facts.

---

## Key takeaways: top 15 actions ranked by impact

1. **Keep crash rate under 1.09% and ANR rate under 0.47%, and stay below 8% on any single phone model.** These are Google Play's bad-behaviour thresholds, measured over 28 days. Going over them can reduce the app's visibility on Play, and over 8% on a model shows users a store-listing warning ([Android vitals](https://developer.android.com/topic/performance/vitals), [Android Dev Blog 2022](https://android-developers.googleblog.com/2022/10/raising-bar-on-technical-quality-on-google-play.html)). Pakistan's market is mostly budget Tecno, Infinix and Xiaomi phones (Transsion 44% unit share in Q2 2025), so test on a 4 GB Infinix or Tecno, not a flagship ([Dawn](https://www.dawn.com/news/amp/1964994)). Add Crashlytics before launch.
2. **Make cash-on-delivery trust a visible feature.** The most common foodpanda.pk complaints are about prepaid orders that never arrive, refunds that are refused, riders asking a customer who already paid online to pay again, and support that never replies. Reviewers explicitly tell others to use COD so they can cancel ([Trustpilot foodpanda.pk](https://www.trustpilot.com/review/foodpanda.pk?page=5), [Trustpilot p.7](https://www.trustpilot.com/review/foodpanda.pk?page=7), [Runway Pakistan](https://runwaypakistan.com/?p=26373)). Concretely:
   - Show the exact "Pay rider: Rs 1,240" amount on the tracking screen and in the rider app.
   - Show a "PAID — do not collect" banner in the rider app for prepaid orders.
   - Add a "Keep change ready: Rs 1,240 — rider may not carry change for Rs 5,000" hint, which matches foodpanda's own change prompt.
   - Put a one-tap "Call / WhatsApp support" option on every order screen.
3. **One all-in price, shown before checkout.** Stacked fees (platform fee, delivery fee, packing charges, tax) are the top Zomato complaint ([Trustpilot Zomato](https://ca.trustpilot.com/review/www.zomato.com?page=6), [ETV Bharat](https://www.etvbharat.com/en/bharat/cost-of-convenience-zomato-swiggy-under-fire-over-high-fees-and-commissions-enn26012005143)). Show the delivery fee on every store card, show a sticky cart bar with the total including fees, and never add a fee on the last screen. **[Judgement]** Do not add a "platform fee" at all. Market "No hidden charges" in the app (but not as a comparison claim on Play).
4. **Put "Reorder" on the home screen.** Baymard's 2026 benchmark found repeat ordering "undersupported despite its importance". It recommends a direct homepage entry to past orders, and an order history detailed enough to identify each order ([Baymard 2026 benchmark](https://baymard.com/research-articles/food-delivery-and-takeout-ux-benchmark-2026)). Use a horizontal "Order again" row of past-order cards (store thumbnail, 2 to 3 item names, total, a "Reorder" button) placed directly under the categories.
5. **Let users edit the cart from checkout.** Baymard found that users often want to change their order once they reach checkout, and some give up if they can't ([Baymard food delivery](https://baymard.com/industries/food-delivery-and-takeout-ux)). Use ± quantity steppers inline on the checkout summary, not a back-navigation step.
6. **Turn on release-build size and obfuscation flags.**
   - Ship an AAB built with `flutter build appbundle --release --obfuscate --split-debug-info=build/symbols`.
   - Measure with `--analyze-size`.
   - Check Play Console → Android vitals → App size ([Flutter app-size](https://docs.flutter.dev/perf/app-size)).
   - Upload the symbol files to Crashlytics.
   
   A small download matters on budget phones with little storage. **[Judgement]** Aim for a download under 20 MB.
7. **Use virtualised lists with fixed-size rows.** Build store lists and menus with `ListView.builder` or `SliverList`. Never build them with `Column(children: [...])` or `ListView(children:)` over a long list ([Flutter perf best practices](https://docs.flutter.dev/perf/best-practices)). Set `itemExtent` or `prototypeItem` wherever row height is uniform ([ListView API](https://api.flutter.dev/flutter/widgets/ListView-class.html)). Instamart's documented problems were exactly this: "app hangs on large SKU lists", memory pressure and high page load times ([Apple Developer, Swiggy](https://developer.apple.com/news/?id=o5spbekm)).
8. **Decode network images at display size.** Use `cached_network_image` 4.x ([pub.dev](https://pub.dev/packages/cached_network_image)) and pass `memCacheWidth` equal to the displayed width × devicePixelRatio. Serve resized WebP images from the server (about 400 px for cards, about 1080 px for banners). Bitmap memory is now a core Android vital, with a 400 MB foreground threshold, and Play may cut visibility over it starting February 2027 ([Android vitals](https://developer.android.com/topic/performance/vitals)). (The memCacheWidth point is **[Judgement]**: the pub.dev page doesn't document it, but it is a parameter of the package's API.)
9. **Rider location: foreground service plus balanced intervals.** On Android 14+, declare `foregroundServiceType="location"` and `FOREGROUND_SERVICE_LOCATION`, and declare the type in Play Console → App content ([FGS types](https://developer.android.com/develop/background-work/services/fgs/service-types)).
   - Use high accuracy only while the rider is on an active delivery.
   - Use balanced or low-power priority, a large `setIntervalMillis`, and `setMaxUpdateDelayMillis` batching when the rider is idle or online-waiting ([Location battery](https://developer.android.com/develop/sensors-and-location/location/battery)).
   - Stop updates entirely when the rider goes offline.
   
   Excessive partial wake locks (5% threshold) is a core vital ([Android vitals](https://developer.android.com/topic/performance/vitals)).
10. **Defer everything non-critical until after the first frame.** Keep work before `runApp()` minimal. Initialise analytics, remote config and messaging in `addPostFrameCallback` ([Firebase blog](https://firebase.blog/posts/2022/03/how-firebase-performance-Monitoring-optimized-app-startup-time), [practitioner write-up](https://omr.it.com/blog/lazy-widget-hydration-flutter-app-launch-under-800ms/)). Use the Android 12+ system splash rather than an animated custom splash, which can distort the startup vital ([Android startup best practices](https://developer.android.com/topic/performance/appstartup/best-practices)). Measure with `flutter run --trace-startup --profile`.
11. **Show live tracking as a status timeline plus an ETA window.** Use four or five status steps (Placed → Store accepted → Preparing → Rider picked up → Arriving), an ETA window such as "25–35 min" rather than a single time ([techinterview DoorDash/Uber Eats design](https://www.techinterview.org/post/3233475300/mobile-system-design-food-delivery-doordash-uber-eats/)), the rider's name, photo and bike number, and call/chat buttons. Uber Eats' Live Activity shows status, ETA, driver name and photo, and the store image ([MacRumors](https://www.macrumors.com/2023/05/02/uber-eats-live-activities/)). On Android, mirror this with one *ongoing, updating* notification per order instead of a separate push for every status, which avoids notification spam ([9to5Mac](https://9to5mac.com/2023/12/04/doordash-live-activities-and-dynamic-island-order-tracking/)). The ongoing-notification part is **[Judgement]**.
12. **Write the Play listing to Google's rules and target both English and Roman Urdu.**
    - Title: 30 characters or fewer.
    - Short description: 80 characters or fewer.
    - Full description: up to 4,000 characters.
    - No "#1", "Best", "Free" or "% off" claims, no emoji in the title, and no keyword stuffing ([Play store listing best practices](https://support.google.com/googleplay/android-developer/answer/13393723?hl=en)).
    - Example title: `ServeNow: Food & Grocery` (24 chars).
    - Short description: see §4.
13. **Use in-app review only after a delivery succeeds.** Trigger `in_app_review` after the second or third delivered order with no complaint, on the "Delivered" screen once the user has rated the rider. Do not ask "Do you like the app?" first, and do not put the API behind a "Rate us" button. For a button, deep-link to the Play listing instead ([In-App Review API](https://developer.android.com/guide/playcore/in-app-review)).
14. **Urdu typography:** Use **Noto Nastaliq Urdu** for Urdu body and headings. Urdu readers report Naskh looks "visually wrong" and that some letter groups are hard to tell apart in Naskh ([Reddit snapshot](https://reddit.sentinel-team.org/posts/1qhxfsk/snapshots/2026-01-20T18%3A25%3A50.260363Z)). Give Nastaliq a line height of about 1.8–2.0 because it clips at normal line heights ([open-design Urdu](https://open-design.ai/plugins/design-system-urdu/), [SuttaCentral](https://discourse.suttacentral.net/t/testing-for-line-height-with-tall-scripts/6196)). Use Noto Naskh Arabic only in dense numeric or compact UI such as prices, chips and badges, where tall Nastaliq lines would break the layout **[Judgement]**. Bundle the fonts as assets rather than fetching them at runtime with `google_fonts` **[Judgement]**.
15. **Use skeleton loaders for content and a spinner only for actions.** Show shimmer skeletons shaped like the real cards (store card, menu row). Left-to-right shimmer is perceived as shorter than pulsing ([UX Collective](https://uxdesign.cc/what-you-should-know-about-skeleton-screens-a820c45a571a)). The evidence that skeletons beat spinners is mixed ([summary of Viget and academic studies](https://dev.to/helloashish99/skeleton-screens-vs-spinners-perceived-load-time-1nlj)). Use spinners only inside buttons ("Placing order…"). Avoid animating `Opacity` in shimmer: use a gradient shader on one `RepaintBoundary` **[Judgement, based on Flutter Opacity/saveLayer guidance]** ([Flutter perf](https://docs.flutter.dev/perf/best-practices)).

---

## 1. UX and visual patterns of leading delivery apps

### 1.1 What the evidence says users value and complain about

| Theme | Evidence | ServeNow implication |
|---|---|---|
| Prepaid orders lost, refunds refused, rider asks for cash again, slow support | [Trustpilot foodpanda.pk p.5](https://www.trustpilot.com/review/foodpanda.pk?page=5), [p.7](https://www.trustpilot.com/review/foodpanda.pk?page=7), [p.8](https://www.trustpilot.com/review/foodpanda.pk?page=8), [Runway Pakistan](https://runwaypakistan.com/?p=26373) | COD-first flow with an explicit "amount to pay rider". A "Paid online — do not collect" state in the rider app. In-app complaint with an order-linked ticket and a promised response time. |
| Delays (one reviewer waited 110 minutes or more), wrong or missing items | Same Trustpilot pages | Honest ETA *ranges*. A "Report missing item" link with item checkboxes and photo upload on the order details screen. |
| Price differs from the restaurant's own menu | [Profit 2017](https://profit.pakistantoday.com.pk/2017/12/18/foodpanda-after-the-highs-hitting-the-proverbial-trough) | **[Judgement]** If prices match the in-store price, say so on the store page with an "In-store prices" badge. |
| Stacked or hidden fees | [Zomato Trustpilot](https://ca.trustpilot.com/review/www.zomato.com?page=6), [ETV Bharat](https://www.etvbharat.com/en/bharat/cost-of-convenience-zomato-swiggy-under-fire-over-high-fees-and-commissions-enn26012005143), [Free Press Journal "veg mode fee"](https://www.freepressjournal.in/viral/being-vegetarian-feels-like-curse-zomato-users-post-goes-viral-after-he-highlights-how-food-app-charged-him-of-veg-mode-enablement-fee) | Show the fee on every card. Keep fee lines to a minimum. |
| Support is scripted or AI-only, or bounced to the restaurant | [Zomato Trustpilot p.10](https://ca.trustpilot.com/review/www.zomato.com?page=10) | Make a human reachable by phone or WhatsApp in a small market. This can beat the big players **[Judgement]**. |
| Reorder undersupported, no back paths, unclear timing | [Baymard 2026](https://baymard.com/research-articles/food-delivery-and-takeout-ux-benchmark-2026) | Order-again row, breadcrumbs and scope labels, ETA shown before commit. |
| Customisation not described on the item page, no dietary filters | [Baymard 2026](https://baymard.com/research-articles/food-delivery-and-takeout-ux-benchmark-2026) | Show "Choose size · Add extras" on the item card. Add filters such as "Spicy", "Halal-certified" and "Family deal" **[Judgement on which filters]**. |
| Large-list jank, slow loads, inconsistent animations (Instamart) | [Apple Developer, Swiggy](https://developer.apple.com/news/?id=o5spbekm) | Performance is a ratings driver. Swiggy reported higher ratings and conversion after fixing it, though it gave no numbers. |

Market context: foodpanda delivers food in 35 Pakistani cities and plans to grow from 6 to 12 million households, so expect it to reach tier-2 cities like Kot Addu ([Arab News](https://www.arabnews.pk/pakistan/delivery-hero-eyes-pakistan-expansion-aims-to-double-foodpanda-operations-in-three-years-2611197)). Pakistan is foodpanda's largest grocery market globally ([Business Recorder](https://www.brecorder.com/news/40399530)). COD is still dominant enough that Mastercard and foodpanda run campaigns against it ([Finextra](https://www.finextra.com/pressarticle/103965/mastercard-takes-on-pakistans-cash-on-delivery-culture-in-collaboration-with-foodpanda)).

### 1.2 Home screen

Pattern across foodpanda, Talabat, Swiggy, Uber Eats and Blinkit/Zepto, drawn from template and case-study sources ([Brucira Zepto](https://brucira-v2.pages.dev/case-studies/zepto), [VP0 q-commerce template](https://vp0.com/blogs/in-blinkit-zepto-10-minute-grocery-delivery-ui-template), [Uber Eats feed/carousels](https://www.tubefilter.com/2024/04/12/uber-eats-for-you-page-restaurant-food-recommendations/), [Uber newsroom](https://www.uber.com/newsroom/arriving-now-the-new-uber-eats)). The concrete layout below is **[Judgement]** built on those patterns:

1. **Top bar (56 dp):** the delivery address as a tappable title ("Deliver to · Home, Block 4 ▾"), a language toggle (EN / اردو), and a cart or notification icon. A location-first top bar is near-universal, and a grocery-first design puts the delivery time at the very top ([VP0](https://vp0.com/blogs/in-blinkit-zepto-10-minute-grocery-delivery-ui-template)).
2. **Search pill (48 dp, full width, `surfaceContainerHigh`):** placeholder text rotates through "Search biryani, atta, doodh…".
3. **Vertical switcher:** two or three large tiles side by side (Food · Grocery · Pharmacy/Shops), each about 96 dp tall with an illustration. foodpanda and Talabat lead with vertical tiles of this kind ([mwm.ai Talabat screenshots](https://mwm.ai/apps/talabat-food-grocery-more/451001072)).
4. **Category chips:** a horizontal scroll of 56 dp circular images with a 12 sp label underneath (Biryani, Pizza, BBQ, Karahi, Fruit & Veg, Dairy). A category list for quick navigation is documented in the Zepto case study ([Brucira](https://brucira-v2.pages.dev/case-studies/zepto)).
5. **"Order again" row:** see takeaway 4.
6. **One promotional banner carousel:** 16:7 cards with 16 dp radius, auto-advance every 5 s, paused while the user touches it, with a dot indicator. **[Judgement]** Limit it to three banners. Uber Eats uses themed carousels ("hidden gems") ([Restaurant Business](https://restaurantbusinessonline.com/technology/uber-eats-updates-app-focus-discoverability)).
7. **Filter chip row:** Fast delivery · Free delivery · Rating 4+ · Offers · COD (all COD) · Open now.
8. **Store list:** a vertical card for each store (see 1.3).

Bottom navigation: Home · Search · Orders · Account, plus a Cart badge if no sticky cart bar is used ([UX practitioner guidance](https://differ.blog/p/designing-a-user-friendly-food-delivery-app-best-practices-3dfe41)). Use the M3 `NavigationBar` at 80 dp with a pill indicator in `secondaryContainer` **[Judgement]**.

### 1.3 Store card

**[Judgement]**, based on common patterns and on Deliveroo moving to image-led layouts in 2026 ([Deliveroo help](https://help.deliveroo.com/en/articles/15278912-why-does-my-menu-look-different-in-the-deliveroo-app)):

- A 16:9 cover image with a 16 dp top radius. An offer ribbon at the top-left ("20% off up to Rs 150"), and a heart (favourite) at the top-right.
- Row 1: store name in Title Medium (16 sp, semibold), then ★ 4.6 (1.2k) on the right.
- Row 2: in Body Small, "25–35 min · Rs 60 delivery · Rs 300 min" followed by the cuisine tags.
- A "Closed · opens 6 pm" overlay at 60% white, with the card still tappable for scheduling.
- Rating and "popular" must use *different* icons. Netguru's Deliveroo critique flagged identical icons for both ([Netguru](https://www.netguru.com/blog/deliveroo-ux-redesign-case-study)).

### 1.4 Store and menu screen

- A collapsing header. The cover image collapses into an app bar with the store name. Below it, an info strip shows rating, ETA, fee, a "More info" link (address, hours, phone and map; Netguru flags a missing map and call option as a gap: [Netguru](https://www.netguru.com/blog/deliveroo-ux-redesign-case-study)), and a store search icon.
- **A sticky tab bar of menu categories** that scroll-spies the list (Popular · Deals · Biryani · Drinks).
- Menu rows. Text is on the left: name, two lines of description, price in bold, and a "Customisable" hint. On the right is an 88–96 dp square image with an **"ADD" button overlapping its bottom edge**, which turns into a − 1 + stepper after the first tap. Grocery rows use a two- or three-column grid with the add button on the image. The always-visible, thumb-reachable one-tap add pattern is documented for Blinkit and Zepto ([Medium Bootcamp](https://medium.com/design-bootcamp/how-smart-design-makes-you-buy-faster-lessons-from-blinkit-zepto-rapido-minimalist-d7b9439da2bd), [Zepto quick-add redesign](https://bavanawork-hugo.pages.dev/posts/simplifying-shopping-zepto-project)).
- **A sticky cart bar** (56 dp, `primary` #15803D, white text): "2 items · Rs 1,180 → View cart". It updates in place on every add ([VP0](https://vp0.com/blogs/in-blinkit-zepto-10-minute-grocery-delivery-ui-template)).

### 1.5 Product or item detail

- Use a bottom sheet (draggable, up to 90% height) rather than a new page, so the menu context stays visible **[Judgement]**. It contains:
  - a 4:3 image at the top
  - the name and description
  - required choices (radio buttons with a "Required" chip)
  - optional extras (checkboxes with prices, such as "+Rs 50")
  - a special-instructions field
  - a sticky "Add 1 for Rs 640" button with a stepper
- Baymard: describe customisation options clearly on the item page ([Baymard 2026](https://baymard.com/research-articles/food-delivery-and-takeout-ux-benchmark-2026)).
- Grocery items: show unit and size ("1 kg", "Pack of 6"), price per kg, and a substitution preference ("If out of stock: call me / replace / remove") **[Judgement]**.

### 1.6 Cart and checkout

- A single-page checkout ([uxdesign.cc checkout case study](https://uxdesign.cc/ui-ux-case-study-designing-a-better-checkout-experience-de91b46b97e8), [Sennalabs](https://sennalabs.com/blog/ux-ui-for-food-delivery-platforms-improving-order-efficiency-and-retention)) with these sections in order:
  1. address card (with map pin preview and an "Add landmark / gali / house colour" field)
  2. delivery time (ASAP 25–35 min, or Schedule)
  3. items with inline steppers ([Baymard](https://baymard.com/industries/food-delivery-and-takeout-ux))
  4. a "You might also need" row (one row only)
  5. voucher field
  6. bill summary (Subtotal, Delivery, Discount, **Total**)
  7. payment, with **Cash on delivery selected by default** and JazzCash, Easypaisa and card as options
  8. a sticky "Place order · Rs 1,240" button
- Baymard: show fulfilment timing in enough detail to commit ([Baymard 2026](https://baymard.com/research-articles/food-delivery-and-takeout-ux-benchmark-2026)).
- For COD orders above a threshold, ask "Will you pay with exact change?" (Yes / I'll pay with Rs 5,000), so the rider brings change **[Judgement, inspired by foodpanda's change prompt in reviews]**.

### 1.7 Live order tracking

- Top half: a map with three pins (store, rider bike icon, home) and a polyline. Bottom sheet:
  - an ETA window in Headline Small ("Arriving 7:40–7:50 pm")
  - a horizontal stepper with the status
  - a rider card with photo, name, bike plate, ★, and Call / WhatsApp buttons
  - "Pay rider: Rs 1,240 (Cash)"
  - an order summary as a collapsible section on the same screen. Users should not have to leave the map to see details ([Boundev](https://www.boundev.ai/blog/food-app-design-ux-guide)).
- Statuses mirror DoorDash and Uber Eats (Preparing → On the way → Delivered) ([digital-dev comparison](https://digital-dev.lib.calpoly.edu/backstage-as/which-is-better-doordash-or-ubereats-a-comprehensive-comparison.html)).
- **[Judgement]** Use a Lottie animation (under 50 KB) for the "Preparing" stage *only when no rider is assigned*, and fall back to a static map on 2 GB devices.

### 1.8 Rider app

- Delivery Hero's rider-app redesign organised content *by rider state*, using a layered "Lasagna" architecture so that each screen shows only what the current state needs ([Delivery Hero tech blog](https://tech.deliveryhero.com/from-streets-to-screens-redesigning-the-rider-app)). Grab's driver case study centres on doing jobs faster, beating traffic and improving ETA ([UX Collective Grab](https://uxdesign.cc/grab-design-challenge-case-study-food-driver-mobile-app-e5d6b65cdd30)). Courier UX should focus on predictability, clarity and speed ([dev.to courier UX](https://dev.to/aartijangid23/ux-design-best-practices-for-a-smooth-courier-delivery-app-experience-3bb8)).
- Concrete layout **[Judgement]**:
  - **One primary action per state**, as a full-width 64 dp swipe-to-confirm button at the bottom (Accept → Arrived at store → Picked up → Arrived → Collected Rs 1,240 → Delivered). Swiping prevents accidental taps while riding.
  - Text at least 18 sp, and buttons at least 56 dp because riders wear gloves and have the sun on the screen.
  - A high-contrast mode.
  - A "Navigate" button that opens Google Maps through an intent; do not build in-app navigation.
  - Big cash display: show "COLLECT Rs 1,240" in `error`-red or green, or "PAID ONLINE — DO NOT COLLECT".
  - An earnings header (Today: Rs 2,350 · 9 orders) and a cash-in-hand ledger to settle with the store.
  - An offline queue: status taps queue locally and retry. Show a "No internet — will sync" banner.
  - Urdu-first labels.

### 1.9 Empty, loading and error states

- Use skeletons that match the card geometry, with a left-to-right shimmer at about 1.2 s per cycle ([UX Collective](https://uxdesign.cc/what-you-should-know-about-skeleton-screens-a820c45a571a)). Use a button spinner for actions.
- Each empty state has an illustration in green line art, one sentence and one action:
  - empty cart: "Your cart is empty" with "Browse stores"
  - no stores: "We're not in your area yet" with "Notify me"
  - no network: "No internet" with "Retry" and an offline cached home
  
  This set is **[Judgement]**.

### 1.10 Micro-interactions **[Judgement unless cited]**

- ADD → stepper morph (200 ms, emphasised easing). A "+1" fly-to-cart pulse on the cart bar. The heart scales to 1.2 and back on favourite.
- The order-placed screen shows a green check animation (600 ms) and a light haptic.
- Haptics should be sparing ("less is more"; frequent low-stakes = subtle) ([Android haptics principles](https://developer.android.com/develop/ui/views/haptics/haptics-principles)). Use `HapticFeedback.selectionClick()` for steppers and chips, and `lightImpact()` for add-to-cart and order placed ([Flutter HapticFeedback](https://api.flutter.dev/flutter/services/HapticFeedback-class.html)).

### 1.11 Search

- Use recent searches, popular searches near the user ("Biryani", "Doodh", "Anday"), and autosuggest grouped into Stores / Dishes / Products ([Sennalabs](https://sennalabs.com/blog/ux-ui-for-food-delivery-platforms-improving-order-efficiency-and-retention)).
- **[Judgement]** Search must match Roman Urdu and Urdu synonyms: doodh = milk = دودھ, anday = eggs, atta = flour, chawal = rice, sabzi = vegetables. Keep a synonym table on the server.
- Careem Quik lets users upload a photo of a shopping list to find items. This is a strong idea for grocery in Pakistan, where shoppers often bring a handwritten list ([Careem engineering](https://engineering.careem.com/tech/posts/heres-everything-you-can-get-in-15-minutes-with-careem-quik)).

### 1.12 Ratings and trust signals

- Rate the store and the rider separately after delivery: 5 stars plus quick tags ("Hot food", "Polite rider", "Late") **[Judgement]**.
- Show the review count next to the rating (★ 4.6 · 1.2k).
- Trust signals:
  - a "Verified store" badge
  - a "Cash on delivery available" icon on cards
  - transparent fees
  - the rider's photo and plate
  - a visible support number
  - a refund policy one tap away

---

## 2. Material 3 and Flutter for a premium look

### 2.1 Colour roles for ServeNow

- Use `ColorScheme.fromSeed(seedColor: Color(0xFF15803D))`, then **override `primary` to exactly #15803D**, because the seeded tone is usually lighter. Then set the surfaces explicitly to keep the white and light-grey brand. The values below are **[Judgement]**; the M3 role docs at m3.material.io couldn't be fetched because the page is JS-rendered:
  - `primary` #15803D / `onPrimary` #FFFFFF. The contrast of white on #15803D is about 5.0:1, which passes WCAG AA 4.5:1 for normal text ([WCAG threshold summary](https://dev.to/kanta13jp1/flutter-accessibility-semantics-screen-readers-and-wcag-168m)). The ratio is my own calculation.
  - `primaryContainer` #DCFCE7 / `onPrimaryContainer` #14532D, for selected chips, offer ribbons and the nav indicator.
  - `surface` #FFFFFF. `surfaceContainerLowest` #FFFFFF for cards. `surfaceContainerLow` #F8FAF9 for the page background. `surfaceContainer` #F1F5F3. `surfaceContainerHigh` #E9EEEB for the search pill.
  - `outlineVariant` #E5E7EB for card borders (1 dp) instead of heavy shadows. Card elevation 0 or 1.
  - `error` #B91C1C. Use a tertiary amber #B45309 for "ratings" and "few left".
  - Leave dark mode for later, but derive it from the same seed.
- Avoid green text on light-green backgrounds for body copy, and keep `onPrimaryContainer` dark.

### 2.2 Typography scale

- The M3 baseline type scale has 15 roles: display, headline, title, body and label, each in L, M and S. Examples: Display L 57/64, Body M 14/20, Label S 11/16 ([M3 typography summary](https://skills.sh/shelbeely/shelbeely-agent-skills/material-design-3-typography), [Compose M3 Typography](https://developer.android.com/reference/kotlin/androidx/compose/material3/Typography)).
- ServeNow mapping **[Judgement]**:

  | Role | Use |
  |---|---|
  | Headline S 24 | screen titles |
  | Title L 22 | store name on store page |
  | Title M 16 w600 | card titles |
  | Body M 14 | descriptions |
  | Body S 12 | meta (ETA, fee) |
  | Label L 14 w600 | buttons |
  | Label M 12 | chips |

  Use tabular figures for prices (`FontFeature.tabularFigures()`).
- Font: Plus Jakarta Sans for Latin text, in the app as well as on the web, for brand consistency. Bundle weights 400, 600 and 700 only **[Judgement]**.
- Urdu: Noto Nastaliq Urdu with `height: 1.8–2.0`. Bump the Urdu font size by about 10–15%, because Nastaliq's x-height is visually smaller. Set `TextLeadingDistribution.even` ([Flutter line-height notes](https://zenn.dev/matsuchiyo/scraps/7e7db753d34e9b), [open-design Urdu](https://open-design.ai/plugins/design-system-urdu/)). The size bump is **[Judgement]**.

### 2.3 Urdu font choice and its trade-offs

| Font | Legibility for Urdu readers | Layout and performance |
|---|---|---|
| Noto Nastaliq Urdu | The culturally expected Urdu style. Readers say Naskh Urdu "looks wrong" and is harder for some letter groups ([Reddit](https://reddit.sentinel-team.org/posts/1qhxfsk/snapshots/2026-01-20T18%3A25%3A50.260363Z)) | Needs about 1.8× line height or it clips ([open-design](https://open-design.ai/plugins/design-system-urdu/)). A heavier file than Gulzar ([urdufonts.com](https://urdufonts.com/gulzar-vs-noto-nastaliq-fonts)). Its complex shaping may cost more per glyph **[Judgement]**. Android doesn't ship it as a default per user reports ([Reddit](https://reddit.sentinel-team.org/posts/1sk1oge/snapshots/2026-04-17T23%3A14%3A28.858841Z)), so bundle it. |
| Noto Naskh Arabic | Readable, but feels "Arabic" to Urdu readers. It is the right default for Arabic and Sindhi ([fontconfig issue](https://gitlab.freedesktop.org/fontconfig/fontconfig/-/issues/173)) | Compact lines that fit chips and badges. |
| Gulzar | Described as legible | Lighter, but "limited digital support" per the vendor ([urdufonts.com](https://urdufonts.com/gulzar-vs-noto-nastaliq-fonts)). Not recommended. |

No controlled study or benchmark exists, and none was found. Test with 5 to 10 local users at 12–16 sp sizes **[Judgement]**.

### 2.4 RTL

**[Judgement]**, standard Flutter practice:

- Use `Directionality` through `MaterialApp.locale` ('ur') with `flutter_localizations`.
- Use `EdgeInsetsDirectional` and `AlignmentDirectional` everywhere.
- Mirror back arrows, but never mirror the map, phone numbers or prices. Keep prices in Latin digits for consistency with receipts.
- Test every screen in both directions with golden tests.

### 2.5 Motion

- Flutter M3 duration tokens: short1 50 ms … short4 200 ms, medium1 250 ms … medium4 400 ms, long1 450 ms … long4 600 ms, extralong1–4 700–1000 ms ([Flutter Durations](https://api.flutter.dev/flutter/material/Durations-class.html)).
- Use about 200 ms (short4) for buttons and steppers, 300 ms (medium2) for sheets and page transitions, and `Curves.easeInOutCubicEmphasized` **[Judgement on mapping]**.
- Respect `MediaQuery.disableAnimations`.

### 2.6 Accessibility

- Minimum 48×48 dp tap targets (`kMinInteractiveDimension = 48`). Contrast 4.5:1 for text and 3:1 for large text ([summary](https://dev.to/kanta13jp1/flutter-accessibility-semantics-screen-readers-and-wcag-168m), [Android accessibility](https://d.android.com/guide/topics/ui/accessibility/apps)).
- Add `Semantics` labels to icon buttons, such as "Add Chicken Biryani to cart".
- Add widget tests using `meetsGuideline(androidTapTargetGuideline)` and `textContrastGuideline` ([same source](https://dev.to/kanta13jp1/flutter-accessibility-semantics-screen-readers-and-wcag-168m)).
- Swiggy treats accessibility as an ongoing programme ([Swiggy ESG](https://blog.swiggy.com/esg/more-accessible-every-day/)).

---

## 3. Flutter performance that measurably matters

### 3.1 Frame budget and rebuilds ([Flutter perf best practices](https://docs.flutter.dev/perf/best-practices))

- The budget is 16 ms per frame at 60 Hz. Aim for about 8 ms build and 8 ms raster, and under 8 ms total for 120 Hz. Profile on the *lowest* supported device in profile mode.
- Avoid expensive work in `build()`. Call `setState` low in the tree. Prefer small `StatelessWidget`s over helper functions. Pass static subtrees as `child` to `AnimatedBuilder`.
- Use `const` constructors wherever possible so Flutter can skip rebuilding those subtrees ([Josh Software](https://blog.joshsoftware.com/2024/09/30/flutter-performance-optimization-a-comprehensive-guide/)). Enforce `prefer_const_constructors` in `analysis_options.yaml` **[Judgement]**.
- Minimise `saveLayer`, which `ShaderMask`, `ColorFilter`, `Opacity` and `Chip` can trigger. Draw semi-transparent colours directly. Use `AnimatedOpacity` and `FadeInImage`. Use `borderRadius` instead of `ClipRRect` where possible, and don't clip inside animations.
- Use `RepaintBoundary` around the tracking map and around shimmer or animated widgets ([Capitalnumbers](https://www.capitalnumbers.com/blog/flutter-performance-optimization)).
- With Riverpod or Bloc, use `select` and `buildWhen` so that, for example, a cart-count change rebuilds only the badge **[Judgement]**.

### 3.2 Lists

- Use lazy builders (`ListView.builder`, `SliverList.builder`, `GridView.builder`). Don't use concrete children lists. Avoid intrinsic layout passes by giving grid cells fixed sizes ([Flutter perf](https://docs.flutter.dev/perf/best-practices)).
- Use `itemExtent` or `prototypeItem` for uniform rows ([ListView API](https://api.flutter.dev/flutter/widgets/ListView-class.html)). Paginate store lists 20 at a time and grocery categories 30 at a time **[Judgement]**.

### 3.3 Images

- Use `cached_network_image` 4.0.5, which sits on `flutter_cache_manager` and has `placeholder`, `errorWidget` and `progressIndicatorBuilder` ([pub.dev](https://pub.dev/packages/cached_network_image)).
- **[Judgement]** Practical rules:
  - set `memCacheWidth`
  - have the server resize to WebP at 2 or 3 widths
  - `precacheImage` the first two banners after the first frame
  - cap the `ImageCache.maximumSizeBytes` at about 100 MB on low-RAM devices
  
  This ties to the bitmap-memory vital ([Android vitals](https://developer.android.com/topic/performance/vitals)).

### 3.4 Shader jank

- Impeller has been the default since Flutter 3.27 on iOS and on Android API 29+ with Vulkan, falling back to OpenGL on older devices ([Impeller](https://docs.flutter.dev/perf/impeller)). It precompiles shaders at engine-build time, which removes runtime shader-compile stutter.
- Upgrade to a current Flutter stable. Test on an Android 9 or 10 device (the OpenGL path) as well **[Judgement]**.

### 3.5 Start-up

- Keep the path before `runApp` minimal. Defer Firebase Analytics, Remote Config, FCM token registration and so on until after the first frame ([Firebase](https://firebase.blog/posts/2022/03/how-firebase-performance-Monitoring-optimized-app-startup-time)).
- Use the Android 12+ splash API ([Android startup](https://developer.android.com/topic/performance/appstartup/best-practices)).
- Measure with `--trace-startup` ([summary](https://dev.to/thanasistraitsis/flutter-app-taking-too-long-to-start-heres-what-youre-doing-wrong-2a05)).
- **[Judgement]** Render the home screen from the last cached JSON (Hive or SharedPreferences) immediately, then refresh.

### 3.6 App size ([Flutter app-size](https://docs.flutter.dev/perf/app-size), [Shorebird release notes](https://docs.shorebird.dev/flutter-concepts/releasing-flutter-apps/))

- Use an AAB, so Play serves per-ABI and per-DPI splits. `--split-per-abi` only matters for side-loaded APKs, such as the rider APK shared on WhatsApp **[Judgement]**.
- Use `--obfuscate --split-debug-info`, and keep the symbols.
- Icon tree-shaking is on by default in release builds, but this does not cover non-Material icon fonts like FontAwesome. Prefer Material Symbols or SVGs ([Shorebird](https://docs.shorebird.dev/flutter-concepts/releasing-flutter-apps/), [itnext](https://itnext.io/flutter-minimizing-tips-42113f02b678)).
- Compress PNG and JPEG files, remove unused assets, and subset the fonts. Nastaliq is large, so lazy-load it when the user switches to Urdu, if possible **[Judgement]**.
- Deferred components (Android, AAB only) can move admin and store-owner-only screens out of the customer install ([Flutter app-size](https://docs.flutter.dev/perf/app-size)). **[Judgement]** Simpler: ship separate customer, rider and store apps (flavours) rather than one app with role switching.

### 3.7 Network **[Judgement, standard practice]**

- Use one shared `http.Client` or `Dio` instance, so connections are reused (keep-alive and TLS session reuse).
- Use gzip and brotli responses, ETag / `Cache-Control` on the catalogue endpoints, and paginated APIs.
- Set a timeout of about 15 s with retry and backoff for idempotent GETs.
- Make order placement idempotent with an idempotency key. This prevents duplicate orders on flaky 3G and 4G, which matters given how much of Pakistan's network is 2G ([Dawn](https://www.dawn.com/news/amp/1964994)).

### 3.8 Rider background location and battery

- Use a `location` foreground service with a persistent notification, `FOREGROUND_SERVICE_LOCATION`, and a Play Console declaration ([FGS types](https://developer.android.com/develop/background-work/services/fgs/service-types)). Request `ACCESS_BACKGROUND_LOCATION` only if truly needed. Background apps are throttled to a few updates per hour ([Android background location limits](https://developer.android.com/about/versions/oreo/background-location-limits)).
- Use high accuracy only for real-time tracking in the foreground. Otherwise use balanced or low power, the largest acceptable interval, and `setMaxUpdateDelayMillis` batching ([Android location battery](https://developer.android.com/develop/sensors-and-location/location/battery)).
- **[Judgement]** Values:

  | Rider state | Priority | Interval | Min distance |
  |---|---|---|---|
  | On an active delivery | High accuracy | 5–10 s | 20 m |
  | Online and waiting | Balanced | 60 s | 100 m |
  | Offline | none: stop all updates | none | none |

  Send positions to the server in batches, at most every 10 s. Avoid wake locks.

---

## 4. Google Play ASO for a delivery app in Pakistan

### 4.1 Limits and rules ([Play store listing best practices](https://support.google.com/googleplay/android-developer/answer/13393723?hl=en))

- Title: 30 characters or fewer, unique, no "Free" or "No Ads" deal words, no emoji, no all-caps.
- Short description: 80 characters or fewer, with the biggest benefits first.
- Full description: 4,000 characters or fewer. Use everyday language, no keyword lists or repetition, and don't repeat the short description. Testimonials must be attributed.
- Prohibited everywhere, including translations: ranking claims ("#1", "Best", "Popular"), prices or promotions in graphics ("10% off"), comparisons with other apps, and anonymous testimonials.
- Play indexes the title, the short description and the full description. There is no keyword field ([tessl ASO](https://tessl.io/registry/skills/github/Eronred/aso-skills/android-aso)).

### 4.2 Draft metadata **[Judgement]**

- **Title (EN):** `ServeNow: Food & Grocery` (24 chars). An alternative is `ServeNow Food Delivery` (22 chars).
- **Short description (EN, 80 chars or fewer):** `Order food & groceries in Kot Addu. Cash on delivery, live tracking, fast riders.` (79 chars). Check the count when entering it.
- **Urdu listing (ur-PK):** Title `سرو ناؤ: کھانا اور گروسری`. Short description `کھانا اور سودا سلف گھر منگوائیں۔ کیش آن ڈیلیوری، لائیو ٹریکنگ۔`
- **Full description structure:**
  1. a one-line value proposition
  2. "Why ServeNow", with five bullets (COD, no hidden charges, live tracking, local stores, Urdu support)
  3. "What you can order"
  4. "Cities": Kot Addu, Faisalabad, and so on
  5. "Support"
  
  Weave keywords in naturally 2 or 3 times each.
- **Keyword set** (English, Roman Urdu and Urdu). Roman Urdu volumes are unverified, so validate with Play Console's "Search terms" acquisition report after launch:
  - English: food delivery, grocery delivery, online grocery, order food, restaurant, cash on delivery, Kot Addu, Faisalabad, Muzaffargarh, Multan, pizza, biryani, burger, pharmacy, fruits vegetables.
  - Roman Urdu: khana, khana order, ghar pe delivery, sauda / sauda salaf, kiryana, sabzi, doodh, atta.
  - Urdu: کھانا، ڈیلیوری، گروسری، سودا، کریانہ.
  - One source confirms that Pakistan metadata should use local search terms, not literal translations ([appdrift Pakistan](https://appdrift.co/app-store-optimization/pakistan/food-drink)). Generic "delivery" and "food" are highly competitive ([AppGoblin](https://appgoblin.info/apps/6737129770/keywords/discovery)), so win on **local and city terms** first.
- **Custom store listings:** target by country, campaign or URL. Each country can have only one custom listing, and custom listings don't auto-localise, so add Urdu manually ([Play custom store listings](https://play.google.com/console/about/customstorelistings/), [AppTweak](https://www.apptweak.com/en/aso-blog/custom-store-listings)). Use a campaign-URL custom listing for Kot Addu flyers and QR codes **[Judgement]**.
- **Store listing experiments:** A/B test the icon, then the first screenshot, then the short description, one at a time ([Play experiments](https://play.google.com/console/about/customstorelistings/)).

### 4.3 Graphics

- **Icon:** 512×512. Use a white or green field with one simple mark and no text. Keep it consistent with the other listing graphics ([Play best practices](https://support.google.com/googleplay/android-developer/answer/13393723?hl=en)).
- **Feature graphic:** 1024×500, JPEG or 24-bit PNG without alpha. Keep the key content centred and the text minimal ([Adalo](https://studio.adalo.com/blog/google-play-screenshot-sizes), [Play best practices](https://support.google.com/googleplay/android-developer/answer/13393723?hl=en)). Pure white and black backgrounds blend into Play's own UI, so use the green #15803D field with a white wordmark and a food-and-grocery photo collage ([Medium analysis of 3,300 feature graphics](https://medium.com/app-store-optimization-monthly/what-analyzing-3-300-feature-graphics-has-taught-us-about-google-play-store-aso-4ada57048da4)).
- **Screenshots:** 1080×1920 portrait. At least 2 are required; provide 4 or more, which are needed for some recommendation surfaces. Each side must be 320–3840 px with an aspect ratio no wider than 2:1 ([Adalo](https://studio.adalo.com/blog/google-play-screenshot-sizes), [catdoes](https://catdoes.com/blog/play-store-screenshot-size)). Provide separate Urdu versions, because screenshots contain text ([Play best practices](https://support.google.com/googleplay/android-developer/answer/13393723?hl=en)).
- **Recommended order and captions** **[Judgement]**, with no "% off" or "#1" in any of them:
  1. Home: "Food & groceries in Kot Addu"
  2. Cash on delivery: "Pay cash at your door"
  3. Live tracking: "Track your rider live"
  4. Menu: "Your favourite local restaurants"
  5. Grocery: "Atta, doodh, sabzi — delivered"
  6. Urdu UI: "اردو میں دستیاب"
- **Video:** an optional 20–30 s YouTube trailer ([Play best practices](https://support.google.com/googleplay/android-developer/answer/13393723?hl=en)).

### 4.4 Ratings strategy

- In-app review rules ([In-App Review API](https://developer.android.com/guide/playcore/in-app-review)):
  - Ask only after a meaningful experience.
  - Don't ask any question before showing the card.
  - Don't modify or overlay the card.
  - The quota is time-bound and undisclosed, so calls within about a month may not show anything.
  - Never put the API behind a button.
  - The API doesn't say whether the user reviewed, so continue the flow either way.
- **[Judgement]** Trigger logic:
  - The order is delivered, the user gave the rider 4 or 5 stars, it is their 2nd or later delivered order, there has been no support ticket in the last 7 days, and no prompt in the last 60 days. Then call `InAppReview.instance.requestReview()`.
  - A low in-app rating routes to in-app support, not to Play. Don't ask a "Do you like the app?" question first, because Google forbids it.
  - Reply to every Play review within 24 h in the language the review was written in.

### 4.5 Android vitals that affect ranking ([Android vitals](https://developer.android.com/topic/performance/vitals))

| Vital | Threshold | ServeNow risk |
|---|---|---|
| User-perceived crash rate | 1.09% overall, 8% per phone model | Low-RAM Tecno and Infinix devices, Nastaliq or maps crashes |
| User-perceived ANR rate | 0.47% overall, 8% per model | Synchronous prefs, DB or JSON work on the main isolate; use `compute()` / isolates for large JSON **[Judgement]** |
| Excessive partial wake locks | 5% | Rider location service |
| Memory and bitmap memory | Device-tier based; bitmap 400 MB foreground. Visibility impact from Feb 2027 | Unsized network images |

Play evaluates the last 28 days. "Emerging issues" are flagged after 7 days, which leaves 21 days to fix them.

---

## Sources (consolidated)

- Google Play listing rules: https://support.google.com/googleplay/android-developer/answer/13393723?hl=en
- Android vitals: https://developer.android.com/topic/performance/vitals ; https://android-developers.googleblog.com/2022/10/raising-bar-on-technical-quality-on-google-play.html
- In-app review: https://developer.android.com/guide/playcore/in-app-review
- Custom store listings: https://play.google.com/console/about/customstorelistings/ ; https://www.apptweak.com/en/aso-blog/custom-store-listings
- Flutter perf: https://docs.flutter.dev/perf/best-practices ; app size https://docs.flutter.dev/perf/app-size ; Impeller https://docs.flutter.dev/perf/impeller ; ListView https://api.flutter.dev/flutter/widgets/ListView-class.html ; Durations https://api.flutter.dev/flutter/material/Durations-class.html ; HapticFeedback https://api.flutter.dev/flutter/services/HapticFeedback-class.html
- Android location and FGS: https://developer.android.com/develop/sensors-and-location/location/battery ; https://developer.android.com/develop/background-work/services/fgs/service-types ; https://developer.android.com/about/versions/oreo/background-location-limits
- Android haptics: https://developer.android.com/develop/ui/views/haptics/haptics-principles
- Baymard: https://baymard.com/research-articles/food-delivery-and-takeout-ux-benchmark-2026 ; https://baymard.com/industries/food-delivery-and-takeout-ux
- Swiggy native transition: https://developer.apple.com/news/?id=o5spbekm
- Delivery Hero rider app: https://tech.deliveryhero.com/from-streets-to-screens-redesigning-the-rider-app
- Uber Eats / DoorDash Live Activities: https://www.macrumors.com/2023/05/02/uber-eats-live-activities/ ; https://9to5mac.com/2023/12/04/doordash-live-activities-and-dynamic-island-order-tracking/
- Careem Quik: https://engineering.careem.com/tech/posts/heres-everything-you-can-get-in-15-minutes-with-careem-quik
- Deliveroo menus 2026: https://help.deliveroo.com/en/articles/15278912-why-does-my-menu-look-different-in-the-deliveroo-app ; Netguru critique https://www.netguru.com/blog/deliveroo-ux-redesign-case-study
- foodpanda Pakistan reviews and market: https://www.trustpilot.com/review/foodpanda.pk?page=5 ; https://runwaypakistan.com/?p=26373 ; https://www.arabnews.pk/pakistan/delivery-hero-eyes-pakistan-expansion-aims-to-double-foodpanda-operations-in-three-years-2611197 ; https://www.brecorder.com/news/40399530 ; https://www.finextra.com/pressarticle/103965/mastercard-takes-on-pakistans-cash-on-delivery-culture-in-collaboration-with-foodpanda
- Pakistan devices and data: https://www.dawn.com/news/amp/1964994 ; https://www.techjuice.pk/pakistan-ranks-6th-globally-for-cheapest-mobile-data/
- Urdu typography: https://reddit.sentinel-team.org/posts/1qhxfsk/snapshots/2026-01-20T18%3A25%3A50.260363Z ; https://gitlab.freedesktop.org/fontconfig/fontconfig/-/issues/173 ; https://open-design.ai/plugins/design-system-urdu/ ; https://urdufonts.com/gulzar-vs-noto-nastaliq-fonts ; https://zenn.dev/matsuchiyo/scraps/7e7db753d34e9b
- Skeletons: https://uxdesign.cc/what-you-should-know-about-skeleton-screens-a820c45a571a ; https://dev.to/helloashish99/skeleton-screens-vs-spinners-perceived-load-time-1nlj
- Graphics specs: https://studio.adalo.com/blog/google-play-screenshot-sizes ; https://medium.com/app-store-optimization-monthly/what-analyzing-3-300-feature-graphics-has-taught-us-about-google-play-store-aso-4ada57048da4
