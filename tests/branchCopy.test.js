const test = require('node:test');
const assert = require('node:assert');
const { fakeDb, activeAccount, request } = require('./helpers');
const branchUtil = require('../utils/branches');
const { clearAccountStatusCache } = require('../middleware/auth');
const { copyBranchStores, STORE_SKIP } = require('../utils/branchCopy');
const { classify } = require('../middleware/branchGuard');

test.beforeEach(() => {
  branchUtil.clearBranchCache();
  clearAccountStatusCache();
});

const COLUMNS = {
  stores: ['id', 'name', 'phone', 'owner_id', 'bank_id', 'store_bank_account_number', 'latitude', 'longitude', 'priority', 'rating', 'branch_id', 'source_store_id', 'created_at'],
  products: ['id', 'name', 'price', 'store_id', 'stock_quantity', 'created_at'],
  product_size_prices: ['id', 'product_id', 'price', 'created_at'],
};

function copyDb({ failOnStore } = {}) {
  let nextId = 100;
  return fakeDb((q, p) => {
    if (/information_schema\.COLUMNS/.test(q)) return [COLUMNS[p[0]].map((name) => ({ name }))];
    if (/^SELECT s\.id FROM stores s/.test(q)) return [[{ id: 1 }, { id: 2 }]];
    if (/^SELECT id FROM products WHERE store_id/.test(q)) return [p[0] === 1 ? [{ id: 11 }, { id: 12 }] : [{ id: 21 }]];
    if (/^INSERT INTO stores/.test(q)) {
      if (p[1] === failOnStore) throw new Error('disk full');
      nextId += 1;
      return [{ insertId: nextId }];
    }
    if (/^INSERT INTO products/.test(q)) { nextId += 1; return [{ insertId: nextId }]; }
    return undefined;
  });
}

test('copy: stores and products are copied, one transaction per store', async () => {
  const { db, log } = copyDb();
  assert.deepEqual(await copyBranchStores(db, 1, 2), { stores: 2, products: 3 });
  assert.equal(log.filter((q) => q === 'BEGIN').length, 2);
  assert.equal(log.filter((q) => q === 'COMMIT').length, 2);
  assert.equal(log.filter((q) => /^INSERT INTO products/.test(q)).length, 3);
  assert.equal(log.filter((q) => /^INSERT INTO product_size_prices/.test(q)).length, 3);
});

test('copy: owner, bank, map pin, priority and rating never go across', async () => {
  const { db, log } = copyDb();
  await copyBranchStores(db, 1, 2);
  const insert = log.find((q) => /^INSERT INTO stores/.test(q));
  for (const col of ['owner_id', 'bank_id', 'store_bank_account_number', 'latitude', 'longitude', 'priority', 'rating', 'created_at']) {
    assert.ok(!insert.includes(`\`${col}\``), col);
  }
  assert.ok(insert.includes('`name`') && insert.includes('`phone`'));
  assert.ok(STORE_SKIP.has('owner_id'));
});

test('copy: it never writes to orders, wallets or money', async () => {
  const { db, log } = copyDb();
  await copyBranchStores(db, 1, 2);
  const writes = log.filter((q) => /^(INSERT|UPDATE|DELETE)/.test(q));
  assert.ok(writes.length > 0);
  for (const q of writes) assert.match(q, /^INSERT INTO (stores|products|product_size_prices)\b/, q);
});

test('copy: copies into an open branch stay hidden until edited', async () => {
  const { db, log } = copyDb();
  await copyBranchStores(db, 1, 2, { hide: true });
  assert.equal(log.filter((q) => /^UPDATE stores SET is_customer_visible = 0/.test(q)).length, 2);
});

test('copy: a failure undoes that store, keeps finished ones, and says how far it got', async () => {
  const { db, log } = copyDb({ failOnStore: 2 });
  await assert.rejects(copyBranchStores(db, 1, 2), (e) => {
    assert.deepEqual(e.copied, { stores: 1, products: 2 });
    return true;
  });
  assert.equal(log.filter((q) => q === 'COMMIT').length, 1);
  assert.equal(log.filter((q) => q === 'ROLLBACK').length, 1);
  assert.ok(log.includes('RELEASE'), 'the connection is given back');
});

