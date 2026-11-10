const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { fakeDb, activeAccount, request } = require('./helpers');
const { clearAccountStatusCache } = require('../middleware/auth');
const { RIGHTS, SPLITS, isRight } = require('../utils/rightsCatalog');
const { applyRightSplits } = require('../utils/rightsMigration');

test.beforeEach(() => clearAccountStatusCache());

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const LEGACY = new Set(['menu_reports', 'menu_settings', 'menu_financial']); // old keys some groups may still hold

// ---------------------------------------------------------------- every menu has a right

test('every sidebar menu and sub-menu is covered by a right in the catalog', () => {
  const html = read('admin.html');
  const js = read('js/admin.js');
  const sidebar = html.slice(html.indexOf('id="navMenu"'), html.indexOf('sidebar-theme-item'));
  const tabs = new Set([...sidebar.matchAll(/data-tab="([^"]+)"/g)].map((m) => m[1]));
  const rules = js.slice(js.indexOf('const SALE_REPORT_RIGHT_KEYS'), js.indexOf('// Hide everything first'));
  const ruled = new Set([...rules.matchAll(/tabs: \[([^\]]+)\]/g)].flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])));
  for (const tab of tabs) {
    if (tab === 'user-rights') continue; // owner account only
    assert.ok(ruled.has(tab), `menu ${tab} has no right`);
  }
  for (const key of [...rules.matchAll(/'((?:menu|report|sale_report|action|approve)_[a-z_]+)'/g)].map((m) => m[1])) {
    assert.ok(isRight(key) || LEGACY.has(key), `sidebar rule uses unknown right ${key}`);
  }
  const subRights = [...html.matchAll(/data-right="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/));
  assert.ok(subRights.length >= 22);
  for (const key of subRights) assert.ok(isRight(key), `data-right ${key} is not in the catalog`);
  // each Sale Reports and Store Status sub-menu has its own right
  const subLinks = [...sidebar.matchAll(/data-(?:subreport|status-section)="([^"]+)"[^>]*?data-right="([^"]+)"/g)];
  assert.equal(subLinks.length, 14);
  assert.equal(new Set(subLinks.map((m) => m[2])).size, 14);
});

test('rights are grouped like the sidebar and splits only add known rights', () => {
  const modules = [...new Set(RIGHTS.map((r) => r.module))];
  assert.deepEqual(modules.slice(0, 6), ['Dashboard', 'Accounts', 'Stores', 'Products', 'Orders', 'Payments & Wallets']);
  for (const split of SPLITS) for (const key of split.add) assert.ok(isRight(key), key);
});

// ---------------------------------------------------------------- one-time grants

test('right splits: holders of the old right get the new ones, once', async () => {
  const done = new Set();
  const inserts = [];
  const { db } = fakeDb((q, p) => {
    if (/SELECT id FROM rights_migrations/.test(q)) return [[...done].map((id) => ({ id }))];
    if (/INSERT INTO rights_migrations/.test(q)) { done.add(p[0]); return [{ affectedRows: 1 }]; }
    if (/INSERT IGNORE INTO/.test(q)) { inserts.push({ q, p }); return [{ affectedRows: 2 }]; }
    return undefined;
  });
  const splits = [{ id: 't1', from: ['menu_hr'], add: ['menu_hr_attendance'] }];
  const first = await applyRightSplits(db, splits);
  assert.deepEqual(first, [{ id: 't1', groups: 2, users: 2 }]);
  assert.equal(inserts.length, 2);
  assert.ok(inserts.some((i) => /permission_group_permissions/.test(i.q)) && inserts.some((i) => /user_permissions/.test(i.q)));
  assert.deepEqual(inserts[0].p, ['menu_hr_attendance', 'menu_hr']);
  assert.deepEqual(await applyRightSplits(db, splits), []);
  assert.equal(inserts.length, 2, 'not applied twice');
});

// ---------------------------------------------------------------- the server checks each sub-menu

const staff = { id: 7, user_type: 'standard_user', email: 's@x.pk' };
function staffDb(held, extra = () => undefined) {
  return fakeDb((q, p) => {
    const a = activeAccount(q, 'standard_user');
    if (a) return a;
    if (/FROM user_permissions WHERE user_id = \? AND permission_key/.test(q)) {
      return [p.slice(1).some((k) => held.includes(k)) ? [{ 1: 1 }] : []];
    }
    return extra(q, p);
  }).db;
}

test('Store Status sub-menus: staff need that sub-menu right', async () => {
  const stores = require('../routes/stores');
  const put = (held) => request(stores, '/api/stores', staffDb(held), { method: 'PUT', path: '/api/stores/customer-flash-message', user: staff, body: {} });
  assert.equal((await put(['menu_store_status', 'menu_promotions'])).status, 403);
  assert.notEqual((await put(['menu_flash_message'])).status, 403);
  const push = (held) => request(stores, '/api/stores', staffDb(held), { method: 'POST', path: '/api/stores/customer-push-notification', user: staff, body: {} });
  assert.equal((await push(['menu_flash_message'])).status, 403);
  assert.notEqual((await push(['menu_push_broadcast'])).status, 403);
});

test('Sale Reports: each sub-report needs its own right', async () => {
  const admin = require('../routes/admin');
  const get = (held) => request(admin, '/api/admin', staffDb(held), { path: '/api/admin/order-wise-sales-report', user: staff });
  assert.equal((await get(['sale_report_store'])).status, 403);
  assert.equal((await get(['report_sales'])).status, 403);
  assert.notEqual((await get(['sale_report_order_wise'])).status, 403);
});

test('HR: Attendance and Employees are separate rights', async () => {
  const hr = require('../routes/hr');
  const get = (held, url) => request(hr, '/api/hr', staffDb(held), { path: url, user: staff });
  assert.equal((await get(['menu_hr'], '/api/hr/attendance')).status, 403);
  assert.notEqual((await get(['menu_hr_attendance'], '/api/hr/attendance')).status, 403);
  assert.equal((await get(['menu_hr_attendance'], '/api/hr/employees')).status, 403);
});

test('kiosk: a new direct link replaces the key, which is stored hashed', async () => {
  const hr = require('../routes/hr');
  let saved = null;
  const db = staffDb(['menu_hr_attendance'], (q, p) => {
    if (/UPDATE kiosk_devices SET key_hash/.test(q)) { saved = p; return [{ affectedRows: 1 }]; }
    return undefined;
  });
  const { status, body } = await request(hr, '/api/hr', db, { method: 'POST', path: '/api/hr/kiosk/devices/4/link', user: staff, body: {} });
  assert.equal(status, 200);
  assert.match(body.key, /^[a-f0-9]{64}$/);
  assert.equal(saved[0], crypto.createHash('sha256').update(body.key).digest('hex'));
  assert.ok(!saved.includes(body.key));

  clearAccountStatusCache();
  const denied = staffDb(['menu_hr']);
  assert.equal((await request(hr, '/api/hr', denied, { method: 'POST', path: '/api/hr/kiosk/devices/4/link', user: staff, body: {} })).status, 403);
});

test('kiosk page reads a key from the link and takes it out of the address bar', () => {
  const js = read('js/kiosk.js');
  assert.match(js, /window\.location\.hash/);
  assert.match(js, /history\.replaceState/);
  assert.match(read('server.js'), /app\.get\("\/kiosk"/);
});
