const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { fakeDb, activeAccount, request } = require('./helpers');
const { clearAccountStatusCache } = require('../middleware/auth');
const hr = require('../routes/hr');

test.beforeEach(() => clearAccountStatusCache());
test.after(() => fs.rmSync(path.join(__dirname, '..', 'private_uploads', 'attendance'), { recursive: true, force: true }));

const KEY = 'b'.repeat(64);
const HASH = crypto.createHash('sha256').update(KEY).digest('hex');
const jpeg = () => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4000, 7)]).toString('base64')}`;
const face = (seed, shift = 0) => Array.from({ length: 128 }, (_, i) => Math.sin(seed * (i + 1)) * 0.2 + (i === 0 ? shift : 0));
const row = (employeeId, descriptor) => ({ employee_id: employeeId, descriptor: JSON.stringify(descriptor) });

const A = face(1);
const B = face(2);

test('face: the closest enrolled person is found', () => {
  const found = hr.matchFace(face(1, 0.1), [row(1, A), row(2, B)]);
  assert.equal(found.employee_id, 1);
});

test('face: someone not enrolled is not given a name', () => {
  assert.equal(hr.matchFace(face(3), [row(1, A), row(2, B)]), null);
});

test('face: too close to call between two people gives no name', () => {
  assert.equal(hr.matchFace(face(1, 0.3), [row(1, face(1, 0.1)), row(2, face(1, 0.12))]), null);
});

test('face: several samples of one person are one person, not a tie', () => {
  assert.equal(hr.matchFace(A, [row(1, A), row(1, face(1, 0.01)), row(2, B)]).employee_id, 1);
});

test('face: nobody enrolled gives no name', () => {
  assert.equal(hr.matchFace(A, []), null);
});

function kioskDb({ faces = [row(9, A)], enrolled = true } = {}) {
  return fakeDb((q, p) => {
    if (/FROM kiosk_devices k LEFT JOIN branches/.test(q)) return p[0] === HASH ? [[{ id: 1, branch_id: 1, branch_name: 'Kot Addu' }]] : [[]];
    if (/UPDATE kiosk_devices/.test(q)) return [{ affectedRows: 1 }];
    if (/SELECT f\.employee_id, f\.descriptor FROM employee_faces f JOIN employees e/.test(q)) return [faces];
    if (/FROM employees e\s+LEFT JOIN attendance/.test(q)) return [[{ id: 9, name: 'Sana', designation: null, face: 1, check_in_at: null, check_out_at: null }]];
    if (/SELECT \* FROM employees WHERE id = \? AND branch_id = \?/.test(q)) return [[{ id: p[0], branch_id: 1, name: 'Sana', is_active: 1 }]];
    if (/SELECT 1 FROM employee_faces WHERE employee_id/.test(q)) return [enrolled ? [{ 1: 1 }] : []];
    if (/check_out_at IS NULL\s+AND check_in_at >= NOW/.test(q)) return [[]];
    if (/SELECT \* FROM attendance WHERE employee_id/.test(q)) return [[]];
    if (/^\s*(UPDATE|INSERT)/.test(q)) return [{ affectedRows: 1, insertId: 1 }];
    return undefined;
  });
}

const screen = (database, url, body) => request(hr, '/api/hr', database, {
  method: 'POST', path: `/api/hr/kiosk/screen${url}`, body, headers: { 'x-kiosk-key': KEY },
});

test('kiosk: a known face comes back with a pass, and no face data', async () => {
  const { status, body } = await screen(kioskDb().db, '/identify', { descriptor: A });
  assert.equal(status, 200);
  assert.equal(body.match.name, 'Sana');
  assert.ok(body.match.pass);
  assert.ok(!/descriptor/.test(JSON.stringify(body)));
});

test('kiosk: an unknown face gets nothing', async () => {
  const { body } = await screen(kioskDb().db, '/identify', { descriptor: B });
  assert.equal(body.match, null);
});

test('kiosk: a bad descriptor is refused', async () => {
  for (const descriptor of [undefined, [], 'x', Array(128).fill('a'), Array(127).fill(0), Array(128).fill(99)]) {
    assert.equal((await screen(kioskDb().db, '/identify', { descriptor })).status, 400);
  }
});

test('kiosk: an enrolled person cannot be marked by tapping their name', async () => {
  const { status, body } = await screen(kioskDb().db, '/mark', { employee_id: 9, photo: jpeg() });
  assert.equal(status, 403);
  assert.match(body.message, /camera/);
});

test('kiosk: an enrolled person is marked with the pass from their face', async () => {
  const { body: seen } = await screen(kioskDb().db, '/identify', { descriptor: A });
  const { status, body } = await screen(kioskDb().db, '/mark', { employee_id: 9, photo: jpeg(), pass: seen.match.pass });
  assert.equal(status, 200);
  assert.equal(body.action, 'in');
});

test('kiosk: a pass is for one person only', async () => {
  const { body: seen } = await screen(kioskDb().db, '/identify', { descriptor: A });
  assert.equal((await screen(kioskDb().db, '/mark', { employee_id: 10, photo: jpeg(), pass: seen.match.pass })).status, 403);
});

test('kiosk: a forged or expired pass is refused', async () => {
  for (const pass of ['1.abc', 'x', `${Math.floor(Date.now() / 1000) + 60}.${'0'.repeat(64)}`]) {
    assert.equal((await screen(kioskDb().db, '/mark', { employee_id: 9, photo: jpeg(), pass })).status, 403);
  }
});

test('kiosk: someone not enrolled can still tap their name', async () => {
  assert.equal((await screen(kioskDb({ enrolled: false }).db, '/mark', { employee_id: 9, photo: jpeg() })).status, 200);
});

const admin = { id: 1, user_type: 'admin', email: 'a@x.pk' };

function enrolDb({ others = [] } = {}) {
  return fakeDb((q) => {
    const a = activeAccount(q, 'admin');
    if (a) return a;
    if (/SELECT \* FROM employees WHERE id = \?/.test(q)) return [[{ id: 9, branch_id: 1, name: 'Sana', is_active: 1 }]];
    if (/FROM employee_faces f JOIN employees e ON e\.id = f\.employee_id WHERE f\.employee_id <> \?/.test(q)) return [others];
    if (/^\s*(DELETE|INSERT)/.test(q)) return [{ affectedRows: 1 }];
    return undefined;
  });
}

const enrol = (database, descriptors) => request(hr, '/api/hr', database, { method: 'POST', path: '/api/hr/employees/9/face', user: admin, body: { descriptors } });

test('enrol: samples are saved and replace the old ones', async () => {
  const { db, log } = enrolDb();
  const { status } = await enrol(db, [A, A, A, A, A]);
  assert.equal(status, 201);
  assert.ok(log.some((q) => /DELETE FROM employee_faces/.test(q)));
  assert.equal(log.filter((q) => /INSERT INTO employee_faces/.test(q)).length, 5);
});

test('enrol: too few samples are refused', async () => {
  assert.equal((await enrol(enrolDb().db, [A])).status, 400);
});

test('enrol: one face cannot be enrolled under two names', async () => {
  const { status, body } = await enrol(enrolDb({ others: [{ ...row(4, A), name: 'Bilal' }] }).db, [A, A, A]);
  assert.equal(status, 409);
  assert.match(body.message, /Bilal/);
});

test('enrol: staff without the HR right cannot enrol or read', async () => {
  const { db } = fakeDb((q) => activeAccount(q, 'standard_user') || (/user_permissions/.test(q) ? [[]] : undefined));
  const staff = { id: 3, user_type: 'standard_user', email: 's@x.pk' };
  assert.equal((await request(hr, '/api/hr', db, { method: 'POST', path: '/api/hr/employees/9/face', user: staff, body: { descriptors: [A, A, A] } })).status, 403);
});

test('face data leaves with the person', async () => {
  const { db, log } = fakeDb((q) => {
    const a = activeAccount(q, 'admin');
    if (a) return a;
    if (/SELECT \* FROM employees WHERE id = \?/.test(q)) return [[{ id: 9, branch_id: 1, name: 'Sana', is_active: 1, monthly_salary: 0 }]];
    if (/^\s*(DELETE|UPDATE)/.test(q)) return [{ affectedRows: 1 }];
    return undefined;
  });
  const { status } = await request(hr, '/api/hr', db, { method: 'PUT', path: '/api/hr/employees/9', user: admin, body: { name: 'Sana', is_active: false } });
  assert.equal(status, 200);
  assert.ok(log.some((q) => /DELETE FROM employee_faces/.test(q)));
});
