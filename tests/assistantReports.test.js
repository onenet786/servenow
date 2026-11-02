const test = require('node:test');
const assert = require('node:assert');
const { fakeDb, activeAccount } = require('./helpers');
const { clearAccountStatusCache } = require('../middleware/auth');
const ai = require('../services/aiagent');
const { REPORT_KEYS, resolvePeriod, withoutPrivate, fitForModel } = require('../services/assistantReports');

test.beforeEach(() => clearAccountStatusCache());

const owner = { id: 1, type: 'admin', name: 'Owner', branch_id: null };
const orders = { total_orders: 24, delivered_orders: 24, gross_sales: '14999.00', delivery_charges: '2750.00' };
const lines = [
  { sale_type: 'cash', orders: 20, sale: '8319.00', profit: '555.40', lines_without_cost: 0 },
  { sale_type: 'credit', orders: 4, sale: '3930.00', profit: '278.75', lines_without_cost: 0 },
];

function reportDb(type = 'admin', extra = () => undefined) {
  return fakeDb((q, p) => {
    const a = activeAccount(q, type);
    if (a) return a;
    if (/SELECT id, email, user_type, first_name, last_name FROM users WHERE id = \?/.test(q)) {
      return [[{ id: p[0], email: 'x@servenow.pk', user_type: type, first_name: 'X', last_name: 'Y' }]];
    }
    if (/FROM branches/.test(q)) return [[{ id: 1, name: 'Kot Addu', city: 'Kot Addu', is_active: 1 }, { id: 2, name: 'Muzaffargarh', city: 'Muzaffargarh', is_active: 1 }]];
    if (/FROM orders\s+WHERE DATE\(created_at\) = \?/.test(q)) return [[orders]];
    if (/FROM order_items oi JOIN orders o/.test(q)) return [lines];
    return extra(q, p);
  });
}

const ask = (database, user, args) => ai.runTool(database, 'admin_report', args, user);

test('admin report: gives the panel\'s own figures for the day asked', async () => {
  const { db } = reportDb();
  const r = await ask(db, owner, { report: 'daily_sale', to: '2026-10-30' });
  assert.equal(r.error, undefined);
  assert.equal(r.report.total_sale, 14999);
  assert.equal(r.report.cash_profit, 555.4);
  assert.deepEqual(r.period, { date: '2026-10-30' });
  assert.equal(r.branch, 'All branches');
});

test('admin report: only staff may use it', async () => {
  for (const type of ['customer', 'store_owner', 'rider']) {
    const { db, log } = reportDb(type);
    const r = await ask(db, { id: 5, type, name: 'X', branch_id: 1 }, { report: 'daily_sale' });
    assert.equal(r.error, 'not_permitted', type);
    assert.ok(!log.some((q) => /FROM order_items/.test(q)), `no sales read for ${type}`);
  }
  assert.equal((await ask(reportDb().db, null, { report: 'daily_sale' })).error, 'not_signed_in');
});

test('admin report: staff get what their rights allow, nothing more', async () => {
  const { db, log } = reportDb('standard_user', (q) => (/user_permissions/.test(q) ? [[]] : undefined));
  const r = await ask(db, { id: 3, type: 'standard_user', name: 'Staff', branch_id: null }, { report: 'daily_sale' });
  assert.equal(r.error, 'not_permitted');
  assert.match(r.message, /user rights/);
  assert.ok(!log.some((q) => /FROM order_items/.test(q)));
});

test('admin report: a branch account cannot name another branch', async () => {
  const { db, log } = reportDb();
  const manager = { id: 8, type: 'admin', name: 'Manager', branch_id: 2 };
  const r = await ask(db, manager, { report: 'daily_sale', branch: 'Kot Addu' });
  assert.equal(r.error, 'not_permitted');
  assert.match(r.message, /Muzaffargarh/);
  assert.ok(!log.some((q) => /FROM order_items/.test(q)));
});

