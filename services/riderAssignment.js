// Giving an order to a rider: the rules and notifications shared by the admin screens
// (PUT /api/orders/:id/assign-rider) and the chat assistant's assign_rider action.
//
// checkAssignment() changes nothing: it says whether the assignment may happen and what it would do.
// assignRider() checks again and then assigns, using optimistic concurrency so two dispatchers
// never silently overwrite each other.
const fs = require('fs');
const path = require('path');
const { toBranchId, adminRoomsFor } = require('../utils/branches');
const { sendPushToUser } = require('./pushNotifications');

const roundAmount = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const refuse = (status, message) => ({ ok: false, status, body: { success: false, message } });

/**
 * @param {object} input   { orderId, riderId, deliveryFee? }
 * @param {object} opts    { branchScope }  the one branch a branch account is limited to (null = all)
 * @returns {Promise<{ok:false,status,body} | {ok:true, order, rider, newStatus, finalDeliveryFee, newTotal}>}
 */
async function checkAssignment(db, { orderId, riderId, deliveryFee }, { branchScope = null } = {}) {
  const [orders] = await db.execute(
    'SELECT id, order_number, user_id, rider_id, total_amount, delivery_fee, status, payment_status, branch_id FROM orders WHERE id = ?',
    [orderId]
  );
  const order = orders[0];
  // A branch account hears "not found" for another branch's order, as everywhere else.
  if (!order || (branchScope !== null && toBranchId(order.branch_id) !== branchScope)) {
    return refuse(404, 'Order not found');
  }

  // Do not allow assigning riders to already completed or cancelled orders
  if (order.status === 'delivered' || order.status === 'cancelled') {
    return refuse(400, `Cannot assign rider to an order that is already ${order.status}`);
  }

  if (order.rider_id && Number(order.rider_id) !== Number(riderId)) {
    const [financialRows] = await db.execute(
      `SELECT 'wallet_transaction' AS source, wt.id
       FROM wallet_transactions wt
       WHERE wt.reference_type = 'order'
         AND CAST(wt.reference_id AS UNSIGNED) = ?
       LIMIT 1`,
      [orderId]
    );
    const [submissionRows] = await db.execute(
      `SELECT 'cash_submission_link' AS source, rcso.id
       FROM rider_cash_submission_orders rcso
       JOIN rider_cash_movements rcm ON rcm.id = rcso.movement_id
       WHERE rcso.order_id = ?
         AND rcm.status IN ('pending', 'approved', 'completed')
       LIMIT 1`,
      [orderId]
    );
    if (financialRows.length || submissionRows.length) {
      return refuse(409, 'Cannot change rider after wallet or cash-submission records exist for this order');
    }
  }

  // Check if rider exists and is available
  const [riders] = await db.execute(
    'SELECT id, first_name, last_name, branch_id FROM riders WHERE id = ? AND is_active = true',
    [riderId]
  );
  const rider = riders[0];
  if (!rider) return refuse(400, 'Rider not found or not active');
  if (toBranchId(rider.branch_id) !== toBranchId(order.branch_id)) {
    return refuse(400, 'This rider belongs to a different branch than the order');
  }

  // Recalculate total based on actual items
  const [items] = await db.execute('SELECT price, quantity FROM order_items WHERE order_id = ?', [orderId]);
  let itemsSubtotal = 0;
  for (const item of items) itemsSubtotal += (parseFloat(item.price) || 0) * (parseInt(item.quantity) || 0);

  let finalDeliveryFee = deliveryFee !== undefined ? parseFloat(deliveryFee) : parseFloat(order.delivery_fee) || 0;
  let newTotal = Number(itemsSubtotal) + Number(finalDeliveryFee);

  // A paid order's amount is final: changing it would not refund or charge the customer
  if (order.payment_status === 'paid') {
    const paidFee = parseFloat(order.delivery_fee) || 0;
    if (deliveryFee !== undefined && roundAmount(parseFloat(deliveryFee)) !== roundAmount(paidFee)) {
      return refuse(400, 'This order is already paid; its delivery fee cannot be changed');
    }
    finalDeliveryFee = paidFee;
    newTotal = order.total_amount;
  }

  // Assigning a rider does not mean the order is out for delivery (that happens
  // at pickup): pending orders become confirmed, any other status is kept.
  const newStatus = order.status === 'pending' ? 'confirmed' : order.status;
  return { ok: true, order, rider, newStatus, finalDeliveryFee, newTotal };
}

