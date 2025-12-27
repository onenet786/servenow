# Financial Management System - Architecture & Relationships

## Database Relationships Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         USERS TABLE                              │
│ (customers, store_owners, admin, riders)                         │
└─────────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┼───────────────┐
                │               │               │
                ▼               ▼               ▼
          ┌──────────┐   ┌──────────────┐   ┌────────┐
          │ WALLETS  │   │   STORES     │   │ RIDERS │
          └──────────┘   └──────────────┘   └────────┘
                │               │                 │
                ▼               ▼                 ▼
        ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
        │ Wallet Trans │  │ Store Settle │  │ Rider Cash   │
        │ (credit/     │  │ (calculation)│  │ (movements)  │
        │  debit/      │  │              │  │              │
        │  refund)     │  └──────────────┘  └──────────────┘
        └──────────────┘          │                 │
                │                 │                 │
                └─────────────────┴─────────────────┘
                                  │
                                  ▼
        ┌──────────────────────────────────────┐
        │   FINANCIAL_TRANSACTIONS (Master Log)│
        │  (records all financial movements)   │
        └──────────────────────────────────────┘
```

---

## Complete Entity Relationships

```
WALLETS
├── wallet_id (PK)
├── user_id (FK → users)
└── balance, total_credited, total_spent

    ↓ (contains)

WALLET_TRANSACTIONS
├── id (PK)
├── wallet_id (FK → wallets)
├── type: credit|debit|refund|transfer
├── amount
└── reference_id (links to order, topup, etc.)

────────────────────────────────────────────────────────

FINANCIAL_TRANSACTIONS (Master Ledger)
├── id (PK)
├── transaction_number (unique)
├── transaction_type: income|expense|settlement|refund|adjustment
├── amount
├── status: pending|completed|cancelled|reversed
├── created_by (FK → users)
├── approved_by (FK → users)
└── related_entity_id, reference_id

    ↑ (records all movements from below)

────────────────────────────────────────────────────────

CASH_PAYMENT_VOUCHERS
├── id (PK)
├── voucher_number (unique)
├── payee_id (FK → users)
├── payee_type: store|rider|vendor|employee|other
├── amount
├── status: draft|pending|approved|paid|cancelled
├── prepared_by (FK → users)
├── approved_by (FK → users)
├── paid_by (FK → users)
└── timestamps

    ↑ (triggers financial_transaction creation)

────────────────────────────────────────────────────────

CASH_RECEIPT_VOUCHERS
├── id (PK)
├── voucher_number (unique)
├── payer_id (FK → users)
├── payer_type: customer|store|vendor|other
├── amount
├── status: draft|pending|received|cancelled
├── prepared_by (FK → users)
├── approved_by (FK → users)
├── received_by (FK → users)
└── timestamps

    ↑ (triggers financial_transaction creation)

────────────────────────────────────────────────────────

RIDER_CASH_MOVEMENTS
├── id (PK)
├── movement_number (unique)
├── rider_id (FK → riders)
├── movement_date
├── movement_type: cash_collection|cash_submission|advance|settlement|adjustment
├── amount
├── status: pending|completed|approved|cancelled
├── recorded_by (FK → users)
├── approved_by (FK → users)
└── timestamps

    ↑ (triggers financial_transaction creation)

────────────────────────────────────────────────────────

STORE_SETTLEMENTS
├── id (PK)
├── settlement_number (unique)
├── store_id (FK → stores)
├── period_from, period_to (dates)
├── total_orders_amount
├── commissions
├── deductions
├── net_amount (calculation result)
├── payment_method: cash|check|bank_transfer
├── status: pending|approved|paid|cancelled
├── approved_by (FK → users)
├── paid_by (FK → users)
└── timestamps

    ↑ (triggers financial_transaction creation)

────────────────────────────────────────────────────────

ADMIN_EXPENSES
├── id (PK)
├── expense_number (unique)
├── category: utilities|maintenance|office|travel|marketing|other
├── amount
├── payment_method: cash|card|check|bank_transfer
├── vendor_name
├── status: pending|approved|paid|rejected
├── submitted_by (FK → users)
├── approved_by (FK → users)
└── timestamps

    ↑ (triggers financial_transaction creation)

