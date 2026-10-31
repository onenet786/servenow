const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { fakeDb, activeAccount, request, tokenFor } = require('./helpers');
const branches = require('../utils/branches');
const { classify, branchGuard } = require('../middleware/branchGuard');

const KOT = 1;
const MZG = 2;
const branchRows = [
  { id: KOT, code: 'kot-addu', name: 'Kot Addu', city: 'Kot Addu', is_active: 1, sort_order: 1 },
  { id: MZG, code: 'muzaffargarh', name: 'Muzaffargarh', city: 'Muzaffargarh', is_active: 1, sort_order: 2 },
];

test.beforeEach(() => {
  branches.clearBranchCache();
  require('../middleware/auth').clearAccountStatusCache();
});

// ---------------------------------------------------------------- helpers (utils/branches)

test('branch ids: only positive whole numbers are accepted', () => {
  for (const bad of [undefined, null, '', 0, -1, 1.5, 'abc', '1; DROP TABLE x', NaN, {}, []]) {
    assert.equal(branches.toBranchId(bad), null, String(bad));
  }
  assert.equal(branches.toBranchId('2'), 2);
  assert.equal(branches.toBranchId(7), 7);
});

test('scope: head office sees all, a branch account is held to its branch, others are not staff', () => {
  assert.equal(branches.staffScope({ user_type: 'admin', branch_id: null }), null);
  assert.equal(branches.staffScope({ user_type: 'admin', branch_id: 2 }), 2);
  assert.equal(branches.staffScope({ user_type: 'standard_user', branch_id: 2 }), 2);
  // A customer's branch is not a staff limit
  assert.equal(branches.staffScope({ user_type: 'customer', branch_id: 2 }), null);

  assert.deepEqual(branches.resolveStaffBranch({ user_type: 'admin', branch_id: 2 }, undefined), { branchId: 2, error: null });
  assert.deepEqual(branches.resolveStaffBranch({ user_type: 'admin', branch_id: 2 }, '2'), { branchId: 2, error: null });
  assert.ok(branches.resolveStaffBranch({ user_type: 'admin', branch_id: 2 }, '1').error, 'another branch is refused');
  assert.deepEqual(branches.resolveStaffBranch({ user_type: 'admin', branch_id: null }, '1'), { branchId: 1, error: null });
  assert.deepEqual(branches.resolveStaffBranch({ user_type: 'admin', branch_id: null }, undefined), { branchId: null, error: null });
});

test('customer branch: own branch wins over the request; a closed branch is refused', async () => {
  const { db } = fakeDb((q) => (/FROM branches/.test(q)
    ? [[branchRows[0], { ...branchRows[1], is_active: 0 }]] : undefined));
  // Signed in as a Kot Addu customer asking for Muzaffargarh: still Kot Addu
  assert.deepEqual(await branches.resolveCustomerBranch(db, { user_type: 'customer', branch_id: 1 }, '2'), { branchId: 1, error: null });
  // A visitor naming nothing gets Kot Addu
  assert.deepEqual(await branches.resolveCustomerBranch(db, null, undefined), { branchId: 1, error: null });
  // Muzaffargarh is switched off
  assert.match((await branches.resolveCustomerBranch(db, null, '2')).error, /not open yet/);
  assert.match((await branches.resolveCustomerBranch(db, null, '99')).error, /Unknown/);
});

test('socket rooms: head office hears all; a branch account only its own room', () => {
  assert.equal(branches.staffRoomFor({ user_type: 'admin', branch_id: null }), 'admins');
  assert.equal(branches.staffRoomFor({ user_type: 'admin', branch_id: 2 }), 'admins_b2');
  assert.deepEqual(branches.adminRoomsFor(2), ['admins', 'admins_b2']);
  assert.deepEqual(branches.adminRoomsFor(null), ['admins']);
});

// ---------------------------------------------------------------- the front door

test('guard: a branch account is shut out of everything not made branch-aware', () => {
  const denied = [
    ['GET', '/api/admin/visitor-stats'],
    ['POST', '/api/admin/execute-sql'],
    ['POST', '/api/admin/restore-db'],
    ['POST', '/api/admin/backup-db'],
    ['GET', '/api/admin/backup-db/list'],
    ['POST', '/api/admin/clear-transactional-data'],
    ['POST', '/api/admin/shrink-database'],
    ['POST', '/api/admin/wallets/5/adjust'],
    ['PUT', '/api/admin/store-product-sales-report/9'],
    ['POST', '/api/financial/banks'],
    ['POST', '/api/financial/gl/sync'],
    ['GET', '/api/wallet/balance'],
    ['GET', '/api/payments'],
    ['GET', '/api/permissions/groups'],
    ['POST', '/api/users'],
    ['PUT', '/api/users/5'],
    ['POST', '/api/products'],
    ['DELETE', '/api/products/3'],
    ['POST', '/api/categories'],
    ['PUT', '/api/stores/app-update-notification'],
    ['DELETE', '/api/riders/fuel-history/3'],
    ['GET', '/api/orders/rider/wallet-stats'],
    ['PUT', '/api/orders'],
  ];
  for (const [method, path] of denied) {
    assert.equal(classify(method, path).deny, true, `${method} ${path}`);
  }
});

