// Reset New: only the two owners, the order ends up unpaid, the rider's cash is undone once,
// and the next delivery is collected again.
const test = require('node:test');
const assert = require('node:assert');
const { fakeDb, activeAccount, request } = require('./helpers');
const { clearAccountStatusCache } = require('../middleware/auth');
const orders = require('../routes/orders');

test.beforeEach(() => clearAccountStatusCache());

const owner = { id: 1, user_type: 'admin', email: 'admin@servenow.com' };
const secondOwner = { id: 558, user_type: 'admin', email: 'Nazir@ServeNow.pk' };
const otherAdmin = { id: 555, user_type: 'admin', email: 'admin@google.com' };
const PAID_NEW = { id: 7091, order_number: 'Ord1', user_id: 5, rider_id: null, status: 'pending', branch_id: 1, payment_status: 'paid', payment_method: 'cash', total_amount: '1100.00' };
const CREDIT = { id: 10595, wallet_id: 311, type: 'credit', amount: '1100.00', reference_type: 'order', description: 'Cash collection', rider_id: 3 };

function dbFor(user, order, { entries = [CREDIT], handIns = [] } = {}) {
  return fakeDb((q) => {
    const acct = activeAccount(q, user.user_type, null);
    if (acct) return acct;
    if (/GET_LOCK/.test(q)) return [[{ held: 1 }]];
    if (/FROM orders WHERE id = \?/.test(q) || /FROM orders o .*WHERE o\.id = \?/.test(q)) return [[order]];
    if (/FROM rider_cash_submission_orders/.test(q)) return [handIns];
    if (/FROM wallet_transactions wt/.test(q)) return [entries];
    if (/SELECT balance FROM wallets/.test(q)) return [[{ balance: 0 }]];
    return undefined;
  });
}
const reset = (db, user, id = 7091) => request(orders, '/api/orders', db, { method: 'PUT', path: `/api/orders/${id}/reset-to-new`, user });

test('another admin cannot reset, even with no owner list configured', async () => {
  delete process.env.PRIVILEGED_ADMIN_EMAILS;
  const { db, log } = dbFor(otherAdmin, PAID_NEW);
  const res = await reset(db, otherAdmin);
  assert.equal(res.status, 403);
  assert.ok(!log.some((q) => /^UPDATE orders/.test(q)));
});

test('an owner reset of a paid order leaves it unpaid and takes the cash back from the rider', async () => {
  const { db, log } = dbFor(secondOwner, PAID_NEW);
  const res = await reset(db, secondOwner);
  assert.equal(res.status, 200);
  assert.equal(res.body.payment_status, 'pending');
  assert.equal(res.body.rider_cash_reversed, 1100);
  assert.ok(log.some((q) => /UPDATE orders SET status = 'pending', payment_status = 'pending', rider_id = NULL/.test(q)));
  assert.ok(log.some((q) => /UPDATE payments SET status = 'refunded'/.test(q)));
  assert.ok(log.some((q) => /UPDATE wallets SET balance = balance - \?/.test(q)));
  assert.ok(log.findIndex((q) => /UPDATE wallets/.test(q)) < log.findIndex((q) => /^UPDATE orders/.test(q)), 'money first');
});

test('a credit already reversed is not reversed again', async () => {
  const entries = [CREDIT, { id: 10600, wallet_id: 311, type: 'debit', amount: '1100.00', reference_type: 'order_cancel_reversal', description: 'Reversal [wt:10595]: x', rider_id: 3 }];
  const { db, log } = dbFor(owner, { ...PAID_NEW, status: 'delivered' }, { entries });
  const res = await reset(db, owner);
  assert.equal(res.status, 200);
  assert.equal(res.body.rider_cash_reversed, 0);
  assert.ok(!log.some((q) => /UPDATE wallets/.test(q)));
});

test('an order that is neither finished nor paid has nothing to reset', async () => {
  const { db } = dbFor(owner, { ...PAID_NEW, payment_status: 'pending' });
  assert.equal((await reset(db, owner)).status, 409);
});

test('money paid another way is not marked unpaid', async () => {
  const { db, log } = dbFor(owner, { ...PAID_NEW, payment_method: 'card', status: 'delivered' });
  const res = await reset(db, owner);
  assert.equal(res.status, 409);
  assert.match(res.body.message, /card/);
  assert.ok(!log.some((q) => /^UPDATE/.test(q)));
});

test('a hand-in waiting for approval blocks the reset; an approved one is reported', async () => {
  const waiting = dbFor(owner, PAID_NEW, { handIns: [{ movement_number: 'RCM-1', status: 'pending' }] });
  const refused = await reset(waiting.db, owner);
  assert.equal(refused.status, 409);
  assert.ok(!waiting.log.some((q) => /^UPDATE/.test(q)));

  const approved = dbFor(owner, PAID_NEW, { handIns: [{ movement_number: 'RCM-2', status: 'approved' }] });
  const done = await reset(approved.db, owner);
  assert.equal(done.status, 200);
  assert.equal(done.body.handed_in_on, 'RCM-2');
  assert.match(done.body.message, /RCM-2/);
});

test('the status route cannot reset around these rules', async () => {
  const delivered = { ...PAID_NEW, status: 'delivered' };
  const { db, log } = dbFor(otherAdmin, delivered);
  const res = await request(orders, '/api/orders', db, { method: 'PUT', path: '/api/orders/7091/status', user: otherAdmin, body: { status: 'pending' } });
  assert.equal(res.status, 403);
  assert.ok(!log.some((q) => /^UPDATE orders/.test(q)));
});

test('a paid order item change tells an owner to reset and tells others to cancel', async () => {
  const change = async (user) => {
    const { db } = dbFor(user, PAID_NEW);
    return request(orders, '/api/orders', db, { method: 'DELETE', path: '/api/orders/7091/items/5', user });
  };
  const forOwner = await change(owner);
  assert.equal(forOwner.status, 409);
  assert.match(forOwner.body.message, /Reset New/);
  assert.match((await change(otherAdmin)).body.message, /Cancel it/);
});
