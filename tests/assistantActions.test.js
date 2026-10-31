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
const { checkAssignment, assignRider } = require('../services/riderAssignment');

const accounts = {
  1: { id: 1, first_name: 'Head', last_name: 'Office', email: 'admin@example.com', user_type: 'admin', is_active: 1, branch_id: null },
  50: { id: 50, first_name: 'Hina', last_name: 'Raza', email: 'hina@example.com', user_type: 'standard_user', is_active: 1, branch_id: null },
  60: { id: 60, first_name: 'Bilal', last_name: 'Shah', email: 'bilal@example.com', user_type: 'standard_user', is_active: 1, branch_id: 2 },
};
const ORDER = {
  id: 11, branch_id: 1, order_number: 'ORD-11', status: 'ready', total_amount: '1250.00', delivery_fee: '150.00',
  rider_id: null, store_name: 'Fresh Mart', user_id: 42, payment_status: 'pending',
};
const RIDERS = [
  { id: 7, first_name: 'Ali', last_name: 'Khan', is_available: 1, active: 2, branch_id: 1 },
  { id: 8, first_name: 'Usman', last_name: 'Tariq', is_available: 1, active: 0, branch_id: 1 },
];

// A scripted database: accounts, one order, its riders; `rights` are the staff rights held by user 50/60.
function world({ riders = RIDERS, order = ORDER, rights = ['action_edit_order'] } = {}) {
  return fakeDb((q, params) => {
    if (/FROM users WHERE id = \?/.test(q)) return [[accounts[params[0]]].filter(Boolean)];
    if (/FROM user_permissions/.test(q)) return [params.slice(1).some((k) => rights.includes(k)) ? [{ 1: 1 }] : []];
    if (/FROM orders o LEFT JOIN stores s .* WHERE o.order_number = \?/.test(q)) return [params[0] === order.order_number ? [order] : []];
    if (/FROM riders r WHERE r.is_active = 1 AND r.branch_id <=> \?/.test(q)) return [riders];
    if (/FROM orders WHERE id = \?/.test(q)) return [params[0] === order.id ? [order] : []];
    if (/FROM riders WHERE id = \? AND is_active = true/.test(q)) return [riders.filter((r) => r.id === Number(params[0]))];
    if (/FROM order_items WHERE order_id = \?/.test(q)) return [[{ price: '550.00', quantity: 2 }]];
    return undefined;
  });
}

function fakeIo() {
  const emitted = [];
  return { emitted, to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) };
}

const sign = (raw) => `sha256=${crypto.createHmac('sha256', process.env.AIAGENT_TOOL_SECRET).update(raw).digest('hex')}`;
function callTool(database, body, io = null) {
  const raw = JSON.stringify({ sent_at: Math.floor(Date.now() / 1000), ...body });
  return request(router, '/', database, {
    method: 'POST', path: '/integrations/aiagent/tools', rawBody: raw,
    headers: { 'x-aiagent-signature': sign(raw) }, beforeRouter: () => {}, io,
  });
}
const identity = (id) => ai.mintIdentity(accounts[id]);
const updates = (log) => log.filter((q) => /^UPDATE orders SET rider_id/.test(q));

test('manifest: assign_rider is listed as an action that needs confirmation', async () => {
  const { db } = world();
  const r = await request(router, '/', db, { path: '/.well-known/aiagent.json' });
  const tool = r.body.tools.find((t) => t.name === 'assign_rider');
  assert.ok(tool, 'assign_rider is in the manifest');
  assert.ok(tool.inputSchema.properties.confirm_token);
  assert.deepEqual(tool.inputSchema.required, ['order_number', 'rider']);
  assert.match(tool.description, /confirm_token/);
});

