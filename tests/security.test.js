const test = require('node:test');
const assert = require('node:assert');
const { fakeDb, activeAccount, request } = require('./helpers');
const { authenticateToken } = require('../middleware/auth');
const { detectImageExtension } = require('../middleware/upload');

function runAuth(user, db) {
  const jwt = require('jsonwebtoken');
  return new Promise((resolve) => {
    const req = { headers: { authorization: 'Bearer ' + jwt.sign(user, process.env.JWT_SECRET) }, db };
    const res = { status(c) { this.c = c; return this; }, json() { resolve(this.c); } };
    authenticateToken(req, res, () => resolve('next'));
  });
}
const rowsDb = (rows) => ({ execute: async () => [rows] });

test('auth: active account with matching role passes', async () => {
  assert.equal(await runAuth({ id: 101, user_type: 'customer' }, rowsDb([{ is_active: 1, user_type: 'customer' }])), 'next');
});

test('auth: token claiming a different role than the account is rejected', async () => {
  assert.equal(await runAuth({ id: 102, user_type: 'admin' }, rowsDb([{ is_active: 1, user_type: 'customer' }])), 401);
});

test('auth: deactivated user and deleted rider are rejected', async () => {
  assert.equal(await runAuth({ id: 103, user_type: 'customer' }, rowsDb([{ is_active: 0, user_type: 'customer' }])), 401);
  assert.equal(await runAuth({ id: 104, user_type: 'rider' }, rowsDb([])), 401);
});

test('uploads: only real image signatures are accepted', () => {
  assert.equal(detectImageExtension(Buffer.from('<html><script>alert(1)</script></html>')), null);
  assert.equal(detectImageExtension(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])), '.png');
  assert.equal(detectImageExtension(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), '.jpg');
  assert.equal(detectImageExtension(Buffer.from('RIFF\x00\x00\x00\x00WEBP', 'binary')), '.webp');
});

test('registration ignores a client-supplied role', async () => {
  const authRouter = require('../routes/auth');
  let insertedRole;
  const { db } = fakeDb((q, p) => {
    if (/^SELECT id FROM users WHERE email/.test(q)) return [[]];
    if (/^INSERT INTO users/.test(q)) { insertedRole = p[7]; return [{ insertId: 500 }]; }
    return undefined;
  });
  await request(authRouter, '/api/auth', db, {
    method: 'POST', path: '/api/auth/register',
    body: { firstName: 'Eve', lastName: 'Tester', email: 'eve@example.com', password: 'longpassword1', userType: 'admin' },
  });
  assert.equal(insertedRole, 'customer');
});

test('financial reports: guests, customers and colliding riders are denied', async () => {
  const fin = require('../routes/financial');
  let perms = [];
  const make = (type) => fakeDb((q) => activeAccount(q, type) || (/user_permissions/.test(q) ? [perms] : undefined)).db;

  assert.equal((await request(fin, '/api/financial', make('guest'), { path: '/api/financial/reports/platform-summary', user: { id: 1, user_type: 'guest', is_guest: true } })).status, 403);
  assert.equal((await request(fin, '/api/financial', make('customer'), { path: '/api/financial/reports/cash-flow', user: { id: 2, user_type: 'customer' } })).status, 403);
  perms = [{ 1: 1 }];
  assert.equal((await request(fin, '/api/financial', make('rider'), { path: '/api/financial/reports/rider/7', user: { id: 7, user_type: 'rider' } })).status, 403);
  assert.equal((await request(fin, '/api/financial', make('standard_user'), { method: 'DELETE', path: '/api/financial/reports/1', user: { id: 8, user_type: 'standard_user' } })).status, 403);
  assert.notEqual((await request(fin, '/api/financial', make('standard_user'), { path: '/api/financial/reports/platform-summary', user: { id: 8, user_type: 'standard_user' } })).status, 403);
});

test('wallet: riders cannot use customer wallet features (id collision)', async () => {
  const wallets = require('../routes/wallets');
  const { db } = fakeDb((q) => activeAccount(q, 'rider'));
  const res = await request(wallets, '/api/wallet', db, {
    method: 'POST', path: '/api/wallet/transfers/send', user: { id: 7, user_type: 'rider' }, body: { recipientId: 3, amount: 10 },
  });
  assert.equal(res.status, 403);
});
