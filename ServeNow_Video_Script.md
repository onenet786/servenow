# ServeNow — Pro-Developer Video Walkthrough Script (Scene-by-Scene)
**Platform Scope:** Dual-Client (Flutter Mobile Application + Enterprise Web Admin Console)  
**Language:** Roman Urdu + English Mix | **Estimated Video Duration:** 12 - 14 Minutes  
**Use Case:** Screen Recording (Loom, OBS Studio, Camtasia, Screen Studio)

---

## 🎬 Recording Setup & Technical Guidelines
1. **Screen Layout:** Split-screen or dual-window recording recommended:
   - **Left Window:** Android Emulator or Mobile Mirror running ServeNow Flutter app (`mobile_app/`).
   - **Right Window:** Web Browser running ServeNow Enterprise Console (`admin.html`).
2. **Audio & Voiceover:** High clarity, clear pacing, emphasizing technical filenames and architectural business rules.

---

## SCENE 1: Introduction & Dual-Client Architectural Overview
- **Duration:** 00:00 - 01:30
- **On-Screen Visuals:**
  - Screen displays side-by-side: Flutter Mobile App splash screen switching into `CustomerDashboardTestScreen.dart` on mobile emulator, alongside `admin.html` dashboard on web browser.
- **Screen Ka Maqsad & Justification:**
  - Viewer ko batana ke ServeNow sirf ek simple website nahi, balke multi-client enterprise delivery ecosystem hai (Node.js API + MySQL + Socket.IO + Flutter Mobile App + Web Admin).
- **Voiceover Script (Roman Urdu + English):**
  > *"Assalam-o-Alaikum! Aaj is video walkthrough mein hum ServeNow platform ka real-world, screen-by-screen operational flow dekhenge.*  
  > *ServeNow multi-vendor grocery aur on-demand delivery ka complete platform hai jisme do major client applications ek hi Node.js aur Socket.IO backend se real-time communicate karti hain:*  
  > *Pehla client hamari Flutter Mobile Application hai jo `mobile_app/lib/screens/` mein 31 dedicated screens par mushtamil hai — jisme Customers, Store Owners, aur Delivery Riders ke specialized dashboards hain.*  
  > *Doosra client hamara Web Operations Command Center hai jo `admin.html` ke tehat 24 enterprise tabs aur double-entry accounting engine operate karta hai.*  
  > *Chalein, hum customer mobile experience se shuru karte hain!"*

---

## SCENE 2: Mobile Customer Flow — `CustomerDashboardTestScreen` to `CheckoutScreen`
- **Duration:** 01:30 - 04:30
- **On-Screen Visuals:**
  - **Screen 1:** `CustomerDashboardTestScreen.dart` open hai. Presenter top bar par unread notification bell aur Urdu language toggle button (`CustomerLanguage.dart`) demonstrate karta hai.
  - Promo banner carousel scroll hota hai. Global delivery notice bar ("All Zones Active") point out karein.
  - Presenter "Fresh Mart Supermarket" store card par click karta hai jo `StoreScreen.dart` open karta hai.
  - "Farm Fresh Milk" par click karke `ProductDetailScreen.dart` kholta hai; size variant dropdown se "1 Liter TetraPak" select karke cart mein add karta hai.
  - Bottom navigation bar se `CartScreen.dart` aur phir `CheckoutScreen.dart` par jata hai.
  - Payment method mein **ServeNow Digital Wallet** (`WalletScreen.dart` balance) select karke order confirm karta hai.
- **Screen Ka Maqsad & Justification:**
  - Single-store cart check enforce karta hai, variant-level pricing calculate karta hai, aur wallet atomic balance deduction lock execute karta hai.
- **User Decision:**
  - Customer grocery store, product variant, delivery address, aur payment mode (COD vs Wallet vs Card) decide karta hai.
- **Voiceover Script (Roman Urdu + English):**
  > *"Ab hum mobile app ke primary landing screen `CustomerDashboardTestScreen` par hain. Notice karein ke top bar par live notification bell aur Urdu localization toggle mojood hai jo dynamic directionality change karta hai.*  
  > *Yahan auto-scrolling promo carousel store campaigns show karta hai aur global delivery status check karta hai.*  
  > *Jab hum 'Fresh Mart' store kholte hain, to `StoreScreen.dart` load hoti hai. Product detail screen par hamare paas size variants aur active offer discounts live render hotay hain.*  
  > *Cart screen par single-store guard validate karta hai ke items different stores se mix na hon.*  
  > *Checkout par hum ServeNow digital wallet select karte hain. Backend atomic transaction chala kar balance deduct karta hai aur order `#ORD-1048` create karke instant Socket.IO event store owner ko transmit karta hai."*

---

## SCENE 3: Store Owner Mobile Operations — `StoreOwnerDashboardScreen`
- **Duration:** 04:30 - 07:00
- **On-Screen Visuals:**
  - Mobile emulator par user ko `StoreOwnerDashboardScreen.dart` par switch karein.
  - Jaise hi customer order place karta hai, real-time notification sound chime play hota hai aur `New Orders` tab mein Order `#ORD-1048` appear hota hai.
  - Presenter **"Accept & Start Preparing"** button click karta hai (Status `preparing` ho jata hai).
  - Kitchen checklist review karta hai aur packaging complete hone par **"Mark as Ready for Pickup"** par click karta hai.
  - `OfferCampaignsScreen.dart` aur `StoreBalancesScreen.dart` ki navigation tiles show karein.
- **Screen Ka Maqsad & Justification:**
  - Kitchen preparation latency ko eliminate karta hai aur order items ready hone par dispatch algorithm ko trigger karta hai.
