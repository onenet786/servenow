# ServeNow.pk — Official Operations Manual & Complete User Guide
**Platform Domain:** `servenow.pk` | **Powered by:** OneNet Solutions Pakistan  
**Version:** 2.4 Production Release | **Language:** Roman Urdu + English Mix  
**Reference UI:** 1:1 Matched with Official ServeNow Web Admin Console & Flutter Mobile App

---

## 📌 Platform Identity & System Architecture

ServeNow (`servenow.pk`) Pakistan (Lahore & surrounding metropolitan hubs) ka enterprise on-demand grocery aur multi-vendor delivery ecosystem hai. Yeh platform chaar (4) key operational roles ko live synchronize karta hai:
- **Customers**: Flutter Mobile App aur Web Storefront ke zariye nearby verified supermarkets aur restaurants se grocery/food order karte hain.
- **Store Owners (Merchants)**: Live kitchen queue (`StoreOwnerDashboardScreen.dart` / `admin.html#stores`), product variations, aur store settlement balances monitor karte hain.
- **Delivery Fleet (Riders)**: Bike riders jo `RiderDashboardScreen.dart` ke zariye live GPS stream karte hain, customer ko direct WhatsApp karte hain, aur Cash on Delivery (COD) collect karte hain.
- **Operations & Finance Administrators**: `admin.html` ke official console (jaisa ke attached live screenshot mein dikhaya gaya hai) ke zariye orders dispatch, live radar, Double-Entry financial vouchers (CPV / CRV), aur store settlements govern karte hain.

---

# SECTION 1: WEB ADMIN OPERATIONS CONSOLE (`admin.html`)
*(Directly Aligned with the Live System Interface shown in the Screenshot)*

```
+---------------------------------------------------------------------------------------------------------+
| SERVENOW OPERATIONS CONSOLE (admin.html)                                                                |
+---------------------+-----------------------------------------------------------------------------------+
| SIDEBAR MENU        | ACTIVE WORKSPACE: Dashboard Overview                                              |
| [Logo] ServeNow     |                                                                                   |
| > Dashboard         | Today's Orders:                                                                   |
| v Accounts          | [ 0 TOTAL ORDERS ] [ 0 TOTAL DELIVERED ] [ 0 PENDING ORDERS ] [ 0 CANCELLED ]     |
| v Stores            |                                                                                   |
| - Products          | All Orders:                                                                       |
| - Orders            | [ 5330 TOTAL ORDERS ] [ 5290 DELIVERED ] [ 3 PENDING ] [ 37 CANCELLED ]           |
| v Payments & Wallets|                                                                                   |
| v Reports           | Recent Activity:                                                                  |
| v Catalog           | | NEW ORDERS          | NEW USERS              | NEW STORES                      | |
| v Financial         | | #5658 (out_for_del) | Muhammad Sarim         | Halwa Puri By Faisalabad Bakery | |
| - Settings          | | #5657 (delivered)   | Sabih Khan             | Al Hudayah Restaurant           | |
| - Utilities         +-----------------------------------------------------------------------------------+
| - Problems          | Bottom Sidebar: [THEME: Default (Save)] [Logout]                                  |
+---------------------+-----------------------------------------------------------------------------------+
```

---

### 1.1 Dashboard Overview (The Live Mission Control)

Jab administrator `admin.html` par login karta hai, to sab se pehle **Dashboard Overview** screen display hoti hai:

#### A. Today's Orders (Row 1 Stat Cards)
Rozana subah 12:00 AM se le kar current time tak ke live metrics:
1. **TOTAL ORDERS (Blue Left-Border Card)**: Aaj ke din book hone wale kul orders ki tadad (Current: `0`).
2. **TOTAL DELIVERED (Green Left-Border Card)**: Aaj successfully deliver hone wale orders (Current: `0`).
3. **PENDING ORDERS (Orange Left-Border Card)**: Kitchen ya store mein pack hone wale orders (Current: `0`).
4. **CANCELLED (Red Left-Border Card)**: Customer ya merchant ki taraf se cancel hone wale orders (Current: `0`).

#### B. All Orders (Row 2 Stat Cards — Cumulative Platform Performance)
Platform ke start se le kar aaj tak ka mukammal lifetime record:
1. **TOTAL ORDERS**: `5,330` Orders (Gross orders processed by ServeNow platform).
2. **TOTAL DELIVERED**: `5,290` Orders (99.2% Successful Delivery Fulfillment Rate).
3. **PENDING ORDERS**: `3` Orders (Active in pipeline).
4. **CANCELLED**: `37` Orders (Total platform cancelations).

