// Fixes from the November 2026 review: branch dispatch SQL, delivered-order cancel, voucher approval with
// a changed payment method, branch privacy on store/product lists, and reversals of cancelled orders.
const test = require('node:test');
const assert = require('node:assert');
const { fakeDb, activeAccount, request } = require('./helpers');
const orders = require('../routes/orders');
const { checkDocumentUpdate } = require('../utils/financeControls');
const { filterPrivateData } = require('../middleware/publicData');

const branchStaff = { id: 60, user_type: 'standard_user', branch_id: 2, email: 'branch@example.com' };
const headOffice = { id: 1, user_type: 'admin', branch_id: null, email: 'admin@example.com' };

// ---- 1. available riders: the branch filter sits in WHERE, before ORDER BY / LIMIT

test('available riders for a branch account: valid SQL with the branch in WHERE', async () => {
  const { db, log } = fakeDb((q) => {
    // The account check reloads the branch from the database: answer it with branch 2.
    if (/FROM users WHERE id = \?/.test(q)) return [[{ is_active: 1, user_type: 'standard_user', branch_id: 2 }]];
    if (/FROM user_permissions/.test(q)) return [[{ 1: 1 }]];
    if (/FROM riders WHERE is_active = true AND is_available = true/.test(q)) return [[{ id: 7, first_name: 'Ali' }]];
    return undefined;
  });
  const r = await request(orders, '/api/orders', db, { path: '/api/orders/available-riders', user: branchStaff });
  const q = log.find((x) => /FROM riders WHERE is_active = true AND is_available = true/.test(x));
  assert.ok(q, 'rider query ran');
  assert.match(q, /AND branch_id = \? ORDER BY first_name ASC LIMIT 500$/);
  assert.equal(r.status, 200);
});

// ---- 2. a delivered order can only be cancelled by the users allowed to reopen terminal orders

test('staff with the cancel right still cannot cancel a delivered order', async () => {
  const { db, log } = fakeDb((q) => {
    const auth = activeAccount(q, 'standard_user');
    if (auth) return auth;
    if (/FROM user_permissions/.test(q)) return [[{ 1: 1 }]];
    if (/FROM orders o\s+LEFT JOIN stores s ON o.store_id = s.id\s+WHERE o.id = \?/.test(q)) {
      return [[{ id: 11, status: 'delivered', payment_status: 'paid', rider_id: 7, user_id: 42, order_number: 'ORD-11' }]];
    }
    if (/FROM rider_cash_submission_orders/.test(q)) return [[]];
    return undefined;
  });
  const r = await request(orders, '/api/orders', db, {
    method: 'PUT', path: '/api/orders/11/status', user: { id: 50, user_type: 'standard_user', email: 's@example.com' }, body: { status: 'cancelled' },
  });
  assert.equal(r.status, 403);
  assert.match(r.body.message, /delivered order cannot be cancelled/i);
  assert.ok(!log.some((q) => /^UPDATE orders/.test(q)), 'nothing changed');
  assert.ok(!log.some((q) => /DELETE FROM rider_store_payments/.test(q)), 'store payments kept');
});

// ---- 3. approving a voucher while changing its payment method is refused

function voucherDb(doc) {
  return fakeDb((q) => {
    if (/FROM cash_receipt_vouchers WHERE id = \?/.test(q)) return [[doc]];
    if (/FROM user_permissions/.test(q)) return [[{ 1: 1 }]];
    return undefined;
  });
}

test('a cash approver cannot approve a bank voucher by changing the method in the same request', async () => {
  const { db } = voucherDb({ id: 5, status: 'draft', payment_method: 'cash', amount: 1000, prepared_by: 99 });
  const r = await checkDocumentUpdate(db, { id: 50, user_type: 'standard_user' }, 'receipt_voucher', 5, { status: 'received', payment_method: 'bank_transfer' });
  assert.equal(r.status, 409);
  assert.match(r.message, /Save the new payment method first/);
});

test('admins are held to the same rule', async () => {
  const { db } = voucherDb({ id: 5, status: 'draft', payment_method: 'cash', amount: 1000, prepared_by: 99 });
  const r = await checkDocumentUpdate(db, headOffice, 'receipt_voucher', 5, { status: 'received', payment_method: 'bank_transfer' });
  assert.equal(r.status, 409);
});

