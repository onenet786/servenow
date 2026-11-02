const test = require('node:test');
const assert = require('node:assert');
const { fakeDb, activeAccount, request } = require('./helpers');
const { clearAccountStatusCache } = require('../middleware/auth');
const admin = require('../routes/admin');

test.beforeEach(() => clearAccountStatusCache());

const owner = { id: 1, user_type: 'admin', email: 'admin@servenow.com' };

function reportDb(orders, lines) {
  return fakeDb((q, p) => {
    const a = activeAccount(q, 'admin');
    if (a) return a;
    if (/FROM orders\s+WHERE DATE\(created_at\) = \?/.test(q)) return [[orders]];
    if (/FROM order_items oi JOIN orders o/.test(q)) return [lines];
    return undefined;
  });
}

const get = (db, path = '/api/admin/daily-sale-report?date=2026-10-30', user = owner) =>
  request(admin, '/api/admin', db, { path, user });

test('daily sale: cash, credit and delivery add up to the day\'s sale, with profit split', async () => {
  const { db } = reportDb(
    { total_orders: 24, delivered_orders: 23, gross_sales: '14999.00', delivery_charges: '2750.00' },
    [
      { sale_type: 'cash', orders: 16, sale: '8319.00', profit: '555.40', lines_without_cost: 0 },
      { sale_type: 'credit', orders: 9, sale: '3930.00', profit: '278.75', lines_without_cost: 2 },
    ],
  );
  const { status, body } = await get(db);
  assert.equal(status, 200);
  const r = body.report;
  assert.equal(r.cash_sale, 8319);
  assert.equal(r.credit_sale, 3930);
  assert.equal(r.delivery_charges, 2750);
  assert.equal(r.adjustments, 0);
  assert.equal(r.total_sale, 14999);
  assert.equal(r.cash_sale + r.credit_sale + r.delivery_charges + r.adjustments, r.total_sale);
  assert.equal(r.cash_profit, 555.4);
  assert.equal(r.credit_profit, 278.75);
  assert.equal(r.total_profit, 834.15);
  assert.equal(r.lines_without_cost, 2);
});

test('daily sale: an order whose total differs from its items shows as an adjustment, the total still matches', async () => {
  const { db } = reportDb(
    { total_orders: 1, delivered_orders: 1, gross_sales: '900.00', delivery_charges: '150.00' },
    [{ sale_type: 'cash', orders: 1, sale: '90.00', profit: '10.00', lines_without_cost: 0 }],
  );
  const { report: r } = (await get(db)).body;
  assert.equal(r.adjustments, 660);
  assert.equal(r.cash_sale + r.credit_sale + r.delivery_charges + r.adjustments, r.total_sale);
  assert.equal(r.total_sale, 900);
});

test('daily sale: a day with no orders is all zeros, not an error', async () => {
  const { db } = reportDb({ total_orders: 0, delivered_orders: 0, gross_sales: 0, delivery_charges: 0 }, []);
  const { status, body } = await get(db);
  assert.equal(status, 200);
  assert.equal(body.report.total_sale, 0);
  assert.equal(body.report.cash_profit, 0);
  assert.equal(body.report.adjustments, 0);
});

test('daily sale: cancelled orders are left out of both queries', async () => {
  const { db, log } = reportDb({ total_orders: 0, gross_sales: 0, delivery_charges: 0 }, []);
  await get(db);
  const queries = log.filter((q) => /DATE\(.*created_at\) = \?/.test(q));
  assert.equal(queries.length, 2);
  for (const q of queries) assert.match(q, /<> 'cancelled'/);
});

test('daily sale: a bad date is refused and the date never reaches the SQL text', async () => {
  const { db, log } = reportDb({}, []);
  const r = await get(db, "/api/admin/daily-sale-report?date=2026-10-30'%20OR%201=1");
  assert.equal(r.status, 400);
  assert.ok(!log.some((q) => /OR 1=1/.test(q)));
});

test('daily sale: store owners, riders, customers and staff without the right are refused', async () => {
  for (const [type, right] of [['store_owner', false], ['customer', false], ['rider', false], ['standard_user', false]]) {
    clearAccountStatusCache();
    const { db, log } = fakeDb((q) => activeAccount(q, type) || (/user_permissions/.test(q) ? [right ? [{ 1: 1 }] : []] : undefined));
    const r = await get(db, undefined, { id: 3, user_type: type, email: 'x@example.com' });
    assert.equal(r.status, 403, type);
    assert.ok(!log.some((q) => /FROM order_items/.test(q)), `no sales read for ${type}`);
  }
});

test('daily sale: other admins and staff with the dashboard right can see it', async () => {
  const seen = await get(reportDb({ gross_sales: 0, delivery_charges: 0 }, []).db, undefined, { id: 2, user_type: 'admin', email: 'second@servenow.com' });
  assert.equal(seen.status, 200);
  clearAccountStatusCache();
  const { db } = fakeDb((q) => {
    const a = activeAccount(q, 'standard_user');
    if (a) return a;
    if (/user_permissions/.test(q)) return [[{ 1: 1 }]];
    if (/FROM orders\s+WHERE DATE/.test(q)) return [[{ gross_sales: 0, delivery_charges: 0 }]];
    return undefined;
  });
  assert.equal((await get(db, undefined, { id: 4, user_type: 'standard_user', email: 's@x.pk' })).status, 200);
});