────────────────────────────────────────────────────────

FINANCIAL_REPORTS
├── id (PK)
├── report_number (unique)
├── report_type: daily_summary|weekly_summary|monthly_summary|custom
├── period_from, period_to
├── total_income, total_expense
├── total_commissions, net_profit
├── data (JSON - detailed breakdown)
└── generated_by (FK → users)
```

---

## Data Flow Architecture

### Flow 1: Customer Order → Store Settlement

```
CUSTOMER PLACES ORDER
    │ payment_method: 'wallet' or 'card'
    ▼
ORDER CREATED
    id, user_id, store_id, total_amount, status=pending
    
    │ (if wallet payment)
    ▼
WALLET TRANSACTION CREATED
    type: 'debit', amount: order.total_amount
    balance updated
    
    │
    ▼
ORDER STATUS UPDATES
    pending → confirmed → preparing → ready → out_for_delivery → delivered
    
    │ (after delivered)
    ▼
ADMIN CREATES STORE SETTLEMENT
    - Select store
    - Set period (e.g., Dec 1-15)
    - Calculate:
        total_orders_amount = SUM(orders.total_amount for period)
        commissions = total_orders_amount * 10%  (example)
        net_amount = total_orders_amount - commissions - deductions
    
    │
    ▼
SETTLEMENT RECORD CREATED
    status: 'pending'
    
    │ (Another admin)
    ▼
SETTLEMENT APPROVED
    status: 'pending' → 'approved'
    approved_by, approved_at recorded
    
    │ (Accountant/Finance)
    ▼
SETTLEMENT PAID
    status: 'approved' → 'paid'
    paid_by, paid_at recorded
    
    │
    ▼
FINANCIAL_TRANSACTION CREATED
    transaction_type: 'settlement'
    amount: net_amount
    related_entity_type: 'store'
    related_entity_id: store_id
```

### Flow 2: Payment Voucher → Cash Payment

```
ADMIN CREATES PAYMENT VOUCHER
    payee_name: "Fresh Market" (Store)
    payee_type: "store"
    amount: 8500.00
    payment_method: "bank_transfer"
    
    │
    ▼
VOUCHER RECORD CREATED
    status: 'draft'
    prepared_by: admin_id
    
    │ (Same or different admin)
    ▼
VOUCHER APPROVED
    status: 'draft' → 'pending' → 'approved'
    approved_by: approver_id
    approved_at: timestamp
    
    │ (Accountant processes payment)
    ▼
VOUCHER MARKED PAID
    status: 'approved' → 'paid'
    paid_by: accountant_id
    paid_at: timestamp
    
    │
    ▼
FINANCIAL_TRANSACTION CREATED
    transaction_type: 'expense'
    category: 'payment'
    amount: 8500.00
    related_entity_type: 'store'
    payment_method: 'bank_transfer'
```

### Flow 3: Rider Cash Collection → Submission

```
RIDER COMPLETES DELIVERIES
    collects cash from customers
    
    │ (Admin records)
    ▼
CASH COLLECTION RECORDED
    movement_type: 'cash_collection'
    rider_id: 1
    amount: 3000.00
    status: 'pending'
    
    │ (Later, rider submits cash)
    ▼
CASH SUBMISSION RECORDED
    movement_type: 'cash_submission'
    rider_id: 1
    amount: 3000.00
    status: 'pending'
    
    │ (Admin verifies and approves)
    ▼
SUBMISSION COMPLETED
    status: 'pending' → 'completed' → 'approved'
    approved_by: admin_id
    
    │
    ▼
FINANCIAL_TRANSACTION CREATED
    transaction_type: 'income'
    amount: 3000.00
    related_entity_type: 'rider'
    payment_method: 'cash'
