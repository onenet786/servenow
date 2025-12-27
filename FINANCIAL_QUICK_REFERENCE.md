# Financial Management - Quick Reference Card

## 📋 Modules & Tabs

| Tab | Location | Purpose | Models | Statuses |
|-----|----------|---------|--------|----------|
| **Transactions** | Financial > Transactions | Record all financial movements | financial_transactions | pending, completed, cancelled, reversed |
| **Payment Vouchers** | Financial > Payments & Wallets > Wallets | Issue payments to entities | cash_payment_vouchers | draft, pending, approved, paid, cancelled |
| **Receipt Vouchers** | Financial > Payments & Wallets | Record received payments | cash_receipt_vouchers | draft, pending, received, cancelled |
| **Rider Cash** | Financial > Rider Cash | Track rider cash movements | rider_cash_movements | pending, completed, approved, cancelled |
| **Store Settlements** | Financial > Store Settlements | Pay stores their earnings | store_settlements | pending, approved, paid, cancelled |
| **Expenses** | Financial > Expenses | Record admin expenses | admin_expenses | pending, approved, paid, rejected |
| **Reports** | Financial > Reports | Generate financial reports | financial_reports | - |

---

## 🔄 Quick Operations

### Create Store Settlement
```
1. Click "Create Settlement"
2. Select store from dropdown (populated from GET /api/stores?admin=1)
3. Set period (from/to dates)
4. Enter:
   - Total Orders Amount (e.g., ₨10,000)
   - Commissions (e.g., ₨1,000)
   - Deductions (e.g., ₨500)
5. Choose payment method
6. Submit → Creates with status='pending'
```

**Formula:** `net_amount = total_orders - commissions - deductions`

### Create Payment Voucher
```
1. Click "Create Payment Voucher"
2. Fill form:
   - Payee Name & Type (store/rider/vendor/employee/other)
   - Amount
   - Purpose
   - Payment Method (cash/check/bank_transfer)
3. Submit → status='draft'
4. Another admin clicks "Approve" → status='pending'
5. Accountant clicks "Pay" → status='paid'
```

### Record Rider Cash
```
1. Click "Record Cash Movement"
2. Select Rider (dropdown)
3. Choose Movement Type:
   - cash_collection: Rider collected from customer
   - cash_submission: Rider submitting to office
   - advance: Giving cash to rider
   - settlement: Paying for deliveries
   - adjustment: Corrections
4. Enter amount & description
5. Submit → status='pending'
```

### Create Expense
```
1. Click "Record Expense"
2. Fill form:
   - Category (utilities/maintenance/office/travel/marketing/other)
   - Description
   - Amount
   - Vendor name
   - Payment method
3. Submit → status='pending'
4. Admin approves → status='approved'
5. Marked as paid → status='paid'
```

---

## 📊 Database Tables Reference

### Quick Table Overview
```
WALLETS
  └─ wallet_transactions (credit/debit/refund/transfer)

FINANCIAL_TRANSACTIONS (Master Log)
  ↑ Updated by all operations below:
  
  ├─ cash_payment_vouchers (draft→pending→approved→paid)
  ├─ cash_receipt_vouchers (draft→pending→received)
  ├─ rider_cash_movements (pending→completed→approved)
  ├─ store_settlements (pending→approved→paid)
  └─ admin_expenses (pending→approved→paid)

FINANCIAL_REPORTS (Generated summaries)
```

---

## 🔑 Key Fields by Entity

### Payment Voucher
```javascript
{
  voucher_number: "PV-20251227-ABCXYZ",  // Auto-generated
  payee_name: "Fresh Market",
  payee_type: "store",                    // Enum: store|rider|vendor|employee|other
  amount: 2000.00,
  payment_method: "bank_transfer",        // Enum: cash|check|bank_transfer
  status: "approved",                     // Enum: draft|pending|approved|paid
  prepared_by: 1,                         // User ID
  approved_by: 2,                         // User ID
  paid_by: 3,                             // User ID
  approved_at: "2025-12-27T10:00:00Z",
  paid_at: "2025-12-27T14:30:00Z"
}
```

### Store Settlement
```javascript
{
  settlement_number: "SS-20251227-ABCXYZ",
  store_id: 1,
  period_from: "2025-12-01",
  period_to: "2025-12-15",
  total_orders_amount: 10000.00,          // SUM of orders
  commissions: 1000.00,                   // Platform cut (10%)
  deductions: 500.00,                     // Damages, returns, etc.
  net_amount: 8500.00,                    // What to pay
  status: "pending",                      // Enum: pending|approved|paid
  approved_by: 2,
  paid_by: 3
}
```