test('assign by voice: a summary first, nothing changes until the person confirms, then it runs once', async () => {
  const { db, log } = world();
  const io = fakeIo();
  const args = { order_number: 'ORD-11', rider: 'Ali' };

  const first = await callTool(db, { tool: 'assign_rider', arguments: args, identity: identity(1) }, io);
  assert.equal(first.body.needs_confirmation, true);
  assert.match(first.body.summary, /Give order ORD-11 \(Fresh Mart, Rs 1,250/);
  assert.match(first.body.summary, /to Ali Khan\?/);
  assert.match(first.body.summary, /2 unfinished deliveries/);
  assert.equal(updates(log).length, 0, 'nothing assigned before the person confirmed');
  assert.equal(io.emitted.length, 0);

  const confirmed = await callTool(db, { tool: 'assign_rider', arguments: { ...args, confirm_token: first.body.confirm_token }, identity: identity(1) }, io);
  assert.equal(confirmed.body.assigned, true);
  assert.equal(confirmed.body.rider, 'Ali Khan');
  const done = updates(log);
  assert.equal(done.length, 1);
  assert.ok(io.emitted.some((e) => e.room === 'rider_7' && e.event === 'rider_notification'), 'the rider is told');
  assert.ok(io.emitted.some((e) => e.room === 'user_42' && e.event === 'user_notification'), 'the customer is told');
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(log.some((q) => /^INSERT INTO assistant_actions/.test(q)), 'the action is recorded');

  const again = await callTool(db, { tool: 'assign_rider', arguments: { ...args, confirm_token: first.body.confirm_token }, identity: identity(1) }, io);
  assert.equal(again.body.already_done, true);
  assert.equal(updates(log).length, 1, 'a second yes does not assign twice');
});

test('a confirmation for one rider cannot be used for another', async () => {
  const { db, log } = world();
  const first = await callTool(db, { tool: 'assign_rider', arguments: { order_number: 'ORD-11', rider: 'Ali' }, identity: identity(1) });
  const swapped = await callTool(db, { tool: 'assign_rider', arguments: { order_number: 'ORD-11', rider: 'Usman', confirm_token: first.body.confirm_token }, identity: identity(1) });
  assert.equal(swapped.body.error, 'confirm_again');
  assert.equal(updates(log).length, 0);
});

test('staff need the Edit orders right, the same as on the admin screen', async () => {
  const { db, log } = world({ rights: ['menu_orders'] });
  const r = await callTool(db, { tool: 'assign_rider', arguments: { order_number: 'ORD-11', rider: 'Ali' }, identity: identity(50) });
  assert.equal(r.body.error, 'not_permitted');
  assert.ok(!log.some((q) => /FROM orders/.test(q)), 'no order lookup without the right');
  const allowed = await callTool(world().db, { tool: 'assign_rider', arguments: { order_number: 'ORD-11', rider: 'Ali' }, identity: identity(50) });
  assert.equal(allowed.body.needs_confirmation, true);
});

test('customers, riders and visitors cannot assign', async () => {
  const customerDb = fakeDb((q) => (/FROM users WHERE id = \?/.test(q) ? [[{ id: 42, first_name: 'Sana', last_name: 'M', user_type: 'customer', is_active: 1 }]] : undefined));
  const asCustomer = await callTool(customerDb.db, { tool: 'assign_rider', arguments: { order_number: 'ORD-11', rider: 'Ali' }, identity: ai.mintIdentity({ id: 42, first_name: 'Sana', user_type: 'customer' }) });
  assert.equal(asCustomer.body.error, 'not_permitted');
  const visitor = await callTool(world().db, { tool: 'assign_rider', arguments: { order_number: 'ORD-11', rider: 'Ali' } });
  assert.equal(visitor.body.error, 'not_signed_in');
});

test("a branch account cannot reach another branch's order", async () => {
  const { db, log } = world();
  const r = await callTool(db, { tool: 'assign_rider', arguments: { order_number: 'ORD-11', rider: 'Ali' }, identity: identity(60) });
  assert.equal(r.body.error, 'not_found');
  assert.equal(r.body.confirm_token, undefined);
  assert.equal(updates(log).length, 0);
});

test('two riders with the name: the assistant is told to ask which one', async () => {
  const riders = [...RIDERS, { id: 9, first_name: 'Ali', last_name: 'Raza', is_available: 0, active: 1, branch_id: 1 }];
  const r = await callTool(world({ riders }).db, { tool: 'assign_rider', arguments: { order_number: 'ORD-11', rider: 'Ali' }, identity: identity(1) });
  assert.equal(r.body.error, 'which_rider');
  assert.deepEqual(r.body.riders.map((x) => x.name), ['Ali Khan', 'Ali Raza']);
  assert.equal(r.body.confirm_token, undefined);
  const exact = await callTool(world({ riders }).db, { tool: 'assign_rider', arguments: { order_number: 'ORD-11', rider: 'Ali Raza' }, identity: identity(1) });
  assert.equal(exact.body.needs_confirmation, true);
});

test('unknown rider: the available riders are offered', async () => {
  const r = await callTool(world().db, { tool: 'assign_rider', arguments: { order_number: 'ORD-11', rider: 'Zubair' }, identity: identity(1) });
  assert.equal(r.body.error, 'rider_not_found');
  assert.deepEqual(r.body.riders.map((x) => x.name), ['Ali Khan', 'Usman Tariq']);
});

test('a delivered order is refused before any confirmation', async () => {
  const r = await callTool(world({ order: { ...ORDER, status: 'delivered' } }).db, { tool: 'assign_rider', arguments: { order_number: 'ORD-11', rider: 'Ali' }, identity: identity(1) });
  assert.equal(r.body.error, 'refused');
  assert.match(r.body.message, /already delivered/);
});

// ---- the shared assignment rules (also used by PUT /api/orders/:id/assign-rider)

test('changing the rider compares against the current rider (it used to be read as empty, so it always failed)', async () => {
  const { db, log } = world({ order: { ...ORDER, rider_id: 8 } });
  const r = await assignRider(db, null, { orderId: 11, riderId: 7 });
  assert.equal(r.status, 200);
  const update = log.find((q) => /^UPDATE orders SET rider_id/.test(q));
  assert.ok(update);
  assert.ok(log.some((q) => /FROM wallet_transactions/.test(q)), 'the cash/wallet safeguard runs when the rider changes');
});

test('a rider cannot be changed once wallet or cash records exist', async () => {
  const { db } = fakeDb((q, params) => {
    if (/FROM orders WHERE id = \?/.test(q)) return [[{ ...ORDER, rider_id: 8 }]];
    if (/FROM wallet_transactions/.test(q)) return [[{ source: 'wallet_transaction', id: 1 }]];
    return world().db.execute(q, params);
  });
  const r = await checkAssignment(db, { orderId: 11, riderId: 7 });
  assert.equal(r.status, 409);
});

test("a paid order keeps its amount: its delivery fee cannot be changed", async () => {
  const paid = { ...ORDER, payment_status: 'paid' };
  const changed = await checkAssignment(world({ order: paid }).db, { orderId: 11, riderId: 7, deliveryFee: 300 });
  assert.equal(changed.status, 400);
  assert.match(changed.body.message, /already paid/);
  const same = await checkAssignment(world({ order: paid }).db, { orderId: 11, riderId: 7 });
  assert.equal(same.ok, true);
  assert.equal(same.newTotal, '1250.00', 'the paid total stays as it was');
});

test('a branch-limited check answers "not found" for another branch', async () => {
  const r = await checkAssignment(world().db, { orderId: 11, riderId: 7 }, { branchScope: 2 });
  assert.equal(r.status, 404);
});
