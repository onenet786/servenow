const test = require('node:test');
const assert = require('node:assert');
const { fakeDb } = require('./helpers');
const { editBlock, applyEdit, editOrderAction, EditRefused } = require('../services/orderEdits');

const user = { id: 42, type: 'customer', name: 'Sana Malik', branch_id: 1 };
const CUSTOMER = { id: 42, first_name: 'Sana', last_name: 'Malik', email: 's@x', user_type: 'customer', address: 'House 5', is_active: 1 };
const PENDING = {
  id: 11, order_number: 'ORD-11', user_id: 42, status: 'pending', payment_method: 'cash', payment_status: 'pending',
  total_amount: '550.00', delivery_fee: '100.00', delivery_address: 'House 5', special_instructions: null, branch_id: 1, age: 120,
};
const PREPARED = [
  { productId: 10, storeId: 3, quantity: 3, unitPrice: 450, costPrice: 400, sizeId: null, unitId: null, variantLabel: null, discount_type: null, discount_value: null },
];
const priced = { total: 1450, delivery_fee: 100, store_id: 3, prepared: PREPARED, items: [{ product_id: 10, quantity: 3, unit_price: 450, store_id: 3 }], items_subtotal: 1350, branch_id: 1, dry_run: true };
const resolved = { body: { delivery_address: 'House 5', payment_method: 'cash' }, lines: [{ product_id: 10, product: 'Chicken Biryani', size: '', quantity: 3, store_id: 3, store: 'Aghosh Hotel' }], stores: [{ id: 3, name: 'Aghosh Hotel' }] };

test('only pending, unpaid cash orders within 10 minutes and under 3 edits can be changed directly', () => {
  assert.equal(editBlock(PENDING, 120, 0), null);
  assert.match(editBlock({ ...PENDING, status: 'confirmed' }, 120, 0), /already accepted/);
  assert.match(editBlock({ ...PENDING, payment_method: 'wallet' }, 120, 0), /paid/);
  assert.match(editBlock({ ...PENDING, payment_status: 'paid' }, 120, 0), /paid/);
  assert.match(editBlock(PENDING, 11 * 60, 0), /10 minutes/);
  assert.match(editBlock(PENDING, 120, 3), /3 times/);
});

function editDb({ locked = { id: 11, user_id: 42, status: 'pending', payment_method: 'cash', payment_status: 'pending', stock_deducted: 1, total_amount: '550.00' }, stock = 20, updated = 1 } = {}) {
  return fakeDb((q) => {
    if (/FROM orders WHERE id = \? FOR UPDATE/.test(q)) return [[locked]];
    if (/FROM order_items oi LEFT JOIN products p/.test(q)) return [[{ product_id: 10, quantity: 1, price: '450.00', variant_label: null, name: 'Chicken Biryani' }]];
    if (/SELECT name, stock_quantity FROM products WHERE id = \? FOR UPDATE/.test(q)) return [[{ name: 'Chicken Biryani', stock_quantity: stock }]];
    if (/^UPDATE orders SET total_amount/.test(q)) return [{ affectedRows: updated }];
    return undefined;
  });
}

test('the edit is one transaction: lock, give back old stock, check and take new stock, replace items, update totals, keep history', async () => {
  const { db, log } = editDb();
  await applyEdit(db, PENDING, priced, resolved, user);
  const order = ['BEGIN', 'FOR UPDATE', 'stock_quantity + ?', 'SELECT name, stock_quantity', 'DELETE FROM order_items', 'INSERT INTO order_items', 'stock_quantity - ?', 'UPDATE orders SET total_amount', 'INSERT INTO order_edits', 'COMMIT'];
  let at = -1;
  for (const step of order) {
    const i = log.findIndex((q, idx) => idx > at && q.includes(step));
    assert.ok(i > at, `${step} happens in order`);
    at = i;
  }
  assert.ok(!log.includes('ROLLBACK'));
});