// ---------------------------------------------------------------- who may do it

const router = require('../routes/branches');
const OWNER = 'admin@servenow.com';
const rows = [{ id: 1, name: 'Kot Addu', is_active: 1 }, { id: 2, name: 'Muzaffargarh', is_active: 0 }];

function accountDb(type, email) {
  return fakeDb((q) => {
    if (/SELECT email, user_type, is_active, branch_id FROM users/.test(q)) return [[{ email, user_type: type, is_active: 1, branch_id: null }]];
    const a = activeAccount(q, type, null);
    if (a) return a;
    if (/FROM branches/.test(q)) return [rows];
    if (/SELECT COUNT\(\*\) AS n/.test(q)) return [[{ n: 0 }]];
    return undefined;
  }).db;
}

test('copy: only the owner, everyone else gets "not found"', async () => {
  const other = accountDb('admin', 'second@servenow.com');
  const user = { id: 3, user_type: 'admin', email: 'x@x.pk' };
  const post = await request(router, '/api/branches', other, { method: 'POST', path: '/api/branches/2/copy-stores', user, body: { from_branch_id: 1 } });
  assert.equal(post.status, 404);
  const get = await request(router, '/api/branches', other, { path: '/api/branches/2/copy-preview?from=1', user });
  assert.equal(get.status, 404);
});

test('copy: a branch cannot be copied onto itself, and both branches must exist', async () => {
  const db = accountDb('admin', OWNER);
  const user = { id: 1, user_type: 'admin', email: OWNER };
  const post = (path, body) => request(router, '/api/branches', db, { method: 'POST', path, user, body });
  assert.equal((await post('/api/branches/2/copy-stores', { from_branch_id: 2 })).status, 400);
  assert.equal((await post('/api/branches/2/copy-stores', {})).status, 400);
  assert.equal((await post('/api/branches/2/copy-stores', { from_branch_id: 9 })).status, 404);
  assert.equal((await post('/api/branches/9/copy-stores', { from_branch_id: 1 })).status, 404);
});

test('copy: the preview reports counts for the owner', async () => {
  const db = accountDb('admin', OWNER);
  const r = await request(router, '/api/branches', db, { path: '/api/branches/2/copy-preview?from=1', user: { id: 1, user_type: 'admin', email: OWNER } });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.stores, r.body.products, r.body.already_copied], [0, 0, 0]);
});

test('copy: the guard lets the request reach the route, which refuses non-owners itself', () => {
  assert.equal(classify('POST', '/api/branches/2/copy-stores').allow, true);
});

test('show stores: the owner shows only copied stores of that branch; nobody else can', async () => {
  const run = (type, email) => {
    let sql = '';
    let params;
    const { db } = fakeDb((q, p) => {
      if (/SELECT email, user_type, is_active, branch_id FROM users/.test(q)) return [[{ email, user_type: type, is_active: 1, branch_id: null }]];
      const a = activeAccount(q, type, null);
      if (a) return a;
      if (/FROM branches/.test(q)) return [rows];
      if (/^UPDATE stores/.test(q)) { sql = q; params = p; return [{ affectedRows: 67 }]; }
      return undefined;
    });
    return request(router, '/api/branches', db, { method: 'POST', path: '/api/branches/2/show-copied-stores', user: { id: 3, user_type: type, email }, body: {} })
      .then((r) => ({ r, sql, params }));
  };
  const owner = await run('admin', OWNER);
  assert.equal(owner.r.status, 200);
  assert.equal(owner.r.body.shown, 67);
  assert.match(owner.sql, /source_store_id IS NOT NULL/);
  assert.deepEqual(owner.params, [2]);
  clearAccountStatusCache();
  const other = await run('admin', 'second@servenow.com');
  assert.equal(other.r.status, 404);
  assert.equal(other.sql, '', 'nothing changed');
});
