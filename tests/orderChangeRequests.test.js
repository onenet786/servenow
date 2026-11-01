const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { fakeDb, request } = require('./helpers');

process.env.AIAGENT_URL = 'https://agent.example.com';
process.env.AIAGENT_CHANNEL_KEY = 'chan_test_key';
process.env.AIAGENT_IDENTITY_SECRET = 'identity_secret_for_tests_0123456789';
process.env.AIAGENT_TOOL_SECRET = 'tool_secret_for_tests_0123456789';
const router = require('../routes/aiagent');
const ai = require('../services/aiagent');

const CUSTOMER = { id: 42, first_name: 'Sana', last_name: 'Malik', email: 'sana@example.com', user_type: 'customer', is_active: 1, branch_id: 1 };
const ORDER = { id: 11, order_number: 'ORD-11', user_id: 42, status: 'preparing', branch_id: 1, special_instructions: 'Ring twice' };

function world({ order = ORDER, existing = 0 } = {}) {
  const writes = [];
  const { db, log } = fakeDb((q, params) => {
    if (/FROM users WHERE id = \?/.test(q)) return [[params[0] === 42 ? CUSTOMER : null].filter(Boolean)];
    if (/FROM orders o WHERE o.order_number = \?/.test(q)) return [[order].filter((o) => o && o.order_number === params[0])];
    if (/SELECT COUNT\(\*\) AS n FROM order_change_requests/.test(q)) return [[{ n: existing }]];
    if (/FROM order_items oi JOIN stores s/.test(q)) return [[{ owner_id: 9, name: 'Aghosh Hotel' }]];
    if (/^(INSERT INTO order_change_requests|UPDATE orders SET special_instructions)/.test(q)) writes.push({ q, params });
    return undefined;
  });
  return { db, log, writes };
}
function fakeIo() {
  const emitted = [];
  return { emitted, to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) };
}
const sign = (raw) => `sha256=${crypto.createHmac('sha256', process.env.AIAGENT_TOOL_SECRET).update(raw).digest('hex')}`;
function call(db, body, io = null) {
  const raw = JSON.stringify({ sent_at: Math.floor(Date.now() / 1000), ...body });
  return request(router, '/', db, { method: 'POST', path: '/integrations/aiagent/tools', rawBody: raw, headers: { 'x-aiagent-signature': sign(raw) }, beforeRouter: () => {}, io });
}
const identity = ai.mintIdentity(CUSTOMER);
const args = { order_number: 'ORD-11', change: 'Add 1 × Cold Drink (1.5 litre)' };

test('a change request is read back first, then sent once: saved, on the order note, and announced', async () => {
  const { db, writes } = world();
  const io = fakeIo();
  const first = await call(db, { tool: 'request_order_change', arguments: args, identity }, io);
  assert.equal(first.body.needs_confirmation, true);
  assert.match(first.body.summary, /Send this change for order ORD-11 .*"Add 1 × Cold Drink \(1\.5 litre\)"/);
  assert.equal(writes.length, 0, 'nothing saved before yes');

  const sent = await call(db, { tool: 'request_order_change', arguments: { ...args, confirm_token: first.body.confirm_token }, identity }, io);
  assert.equal(sent.body.sent, true);
  const saved = writes.find((w) => /^INSERT INTO order_change_requests/.test(w.q));
  assert.deepEqual(saved.params.slice(0, 4), [11, 1, 42, 'Add 1 × Cold Drink (1.5 litre)']);
  const note = writes.find((w) => /^UPDATE orders SET special_instructions/.test(w.q));
  assert.match(note.params[0], /^Ring twice \| \[Change request [^\]]+\] Add 1 × Cold Drink \(1\.5 litre\)$/, 'kept the old note, added the request');
  const toDispatch = io.emitted.find((e) => e.event === 'notification' && e.payload.type === 'order_change_request');
  assert.ok(toDispatch, 'dispatch told');
  assert.deepEqual([].concat(toDispatch.room), ['admins', 'admins_b1'], "head office and the order's branch");
  assert.ok(io.emitted.some((e) => e.event === 'store_owner_notification' && e.room === 'user_9'), 'store told');

  const again = await call(db, { tool: 'request_order_change', arguments: { ...args, confirm_token: first.body.confirm_token }, identity }, io);
  assert.equal(again.body.already_done, true);
  assert.equal(writes.filter((w) => /^INSERT/.test(w.q)).length, 1, 'a second yes does not send it twice');
});

test("another customer's order, or an unknown number, gets the same not-found answer", async () => {
  const { db } = world({ order: { ...ORDER, user_id: 99 } });
  const theirs = await call(db, { tool: 'request_order_change', arguments: args, identity });
  const none = await call(world().db, { tool: 'request_order_change', arguments: { ...args, order_number: 'ORD-404' }, identity });
  assert.equal(theirs.body.error, 'not_found');
  assert.equal(none.body.error, 'not_found');
});

test('once the rider has it, or it is delivered, a new order is offered instead', async () => {
  for (const status of ['out_for_delivery', 'picked_up', 'delivered', 'cancelled']) {
    const r = await call(world({ order: { ...ORDER, status } }).db, { tool: 'request_order_change', arguments: args, identity });
    assert.equal(r.body.error, 'too_late', status);
    assert.match(r.body.message, /place_order/);
  }
});

test('at most 5 requests per order', async () => {
  const r = await call(world({ existing: 5 }).db, { tool: 'request_order_change', arguments: args, identity });
  assert.equal(r.body.error, 'too_many');
});

test('visitors cannot send change requests', async () => {
  const r = await call(world().db, { tool: 'request_order_change', arguments: args });
  assert.equal(r.body.error, 'not_signed_in');
});
