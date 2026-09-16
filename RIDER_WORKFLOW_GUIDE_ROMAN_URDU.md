# ServeNow — Mukammal Rider Workflow Guide (0 Se Aakhri Step Tak)

> **Document Version:** 1.0.0  
> **Zaban:** True Roman Urdu (Asaan aur Saaf Rozmarra Alfaz)  
> **Kiske Liye Hai:** Riders, Fleet Managers, Dispatchers, aur Developers  
> **System Scope:** Rider Mobile App, Admin Dashboard, Dispatch Engine, aur Financial Ledger

---

## Workflow Ka Mukammal Khaka (Lifecycle Diagram)

```mermaid
flowchart TD
    A[Step 0: Admin Office Me Rider Ka Account Banana] --> B[Step 1: Rider Ka App Me Login Hona]
    B --> C[Step 2: Shift Shuru, Advance Cash Float aur Petrol Meter Entry]
    C --> D[Step 3: Duty Online Karna aur Live GPS Tracking On Hona]
    D --> E[Step 4: Naya Order Assign Hona aur Bell Notification Aana]
    E --> F[Step 5: Store Par Pohanch Kar Khana Pick Karna]
    F --> G[Step 6: Order Status 'Out for Delivery' Update Hona]
    G --> H[Step 7: Customer Ki Location Par Pohanchana]
    H --> I{Payment Method Kya Hai?}
    I -- Cash on Delivery (COD) --> J[Customer Se Pura Cash Wasool Karna -> Jeb Me Cash Barha]
    I -- Online / Prepaid Card --> K[Customer Se 0 PKR Lena -> Khana Handover Karna]
    J --> L[Step 8: Order 'Delivered' Mark Karna -> Delivery Fee Kamana]
    K --> L
    L --> M{Kya Mazeed Orders Hain?}
    M -- Haan --> E
    M -- Shift Ka Waqt Khatam --> N[Step 9: Petrol Ki Aakhri Meter Reading Darj Karna]
    N --> O[Step 10: Jeb Ka Pura Cash Admin Ko Jama Karwana (Cash Drop)]
    O --> P[Step 11: Day Close Lock Karna aur Duty Offline Karna]
```

---

## Phase 1: Rider Ka Account Banana aur Registration (Step 0)

### 1.1 Admin Panel Se Account Banana
Rider khud app se direct sign-up nahi kar sakta. Rider ka account hamesha **Operations Admin** banata hai:
- **API Endpoint:** `POST /api/riders` (Sirf Admin ke paas access hota hai).
- **Zaroori Maloomat:**
  - **Pura Naam:** First Name aur Last Name
  - **Email Address:** Unique login ID
  - **Mobile Phone Number:** Contact ke liye
  - **Password:** Strong password jo `bcrypt` se hash ho kar mehfooz hota hai
  - **Sawari Ki Qisam (Vehicle Type):** Motorcycle, Bicycle, Scooter, ya Car
  - **Driving License Number**
- **Dastawizaat (KYC & Documents):**
  - **CNIC Number:** Format `XXXXX-XXXXXXX-X`
  - **Shanakhti Card Ki Tasweer (Front & Back)**
  - **Rider Ki Apni Profile Picture:** Jo customer aur store ko nazar aati hai
- **Shuruati Status:**
  - `is_active = TRUE` (Account active hai)
  - `is_available = FALSE` (Abhi duty par nahi hai, offline hai)

### 1.2 Rider Ka Digital Wallet Shuru Hona
Account bante hi system automatic rider ka ek khata (digital wallet) khol deta hai:
- Shuruati balance: `0.00 PKR`
- Yeh wallet rider ke rozana delivery commission aur company hisab kitab ke liye hota hai.

---

## Phase 2: Duty Shuru Karna, Login aur Cash Float (Shift Start)

### 2.1 App Me Login Karna
- **API Endpoint:** `POST /api/auth/login`
- Rider apna email aur password enter karta hai.
- System check karta hai ke rider `is_active = true` hai ya nahi.
- Login hone par rider ko JWT security token milta hai aur app direct **Rider Dashboard** open karti hai.

### 2.2 Office Float / Cash Advance Lena
Raste me khulay paisay (change) dene ya emergency ke liye office se rider ko starting cash milta hai:
- System me entry: `advance` (Rider Cash Movements).
- **Asar:** Rider ki jeb me cash barh jata hai aur yeh rider ki zimmedari me shamil ho jata hai.