#### C. Recent Activity Feed (3-Column Real-Time Activity Grid)
1. **NEW ORDERS Column (Blue Border Cards)**:
   - `New Order #5658` — Status: `out_for_delivery - PKR 200.00` | Timestamp: `9/15/2026 10:40 PM`
   - `New Order #5657` — Status: `delivered - PKR 650.00` | Timestamp: `9/15/2026 10:34 PM`
2. **NEW USERS Column (Green Border Cards)**:
   - `New User Registered` — Name: `Muhammad Sarim` | Timestamp: `9/15/2026 08:16 PM`
   - `New User Registered` — Name: `Sabih Khan` | Timestamp: `9/15/2026 06:18 PM`
3. **NEW STORES Column (Orange Border Cards)**:
   - `New Store "Halwa Puri By Faisalabad Bakery"` — `Store registered` | Timestamp: `9/14/2026 08:54 AM`
   - `New Store "Al Hudayah Restaurant"` — `Store registered` | Timestamp: `7/27/2026 08:52 PM`

---

### 1.2 Sidebar Navigation Structure (All Modules & Dropdowns)

Sidebar dark navy background (`#16172b`) par mabni hai jisme tamam administrative modules darj hain:

1. **Dashboard (`admin.html#dashboard`)**:
   - High-level KPI overview aur live activity feed.

2. **Accounts (Dropdown Menu `v`)**:
   - **`Users` (`#accounts`)**: Registered customers aur admins ki directory; role switch (`customer` ➔ `admin` / `store_owner`) aur account suspend/activate controls.
   - **`Riders` (`#riders`)**: Delivery fleet roster, bike numbers (e.g. `LEA-8910`), license verification, aur rider fuel logs.
   - **`User Rights` (`#user-rights`)**: Granular Role-Based Access Control (RBAC) permission groups (Finance, Dispatcher, Catalog Supervisor).

3. **Stores (Dropdown Menu `v`)**:
   - **`Stores List` (`#stores`)**: Merchant onboarding, commission rate setup (e.g. 10% standard), address, aur operating hours.
   - **`Store Status & Notice` (`#store-status`)**:
     - *Live Store Status*: Store open/closed indicators with Grace alerts for stores taking >20 mins.
     - *Delivery Notice (`#store-status-delivery`)*: Global delivery control (Normal, Heavy Rain Warning delay, or Service Block).
     - *Push Broadcast (`#store-status-broadcast`)*: Firebase instant push notifications to All Customers, Riders, or Merchants.
     - *Customer Flash Message (`#store-status-flash-message`)*: Full-screen emergency alert modal for customer app.
   - **`Offer Campaigns` (`#store-status` offer section)**: Percentage discounts aur Buy-X-Get-Y (BXGY) promotional deals supervisor.
   - **`Customer Tile Demo` (`customer_tile_demo.html`)**: Alternate customer storefront visual testing sandbox.

4. **Products (`#products`)**:
   - Master product catalog with multi-store filter, stock availability switches, base price, cost price, and size variants.

5. **Orders (`#orders`) (Operations Desk)**:
   - **Header Action Buttons**:
     - `<button id="openManualOrderBtn"><i class="fas fa-plus"></i> Create Manual Order</button>`
     - `<button id="openParcelOrderBtn"><i class="fas fa-box"></i> Pick & Drop Parcel</button>`
   - **Filter Queue**: Filter by Date Mode (Today / Custom Range), Assignment status (Unassigned / Assigned), Rider, Store, and Order Status.
   - **Live Orders Queue Table**: Displays Order Number, Customer Name, Store Name, Amount, Status, and **Manual Reassign Button** (force-assigning any order to a specific rider).

6. **Payments & Wallets (Dropdown Menu `v`)**:
   - **`Payments` (`#payments`)**: Online credit/debit card logs via Stripe with transaction IDs.
   - **`Wallets` (`#wallets`)**: Customer and rider in-app digital wallets balance management with manual credit/debit audit adjustments.

7. **Reports (Dropdown Menu `v`)**:
   - **`Order Reports` (`#order-reports`)**: Date-range order volume exports.
   - **`Inventory Report` (`#inventory-report`)**: Low stock alerts and valuation.
   - **`Sale Reports` (`#sale-reports`)**: Revenue velocity by day/week/month.
   - **`Rider Reports` (`#rider-reports`)**: Delivery times, earnings, and ratings.
   - **`Store Reports` (`#store-reports`)**: Merchant sales rankings.
   - **`Store Payment Term Report` (`#store-payment-term-reports`)**: Payment terms compliance.

