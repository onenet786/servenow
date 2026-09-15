# ServeNow — System Logic, Architecture & Module Justifications ("WHY")
**Document Version:** 2.4 | **Language:** Roman Urdu + English Mix | **System:** ServeNow Core Platform

---

## 1. Executive Summary & Architectural Overview

ServeNow ek event-driven, distributed client-server architecture par mabni hai. Backend RESTful API aur WebSocket (Socket.IO) dono protocols ko use karta hai taake high-volume multi-vendor orders, rider telemetry (GPS), aur double-entry financial ledger operations ko real-time execute kiya ja sake.

```
       [ Client Apps ]
  (Customer / Store / Rider / Admin)
          |        ^
   HTTP/REST       | Socket.IO WebSockets
          v        |
   [ Express API Gateway & Auth Guard ]
          |
    +-----+-----+-----+-----+-----+
    |     |     |     |     |     |
 [Auth] [Stores][Orders][Rider][Wallet][Financial]
    |     |     |     |     |     |
    +-----+-----+-----+-----+-----+
          |
   [ MySQL 5.7+ / MariaDB Pool with ACID Transactions ]
```

---

## 2. End-to-End Data Flow Pipeline (Input se Output tak)

ServeNow ka core workflow ek circular lifecycle par chalta hai:

### Phase 1: Order Inception & Inventory Check (Customer -> Orders API)
1. **Request:** Customer cart items ke sath `POST /api/orders` hit karta hai.
2. **Atomic Validation:**
   - Server MySQL connection pool se transaction shuru karta hai (`START TRANSACTION`).
   - Har item ki store verification hoti hai (Ensure single store per order).
   - Product stock quantity check hoti hai: `stock >= requested_quantity`.
   - Agar Active Campaign / Promo code mojood ho to discount formula apply hota hai:
     $$\text{Discounted Price} = \text{Original Price} - \left(\text{Original Price} \times \frac{\text{Discount \%}}{100}\right)$$
3. **Payment Locking:**
   - Agar payment method **Wallet** hai: Customer ka wallet record lock hota hai (`FOR UPDATE`), balance check hota hai, aur instant deduct hota hai.
   - Agar payment method **COD** hai: Order `payment_status = 'pending'` ke sath save hota hai.
4. **Order Persist & Event Emission:**
   - Record `orders` aur `order_items` tables me commit ho jata hai.
   - Server `io.to('store_<store_id>').emit('new_order', orderData)` event fire karta hai.
   - Store owner ke device par audio chime aur screen update trigger ho jati hai bina page refresh kiye.

---

### Phase 2: Store Acceptance & Packaging (Store -> Orders API)
1. **Status Update:** Store owner order dekh kar `PUT /api/orders/:id/status` bhejta hai with `status: 'preparing'`.
2. **Customer Alert:** Server foran customer ki socket room `user_<customer_id>` ko `order_status_updated` bhejta hai.
3. **Ready for Pickup:** Jab packaging complete hoti hai, store status `ready` karta hai.
4. **Dispatch Trigger:** Jaise hi order `ready` hota hai, dispatch algorithm nearby active riders (`is_online = 1`, `is_assigned = 0`) ko identify karta hai aur targeted notification bhejta hai.

---

### Phase 3: Rider Assignment & Telemetry (Rider -> Dispatch Engine)
1. **Rider Acceptance:** Rider `POST /api/orders/:id/assign-rider` trigger karta hai.
2. **Race-Condition Safety:** Server verify karta hai ke order pehle se kisi doosre rider ko assign to nahi ho gaya (`assigned_rider_id IS NULL`).
3. **Telemetry Streaming:** Rider ki mobile app background/foreground GPS service se har 10-15 seconds mein coordinates send karti hai:
   `POST /api/orders/rider/location` `{"latitude": 31.5204, "longitude": 74.3587}`.
4. **Broadcast to Customer:** Server yeh coordinates customer ke map screen par stream karta hai.

