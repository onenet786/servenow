const test = require('node:test');
const assert = require('node:assert');
const { fakeDb, activeAccount, request } = require('./helpers');
const branchUtil = require('../utils/branches');
const { clearAccountStatusCache } = require('../middleware/auth');
const { stripProductCosts, stripStore, PRIVATE_STORE_KEYS } = require('../middleware/publicData');

const OWNER = 'admin@servenow.com';

test.beforeEach(() => {
  branchUtil.clearBranchCache();
  clearAccountStatusCache();
});

// Answers the auth check and the owner lookup for one account.
function accountDb({ type = 'admin', email = OWNER, branchId = null, extra } = {}) {
  return fakeDb((q, p) => {
    if (/SELECT email, user_type, is_active, branch_id FROM users/.test(q)) {
      return [[{ email, user_type: type, is_active: 1, branch_id: branchId }]];
    }
    const a = activeAccount(q, type, branchId);
    if (a) return a;
    return extra ? extra(q, p) : undefined;
  });
}

const router = require('../routes/branches');
const asUser = (id, user_type = 'admin') => ({ id, user_type, email: 'any@example.com' });

test('branch management: only the owner account gets in', async () => {
  const { db } = accountDb({ extra: (q) => (/FROM branches b/.test(q) ? [[{ id: 1, name: 'Kot Addu' }]] : undefined) });
  const r = await request(router, '/api/branches', db, { path: '/api/branches/all', user: asUser(1) });
  assert.equal(r.status, 200);
  assert.equal(r.body.branches[0].name, 'Kot Addu');
});

test('branch management: every other account is told it does not exist', async () => {
  const others = [
    { type: 'admin', email: 'second-admin@servenow.com' },
    { type: 'admin', email: OWNER, branchId: 2 }, // the owner email cannot be a branch account
    { type: 'standard_user', email: 'staff@servenow.com' },
    { type: 'store_owner', email: 'o@example.com' },
    { type: 'customer', email: 'c@example.com' },
  ];
  for (const who of others) {
    clearAccountStatusCache();
    let wrote = false;
    const { db } = accountDb({ ...who, extra: (q) => { if (/^(INSERT|UPDATE)/.test(q)) wrote = true; return undefined; } });
    const user = asUser(9, who.type);
    for (const [method, path, body] of [
      ['GET', '/api/branches/all'],
      ['POST', '/api/branches', { name: 'X', city: 'X', code: 'xx' }],
      ['PUT', '/api/branches/2', { is_active: true }],
    ]) {
      const r = await request(router, '/api/branches', db, { method, path, user, body });
      assert.equal(r.status, 404, `${who.email} ${method} ${path}`);
      assert.equal(r.body.branches, undefined);
    }
    assert.equal(wrote, false, who.email);
  }
});

test('branch management: an email claimed in the token counts for nothing, the database decides', async () => {
  const { db } = accountDb({ email: 'second-admin@servenow.com' });
  const r = await request(router, '/api/branches', db, { path: '/api/branches/all', user: { id: 2, user_type: 'admin', email: OWNER } });
  assert.equal(r.status, 404);
});

test('the owner account cannot be changed or taken over by another admin', async () => {
  const users = require('../routes/users');
  const put = async (target, body, callerEmail) => {
    clearAccountStatusCache();
    let updated = false;
    const { db } = fakeDb((q) => {
      const a = activeAccount(q, 'admin', null);
      if (a) return a;
      if (/^SELECT id, user_type, store_id, branch_id, email FROM users/.test(q)) return [[{ id: 1, user_type: 'admin', store_id: null, branch_id: null, email: target }]];
      if (/^SELECT email FROM users WHERE id/.test(q)) return [[{ email: callerEmail }]];
      if (/^UPDATE users/.test(q)) updated = true;
      return undefined;
    });
    const r = await request(users, '/api/users', db, { method: 'PUT', path: '/api/users/1', user: asUser(5), body });
    return { status: r.status, updated };
  };
  // Another admin resetting the owner's password
  assert.deepEqual(await put(OWNER, { password: 'newpassword123' }, 'second@servenow.com'), { status: 403, updated: false });
  // Another admin giving some account the owner's email
  assert.deepEqual(await put('someone@example.com', { email: OWNER }, 'second@servenow.com'), { status: 403, updated: false });
  // Even the owner cannot lock the account out of being the owner
  assert.equal((await put(OWNER, { branch_id: 2 }, OWNER)).status, 400);
  assert.equal((await put(OWNER, { is_active: false }, OWNER)).status, 400);
  // The owner can still change their own password, and other admins other accounts
  assert.equal((await put(OWNER, { password: 'newpassword123' }, OWNER)).updated, true);
  assert.equal((await put('someone@example.com', { firstName: 'A' }, 'second@servenow.com')).updated, true);
});

