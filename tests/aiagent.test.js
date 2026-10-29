const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { fakeDb, request, tokenFor } = require('./helpers');

process.env.AIAGENT_URL = 'https://agent.example.com';
process.env.AIAGENT_CHANNEL_KEY = 'chan_test_key';
process.env.AIAGENT_IDENTITY_SECRET = 'identity_secret_for_tests_0123456789';
process.env.AIAGENT_TOOL_SECRET = 'tool_secret_for_tests_0123456789';
const router = require('../routes/aiagent');
const ai = require('../services/aiagent');

const customer = { id: 42, first_name: 'Sana', last_name: 'Malik', email: 'sana@example.com', user_type: 'customer', is_active: 1 };
const rider = { id: 7, first_name: 'Ali', last_name: 'Khan', email: 'ali@example.com', is_active: 1 };

// Answers account lookups for the customer (user 42) and rider 7; `extra` handles the tool's own queries.
function db(extra = () => undefined, { customerActive = 1 } = {}) {
  return fakeDb((q, params) => {
    if (/FROM users WHERE id = \?/.test(q)) return params[0] === 42 ? [[{ ...customer, is_active: customerActive }]] : [[]];
    if (/FROM riders WHERE id = \?/.test(q)) return params[0] === 7 ? [[rider]] : [[]];
    return extra(q, params);
  });
}

const sign = (raw, secret = process.env.AIAGENT_TOOL_SECRET) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;

function callTool(database, body, { secret, signature } = {}) {
  const raw = JSON.stringify({ sent_at: Math.floor(Date.now() / 1000), ...body });
  return request(router, '/', database, {
    method: 'POST',
    path: '/integrations/aiagent/tools',
    rawBody: raw,
    headers: { 'x-aiagent-signature': signature ?? sign(raw, secret) },
    beforeRouter: () => {},
  });
}

const identityOf = (account) => ai.mintIdentity(account);

test('manifest lists every tool with a relative endpoint on this site', async () => {
  const { db: d } = db();
  const r = await request(router, '/', d, { path: '/.well-known/aiagent.json' });
  assert.equal(r.status, 200);
  assert.equal(r.body.aiagent, 1);
  assert.deepEqual(r.body.tools.map((t) => t.name), ai.TOOLS.map((t) => t.name));
  for (const t of r.body.tools) {
    assert.equal(t.url, '/integrations/aiagent/tools');
    assert.equal(t.who, undefined, 'internal permission list is not published');
  }
});

test('tool calls need a valid signature and a fresh sent_at', async () => {
  const { db: d } = db();
  assert.equal((await callTool(d, { tool: 'find_stores' }, { signature: 'sha256=00' })).status, 401);
  assert.equal((await callTool(d, { tool: 'find_stores' }, { secret: 'another_secret_0123456789abcdef' })).status, 401);
  const stale = await callTool(d, { tool: 'find_stores', sent_at: Math.floor(Date.now() / 1000) - 3600 });
  assert.equal(stale.status, 401);
  assert.equal(stale.body.error, 'stale_request');
});

