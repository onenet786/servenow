const test = require('node:test');
const assert = require('node:assert');
const { fakeDb, activeAccount, request } = require('./helpers');
const orders = require('../routes/orders');

const customer = { id: 42, user_type: 'customer', email: 'c@example.com' };
const baseOrder = { items: [{ product_id: 7, quantity: 2 }], delivery_address: 'House 1, Street 2', payment_method: 'wallet' };

function orderDb(scenario) {
  return fakeDb((q, p) => {
    const auth = activeAccount(q, 'customer');
    if (auth) return auth;
    if (/information_schema/.test(q)) return [[{ cnt: 1 }]];
    if (/FROM products p .*WHERE p\.id = \?/.test(q)) {
      return [[{ id: p[0], price: 100, cost_price: 80, store_id: 1, name: 'Milk', size_id: null, unit_id: null,
        discount_type: null, discount_value: null, profit_type: null, profit_value: null,
        available_from: null, available_to: null, payment_term: 'credit' }]];
    }
    if (/FROM stores/.test(q)) {
      return [[{ id: 1, name: 'Store A', owner_id: 5, is_active: 1, is_closed: 0, opening_time: '00:00:00', closing_time: '23:59:59' }]];
    }
    if (/SELECT name, stock_quantity FROM products WHERE id = \? FOR UPDATE/.test(q)) return [[{ name: 'Milk', stock_quantity: scenario.stock }]];
    if (/FROM wallets WHERE user_id = \? FOR UPDATE/.test(q)) {
      return scenario.walletBalance === undefined ? [[]] : [[{ id: 9, balance: scenario.walletBalance }]];
    }
    if (/^INSERT INTO orders/.test(q) && scenario.dupOnce && !scenario.dupDone) {
      scenario.dupDone = true;
      throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
    }
    return undefined;
  });
}

const place = (scenario, body = baseOrder) => {
  const { db, log } = orderDb(scenario);
  return request(orders, '/api/orders', db, { method: 'POST', path: '/api/orders', user: customer, body }).then((r) => ({ ...r, log }));
};