test('if the store accepted a moment earlier, nothing changes', async () => {
  const { db, log } = editDb({ locked: { id: 11, user_id: 42, status: 'confirmed', payment_method: 'cash', payment_status: 'pending', stock_deducted: 1 } });
  await assert.rejects(applyEdit(db, PENDING, priced, resolved, user), EditRefused);
  assert.ok(log.includes('ROLLBACK'));
  assert.ok(!log.some((q) => /^(DELETE|INSERT INTO order_items)/.test(q)));
});

test('not enough stock for the new items: everything rolls back, the old stock stays as it was', async () => {
  const { db, log } = editDb({ stock: 2 });
  await assert.rejects(applyEdit(db, PENDING, priced, resolved, user), /Only 2 of Chicken Biryani/);
  assert.ok(log.includes('ROLLBACK'));
  assert.ok(!log.includes('COMMIT'));
});

test('the order row update is guarded by status = pending as well', async () => {
  const { db, log } = editDb({ updated: 0 });
  await assert.rejects(applyEdit(db, PENDING, priced, resolved, user), EditRefused);
  assert.ok(log.includes('ROLLBACK'));
});

// ---- through the action: summary of before and after, refusal, and the hand-over to change requests

function actionDb(order = PENDING, edits = 0) {
  return fakeDb((q, params) => {
    if (/FROM users WHERE id = \?/.test(q)) return [[CUSTOMER]];
    if (/FROM orders WHERE order_number = \?/.test(q)) return [[order].filter((o) => o.order_number === params[0])];
    if (/SELECT COUNT\(\*\) AS n FROM order_edits/.test(q)) return [[{ n: edits }]];
    if (/FROM order_items oi LEFT JOIN products p/.test(q)) return [[{ product_id: 10, quantity: 1, price: '450.00', variant_label: null, name: 'Chicken Biryani' }]];
    if (/FROM products p\s+LEFT JOIN sizes sz ON sz.id = p.size_id/.test(q)) return [[{ id: 10, store_id: 3, name: 'Chicken Biryani', price: '450.00', size_id: null, unit_id: null, size_label: null, unit_name: null }]];
    if (/FROM product_size_prices psp/.test(q)) return [[]];
    return undefined;
  });
}
const deps = {
  resolveStore: async () => ({ store: { id: 3, name: 'Aghosh Hotel' } }),
  browseBranchIds: async () => [1],
  orderPage: (no) => `https://servenow.pk/order-confirmation.html?order_number=${no}`,
  callOrderHandler: async () => ({ status: 200, body: priced }),
};

test('the summary reads what the order has now and what it will have, with the new total', async () => {
  const action = editOrderAction(deps);
  const p = await action.preview(actionDb().db, { order_number: 'ORD-11', store: 'Aghosh', items: [{ product: 'chicken biryani', quantity: 3 }] }, user, null);
  assert.match(p.summary, /^Change order ORD-11\. Now: 1 × Chicken Biryani \(Rs 550\)\. New: Aghosh Hotel: 3 × Chicken Biryani Rs 450 each\. Delivery Rs 100\. New total Rs 1,450, cash on delivery\./);
  assert.match(p.summary, /Say "yes" to change the order\.$/);
  assert.equal(p.new_total.value, 1450);
  assert.equal(JSON.stringify(p).includes('cost'), false, 'cost prices never reach the assistant');
});

test('an order the store accepted, a wallet order or an old order is handed over to change requests', async () => {
  const action = editOrderAction(deps);
  for (const order of [{ ...PENDING, status: 'preparing' }, { ...PENDING, payment_method: 'wallet' }, { ...PENDING, age: 3600 }]) {
    const r = await action.preview(actionDb(order).db, { order_number: 'ORD-11', store: 'Aghosh', items: [{ product: 'chicken biryani', quantity: 3 }] }, user, null);
    assert.equal(r.error, 'not_editable');
    assert.match(r.message, /request_order_change/);
  }
});

test("someone else's order gets the same not-found as a missing one", async () => {
  const action = editOrderAction(deps);
  const r = await action.preview(actionDb({ ...PENDING, user_id: 99 }).db, { order_number: 'ORD-11', items: [{ product: 'x', quantity: 1 }] }, user, null);
  assert.equal(r.error, 'not_found');
});
