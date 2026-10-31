const test = require('node:test');
const assert = require('node:assert');
const { fakeDb, activeAccount, request } = require('./helpers');
const branches = require('../utils/branches');
const { scopeSql, scopedDb, unscoped, documentBranch, journalVoucherBranch, financialEntryBranch } = require('../utils/branchFinance');
const { classify } = require('../middleware/branchGuard');
const ledger = require('../services/ledger');

const open2 = [[{ id: 1, name: 'Kot Addu', is_active: 1 }, { id: 2, name: 'Muzaffargarh', is_active: 1 }]];
const head = { user_type: 'admin', branch_id: null };
const mzg = { user_type: 'standard_user', branch_id: 2 };

test.beforeEach(() => {
  branches.clearBranchCache();
  require('../middleware/auth').clearAccountStatusCache();
});

// ---------------------------------------------------------------- the read filter

test('scopeSql: every table form is filtered, with and without an alias', () => {
  const cases = [
    ['SELECT * FROM orders o WHERE o.id = 1', /FROM \(SELECT \* FROM orders WHERE branch_id = 2\) AS o WHERE/],
    ['SELECT * FROM orders AS o', /\) AS o$/],
    ['SELECT id FROM orders WHERE id = 1', /\) AS orders WHERE id = 1/],
    ['SELECT 1 FROM stores\n  ORDER BY name', /\) AS stores\n {2}ORDER BY name/],
    ['SELECT 1 FROM a LEFT JOIN riders r ON r.id = a.x', /LEFT JOIN \(SELECT \* FROM riders WHERE branch_id = 2\) AS r ON/],
    ['SELECT SUM(x) FROM `store_settlements` ss', /\) AS ss/],
    ['SELECT (SELECT SUM(l.debit) FROM gl_lines l WHERE l.account_code = 1) x', /gj\.branch_id = 2\) AS l WHERE/],
  ];
  for (const [sql, want] of cases) assert.match(scopeSql(sql, 2), want, sql);
});

test('scopeSql: only reads change, and table names inside other names are left alone', () => {
  for (const sql of ['UPDATE orders SET a = 1', 'DELETE FROM orders WHERE id = 1', 'INSERT INTO payments (a) SELECT 1 FROM orders', 'ALTER TABLE orders ADD x INT']) {
    assert.equal(scopeSql(sql, 2), sql);
  }
  const other = 'SELECT 1 FROM orders_archive a JOIN information_schema.COLUMNS c';
  assert.equal(scopeSql(other, 2), other);
  assert.equal(scopeSql('SELECT 1 FROM banks', 2), 'SELECT 1 FROM banks');
});

test('scopeSql: a bad branch never reaches the SQL text', () => {
  for (const bad of [null, undefined, 0, -1, '1 OR 1=1', "2'; DROP TABLE orders; --"]) {
    assert.throws(() => scopeSql('SELECT 1 FROM orders', bad));
  }
});

test('scopedDb: head office keeps the real handle; a branch filters execute, query and connections', async () => {
  const { db, log } = fakeDb(() => undefined);
  assert.equal(scopedDb(db, null), db);
  const scoped = scopedDb(db, 2);
  await scoped.execute('SELECT 1 FROM orders');
  await scoped.query('SELECT 1 FROM riders');
  const conn = await scoped.getConnection();
  await conn.execute('SELECT 1 FROM stores');
  assert.ok(log.every((q) => /branch_id = 2/.test(q) || !/^SELECT/.test(q)), log.join(' | '));
  assert.equal(unscoped(scoped), db);
  assert.equal(unscoped(db), db);
});

test('ledger sync never runs through the branch filter, or it would reverse other branches', async () => {
  const { db, log } = fakeDb((q) => {
    if (/GET_LOCK/.test(q)) return [[{ ok: 1 }]];
    return undefined;
  });
  await ledger.syncLedger(scopedDb(db, 2), { dryRun: true });
  assert.ok(log.some((q) => /FROM orders o/.test(q)));
  assert.ok(!log.some((q) => /branch_id = 2/.test(q)), 'no filtered query reached the database');
});

// ---------------------------------------------------------------- the branch of a new document

function partyDb(rows) {
  return fakeDb((q, p) => {
    if (/FROM branches/.test(q)) return open2;
    const hit = q.match(/SELECT branch_id FROM (\w+) WHERE id = \?/);
    if (hit) return [rows[`${hit[1]}:${p[0]}`] === undefined ? [] : [{ branch_id: rows[`${hit[1]}:${p[0]}`] }]];
    return undefined;
  }).db;
}