test('wallet order is atomic: debit, order, stock and payment commit together', async () => {
  const r = await place({ stock: 10, walletBalance: 1000 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const at = (re) => r.log.findIndex((q) => re.test(q));
  const begin = at(/^BEGIN$/);
  const commit = at(/^COMMIT$/);
  assert.ok(begin >= 0 && commit > begin);
  for (const re of [/^UPDATE wallets SET balance = balance - \?/, /^INSERT INTO orders .*payment_status/,
    /stock_quantity = stock_quantity - \?/, /^INSERT INTO payments/]) {
    const i = at(re);
    assert.ok(i > begin && i < commit, `${re} should run inside the transaction`);
  }
  assert.ok(!r.log.slice(begin, commit).some((q) => /^(ALTER|CREATE)/.test(q)), 'no DDL inside the transaction');
  assert.ok(r.log.includes('RELEASE'));
});

test('insufficient stock: 409, rolled back, wallet untouched', async () => {
  const r = await place({ stock: 1, walletBalance: 1000 });
  assert.equal(r.status, 409);
  assert.ok(r.log.includes('ROLLBACK') && !r.log.includes('COMMIT'));
  assert.ok(!r.log.some((q) => /UPDATE wallets/.test(q)));
});

test('insufficient wallet balance: 400 and no order created', async () => {
  const r = await place({ stock: 10, walletBalance: 50 });
  assert.equal(r.status, 400);
  assert.ok(!r.log.some((q) => /^INSERT INTO orders/.test(q)));
});

test('order-number collision is retried with a fresh number', async () => {
  const r = await place({ stock: 10, walletBalance: 1000, dupOnce: true });
  assert.equal(r.status, 201);
  assert.ok(r.log.some((q) => /ORDER BY order_number DESC LIMIT 1 FOR UPDATE/.test(q)));
});

test('untracked stock does not block a cash order, which stays unpaid', async () => {
  const r = await place({ stock: null }, { ...baseOrder, payment_method: 'cash' });
  assert.equal(r.status, 201);
  assert.ok(!r.log.some((q) => /INSERT INTO payments/.test(q)));
});

test('malformed payloads return 400, never 500', async () => {
  for (const body of [{ ...baseOrder, items: 'x' }, { ...baseOrder, payment_method: 'bitcoin' },
    { ...baseOrder, delivery_address: 123 }, { ...baseOrder, items: [{ product_id: 7, quantity: 5000 }] }]) {
    assert.equal((await place({ stock: 10, walletBalance: 1000 }, body)).status, 400, JSON.stringify(body));
  }
});

function statusDb(scenario, userType) {
  return fakeDb((q) => {
    const auth = activeAccount(q, userType);
    if (auth) return auth;
    if (/information_schema/.test(q)) return [[{ cnt: 1 }]];
    if (/SELECT o\.\*, s\.owner_id as main_store_owner_id/.test(q)) {
      return [[{ id: 11, order_number: 'Ord1', user_id: 42, rider_id: null, status: scenario.status,
        payment_status: scenario.pay, payment_method: 'wallet', total_amount: 230, store_id: 1 }]];
    }
    if (/SELECT 1 FROM order_items oi JOIN stores s/.test(q)) return [[{ 1: 1 }]];
    if (/SELECT (oi\.)?id FROM order_items/.test(q)) return [[{ id: 1 }]];
    if (/SELECT item_status FROM order_items/.test(q)) return [[{ item_status: scenario.to }]];
    if (/FROM wallets WHERE user_id = \? LIMIT 1 FOR UPDATE/.test(q)) return [[{ id: 9, balance: 0 }]];
    if (/reference_type = 'order_refund'/.test(q)) return [scenario.alreadyRefunded ? [{ id: 1 }] : []];
    if (/reference_type = 'order' AND reference_id = \? AND type = 'debit'/.test(q)) return [[{ id: 3 }]];
    if (/UPDATE orders SET stock_deducted = 0/.test(q)) return [{ affectedRows: scenario.deducted ? 1 : 0 }];
    if (/SUM\(quantity\) AS qty/.test(q)) return [[{ product_id: 7, qty: 2 }]];
    return undefined;
  });
}

const setStatus = (scenario, user) => {
  const { db, log } = statusDb(scenario, user.user_type);
  return request(orders, '/api/orders', db, { method: 'PUT', path: '/api/orders/11/status', user, body: { status: scenario.to } })
    .then((r) => ({ ...r, log }));
};

test('cancelling a paid wallet order refunds once, in a transaction, and restores stock', async () => {
  const r = await setStatus({ status: 'confirmed', pay: 'paid', to: 'cancelled', deducted: true }, { id: 1, user_type: 'admin' });
  assert.equal(r.status, 200);
  const credit = r.log.findIndex((q) => /UPDATE wallets SET balance = balance \+ \?/.test(q));
  assert.ok(credit >= 0 && r.log.indexOf('COMMIT') > credit);
  assert.ok(r.log.some((q) => /payment_status = 'refunded'/.test(q)));
  assert.ok(r.log.some((q) => /stock_quantity = stock_quantity \+ \?/.test(q)));
});

test('no double refund, and no stock restore for orders that never deducted stock', async () => {
  const r = await setStatus({ status: 'confirmed', pay: 'paid', to: 'cancelled', alreadyRefunded: true }, { id: 1, user_type: 'admin' });
  assert.ok(!r.log.some((q) => /balance \+ \?/.test(q)));
  assert.ok(!r.log.some((q) => /stock_quantity \+ \?/.test(q)));
});

test('store owners: no rider statuses, no cancel after pickup, normal flow allowed', async () => {
  const owner = { id: 5, user_type: 'store_owner' };
  assert.equal((await setStatus({ status: 'confirmed', pay: 'pending', to: 'delivered' }, owner)).status, 403);
  assert.equal((await setStatus({ status: 'out_for_delivery', pay: 'pending', to: 'cancelled' }, owner)).status, 400);
  assert.equal((await setStatus({ status: 'preparing', pay: 'pending', to: 'ready' }, owner)).status, 200);
});

test('riders cannot place customer orders', async () => {
  const { db } = fakeDb((q) => activeAccount(q, 'rider'));
  const r = await request(orders, '/api/orders', db, { method: 'POST', path: '/api/orders', user: { id: 42, user_type: 'rider' }, body: baseOrder });
  assert.equal(r.status, 403);
});