```

---

## Status Workflow Diagrams

### Payment Voucher Workflow
```
┌────────────────────────────────────────────────────────────┐
│           PAYMENT VOUCHER LIFECYCLE                         │
└────────────────────────────────────────────────────────────┘

 Created
    │
    ▼
 [DRAFT] ◄─────── (initial state)
    │
    │ (Submit for approval)
    ▼
 [PENDING] ◄────── (awaiting approval)
    │
    ├──────────► [CANCELLED] (reject)
    │
    │ (Approve)
    ▼
 [APPROVED] ◄───── (ready to pay)
    │
    ├──────────► [CANCELLED] (reject)
    │
    │ (Mark as paid)
    ▼
 [PAID] ◄───────── (final state)
    │
    └──────────► [REVERSED] (if needed)
```

### Store Settlement Workflow
```
┌────────────────────────────────────────────────────────────┐
│         STORE SETTLEMENT LIFECYCLE                          │
└────────────────────────────────────────────────────────────┘

 Calculate & Create
    │
    ▼
 [PENDING] ◄────── (awaiting approval)
    │
    ├──────────► [CANCELLED]
    │
    │ (Approve)
    ▼
 [APPROVED] ◄───── (ready to pay)
    │
    ├──────────► [CANCELLED]
    │
    │ (Mark as paid)
    ▼
 [PAID] ◄───────── (final state, settlement complete)
```

### Rider Cash Movement Workflow
```
┌────────────────────────────────────────────────────────────┐
│        RIDER CASH MOVEMENT LIFECYCLE                        │
└────────────────────────────────────────────────────────────┘

 Record Movement
    │
    ▼
 [PENDING] ◄────── (awaiting verification)
    │
    ├──────────► [CANCELLED]
    │
    │ (Verify & complete)
    ▼
 [COMPLETED] ◄──── (movement verified)
    │
    │ (Final approval)
    ▼
 [APPROVED] ◄───── (final state)
```

### Receipt Voucher Workflow
```
┌────────────────────────────────────────────────────────────┐
│         RECEIPT VOUCHER LIFECYCLE                           │
└────────────────────────────────────────────────────────────┘

 Created
    │
    ▼
 [DRAFT] ◄─────── (initial state)
    │
    │ (Submit)
    ▼
 [PENDING] ◄────── (awaiting receipt)
    │
    ├──────────► [CANCELLED]
    │
    │ (Receipt confirmed)
    ▼
 [RECEIVED] ◄───── (final state)
```

---

## API Request/Response Flow

### Example: Creating Store Settlement

```
FRONTEND
┌─────────────────────────────────────┐
│ 1. User clicks "Create Settlement"  │
└─────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│ 2. Modal opens                       │
│    - Populate stores dropdown        │
│      GET /api/stores?admin=1         │
└──────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│ 3. User fills form:                  │
│    - Select store                    │
│    - Period: 2025-12-01 to 2025-12-15│
│    - Total Orders: 10000             │
│    - Commissions: 1000               │
│    - Deductions: 500                 │
│    - Amount: 8500 (calculated)       │
└──────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│ 4. Form submitted                    │
│    POST /api/financial/store-settings│
│    {                                 │
│      "store_id": 1,                  │
│      "period_from": "2025-12-01",    │
│      "period_to": "2025-12-15",      │
│      "total_orders_amount": 10000,   │
│      "commissions": 1000,            │
│      "deductions": 500,              │
│      "net_amount": 8500,             │
│      "payment_method": "bank_transfer"
│    }                                 │
└──────────────────────────────────────┘
    │
    ▼

BACKEND
┌──────────────────────────────────────┐
│ 5. Validate input                    │
│    - store_id exists                 │
│    - amounts > 0                     │
│    - dates valid                     │
│    - payment_method valid            │
└──────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│ 6. Generate settlement_number        │
│    SS-20251227-ABCXYZ                │
└──────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│ 7. Insert store_settlements record   │
│    settlement_number: SS-...         │
│    store_id: 1                       │
│    net_amount: 8500                  │
│    status: 'pending'                 │
│    created_at: NOW()                 │
└──────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│ 8. Create financial_transaction      │
│    transaction_number: FIN-...       │
│    transaction_type: 'settlement'    │
│    amount: 8500                      │
│    related_entity_type: 'store'      │
│    related_entity_id: 1              │
│    status: 'completed'               │
│    reference_id: settlement_id       │
└──────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│ 9. Return response                   │
│    {                                 │
│      "success": true,                │
│      "message": "Settlement created",│
│      "settlement": {                 │
│        "id": 1,                      │
│        "settlement_number": "SS-..." │
│      }                               │
│    }                                 │
└──────────────────────────────────────┘
    │
    ▼