test('guard: the branch-aware areas are open, and record routes are checked by branch', () => {
  assert.equal(classify('GET', '/api/orders').allow, true);
  assert.equal(classify('POST', '/api/orders/admin/manual-create').allow, true);
  assert.equal(classify('GET', '/api/stores').allow, true);
  assert.equal(classify('POST', '/api/stores').allow, true);
  assert.equal(classify('GET', '/api/riders').allow, true);
  assert.equal(classify('GET', '/api/users').allow, true);
  assert.equal(classify('GET', '/api/products').allow, true);
  assert.equal(classify('GET', '/api/branches').allow, true);
  assert.equal(classify('POST', '/api/auth/login').allow, true);
  assert.deepEqual(classify('PUT', '/api/orders/12/status'), { check: 'orders', id: 12 });
  assert.deepEqual(classify('PUT', '/api/stores/4'), { check: 'stores', id: 4 });
  assert.deepEqual(classify('PUT', '/api/riders/9'), { check: 'riders', id: 9 });
  assert.deepEqual(classify('GET', '/api/products/30'), { check: 'products', id: 30 });
});

function guardApp(db, handler = (_req, res) => res.json({ reached: true })) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = db; next(); });
  app.use(branchGuard);
  app.use((req, res) => handler(req, res));
  return app;
}

async function through(db, { method = 'GET', path, user }) {
  // Reuse the request helper by mounting the guarded app as a router
  const router = guardApp(db);
  return request(router, '/', db, { method, path, user });
}

const mzgAdmin = { id: 21, user_type: 'admin', email: 'm@example.com' };

function accountDb(extra, branchId) {
  return fakeDb((q, p) => activeAccount(q, 'admin', branchId) || (extra ? extra(q, p) : undefined));
}

test('guard: head office and customers pass straight through', async () => {
  const head = accountDb(null, null);
  assert.equal((await through(head.db, { path: '/api/admin/daily-sales-summary', user: mzgAdmin })).body.reached, true);
  const cust = fakeDb((q) => activeAccount(q, 'customer', 2));
  assert.equal((await through(cust.db, { path: '/api/wallet/balance', user: { id: 5, user_type: 'customer' } })).body.reached, true);
  // No token at all: the route's own authentication answers
  assert.equal((await through(head.db, { path: '/api/admin/x' })).body.reached, true);
});

test('guard: a branch account is refused outside its areas, and cannot forge a branch in its token', async () => {
  const { db } = accountDb(null, MZG);
  const r = await through(db, { path: '/api/admin/visitor-stats', user: mzgAdmin });
  assert.equal(r.status, 403);
  assert.equal(r.body.reached, undefined);
  // A token that claims head office (branch_id null) or another branch changes nothing: the database decides
  const forged = await through(db, { path: '/api/admin/backup-db/list', user: { ...mzgAdmin, branch_id: null } });
  assert.equal(forged.status, 403);
});

test("guard: another branch's order, store, rider and product look like they do not exist", async () => {
  const kotOrder = (q) => (/FROM orders WHERE id = \?/.test(q) ? [[{ branch_id: KOT }]] : undefined);
  const mine = (q) => (/FROM orders WHERE id = \?/.test(q) ? [[{ branch_id: MZG }]] : undefined);
  assert.equal((await through(accountDb(kotOrder, MZG).db, { method: 'PUT', path: '/api/orders/5/status', user: mzgAdmin })).status, 404);
  assert.equal((await through(accountDb(mine, MZG).db, { method: 'PUT', path: '/api/orders/5/status', user: mzgAdmin })).body.reached, true);

  const kotStore = (q) => (/FROM stores WHERE id = \?/.test(q) ? [[{ branch_id: KOT }]] : undefined);
  assert.equal((await through(accountDb(kotStore, MZG).db, { path: '/api/stores/3', user: mzgAdmin })).status, 404);
  const kotRider = (q) => (/FROM riders WHERE id = \?/.test(q) ? [[{ branch_id: KOT }]] : undefined);
  assert.equal((await through(accountDb(kotRider, MZG).db, { method: 'PUT', path: '/api/riders/3', user: mzgAdmin })).status, 404);
  const kotProduct = (q) => (/FROM products p JOIN stores s/.test(q) ? [[{ branch_id: KOT }]] : undefined);
  assert.equal((await through(accountDb(kotProduct, MZG).db, { path: '/api/products/3', user: mzgAdmin })).status, 404);
});