---

### Phase 4: Delivery Handover & Financial Settlement
1. **Delivery Completion:** Rider customer ko saman de kar `PUT /api/orders/:id/status` (status: `delivered`) send karta hai.
2. **Cash Reconciliation (Agar COD ho):**
   - System rider ke ledger account me `cash_in_hand = cash_in_hand + order_total` update karta hai.
3. **Accounting Entries Creation (`routes/financial.js`):**
   - Double-entry standard ke mutabiq automatic journal entries post hoti hain:
     - **Store Credit:** `Store Payable = Order Items Total - Platform Commission`.
     - **Platform Revenue:** `Platform Commission + Delivery Fee`.
     - **Rider Balance:** `Delivery Fee share credited to Rider`.

---

## 3. Har Module ka Justification aur "WHY" (Risk Analysis)

Har module ko software mein shamil karne ki mantiqi wajah (justification) aur agar us module ko delete ya disable kar diya jaye to kya masail aayenge, niche tafseel se bayan hain:

---

### Module 1: Authentication & RBAC (Role-Based Access Control)
- **Kyun Zaroori Hai (Justification):**  
  Platform par 4 mukhtalif roles hain. Customer ko doosron ka data nahi dikhna chahiye, Rider ko sirf apni delivery dikhni chahiye, Store Owner ko sirf apne products aur sales manage karni chahiye, aur Admin ko poore platform ka audit control hona chahiye.
- **Agar Yeh Module Na Ho To Kya Masla Aayega (Failure Impact):**
  - **Catastrophic Security Leak:** Koi bhi user URL change karke doosre customers ka personal address aur phone number dekh sakega.
  - **Unauthorized Price Changes:** Customer kisi bhi product ki price `0` karke free shopping kar lega.
  - **Financial Theft:** Store owner doosre store ki payment payout apne bank account me transfer kar sakega.

---

### Module 2: Real-time Socket.IO Communication Engine
- **Kyun Zaroori Hai (Justification):**  
  On-demand food aur grocery delivery mein har minute qeemti hota hai. Store ko naya order foran milna chahiye aur customer ko delivery boy ki live movement nazar aani chahiye.
- **Agar Yeh Module Na Ho To Kya Masla Aayega (Failure Impact):**
  - **Food Spoiling & Delivery Delay:** Store ko order ka pata lagane ke liye bar bar page refresh karna parega. Agar kitchen staff refresh karna bhool jaye to order ghanton pending rahega.
  - **Server Overload (DDoS):** Thousands of users live status janne ke liye har 2 second baad HTTP polling karenge, jis se server CPU 100% ho kar crash ho jayega.
  - **Customer Blind Spot:** Customer ko pata hi nahi chalega ke rider kahan tak pohncha hai, jis se cancelation rate 40% barh jayega.

---

### Module 3: Digital Wallet & Payment Ledger (`routes/wallets.js`)
- **Kyun Zaroori Hai (Justification):**  
  Micro-transactions aur instantaneous 1-click checkout ke liye wallet lazmi hai. Yeh card gateway ke high transaction fees (Stripe 2.9% + 30c) ko reduce karta hai aur instant refund facilitate karta hai.
- **Agar Yeh Module Na Ho To Kya Masla Aayega (Failure Impact):**
  - **Refund Nightmare:** Agar customer order cancel kare to bank account me refund aane mein 5 se 7 din lagte hain jisse customer trust khatam ho jata hai.
  - **Checkout Drop-off:** Har choti grocery purchase par OTP aur CVV enter karne ki wajah se customer cart abandon kar deta hai.
  - **P2P Inability:** Friends/Family ko grocery ke paise transfer karne ka koi in-app tareeqa nahi bachega.

---

### Module 4: Double-Entry Financial Engine (`routes/financial.js`)
- **Kyun Zaroori Hai (Justification):**  
  Multi-vendor marketplace mein rozana hazaron rupay cash aur digital form mein circulate hotay hain. Har rupay ka hisab rakhna (Inflow, Outflow, Commission, Store Payout, Rider Cash, Operational Expenses) zaroori hai.
