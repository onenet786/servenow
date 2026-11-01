const test = require('node:test');
const assert = require('node:assert');
const { fakeDb } = require('./helpers');
const { resolveOrder, placeOrderAction, callOrderHandler } = require('../services/assistantOrders');

const CUSTOMER = { id: 42, first_name: 'Sana', last_name: 'Malik', email: 'sana@example.com', user_type: 'customer', address: 'House 5, Canal Colony', is_active: 1, branch_id: 1 };
const STORE = { id: 3, name: 'Aghosh Hotel' };
const PRODUCTS = [
  { id: 10, name: 'Chicken Biryani', price: '450.00', size_id: null, unit_id: null, size_label: null, unit_name: null },
  { id: 11, name: 'Cold Drink', price: '120.00', size_id: 1, unit_id: null, size_label: '500ml', unit_name: null },
];
const SIZES = { 11: [{ size_id: 2, unit_id: null, price: '220.00', size_label: '1.5 litre', unit_name: null }] };

function shop({ customer = CUSTOMER } = {}) {
  return fakeDb((q, params) => {
    if (/FROM users WHERE id = \?/.test(q)) return [[customer].filter(Boolean)];
    if (/FROM products p\s+LEFT JOIN sizes sz ON sz.id = p.size_id/.test(q)) {
      const want = String(params[1]).replace(/%/g, '').toLowerCase();
      return [PRODUCTS.filter((p) => p.name.toLowerCase().includes(want))];
    }
    if (/FROM product_size_prices psp/.test(q)) return [SIZES[params[0]] || []];
    return undefined;
  });
}
const deps = {
  resolveStore: async (_db, name) => (name.toLowerCase().includes('aghosh') ? { store: STORE } : { reply: { error: 'store_not_found' } }),
  browseBranchIds: async () => [1],
  orderPage: (no) => `https://servenow.pk/order-confirmation.html?order_number=${no}`,
};
const user = { id: 42, type: 'customer', name: 'Sana Malik', branch_id: 1 };

test('resolve: products, sizes, quantities and the saved address become the exact order body', async () => {
  const r = await resolveOrder(shop().db, { store: 'Aghosh', items: [{ product: 'chicken biryani', quantity: 2 }, { product: 'cold drink', quantity: 1, size: '1.5' }] }, user, deps);
  assert.equal(r.reply, undefined);
  assert.deepEqual(r.body.items, [{ product_id: 10, quantity: 2 }, { product_id: 11, quantity: 1, size_id: 2 }]);
  assert.equal(r.body.delivery_address, 'House 5, Canal Colony', 'saved address by default');
  assert.equal(r.body.payment_method, 'cash', 'cash on delivery by default');
  assert.equal(r.lines[1].name, 'Cold Drink (1.5 litre)');
});

test('resolve: asks for a size when a product has several', async () => {
  const r = await resolveOrder(shop().db, { store: 'Aghosh', items: [{ product: 'cold drink', quantity: 1 }] }, user, deps);
  assert.equal(r.reply.error, 'which_size');
  assert.deepEqual(r.reply.sizes.map((s) => s.size), ['500ml', '1.5 litre']);
});

test('resolve: refuses silly quantities, unknown products and non-customers', async () => {
  assert.equal((await resolveOrder(shop().db, { store: 'Aghosh', items: [{ product: 'chicken biryani', quantity: 500 }] }, user, deps)).reply.error, 'bad_quantity');
  assert.equal((await resolveOrder(shop().db, { store: 'Aghosh', items: [{ product: 'pizza', quantity: 1 }] }, user, deps)).reply.error, 'product_not_found');
  const staff = shop({ customer: { ...CUSTOMER, user_type: 'standard_user' } });
  assert.equal((await resolveOrder(staff.db, { store: 'Aghosh', items: [{ product: 'chicken biryani', quantity: 1 }] }, user, deps)).reply.error, 'not_permitted');
});

test('resolve: asks for an address when none is saved or given', async () => {
  const r = await resolveOrder(shop({ customer: { ...CUSTOMER, address: '' } }).db, { store: 'Aghosh', items: [{ product: 'chicken biryani', quantity: 1 }] }, user, deps);
  assert.equal(r.reply.error, 'missing_address');
});

test('the summary is priced by the order handler in dry-run mode, then the same body is placed', async () => {
  const calls = [];
  const fakeHandler = async (_db, _io, account, body, { dryRun }) => {
    calls.push({ account: account.id, body, dryRun });
    return dryRun
      ? { status: 200, body: { success: true, dry_run: true, items: [{ product_id: 10, quantity: 2, unit_price: 450 }], items_subtotal: 900, delivery_fee: 100, total: 1000, wallet_balance: null } }
      : { status: 201, body: { success: true, order: { order_number: 'ORD-77', total_amount: 1000 } } };
  };
  const action = placeOrderAction({ ...deps, callOrderHandler: fakeHandler });
  const args = { store: 'Aghosh', items: [{ product: 'chicken biryani', quantity: 2 }] };
  const preview = await action.preview(shop().db, args, user, null);
  assert.match(preview.summary, /Order from Aghosh Hotel: 2 × Chicken Biryani \(Rs 450 each\)\. Delivery Rs 100\. Total Rs 1,000, paid by cash on delivery\. Deliver to: House 5/);
  assert.equal(calls[0].dryRun, true);
  const done = await action.run(shop().db, args, user, null);
  assert.equal(done.placed, true);
  assert.equal(done.order_number, 'ORD-77');
  assert.match(done.page, /order_number=ORD-77/);
  assert.equal(calls[1].dryRun, false);
  assert.deepEqual(calls[1].body, calls[0].body, 'the placed order is exactly what was priced');
});

test('wallet too low, or the handler refusing (store closed etc.), stops before any order', async () => {
  const low = placeOrderAction({ ...deps, callOrderHandler: async () => ({ status: 200, body: { dry_run: true, items: [], delivery_fee: 100, total: 1000, wallet_balance: 300 } }) });
  const r1 = await low.preview(shop().db, { store: 'Aghosh', items: [{ product: 'chicken biryani', quantity: 2 }], payment_method: 'wallet' }, user, null);
  assert.equal(r1.error, 'wallet_too_low');
  const closed = placeOrderAction({ ...deps, callOrderHandler: async () => ({ status: 400, body: { success: false, message: 'Aghosh Hotel is closed now' } }) });
  const r2 = await closed.preview(shop().db, { store: 'Aghosh', items: [{ product: 'chicken biryani', quantity: 1 }] }, user, null);
  assert.equal(r2.error, 'refused');
  assert.equal(r2.message, 'Aghosh Hotel is closed now');
});

test('the in-process call reaches the real order handler as the verified customer', async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only_0123456789';
  const { db, log } = fakeDb((q) => {
    if (/FROM users WHERE id = \?/.test(q)) return [[{ is_active: 1, user_type: 'customer', branch_id: 1, password_changed_ts: null }]];
    return undefined;
  });
  const r = await callOrderHandler(db, null, CUSTOMER, { items: [], delivery_address: 'x', payment_method: 'cash' }, { dryRun: true });
  assert.equal(r.status, 400, 'the handler ran (signed in) and refused the empty order with its own rule');
  assert.match(r.body.message, /at least one item/);
  assert.ok(!log.some((q) => /^INSERT/.test(q)));
});
