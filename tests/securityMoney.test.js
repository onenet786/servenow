// Each test here is an attack from the security review. It must stay refused.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { fakeDb, activeAccount, request } = require('./helpers');
const { clearAccountStatusCache } = require('../middleware/auth');
const branchUtil = require('../utils/branches');
const { isBlockedAddress, checkUrl, fetchRemoteImage } = require('../utils/safeImageFetch');
const { stripProduct, stripStore } = require('../middleware/publicData');
const { documentBranch, journalVoucherBranch } = require('../utils/branchFinance');
const orders = require('../routes/orders');
const stores = require('../routes/stores');
const products = require('../routes/products');
const financial = require('../routes/financial');
const payments = require('../routes/payments');
const wallets = require('../routes/wallets');

test.beforeEach(() => {
  clearAccountStatusCache();
  branchUtil.clearBranchCache();
});

const staff = { id: 9, user_type: 'standard_user', email: 's@example.com' };
const owner = { id: 8, user_type: 'store_owner', email: 'o@example.com' };
const rider = { id: 7, user_type: 'rider', email: 'r@example.com' };
const customer = { id: 5, user_type: 'customer', email: 'c@example.com' };
const branchAdmin = { id: 21, user_type: 'admin', email: 'm@example.com' };

test('card orders are refused, because no card is ever charged', async () => {
  const { db, log } = fakeDb((q) => activeAccount(q, 'customer', 1));
  const r = await request(orders, '/api/orders', db, {
    method: 'POST', path: '/api/orders', user: customer,
    body: { items: [{ product_id: 1, quantity: 1 }], delivery_address: 'x', payment_method: 'card' },
  });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /Card payment is not available/);
  assert.ok(!log.some((q) => /^INSERT INTO orders/.test(q)));
});

test('manual orders cannot be card or an invented payment method', async () => {
  for (const payment_method of ['card', 'free']) {
    clearAccountStatusCache();
    const { db, log } = fakeDb((q) => activeAccount(q, 'admin'));
    const r = await request(orders, '/api/orders', db, {
      method: 'POST', path: '/api/orders/admin/manual-create', user: { id: 1, user_type: 'admin' }, body: { payment_method },
    });
    assert.equal(r.status, 400, payment_method);
    assert.ok(!log.some((q) => /^INSERT INTO orders/.test(q)));
  }
});

test('a store owner cannot change their payment terms or discount, but can change their phone', async () => {
  let update = '';
  let values = [];
  const { db } = fakeDb((q, p) => {
    const a = activeAccount(q, 'store_owner', 1);
    if (a) return a;
    if (/^SELECT \* FROM stores WHERE id = \?/.test(q)) return [[{ id: 4, owner_id: 8, branch_id: 1, payment_term: 'Credit' }]];
    if (/^UPDATE stores SET/.test(q)) { update = q; values = p; }
    return undefined;
  });
  await request(stores, '/api/stores', db, {
    method: 'PUT', path: '/api/stores/4', user: owner,
    body: { phone: '03001234567', payment_term: 'Cash Only', store_discount_percent: 0, payment_grace_days: 99 },
  });
  assert.match(update, /phone = \?/);
  assert.doesNotMatch(update, /payment_term = |store_discount/);
  assert.ok(!values.includes(99), 'owner cannot set grace days');
});

test('a store owner cannot set cost or margin on a product, but can set its price', async () => {
  let update = '';
  let values = [];
  const { db } = fakeDb((q, p) => {
    const a = activeAccount(q, 'store_owner', 1);
    if (a) return a;
    if (/FROM products p/.test(q)) return [[{ id: 3, store_id: 4, owner_id: 8, price: 100, cost_price: 80, discount_type: 'percent', discount_value: 20, payment_term: 'Credit with Discount' }]];
    if (/^UPDATE products SET/.test(q)) { update = q; values = p; }
    return undefined;
  });
  await request(products, '/api/products', db, {
    method: 'PUT', path: '/api/products/3', user: owner, body: { price: 120, cost_price: 120, profit_value: 0, discount_value: 0 },
  });
  assert.match(update, /price = \?/);
  assert.doesNotMatch(update, /discount_value/);
  // Cost follows the agreed discount (20% off 120, rounded as usual), not the 120 the owner sent
  assert.deepEqual(values.slice(-3, -1).map(Number), [120, 95]);
});

test('staff with no order right cannot read an order or its items', async () => {
  const mk = () => fakeDb((q) => {
    const a = activeAccount(q, 'standard_user');
    if (a) return a;
    if (/user_permissions/.test(q)) return [[]];
    if (/FROM orders o/.test(q)) return [[{ id: 5, user_id: 42, first_name: 'Secret', rider_id: null }]];
    return undefined;
  }).db;
  const one = await request(orders, '/api/orders', mk(), { path: '/api/orders/5', user: staff });
  assert.equal(one.status, 403);
  assert.equal(JSON.stringify(one.body).includes('Secret'), false);
  clearAccountStatusCache();
  assert.equal((await request(orders, '/api/orders', mk(), { path: '/api/orders/5/items', user: staff })).status, 403);
  clearAccountStatusCache();
  assert.equal((await request(orders, '/api/orders', mk(), { path: '/api/orders/available-riders', user: staff })).status, 403);
  clearAccountStatusCache();
  assert.equal((await request(orders, '/api/orders', mk(), { path: '/api/orders/rider/7/deliveries', user: staff })).status, 403);
});