### Rider Cash Movement
```javascript
{
  movement_number: "RCM-20251227-ABCXYZ",
  rider_id: 1,
  movement_date: "2025-12-27",
  movement_type: "cash_submission",       // Enum: cash_collection|cash_submission|advance|settlement|adjustment
  amount: 1500.00,
  status: "completed",                    // Enum: pending|completed|approved
  recorded_by: 1,
  approved_by: 2
}
```

### Expense
```javascript
{
  expense_number: "EXP-20251227-ABCXYZ",
  category: "utilities",                  // Enum: utilities|maintenance|office|travel|marketing|other
  amount: 300.00,
  vendor_name: "City Utilities",
  receipt_number: "RCP-12345",
  status: "paid",                         // Enum: pending|approved|paid|rejected
  submitted_by: 1,
  approved_by: 2
}
```

---

## 🌐 Common API Calls

### Get Store List (for dropdowns)
```javascript
GET /api/stores?admin=1
RESPONSE: {
  stores: [
    { id: 1, name: "Fresh Market" },
    { id: 2, name: "Green Grocery" },
    { id: 3, name: "Local Foods" }
  ]
}
```

### Get Rider List
```javascript
GET /api/riders?admin=1
RESPONSE: {
  riders: [
    { id: 1, first_name: "Ahmed", last_name: "Khan" },
    { id: 2, first_name: "Fatima", last_name: "Ali" }
  ]
}
```

### Create Store Settlement
```javascript
POST /api/financial/store-settlements
BODY: {
  store_id: 1,
  period_from: "2025-12-01",
  period_to: "2025-12-15",
  total_orders_amount: 10000,
  commissions: 1000,
  deductions: 500,
  net_amount: 8500,
  payment_method: "bank_transfer"
}
RESPONSE: {
  success: true,
  settlement: {
    id: 1,
    settlement_number: "SS-20251227-ABCXYZ"
  }
}
```

### Get Financial Dashboard
```javascript
GET /api/financial/dashboard?period=month
RESPONSE: {
  success: true,
  stats: {
    income: 50000.00,
    expense: 5000.00,
    settlement: 8500.00,
    paymentVouchers: 10000.00,
    receiptVouchers: 5000.00,
    riderCashSubmitted: 3000.00
  }
}
```

### List Store Settlements
```javascript
GET /api/financial/store-settlements?status=pending
RESPONSE: {
  success: true,
  settlements: [
    {
      id: 1,
      settlement_number: "SS-...",
      store_name: "Fresh Market",
      net_amount: 8500,
      status: "pending"
    }
  ],
  total: 5,
  page: 1,
  limit: 20
}
```

### Approve Settlement
```javascript
PUT /api/financial/store-settlements/1
BODY: { status: "approved" }
RESPONSE: { success: true, message: "Settlement approved" }
```

---

## ✅ Common Workflows Checklist

### Workflow: Daily Store Settlement
- [ ] Collect all orders from period (Dec 1-15)
- [ ] Calculate total orders amount: ₨10,000
- [ ] Calculate commission: 10% = ₨1,000
- [ ] Note any deductions: damages, returns = ₨500
- [ ] Calculate net: ₨10,000 - ₨1,000 - ₨500 = ₨8,500
- [ ] Create settlement with dropdown selection
- [ ] Submit (status: pending)
- [ ] Get approval from second admin
- [ ] Accountant marks paid
- [ ] Financial transaction auto-created
- [ ] Payment processed via selected method

### Workflow: Record Rider Cash Submission
- [ ] Rider completes deliveries, collects cash
- [ ] Go to Financial → Rider Cash
- [ ] Click "Record Cash Movement"
- [ ] Select rider: Ahmed Khan
- [ ] Movement type: cash_submission
- [ ] Amount: ₨1,500 (collected)
- [ ] Description: "Daily cash submission"
- [ ] Submit (status: pending)
- [ ] Admin verifies amount matches
- [ ] Click "Approve" (status: completed/approved)
- [ ] Financial transaction created
- [ ] Rider's ledger updated

### Workflow: Pay Vendor via Payment Voucher
- [ ] Go to Financial → Payments & Wallets
- [ ] Click "Create Payment Voucher"
- [ ] Payee: "ABC Supplies" (vendor)
- [ ] Amount: ₨2,000
- [ ] Purpose: "Monthly supplies purchase"
- [ ] Payment method: "bank_transfer"
- [ ] Submit (status: draft)
- [ ] Approver reviews and clicks "Approve" (status: pending)
- [ ] Accountant processes & clicks "Pay" (status: paid)
- [ ] Bank transfer executed
- [ ] Financial transaction recorded