- **Agar Yeh Module Na Ho To Kya Masla Aayega (Failure Impact):**
  - **Rider Cash Embezzlement (Ghaban):** Riders COD ka lakhoon rupya le kar bhaag sakte hain kyunki pata hi nahi chalega kis rider ke paas kitna cash mojood hai.
  - **Merchant Disputes:** Store owners complaint karenge ke unki sales 50,000 thi magar unhe 35,000 payout kyun mila. Without Payment Vouchers (PV) aur Ledgers, platform legal liability me phans jayega.
  - **Tax & Audit Failure:** Platform legally audit nahi ho sakega aur company ko heavy penalties lag sakti hain.

---

### Module 5: Catalog & Variant Pricing Module (`routes/products.js`, `routes/sizes.js`, `routes/units.js`)
- **Kyun Zaroori Hai (Justification):**  
  Grocery items standard nahi hotay; doodh 250ml, 500ml, 1 Liter mein hota hai; aata 5kg aur 10kg mein hota hai. Har variant ki alag price aur inventory hoti hai.
- **Agar Yeh Module Na Ho To Kya Masla Aayega (Failure Impact):**
  - **Catalog Duplication:** Store ko ek hi item ke 10 alag product pages banane parenge, jisse app ka UI kachra ban jayega.
  - **Wrong Order Fulfillment:** Customer 1 Liter samajh kar order karega magar store 250ml deliver karega kyunki unit aur size explicit define nahi tha.

---

### Module 6: Rider Dispatch & Day-Closing Module (`routes/riders.js`)
- **Kyun Zaroori Hai (Justification):**  
  Riders company ke ground assets hain. Unka fuel log karna, unki location track karna aur din ke aakhir mein hisab (Day Close) karna logistics business ki bunyad hai.
- **Agar Yeh Module Na Ho To Kya Masla Aayega (Failure Impact):**
  - **Fuel Fraud:** Riders fake petrol slips bhej kar company se paise mangenge.
  - **Zombie Riders:** Offline riders ko orders assign hotay rahenge aur customer ka khana ghanton ruka rahega.
  - **Zero Cash Reconciliation:** Sham ko company ko pata nahi chalega ke market se kitna cash collect hua aur kitna bank mein jama karwana hai.

---

## 4. Critical Business Logic Rules & Validations

ServeNow ke codebase mein follow hone wale sakht business rules:

1. **Single-Store Order Constraint:**  
   Ek order mein mukhtalif stores ke products mix nahi ho sakte. Agar customer Cart mein doosre store ka item add karta hai to system previous cart clear karne ka warning prompt deta hai.
2. **Idempotency & Race-Condition Lock:**  
   Checkout aur Rider assignment par database level par row-locking (`SELECT ... FOR UPDATE`) use hoti hai taake do alag processes ek sath same resource ko modify na karein.
3. **Negative Balance Restriction:**  
   Customer ka wallet balance kabhi negative nahi ja sakta. Transaction shuru hone se pehle check hota hai:
   $$\text{Available Balance} \ge \text{Order Total}$$
4. **Rider Cash-in-Hand Threshold:**  
   Rider ke paas COD cash ki upper limit muqarrar hoti hai (maslan Rs. 15,000). Limit touch hote hi algorithm us rider ko naye COD orders dena block kar deta hai jab tak ke office mein cash jama na ho jaye.
5. **Voucher Immutability:**  
   Ek dafa jab Payment Voucher (PV) ya Receipt Voucher (RV) approve aur post ho jaye, to use edit ya delete nahi kiya ja sakta. Agar ghalti ho to counter Journal Voucher (JV) pass karke adjustment ki jati hai (Standard Accounting Principle).

---
*End of Logic Explanation. Designed and aligned with ServeNow Codebase.*
