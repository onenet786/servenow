const test = require('node:test');
const assert = require('node:assert');
const { fakeDb, activeAccount, request } = require('./helpers');
const { clearAccountStatusCache } = require('../middleware/auth');
const { classify } = require('../middleware/branchGuard');
const admin = require('../routes/admin');

test.beforeEach(() => clearAccountStatusCache());

const answers = (q) => {
  if (/AS new_orders/.test(q)) return [[{ new_orders: 2, to_deliver: 5, to_deliver_value: '4200.00', waiting_rider: 1, today_orders: 9, today_delivered: 6, today_cancelled: 1 }]];
  if (/AS riders_active/.test(q)) return [[{ riders_active: 6, riders_available: 4 }]];
  if (/AS minutes/.test(q)) return [[{ order_number: 'Ord1', status: 'ready', total_amount: '500', minutes: 50, store_name: 'Imran Broast', has_rider: 0 }]];
  if (/FROM cash_payment_vouchers\s+GROUP BY/.test(q)) return [[{ status: 'draft', n: 1, amount: '1000' }, { status: 'approved', n: 50, amount: '1065154' }]];
  if (/FROM admin_expenses/.test(q)) return [[{ n: 2, amount: '300' }]];
  if (/AS cash, /.test(q)) return [[{ cash: '-53226.70', bank: '-2000', riders: '25639.50', stores: '25518.65' }]];
  if (/AS month_sale/.test(q)) return [[{ month_sale: '33413' }]];
  if (/AS month_income/.test(q)) return [[{ month_income: '9000', month_expense: '4000' }]];
  if (/AS ym/.test(q)) return [[{ ym: '2026-10', income: '120000', expense: '30000' }]];
  if (/account_code = '1100'/.test(q)) return [[{ name: 'Faizan Aziz', amount: '12149' }]];
  if (/account_code = '2000'/.test(q)) return [[{ name: 'Aaghosh Hotel', amount: '14530.25' }]];
  if (/ORDER BY v\.id DESC/.test(q)) return [[{ voucher_number: 'CPV-1', payment_method: 'cash', voucher_date: '2026-11-01', payee_name: 'Owner', purpose: 'rent', amount: '1000', status: 'draft' }]];
  return undefined;
};

function dashDb(type, rights = []) {
  return fakeDb((q, p) => {
    const a = activeAccount(q, type);
    if (a) return a;
    if (/user_permissions/.test(q)) return [p.some((k) => rights.includes(k)) ? [{ 1: 1 }] : []];
    return answers(q);
  });
}

const get = (db, user) => request(admin, '/api/admin', db, { path: '/api/admin/dashboard-overview', user });
const owner = { id: 1, user_type: 'admin', email: 'admin@servenow.com' };
const staff = { id: 3, user_type: 'standard_user', email: 's@x.pk' };

test('dashboard: an admin gets the work and the money', async () => {
  const { status, body } = await get(dashDb('admin').db, owner);
  assert.equal(status, 200);
  assert.equal(body.operations.new_orders, 2);
  assert.equal(body.operations.to_deliver_value, 4200);
  assert.equal(body.money.balances.cash, -53226.7);
  assert.equal(body.money.vouchers.approved_count, 50);
  assert.equal(body.money.expenses.count, 2);
  assert.equal(body.money.top_stores[0].amount, 14530.25);
  assert.equal(body.money.chart.length, 12);
  assert.equal(body.money.chart.at(-1).month, new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }).slice(0, 7));
  assert.equal(body.attention[0].has_rider, false);
});

test('dashboard: months with no entries still appear as zero', async () => {
  const { body } = await get(dashDb('admin').db, owner);
  assert.ok(body.money.chart.some((m) => m.income === 0 && m.expense === 0));
  const oct = body.money.chart.find((m) => m.month === '2026-10');
  assert.equal(oct.income, 120000);
});

test('dashboard: staff without the money right see the work, not the money', async () => {
  const { status, body } = await get(dashDb('standard_user', ['menu_dashboard']).db, staff);
  assert.equal(status, 200);
  assert.equal(body.money, null);
  assert.equal(body.operations.to_deliver, 5);
});

test('dashboard: staff with the money right see it', async () => {
  const { body } = await get(dashDb('standard_user', ['menu_dashboard', 'menu_financial_dashboard']).db, staff);
  assert.ok(body.money);
});

test('dashboard: staff with no dashboard right, store owners and others are refused', async () => {
  assert.equal((await get(dashDb('standard_user').db, staff)).status, 403);
  for (const type of ['store_owner', 'customer', 'rider']) {
    clearAccountStatusCache();
    const { db, log } = dashDb(type);
    assert.equal((await get(db, { id: 5, user_type: type, email: 'x@x.pk' })).status, 403, type);
    assert.ok(!log.some((q) => /gl_lines/.test(q)), `no money read for ${type}`);
  }
});

test('dashboard: no contact details leave the server', async () => {
  const { body } = await get(dashDb('admin').db, owner);
  assert.ok(!/phone|email|address/i.test(JSON.stringify(body)));
});

test('branch accounts may read the dashboard, cut to their branch by the admin router', () => {
  assert.deepEqual(classify('GET', '/api/admin/dashboard-overview'), { allow: true });
  assert.ok(classify('POST', '/api/admin/dashboard-overview').deny);
});