8. **Catalog (Dropdown Menu `v`)**:
   - **`Categories` (`#categories`)**: Grocery categories setup (Dairy, Bakery, Beverages, Meat).
   - **`Units` (`#units`)**: Measurement units (kg, liter, gram, pack, piece).
   - **`Sizes` (`#sizes`)**: Standard variant labels (Small, Medium, Large, 250ml, 500ml, 1 Liter).

9. **Financial (Double-Entry Accounting Dropdown Menu `v`)**:
   - **`CPV (Cash Payment Voucher)` (`#payment-vouchers`)**: Record cash outflows for store payouts, supplier expenses, and petty cash.
   - **`CRV (Cash Receive Voucher)` (`#receipt-vouchers`)**: Reconcile daily Cash on Delivery (COD) cash deposited by riders.
   - **`Store Settlements` (`#store-settlements`)**: Automated net merchant payable calculations ($\text{Gross Sales} - \text{10\% Platform Commission}$) with verified IBAN bank transfer release.
   - **`Rider Cash Debt` (`#rider-cash`)**: Real-time monitoring of cash held by every delivery agent with a strict **Rs. 15,000 threshold limit** (new COD orders block ho jate hain agar limit cross ho).
   - **`BPV`, `BRV`, `JNV`**: Bank Payment Vouchers, Bank Receive Vouchers, and Journal Vouchers.
   - **`Financial Dashboard` (`#financial-dashboard`)**: Live Profit & Loss (P&L), gross margin, and operating margins.

10. **System Maintenance & Settings**:
    - **`Settings` (`#settings`)**: Platform configurations.
    - **`Utilities` (`#db-backup`)**: Database backup generation, SQL export, and database shrink/optimize tools.
    - **`Problems` (`#problems`)**: Data integrity diagnostic checking orphan orders, missing foreign keys, or negative wallet balances.
    - **`Change Password`**: Administrator credential security update modal.

11. **Sidebar Footer Controls**:
    - **THEME Box**: Dropdown menu (`Default`, `Ocean`, `Emerald`, `Sunset`, `Mint`, `Pearl`, `Rose`, `Sky`) with `Save` button.
    - **Logout Link**: Invalidate JWT session and redirect to `login.html`.

---

# SECTION 2: FLUTTER MOBILE APP WORKFLOWS (`mobile_app/lib/screens/`)

Flutter application ServeNow ke signature **CustomerPalette** (`#E06A2E` Terracotta, `#147D7E` Teal, `#FFF4EA` Cream, `#F2B134` Saffron) par design hai:

