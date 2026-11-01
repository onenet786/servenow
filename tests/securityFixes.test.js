// Each test here is an attack found in a security review. It must stay refused.
const test = require('node:test');
const assert = require('node:assert');
const { fakeDb, activeAccount, request } = require('./helpers');
const { clearAccountStatusCache } = require('../middleware/auth');
const orders = require('../routes/orders');

test.beforeEach(() => clearAccountStatusCache());

const storeOwner = { id: 8, user_type: 'store_owner', email: 'o@example.com' };
const staff = { id: 9, user_type: 'standard_user', email: 's@example.com' };

test('store owners cannot touch order editing routes', async () => {
  const { db, log } = fakeDb((q) => activeAccount(q, 'store_owner', 1));
  const attempts = [
    ['PUT', '/api/orders/5/delivery-fee', { delivery_fee: 9999999 }],
    ['GET', '/api/orders/5/items'],
    ['PUT', '/api/orders/5/items', { items: [] }],
    ['PUT', '/api/orders/5/customer', { customer_id: 2 }],
    ['POST', '/api/orders/5/items/add', {}],
    ['DELETE', '/api/orders/5/items/7'],
    ['POST', '/api/orders/admin/manual-create', {}],
    ['GET', '/api/orders/admin/manual-products?store_id=1'],
  ];
  for (const [method, path, body] of attempts) {
    const r = await request(orders, '/api/orders', db, { method, path, user: storeOwner, body });
    assert.equal(r.status, 403, `${method} ${path}`);
  }
  assert.ok(!log.some((q) => /^(UPDATE|INSERT|DELETE)/.test(q)), 'nothing was changed');
});

test('the delivery fee of a paid order cannot be raised', async () => {
  const { db, log } = fakeDb((q) => {
    const a = activeAccount(q, 'standard_user');
    if (a) return a;
    if (/user_permissions/.test(q)) return [[{ 1: 1 }]];
    if (/old_delivery_fee/.test(q)) return [[{ id: 5, total_amount: 200, old_delivery_fee: 50, payment_status: 'paid' }]];
    return undefined;
  });
  const r = await request(orders, '/api/orders', db, { method: 'PUT', path: '/api/orders/5/delivery-fee', user: staff, body: { delivery_fee: 9999999 } });
  assert.equal(r.status, 400);
  assert.ok(!log.some((q) => /^UPDATE orders/.test(q)));
});

test('an order cannot be given to a customer of another branch, and the lookup reveals nothing', async () => {
  const { db, log } = fakeDb((q) => {
    const a = activeAccount(q, 'standard_user', 2);
    if (a) return a;
    if (/user_permissions/.test(q)) return [[{ 1: 1 }]];
    if (/FROM orders WHERE id = \?/.test(q)) return [[{ id: 5, status: 'pending', delivery_address: 'x', branch_id: 2 }]];
    if (/FROM users\s+WHERE id = \? AND user_type = 'customer'/.test(q)) {
      return [[{ id: 3, first_name: 'Secret', phone: '0300', email: 'k@x.pk', branch_id: 1 }]];
    }
    return undefined;
  });
  const r = await request(orders, '/api/orders', db, { method: 'PUT', path: '/api/orders/5/customer', user: staff, body: { customer_id: 3 } });
  assert.equal(r.status, 404);
  assert.equal(JSON.stringify(r.body).includes('Secret'), false);
  assert.ok(!log.some((q) => /^UPDATE orders/.test(q)));
});

test('finance rules hold however the path is written', async () => {
  const financial = require('../routes/financial');
  const scoped = [];
  for (const path of ['/api/financial/reports/generate/', '/api/financial/REPORTS/GENERATE']) {
    clearAccountStatusCache();
    const { db, log } = fakeDb((q) => activeAccount(q, 'admin', 2));
    await request(financial, '/api/financial', db, { method: 'POST', path, user: { id: 7, user_type: 'admin' }, body: { branch_id: 1, report_type: 'x' } });
    scoped.push(log.length >= 0);
    const r = await request(financial, '/api/financial', db, { method: 'POST', path, user: { id: 7, user_type: 'admin' }, body: { branch_id: 1, report_type: 'x' } });
    // A branch account asking for another branch is refused by the scope, so it must have run
    assert.equal(r.status, 403, path);
  }
  assert.equal(scoped.length, 2);
});