test('available riders are cut to the branch', async () => {
  let params;
  const { db } = fakeDb((q, p) => {
    const a = activeAccount(q, 'admin', 2);
    if (a) return a;
    if (/FROM riders WHERE is_active/.test(q)) { params = p; return [[]]; }
    return undefined;
  });
  await request(orders, '/api/orders', db, { path: '/api/orders/available-riders', user: branchAdmin });
  assert.deepEqual(params, [2]);
});

test('admin: store owners are refused the store breakdown and push status', async () => {
  const admin = require('../routes/admin');
  const mk = () => fakeDb((q) => activeAccount(q, 'store_owner', 1)).db;
  assert.equal((await request(admin, '/api/admin', mk(), { path: '/api/admin/store-order-breakdown', user: owner })).status, 403);
  clearAccountStatusCache();
  assert.equal((await request(admin, '/api/admin', mk(), { path: '/api/admin/push-notification-status', user: owner })).status, 403);
});

test('a branch account cannot move a cash movement to a rider of another branch', async () => {
  const { db, log } = fakeDb((q) => {
    const a = activeAccount(q, 'admin', 2);
    if (a) return a;
    if (/FROM rider_cash_movements WHERE id = \?/.test(q)) return [[{ id: 4, branch_id: 2, rider_id: 1, status: 'pending' }]];
    if (/SELECT branch_id FROM riders WHERE id = \?/.test(q)) return [[{ branch_id: 1 }]];
    return undefined;
  });
  const r = await request(financial, '/api/financial', db, {
    method: 'PUT', path: '/api/financial/rider-cash/4', user: branchAdmin, body: { rider_id: 77 },
  });
  assert.equal(r.status, 403);
  assert.ok(!log.some((q) => /^UPDATE rider_cash_movements/.test(q)));
});

test('a branch account cannot name head-office staff or an unknown party on a money document', async () => {
  const { db } = fakeDb((q) => {
    if (/FROM users WHERE id/.test(q)) return [[{ branch_id: null }]];
    if (/FROM branches/.test(q)) return [[{ id: 1, name: 'Kot Addu', is_active: 1 }]];
    return undefined;
  });
  const user = { user_type: 'admin', branch_id: 2 };
  assert.equal((await documentBranch(db, user, undefined, { customer: 5 })).status, 403);
  assert.equal((await journalVoucherBranch(db, user, undefined, [{ entity_type: 'employee', entity_id: 5 }])).status, 403);
  // Head office may still pay its own staff
  assert.equal((await documentBranch(db, { user_type: 'admin', branch_id: null }, 1, { customer: 5 })).branchId, 1);
});

test('an order cannot take a store or product of another branch', async () => {
  const { db, log } = fakeDb((q) => {
    const a = activeAccount(q, 'admin');
    if (a) return a;
    if (/SELECT payment_status FROM orders/.test(q)) return [[{ payment_status: 'pending' }]];
    if (/^SELECT \* FROM orders WHERE id = \?/.test(q)) return [[{ id: 5, status: 'pending', branch_id: 2, payment_method: 'cash' }]];
    if (/SELECT id, branch_id FROM stores WHERE id IN/.test(q)) return [[{ id: 4, branch_id: 1 }]];
    return undefined;
  });
  const user = { id: 1, user_type: 'admin' };
  const put = await request(orders, '/api/orders', db, { method: 'PUT', path: '/api/orders/5/items', user, body: { items: [{ id: 1, quantity: 1 }], store_id: 4 } });
  assert.equal(put.status, 400);
  assert.ok(!log.some((q) => /^UPDATE order_items/.test(q)));
});

test('staff cannot change a settlement amount', async () => {
  const { db, log } = fakeDb((q) => {
    const a = activeAccount(q, 'standard_user');
    if (a) return a;
    if (/user_permissions/.test(q)) return [[{ 1: 1 }]];
    if (/FROM store_settlements WHERE id = \?/.test(q)) return [[{ id: 4, branch_id: 1, store_id: 2, net_amount: 100, status: 'pending' }]];
    return undefined;
  });
  const r = await request(financial, '/api/financial', db, {
    method: 'PUT', path: '/api/financial/store-settlements/4', user: staff, body: { net_amount: 999999 },
  });
  assert.equal(r.status, 403);
  assert.ok(!log.some((q) => /^UPDATE store_settlements/.test(q)));
});