### 2.1 Customer Ordering Journey (`CustomerDashboardTestScreen.dart`)
1. **Launch & Area Detection**: App customer ka live area detect karti hai (e.g. *Gulberg III, Lahore*).
2. **Urdu Localization**: Top bar par **"اردو"** button dabane par app RTL directionality aur Urdu labels (*ہوم, دکانیں, کارٹ, آرڈرز, والیٹ*) par switch ho jati hai.
3. **Global Delivery Status**: Banner alert verify karta hai ke delivery zones active hain ya rain delay hai.
4. **Store & Product Selection (`StoreScreen.dart` / `ProductDetailScreen.dart`)**:
   - Customer store open status check karta hai (e.g. *Halwa Puri By Faisalabad Bakery* ya *Fresh Mart*).
   - Size variant dropdown select karta hai (e.g. *Olper's Milk 1 Liter TetraPak* ya *Dawn Bread Large*).
   - Promotional discount badges check karta hai.
5. **Cart Single-Store Guard (`CartScreen.dart`)**:
   - Customer ek waqt mein sirf ek store se order book kar sakta hai taake delivery fleet fast dispatch ho sake.
6. **Checkout (`CheckoutScreen.dart`)**:
   - Delivery address enter karein.
   - Payment select karein: **Cash on Delivery (COD)**, **ServeNow Digital Wallet** (instant 1-click debit), ya **Credit Card (Stripe)**.
   - **"Place Order"** dabate hi Order ID generate hoti hai (e.g. `#5659`) aur instant Socket.IO chime alert merchant ke dashboard par bajta hai.

---

### 2.2 Store Owner (Merchant) Kitchen Operations (`StoreOwnerDashboardScreen.dart`)
1. **Three Order Tabs**:
   - `New Orders`: Naye incoming orders jinhe merchant ne accept karna hai.
   - `Active Orders`: Kitchen preparation aur packing queue (`Preparing`, `Ready`, `Out for Delivery`).
   - `Order History`: Completed aur cancelled orders.
2. **Action: "Accept & Prep"**: Merchant sound alert sun kar items verify karta hai aur button click karta hai. Order status `preparing` ho jata hai.
3. **Action: "Mark as Ready for Pickup"**: Packaging complete hone par merchant button dabata hai. Yeh action automated dispatch engine ko trigger karta hai taake qareebi active rider ko order assign ho sake.

---

### 2.3 Delivery Rider Fleet Operations (`RiderDashboardScreen.dart`)
1. **Duty Online Switch**: Rider shift shuru karte hi toggle switch on karta hai, jis se background GPS service coordinates broadcast karna shuru kar deti hai.
2. **Direct Customer Communication**:
   - Active order card par teen (3) 1-click communication buttons mojood hain:
     - 📞 **Call Button (`tel:03001234567`)**: Direct phone call.
     - 💬 **SMS Button (`sms:03001234567`)**: Pre-filled SMS.
     - 🟢 **WhatsApp Button (`https://wa.me/923001234567`)**: Direct WhatsApp chat customer ke sath house landmark verify karne ke liye.
3. **Execution**:
   - Rider store pohnch kar **"Confirm Pickup at Store"** click karta hai (status `out_for_delivery`).
   - Customer doorstep par pohnch kar: agar COD ho to exact cash collect karta hai, aur **"Mark Payment Received"** aur **"Mark Delivered"** confirm karta hai.
   - System rider ke debt account mein collected cash add kar deta hai jo din ke aakhir mein hub par जमा hota hai.

---

# SECTION 3: DOUBLE-ENTRY ACCOUNTING & FINANCIAL INTEGRITY

ServeNow platform enterprise audit standards follow karta hai. Jab bhi koi order deliver hota hai:

$$\text{Store Net Payable} = \text{Gross Order Amount} - \text{10\% Platform Commission}$$

### Automated Accounting Voucher Flow:
1. **Customer Payment**: Cash / Wallet account debit hota hai.
2. **CPV (Cash Payment Voucher)**: System auto-generate karta hai (e.g. `CPV-5657` for PKR 585.00) jo merchant ke payable ledger mein record hota hai.
3. **CRV (Cash Receive Voucher)**: Jab rider din bhar ka COD cash office cashier ko submit karta hai, cashier CRV post karta hai jis se rider ka debt zero ho jata hai.
4. **Store Settlement**: Admin `admin.html#store-settlements` tab se merchant ke verified Meezan Bank / HBL IBAN par net payment release karta hai.

---

# SECTION 4: TROUBLESHOOTING & COMMON OPERATIONAL ISSUES

| Issue | Root Cause (Technical) | Operator Resolution Step |
| :--- | :--- | :--- |
| **Store Grace Alert Beeping** | Store ne order ko 20 minutes se ziada `pending` rakha hai. | Merchant dashboard par ja kar order ko **"Accept & Prep"** karein taake delay timer reset ho jaye. |
| **"Different Store in Cart" Block** | Customer ne Store A ke baad Store B ka item add kiya. | Single-store policy active hai. Cart screen par ja kar previous store ka cart clear karein. |
| **Rider Cannot Receive Orders** | Rider ka cash debt Rs. 15,000 threshold exceed kar chuka hai. | Rider company hub par cash deposit karwaye. Admin `admin.html#receipt-vouchers` me CRV post karega to limit unblock ho jayegi. |
| **Socket Realtime Disconnect** | Network timeout ya device sleep mode. | Page refresh karein ya check karein ke server heartbeat `/health` endpoint par active hai. |

---

# SECTION 5: FREQUENTLY ASKED QUESTIONS (FAQS)

**Q1: servenow.pk ka admin dashboard screenshot mein All Orders 5330 kyun dikha raha hai?**  
*Jawab:* Yeh platform ka real-world cumulative database count hai jo ServeNow par process hone wale kul orders (`5,290 Delivered`, `37 Cancelled`, `3 Pending`) ka mukammal audit record zahir karta hai.

**Q2: Cash on Delivery (COD) orders mein rider cash kahan track hota hai?**  
*Jawab:* Admin console ke `admin.html#rider-cash` tab mein har rider ka "Cash in Hand" running balance live track hota hai. Agar koi rider Rs. 15,000 se ziada cash hold kare to system use naye orders dena block kar deta hai.

**Q3: Kya admin kisi order ko force-assign kar sakta hai?**  
*Jawab:* Haan! Orders Management desk (`admin.html#orders`) par har order ke sath **"Manual Reassign"** button mojood hai jis se operations team kisi bhi specific rider ko emergency mein order assign kar sakti hai.

---
*Official Production Operations Manual for servenow.pk. Aligned with Live Codebase & Admin Screenshots.*