test('document branch: comes from the rider, store, customer or order, not from the client', async () => {
  const db = partyDb({ 'riders:7': 2, 'stores:3': 1, 'users:9': 2, 'orders:4': 2 });
  assert.deepEqual(await documentBranch(db, head, undefined, { rider: 7 }), { branchId: 2 });
  assert.deepEqual(await documentBranch(db, head, undefined, { customer: 9 }), { branchId: 2 });
  assert.equal((await documentBranch(db, head, 1, { rider: 7 })).status, 400, 'naming another branch is refused');
  assert.equal((await documentBranch(db, mzg, undefined, { store: 3 })).status, 403, 'a branch account cannot touch another branch');
  assert.deepEqual(await documentBranch(db, mzg, undefined, { rider: 7 }), { branchId: 2 });
});

test('document branch: mixing branches is refused', async () => {
  const db = partyDb({ 'riders:7': 2, 'stores:3': 1 });
  const r = await documentBranch(db, head, undefined, { rider: 7, store: 3 });
  assert.match(r.error, /more than one branch/);
});

test('document branch: with nothing to go on, a branch account uses its own and head office must choose', async () => {
  const db = partyDb({});
  assert.deepEqual(await documentBranch(db, mzg, undefined, {}), { branchId: 2 });
  assert.equal((await documentBranch(db, mzg, 1, {})).status, 403);
  assert.match((await documentBranch(db, head, undefined, {})).error, /choose a branch/);
  assert.deepEqual(await documentBranch(db, head, 2, {}), { branchId: 2 });
  assert.match((await documentBranch(db, head, 99, {})).error, /Unknown/);
});

test('document branch: while one branch is open head office is not asked, as today', async () => {
  const { db } = fakeDb((q) => (/FROM branches/.test(q) ? [[{ id: 1, is_active: 1 }, { id: 2, is_active: 0 }]] : undefined));
  assert.deepEqual(await documentBranch(db, head, undefined, {}), { branchId: 1 });
});

test('journal voucher: all lines must be in one branch', async () => {
  const db = partyDb({ 'riders:7': 2, 'stores:3': 1, 'stores:4': 2 });
  const mixed = [{ entity_type: 'rider', entity_id: 7 }, { entity_type: 'store', entity_id: 3 }];
  assert.match((await journalVoucherBranch(db, head, undefined, mixed)).error, /more than one branch/);
  const same = [{ entity_type: 'rider', entity_id: 7 }, { entity_type: 'store', entity_id: 4 }];
  assert.deepEqual(await journalVoucherBranch(db, head, undefined, same), { branchId: 2 });
  assert.equal((await journalVoucherBranch(db, mzg, undefined, [{ entity_type: 'store', entity_id: 3 }])).status, 403);
});

test('ledger entries follow their party', async () => {
  const db = partyDb({ 'riders:7': 2, 'orders:4': 2 });
  assert.equal(await financialEntryBranch(db, { branch_id: 2, related_entity_type: 'rider', related_entity_id: 99 }), 2);
  assert.equal(await financialEntryBranch(db, { related_entity_type: 'rider', related_entity_id: 7 }), 2);
  assert.equal(await financialEntryBranch(db, { related_entity_type: 'order', related_entity_id: 4 }), 2);
  assert.equal(await financialEntryBranch(db, { reference_type: 'order', reference_id: 4 }), 2);
});

// ---------------------------------------------------------------- the routes

const financial = () => require('../routes/financial');
const branchUser = { id: 31, user_type: 'admin', email: 'b@example.com' };
const headUser = { id: 32, user_type: 'admin', email: 'h@example.com' };

function moneyDb(branchId, extra) {
  return fakeDb((q, p) => activeAccount(q, 'admin', branchId) || (/FROM branches/.test(q) ? open2 : extra ? extra(q, p) : undefined));
}

test('financial: a branch account reads through the filter; head office reads everything', async () => {
  const branch = moneyDb(2);
  await request(financial(), '/api/financial', branch.db, { path: '/api/financial/expenses', user: branchUser });
  assert.ok(branch.log.some((q) => /admin_expenses WHERE branch_id = 2/.test(q)), branch.log.join('\n'));
  const all = moneyDb(null);
  await request(financial(), '/api/financial', all.db, { path: '/api/financial/expenses', user: headUser });
  assert.ok(!all.log.some((q) => /WHERE branch_id = /.test(q)));
  const one = moneyDb(null);
  await request(financial(), '/api/financial', one.db, { path: '/api/financial/expenses?branch_id=2', user: { ...headUser, id: 33 } });
  assert.ok(one.log.some((q) => /admin_expenses WHERE branch_id = 2/.test(q)));
});

