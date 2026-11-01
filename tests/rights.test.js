const test = require('node:test');
const assert = require('node:assert');
const { RIGHTS, MODULES, TEMPLATES, unknownRights, highRisk } = require('../utils/rightsCatalog');
const { checkDocumentUpdate } = require('../utils/financeControls');

test('every right has a unique key, a module and a known risk', () => {
  assert.equal(new Set(RIGHTS.map((r) => r.key)).size, RIGHTS.length);
  for (const r of RIGHTS) {
    assert.ok(MODULES.includes(r.module), r.key);
    assert.ok(['low', 'medium', 'high'].includes(r.risk), r.key);
  }
});

test('job templates only use real rights', () => {
  for (const t of TEMPLATES) assert.deepEqual(unknownRights(t.rights), [], t.key);
});

test('cashier and auditor templates cannot approve anything', () => {
  for (const key of ['cashier', 'auditor', 'dispatcher', 'support', 'catalog']) {
    const t = TEMPLATES.find((x) => x.key === key);
    assert.deepEqual(t.rights.filter((r) => r.startsWith('approve_')), [], key);
  }
});

test('every approval right is high risk', () => {
  for (const r of RIGHTS.filter((x) => x.key.startsWith('approve_'))) assert.equal(r.risk, 'high', r.key);
  assert.deepEqual(highRisk(['menu_dashboard', 'approve_cpv']).map((r) => r.key), ['approve_cpv']);
});

const fakeDb = (doc, rights) => ({
  execute: async (sql, params) => {
    if (/FROM user_permissions/.test(sql)) return [rights.includes(params[1]) ? [{ 1: 1 }] : []];
    return [[doc]];
  },
});
const staff = { id: 9, user_type: 'standard_user' };

test('approving a bank voucher needs the bank right, not the cash one', async () => {
  const doc = { status: 'draft', payment_method: 'bank_transfer', prepared_by: 1, amount: 10 };
  const denied = await checkDocumentUpdate(fakeDb(doc, ['approve_cpv']), staff, 'payment_voucher', 1, { status: 'approved' });
  assert.equal(denied.status, 403);
  assert.equal(await checkDocumentUpdate(fakeDb(doc, ['approve_bpv']), staff, 'payment_voucher', 1, { status: 'approved' }), null);
});

test('editing a draft needs no approval right, and admins are not asked', async () => {
  const doc = { status: 'draft', payment_method: 'cash', prepared_by: 1, amount: 10 };
  assert.equal(await checkDocumentUpdate(fakeDb(doc, []), staff, 'payment_voucher', 1, { amount: 20 }), null);
  assert.equal(await checkDocumentUpdate(fakeDb(doc, []), { id: 2, user_type: 'admin' }, 'payment_voucher', 1, { status: 'approved' }), null);
});

test('products: staff need the right, and with it can edit any store; a store owner only their own', async () => {
  const { fakeDb, activeAccount, request } = require('./helpers');
  const { clearAccountStatusCache } = require('../middleware/auth');
  const products = require('../routes/products');
  const put = async (type, hasRight, ownerId) => {
    clearAccountStatusCache();
    const { db } = fakeDb((q) => {
      const a = activeAccount(q, type);
      if (a) return a;
      if (/user_permissions/.test(q)) return [hasRight ? [{ 1: 1 }] : []];
      if (/FROM products p/.test(q)) return [[{ id: 3, store_id: 4, owner_id: ownerId, price: 10, payment_term: null }]];
      return undefined;
    });
    return (await request(products, '/api/products', db, { method: 'PUT', path: '/api/products/3', user: { id: 7, user_type: type }, body: { name: 'New name' } })).status;
  };
  assert.notEqual(await put('standard_user', true, 99), 403, 'a catalog editor is not refused');
  assert.equal(await put('standard_user', false, 99), 403, 'no right, no edit');
  assert.equal(await put('store_owner', false, 99), 403, 'not their store');
  assert.notEqual(await put('store_owner', false, 7), 403, 'their own store');
});
