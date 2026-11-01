// Changes to an order the customer already placed, asked through the chat assistant.
//
// Customers cannot edit a placed order themselves (on the website either); staff with "Edit orders"
// can. So the assistant sends a change request: it is saved, added to the order's note (so the store,
// dispatch and the rider see it on the order), and announced live to the order's branch staff and to
// its store owners (bell, pop-up and phone push). Staff apply it with the existing order edit screens.
// Only while the order can still change (before the rider picks it up), and at most 5 per order.
const { toBranchId, adminRoomsFor } = require('../utils/branches');
const { sendPushToUser } = require('./pushNotifications');
const { runOncePerProcess } = require('../utils/runOnce');

const CHANGEABLE = ['pending', 'confirmed', 'preparing', 'ready', 'ready_for_pickup'];
const MAX_PER_ORDER = 5;
const NOTE_LIMIT = 1000; // orders.special_instructions, as checked when an order is placed

const ensureTable = runOncePerProcess((db) => db.execute(`
  CREATE TABLE IF NOT EXISTS order_change_requests (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_id INT NOT NULL,
    branch_id INT NULL,
    user_id INT NOT NULL,
    request VARCHAR(400) NOT NULL,
    status ENUM('pending', 'done', 'declined') NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ocr_order (order_id),
    INDEX idx_ocr_created (created_at)
  )`));

const tidy = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// The customer's own order that may still change, or a reply saying why not.
async function changeableOrder(db, args, user) {
  if (!user || user.type !== 'customer') {
    return { reply: { error: 'not_permitted', message: 'Only the customer who placed an order can ask to change it.' } };
  }
  const no = tidy(args.order_number, 50).replace(/^#/, '');
  const request = tidy(args.change, 300);
  if (!no) return { reply: { error: 'missing', message: 'Ask which order (the number is in My orders), or use my_orders to find their open orders.' } };
  if (!request) return { reply: { error: 'missing', message: 'Ask exactly what to change: what to add or remove, how many, which size.' } };
  const [rows] = await db.execute(
    `SELECT o.id, o.order_number, o.user_id, o.status, o.branch_id, o.special_instructions
       FROM orders o WHERE o.order_number = ? LIMIT 1`,
    [no]
  );
  const order = rows[0];
  // The same answer for "no such order" and "not yours", so order numbers cannot be probed.
  if (!order || Number(order.user_id) !== Number(user.id)) {
    return { reply: { error: 'not_found', message: `There is no order ${no} on this account. Use my_orders to see their orders.` } };
  }
  const status = String(order.status || '').toLowerCase();
  if (!CHANGEABLE.includes(status)) {
    const why = ['picked_up', 'out_for_delivery'].includes(status)
      ? 'The rider already has it, so it can no longer be changed. Offer a new order (place_order) for anything extra.'
      : `It is ${status}, so it can no longer be changed. Offer a new order (place_order) instead.`;
    return { reply: { error: 'too_late', message: `Order ${order.order_number}: ${why}` } };
  }
  await ensureTable(db);
  const [[{ n }]] = await db.execute('SELECT COUNT(*) AS n FROM order_change_requests WHERE order_id = ?', [order.id]);
  if (Number(n) >= MAX_PER_ORDER) {
    return { reply: { error: 'too_many', message: `Order ${order.order_number} already has ${MAX_PER_ORDER} change requests. Suggest calling the store or support.` } };
  }
  return { order, request };
}

async function notify(db, io, order, request, customerName) {
  const message = `${customerName} asks to change order ${order.order_number}: ${request}`;
  if (io) {
    io.to(adminRoomsFor(toBranchId(order.branch_id))).emit('notification', {
      type: 'order_change_request', title: 'Order change request', message, order_id: order.id, order_number: order.order_number, icon: 'fa-pen-to-square',
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
        type: 'order_change_request', title: 'Order change request', message, order_id: order.id, order_number: order.order_number, store_name: o.name,
      });
    }
    await sendPushToUser(db, {
      userId: o.owner_id, userType: 'store_owner', title: 'Order change request', message,
      data: { type: 'order_change_request', order_id: order.id, order_number: order.order_number },
      collapseKey: 'store_owner_change_request',
    }).catch(() => {});
  }
}

function orderChangeRequestAction() {
  return {
    async preview(db, args, user) {
      const found = await changeableOrder(db, args, user);
      if (found.reply) return found.reply;
      return {
        summary: `Send this change for order ${found.order.order_number} to the store and our team: "${found.request}"? `
          + 'They will update the order; the total may change and the order page will show it.',
        order_number: found.order.order_number,
        change: found.request,
      };
    },
    async run(db, args, user, io) {
      const found = await changeableOrder(db, args, user);
      if (found.reply) return found.reply;
      const { order, request } = found;
      await db.execute(
        'INSERT INTO order_change_requests (order_id, branch_id, user_id, request) VALUES (?, ?, ?, ?)',
        [order.id, toBranchId(order.branch_id), user.id, request]
      );
      // On the order itself, where the store, dispatch and the rider already look.
      const stamp = new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Karachi' });
      const line = `[Change request ${stamp}] ${request}`;
      const current = String(order.special_instructions || '');
      const next = (current ? `${current} | ${line}` : line).slice(-NOTE_LIMIT);
      await db.execute('UPDATE orders SET special_instructions = ? WHERE id = ?', [next, order.id]);
      try {
        await notify(db, io, order, request, user.name || 'The customer');
      } catch (err) {
        console.error('[assistant] change request notification failed:', err.message);
      }
      return {
        sent: true,
        order_number: order.order_number,
        change: request,
        message: 'Sent. The store and our team will update the order; the total may change. They can follow it on the order page '
          + 'or ask "what happened to my change?".',
      };
    },
  };
}

/** The change requests on one order, newest first (for order_status). */
async function changeRequestsFor(db, orderId) {
  await ensureTable(db);
  const [rows] = await db.execute(
    'SELECT request, status, created_at FROM order_change_requests WHERE order_id = ? ORDER BY id DESC LIMIT 5',
    [orderId]
  );
  return rows.map((r) => ({ change: r.request, status: r.status, asked_at: new Date(r.created_at).toISOString() }));
}

module.exports = { orderChangeRequestAction, changeRequestsFor, CHANGEABLE, MAX_PER_ORDER };
