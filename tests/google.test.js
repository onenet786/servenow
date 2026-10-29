const test = require('node:test');
const assert = require('node:assert');
const axios = require('axios');
const { fakeDb, request } = require('./helpers');
const auth = require('../routes/auth');

const SERVENOW_CLIENT = '123484088318-ek8r1kufci04k5mldr8tqsnnihqfnd4s.apps.googleusercontent.com';

// Google's tokeninfo endpoint is replaced by a canned answer for each test
function withTokenInfo(payload, fn) {
  const original = axios.get;
  axios.get = async (url, ...rest) => (String(url).includes('oauth2.googleapis.com/tokeninfo')
    ? { data: payload }
    : original(url, ...rest));
  return fn().finally(() => { axios.get = original; });
}

const googlePayload = (aud) => ({
  iss: 'https://accounts.google.com', aud, sub: '1234567890', email: 'ali@example.com',
  email_verified: 'true', given_name: 'Ali', family_name: 'Khan',
});

const existingCustomerDb = () => fakeDb((q) => {
  if (/FROM riders WHERE email/.test(q)) return [[]];
  if (/SELECT \* FROM users WHERE email/.test(q)) {
    return [[{ id: 42, email: 'ali@example.com', first_name: 'Ali', last_name: 'Khan', user_type: 'customer', is_active: 1, is_verified: 1 }]];
  }
  return undefined;
});

test('Google sign-in rejects a token issued to another app', async () => {
  const { db } = existingCustomerDb();
  const original = console.error;
  console.error = () => {};
  try {
    const r = await withTokenInfo(googlePayload('999-other-app.apps.googleusercontent.com'), () =>
      request(auth, '/api/auth', db, { method: 'POST', path: '/api/auth/google-mobile', body: { id_token: 'x' } }));
    assert.equal(r.status, 401);
    assert.ok(!r.body || !r.body.token, 'no session token may be issued');
  } finally {
    console.error = original;
  }
});

test('Google sign-in accepts a token issued to the ServeNow client', async () => {
  const { db } = existingCustomerDb();
  const r = await withTokenInfo(googlePayload(SERVENOW_CLIENT), () =>
    request(auth, '/api/auth', db, { method: 'POST', path: '/api/auth/google-mobile', body: { id_token: 'x' } }));
  assert.equal(r.status, 200);
  assert.ok(r.body && r.body.token, 'a session token is issued');
});
