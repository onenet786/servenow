// A customer changes their own order through the chat assistant, while it is still safe to change:
//   - status "pending" (the store has not accepted it and no rider is assigned),
//   - cash on delivery and not paid (no wallet or payment records to correct),
//   - within 10 minutes of ordering, at most 3 edits.
// Anything else goes as a change request to staff (services/orderChangeRequests.js).
//
// The new order is priced by the website's own order handler in dry-run mode (same prices, offers,
// sizes, store hours, branch and delivery fee). It is saved in one transaction with the order row
// locked: still pending? put the old items' stock back, check and take the new stock, replace the
// items, update the totals; all or nothing. Every edit is kept in order_edits (old and new items and
// totals), and the stores and the branch's staff are told at once.
const { resolveOrder, callOrderHandler, orderReview, rs } = require('./assistantOrders');
const { toBranchId, adminRoomsFor } = require('../utils/branches');
const { sendPushToUser } = require('./pushNotifications');
const { runOncePerProcess } = require('../utils/runOnce');

const EDIT_WINDOW_SECONDS = 10 * 60;
const MAX_EDITS = 3;

class EditRefused extends Error {}

const ensureTable = runOncePerProcess((db) => db.execute(`
  CREATE TABLE IF NOT EXISTS order_edits (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_id INT NOT NULL,
    user_id INT NOT NULL,
    old_items TEXT NOT NULL,
    new_items TEXT NOT NULL,
    old_total DECIMAL(10, 2) NOT NULL,
    new_total DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_order_edits_order (order_id)
  )`));

const tidy = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// Why this order cannot be edited now, in words the assistant can pass on (null = it can).
function editBlock(order, ageSeconds, edits) {
  const status = String(order.status || '').toLowerCase();
  if (status !== 'pending') return 'The store has already accepted it.';
  if (String(order.payment_method) !== 'cash' || String(order.payment_status) === 'paid') return 'It is already paid, so the team has to change it.';
  if (ageSeconds > EDIT_WINDOW_SECONDS) return 'It was placed more than 10 minutes ago.';
  if (edits >= MAX_EDITS) return `It has already been changed ${MAX_EDITS} times.`;
  return null;
}

