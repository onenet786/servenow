const test = require('node:test');
const assert = require('node:assert');
const { fakeDb, activeAccount, request } = require('./helpers');
const orders = require('../routes/orders');

const owner = { id: 42, user_type: 'customer', email: 'c@example.com' };
const stranger = { id: 43, user_type: 'customer', email: 'x@example.com' };

// Records every io.to(room).emit(event, payload) call.
function fakeIo() {
  const emitted = [];
  return {
    emitted,
    to(room) {
      return { emit: (event, payload) => emitted.push({ room, event, payload }) };
    },
  };
}

function locationDb(order, userType = 'customer') {
  return fakeDb((q) => {
    const auth = activeAccount(q, userType);
    if (auth) return auth;
    if (/FROM orders WHERE id = \? LIMIT 1/.test(q)) return [[order]];
    if (/FROM rider_location_logs WHERE order_id = \?/.test(q)) {
      return [[{ latitude: '30.47100000', longitude: '70.96200000', created_at: new Date('2026-10-29T12:00:00Z') }]];
    }
    return undefined;
  });
}

const getLocation = (order, user) => {
  const { db, log } = locationDb(order, user.user_type);
  return request(orders, '/api/orders', db, { path: `/api/orders/${order.id}/rider-location`, user })
    .then((r) => ({ ...r, log }));
};

const activeOrder = {
  id: 11, user_id: 42, rider_id: 7, status: 'out_for_delivery',
  rider_latitude: '30.47000000', rider_longitude: '70.96000000',
};

test('rider-location: a customer cannot read another customer\'s order', async () => {
  const r = await getLocation(activeOrder, stranger);
  assert.equal(r.status, 403);
  assert.equal(r.body.latitude, undefined);
  assert.equal(r.body.active, undefined);
  assert.ok(!r.log.some((q) => /rider_location_logs/.test(q)), 'no location lookup for a stranger');
});

test('rider-location: inactive order returns active:false and no coordinates', async () => {
  for (const status of ['pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled']) {
    const r = await getLocation({ ...activeOrder, status }, owner);
    assert.equal(r.status, 200, status);
    assert.equal(r.body.active, false, status);
    assert.equal(r.body.latitude, undefined, status);
    assert.equal(r.body.longitude, undefined, status);
  }
});

test('rider-location: owner of an out-for-delivery order gets the latest position', async () => {
  const r = await getLocation(activeOrder, owner);
  assert.equal(r.status, 200);
  assert.equal(r.body.active, true);
  assert.equal(r.body.order_id, 11);
  assert.equal(r.body.latitude, 30.471);
  assert.equal(r.body.longitude, 70.962);
  assert.equal(r.body.updated_at, '2026-10-29T12:00:00.000Z');
});

test('rider-location: only the assigned rider and staff, not other riders', async () => {
  assert.equal((await getLocation(activeOrder, { id: 7, user_type: 'rider' })).status, 200);
  assert.equal((await getLocation(activeOrder, { id: 8, user_type: 'rider' })).status, 403);
  assert.equal((await getLocation(activeOrder, { id: 1, user_type: 'admin' })).status, 200);
  // A rider id that equals the customer's user id must not unlock the order
  assert.equal((await getLocation(activeOrder, { id: 42, user_type: 'rider' })).status, 403);
});

test('emission: customers only get their own order, only while it is on the road', () => {
  const io = fakeIo();
  const payload = orders.buildRiderLocationUpdatePayload({
    riderId: 7, latitude: 30.47, longitude: 70.96, location: 'Kot Addu', orderIds: [11, 12, 13],
    heading: 90, speed: 5, accuracy: 8,
  });
  orders.emitRiderLocationUpdate(io, payload, [
    { id: 11, user_id: 42, status: 'out_for_delivery' },
    { id: 12, user_id: 43, status: 'preparing' },
    { id: 13, user_id: 44, status: 'picked_up' },
  ]);
  const rooms = io.emitted.map((e) => e.room).sort();
  assert.deepEqual(rooms, ['admins', 'rider_7', 'user_42', 'user_44']);
  const toOwner = io.emitted.find((e) => e.room === 'user_42');
  assert.equal(toOwner.event, 'rider_location_update');
  assert.deepEqual(Object.keys(toOwner.payload).sort(),
    ['heading', 'latitude', 'longitude', 'order_id', 'rider_id', 'speed', 'type', 'updated_at']);
  assert.equal(toOwner.payload.order_id, 11);
  assert.equal(toOwner.payload.heading, 90);
  // Admins still get the full payload with every order id
  assert.deepEqual(io.emitted.find((e) => e.room === 'admins').payload.order_ids, [11, 12, 13]);
});

test('PUT /rider/location: one order lookup, motion fields clamped, emits to the owning customer only', async () => {
  const io = fakeIo();
  const { db, log } = fakeDb((q) => {
    const auth = activeAccount(q, 'rider');
    if (auth) return auth;
    if (/information_schema/.test(q)) return [[{ cnt: 1 }]];
    if (/SELECT id, user_id, status FROM orders WHERE rider_id = \?/.test(q)) {
      return [[{ id: 11, user_id: 42, status: 'out_for_delivery' }, { id: 12, user_id: 43, status: 'confirmed' }]];
    }
    return undefined;
  });
  const r = await request(orders, '/api/orders', db, {
    method: 'PUT', path: '/api/orders/rider/location', user: { id: 7, user_type: 'rider' }, io,
    body: { latitude: 30.47, longitude: 70.96, location: 'Kot Addu', heading: 365, speed: 99, accuracy: -4 },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(log.filter((q) => /FROM orders WHERE rider_id = \?/.test(q)).length, 1);
  const customerEmits = io.emitted.filter((e) => e.room.startsWith('user_'));
  assert.deepEqual(customerEmits.map((e) => e.room), ['user_42']);
  assert.equal(customerEmits[0].payload.order_id, 11);
  const admin = io.emitted.find((e) => e.room === 'admins').payload;
  assert.equal(admin.heading, 5);
  assert.equal(admin.speed, 60);
  assert.equal(admin.accuracy, 0);
});

test('PUT /rider/location: older apps without motion fields still work', async () => {
  const io = fakeIo();
  const { db } = fakeDb((q) => activeAccount(q, 'rider') || (/information_schema/.test(q) ? [[{ cnt: 1 }]] : undefined));
  const r = await request(orders, '/api/orders', db, {
    method: 'PUT', path: '/api/orders/rider/location', user: { id: 7, user_type: 'rider' }, io,
    body: { latitude: 30.47, longitude: 70.96 },
  });
  assert.equal(r.status, 200);
  const admin = io.emitted.find((e) => e.room === 'admins').payload;
  assert.equal(admin.heading, null);
  assert.equal(admin.speed, null);
  assert.ok(!io.emitted.some((e) => e.room.startsWith('user_')));
});