test('of two approvals at the same moment, only one posts', async () => {
  const { db, log } = fakeDb((q) => {
    const a = activeAccount(q, 'admin');
    if (a) return a;
    if (/FROM admin_expenses WHERE id = \?/.test(q)) return [[{ id: 4, branch_id: 1, status: 'approved', amount: 10 }]];
    if (/^UPDATE admin_expenses/.test(q)) return [{ affectedRows: 0 }]; // the other request won
    return undefined;
  });
  const r = await request(financial, '/api/financial', db, {
    method: 'PUT', path: '/api/financial/expenses/4', user: { id: 1, user_type: 'admin' }, body: { status: 'paid', amount: 10 },
  });
  assert.equal(r.status, 409);
  assert.ok(log.some((q) => /^UPDATE admin_expenses .*WHERE id = \? AND status = \?/.test(q)));
  assert.ok(!log.some((q) => /^INSERT INTO financial_transactions/.test(q)));
});

test('a payment can only be refunded once', async () => {
  const { db, log } = fakeDb((q) => {
    const a = activeAccount(q, 'admin');
    if (a) return a;
    if (/FROM payments p/.test(q)) return [[{ id: 1, status: 'success', order_id: 5, amount: 100, customer_id: 42, payment_method: 'wallet' }]];
    if (/^UPDATE payments SET status = 'refunded' WHERE id = \? AND status = 'success'/.test(q)) return [{ affectedRows: 0 }];
    return undefined;
  });
  const r = await request(payments, '/api/payments', db, {
    method: 'POST', path: '/api/payments/1/refund', user: { id: 1, user_type: 'admin' }, body: { reason: 'customer asked' },
  });
  assert.equal(r.status, 409);
  assert.ok(!log.some((q) => /^UPDATE wallets|^INSERT INTO refunds/.test(q)));
});

test('wallet transfers: only customers receive, and the sender never sees an email', async () => {
  const { db, log } = fakeDb((q) => {
    if (/user_type = 'customer' AND is_active = 1/.test(q)) return [[]]; // a staff id, or none
    return activeAccount(q, 'customer', 1);
  });
  const r = await request(wallets, '/api/wallet', db, {
    method: 'POST', path: '/api/wallet/transfers/send', user: customer, body: { recipientId: 3, amount: 1 },
  });
  assert.equal(r.status, 404, JSON.stringify(r.body));
  assert.ok(log.some((q) => /user_type = 'customer'/.test(q)));
  log.length = 0;
  clearAccountStatusCache();
  await request(wallets, '/api/wallet', db, { path: '/api/wallet/transfers/sent', user: customer });
  const q = log.find((x) => /FROM wallet_transfers t/.test(x));
  assert.ok(q);
  assert.doesNotMatch(q, /recipient_email/);
});

test('a rider cannot read the customer with the same number', async () => {
  const mk = () => fakeDb((q) => activeAccount(q, 'rider')).db;
  assert.equal((await request(orders, '/api/orders', mk(), { path: '/api/orders/my-orders', user: rider })).status, 403);
  clearAccountStatusCache();
  assert.equal((await request(payments, '/api/payments', mk(), { path: '/api/payments/5', user: rider })).status, 403);
  clearAccountStatusCache();
  assert.equal((await request(payments, '/api/payments', mk(), { path: '/api/payments', user: rider })).status, 403);
});

test('paying cannot roll an order back once it has moved on', async () => {
  const { db, log } = fakeDb((q) => {
    const a = activeAccount(q, 'customer', 1);
    if (a) return a;
    if (/FROM orders WHERE id = \? AND user_id = \?/.test(q)) return [[{ id: 5, user_id: 5, status: 'out_for_delivery', payment_status: 'pending', total_amount: 100 }]];
    return undefined;
  });
  const r = await request(payments, '/api/payments', db, {
    method: 'POST', path: '/api/payments/process', user: customer, body: { orderId: 5, paymentMethod: 'cash', amount: 100 },
  });
  assert.equal(r.status, 400);
  assert.ok(!log.some((q) => /^UPDATE orders/.test(q)));
});

test('public data: margin fields go, offers shown to customers stay', () => {
  const p = stripProduct({ name: 'Milk', price: 90, discount_type: 'percent', discount_value: 5, offer: { discount_value: 10 } });
  assert.deepEqual(p, { name: 'Milk', price: 90, offer: { discount_value: 10 } });
  assert.equal(stripStore({ name: 'A', store_discount_percent: 7 }).store_discount_percent, undefined);
});

test('image links: private addresses, odd ports and non-images are refused', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1']) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  assert.equal(isBlockedAddress('8.8.8.8'), false);
  for (const url of ['http://127.0.0.1/x.png', 'http://[::1]/x.png', 'http://169.254.169.254/latest/meta-data', 'ftp://example.com/x', 'file:///etc/passwd', 'http://example.com:3306/x', 'http://user:pw@example.com/x']) {
    assert.throws(() => checkUrl(url), url);
    assert.equal(await fetchRemoteImage(url), null, url);
  }
});

test('image links: a name or redirect that leads to this machine is refused', async () => {
  let hit = 0;
  const server = http.createServer((_req, res) => { hit += 1; res.end('secret'); });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  // localhost resolves to a blocked address at connection time, whatever the port rule allows
  assert.equal(await fetchRemoteImage('http://localhost/x.png'), null);
  assert.equal(await fetchRemoteImage(`http://localhost:${port}/x.png`), null);
  assert.equal(hit, 0);
  server.close();
});
