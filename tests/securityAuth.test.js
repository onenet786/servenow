// Login and account attacks from the security review. Each must stay refused.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { fakeDb, activeAccount, request, tokenFor } = require('./helpers');
const { clearAccountStatusCache, getAccountStatus, requireOwner } = require('../middleware/auth');
const auth = require('../routes/auth');

test.beforeEach(() => clearAccountStatusCache());

const hash = (kind, value) => crypto.createHmac('sha256', process.env.JWT_SECRET).update(`${kind}:${value}`).digest('hex');
const post = (db, path, body) => request(auth, '/api/auth', db, { method: 'POST', path: `/api/auth/${path}`, body });

test('forgot-password answers the same whether or not the email exists', async () => {
  const none = fakeDb(() => undefined);
  const some = fakeDb((q) => (/^SELECT id FROM users WHERE email/.test(q) ? [[{ id: 5 }]] : undefined));
  const a = await post(none.db, 'forgot-password', { email: 'nobody@example.com' });
  const b = await post(some.db, 'forgot-password', { email: 'real@example.com' });
  assert.equal(a.status, 200);
  assert.deepEqual(a.body, b.body);
  assert.ok(!none.log.some((q) => /^UPDATE/.test(q)));
});

test('the reset code is stored only as a hash', async () => {
  let stored;
  const { db } = fakeDb((q, p) => {
    if (/^SELECT id FROM users WHERE email/.test(q)) return [[{ id: 5 }]];
    if (/^UPDATE users SET reset_password_token/.test(q)) { stored = p[0]; return [{ affectedRows: 1 }]; }
    return undefined;
  });
  await post(db, 'forgot-password', { email: 'real@example.com' });
  assert.match(stored, /^[a-f0-9]{64}$/);
});

test('a code from a backup is useless: verify looks up the hash of what is typed', async () => {
  let looked;
  const { db } = fakeDb((q, p) => {
    if (/FROM users WHERE email = \? AND reset_password_token/.test(q)) { looked = p[1]; return [[]]; }
    return undefined;
  });
  await post(db, 'verify-reset-otp', { email: 'a@example.com', otp: '123456' });
  assert.equal(looked, hash('otp', '123456'));
});

test('reset-password refuses the 6-digit code, numbers and anything but the full token', async () => {
  for (const token of ['123456', 0, 1, true, { a: 1 }, ['x'], 'f'.repeat(63), 'g'.repeat(64)]) {
    const { db, log } = fakeDb(() => undefined);
    const r = await post(db, 'reset-password', { token, password: 'longpassword1' });
    assert.equal(r.status, 400, JSON.stringify(token));
    assert.ok(!log.some((q) => /reset_password_token = \?/.test(q)), `no lookup for ${JSON.stringify(token)}`);
  }
});

test('reset-password: the token works once, an email that is sent must match, sessions end', async () => {
  const token = 'a'.repeat(64);
  const make = () => fakeDb((q, p) => {
    if (/^SELECT id, email FROM users WHERE reset_password_token/.test(q)) {
      return [p[0] === hash('reset', token) ? [{ id: 5, email: 'real@example.com' }] : []];
    }
    return undefined;
  });
  const wrong = make();
  assert.equal((await post(wrong.db, 'reset-password', { token, password: 'longpassword1', email: 'other@example.com' })).status, 400);
  assert.ok(!wrong.log.some((q) => /^UPDATE/.test(q)));

  // The app sends no email: safe, the token alone is 256 bits
  const ok = make();
  assert.equal((await post(ok.db, 'reset-password', { token, password: 'longpassword1' })).status, 200);
  assert.ok(ok.log.some((q) => /password_changed_at = NOW\(\)/.test(q)), 'old sessions end');
  assert.ok(ok.log.some((q) => /^UPDATE refresh_tokens SET revoked_at/.test(q)), 'refresh tokens revoked');
  assert.ok(ok.log.some((q) => /reset_password_token = NULL/.test(q)), 'single use');
});

test('five wrong codes from a stranger do not cancel the real person\'s code', async () => {
  let cancelled = false;
  const { db } = fakeDb((q) => {
    if (/reset_password_token = NULL/.test(q)) cancelled = true;
    return undefined;
  });
  let last;
  for (let i = 0; i < 6; i++) last = await post(db, 'verify-reset-otp', { email: 'victim@example.com', otp: '000000' });
  assert.equal(last.status, 429);
  assert.equal(cancelled, false);
});

test('a login older than the last password change is refused; newer and never-changed pass', async () => {
  const changed = 1800000000;
  const db = fakeDb((q) => (/FROM users WHERE id/.test(q)
    ? [[{ is_active: 1, user_type: 'customer', branch_id: 1, password_changed_ts: changed }]] : undefined)).db;
  const user = (iat) => ({ id: 5, user_type: 'customer', iat });
  assert.equal((await getAccountStatus(db, user(changed - 100))).ok, false);
  // The second call comes from the cache and must be judged by its own age
  assert.equal((await getAccountStatus(db, user(changed + 1))).ok, true);
  assert.equal((await getAccountStatus(db, user(changed - 1))).ok, false);
  clearAccountStatusCache();
  const never = fakeDb((q) => activeAccount(q, 'customer')).db;
  assert.equal((await getAccountStatus(never, user(1))).ok, true);
});

test('changing a password ends sessions; a rider row is treated as a rider', async () => {
  const { endSessions } = require('../middleware/auth');
  const a = fakeDb(() => undefined);
  await endSessions(a.db, 'rider', 7);
  assert.ok(a.log.some((q) => /^UPDATE riders SET password_changed_at/.test(q)));
  assert.ok(a.log.some((q) => /user_type = 'rider'/.test(q)));
  const b = fakeDb(() => undefined);
  await endSessions(b.db, 'user', 7);
  assert.ok(b.log.some((q) => /^UPDATE users SET password_changed_at/.test(q)));
  assert.ok(b.log.some((q) => /user_type <> 'rider'/.test(q)));
});

test('/profile: a rider never gets the users row with the same id', async () => {
  const { db, log } = fakeDb((q) => {
    const a = activeAccount(q, 'rider');
    if (a) return a;
    if (/FROM riders WHERE id = \? AND email = \?/.test(q)) return [[{ id: 7, first_name: 'Rider' }]];
    return undefined;
  });
  const r = await request(auth, '/api/auth', db, { path: '/api/auth/profile', user: { id: 7, user_type: 'rider', email: 'r@example.com' } });
  assert.equal(r.body.user.user_type, 'rider');
  assert.ok(!log.some((q) => /first_name.*FROM users/.test(q)));
});

test('backups: the owner check answers 404 to everyone else', async () => {
  const express = require('express');
  const router = express.Router();
  router.get('/x', requireOwner, (_q, res) => res.json({ reached: true }));
  const run = async (type, email) => {
    clearAccountStatusCache();
    const { db } = fakeDb((q) => {
      if (/SELECT email, user_type, is_active, branch_id FROM users/.test(q)) return [[{ email, user_type: type, is_active: 1, branch_id: null }]];
      return activeAccount(q, type);
    });
    return request(router, '/t', db, { path: '/t/x', user: { id: 2, user_type: type } });
  };
  assert.equal((await run('admin', 'admin@servenow.com')).body.reached, true);
  assert.equal((await run('admin', 'second@servenow.com')).status, 404);
  assert.equal((await run('standard_user', 's@servenow.com')).status, 404);
});

test('tokens stay verifiable', () => {
  assert.ok(jwt.verify(tokenFor({ id: 1 }), process.env.JWT_SECRET).iat > 0);
});
