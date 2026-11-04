const test = require('node:test');
const assert = require('node:assert');
const ledger = require('../services/ledger');

// A small in-memory gl_accounts table behind the queries the ledger makes.
function accountsDb() {
  const table = new Map(ledger.SYSTEM_ACCOUNTS.map(([code, name, type]) => [code, { code, name, account_type: type, is_system: 1, is_active: 1, description: null }]));
  const used = new Set(['5100']);
  const query = async (sql, params = []) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    if (/^SELECT code, name, account_type, is_system, is_active FROM gl_accounts/.test(q)) return [[...table.values()].sort((a, b) => a.code.localeCompare(b.code))];
    if (/^SELECT code, name, account_type, is_system, is_active, description FROM gl_accounts WHERE code = \?/.test(q)) return [table.has(params[0]) ? [{ ...table.get(params[0]) }] : []];
    if (/^INSERT INTO gl_accounts \(code, name, account_type, is_system, is_active, description\)/.test(q)) { table.set(params[0], { code: params[0], name: params[1], account_type: params[2], is_system: 0, is_active: 1, description: params[3] }); return [{}]; }
    if (/^UPDATE gl_accounts SET name/.test(q)) { Object.assign(table.get(params[4]), { name: params[0], account_type: params[1], is_active: params[2], description: params[3] }); return [{}]; }
    if (/^SELECT COUNT\(\*\) AS n FROM gl_lines WHERE account_code = \?/.test(q)) return [[{ n: used.has(params[0]) ? 3 : 0 }]];
    return [[]];
  };
  return { query, execute: query };
}

test('an added account must follow the code rule and be new', async () => {
  const db = accountsDb();
  await ledger.loadAccounts(db);
  assert.match((await ledger.createAccount(db, { code: '4650', name: 'Generator fuel', type: 'expense' })).error, /starts with 5/);
  assert.match((await ledger.createAccount(db, { code: '5100', name: 'Anything', type: 'expense' })).error, /already/);
  assert.match((await ledger.createAccount(db, { code: '5650', name: 'rent', type: 'expense' })).error, /already exists/);
  assert.match((await ledger.createAccount(db, { code: '56', name: 'Short', type: 'expense' })).error, /4 digits/);
});

test('a new expense account appears on vouchers until it is switched off', async () => {
  const db = accountsDb();
  await ledger.loadAccounts(db);
  const made = await ledger.createAccount(db, { code: '5650', name: 'Generator fuel', type: 'expense' });
  assert.equal(made.account.code, '5650');
  assert.ok(ledger.voucherAccountList().some((a) => a.code === '5650' && a.expense && a.payment));
  assert.ok(ledger.isJournalAccount('5650'));
  await ledger.updateAccount(db, '5650', { is_active: false });
  assert.ok(!ledger.voucherAccountList().some((a) => a.code === '5650'), 'off accounts are not offered');
  assert.ok(!ledger.isJournalAccount('5650'), 'or accepted on a new journal');
  assert.equal(ledger.ACCOUNT_NAMES['5650'], 'Generator fuel', 'history keeps its name');
});

test('system accounts can be renamed but keep their type and stay on; used accounts keep their type', async () => {
  const db = accountsDb();
  await ledger.loadAccounts(db);
  assert.match((await ledger.updateAccount(db, '5200', { type: 'asset' })).error, /system account/);
  assert.match((await ledger.updateAccount(db, '5200', { is_active: false })).error, /always on/);
  const renamed = await ledger.updateAccount(db, '5200', { name: 'Office rent' });
  assert.equal(renamed.account.name, 'Office rent');
  assert.equal(ledger.ACCOUNT_NAMES['5200'], 'Office rent');
  await ledger.createAccount(db, { code: '5700', name: 'Training', type: 'expense' });
  assert.equal((await ledger.updateAccount(db, '5700', { type: 'expense', name: 'Staff training' })).account.name, 'Staff training');
});
