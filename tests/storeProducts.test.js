const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { fakeDb, request } = require('./helpers');

process.env.AIAGENT_URL = 'https://agent.example.com';
process.env.AIAGENT_CHANNEL_KEY = 'chan_test_key';
process.env.AIAGENT_IDENTITY_SECRET = 'identity_secret_for_tests_0123456789';
process.env.AIAGENT_TOOL_SECRET = 'tool_secret_for_tests_0123456789';
const router = require('../routes/aiagent');

const STORES = [
  { id: 3, name: 'Aghosh Hotel', location: 'Kali Pul Canal Colony', delivery_time: '35 min', opening_time: '00:00:00', closing_time: '23:59:00', is_closed: 0, status_message: '' },
];
const PRODUCTS = [
  { name: 'Chicken Biryani', price: '450.00', stock_quantity: 10, available_from: null, available_to: null, category: 'Biryani' },
  { name: 'Mutton Karahi', price: '1800.00', stock_quantity: 5, available_from: '12:00:00', available_to: '23:00:00', category: 'Karahi' },
  { name: 'Cold Drink 1.5L', price: '220.00', stock_quantity: 0, available_from: null, available_to: null, category: null },
];

// A visitor's view: one open branch, the stores above, and their products.
function shop({ stores = STORES, products = PRODUCTS, total } = {}) {
  return fakeDb((q, params) => {
    if (/FROM branches/.test(q)) return [[{ id: 1, name: 'Kot Addu', is_active: 1 }]];
    if (/FROM stores s LEFT JOIN store_status_messages sm .* s.name LIKE \?/.test(q)) {
      const want = String(params[params.length - 2]).replace(/%/g, '').toLowerCase();
      return [stores.filter((s) => s.name.toLowerCase().includes(want))];
    }
    if (/SELECT COUNT\(\*\) AS total FROM products/.test(q)) return [[{ total: total ?? products.length }]];
    if (/FROM products p LEFT JOIN categories c .* WHERE p.store_id = \?/.test(q)) return [products];
    return undefined;
  });
}

const sign = (raw) => `sha256=${crypto.createHmac('sha256', process.env.AIAGENT_TOOL_SECRET).update(raw).digest('hex')}`;
function callTool(db, body) {
  const raw = JSON.stringify({ sent_at: Math.floor(Date.now() / 1000), ...body });
  return request(router, '/', db, {
    method: 'POST', path: '/integrations/aiagent/tools', rawBody: raw,
    headers: { 'x-aiagent-signature': sign(raw) }, beforeRouter: () => {},
  });
}

test('store_products is in the manifest for everyone, with store required', async () => {
  const r = await request(router, '/', shop().db, { path: '/.well-known/aiagent.json' });
  const tool = r.body.tools.find((t) => t.name === 'store_products');
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required, ['store']);
  assert.match(tool.description, /menu/);
  const find = r.body.tools.find((t) => t.name === 'find_products');
  assert.equal(find.inputSchema.required, undefined, 'find_products no longer insists on a product name');
});

test("a visitor asking for a store's products gets its menu grouped by category", async () => {
  const r = await callTool(shop().db, { tool: 'store_products', arguments: { store: 'Aghosh' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.store, 'Aghosh Hotel');
  assert.equal(r.body.open_now, true);
  assert.equal(r.body.delivery_time, '35 min');
  assert.equal(r.body.total_products, 3);
  assert.deepEqual(r.body.categories.map((c) => c.name), ['Biryani', 'Karahi', 'Other']);
  assert.equal(r.body.categories[0].products[0].price.text, 'Rs 450');
  assert.equal(r.body.categories[1].products[0].only_between, '12:00–23:00');
  assert.equal(r.body.categories[2].products[0].in_stock, false);
});

test('find_products with only a store answers with the same menu', async () => {
  const r = await callTool(shop().db, { tool: 'find_products', arguments: { store: 'Aghosh Hotel' } });
  assert.equal(r.body.store, 'Aghosh Hotel');
  assert.equal(r.body.categories.length, 3);
});

test('a long menu says how many there are and asks to narrow down', async () => {
  const r = await callTool(shop({ total: 120 }).db, { tool: 'store_products', arguments: { store: 'Aghosh' } });
  assert.equal(r.body.total_products, 120);
  assert.match(r.body.note, /Showing 3 of 120/);
});

test('unknown or ambiguous store names are handled', async () => {
  const none = await callTool(shop().db, { tool: 'store_products', arguments: { store: 'Pizza Palace' } });
  assert.equal(none.body.error, 'store_not_found');
  const two = [...STORES, { ...STORES[0], id: 4, name: 'Aghosh Bakers' }];
  const which = await callTool(shop({ stores: two }).db, { tool: 'store_products', arguments: { store: 'Aghosh' } });
  assert.equal(which.body.error, 'which_store');
  assert.deepEqual(which.body.stores.map((s) => s.name), ['Aghosh Hotel', 'Aghosh Bakers']);
});

test('search text from the chat is passed as a parameter, never into the SQL', async () => {
  const { db, log } = shop();
  await callTool(db, { tool: 'store_products', arguments: { store: "Aghosh'; DROP TABLE products; --", category: "x' OR 1=1 --" } });
  assert.ok(!log.some((q) => /DROP TABLE|OR 1=1/.test(q)));
});
