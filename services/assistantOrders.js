// Ordering through the chat assistant (text, voice messages, Live calls).
//
// The assistant names the store, items, sizes, address and payment; this file finds the exact products
// and sizes, then sends the order through the website's own order handler (POST /api/orders in
// routes/orders.js), in-process and as the verified customer. So prices, offers, stock, store hours,
// branch, delivery fee and wallet balance follow exactly the same rules as the website. The summary
// the customer confirms comes from the same handler in dry-run mode (it stops before writing).
const jwt = require('jsonwebtoken');

const MAX_LINES = 20;
const MAX_QTY = 50; // per line by voice; larger orders go through the website
const PAYMENT_TEXT = { cash: 'cash on delivery', wallet: 'ServeNow wallet' };

const clean = (v, max = 60) => String(v ?? '').replace(/[%_\\]/g, ' ').trim().slice(0, max);
const rs = (n) => `Rs ${(Math.round(Number(n || 0) * 100) / 100).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`;

async function loadCustomer(db, id) {
  const [rows] = await db.execute(
    'SELECT id, first_name, last_name, email, user_type, address, is_active FROM users WHERE id = ?',
    [id]
  );
  const u = rows[0];
  return u && u.is_active ? u : null;
}

/**
 * Sends a body to the website's order handler as `account`, in-process (no HTTP, no browser).
 * The token is minted here for one call, lives 60 seconds and is never returned to anyone.
 */
function callOrderHandler(db, io, account, body, { dryRun }) {
  const router = require('../routes/orders'); // late: routes/orders.js loads services that load this file
  const token = jwt.sign(
    { id: account.id, email: account.email, user_type: account.user_type, first_name: account.first_name, last_name: account.last_name },
    process.env.JWT_SECRET,
    { expiresIn: 60 }
  );
  return new Promise((resolve, reject) => {
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const req = {
      method: 'POST', url: '/', originalUrl: '/api/orders', baseUrl: '/api/orders', headers, body,
      query: {}, params: {}, db, io, ip: '127.0.0.1', assistantDryRun: dryRun === true,
      get: (name) => headers[String(name).toLowerCase()],
      header: (name) => headers[String(name).toLowerCase()],
    };
    const res = {
      statusCode: 200, locals: {},
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
      send(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
      set() { return this; }, setHeader() {}, getHeader() { return undefined; },
    };
    router.handle(req, res, (err) => (err ? reject(err) : resolve({ status: 404, body: { success: false, message: 'Order service not found' } })));
  });
}

// Size choices of a product: its size prices, plus the product's own size when it has one.
async function sizeOptions(db, product) {
  const [rows] = await db.execute(
    `SELECT psp.size_id, psp.unit_id, psp.price, sz.label AS size_label, u.name AS unit_name
       FROM product_size_prices psp
       LEFT JOIN sizes sz ON sz.id = psp.size_id
       LEFT JOIN units u ON u.id = psp.unit_id
      WHERE psp.product_id = ?
      ORDER BY psp.sort_order, psp.price`,
    [product.id]
  );
  const options = rows.map((r) => ({ size_id: r.size_id, unit_id: r.unit_id, price: Number(r.price), label: r.size_label || r.unit_name || '' }))
    .filter((o) => o.label);
  if (options.length && (product.size_id || product.unit_id)) {
    const label = product.size_label || product.unit_name || '';
    const same = options.some((o) => o.size_id === product.size_id && o.unit_id === product.unit_id);
    if (label && !same) options.unshift({ size_id: product.size_id, unit_id: product.unit_id, price: Number(product.price), label });
  }
  return options;
}

/**
 * Turns the assistant's arguments into the exact order body, or a reply asking for what is missing.
 * Deterministic for the same arguments, so the confirmed summary and the placed order match.
 */
async function resolveOrder(db, args, user, { resolveStore, browseBranchIds }) {
  const customer = await loadCustomer(db, user.id);
  if (!customer || customer.user_type !== 'customer') {
    return { reply: { error: 'not_permitted', message: 'Only customer accounts can order through the assistant.' } };
  }
  const storeName = clean(args.store, 50);
  if (!storeName) return { reply: { error: 'missing', message: 'Ask which store they want to order from.' } };
  const found = await resolveStore(db, storeName, await browseBranchIds(db, user));
  if (found.reply) return found;
  const store = found.store;

  const wanted = Array.isArray(args.items) ? args.items : [];
  if (!wanted.length) return { reply: { error: 'missing', message: 'Ask what they would like to order and how many.' } };
  if (wanted.length > MAX_LINES) return { reply: { error: 'too_many', message: `At most ${MAX_LINES} different items by chat; suggest the website for a bigger order.` } };

  const items = [];
  const lines = [];
  for (const raw of wanted) {
    const name = clean(raw && raw.product, 60);
    const qty = Number(raw && raw.quantity);
    if (!name) return { reply: { error: 'missing', message: 'One item has no product name. Ask what it is.' } };
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      return { reply: { error: 'bad_quantity', message: `Ask how many "${name}" they want (a whole number from 1 to ${MAX_QTY}).` } };
    }
    const [matches] = await db.execute(
      `SELECT p.id, p.name, p.price, p.size_id, p.unit_id, sz.label AS size_label, u.name AS unit_name
         FROM products p
         LEFT JOIN sizes sz ON sz.id = p.size_id
         LEFT JOIN units u ON u.id = p.unit_id
        WHERE p.store_id = ? AND p.is_available = 1 AND p.name LIKE ?
        ORDER BY (p.name = ?) DESC, length(p.name) LIMIT 6`,
      [store.id, `%${name}%`, name]
    );
    const exact = matches.filter((p) => p.name.toLowerCase() === name.toLowerCase());
    const product = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : null;
    if (!product) {
      return {
        reply: matches.length
          ? { error: 'which_product', message: `Several items at ${store.name} match "${name}". Ask which one.`, choices: matches.map((p) => ({ name: p.name, price: rs(p.price) })) }
          : { error: 'product_not_found', message: `${store.name} has no "${name}". Use store_products to show what it has.` },
      };
    }
    const options = await sizeOptions(db, product);
    let choice = null;
    if (options.length > 1 || (options.length === 1 && raw.size)) {
      const size = clean(raw && raw.size, 40).toLowerCase();
      const hits = size ? options.filter((o) => o.label.toLowerCase() === size || o.label.toLowerCase().includes(size)) : [];
      if (hits.length !== 1) {
        return { reply: { error: 'which_size', message: `Ask which size of ${product.name} they want.`, sizes: options.map((o) => ({ size: o.label, price: rs(o.price) })) } };
      }
      choice = hits[0];
    } else if (options.length === 1) {
      choice = options[0];
    }
    const item = { product_id: product.id, quantity: qty };
    if (choice) {
      if (choice.size_id) item.size_id = choice.size_id;
      if (choice.unit_id) item.unit_id = choice.unit_id;
    }
    items.push(item);
    lines.push({ name: choice ? `${product.name} (${choice.label})` : product.name, quantity: qty });
  }

  const address = String(args.delivery_address || customer.address || '').trim().slice(0, 500);
  if (!address) return { reply: { error: 'missing_address', message: 'Ask for the delivery address (house, street, area, landmark).' } };
  const payment = ['cash', 'wallet'].includes(args.payment_method) ? args.payment_method : 'cash';
  const notes = String(args.notes || '').trim().slice(0, 300);

  return {
    customer,
    store,
    lines,
    body: { items, delivery_address: address, payment_method: payment, ...(notes ? { special_instructions: notes } : {}) },
  };
}