async function loadEditable(db, args, user) {
  if (!user || user.type !== 'customer') {
    return { reply: { error: 'not_permitted', message: 'Only the customer who placed an order can change it.' } };
  }
  const no = tidy(args.order_number, 50).replace(/^#/, '');
  if (!no) return { reply: { error: 'missing', message: 'Ask which order (use my_orders to find it).' } };
  const [rows] = await db.execute(
    `SELECT id, order_number, user_id, status, payment_method, payment_status, total_amount, delivery_fee,
            delivery_address, special_instructions, branch_id, TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age
       FROM orders WHERE order_number = ? LIMIT 1`,
    [no]
  );
  const order = rows[0];
  if (!order || Number(order.user_id) !== Number(user.id)) {
    return { reply: { error: 'not_found', message: `There is no order ${no} on this account. Use my_orders to see their orders.` } };
  }
  await ensureTable(db);
  const [[{ n }]] = await db.execute('SELECT COUNT(*) AS n FROM order_edits WHERE order_id = ?', [order.id]);
  const blocked = editBlock(order, Number(order.age), Number(n));
  if (blocked) {
    return {
      reply: {
        error: 'not_editable',
        message: `Order ${order.order_number} can't be changed directly: ${blocked} Send the change to the store and team with request_order_change instead.`,
      },
    };
  }
  return { order };
}

async function priceNewItems(db, io, args, user, order, deps) {
  const resolved = await resolveOrder(db, {
    ...args,
    delivery_address: args.delivery_address || order.delivery_address,
    payment_method: 'cash',
  }, user, deps);
  if (resolved.reply) return resolved;
  const send = deps.callOrderHandler || callOrderHandler; // tests pass a stand-in
  const priced = await send(db, io, resolved.customer, resolved.body, { dryRun: true });
  if (priced.status !== 200 || !priced.body || !priced.body.dry_run) {
    return { reply: { error: 'refused', message: (priced.body && priced.body.message) || 'The changed order cannot be accepted.' } };
  }
  if (toBranchId(priced.body.branch_id) !== toBranchId(order.branch_id)) {
    return { reply: { error: 'refused', message: 'The changed order must stay with stores of the same city.' } };
  }
  return { resolved, priced: priced.body };
}

async function currentItems(db, orderId) {
  const [rows] = await db.execute(
    `SELECT oi.product_id, oi.quantity, oi.price, oi.variant_label, COALESCE(p.name, 'Item') AS name
       FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ? ORDER BY oi.id`,
    [orderId]
  );
  return rows;
}

const itemText = (i) => `${i.quantity} × ${i.name}${i.variant_label ? ` (${i.variant_label})` : ''}`;

/** Saves the edit in one transaction; throws EditRefused when the order changed meanwhile. */
async function applyEdit(db, order, priced, resolved, user) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [locked] = await conn.execute(
      'SELECT id, user_id, status, payment_method, payment_status, stock_deducted, total_amount FROM orders WHERE id = ? FOR UPDATE',
      [order.id]
    );
    const now = locked[0];
    if (!now || Number(now.user_id) !== Number(user.id) || String(now.status).toLowerCase() !== 'pending'
        || String(now.payment_method) !== 'cash' || String(now.payment_status) === 'paid') {
      throw new EditRefused('The store accepted the order a moment ago, so it was not changed.');
    }
    const [oldItems] = await conn.execute(
      `SELECT oi.product_id, oi.quantity, oi.price, oi.variant_label, COALESCE(p.name, 'Item') AS name
         FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ? ORDER BY oi.id`,
      [order.id]
    );

    // Put the old items' stock back (it was taken when the order was placed).
    if (Number(now.stock_deducted) === 1) {
      const back = new Map();
      for (const i of oldItems) back.set(Number(i.product_id), (back.get(Number(i.product_id)) || 0) + Number(i.quantity));
      for (const [productId, qty] of back) {
        await conn.execute('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ? AND stock_quantity IS NOT NULL', [qty, productId]);
      }
    }
    // Check and take the new stock under row locks (the same rule as placing an order).
    const need = new Map();
    for (const i of priced.prepared) need.set(Number(i.productId), (need.get(Number(i.productId)) || 0) + Number(i.quantity));
    for (const [productId, qty] of need) {
      const [stock] = await conn.execute('SELECT name, stock_quantity FROM products WHERE id = ? FOR UPDATE', [productId]);
      const left = stock[0] && stock[0].stock_quantity;
      if (left !== null && left !== undefined && Number(left) < qty) {
        throw new EditRefused(Number(left) <= 0 ? `${stock[0].name} is out of stock.` : `Only ${left} of ${stock[0].name} available.`);
      }
    }
    await conn.execute('DELETE FROM order_items WHERE order_id = ?', [order.id]);
    for (const i of priced.prepared) {
      await conn.execute(
        'INSERT INTO order_items (order_id, product_id, store_id, quantity, price, cost_price, size_id, unit_id, variant_label, discount_type, discount_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [order.id, i.productId, i.storeId, i.quantity, i.unitPrice, i.costPrice, i.sizeId, i.unitId, i.variantLabel, i.discount_type || null, i.discount_value || null]
      );
    }
    for (const [productId, qty] of need) {
      await conn.execute('UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND stock_quantity IS NOT NULL', [qty, productId]);
    }
    const note = resolved.body.special_instructions !== undefined ? resolved.body.special_instructions : order.special_instructions;
    const [upd] = await conn.execute(
      `UPDATE orders SET total_amount = ?, delivery_fee = ?, store_id = ?, delivery_address = ?, special_instructions = ?, stock_deducted = 1
        WHERE id = ? AND status = 'pending'`,
      [priced.total, priced.delivery_fee, priced.store_id, resolved.body.delivery_address, note || null, order.id]
    );
    if (Number(upd.affectedRows || 0) !== 1) throw new EditRefused('The store accepted the order a moment ago, so it was not changed.');
    await conn.execute(
      'INSERT INTO order_edits (order_id, user_id, old_items, new_items, old_total, new_total) VALUES (?, ?, ?, ?, ?, ?)',
      [order.id, user.id, JSON.stringify(oldItems.map(itemText)),
        JSON.stringify(resolved.lines.map((l) => `${l.quantity} × ${l.product}${l.size ? ` (${l.size})` : ''}${l.note ? ` [${l.note}]` : ''}`)),
        round2(now.total_amount), round2(priced.total)]
    );
    await conn.commit();
    return { oldItems, oldTotal: round2(now.total_amount) };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function announce(db, io, order, newSummary, customerName) {
  const message = `${customerName} changed order ${order.order_number} (not yet accepted): ${newSummary}`;
  if (io) {
    io.to(adminRoomsFor(toBranchId(order.branch_id))).emit('notification', {
      type: 'order_edited', title: 'Order changed by customer', message, order_id: order.id, order_number: order.order_number, icon: 'fa-pen-to-square',
    });
  }
  const [owners] = await db.execute(
    `SELECT DISTINCT s.owner_id, s.name FROM order_items oi JOIN stores s ON s.id = oi.store_id
      WHERE oi.order_id = ? AND s.owner_id IS NOT NULL`,
    [order.id]
  );
  for (const o of owners) {
    if (io) {
      io.to(`user_${o.owner_id}`).emit('store_owner_notification', {
        type: 'order_edited', title: 'Order changed by customer', message, order_id: order.id, order_number: order.order_number, store_name: o.name,
      });
    }
    await sendPushToUser(db, {
      userId: o.owner_id, userType: 'store_owner', title: 'Order changed by customer', message,
      data: { type: 'order_edited', order_id: order.id, order_number: order.order_number }, collapseKey: 'store_owner_order_edited',
    }).catch(() => {});
  }
}

function editOrderAction(deps) {
  return {
    async preview(db, args, user, io) {
      const found = await loadEditable(db, args, user);
      if (found.reply) return found.reply;
      const { order } = found;
      const next = await priceNewItems(db, io, args, user, order, deps);
      if (next.reply) return next.reply;
      const before = await currentItems(db, order.id);
      const review = orderReview(next.resolved, next.priced);
      const newLines = review.stores.map((g) => `${g.store}: ${g.lines.map((l) => `${l.quantity} × ${l.product}${l.size ? ` (${l.size})` : ''}${l.free_offer ? ' free' : ` ${l.each.text} each`}${l.note ? `, note "${l.note}"` : ''}`).join('; ')}`).join('. ');
      return {
        summary: `Change order ${order.order_number}. Now: ${before.map(itemText).join('; ')} (${rs(order.total_amount)}). `
          + `New: ${newLines}. Delivery ${rs(next.priced.delivery_fee)}${review.store_count > 1 ? ` (${review.store_count} stores)` : ''}. `
          + `New total ${rs(next.priced.total)}, cash on delivery. Deliver to: ${next.resolved.body.delivery_address}. `
          + 'Anything else to change? Say "yes" to change the order.',
        order_number: order.order_number,
        old_total: { value: round2(order.total_amount), text: rs(order.total_amount) },
        new_total: { value: next.priced.total, text: rs(next.priced.total) },
        stores: review.stores,
        how_to_present: 'Read what the order has now and what it will have, with the new total. If they change anything '
          + 'else, call edit_order again with the FULL new list and no confirm_token.',
      };
    },
    async run(db, args, user, io) {
      const found = await loadEditable(db, args, user);
      if (found.reply) return found.reply;
      const { order } = found;
      const next = await priceNewItems(db, io, args, user, order, deps);
      if (next.reply) return next.reply;
      try {
        await applyEdit(db, order, next.priced, next.resolved, user);
      } catch (err) {
        if (err instanceof EditRefused) {
          return { error: 'not_changed', message: `${err.message} Offer to send it to the store and team with request_order_change.` };
        }
        throw err;
      }
      const summary = next.resolved.lines.map((l) => `${l.quantity} × ${l.product}${l.size ? ` (${l.size})` : ''}`).join(', ');
      try {
        await announce(db, io, order, `${summary}; new total ${rs(next.priced.total)}`, user.name || 'The customer');
      } catch (err) {
        console.error('[assistant] order edit notification failed:', err.message);
      }
      return {
        changed: true,
        order_number: order.order_number,
        new_total: { value: next.priced.total, text: rs(next.priced.total) },
        page: deps.orderPage(order.order_number),
        message: `Order ${order.order_number} is changed. The store has the new list. Share the order page link.`,
      };
    },
  };
}

module.exports = { editOrderAction, editBlock, applyEdit, EditRefused, EDIT_WINDOW_SECONDS, MAX_EDITS };