test('a test call from the AIAgent dashboard succeeds without touching the database', async () => {
  const { db: d, log } = db();
  const r = await callTool(d, { tool: 'find_stores', test: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(log.length, 0);
});

test('the endpoint reports itself switched off when there is no tool secret', async () => {
  const saved = process.env.AIAGENT_TOOL_SECRET;
  const raw = JSON.stringify({ tool: 'find_stores', sent_at: Math.floor(Date.now() / 1000) });
  process.env.AIAGENT_TOOL_SECRET = '';
  try {
    const { db: d } = db();
    const r = await request(router, '/', d, {
      method: 'POST', path: '/integrations/aiagent/tools', rawBody: raw, headers: { 'x-aiagent-signature': sign(raw, saved) }, beforeRouter: () => {},
    });
    assert.equal(r.status, 503);
    assert.equal(r.body.error, 'disabled');
  } finally {
    process.env.AIAGENT_TOOL_SECRET = saved;
  }
});

test('visitors can look up stores; the search is passed as a parameter, not into the SQL', async () => {
  const { db: d, log } = db((q) => {
    if (/FROM stores s LEFT JOIN store_status_messages/.test(q)) {
      return [[{ name: 'Fresh Mart', location: 'DHA', opening_time: '00:00:00', closing_time: '23:59:00', is_closed: 0, status_message: '' }]];
    }
    return undefined;
  });
  const r = await callTool(d, { tool: 'find_stores', arguments: { search: "milk'; DROP TABLE stores; --" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.stores[0].name, 'Fresh Mart');
  assert.equal(r.body.stores[0].open_now, true);
  assert.ok(!log.some((q) => /DROP TABLE/.test(q)));
});

test('visitors cannot see orders or wallets', async () => {
  const { db: d, log } = db();
  for (const tool of ['my_orders', 'order_status', 'my_wallet', 'business_today']) {
    const r = await callTool(d, { tool, arguments: { order_number: 'ORD-1' } });
    assert.equal(r.body.error, 'not_signed_in', tool);
  }
  assert.ok(!log.some((q) => /FROM (orders|wallets)/.test(q)));
});

test('a customer sees their own order but gets "not found" for someone else\'s', async () => {
  const orders = {
    'ORD-MINE': { id: 1, order_number: 'ORD-MINE', user_id: 42, store_id: 3, rider_id: null, status: 'preparing', total_amount: '1250.00', delivery_fee: '150.00', payment_method: 'cash', payment_status: 'pending', store_name: 'Fresh Mart' },
    'ORD-THEIRS': { id: 2, order_number: 'ORD-THEIRS', user_id: 99, store_id: 3, rider_id: null, status: 'preparing', total_amount: '900.00', delivery_fee: '150.00', payment_method: 'cash', payment_status: 'pending', store_name: 'Fresh Mart' },
  };
  const { db: d } = db((q, params) => {
    if (/FROM orders o LEFT JOIN stores s ON s.id = o.store_id LEFT JOIN riders/.test(q)) return [[orders[params[0]]].filter(Boolean)];
    if (/FROM order_items oi/.test(q)) return [[{ name: 'Milk 1L', quantity: 2, price: '275.00' }]];
    return undefined;
  });
  const identity = identityOf(customer);
  const mine = await callTool(d, { tool: 'order_status', arguments: { order_number: 'ORD-MINE' }, identity });
  assert.equal(mine.body.status, 'preparing');
  assert.equal(mine.body.items[0].name, 'Milk 1L');
  assert.equal(mine.body.total.value, 1250);
  assert.equal(mine.body.rider, 'not assigned yet');

  const theirs = await callTool(d, { tool: 'order_status', arguments: { order_number: 'ORD-THEIRS' }, identity });
  assert.equal(theirs.body.error, 'not_found');
  assert.equal(theirs.body.items, undefined);
  const none = await callTool(d, { tool: 'order_status', arguments: { order_number: 'ORD-NOPE' }, identity });
  assert.equal(none.body.message.replace('ORD-NOPE', 'X'), theirs.body.message.replace('ORD-THEIRS', 'X'), 'same answer either way');
});

test('my_orders uses the verified account, never an id from the arguments', async () => {
  let asked;
  const { db: d } = db((q, params) => {
    if (/FROM orders o LEFT JOIN stores s ON s.id = o.store_id WHERE o.user_id = \?/.test(q)) { asked = params[0]; return [[]]; }
    return undefined;
  });
  await callTool(d, { tool: 'my_orders', arguments: { user_id: 99 }, identity: identityOf(customer) });
  assert.equal(asked, 42);
});

test('tools are limited by account type', async () => {
  const { db: d } = db();
  const asRider = await callTool(d, { tool: 'business_today', identity: identityOf({ ...rider, user_type: 'rider' }) });
  assert.equal(asRider.body.error, 'not_permitted');
  const asCustomer = await callTool(d, { tool: 'store_orders_today', identity: identityOf(customer) });
  assert.equal(asCustomer.body.error, 'not_permitted');
});

test('a forged, expired or switched-off identity counts as a visitor', async () => {
  const forged = jwt.sign({ sub: 'u42', role: 'customer' }, 'not_the_identity_secret_0123456789', { algorithm: 'HS256', expiresIn: 600 });
  const expired = jwt.sign({ sub: 'u42', role: 'customer', exp: Math.floor(Date.now() / 1000) - 10 }, process.env.AIAGENT_IDENTITY_SECRET);
  const promoted = jwt.sign({ sub: 'u42', role: 'admin' }, process.env.AIAGENT_IDENTITY_SECRET, { expiresIn: 600 });
  for (const identity of [forged, expired, promoted, 'not-a-token']) {
    const { db: d } = db();
    const r = await callTool(d, { tool: 'my_orders', identity });
    assert.equal(r.body.error, 'not_signed_in');
  }
  const { db: off } = db(undefined, { customerActive: 0 });
  const r = await callTool(off, { tool: 'my_orders', identity: identityOf(customer) });
  assert.equal(r.body.error, 'not_signed_in');
});

test('widget settings: an identity token only for a signed-in account', async () => {
  const { db: d } = db();
  const visitor = await request(router, '/', d, { path: '/api/aiagent/widget' });
  assert.equal(visitor.body.enabled, true);
  assert.equal(visitor.body.src, 'https://agent.example.com/api/widget.js');
  assert.equal(visitor.body.identity, undefined);

  const guest = await request(router, '/', d, { path: '/api/aiagent/widget', user: { id: 5, user_type: 'guest', is_guest: true } });
  assert.equal(guest.body.identity, undefined);

  const signedIn = await request(router, '/', d, { path: '/api/aiagent/widget', user: { id: 42, user_type: 'customer' } });
  const claims = jwt.verify(signedIn.body.identity, process.env.AIAGENT_IDENTITY_SECRET, { algorithms: ['HS256'] });
  assert.equal(claims.sub, 'u42');
  assert.equal(claims.role, 'customer');
  assert.ok(claims.exp - claims.iat <= 4 * 3600);
  assert.match(signedIn.body.scope, /^[A-Za-z0-9_-]{1,64}$/);

  const riderPage = await request(router, '/', d, { path: '/api/aiagent/widget', user: { id: 7, user_type: 'rider' } });
  assert.equal(jwt.decode(riderPage.body.identity).sub, 'r7');
  assert.notEqual(riderPage.body.scope, signedIn.body.scope);

  // A ServeNow token claiming a role the account no longer has gets no identity.
  const stale = await request(router, '/', d, { path: '/api/aiagent/widget', headers: { authorization: `Bearer ${tokenFor({ id: 42, user_type: 'admin' })}` } });
  assert.equal(stale.body.identity, undefined);
});

test('widget settings say "off" when AIAgent is not configured', async () => {
  const saved = process.env.AIAGENT_CHANNEL_KEY;
  process.env.AIAGENT_CHANNEL_KEY = '';
  try {
    const { db: d } = db();
    const r = await request(router, '/', d, { path: '/api/aiagent/widget' });
    assert.deepEqual(r.body, { enabled: false });
  } finally {
    process.env.AIAGENT_CHANNEL_KEY = saved;
  }
});