test('admin report: a branch account is held to the website\'s guard', async () => {
  const { db, log } = fakeDb((q, p) => {
    if (/FROM users WHERE id = \?|FROM users\s+WHERE id/.test(q)) {
      return [[{ id: p[0], email: 'm@servenow.pk', user_type: 'admin', first_name: 'M', last_name: 'B', is_active: 1, branch_id: 2 }]];
    }
    if (/FROM branches/.test(q)) return [[{ id: 2, name: 'Muzaffargarh', is_active: 1 }]];
    return undefined;
  });
  const r = await ask(db, { id: 8, type: 'admin', name: 'Manager', branch_id: 2 }, { report: 'recent_activity' });
  assert.notEqual(r.error, 'unknown_report');
  assert.ok(!log.some((q) => /FROM orders\b/.test(q) && !/branch_id/.test(q)), 'never an unscoped read of orders');
});

test('admin report: only listed reports exist, whatever is asked for', async () => {
  for (const report of ['constructor', '__proto__', '../backup-db/download', 'backup-db/list', '', 'clearable-tables']) {
    assert.equal((await ask(reportDb().db, owner, { report })).error, 'unknown_report', report);
  }
  assert.ok(!REPORT_KEYS.some((k) => /backup|diagnostic|clear|execute/.test(k)));
});

test('admin report: bad dates and filters a report does not take are refused', async () => {
  assert.equal((await ask(reportDb().db, owner, { report: 'daily_sale', to: "2026-10-30' OR 1=1" })).error, 'bad_date');
  assert.equal((await ask(reportDb().db, owner, { report: 'daily_sale', store: 'Imran' })).error, 'no_filter');
});

test('admin report: a name that fits several stores asks which one', async () => {
  const { db } = reportDb('admin', (q) => (/FROM stores WHERE name LIKE/.test(q) ? [[{ id: 44, name: 'Adnan Broast' }, { id: 71, name: 'Imran Broast' }]] : undefined));
  const r = await ask(db, owner, { report: 'store_sales', store: 'broast' });
  assert.equal(r.error, 'choose');
  assert.equal(r.choices.length, 2);
});

test('admin report: named periods cover the right days', () => {
  const now = new Date(2026, 10, 2, 1, 30);
  assert.deepEqual(resolvePeriod({}, now), { from: '2026-11-02', to: '2026-11-02' });
  assert.deepEqual(resolvePeriod({ period: 'yesterday' }, now), { from: '2026-11-01', to: '2026-11-01' });
  assert.deepEqual(resolvePeriod({ period: 'last_7_days' }, now), { from: '2026-10-27', to: '2026-11-02' });
  assert.deepEqual(resolvePeriod({ period: 'last_month' }, now), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(resolvePeriod({ period: 'this_year' }, now), { from: '2026-01-01', to: '2026-11-02' });
  assert.deepEqual(resolvePeriod({ from: '2026-10-30', to: '2026-10-01' }, now), { from: '2026-10-01', to: '2026-10-30' });
  assert.deepEqual(resolvePeriod({ to: '2026-10-30' }, now), { from: '2026-10-30', to: '2026-10-30' });
});

test('admin report: contact and bank details never reach the model', () => {
  const out = withoutPrivate({
    success: true,
    rows: [{ name: 'Sana', phone: '0300', contact_no: '+92', customer_email: 'a@b', delivery_address: 'House 1', bank_account: '123', cnic_number: '3', net: 10, profile_image: 'x' }],
    totals: { net: 10 },
  });
  assert.deepEqual(out, { rows: [{ name: 'Sana', net: 10 }], totals: { net: 10 } });
});

test('admin report: long lists are cut to fit and totals stay', () => {
  const rows = Array.from({ length: 2000 }, (_, i) => ({ store: `Store number ${i}`, sale: i, items: [{ name: 'A long product name' }] }));
  const out = fitForModel({ rows, totals: { sale: 1999000 } });
  assert.ok(JSON.stringify(out).length <= 12000);
  assert.ok(out.rows.length > 0 && out.rows.length < 2000);
  assert.equal(out.totals.sale, 1999000);
  assert.equal(out.shortened_lists.rows, 2000);
  assert.match(out.shortened_note, /totals cover everything/);
});

test('admin report: short answers are left whole', () => {
  const data = { rows: [{ a: 1 }], totals: { a: 1 } };
  assert.deepEqual(fitForModel(data), data);
});

test('the report tool fits what AIAgent accepts', () => {
  const tool = ai.TOOLS.find((t) => t.name === 'admin_report');
  assert.ok(tool.description.length <= 1000);
  assert.ok(JSON.stringify(tool.inputSchema).length <= 8000);
  assert.ok(ai.TOOLS.length <= 25);
  assert.ok(!tool.action, 'reading only');
});