test('changing the method without approving, or approving without changing it, is fine', async () => {
  const doc = { id: 5, status: 'draft', payment_method: 'cash', amount: 1000, prepared_by: 99 };
  assert.equal(await checkDocumentUpdate(voucherDb(doc).db, headOffice, 'receipt_voucher', 5, { payment_method: 'bank_transfer' }), null);
  assert.equal(await checkDocumentUpdate(voucherDb(doc).db, headOffice, 'receipt_voucher', 5, { status: 'received', payment_method: 'cash' }), null);
});

// ---- 4. branch privacy on store and product lists

function runFilter(user, body) {
  return new Promise((resolve) => {
    const req = { user, query: {}, db: { execute: async () => [[]] } };
    const res = { json: (b) => { resolve(b); return res; } };
    filterPrivateData(req, res, () => res.json(body));
  });
}

test("a branch account sees bank and commission details only on its own branch's stores", async () => {
  const out = await runFilter(branchStaff, {
    success: true,
    stores: [
      { id: 1, branch_id: 2, name: 'Ours', store_bank_account_number: '111', commission_rate: 10, owner_email: 'o@x' },
      { id: 2, branch_id: 1, name: 'Theirs', store_bank_account_number: '222', commission_rate: 12, owner_email: 't@x' },
    ],
  });
  assert.equal(out.stores[0].store_bank_account_number, '111');
  assert.equal(out.stores[1].store_bank_account_number, undefined);
  assert.equal(out.stores[1].commission_rate, undefined);
  assert.equal(out.stores[1].owner_email, undefined);
  assert.equal(out.stores[1].name, 'Theirs');
});

test("a branch account never sees another branch's product cost", async () => {
  const out = await runFilter(branchStaff, {
    success: true,
    products: [{ id: 1, store_branch_id: 2, cost_price: 80 }, { id: 2, store_branch_id: 1, cost_price: 90 }, { id: 3, cost_price: 70 }],
  });
  assert.equal(out.products[0].cost_price, 80);
  assert.equal(out.products[1].cost_price, undefined);
  assert.equal(out.products[2].cost_price, undefined, 'unknown branch counts as not ours');
});

test('head office still sees everything', async () => {
  const body = { success: true, stores: [{ id: 2, branch_id: 1, store_bank_account_number: '222' }] };
  const out = await runFilter(headOffice, body);
  assert.equal(out.stores[0].store_bank_account_number, '222');
});

// ---- 5. each wallet entry of a cancelled order is reversed exactly once

const e = (id, type, amount, ref = 'order', description = '', wallet = 3) => ({ id, wallet_id: wallet, type, amount, reference_type: ref, description });

test('every entry is reversed, not just one per wallet', () => {
  const left = orders.unreversedOrderEntries([e(1, 'credit', 500), e(2, 'debit', 300)]);
  assert.deepEqual(left.map((x) => x.id), [1, 2]);
});

test('a reversal that stopped part way is completed on retry', () => {
  const left = orders.unreversedOrderEntries([e(1, 'credit', 500), e(2, 'debit', 300), e(3, 'debit', 500, 'order_cancel_reversal', 'Reversal [wt:1]: x')]);
  assert.deepEqual(left.map((x) => x.id), [2]);
});

test('cancel, reopen, pick up and cancel again: the new entries are reversed too', () => {
  const left = orders.unreversedOrderEntries([
    e(1, 'credit', 500), e(2, 'debit', 500, 'order_cancel_reversal', 'Reversal [wt:1]: x'),
    e(3, 'credit', 500), // charged again after reopening
  ]);
  assert.deepEqual(left.map((x) => x.id), [3]);
});

test('reversals from before the tag are matched by wallet, amount and direction', () => {
  const left = orders.unreversedOrderEntries([e(1, 'credit', 500), e(2, 'debit', 300), e(3, 'debit', 500, 'order_cancel_reversal', 'Reversal: old')]);
  assert.deepEqual(left.map((x) => x.id), [2]);
});