- **User Decision:**
  - Store owner items availability verify karta hai aur preparation state decide karta hai.
- **Voiceover Script (Roman Urdu + English):**
  > *"Ab hum Store Owner ke dashboard `StoreOwnerDashboardScreen.dart` par aate hain. Screen par page refresh kiye baghair Socket.IO ke through naya incoming order popup ho chuka hai aur audio alert baj chuka hai.*  
  > *Merchant yahan items verify karke 'Accept Order' karta hai jis se customer ko instant alert milta hai ke uski grocery pack ho rahi hai.*  
  > *Jaise hi items bag mein pack ho jati hain, store owner 'Mark Ready' click karta hai. Yeh action hamare automated dispatch engine ko trigger karta hai taake nearby active rider ko assignment bheji jaye.*  
  > *Yahan se merchant `OfferCampaignsScreen` par ja kar Buy-X-Get-Y aur discount promotions bhi configure kar sakta hai."*

---

## SCENE 4: Rider Live Telemetry & Execution — `RiderDashboardScreen`
- **Duration:** 07:00 - 09:30
- **On-Screen Visuals:**
  - Mobile app par `RiderDashboardScreen.dart` open karein.
  - Duty Online toggle button active hai.
  - Screen par new delivery notification aati hai. Rider assignment open karta hai.
  - Customer contact icons highlight karein: Phone Call (`tel:`), SMS (`sms:`), aur direct WhatsApp (`https://wa.me/`).
  - Presenter **"Confirm Pickup at Store"** click karta hai.
  - Phir customer address par drop-off karke **"Mark Delivered"** confirm karta hai.
- **Screen Ka Maqsad & Justification:**
  - Physical goods handover, background GPS coordinate streaming (`RiderBackgroundTrackingService`), aur cash custody verify karta hai.
- **User Decision:**
  - Rider duty availability toggle karta hai aur customer se direct call ya WhatsApp par communication karta hai.
- **Voiceover Script (Roman Urdu + English):**
  > *"Yeh hamari rider application `RiderDashboardScreen.dart` hai. Hamara rider active aur duty online tha.*  
  > *Active delivery card par rider ke paas direct 1-click Phone Call aur WhatsApp button mojood hai taake customer ke landmark ko locate kiya ja sake.*  
  > *Background service rider ke coordinates customer map par stream karti hai.*  
  > *Rider store pickup confirm karta hai aur customer ko parcel de kar 'Mark Delivered' press karta hai.*  
  > *Agar order Cash on Delivery hota to rider pehle cash verify karta, jo backend rider-cash ledger mein add ho jata."*

---

## SCENE 5: Enterprise Web Command Center — `admin.html` & Financial Vouchers
- **Duration:** 09:30 - 13:00
- **On-Screen Visuals:**
  - Browser par full-screen `admin.html` open karein.
  - Sidebar navigation ke 24 tabs dikhayein: Dashboard, Accounts, Stores, Products, Orders, Financial Engine, Catalog, Reports.
  - **Orders Dispatch Tab (`#orders`):** Order `#ORD-1048` ka status `Delivered` verify karein aur manual rider override option dikhayein.
  - **CPV Tab (`#payment-vouchers`):** Automated Cash Payment Voucher check karein jo order deliver hone par store settlement payout ke liye generate hua.
  - **Store Settlements Tab (`#store-settlements`):** Gross sales minus 10% commission minus platform fee breakdown dikhayein.
  - **Rider Cash Tab (`#rider-cash`):** Rider Ahmed Ali ka cash balance ledger aur CRV cash submission flow dikhayein.
  - **Reports & P&L Statement (`#financial-reports`):** Net operating margin analytics graph display karein.
- **Screen Ka Maqsad & Justification:**
  - Audit compliance, double-entry financial reconciliation, store payouts transparency, aur rider cash loss prevention.
- **User Decision:**
  - Administrator commission rates configure karta hai, store payouts approve karta hai, aur rider cash debt clear karta hai.
- **Voiceover Script (Roman Urdu + English):**
  > *"Ab hum aate hain ServeNow ke Enterprise Command Center `admin.html` par. Yeh screen platform operations aur accounting ka full-scale nerve center hai.*  
  > *Orders tab mein hum dekh sakte hain ke Order `#ORD-1048` successfully delivered status par switch ho chuka hai. Agar emergency ho to admin yahan se kisi bhi rider ko force-assign kar sakta hai.*  
  > *Financials section mein hamara Double-Entry accounting engine chalta hai: CPV (Cash Payment Voucher) automatic create hota hai jisme store ki sales minus 10% platform commission calculate hoti hai.*  
  > *Store Settlements tab se admin verified IBAN bank accounts par payouts release karta hai, aur Rider Cash tab se delivery agents ka daily COD cash reconcile karta hai.*  
  > *Yeh level of audit transparency cash leakages ko 100% prevent karta hai."*

---

## SCENE 6: Conclusion & Operational Summary
- **Duration:** 13:00 - 14:00
- **On-Screen Visuals:**
  - Side-by-side view of mobile app and web console with green status indicators.
- **Voiceover Script (Roman Urdu + English):**
  > *"To yeh tha ServeNow ka mukammal operational walkthrough!*  
  > *Humne dekha ke kaise 31 Flutter mobile screens aur 24 web admin tabs ek robust architecture ke sath connect hotay hain — 1-click customer order se le kar, store packaging, rider background tracking, aur enterprise double-entry accounting tak.*  
  > *Tamam detailed screens catalog aur technical justifications ke liye hamari User Guide aur System Logic documentation zaroor refer karein. Shukriya!"*

---
*End of Pro-Developer Video Walkthrough Script.*