function summaryText(resolved, priced) {
  const byProduct = new Map();
  for (const it of priced.items || []) {
    const key = it.product_id;
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key).push(it);
  }
  const parts = resolved.lines.map((l, i) => {
    const priceLines = byProduct.get(resolved.body.items[i].product_id) || [];
    const each = priceLines.find((p) => p.unit_price > 0);
    const free = priceLines.filter((p) => p.unit_price === 0).reduce((n, p) => n + p.quantity, 0);
    return `${l.quantity} × ${l.name}${each ? ` (${rs(each.unit_price)} each)` : ''}${free ? `, ${free} free with an offer` : ''}`;
  });
  return `Order from ${resolved.store.name}: ${parts.join('; ')}. Delivery ${rs(priced.delivery_fee)}. `
    + `Total ${rs(priced.total)}, paid by ${PAYMENT_TEXT[resolved.body.payment_method]}. `
    + `Deliver to: ${resolved.body.delivery_address}. Place this order?`;
}

function placeOrderAction(deps) {
  const send = deps.callOrderHandler || callOrderHandler; // tests pass a stand-in
  return {
    async preview(db, args, user, io) {
      const resolved = await resolveOrder(db, args, user, deps);
      if (resolved.reply) return resolved.reply;
      const priced = await send(db, io, resolved.customer, resolved.body, { dryRun: true });
      if (priced.status !== 200 || !priced.body || !priced.body.dry_run) {
        return { error: 'refused', message: (priced.body && priced.body.message) || 'The order cannot be placed right now.' };
      }
      const p = priced.body;
      if (resolved.body.payment_method === 'wallet' && p.wallet_balance !== null && p.wallet_balance < p.total) {
        return { error: 'wallet_too_low', message: `The wallet has ${rs(p.wallet_balance)} but the order is ${rs(p.total)}. Offer cash on delivery or a smaller order.` };
      }
      return {
        summary: summaryText(resolved, p),
        store: resolved.store.name,
        total: { value: p.total, text: rs(p.total) },
        delivery_fee: { value: p.delivery_fee, text: rs(p.delivery_fee) },
        payment: PAYMENT_TEXT[resolved.body.payment_method],
        deliver_to: resolved.body.delivery_address,
      };
    },
    async run(db, args, user, io) {
      const resolved = await resolveOrder(db, args, user, deps);
      if (resolved.reply) return resolved.reply;
      const placed = await send(db, io, resolved.customer, resolved.body, { dryRun: false });
      if (placed.status !== 201 || !placed.body || !placed.body.success) {
        return { error: 'refused', message: (placed.body && placed.body.message) || 'The order could not be placed.' };
      }
      const o = placed.body.order;
      return {
        placed: true,
        order_number: o.order_number,
        total: { value: Number(o.total_amount), text: rs(o.total_amount) },
        page: deps.orderPage(o.order_number),
        message: `Order ${o.order_number} is placed. The store has been told. Share the order page link so they can follow it.`,
      };
    },
  };
}

module.exports = { placeOrderAction, resolveOrder, callOrderHandler, MAX_QTY };
