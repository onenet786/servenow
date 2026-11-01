const test = require('node:test');
const assert = require('node:assert');
const { fakeDb } = require('./helpers');
const { grantSplitRights, GRANTS } = require('../utils/rightsUpgrade');

const quiet = { log() {}, error() {} };

function db({ done = false, tables = ['user_permissions', 'permission_group_permissions', 'rights_audit_log'] } = {}) {
  return fakeDb((q, params) => {
    if (/FROM schema_upgrades WHERE name = \?/.test(q)) return [done ? [{ 1: 1 }] : []];
    if (/FROM information_schema.TABLES/.test(q)) return [tables.includes(params[0]) ? [{ 1: 1 }] : []];
    if (/^INSERT IGNORE INTO user_permissions/.test(q)) return [{ affectedRows: params[0] === 'approve_cpv' ? 2 : 0 }];
    if (/^INSERT IGNORE INTO permission_group_permissions/.test(q)) return [{ affectedRows: params[0] === 'action_order_status' ? 1 : 0 }];
    return undefined;
  });
}

test('every new right maps only from older rights that already allowed it', () => {
  assert.deepEqual(GRANTS.action_order_cancel, ['action_edit_order']);
  assert.deepEqual(GRANTS.approve_bpv, ['menu_financial_bpv'], 'bank approval only from bank vouchers, never cash');
  assert.ok(!Object.values(GRANTS).flat().some((k) => k.startsWith('approve_')), 'an approval right is never the source');
});

test('the upgrade gives the new rights to holders of the matching old ones, in one transaction, and records it', async () => {
  const { db: d, log } = db();
  const r = await grantSplitRights(d, { log: quiet });
  assert.equal(r.applied, true);
  assert.equal(r.users, 2);
  assert.equal(r.groups, 1);
  const grants = log.filter((q) => /^INSERT IGNORE INTO user_permissions/.test(q));
  assert.equal(grants.length, Object.keys(GRANTS).length);
  assert.ok(grants.every((q) => /usr.user_type = 'standard_user'/.test(q)), 'only staff logins');
  assert.ok(log.indexOf('BEGIN') < log.findIndex((q) => /^INSERT INTO schema_upgrades/.test(q)));
  assert.ok(log.includes('COMMIT'));
  assert.ok(log.some((q) => /^INSERT INTO rights_audit_log/.test(q)), 'visible in the rights audit log');
});

test('it runs only once', async () => {
  const { db: d, log } = db({ done: true });
  assert.equal((await grantSplitRights(d, { log: quiet })).applied, false);
  assert.ok(!log.some((q) => /INSERT IGNORE/.test(q)));
});

test('a fresh database without rights tables is left alone and not marked done', async () => {
  const { db: d, log } = db({ tables: [] });
  assert.equal((await grantSplitRights(d, { log: quiet })).applied, false);
  assert.ok(!log.some((q) => /^INSERT INTO schema_upgrades/.test(q)));
});
