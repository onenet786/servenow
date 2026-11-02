const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { fakeDb, activeAccount, request } = require('./helpers');
const { clearAccountStatusCache } = require('../middleware/auth');
const hr = require('../routes/hr');

test.beforeEach(() => clearAccountStatusCache());
test.after(() => { try { fs.rmSync(path.join(__dirname, '..', 'private_uploads', 'attendance'), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch (_) { /* another test file is using it */ } });

const KEY = 'a'.repeat(64);
const HASH = crypto.createHash('sha256').update(KEY).digest('hex');
const jpeg = () => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4000, 7)]).toString('base64')}`;
const person = { id: 9, branch_id: 1, name: 'Sana', is_active: 1 };

function kioskDb({ list = [], employee = person, open = null } = {}) {
  return fakeDb((q, p) => {
    if (/FROM kiosk_devices k LEFT JOIN branches/.test(q)) return p[0] === HASH ? [[{ id: 1, branch_id: 1, branch_name: 'Kot Addu' }]] : [[]];
    if (/UPDATE kiosk_devices/.test(q)) return [{ affectedRows: 1 }];
    if (/FROM employees e\s+LEFT JOIN attendance/.test(q)) return [list];
    if (/SELECT \* FROM employees WHERE id = \? AND branch_id = \?/.test(q)) return [p[1] === 1 && employee ? [employee] : []];
    if (/check_out_at IS NULL\s+AND check_in_at >= NOW/.test(q)) return [open ? [open] : []];
    if (/SELECT \* FROM attendance WHERE employee_id/.test(q)) return [[]];
    if (/TIMESTAMPDIFF/.test(q)) return [[{ seconds: 3600 }]];
    if (/^\s*(UPDATE|INSERT)/.test(q)) return [{ affectedRows: 1, insertId: 1 }];
    return undefined;
  });
}

const screen = (database, url, { method = 'GET', body, key = KEY } = {}) => request(hr, '/api/hr', database, {
  method, path: `/api/hr/kiosk/screen${url}`, body, headers: key ? { 'x-kiosk-key': key } : {}, noUser: true,
});

test('kiosk: needs its key, and no login', async () => {
  assert.equal((await screen(kioskDb().db, '/employees', { key: null })).status, 401);
  assert.equal((await screen(kioskDb().db, '/employees', { key: 'wrong' })).status, 401);
  assert.equal((await screen(kioskDb().db, '/employees')).status, 200);
});

test('kiosk: the list shows who is in and nothing private', async () => {
  const now = new Date();
  const { db, log } = kioskDb({
    list: [
      { id: 1, name: 'Ali', designation: 'Helper', check_in_at: null, check_out_at: null },
      { id: 2, name: 'Bilal', designation: null, check_in_at: now, check_out_at: null },
      { id: 3, name: 'Sana', designation: null, check_in_at: now, check_out_at: now },
    ],
  });
  const { status, body } = await screen(db, '/employees');
  assert.equal(status, 200);
  assert.equal(body.branch, 'Kot Addu');
  assert.deepEqual(body.employees.map((e) => e.state), ['out', 'in', 'done']);
  assert.ok(!/salary|phone|photo|latitude/i.test(JSON.stringify(body)));
  assert.ok(log.some((q) => /e\.branch_id = \?/.test(q)), 'cut to its branch');
});

test('kiosk: a shift open from last night comes before today', async () => {
  const yesterday = new Date(Date.now() - 8 * 3600000);
  const { db } = kioskDb({ list: [{ id: 2, name: 'Bilal', check_in_at: yesterday, check_out_at: null }, { id: 2, name: 'Bilal', check_in_at: new Date(), check_out_at: new Date() }] });
  const { body } = await screen(db, '/employees');
  assert.equal(body.employees.length, 1);
  assert.equal(body.employees[0].state, 'in');
});

test('kiosk: tapping a name checks in with the photo and no location', async () => {
  const { db, log } = kioskDb();
  const { status, body } = await screen(db, '/mark', { method: 'POST', body: { employee_id: 9, photo: jpeg() } });
  assert.equal(status, 200);
  assert.equal(body.action, 'in');
  const insert = log.find((q) => /INSERT INTO attendance/.test(q));
  assert.ok(insert);
});

test('kiosk: leaving needs a reason, and bad reasons do not count', async () => {
  for (const reason of [undefined, 'holiday']) {
    const { status } = await screen(kioskDb({ open: { id: 5, check_in_at: new Date() } }).db, '/mark', { method: 'POST', body: { employee_id: 9, photo: jpeg(), reason } });
    assert.equal(status, 400, String(reason));
  }
});

test('kiosk: leaving with a reason checks out', async () => {
  const { status, body } = await screen(kioskDb({ open: { id: 5, check_in_at: new Date() } }).db, '/mark', { method: 'POST', body: { employee_id: 9, photo: jpeg(), reason: 'lunch' } });
  assert.equal(status, 200);
  assert.equal(body.action, 'out');
  assert.equal(body.reason, 'lunch');
});

test('kiosk: someone out shows where they went, someone gone home shows finished', async () => {
  const now = new Date();
  const { db } = kioskDb({ list: [
    { id: 1, name: 'Ali', check_in_at: now, check_out_at: now, check_out_reason: 'bank' },
    { id: 2, name: 'Bilal', check_in_at: now, check_out_at: now, check_out_reason: 'home' },
  ] });
  const { body } = await screen(db, '/employees');
  assert.equal(body.employees[0].state, 'away');
  assert.equal(body.employees[0].reason, 'Bank Work');
  assert.equal(body.employees[1].state, 'done');
  assert.ok(body.reasons.some((r) => r.key === 'home'));
});

test('kiosk: a photo is required', async () => {
  assert.equal((await screen(kioskDb().db, '/mark', { method: 'POST', body: { employee_id: 9 } })).status, 400);
});

test('kiosk: it cannot mark someone from another branch', async () => {
  assert.equal((await screen(kioskDb({ employee: null }).db, '/mark', { method: 'POST', body: { employee_id: 999, photo: jpeg() } })).status, 404);
});

test('kiosk: its key opens nothing else', async () => {
  for (const url of ['/api/hr/employees', '/api/hr/payroll', '/api/hr/attendance']) {
    const { status } = await request(hr, '/api/hr', kioskDb().db, { path: url, headers: { 'x-kiosk-key': KEY }, noUser: true });
    assert.equal(status, 401, url);
  }
});

test('kiosk: only HR can set one up, and the key is stored hashed', async () => {
  const staff = { id: 3, user_type: 'standard_user', email: 's@x.pk' };
  const denied = fakeDb((q) => activeAccount(q, 'standard_user') || (/user_permissions/.test(q) ? [[]] : undefined));
  assert.equal((await request(hr, '/api/hr', denied.db, { method: 'POST', path: '/api/hr/kiosk/devices', user: staff, body: { name: 'x' } })).status, 403);

  clearAccountStatusCache();
  let saved = null;
  const allowed = fakeDb((q, p) => {
    const a = activeAccount(q, 'admin');
    if (a) return a;
    if (/FROM branches/.test(q)) return [[{ id: 1, name: 'Kot Addu', is_active: 1 }]];
    if (/INSERT INTO kiosk_devices/.test(q)) {
      saved = p;
      return [{ insertId: 1, affectedRows: 1 }];
    }
    return undefined;
  });
  const { status, body } = await request(hr, '/api/hr', allowed.db, { method: 'POST', path: '/api/hr/kiosk/devices', user: { id: 1, user_type: 'admin', email: 'a@x.pk' }, body: { name: 'Reception', branch_id: 1 } });
  assert.equal(status, 201);
  assert.equal(body.key.length, 64);
  assert.ok(saved, 'a screen was saved');
  assert.ok(!saved.includes(body.key), 'the key itself is never stored');
  assert.ok(saved.includes(crypto.createHash('sha256').update(body.key).digest('hex')));
});
