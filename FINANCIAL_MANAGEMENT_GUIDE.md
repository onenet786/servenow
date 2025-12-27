# ServeNow Financial Management System - Complete Guide

## Table of Contents
1. [Overview](#overview)
2. [Database Schema](#database-schema)
3. [API Endpoints](#api-endpoints)
4. [Frontend Components](#frontend-components)
5. [Data Flows](#data-flows)
6. [Feature Details](#feature-details)
7. [Workflows](#workflows)
8. [Development Guidelines](#development-guidelines)

---

## Overview

The ServeNow Financial Management System is a comprehensive accounting system designed to manage all financial transactions in the grocery delivery platform. It includes:

- **Wallets**: Customer digital wallets for prepayment and balance management
- **Financial Transactions**: Record all income, expenses, settlements, refunds, and adjustments
- **Payment Vouchers**: Issue payments to stores, riders, vendors, employees
- **Receipt Vouchers**: Record receipts from customers, stores, and other sources
- **Rider Cash Management**: Track cash collected by riders and their submissions
- **Store Settlements**: Calculate and settle amounts owed to stores
- **Expenses**: Record and track administrative expenses
- **Reports**: Generate financial summaries and reports

---

## Database Schema

### 1. **Wallets** (`wallets` table)
Stores customer digital wallet information for prepayment.

```sql
CREATE TABLE wallets (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT UNIQUE NOT NULL,        -- Customer who owns the wallet
    balance DECIMAL(10, 2) DEFAULT 0.00, -- Current available balance
    total_credited DECIMAL(10, 2) DEFAULT 0.00, -- Total money added
    total_spent DECIMAL(10, 2) DEFAULT 0.00,    -- Total money used
    auto_recharge_enabled BOOLEAN DEFAULT FALSE,
    auto_recharge_amount DECIMAL(10, 2) DEFAULT 0.00,
    auto_recharge_threshold DECIMAL(10, 2) DEFAULT 0.00,
    last_credited_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

**Key Fields:**
- **balance**: Real-time wallet balance (credited - spent)
- **total_credited**: Cumulative credit history
- **total_spent**: Cumulative spending history
- **auto_recharge_***: For automatic topup when balance falls below threshold

---

### 2. **Wallet Transactions** (`wallet_transactions` table)
Detailed ledger of all wallet activities.

```sql
CREATE TABLE wallet_transactions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    wallet_id INT NOT NULL,
    type ENUM('credit', 'debit', 'refund', 'transfer') NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    description VARCHAR(255),
    reference_type VARCHAR(50),  -- 'order', 'refund', 'topup', 'transfer'
    reference_id VARCHAR(255),    -- Links to order ID, refund ID, etc.
    balance_after DECIMAL(10, 2), -- Balance after this transaction
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (wallet_id) REFERENCES wallets(id)
);
```

**Transaction Types:**
- **credit**: Money added to wallet (topup, refund)
- **debit**: Money spent from wallet (order payment)
- **refund**: Money returned to wallet (order cancellation)
- **transfer**: Money sent to another wallet

---

### 3. **Financial Transactions** (`financial_transactions` table)
Master record of all financial movements in the system.

```sql
CREATE TABLE financial_transactions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    transaction_number VARCHAR(50) UNIQUE NOT NULL, -- Auto-generated ID (FIN-20251227-001-ABC)
    transaction_type ENUM('income', 'expense', 'settlement', 'refund', 'adjustment') NOT NULL,
    category VARCHAR(50),
    description TEXT,
    amount DECIMAL(12, 2) NOT NULL,
    payment_method ENUM('cash', 'card', 'bank_transfer', 'wallet', 'check') NOT NULL,
    related_entity_type VARCHAR(50),  -- 'order', 'rider', 'store', etc.
    related_entity_id INT,
    reference_id VARCHAR(100),
    reference_type VARCHAR(50),
    status ENUM('pending', 'completed', 'cancelled', 'reversed') DEFAULT 'completed',
    notes TEXT,
    created_by INT,        -- Admin who created this
    approved_by INT,       -- Admin who approved this
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (approved_by) REFERENCES users(id)
);
```

**Transaction Types:**
- **income**: Money received (from orders, customers)
- **expense**: Money spent (operational costs)
- **settlement**: Payments to stores/riders
- **refund**: Money returned to customers
- **adjustment**: Corrections and adjustments

---

### 4. **Cash Payment Vouchers** (`cash_payment_vouchers` table)
Records payments made to stores, riders, vendors, employees.

```sql
CREATE TABLE cash_payment_vouchers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    voucher_number VARCHAR(50) UNIQUE NOT NULL,  -- PV-YYYYMMDD-XXXXXX
    voucher_date DATE NOT NULL,
    payee_name VARCHAR(100) NOT NULL,
    payee_type ENUM('store', 'rider', 'vendor', 'employee', 'other') NOT NULL,
    payee_id INT,
    amount DECIMAL(12, 2) NOT NULL,
    purpose VARCHAR(255),
    description TEXT,
    payment_method ENUM('cash', 'check', 'bank_transfer') NOT NULL,
    check_number VARCHAR(50),
    bank_details TEXT,
    status ENUM('draft', 'pending', 'approved', 'paid', 'cancelled') DEFAULT 'draft',
    prepared_by INT,       -- Admin who created
    approved_by INT,       -- Admin who approved
    paid_by INT,           -- Admin who marked as paid
    approved_at TIMESTAMP NULL,
    paid_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (payee_id) REFERENCES users(id),
    FOREIGN KEY (prepared_by) REFERENCES users(id),
    FOREIGN KEY (approved_by) REFERENCES users(id),
    FOREIGN KEY (paid_by) REFERENCES users(id)
);
```

**Workflow:** draft → pending → approved → paid

---

### 5. **Cash Receipt Vouchers** (`cash_receipt_vouchers` table)
Records payments received from customers, stores, vendors.

```sql
CREATE TABLE cash_receipt_vouchers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    voucher_number VARCHAR(50) UNIQUE NOT NULL,  -- RV-YYYYMMDD-XXXXXX
    voucher_date DATE NOT NULL,
    payer_name VARCHAR(100) NOT NULL,
    payer_type ENUM('customer', 'store', 'vendor', 'other') NOT NULL,
    payer_id INT,
    amount DECIMAL(12, 2) NOT NULL,
    description VARCHAR(255),
    details TEXT,
    payment_method ENUM('cash', 'check', 'bank_transfer') NOT NULL,
    check_number VARCHAR(50),
    bank_details TEXT,
    status ENUM('draft', 'pending', 'received', 'cancelled') DEFAULT 'draft',
    prepared_by INT,
    approved_by INT,
    received_by INT,
    approved_at TIMESTAMP NULL,
    received_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (payer_id) REFERENCES users(id),
    FOREIGN KEY (prepared_by) REFERENCES users(id),
    FOREIGN KEY (approved_by) REFERENCES users(id),
    FOREIGN KEY (received_by) REFERENCES users(id)
);
```

**Workflow:** draft → pending → received

---

### 6. **Rider Cash Movements** (`rider_cash_movements` table)
Tracks cash collected by riders and their submissions.

```sql
CREATE TABLE rider_cash_movements (
    id INT PRIMARY KEY AUTO_INCREMENT,
    movement_number VARCHAR(50) UNIQUE NOT NULL,  -- RCM-YYYYMMDD-XXXXXX
    rider_id INT NOT NULL,
    movement_date DATE NOT NULL,
    movement_type ENUM('cash_collection', 'cash_submission', 'advance', 'settlement', 'adjustment') NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    description TEXT,
    reference_type VARCHAR(50),
    reference_id INT,
    status ENUM('pending', 'completed', 'approved', 'cancelled') DEFAULT 'pending',
    recorded_by INT,
    approved_by INT,
    approved_at TIMESTAMP NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (rider_id) REFERENCES riders(id),
    FOREIGN KEY (recorded_by) REFERENCES users(id),
    FOREIGN KEY (approved_by) REFERENCES users(id)
);
```

**Movement Types:**
- **cash_collection**: Rider collected cash from customer
- **cash_submission**: Rider submits collected cash to office
- **advance**: Cash advance given to rider
- **settlement**: Payment for completed deliveries
- **adjustment**: Corrections

---

### 7. **Store Settlements** (`store_settlements` table)
Calculates and tracks payments owed to stores.

```sql
CREATE TABLE store_settlements (
    id INT PRIMARY KEY AUTO_INCREMENT,
    settlement_number VARCHAR(50) UNIQUE NOT NULL,  -- SS-YYYYMMDD-XXXXXX
    settlement_date DATE NOT NULL,
    store_id INT NOT NULL,
    period_from DATE,                 -- Settlement period start
    period_to DATE,                   -- Settlement period end
    total_orders_amount DECIMAL(12, 2) DEFAULT 0.00, -- Total order value in period
    commissions DECIMAL(12, 2) DEFAULT 0.00,         -- Platform commission
    deductions DECIMAL(12, 2) DEFAULT 0.00,          -- Any other deductions
    net_amount DECIMAL(12, 2) NOT NULL, -- Amount to pay (orders - commissions - deductions)
    payment_method ENUM('cash', 'check', 'bank_transfer') NOT NULL,
    status ENUM('pending', 'approved', 'paid', 'cancelled') DEFAULT 'pending',
    approved_by INT,
    paid_by INT,
    approved_at TIMESTAMP NULL,
    paid_at TIMESTAMP NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(id),
    FOREIGN KEY (approved_by) REFERENCES users(id),
    FOREIGN KEY (paid_by) REFERENCES users(id)
);
```

**Calculation Formula:**
```
net_amount = total_orders_amount - commissions - deductions
```

---

### 8. **Admin Expenses** (`admin_expenses` table)
Records operational and administrative expenses.

```sql
CREATE TABLE admin_expenses (
    id INT PRIMARY KEY AUTO_INCREMENT,
    expense_number VARCHAR(50) UNIQUE NOT NULL,  -- EXP-YYYYMMDD-XXXXXX
    expense_date DATE NOT NULL,
    category VARCHAR(100) NOT NULL,  -- 'utilities', 'maintenance', 'office', 'travel', 'marketing', 'other'
    description TEXT,
    amount DECIMAL(12, 2) NOT NULL,
    payment_method ENUM('cash', 'card', 'check', 'bank_transfer') NOT NULL,
    vendor_name VARCHAR(100),
    receipt_number VARCHAR(50),
    status ENUM('pending', 'approved', 'paid', 'rejected') DEFAULT 'pending',
    submitted_by INT,
    approved_by INT,
    approved_at TIMESTAMP NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (submitted_by) REFERENCES users(id),
    FOREIGN KEY (approved_by) REFERENCES users(id)
);
```

---

### 9. **Financial Reports** (`financial_reports` table)
Stores generated financial reports.

```sql
CREATE TABLE financial_reports (
    id INT PRIMARY KEY AUTO_INCREMENT,
    report_number VARCHAR(50) UNIQUE NOT NULL,
    report_type ENUM('daily_summary', 'weekly_summary', 'monthly_summary', 'store_settlement', 'rider_cash_report', 'expense_report', 'custom') NOT NULL,
    period_from DATE,
    period_to DATE,
    total_income DECIMAL(12, 2) DEFAULT 0.00,
    total_expense DECIMAL(12, 2) DEFAULT 0.00,
    total_commissions DECIMAL(12, 2) DEFAULT 0.00,
    net_profit DECIMAL(12, 2) DEFAULT 0.00,
    data JSON,                        -- Detailed report data
    generated_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (generated_by) REFERENCES users(id)
);
```

---

## API Endpoints

All financial endpoints require **admin authentication** and are prefixed with `/api/financial/`

### 1. **Dashboard Statistics**

#### GET `/api/financial/dashboard`
Get financial dashboard statistics.

**Query Parameters:**
- `period`: 'today', 'week', or 'month' (default: 'month')

**Response:**
```json
{
  "success": true,
  "stats": {
    "income": 5000.00,
    "expense": 1200.00,
    "settlement": 800.00,
    "paymentVouchers": 2000.00,
    "receiptVouchers": 3500.00,
    "riderCashSubmitted": 1500.00
  }
}
```

---

### 2. **Transactions**

#### GET `/api/financial/transactions`
List all financial transactions.

**Query Parameters:**
- `type`: Filter by transaction type
- `status`: Filter by status
- `page`: Pagination
- `limit`: Records per page

**Response:**
```json
{
  "success": true,
  "transactions": [
    {
      "id": 1,
      "transaction_number": "FIN-20251227-001-ABC",
      "transaction_type": "income",
      "amount": 5000.00,
      "status": "completed",
      "created_at": "2025-12-27T10:00:00Z"
    }
  ],
  "total": 100,
  "page": 1,
  "limit": 20
}
```

#### POST `/api/financial/transactions`
Create a new transaction.

**Request Body:**
```json
{
  "transaction_type": "income",
  "amount": 5000.00,
  "description": "Order payment",
  "payment_method": "card",
  "category": "sales"
}
```

---

### 3. **Payment Vouchers**

#### GET `/api/financial/payment-vouchers`
List payment vouchers.

**Query Parameters:**
- `status`: Filter by status
- `page`: Pagination

**Response:**
```json
{
  "success": true,
  "vouchers": [
    {
      "id": 1,
      "voucher_number": "PV-20251227-ABCXYZ",
      "payee_name": "Fresh Market",
      "payee_type": "store",
      "amount": 2000.00,
      "status": "approved",
      "created_at": "2025-12-27T10:00:00Z"
    }
  ]
}
```

#### POST `/api/financial/payment-vouchers`
Create a new payment voucher.

**Request Body:**
```json
{
  "payee_name": "Fresh Market",
  "payee_type": "store",
  "payee_id": 1,
  "amount": 2000.00,
  "purpose": "Weekly settlement",
  "payment_method": "bank_transfer",
  "bank_details": "..."
}
```

#### PUT `/api/financial/payment-vouchers/:id`
Update payment voucher status (approve, pay).

**Request Body:**
```json
{
  "status": "approved"  // or "paid"
}
```

---

### 4. **Receipt Vouchers**

#### GET `/api/financial/receipt-vouchers`
List receipt vouchers.

#### POST `/api/financial/receipt-vouchers`
Create a receipt voucher.

**Request Body:**
```json
{
  "payer_name": "John Doe",
  "payer_type": "customer",
  "payer_id": 5,
  "amount": 500.00,
  "description": "Order payment",
  "payment_method": "cash"
}
```

#### PUT `/api/financial/receipt-vouchers/:id`
Update receipt voucher status.

---

### 5. **Rider Cash**

#### GET `/api/financial/rider-cash`
List rider cash movements.

**Query Parameters:**
- `type`: Filter by movement type
- `status`: Filter by status

**Response:**
```json
{
  "success": true,
  "movements": [
    {
      "id": 1,
      "movement_number": "RCM-20251227-ABCXYZ",
      "rider_id": 1,
      "movement_type": "cash_submission",
      "amount": 1500.00,
      "status": "completed",
      "first_name": "Ahmed",
      "last_name": "Khan"
    }
  ]
}
```

#### POST `/api/financial/rider-cash`
Record a rider cash movement.

**Request Body:**
```json
{
  "rider_id": 1,
  "movement_type": "cash_submission",
  "amount": 1500.00,
  "description": "Daily cash submission"
}
```

#### PUT `/api/financial/rider-cash/:id`
Approve rider cash movement.

---

### 6. **Store Settlements**

#### GET `/api/financial/store-settlements`
List store settlements.

**Query Parameters:**
- `store_id`: Filter by store
- `status`: Filter by status

**Response:**
```json
{
  "success": true,
  "settlements": [
    {
      "id": 1,
      "settlement_number": "SS-20251227-ABCXYZ",
      "store_id": 1,
      "store_name": "Fresh Market",
      "period_from": "2025-12-01",
      "period_to": "2025-12-15",
      "total_orders_amount": 10000.00,
      "commissions": 1000.00,
      "deductions": 500.00,
      "net_amount": 8500.00,
      "status": "pending"
    }
  ]
}
```

#### POST `/api/financial/store-settlements`
Create a store settlement.

**Request Body:**
```json
{
  "store_id": 1,
  "period_from": "2025-12-01",
  "period_to": "2025-12-15",
  "total_orders_amount": 10000.00,
  "commissions": 1000.00,
  "deductions": 500.00,
  "net_amount": 8500.00,
  "payment_method": "bank_transfer"
}
```

#### PUT `/api/financial/store-settlements/:id`
Update settlement status.

---

### 7. **Expenses**

#### GET `/api/financial/expenses`
List expenses.

**Query Parameters:**
- `category`: Filter by category
- `status`: Filter by status

#### POST `/api/financial/expenses`
Create an expense record.

**Request Body:**
```json
{
  "category": "utilities",
  "description": "Office electricity bill",
  "amount": 300.00,
  "vendor_name": "Utility Company",
  "payment_method": "card"
}
```

#### PUT `/api/financial/expenses/:id`
Update expense status (approve, pay).

---

### 8. **Reports**

#### GET `/api/financial/reports`
List financial reports.

#### POST `/api/financial/reports`
Generate a new report.

**Request Body:**
```json
{
  "report_type": "monthly_summary",
  "period_from": "2025-12-01",
  "period_to": "2025-12-31"
}
```

#### GET `/api/financial/reports/:id`
Get report details.

#### GET `/api/financial/reports/:id/download`
Download report as PDF/Excel.

---

## Frontend Components

### Location: `js/financial.js`

#### Key Functions:

**1. Dashboard Functions:**
- `loadFinancialDashboard()` - Load dashboard statistics
- Updates KPIs: Total Income, Total Expenses, Commissions, Net Profit

**2. Transactions:**
- `loadTransactions()` - List all transactions
- `displayTransactions(transactions)` - Render transaction table
- `createTransaction()` - Open transaction form modal
- `submitTransaction()` - Submit new transaction

**3. Payment Vouchers:**
- `loadPaymentVouchers()` - Load all payment vouchers
- `displayPaymentVouchers(vouchers)` - Render voucher table
- `createPaymentVoucher()` - Open payment voucher form
- `submitPaymentVoucher()` - Submit voucher
- `approvePaymentVoucher(id)` - Approve a voucher
- `editPaymentVoucher(id)` - Edit voucher

**4. Receipt Vouchers:**
- `loadReceiptVouchers()` - Load receipts
- `createReceiptVoucher()` - Open receipt form
- `submitReceiptVoucher()` - Submit receipt
- `approveReceiptVoucher(id)` - Approve receipt

**5. Rider Cash:**
- `loadRiderCash()` - Load rider cash movements
- `displayRiderCash(movements)` - Render movements table
- `createRiderCash()` - Open rider cash form
- `submitRiderCash()` - Submit movement
- `approveRiderCash(id)` - Approve movement

**6. Store Settlements:**
- `loadStoreSettlements()` - Load settlements
- `displayStoreSettlements(settlements)` - Render table
- `createStoreSettlement()` - Open settlement form with store dropdown
- `populateStoresDropdown()` - Populate store list
- `submitStoreSettlement()` - Submit settlement
- `approveStoreSettlement(id)` - Approve settlement

**7. Expenses:**
- `loadExpenses()` - Load expenses
- `displayExpenses(expenses)` - Render expenses table
- `createExpense()` - Open expense form
- `submitExpense()` - Submit expense
- `approveExpense(id)` - Approve expense

**8. Reports:**
- `loadFinancialReports()` - Load generated reports
- `generateFinancialReport()` - Generate new report
- `downloadReport(id)` - Download report

#### Modal Handling:
- `openModal(modalId)` - Show modal
- `closeModal(modalId)` - Close modal with unsaved changes protection
- `trackFormChanges(formId, modalId)` - Track form modifications
- `initializePersistentModalHandlers()` - Prevent backdrop closing

---

## Data Flows

### 1. **Store Settlement Flow**

```
Admin Dashboard
    ↓
Click "Create Settlement" button
    ↓
Modal Opens → Populate Stores Dropdown (GET /api/stores?admin=1)
    ↓
User Selects Store → Form fills with store name
    ↓
Admin Enters:
  - Period From / Period To (dates)
  - Total Orders Amount
  - Commissions
  - Deductions
  - Payment Method
    ↓
Submit Form (POST /api/financial/store-settlements)
    ↓
Backend:
  1. Validates input
  2. Calculates: net_amount = total - commissions - deductions
  3. Generates settlement_number (SS-YYYYMMDD-XXXXXX)
  4. Inserts record with status='pending'
  5. Creates financial_transaction record
    ↓
Frontend:
  1. Shows success toast
  2. Closes modal
  3. Reloads settlements list
  4. List shows new settlement with "pending" status
    ↓
Approval Process:
  1. Another admin clicks "Approve"
  2. Status changes: pending → approved
  3. Sets approved_by = current_user, approved_at = now
    ↓
Payment Process:
  1. Admin clicks "Pay"
  2. Status changes: approved → paid
  3. Sets paid_by = current_user, paid_at = now
```

### 2. **Payment Voucher Flow**

```
Admin Dashboard → Financial Section → Payment Vouchers
    ↓
Click "Create Payment Voucher"
    ↓
Form Modal Opens with fields:
  - Payee Name
  - Payee Type (store, rider, vendor, employee, other)
  - Amount
  - Purpose
  - Payment Method (cash, check, bank_transfer)
  - Bank Details (if bank_transfer)
    ↓
Submit → POST /api/financial/payment-vouchers
    ↓
Backend creates:
  - cash_payment_vouchers record (status='draft')
  - financial_transaction record (type='expense')
    ↓
Status Flow:
  draft → pending → approved → paid → completed
```

### 3. **Rider Cash Movement Flow**

```
Rider completes deliveries, collects cash
    ↓
Admin Dashboard → Financial → Rider Cash
    ↓
Click "Record Cash Movement"
    ↓
Form Modal with:
  - Rider (dropdown)
  - Movement Type (cash_collection, cash_submission, advance, settlement, adjustment)
  - Amount
  - Description
    ↓
POST /api/financial/rider-cash
    ↓
Backend:
  1. Creates rider_cash_movements record
  2. Creates financial_transaction
  3. Updates rider's balance/ledger
    ↓
Status: pending → completed → approved
```

---

## Feature Details

### **A. Wallet System**

**Purpose:** Allow customers to prepay and use digital wallets for orders.

**Key Operations:**

1. **Add to Wallet (Topup)**
   - User initiates topup
   - Payment processed via Stripe
   - wallet_transactions record created (type='credit')
   - Wallet balance updated

2. **Use Wallet (Payment)**
   - During checkout, customer selects wallet
   - Order payment deducted from wallet (type='debit')
   - Balance updated after successful order

3. **Wallet Refund**
   - Order cancelled
   - Refund amount added (type='refund')
   - Balance restored

4. **Auto-Recharge** (if enabled)
   - Monitor wallet balance
   - If falls below threshold, auto-topup

### **B. Payment Voucher System**

**Purpose:** Formally issue payments to various entities.

**Who Gets Paid:**
- Stores (settlement payments)
- Riders (delivery bonuses, incentives)
- Vendors (product suppliers)
- Employees (salaries, bonuses)
- Others (contractors, freelancers)

**Workflow:**
1. Admin creates voucher (status: draft)
2. System auto-generates voucher number
3. Another admin approves (status: approved)
4. Accountant marks as paid (status: paid)
5. Financial transaction recorded automatically

### **C. Receipt Voucher System**

**Purpose:** Formally record received payments.

**Who Pays:**
- Customers (order payments, topups)
- Stores (refunds, returns)
- Vendors (returns, credits)

**Workflow:**
1. Create receipt (status: draft)
2. Approve (status: approved)
3. Mark as received (status: received)

### **D. Rider Cash Management**

**Scenarios:**

1. **Cash Collection**
   - Rider collects cash from customer
   - Records: movement_type = 'cash_collection'

2. **Cash Submission**
   - Rider submits collected cash to office
   - Records: movement_type = 'cash_submission'
   - Amount reconciled

3. **Advance**
   - Rider given cash advance
   - Records: movement_type = 'advance'

4. **Settlement**
   - Rider's deliveries paid
   - Records: movement_type = 'settlement'

5. **Adjustment**
   - Corrections, discrepancies
   - Records: movement_type = 'adjustment'

### **E. Store Settlements**

**Purpose:** Calculate and pay stores their earnings.

**Calculation:**
```
Total Orders Amount (in period) = SUM(orders.total_amount)
Commission = Total * Commission_Rate (e.g., 10%)
Deductions = Any other costs, returns, penalties
Net Amount = Total Orders - Commission - Deductions
```

**Timeline:**
- Daily, weekly, or monthly settlements
- Tracks period_from and period_to
- Status tracking: pending → approved → paid

---

## Workflows

### **Workflow 1: Creating a Store Settlement**

```
Step 1: Open Admin Dashboard
        → Navigate to Financial > Store Settlements

Step 2: Click "Create Settlement" Button
        → Modal opens
        → Dropdown loads stores list (GET /api/stores?admin=1)

Step 3: Select Store
        → Dropdown shows all active stores
        → Select store name (not ID!)

Step 4: Enter Settlement Details
        Store: Fresh Market (selected)
        Period From: 2025-12-01
        Period To: 2025-12-15
        Total Orders Amount: ₨10,000
        Commissions: ₨1,000 (10%)
        Deductions: ₨500 (returns, damages)
        
Step 5: Choose Payment Method
        - Cash
        - Check
        - Bank Transfer

Step 6: Click "Create Settlement"
        → Frontend validates form
        → Sends: POST /api/financial/store-settlements
        → Backend processes
        → Creates record with status='pending'
        → Returns settlement_id and settlement_number

Step 7: Success Toast Appears
        "Settlement created successfully"
        → Modal closes
        → Table refreshes
        → New settlement appears at top with "pending" badge

Step 8: Approval (Another Admin)
        → Clicks "Approve" button on settlement
        → Status changes to "approved"
        → approved_by and approved_at recorded

Step 9: Payment (Accountant)
        → Clicks "Pay" button
        → Status changes to "paid"
        → paid_by and paid_at recorded
        → Financial record updated
```

### **Workflow 2: Recording Rider Cash**

```
Step 1: Rider completes deliveries, collects cash

Step 2: Admin → Financial → Rider Cash

Step 3: Click "Record Cash Movement"

Step 4: Select Rider
        Dropdown shows all active riders
        Select: Ahmed Khan

Step 5: Choose Movement Type
        Options:
        - Cash Collection (rider collected from customer)
        - Cash Submission (rider submitting to office)
        - Advance (giving cash to rider)
        - Settlement (paying for deliveries)
        - Adjustment (corrections)
        
        Select: Cash Submission

Step 6: Enter Amount: ₨1,500

Step 7: Add Description: "Daily cash submission from morning deliveries"

Step 8: Submit
        → POST /api/financial/rider-cash
        → Creates movement record
        → Updates rider's financial ledger

Step 9: Status becomes "pending"
        Admin can approve: pending → completed → approved
```

---

## Development Guidelines

### **1. Adding New Financial Feature**

**Steps:**

1. **Database:**
   - Add table in schema.sql
   - Include: id, number (auto-generated), date, amount, status, created_by, approved_by
   - Add appropriate FOREIGN KEYs

2. **Backend API:**
   - Add route in `routes/financial.js`
   - Implement: GET (list), POST (create), PUT (update status)
   - Validate all inputs
   - Generate auto numbers using `generateVoucherNumber(prefix)`
   - Create corresponding financial_transaction records

3. **Frontend:**
   - Add functions in `js/financial.js`:
     - `load[Feature]()`
     - `display[Feature](items)`
     - `create[Feature]()`
     - `submit[Feature]()`
     - `approve[Feature](id)`
   - Add modal HTML in `admin.html`
   - Add table container in appropriate section

4. **Modal:**
   - Make it persistent (add `persistent-modal` class)
   - Add form change tracking
   - Disable close button (×)

---

### **2. Dropdown Integration Pattern**

When you need a dropdown for selecting related entities (stores, riders, customers):

**Backend:**
```javascript
// Expose endpoint with admin=1 parameter
GET /api/stores?admin=1
GET /api/riders?admin=1
GET /api/users?type=customer
```

**Frontend:**
```javascript
async function populateDropdown() {
    const response = await fetch(`${API_BASE}/api/stores?admin=1`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
    });
    const data = await response.json();
    
    const select = document.getElementById('selectId');
    select.innerHTML = '<option value="">-- Select Store --</option>';
    data.stores.forEach(store => {
        const option = document.createElement('option');
        option.value = store.id;
        option.textContent = store.name;
        select.appendChild(option);
    });
}

// Call in createModal function
function createFeature() {
    form.reset();
    populateDropdown();
    openModal('featureModal');
}
```

---

### **3. Form Validation Pattern**

**Backend (Express Validator):**
```javascript
router.post('/route', [
    body('amount').isFloat({ min: 0.01 }),
    body('payment_method').isIn(['cash', 'check', 'bank_transfer']),
    body('description').trim().notEmpty()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: errors.array()
        });
    }
    // Process request
});
```

**Frontend:**
```javascript
async function submitFeature() {
    const amount = parseFloat(document.getElementById('amount').value);
    
    if (!amount || amount <= 0) {
        showError('Validation', 'Amount must be greater than 0');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/financial/route`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify({ amount, ... })
        });
        const data = await response.json();
        if (data.success) {
            showSuccess('Success', 'Feature created successfully');
            closeModal('featureModal');
            loadFeature();
        } else {
            showError('Error', data.message);
        }
    } catch (error) {
        showError('Error', 'Failed to create feature');
    }
}
```

---

### **4. Status Workflow Pattern**

**Define Status Enum:**
```javascript
const statusFlows = {
    payment_voucher: ['draft', 'pending', 'approved', 'paid'],
    receipt_voucher: ['draft', 'pending', 'received'],
    rider_cash: ['pending', 'completed', 'approved'],
    expense: ['pending', 'approved', 'paid']
};
```

**Validation on Update:**
```javascript
const allowedTransitions = {
    'draft': ['pending'],
    'pending': ['approved', 'cancelled'],
    'approved': ['paid'],
    'paid': []
};

router.put('/:id', async (req, res) => {
    const { status } = req.body;
    const current = await getRecordStatus(id);
    
    if (!allowedTransitions[current].includes(status)) {
        return res.status(400).json({
            success: false,
            message: `Cannot transition from ${current} to ${status}`
        });
    }
    
    // Update record
});
```

---

### **5. Persistent Modal Implementation**

**HTML:**
```html
<div id="featureModal" class="modal persistent-modal">
    <div class="modal-content">
        <div class="modal-header">
            <h2>Feature Title</h2>
            <button class="close-btn" disabled title="Use Cancel button">&times;</button>
        </div>
        <form id="featureForm">
            <!-- Form fields -->
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" onclick="closeModal('featureModal')">Cancel</button>
                <button type="submit" class="btn btn-primary">Create</button>
            </div>
        </form>
    </div>
</div>
```

**CSS:**
```css
.modal.persistent-modal {
    pointer-events: none;
}

.modal.persistent-modal.show {
    pointer-events: auto;
}

.persistent-modal .close-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    color: #999;
}
```

**JavaScript:**
```javascript
// In financial.js
const financialModalIds = ['featureModal', ...];
const formChangedState = {};

function closeModal(modalId) {
    const isFiancialModal = financialModalIds.includes(modalId);
    if (isFiancialModal && formChangedState[modalId]) {
        const confirmed = confirm('Unsaved changes. Close anyway?');
        if (!confirmed) return;
    }
    document.getElementById(modalId).classList.remove('show');
}

function trackFormChanges(formId, modalId) {
    const form = document.getElementById(formId);
    if (form) {
        form.addEventListener('change', () => { formChangedState[modalId] = true; });
        form.addEventListener('input', () => { formChangedState[modalId] = true; });
    }
}
```

---

### **6. Testing Checklist**

Before committing financial feature changes:

- [ ] **Create Function**
  - Form validates all required fields
  - Auto-generated numbers are unique
  - Financial transaction created automatically
  - Toast notification appears
  - Modal closes after success
  - List refreshes with new item

- [ ] **List Function**
  - All records display correctly
  - Filters work (status, date range, search)
  - Sorting works
  - Pagination works
  - Status badges show correct colors

- [ ] **Update Function**
  - Status transitions follow defined workflow
  - Cannot skip statuses
  - Timestamps recorded (approved_at, paid_at)
  - Financial implications reflected

- [ ] **Approval/Payment**
  - Only admins can approve/pay
  - Approver/payer tracked
  - Cannot approve/pay twice
  - Related financial transactions updated

- [ ] **Reports**
  - Calculations correct
  - Date filters work
  - Export format correct

---

## Common Issues & Solutions

### **Issue 1: Dropdown showing IDs instead of names**
**Solution:** Ensure API returns both `id` and display field (name, email, etc.)

### **Issue 2: Status not updating**
**Solution:** Check that status transition is allowed. Implement validation in backend.

### **Issue 3: Amounts calculated incorrectly**
**Solution:** Ensure decimal precision. Use DECIMAL(12, 2) in database, not FLOAT.

### **Issue 4: Modal closing unexpectedly**
**Solution:** Check if form is marked as changed. Implement proper form reset.

### **Issue 5: Financial transaction not created**
**Solution:** Ensure every financial operation creates a transaction record for audit trail.

---

## Summary

The financial management system is designed with:
- **Separation of Concerns**: Each entity has dedicated tables and endpoints
- **Audit Trail**: All transactions tracked with creator/approver
- **Status Workflows**: Prevent invalid state transitions
- **User Protection**: Persistent modals prevent accidental data loss
- **Flexibility**: Can handle various payment methods and entity types
- **Scalability**: JSON fields for storing complex data (reports)

Good luck with development! Refer to this guide whenever adding new features or fixing bugs.
