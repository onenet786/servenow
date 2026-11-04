const test = require('node:test');
const assert = require('node:assert');
const { fakeDb, activeAccount, request } = require('./helpers');
const { clearAccountStatusCache } = require('../middleware/auth');
const riders = require('../routes/riders');

const admin = { id: 1, user_type: 'admin' };

function fuelDb(existingMeters = null) {
  const inserts = [];
  const { db } = fakeDb((q, params) => {
    const auth = activeAccount(q, 'admin');
    if (auth) return auth;
    if (/SELECT id FROM riders WHERE id = \?/.test(q)) return [[{ id: 3 }]];
    if (/SELECT branch_id FROM riders/.test(q)) return [[{ branch_id: 1 }]];
    if (/information_schema\.columns/.test(q)) {
      return [['rider_id', 'entry_date', 'start_meter', 'end_meter', 'distance', 'petrol_rate', 'fuel_cost', 'notes', 'branch_id'].map((c) => ({ COLUMN_NAME: c }))];
    }
    if (/WHERE rider_id = \? AND start_meter = \? AND end_meter = \?/.test(q)) {
      return [existingMeters && params[1] === existingMeters[0] && params[2] === existingMeters[1] ? [{ id: 483, entry_date: '2026-11-02' }] : []];
    }
    if (/INSERT INTO riders_fuel_history/.test(q)) { inserts.push(params); return [{ insertId: 485 }]; }
    return undefined;
  });
  return { db, inserts };
}

const post = (db, body) => {
  clearAccountStatusCache();
  return request(riders, '/api/riders', db, { method: 'POST', path: '/api/riders/3/fuel-history', user: admin, body });
};
const entry = { entryDate: '2026-11-02T23:30', startMeter: '3965', endMeter: '4022', distance: 57, petrolRate: 379.34 };

test('a fuel entry without a date is refused', async () => {
  const { db, inserts } = fuelDb();
  const res = await post(db, { ...entry, entryDate: '' });
  assert.equal(res.status, 400);
  assert.equal(inserts.length, 0);
});

test('a petrol rate with a missed decimal point is refused', async () => {
  const { db, inserts } = fuelDb();
  const res = await post(db, { ...entry, petrolRate: 34288 });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /Petrol rate/);
  assert.equal(inserts.length, 0);
});

test('the same meter readings for the same rider are not saved twice', async () => {
  const { db, inserts } = fuelDb(['3965', '4022']);
  const res = await post(db, entry);
  assert.equal(res.status, 409);
  assert.equal(inserts.length, 0);
});

test('an end meter below the start meter is refused', async () => {
  const { db } = fuelDb();
  const res = await post(db, { ...entry, startMeter: '4022', endMeter: '3965' });
  assert.equal(res.status, 400);
});

test('a good entry is saved with its day', async () => {
  const { db, inserts } = fuelDb();
  const res = await post(db, entry);
  assert.equal(res.status, 201);
  assert.equal(inserts.length, 1);
  assert.ok(inserts[0].includes('2026-11-02'));
});