FRONTEND
┌──────────────────────────────────────┐
│ 10. Show success toast               │
│     "Settlement created successfully"│
└──────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│ 11. Close modal                      │
│     Reset form                       │
└──────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│ 12. Reload settlements list          │
│     GET /api/financial/store-settle..│
│     Display with "pending" badge     │
└──────────────────────────────────────┘
```

---

## Key Calculations

### Store Settlement Net Amount
```javascript
// Formula
net_amount = total_orders_amount - commissions - deductions

// Example
total_orders_amount = ₨10,000     (SUM of all orders in period)
commissions = ₨1,000              (10% of total, platform cut)
deductions = ₨500                 (damages, returns, penalties)
─────────────────────────────────
net_amount = ₨8,500               (amount to pay store)
```

### Financial Summary (Dashboard)
```javascript
// Period: Month
income = SUM(financial_transactions.amount) 
         WHERE transaction_type = 'income'

expense = SUM(financial_transactions.amount) 
          WHERE transaction_type = 'expense'

settlement = SUM(financial_transactions.amount) 
             WHERE transaction_type = 'settlement'

net_profit = income - expense - settlement
```

### Wallet Balance
```javascript
// Updated after every transaction
new_balance = old_balance + transaction_amount

// transaction_amount is:
// +X for credit/refund
// -X for debit/transfer

// Example
starting_balance = ₨500
topup = +₨1000          → balance = ₨1,500
order_payment = -₨300   → balance = ₨1,200
refund = +₨50           → balance = ₨1,250
```

---

## Color Coding & Status Badges

### Status Visual Indicators
```css
/* Pending - Orange/Yellow */
.status-pending { background: #ffa500; color: white; }

/* Approved - Blue */
.status-approved { background: #2196F3; color: white; }

/* Paid/Completed - Green */
.status-paid, .status-completed { background: #4CAF50; color: white; }

/* Draft - Gray */
.status-draft { background: #999; color: white; }

/* Cancelled - Red */
.status-cancelled { background: #f44336; color: white; }

/* Reversed - Dark Red */
.status-reversed { background: #b71c1c; color: white; }
```

---

## Index Strategy (Performance)

```sql
-- Optimized indexes for common queries

-- Financial Transactions
CREATE INDEX idx_ft_transaction_type ON financial_transactions(transaction_type);
CREATE INDEX idx_ft_created_at ON financial_transactions(created_at);
CREATE INDEX idx_ft_payment_method ON financial_transactions(payment_method);
CREATE INDEX idx_ft_status ON financial_transactions(status);

-- Store Settlements
CREATE INDEX idx_ss_store_id ON store_settlements(store_id);
CREATE INDEX idx_ss_settlement_date ON store_settlements(settlement_date);
CREATE INDEX idx_ss_status ON store_settlements(status);

-- Rider Cash
CREATE INDEX idx_rcm_rider_id ON rider_cash_movements(rider_id);
CREATE INDEX idx_rcm_movement_type ON rider_cash_movements(movement_type);
CREATE INDEX idx_rcm_movement_date ON rider_cash_movements(movement_date);

-- Wallet Transactions
CREATE INDEX idx_wt_wallet_id ON wallet_transactions(wallet_id);
CREATE INDEX idx_wt_type ON wallet_transactions(type);
CREATE INDEX idx_wt_created_at ON wallet_transactions(created_at);
```

---

## Development Tips

1. **Always create financial_transaction record** when creating any financial document
2. **Use DECIMAL(12, 2)** for all monetary values, never FLOAT
3. **Track all state changes** with timestamps and user IDs
4. **Validate status transitions** - prevent invalid workflows
5. **Implement audit trail** - every change should be logged
6. **Test calculations** thoroughly - monetary values need precision
7. **Use transactions** for multi-step operations
8. **Document formulas** in comments for future maintainers

Good luck! 🚀
