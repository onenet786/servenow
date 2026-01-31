# ServeNow Financial Management System - User Guide

Welcome to the ServeNow Financial Management System. This guide is designed to help you understand how the platform handles money, tracks transactions, and ensures financial accuracy without needing to know any technical code.

---

## 1. The Master Ledger: Your Central Source of Truth
Think of the **Master Ledger** as a digital "Big Book of Accounts." Every single time money moves in the system—whether it's a customer paying for an order, a store being paid, or an admin buying office supplies—it is recorded here.

### Transaction Types
- **Income**: Money coming into the platform (e.g., customer payments, top-ups).
- **Expense**: Money going out of the platform (e.g., paying for utilities, administrative costs).
- **Settlement**: Payments made to our partners (e.g., Store payouts, Rider earnings).
- **Refund**: Money returned to a customer (e.g., cancelled orders).
- **Adjustment**: Special corrections made by an administrator.

---

## 2. Customer & Rider Wallets
Wallets act like digital prepaid accounts. They simplify payments and refunds.

- **Top-ups**: When a customer adds money to their wallet, it is recorded as **Income**.
- **Spending**: When a customer pays using their wallet, the money moves from their wallet to the platform.
- **Refunds**: If an order is cancelled, money is put back into the wallet instantly.
- **Admin Adjustments**: Sometimes, an admin might need to manually add or remove money from a wallet (e.g., for a special promotion or to correct an error). 
    - Adding money to a user's wallet is a platform **Expense**.
    - Removing money from a user's wallet is platform **Income**.

---

## 3. Vouchers: Formalizing Payments & Receipts
Vouchers are used to track physical or bank-based money movements that happen outside of the automated app flow.

### Payment Vouchers (Paying Out)
Use these when the company needs to pay someone (a store, a vendor, or an employee).
- **Flow**: `Draft` → `Pending Approval` → `Approved` → `Paid`.
- **Ledger Impact**: Once marked as **Paid**, it automatically creates an **Expense** in the Master Ledger.

### Receipt Vouchers (Receiving In)
Use these when the company receives money directly (like a cash payment from a partner).
- **Flow**: `Draft` → `Pending` → `Received`.
- **Ledger Impact**: Once marked as **Received**, it records **Income** in the Master Ledger.

---

## 4. Rider Cash Management
Since many orders are "Cash on Delivery," riders often carry platform money.

- **Cash Collection**: Recorded when a rider picks up cash from a customer. This money is "owned" by the rider until they submit it.
- **Cash Submission**: When the rider brings that cash to the office. Once an admin **approves** the submission, it is recorded as **Income** for the platform.
- **Advances**: If a rider is given cash upfront for fuel or maintenance, it is recorded as an **Expense**.

---

## 5. Store Settlements
Stores need to be paid for the orders they fulfill, minus the platform's commission.

- **The Formula**: `Total Order Amount` - `Platform Commission` - `Deductions` = `Net Amount to Pay`.
- **Payment**: When a settlement is marked as **Paid**, it is recorded in the Master Ledger as a **Settlement**.

---

## 6. Financial Dashboard & Reporting
The dashboard gives you a bird's-eye view of the platform's health.

### Key Metrics
- **Total Income**: All money the platform has earned.
- **Total Expense**: All money the platform has spent on operations.
- **Total Settlements**: All money paid out to Stores and Riders.
- **Net Profit**: This is the most important number. 
    - **Formula**: `Income` - (`Expenses` + `Settlements` + `Refunds`).

### Reports
You can generate summaries for any period (Daily, Weekly, Monthly). These reports take a snapshot of the Master Ledger so you can see exactly where the money went.

---

## Best Practices for Users
1. **Always use Vouchers**: Never move money without creating a corresponding Voucher. It ensures there is a paper trail.
2. **Review the Ledger**: Regularly check the "Financial Transactions" tab to ensure all entries look correct.
3. **Approve Promptly**: Many transactions (like Rider submissions) don't hit the ledger until they are **Approved**. Keep your approval queue clear for accurate real-time reporting.