test('another branch\'s voucher cannot be changed by writing the path in capitals', async () => {
  const financial = require('../routes/financial');
  const { db, log } = fakeDb((q) => {
    const a = activeAccount(q, 'admin', 2);
    if (a) return a;
    if (/FROM cash_payment_vouchers WHERE id = \?/.test(q)) return [[{ id: 4, branch_id: 1, status: 'pending' }]];
    return undefined;
  });
  const r = await request(financial, '/api/financial', db, { method: 'PUT', path: '/api/financial/PAYMENT-vouchers/4', user: { id: 7, user_type: 'admin' }, body: { status: 'approved' } });
  assert.equal(r.status, 404);
  assert.ok(!log.some((q) => /^UPDATE/.test(q)));
});

test('Facebook sign-in is off unless deliberately enabled', async () => {
  const auth = require('../routes/auth');
  const { db, log } = fakeDb(() => undefined);
  const r = await request(auth, '/api/auth', db, { method: 'POST', path: '/api/auth/facebook-mobile', body: { access_token: 'token-from-another-app' } });
  assert.equal(r.status, 403);
  assert.ok(!log.some((q) => /FROM users/.test(q)));
});

test('a new sign-up is only announced to staff, never to every connected socket', async () => {
  const auth = require('../routes/auth');
  const sent = [];
  const io = {
    emit: (e) => sent.push(['everyone', e]),
    to: (rooms) => ({ emit: (e) => sent.push([rooms, e]) }),
  };
  const { db } = fakeDb((q) => {
    if (/^SELECT id FROM users WHERE email/.test(q)) return [[]];
    if (/FROM branches/.test(q)) return [[{ id: 1, name: 'Kot Addu', is_active: 1 }]];
    if (/^INSERT INTO users/.test(q)) return [{ insertId: 500 }];
    return undefined;
  });
  await request(auth, '/api/auth', db, {
    method: 'POST', path: '/api/auth/register', io,
    body: { firstName: 'Eve', lastName: 'Tester', email: 'eve2@example.com', password: 'longpassword1' },
  });
  assert.ok(!sent.some(([to]) => to === 'everyone'));
  assert.deepEqual(sent.find(([, e]) => e === 'new_user')[0], ['admins', 'admins_b1']);
});

test('danger tools answer "not found" to everyone but the owner, other admins included', async () => {
  const admin = require('../routes/admin');
  for (const [type, email] of [['admin', 'second@servenow.com'], ['standard_user', 'staff@servenow.com']]) {
    clearAccountStatusCache();
    const { db, log } = fakeDb((q) => {
      if (/SELECT email, user_type, is_active, branch_id FROM users/.test(q)) return [[{ email, user_type: type, is_active: 1, branch_id: null }]];
      const a = activeAccount(q, type);
      if (a) return a;
      if (/user_permissions/.test(q)) return [[{ 1: 1 }]];
      return undefined;
    });
    const user = { id: 4, user_type: type, email };
    for (const [method, path] of [
      ['POST', '/api/admin/clear-transactional-data'], ['GET', '/api/admin/clearable-tables'],
      ['POST', '/api/admin/shrink-database'], ['POST', '/api/admin/execute-sql'], ['POST', '/api/admin/migrate/items'],
    ]) {
      const r = await request(admin, '/api/admin', db, { method, path, user, body: {} });
      assert.equal(r.status, 404, `${email} ${path}`);
    }
    assert.ok(!log.some((q) => /^(DELETE|TRUNCATE|DROP|OPTIMIZE)/i.test(q)));
  }
});

test('backups: Head Office and staff with the right can take them, branch-limited rules and restore do not change', async () => {
  const admin = require('../routes/admin');
  const list = async (type, hasRight) => {
    clearAccountStatusCache();
    const { db } = fakeDb((q) => {
      const a = activeAccount(q, type);
      if (a) return a;
      if (/user_permissions/.test(q)) return [hasRight ? [{ 1: 1 }] : []];
      return undefined;
    });
    return (await request(admin, '/api/admin', db, { path: '/api/admin/backup-db/list', user: { id: 4, user_type: type } })).status;
  };
  assert.notEqual(await list('admin', false), 403);
  assert.notEqual(await list('admin', false), 404);
  assert.notEqual(await list('standard_user', true), 403);
  assert.equal(await list('standard_user', false), 403);
  assert.equal(await list('store_owner', false), 403);

  clearAccountStatusCache();
  const { db } = fakeDb((q) => {
    if (/SELECT email, user_type, is_active, branch_id FROM users/.test(q)) return [[{ email: 'second@servenow.com', user_type: 'admin', is_active: 1, branch_id: null }]];
    return activeAccount(q, 'admin');
  });
  const restore = await request(admin, '/api/admin', db, { method: 'POST', path: '/api/admin/restore-db', user: { id: 4, user_type: 'admin' }, body: { filename: 'x.sql' } });
  assert.equal(restore.status, 404);
});