test('guard: if the branch cannot be worked out, a branch account gets nothing (fails closed)', async () => {
  const { db } = fakeDb((q) => {
    if (/FROM users WHERE id = \?/.test(q)) throw new Error('database down');
    return undefined;
  });
  const r = await through(db, { path: '/api/orders', user: mzgAdmin });
  assert.equal(r.status, 503);
  assert.equal(r.body.reached, undefined);
});

test('guard: the AIAgent tool endpoint is not reachable with a branch-account token', async () => {
  const { db } = accountDb(null, MZG);
  assert.equal((await through(db, { method: 'POST', path: '/integrations/aiagent/tools', user: mzgAdmin })).status, 403);
});

// ---------------------------------------------------------------- the branch routes

test('branches: the public list shows only open branches and no internals', async () => {
  const router = require('../routes/branches');
  const { db } = fakeDb((q) => (/FROM branches/.test(q) ? [[branchRows[0], { ...branchRows[1], is_active: 0 }]] : undefined));
  const r = await request(router, '/api/branches', db, { path: '/api/branches' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.branches.map((b) => b.name), ['Kot Addu']);
  assert.equal(r.body.branches[0].is_active, undefined);
});

// ---------------------------------------------------------------- stores, users, riders, orders

test('stores: a customer only gets their own branch; the branch is a bound parameter', async () => {
  const stores = require('../routes/stores');
  let storeSql;
  let storeParams;
  const { db } = fakeDb((q, p) => {
    const a = activeAccount(q, 'customer', MZG);
    if (a) return a;
    if (/FROM branches/.test(q)) return [branchRows];
    if (/FROM stores s LEFT JOIN store_status_messages/.test(q)) { storeSql = q; storeParams = p; return [[]]; }
    return undefined;
  });
  // The customer belongs to Muzaffargarh; asking for Kot Addu does not change that
  await request(stores, '/api/stores', db, { path: '/api/stores?branch_id=1', user: { id: 5, user_type: 'customer' } });
  assert.match(storeSql, /s\.branch_id = \?/);
  assert.deepEqual(storeParams, [MZG]);
  assert.ok(!/branch_id = 1/.test(storeSql), 'never built into the SQL text');
});

test('stores: old apps that name no branch get Kot Addu', async () => {
  const stores = require('../routes/stores');
  let storeParams;
  const { db } = fakeDb((q, p) => {
    if (/FROM branches/.test(q)) return [branchRows];
    if (/FROM stores s LEFT JOIN store_status_messages/.test(q)) { storeParams = p; return [[]]; }
    return undefined;
  });
  await request(stores, '/api/stores', db, { path: '/api/stores' });
  assert.deepEqual(storeParams, [KOT]);
});

test('stores: a branch account cannot list another branch, even with admin=1', async () => {
  const stores = require('../routes/stores');
  const { db } = fakeDb((q) => activeAccount(q, 'admin', MZG));
  const r = await request(stores, '/api/stores', db, { path: '/api/stores?admin=1&branch_id=1', user: mzgAdmin });
  assert.equal(r.status, 403);
});

test('users: a branch account lists only customers and store owners of its own branch', async () => {
  const users = require('../routes/users');
  let sql;
  let params;
  const { db } = fakeDb((q, p) => {
    const a = activeAccount(q, 'admin', MZG);
    if (a) return a;
    if (/FROM users\s+WHERE branch_id/.test(q) || /FROM users WHERE branch_id = \?/.test(q)) { sql = q; params = p; return [[]]; }
    return undefined;
  });
  await request(users, '/api/users', db, { path: '/api/users', user: mzgAdmin });
  assert.match(sql, /user_type IN \('customer', 'store_owner'\)/);
  assert.deepEqual(params, [MZG]);
});

test('riders: a branch account sees only its own riders', async () => {
  const riders = require('../routes/riders');
  let params;
  const { db } = fakeDb((q, p) => {
    const a = activeAccount(q, 'admin', MZG);
    if (a) return a;
    if (/information_schema/.test(q)) return [[{ cnt: 0 }]];
    if (/FROM riders r/.test(q)) { params = p; return [[]]; }
    return undefined;
  });
  await request(riders, '/api/riders', db, { path: '/api/riders', user: mzgAdmin });
  assert.deepEqual(params, [MZG]);
});

function storeOrderDb(storeBranch, customerBranch, captured) {
  return fakeDb((q, p) => {
    const auth = activeAccount(q, 'customer', customerBranch);
    if (auth) return auth;
    if (/information_schema/.test(q)) return [[{ cnt: 1 }]];
    if (/FROM branches/.test(q)) return [branchRows];
    if (/FROM products p .*WHERE p\.id = \?/.test(q)) {
      return [[{ id: p[0], price: 100, cost_price: 80, store_id: 1, name: 'Milk', size_id: null, unit_id: null,
        discount_type: null, discount_value: null, profit_type: null, profit_value: null,
        available_from: null, available_to: null, payment_term: 'credit' }]];
    }
    if (/SELECT id, branch_id FROM stores WHERE id IN/.test(q)) return [[{ id: 1, branch_id: storeBranch }]];
    if (/FROM stores/.test(q)) {
      return [[{ id: 1, branch_id: storeBranch, name: 'Store A', owner_id: 5, is_active: 1, is_closed: 0, opening_time: '00:00:00', closing_time: '23:59:59' }]];
    }
    if (/SELECT name, stock_quantity FROM products WHERE id = \? FOR UPDATE/.test(q)) return [[{ name: 'Milk', stock_quantity: 50 }]];
    if (/^INSERT INTO orders/.test(q)) { captured.sql = q; captured.params = p; }
    return undefined;
  });
}

const cartBody = { items: [{ product_id: 7, quantity: 1 }], delivery_address: 'Street 1', payment_method: 'cash' };

test('orders: a customer cannot order from another branch', async () => {
  const orders = require('../routes/orders');
  const captured = {};
  const { db } = storeOrderDb(KOT, MZG, captured); // Muzaffargarh customer, Kot Addu store
  const r = await request(orders, '/api/orders', db, { method: 'POST', path: '/api/orders', user: { id: 42, user_type: 'customer' }, body: cartBody });
  assert.equal(r.status, 403);
  assert.equal(captured.sql, undefined, 'no order was written');
});

test('orders: the order is stamped with the store branch, never one the client sends', async () => {
  const orders = require('../routes/orders');
  const captured = {};
  const { db } = storeOrderDb(MZG, MZG, captured);
  const r = await request(orders, '/api/orders', db, { method: 'POST', path: '/api/orders', user: { id: 42, user_type: 'customer' }, body: { ...cartBody, branch_id: 1 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(captured.sql, /branch_id/);
  // INSERT INTO orders (order_number, user_id, store_id, branch_id, ...): branch is the 4th value
  assert.equal(captured.params[3], MZG);
});

test('orders: a branch that is switched off takes no orders', async () => {
  const orders = require('../routes/orders');
  const captured = {};
  const base = storeOrderDb(MZG, MZG, captured);
  const { db } = fakeDb((q, p) => (/FROM branches/.test(q) ? [[branchRows[0], { ...branchRows[1], is_active: 0 }]] : base.db.execute(q, p).then((r) => r)));
  const r = await request(orders, '/api/orders', db, { method: 'POST', path: '/api/orders', user: { id: 42, user_type: 'customer' }, body: cartBody });
  assert.equal(r.status, 403);
  assert.match(r.body.message, /not taking orders/);
  assert.equal(captured.sql, undefined);
});

test('orders: the staff order list is cut to the branch', async () => {
  const orders = require('../routes/orders');
  let listSql;
  let listParams;
  const { db } = fakeDb((q, p) => {
    const a = activeAccount(q, 'admin', MZG);
    if (a) return a;
    if (/FROM orders o JOIN users u/.test(q)) { listSql = q; listParams = p; return [[]]; }
    return undefined;
  });
  await request(orders, '/api/orders', db, { path: '/api/orders', user: mzgAdmin });
  assert.match(listSql, /o\.branch_id = \?/);
  assert.equal(listParams[0], MZG);
  const other = await request(orders, '/api/orders', db, { path: '/api/orders?branch_id=1', user: mzgAdmin });
  assert.equal(other.status, 403);
});

test('auth: the branch comes from the database, not the token', async () => {
  const { authenticateToken } = require('../middleware/auth');
  const app = express();
  const { db } = fakeDb((q) => activeAccount(q, 'admin', MZG));
  app.use((req, _res, next) => { req.db = db; next(); });
  app.get('/who', authenticateToken, (req, res) => res.json({ branch: req.user.branch_id }));
  const http = require('http');
  const body = await new Promise((resolve) => {
    const server = app.listen(0, () => {
      http.get({ port: server.address().port, path: '/who', headers: { authorization: 'Bearer ' + tokenFor({ id: 77, user_type: 'admin', branch_id: 1 }) } }, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => { server.close(); resolve(JSON.parse(d)); });
      });
    });
  });
  assert.equal(body.branch, MZG);
});
