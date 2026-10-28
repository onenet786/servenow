const test = require('node:test');
const assert = require('node:assert');
const { fakeDb, request } = require('./helpers');
const fin = require('../routes/financial');

const staff = { id: 8, user_type: 'standard_user' };
const staff2 = { id: 9, user_type: 'standard_user' };
const admin = { id: 1, user_type: 'admin' };

function financeDb(docs, extra = () => undefined) {
  return fakeDb((q) => {
    if (/FROM users WHERE id = \?/.test(q) && /is_active/.test(q)) return [[{ is_active: 1, user_type: currentUser.user_type }]];
    if (/user_permissions/.test(q)) return [[{ 1: 1 }]];
    const m = q.match(/^SELECT \* FROM (\w+) WHERE id = \?/);
    if (m) return [docs[m[1]] ? [docs[m[1]]] : []];
    return extra(q);
  }).db;
}
let currentUser;
const call = (user, docs, method, path, body, extra) => {
  currentUser = user;
  return request(fin, '/api/financial', financeDb(docs, extra), { method, path, user, body });
};

test('preparer cannot approve their own payment voucher', async () => {
  const docs = { cash_payment_vouchers: { id: 5, status: 'draft', prepared_by: 8, amount: 500 } };
  assert.equal((await call(staff, docs, 'PUT', '/api/financial/payment-vouchers/5', { status: 'approved' })).status, 403);
});

test('posted payment vouchers are locked and final', async () => {
  let docs = { cash_payment_vouchers: { id: 5, status: 'paid', prepared_by: 8, amount: 500 } };
  assert.equal((await call(admin, docs, 'PUT', '/api/financial/payment-vouchers/5', { amount: 1 })).status, 409);
  docs = { cash_payment_vouchers: { id: 5, status: 'approved', prepared_by: 8, amount: 500 } };
  assert.equal((await call(staff2, docs, 'PUT', '/api/financial/payment-vouchers/5', { amount: 999 })).status, 409);
  assert.equal((await call(staff2, docs, 'PUT', '/api/financial/payment-vouchers/5', { status: 'cancelled' })).status, 409);
});

test('expenses must be approved before they are paid', async () => {
  const docs = { admin_expenses: { id: 3, status: 'pending', submitted_by: 8, amount: 50000 } };
  assert.equal((await call(staff2, docs, 'PUT', '/api/financial/expenses/3', { status: 'paid' })).status, 409);
});

test('settlement approver cannot pay it, and the approved amount is frozen', async () => {
  const docs = { store_settlements: { id: 2, status: 'approved', approved_by: 9, net_amount: 850 } };
  assert.equal((await call(staff2, docs, 'PUT', '/api/financial/store-settlements/2', { status: 'paid' })).status, 403);
  assert.equal((await call(staff, docs, 'PUT', '/api/financial/store-settlements/2', { status: 'paid', net_amount: 8500 })).status, 409);
});

test('a received receipt voucher cannot be toggled back (no double rider debit)', async () => {
  const docs = { cash_receipt_vouchers: { id: 4, status: 'received', amount: 5000 } };
  assert.equal((await call(admin, docs, 'PUT', '/api/financial/receipt-vouchers/4', { status: 'pending' })).status, 409);
});

test('journal vouchers must balance to the paisa', async () => {
  const unbalanced = { voucher_date: '2026-10-28', total_amount: 500, entries: [{ entry_type: 'debit', amount: 500 }, { entry_type: 'credit', amount: 300 }] };
  assert.equal((await call(admin, {}, 'POST', '/api/financial/journal-vouchers', unbalanced)).status, 400);
  const floaty = { voucher_date: '2026-10-28', total_amount: 0.3, entries: [{ entry_type: 'debit', amount: 0.1 }, { entry_type: 'debit', amount: 0.2 }, { entry_type: 'credit', amount: 0.3 }] };
  assert.equal((await call(admin, {}, 'POST', '/api/financial/journal-vouchers', floaty)).status, 201);
});

test('journal voucher: preparer cannot post it, and it cannot be posted twice', async () => {
  const docs = { journal_vouchers: { id: 6, status: 'draft', prepared_by: 8 } };
  const entries = (q) => (/journal_voucher_entries WHERE jnv_id/.test(q) ? [[{ id: 1, amount: 10, entry_type: 'debit', account_name: 'x' }]] : undefined);
  assert.equal((await call(staff, docs, 'POST', '/api/financial/journal-vouchers/6/post', {}, entries)).status, 403);
  const alreadyPosted = (q) => (/UPDATE journal_vouchers SET status = 'posted'/.test(q) ? [{ affectedRows: 0 }] : entries(q));
  assert.equal((await call(staff2, docs, 'POST', '/api/financial/journal-vouchers/6/post', {}, alreadyPosted)).status, 409);
});

test('only admins can post directly to the ledger', async () => {
  const body = { transaction_type: 'income', amount: 10, payment_method: 'cash' };
  assert.equal((await call(staff2, {}, 'POST', '/api/financial/transactions', body)).status, 403);
});