### 2.3 Petrol Meter Ki Reading Darj Karna
- **API Endpoint:** `POST /api/riders/:id/fuel-history`
- Shift shuru karte waqt bike ke speedometer ki reading enter ki jati hai:
  - `start_meter` (Shuruati meter reading, maslan: 12450 km)
  - `petrol_rate` (Aaj ka petrol rate per liter)
  - `fuel_cost` (Agar office ne petrol ke liye paise diye hain)

### 2.4 Duty Online Karna aur GPS Tracking On Hona
- Rider app me **Online / Available** ka switch on karta hai:
  - System me `is_available = TRUE` ho jata hai.
- App ki **Background Tracking Service** background me active ho jati hai:
  - Rider ke GPS coordinates har thori der baad server ko send hote hain (`POST /api/orders/rider/location`).
  - Admin ke live radar map par rider ki bike chalti hui nazar aana shuru ho jati hai.

---

## Phase 3: Naya Order Assign Hona (Dispatch)

### 3.1 Order Dispatch Ka Amal
1. Customer mobile app ya website se order deta hai.
2. Store order accept karke khana banana shuru karta hai (`pending` → `confirmed` → `preparing` → `ready`).
3. Dispatcher ya Automatic Engine nazdeeki online rider ko order assign karta hai:
   - **API Endpoint:** `POST /api/orders/:id/assign-rider`
   - Order par `rider_id` lag jata hai.
   - Rider ke mobile par zordar ghanti (bell notification) bajti hai.

### 3.2 Rider Dashboard Par Order Nazar Aana
- Rider ke dashboard ke **Tab 1 (Active Deliveries)** me order ka card aa jata hai:
  - **Store Ka Naam aur Pata**
  - **Customer Ka Naam aur Pata**
  - **Khane Ki Items aur Total Bill**
  - **Payment Type:** Waziha likha hota hai ke yeh **Cash on Delivery (COD)** hai ya **Prepaid (Card/Wallet)**.

---

## Phase 4: Store Par Jana aur Khana Pick Karna

### 4.1 Store Tak Ka Safar
- Rider **Navigate to Store** ka button dabata hai, Google Maps direct store ka rasta dikhana shuru kar deta hai.
- Agar rasta na milay ya koi masla ho to app me direct **Call Store** aur **WhatsApp Store** ka button mojood hota hai.

### 4.2 Store Ko Cash Ada Karna (Agar Zaroori Ho)
- Agar store counter par instant cash mangta hai:
  - Rider apne paas mojood cash me se store ko khane ke paise deta hai.
  - Iski entry system me `store_payment` ke tor par darj hoti hai.
  - **Asar:** Rider ki jeb se cash kam ho jata hai aur sham ke hisab me company se adjust hota hai.

### 4.3 Khana Check Karna aur 'Pick Up' Dabana
- Rider counter par order number match karta hai aur items check karta hai.
- Rider app me **Pick Up / Out for Delivery** ka button dabata hai:
  - Order ka status `out_for_delivery` ho jata hai.
  - Customer ko mobile par notification chali jati hai: *"Aapka khana rider ne pick kar liya hai aur raste me hai!"*

---

## Phase 5: Customer Tak Delivery aur Live Rasta

### 5.1 Raste Ka Live Safar
- Rider app me **Navigate to Customer** dabata hai.
- Safar ke doran rider ki live location customer ki screen par bike icon ke sath real-time move hoti rehti hai.
- Customer ko accurate pohnchne ka time (ETA) nazar aata rehta hai.

### 5.2 Customer Ke Ghar Pohnchna
- Ghar ke bahar pohnch kar rider app se direct customer ko **Call** ya **SMS** karta hai ke *"Bahar tashreef le aaiye, aapka order pohnch gaya hai."*

---

## Phase 6: Payment Wasool Karna aur Order Mukammal Karna

### 6.1 Do Qisam Ki Payments (COD vs Online)

| Payment Ka Tareeqa | Customer Kya Karega? | Rider Kya Karega? | System Me Payment Status |
| :--- | :--- | :--- | :--- |
| **Cash on Delivery (COD)** | Khane aur delivery ka pura cash rider ko dega. | Cash ginn kar jeb me rakhega. Rider ke **Jeb Ka Cash barh jata hai**. | Rider app me payment ko `'paid'` mark karega. |
| **Prepaid (Card / Wallet)** | Customer pehle hi online pay kar chuka hota hai. | Customer se **0 PKR** lega. Sirf khana handover karega. | Pehle se hi `'paid'` hota hai. |

### 6.2 Order Delivered Mark Karna
- Khana handover karne ke baad rider **Mark Delivered** ka button dabata hai:
  - **API Endpoint:** `PUT /api/orders/:id/status` with `status: 'delivered'`.
  - Order delivery complete ho jati hai.