---

## 🛡️ Form Protection Features

All financial forms have:
- ✅ Persistent modals (cannot close via background/ESC)
- ✅ Disabled close button (×)
- ✅ Change tracking (warns on unsaved changes)
- ✅ Must use "Cancel" button to close
- ✅ Confirmation dialog if changes made
- ✅ Form auto-resets after successful submission

**How to close a form:**
1. Either click "Cancel" button and confirm discard
2. Or click "Create/Submit" to save changes

---

## 🐛 Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| Dropdown shows IDs instead of names | API returns wrong fields | Check endpoint returns both `id` and display field |
| Cannot create settlement | Store ID invalid | Verify store exists and is active |
| Amount calculation wrong | Using FLOAT instead of DECIMAL | Ensure DB uses DECIMAL(12, 2) |
| Status not updating | Invalid transition | Check workflow diagram for allowed transitions |
| Modal closes unexpectedly | Form not tracked | Verify `trackFormChanges()` called in `initializeFinancialForms()` |
| Financial transaction not created | Auto-creation code missing | Add transaction creation after record creation |
| Dropdown not populating | Modal opens before API call | Call `populateDropdown()` in create function |
| Timestamp null | Timestamp logic missing | Check if `approved_at`, `paid_at` set when status changes |

---

## 📈 Report Types

| Type | Fields | Use Case |
|------|--------|----------|
| **Daily Summary** | income, expense, profit | Daily check-in |
| **Weekly Summary** | income, expense, profit | Weekly review |
| **Monthly Summary** | income, expense, commissions, profit | Monthly accounting |
| **Store Settlement** | store details, period, amounts | Settlement audit |
| **Rider Cash Report** | rider details, movements, totals | Rider reconciliation |
| **Expense Report** | category breakdown, totals | Cost analysis |
| **Custom** | user-defined period & filters | Ad-hoc analysis |

---

## 💡 Best Practices

1. **Always use dropdowns** for selecting related entities (not manual ID entry)
2. **Generate voucher numbers automatically** - never manual
3. **Create financial_transaction automatically** - maintain audit trail
4. **Track approvers/payers** - document decision chain
5. **Use DECIMAL** - never FLOAT for money
6. **Validate transitions** - prevent invalid workflows
7. **Timestamp everything** - when status changes
8. **Test calculations** - monetary precision is critical
9. **Use transactions** - for multi-step operations
10. **Protect persistent modals** - prevent accidental data loss

---

## 🔗 File References

| File | Purpose | Key Components |
|------|---------|-----------------|
| `routes/financial.js` | Backend API endpoints | GET/POST/PUT for all financial operations |
| `js/financial.js` | Frontend logic | All load/create/submit/approve functions |
| `admin.html` | Frontend UI | All modal forms and tables |
| `css/admin.css` | Styling | Modal styles, status badges |
| `database/schema.sql` | Database structure | All 9 financial tables |
| `FINANCIAL_MANAGEMENT_GUIDE.md` | Detailed docs | Complete reference |
| `FINANCIAL_ARCHITECTURE.md` | Visual diagrams | Data flows, relationships |

---

## 🚀 Development Sequence for New Feature

1. **Database**: Add table to `schema.sql`
2. **Backend API**: Add routes in `routes/financial.js`
3. **Frontend Form**: Add modal HTML to `admin.html`
4. **Frontend Logic**: Add functions to `js/financial.js`
5. **Modal Protection**: Add to `persistent-modal` class
6. **Testing**: Manual test all CRUD operations
7. **Documentation**: Update guides

---

## ⚡ Quick Command Reference

```bash
# View database schema
mysql -u root -p servenow < database/schema.sql

# Restart server
npm run dev

# Check for errors
browser console (F12)
server terminal

# Test API endpoint
curl -X GET http://localhost:3000/api/stores?admin=1 \
  -H "Authorization: Bearer YOUR_TOKEN"

# View logs
tail -f server.log
```

---

**Last Updated:** 2025-12-27  
**Version:** 1.0  
**Maintainer:** ServeNow Development Team

For detailed information, refer to `FINANCIAL_MANAGEMENT_GUIDE.md` and `FINANCIAL_ARCHITECTURE.md`