test("financial: a branch account cannot ask for another branch's money", async () => {
  const { db } = moneyDb(2);
  const r = await request(financial(), '/api/financial', db, { path: '/api/financial/expenses?branch_id=1', user: branchUser });
  assert.equal(r.status, 403);
  const gen = await request(financial(), '/api/financial', db, { method: 'POST', path: '/api/financial/reports/generate', user: branchUser, body: { report_type: 'daily_summary', branch_id: 1 } });
  assert.equal(gen.status, 403);
});

test("financial: another branch's document looks like it does not exist, and is not changed", async () => {
  const { db, log } = moneyDb(2, (q) => (/SELECT \* FROM admin_expenses WHERE id = \?/.test(q) ? [[{ id: 5, branch_id: 1 }]] : undefined));
  const r = await request(financial(), '/api/financial', db, { method: 'PUT', path: '/api/financial/expenses/5', user: branchUser, body: { status: 'approved' } });
  assert.equal(r.status, 404);
  assert.ok(!log.some((q) => /^UPDATE/.test(q)));
});

test('financial: a voucher cannot be repointed at a rider of another branch', async () => {
  const { db, log } = moneyDb(2, (q, p) => {
    if (/SELECT \* FROM cash_payment_vouchers WHERE id = \?/.test(q)) return [[{ id: 5, branch_id: 2, payee_type: 'rider', payee_id: 7 }]];
    if (/SELECT branch_id FROM riders WHERE id = \?/.test(q)) return [[{ branch_id: p[0] === 8 ? 1 : 2 }]];
    return undefined;
  });
  const r = await request(financial(), '/api/financial', db, { method: 'PUT', path: '/api/financial/payment-vouchers/5', user: branchUser, body: { payee_id: 8 } });
  assert.equal(r.status, 403);
  assert.ok(!log.some((q) => /^UPDATE cash_payment_vouchers/.test(q)));
});

test('financial: a new expense takes the branch account branch; a client branch cannot move it', async () => {
  let params;
  const { db } = moneyDb(2, (q, p) => { if (/^INSERT INTO admin_expenses/.test(q)) { params = p; return [{ insertId: 1 }]; } return undefined; });
  const body = { category: 'Rent', amount: 100, payment_method: 'cash' };
  const r = await request(financial(), '/api/financial', db, { method: 'POST', path: '/api/financial/expenses', user: branchUser, body });
  assert.equal(r.status, 201);
  assert.equal(params[params.length - 1], 2);
  const moved = await request(financial(), '/api/financial', db, { method: 'POST', path: '/api/financial/expenses', user: branchUser, body: { ...body, branch_id: 1 } });
  assert.equal(moved.status, 403);
});

test('financial: head office must choose a branch for an expense once two branches are open', async () => {
  const { db } = moneyDb(null);
  const r = await request(financial(), '/api/financial', db, { method: 'POST', path: '/api/financial/expenses', user: { ...headUser, id: 34 }, body: { category: 'Rent', amount: 100, payment_method: 'cash' } });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /choose a branch/);
});

test('guard: finance and report reads are open to branch accounts; dangerous tools are not', () => {
  for (const [m, p] of [['GET', '/api/financial/dashboard'], ['PUT', '/api/financial/expenses/5'], ['GET', '/api/financial/gl/trial-balance'],
    ['GET', '/api/admin/daily-sales-summary'], ['GET', '/api/admin/recent-activity'], ['GET', '/api/admin/inventory-report'],
    ['GET', '/api/admin/customer-details-sales-report/customers'], ['GET', '/api/admin/payments'], ['GET', '/api/admin/wallets/5'], ['GET', '/api/riders/fuel-history']]) {
    assert.equal(classify(m, p).allow, true, `${m} ${p}`);
  }
  for (const [m, p] of [['POST', '/api/financial/gl/sync'], ['POST', '/api/financial/banks'], ['POST', '/api/admin/execute-sql'], ['POST', '/api/admin/restore-db'],
    ['POST', '/api/admin/migrate/items'], ['POST', '/api/admin/wallets/5/adjust'], ['GET', '/api/admin/diagnostics'], ['GET', '/api/admin/clearable-tables']]) {
    assert.equal(classify(m, p).deny, true, `${m} ${p}`);
  }
});
