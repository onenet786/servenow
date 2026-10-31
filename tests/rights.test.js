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