test('branch management: a new branch starts closed; the last open branch cannot be closed; bad input is refused', async () => {
  let inserted;
  const { db } = accountDb({ extra: (q, p) => {
    if (/MAX\(sort_order\)/.test(q)) return [[{ n: 2 }]];
    if (/^INSERT INTO branches/.test(q)) { inserted = { q, p }; return [{ insertId: 3 }]; }
    if (/^SELECT id, is_active FROM branches/.test(q)) return [[{ id: 1, is_active: 1 }]];
    if (/^SELECT COUNT\(\*\) AS n FROM branches WHERE is_active = 1/.test(q)) return [[{ n: 0 }]];
    return undefined;
  } });
  const user = asUser(1);
  const made = await request(router, '/api/branches', db, { method: 'POST', path: '/api/branches', user, body: { name: 'Layyah', city: 'Layyah', code: 'layyah', is_active: true } });
  assert.equal(made.status, 201);
  assert.ok(/is_active/.test(inserted.q) && inserted.p.includes(0), 'is_active is forced to 0');
  assert.ok(inserted.p.includes(3), 'a new branch goes to the end of the list');
  const close = await request(router, '/api/branches', db, { method: 'PUT', path: '/api/branches/1', user, body: { is_active: false } });
  assert.equal(close.status, 409);
  for (const body of [
    { name: '', city: 'X', code: 'abc' },
    { name: 'X', city: 'X', code: 'Bad Code!' },
    { name: 'X', city: 'X', code: 'abc', center_latitude: 200 },
    { name: 'X', city: 'X', code: 'abc', radius_km: -5 },
  ]) {
    const r = await request(router, '/api/branches', db, { method: 'POST', path: '/api/branches', user, body });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
});

test('dropdown names: staff only; a branch account gets its own branch alone', async () => {
  const rows = [{ id: 1, name: 'Kot Addu', is_active: 1 }, { id: 2, name: 'Muzaffargarh', is_active: 0 }];
  const mk = (type, branchId) => fakeDb((q) => activeAccount(q, type, branchId) || (/FROM branches/.test(q) ? [rows] : undefined)).db;
  const head = await request(router, '/api/branches', mk('admin', null), { path: '/api/branches/options', user: asUser(1) });
  assert.deepEqual(head.body.branches.map((b) => b.name), ['Kot Addu', 'Muzaffargarh']);
  clearAccountStatusCache();
  const branch = await request(router, '/api/branches', mk('standard_user', 2), { path: '/api/branches/options', user: asUser(1, 'standard_user') });
  assert.deepEqual(branch.body.branches.map((b) => b.name), ['Muzaffargarh']);
  clearAccountStatusCache();
  const cust = await request(router, '/api/branches', mk('customer', 1), { path: '/api/branches/options', user: asUser(1, 'customer') });
  assert.equal(cust.status, 403);
});

// ---------------------------------------------------------------- the data leak

const secretStore = {
  id: 3, name: 'Fresh Mart', owner_id: 8, owner_email: 'owner@x.pk', owner_name: 'Ali', is_active: 1, is_customer_visible: 1,
  bank_id: 4, bank_name: 'HBL', bank_account_number: '123', store_bank_account_title: 'Ali', store_bank_account_number: '999',
  payment_term: 'Credit', opening_time: '00:00:00', closing_time: '23:59:59', location: 'Main',
};

function storeDb(type, branchId = null, ownIds = []) {
  return fakeDb((q) => {
    const a = activeAccount(q, type, branchId);
    if (a) return a;
    if (/FROM branches/.test(q)) return [[{ id: 1, name: 'Kot Addu', is_active: 1 }]];
    if (/SELECT id FROM stores WHERE owner_id/.test(q)) return [ownIds.map((id) => ({ id }))];
    if (/FROM stores s/.test(q)) return [[secretStore]];
    return undefined;
  });
}

const storesRouter = require('../routes/stores');
const SECRETS = ['owner_email', 'owner_name', 'owner_id', 'bank_info', 'store_bank_account_number', 'store_bank_account_title', 'payment_term', 'bank_id'];

test('leak: a visitor gets no owner, bank or payment details, with or without admin=1', async () => {
  for (const path of ['/api/stores', '/api/stores?admin=1']) {
    const { db, log } = storeDb('customer');
    const r = await request(storesRouter, '/api/stores', db, { path });
    assert.equal(r.status, 200);
    assert.equal(r.body.stores[0].name, 'Fresh Mart');
    for (const k of SECRETS) assert.equal(r.body.stores[0][k], undefined, `${path} ${k}`);
    assert.ok(log.some((q) => /s\.is_active = true/.test(q)), 'admin=1 no longer shows hidden stores to a visitor');
  }
});

test('leak: customers are treated like visitors; staff still see everything', async () => {
  const cust = await request(storesRouter, '/api/stores', storeDb('customer', 1).db, { path: '/api/stores?admin=1', user: asUser(5, 'customer') });
  for (const k of SECRETS) assert.equal(cust.body.stores[0][k], undefined, k);
  clearAccountStatusCache();
  const staff = await request(storesRouter, '/api/stores', storeDb('admin').db, { path: '/api/stores?admin=1', user: asUser(5) });
  assert.equal(staff.body.stores[0].owner_email, 'owner@x.pk');
  assert.equal(staff.body.stores[0].store_bank_account_number, '999');
});

test("leak: a store owner sees their own store's details, not another store's", async () => {
  const mine = await request(storesRouter, '/api/stores', storeDb('store_owner', 1, [3]).db, { path: '/api/stores?admin=1', user: asUser(8, 'store_owner') });
  assert.equal(mine.body.stores[0].owner_email, 'owner@x.pk');
  clearAccountStatusCache();
  const other = await request(storesRouter, '/api/stores', storeDb('store_owner', 1, [99]).db, { path: '/api/stores?admin=1', user: asUser(8, 'store_owner') });
  assert.equal(other.body.stores[0].owner_email, undefined);
});

test('leak: the filters remove every private field, at any depth', () => {
  const stripped = stripStore({ ...Object.fromEntries(PRIVATE_STORE_KEYS.map((k) => [k, 'x'])), name: 'A', products: [{ name: 'P', cost_price: 5 }] });
  assert.deepEqual(Object.keys(stripped).sort(), ['name', 'products']);
  assert.equal(stripped.products[0].cost_price, undefined);
  const p = stripProductCosts({ name: 'Milk', price: 100, cost_price: 80, profit_value: 20, profit_type: 'amount', size_variants: [{ price: 100, cost_price: 80 }] });
  assert.deepEqual(p, { name: 'Milk', price: 100, size_variants: [{ price: 100 }] });
});

test('leak: products lose cost and profit for visitors, keep them for staff', async () => {
  const products = require('../routes/products');
  const mk = (type) => fakeDb((q) => {
    const a = activeAccount(q, type);
    if (a) return a;
    if (/FROM branches/.test(q)) return [[{ id: 1, name: 'Kot Addu', is_active: 1 }]];
    if (/FROM products p/.test(q)) return [[{ id: 1, name: 'Milk', price: 100, cost_price: 80, profit_type: 'amount', profit_value: 20, store_id: 3 }]];
    return undefined;
  }).db;
  const pub = await request(products, '/api/products', mk('customer'), { path: '/api/products?admin=1' });
  assert.equal(pub.status, 200);
  assert.equal(pub.body.products[0].name, 'Milk');
  assert.equal(pub.body.products[0].cost_price, undefined);
  assert.equal(pub.body.products[0].profit_value, undefined);
  const staff = await request(products, '/api/products', mk('admin'), { path: '/api/products?admin=1', user: asUser(5) });
  assert.equal(Number(staff.body.products[0].cost_price), 80);
});

// ---------------------------------------------------------------- settings per branch

test('settings: a branch row wins while switched on, otherwise the all-branches row', async () => {
  const run = async (own, all) => {
    const { db } = fakeDb((q) => {
      if (/WHERE branch_id IS NULL/.test(q)) return [all ? [all] : []];
      if (/WHERE branch_id = \?/.test(q)) return [own ? [own] : []];
      return undefined;
    });
    return branchUtil.latestSetting(db, 'live_promotions', 'id, is_enabled', 2);
  };
  assert.equal((await run({ id: 5, is_enabled: 1 }, { id: 9, is_enabled: 1 })).id, 5);
  assert.equal((await run({ id: 5, is_enabled: 0 }, { id: 9, is_enabled: 1 })).id, 9);
  assert.equal((await run(null, { id: 9, is_enabled: 0 })).id, 9);
  assert.equal(await run(null, null), null);
});

test('fees: a branch uses its own fees when set, otherwise the shared ones', async () => {
  const shared = { base_fee: 50, additional_per_store: 20 };
  const { db } = fakeDb((q, p) => {
    if (/FROM system_settings/.test(q)) return [p[0].endsWith('_b2') ? [{ setting_key: 'delivery_fee_base_b2', setting_value: '80' }] : []];
    return undefined;
  });
  assert.deepEqual(await branchUtil.applyBranchFees(db, 2, shared), { base_fee: 80, additional_per_store: 20 });
  assert.deepEqual(await branchUtil.applyBranchFees(db, 1, shared), shared);
  assert.deepEqual(await branchUtil.applyBranchFees(db, null, shared), shared);
});

test('orders: a closure for all branches and one for this branch both stop ordering', async () => {
  const orders = require('../routes/orders');
  const now = Date.now();
  const closed = { id: 1, is_enabled: 1, block_ordering: 1, status_message: 'Closed today', start_at: new Date(now - 3600e3), end_at: new Date(now + 3600e3) };
  const place = async (rowFor) => {
    clearAccountStatusCache();
    const { db } = fakeDb((q, p) => {
      const a = activeAccount(q, 'customer', 2);
      if (a) return a;
      if (/FROM global_delivery_status WHERE branch_id IS NULL/.test(q)) return [rowFor('all') ? [closed] : []];
      if (/FROM global_delivery_status WHERE branch_id = \?/.test(q)) return [rowFor(p[0]) ? [closed] : []];
      return undefined;
    });
    return request(orders, '/api/orders', db, { method: 'POST', path: '/api/orders', user: { id: 42, user_type: 'customer' }, body: {} });
  };
  assert.equal((await place((w) => w === 'all')).status, 403);
  assert.equal((await place((w) => w === 2)).status, 403);
  // Kot Addu's closure does not stop a Muzaffargarh customer (they fail later on the empty cart)
  assert.equal((await place((w) => w === 1)).status, 400);
});

test('settings: a branch account cannot set another branch or all branches... of another', async () => {
  const { db, log } = fakeDb((q) => activeAccount(q, 'admin', 2));
  const r = await request(storesRouter, '/api/stores', db, {
    method: 'PUT', path: '/api/stores/global-delivery-status', user: asUser(7), body: { branch_id: 1, is_enabled: false },
  });
  assert.equal(r.status, 403);
  assert.ok(!log.some((q) => /^INSERT INTO global_delivery_status/.test(q)));
});

test('hidden stores: customers get none of their products; staff still do', async () => {
  const products = require('../routes/products');
  let sql = '';
  const mk = (type) => fakeDb((q) => {
    const a = activeAccount(q, type);
    if (a) return a;
    if (/FROM branches/.test(q)) return [[{ id: 1, name: 'Kot Addu', is_active: 1 }]];
    if (/FROM products p/.test(q)) { sql = q; return [[]]; }
    return undefined;
  }).db;
  await request(products, '/api/products', mk('customer'), { path: '/api/products' });
  assert.match(sql, /is_customer_visible/);
  await request(products, '/api/products', mk('admin'), { path: '/api/products?admin=1', user: asUser(5) });
  assert.doesNotMatch(sql, /is_customer_visible/);
});