- **Kamai Ka Hisab (Earnings):**
  - Is order ki **Delivery Fee** foran rider ke earnings ledger me jama (credit) ho jati hai.
  - Agar COD tha, to pura order amount rider ki cash wasooli (`cash_collection`) me darj ho jata hai.

---

## Phase 7: Rider Ki Jeb Ka Cash Flow (Daily Cash Hisab)

ServeNow me **Physical Cash in Hand (Jeb Ka Cash)** aur **Digital Wallet (App Ka Balance)** do alag cheezain hain:

### 7.1 Rider Ki Jeb Me Mojood Cash Ka Formula
Din ke kisi bhi waqt rider ki jeb me kitna company ka cash mojood hona chahiye:

$$\text{Jeb Me Mojood Cash} = (\text{Office Se Mila Float} + \text{Customer Se Wasool Shuda COD}) - (\text{Store Ko Diye Gaye Paise} + \text{Petrol Kharcha} + \text{Office Me Jamah Karwaya Cash})$$

- **Office Advance:** Subah jo khula paisa office ne diya.
- **COD Wasooli:** Jo cash din bhar customers se collect kiya.
- **Store Payments:** Jo cash restaurants ko unke khane ke badle diya.
- **Fuel Paid:** Jo petrol bike me dalwaya.
- **Cash Drops:** Jo darmiyan me office me jamah karwaya.

### 7.2 Digital Wallet Ka Maqsad
- Rider ki mehnat ka delivery commission wallet me jama hota rehta hai.
- Rider app ke **Wallet Tab** me ja kar apna daily, weekly aur monthly hisab live dekh sakta hai.

---

## Phase 8: Shift Khatam, Cash Jamah Karwana aur Day Close (End Step)

### 8.1 Aakhri Meter Reading aur KMs Ka Hisab
- Shift khatam hone par rider bike ke speedometer ki aakhri reading app me darj karta hai:
  - `end_meter` (Maslan: 12530 km)
  - System total chalay gaye kilometers calculate karta hai: $12530 - 12450 = 80 \text{ km}$.
  - Petrol ki consumption aur cost save ho jati hai.

### 8.2 Office Me Cash Drop Jamah Karwana
1. Rider hub / office pohnch kar cashier / admin ke samne baithta hai.
2. App dikhati hai ke rider ki jeb me kitna net cash hona chahiye (maslan: `14,500 PKR`).
3. Rider physical cash admin ko ginn kar deta hai:
   - System me entry hoti hai: `cash_submission` (Rider Cash Movement) ya Cash Receipt Voucher (CRV).
   - Admin approval dete hi rider ki cash zimmedari wapas **0.00 PKR** ho jati hai (hisab barabar).

### 8.3 Day Close Lock Karna (Rozana Hisab Khatam)
- **API Endpoint:** `POST /api/orders/rider/close-day`
- Rider ya Admin din ka final **Close Day** button dabata hai:
  - Din ki total deliveries, kamaya gaya delivery fee, wasool shuda COD, petrol aur store payments ek snapshot ban kar `rider_day_closings` table me hamesha ke liye lock ho jati hain.
  - Iske baad us din ke hisab me koi tabdeeli nahi ho sakti.

### 8.4 Duty Offline Karna
- Rider app me switch daba kar **Offline** ho jata hai:
  - System me `is_available = FALSE` ho jata hai.
  - Background GPS tracking mukammal band ho jati hai taake mobile ki battery mehfooz rahay.
  - Rider safe tareeqay se logout kar ke ghar ja sakta hai.

---

## Database Tables Ka Khulasa (Summary)

| Table Ka Naam | Rider Workflow Me Iska Kaam |
| :--- | :--- |
| `riders` | Rider ka profile, gari ki detail, mobile number, active status aur online/offline status (`is_available`). |
| `wallets` | Rider ka digital wallet balance aur total delivery earnings. |
| `wallet_transactions` | Wallet me aane aur jane wale har rupay ka ba-qaida audit record. |
| `orders` | Har order ki detail, assigned rider ID (`rider_id`), addresses, aur status (`pending` ta `delivered`). |
| `rider_location_logs` | Rider ke safar ka live GPS breadcrumb record. |
| `riders_fuel_history` | Speedometer meter reading, safar ke total kilometers aur petrol ka kharcha. |
| `rider_cash_movements` | Jeb ke cash ka hisab: Advance, COD wasooli, Store ko payment, aur Office me submission. |
| `rider_day_closings` | Din ke aakhir me lock hone wala mukammal hisab kitab ka snapshot. |
| `financial_transactions` | Company ka central double-entry ledger jo office vouchers ko connect karta hai. |