/** Checks, assigns and notifies. Returns { status, body } in the admin route's response format. */
async function assignRider(db, io, input, opts = {}) {
  const check = await checkAssignment(db, input, opts);
  if (!check.ok) return check;
  const { order, rider, newStatus, finalDeliveryFee, newTotal } = check;
  const id = order.id;
  const riderId = rider.id;

  // Set estimated delivery time (current time + 30 minutes)
  const estimatedDelivery = new Date(Date.now() + 30 * 60 * 1000);

  // Optimistic concurrency: only apply if nobody changed the rider or status
  // since we read the order (prevents two dispatchers silently overwriting each other).
  const [assignResult] = await db.execute(
    'UPDATE orders SET rider_id = ?, status = ?, estimated_delivery_time = ?, delivery_fee = ?, total_amount = ? WHERE id = ? AND status = ? AND rider_id <=> ?',
    [riderId, newStatus, estimatedDelivery, finalDeliveryFee, newTotal, id, order.status, order.rider_id ?? null]
  );
  if (Number(assignResult?.affectedRows || 0) === 0) {
    return refuse(409, 'This order was updated by someone else. Please refresh and try again.');
  }

  await notifyAssigned(db, io, { order, rider, newStatus, estimatedDelivery, finalDeliveryFee, newTotal });

  return {
    ok: true,
    status: 200,
    body: { success: true, message: 'Rider assigned successfully', delivery_fee: finalDeliveryFee, total_amount: newTotal },
    order,
    rider,
  };
}

function debugLog(message) {
  if (process.env.NODE_ENV !== 'production') {
    fs.appendFile(path.join(__dirname, '../socket_debug.log'), message, () => {});
  }
}

async function notifyAssigned(db, io, { order, rider, newStatus, estimatedDelivery, finalDeliveryFee, newTotal }) {
  const id = order.id;
  const riderId = rider.id;
  try {
    if (!io) return;
    const orderData = {
      id,
      order_number: order.order_number,
      rider_id: riderId,
      rider_name: `${rider.first_name} ${rider.last_name}`,
      status: newStatus, // Send the ACTUAL new status, not hardcoded 'out_for_delivery'
      estimated_delivery_time: estimatedDelivery,
      delivery_fee: finalDeliveryFee,
      total_amount: newTotal,
    };
    console.log('[Orders] Broadcasting order_assigned to admins', orderData);
    io.to(adminRoomsFor(order.branch_id)).emit('order_assigned', orderData);

    // Send "Store Owner Notification" to all store owners involved in this order
    const [storeOwners] = await db.execute(
      `SELECT DISTINCT s.owner_id, s.name as store_name
       FROM order_items oi
       JOIN stores s ON oi.store_id = s.id
       WHERE oi.order_id = ?`,
      [id]
    );
    for (const owner of storeOwners) {
      const message = `Order #${order.order_number} containing ${owner.store_name} products has been assigned to rider ${rider.first_name} ${rider.last_name}.`;
      io.to(`user_${owner.owner_id}`).emit('store_owner_notification', {
        type: 'rider_assigned',
        title: 'Rider Assigned',
        message,
        order_id: id,
        rider_name: `${rider.first_name} ${rider.last_name}`,
      });
      await sendPushToUser(db, {
        userId: owner.owner_id,
        userType: 'store_owner',
        title: 'Rider Assigned',
        message,
        data: { type: 'rider_assigned', order_id: id, order_number: order.order_number },
        collapseKey: 'store_owner_rider_assigned',
      });
      debugLog(`[${new Date().toISOString()}] Store notification sent to owner ${owner.owner_id} for store ${owner.store_name}\n`);
    }

    const riderRoomName = `rider_${riderId}`;
    const userRoomName = `user_${order.user_id}`;
    console.log(`[Orders] Emitting rider_notification to room: ${riderRoomName}`, { rider_id: riderId, order_number: order.order_number });
    io.to(riderRoomName).emit('rider_notification', {
      type: 'assigned',
      rider_id: riderId,
      order_id: id,
      order_number: order.order_number,
      message: `New order assigned: ${order.order_number}`,
      timestamp: new Date(),
    });
    await sendPushToUser(db, {
      userId: riderId,
      userType: 'rider',
      title: 'New Assignment',
      message: `New order assigned: ${order.order_number}`,
      data: { type: 'assigned', order_id: id, order_number: order.order_number },
      collapseKey: 'rider_assignment',
    });

    console.log(`[Orders] Emitting user_notification to room: ${userRoomName}`, { user_id: order.user_id, order_number: order.order_number });
    io.to(userRoomName).emit('user_notification', {
      type: 'order_update',
      user_id: order.user_id,
      order_id: id,
      order_number: order.order_number,
      status: 'out_for_delivery',
      message: `Your order ${order.order_number} has been assigned to rider ${rider.first_name}.`,
      timestamp: new Date(),
    });
    await sendPushToUser(db, {
      userId: order.user_id,
      userType: 'customer',
      title: 'Order Update',
      message: `Your order ${order.order_number} has been assigned to rider ${rider.first_name}.`,
      data: { type: 'order_update', order_id: id, order_number: order.order_number, status: 'out_for_delivery' },
      collapseKey: 'order_status',
    });
    debugLog(`[${new Date().toISOString()}] Order assigned: ${order.order_number} to ${rider.first_name}. Sent to rooms: ${riderRoomName}, ${userRoomName}\n`);
  } catch (e) {
    console.error('Socket emit error:', e);
  }
}

module.exports = { checkAssignment, assignRider };
