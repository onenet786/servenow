const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { fakeDb, activeAccount, request } = require('./helpers');
const { clearAccountStatusCache } = require('../middleware/auth');
const hr = require('../routes/hr');
const { classify } = require('../middleware/branchGuard');
const { unknownRights } = require('../utils/rightsCatalog');

test.beforeEach(() => clearAccountStatusCache());

const staff = { id: 3, user_type: 'standard_user', email: 's@servenow.pk' };
const admin = { id: 1, user_type: 'admin', email: 'admin@servenow.com' };
const employee = { id: 9, branch_id: 1, user_id: 3, rider_id: null, name: 'Sana', is_active: 1, monthly_salary: 30000, weekly_off: null };
const jpeg = () => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4000, 7)]).toString('base64')}`;
const PHOTOS = path.join(__dirname, '..', 'private_uploads', 'attendance');
const here = { latitude: 30.4686, longitude: 70.9661, accuracy: 12 };

function markDb({ type = 'standard_user', record = null, open = null, person = employee } = {}) {
  return fakeDb((q) => {
    const a = activeAccount(q, type);
    if (a) return a;
    if (/FROM employees WHERE/.test(q)) return [person ? [person] : []];
    if (/check_out_at IS NULL\s+AND check_in_at >= NOW/.test(q)) return [open ? [open] : []];
    if (/SELECT \* FROM attendance WHERE employee_id = \? AND work_date/.test(q)) return [record ? [record] : []];
    if (/TIMESTAMPDIFF/.test(q)) return [[{ seconds: 3600 }]];
    if (/^\s*(UPDATE|INSERT)/.test(q)) return [{ affectedRows: 1, insertId: 1 }];
    return undefined;
  });
}

const mark = (database, body, { user = staff, ua } = {}) => request(hr, '/api/hr', database, {
  method: 'POST', path: '/api/hr/attendance/mark', user, body, headers: ua ? { 'user-agent': ua } : {},
});

const PHONE = 'Mozilla/5.0 (Linux; Android 12) Chrome/120 Mobile Safari/537.36';
const PC = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36';

test.after(() => fs.rmSync(PHOTOS, { recursive: true, force: true }));

test('payroll: a full month pays the full salary', () => {
  const days = Array.from({ length: 31 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, status: 'present' }));
  const f = hr.monthFigures(employee, days, '2026-10', { today: '2026-11-02' });
  assert.equal(f.present, 31);
  assert.equal(f.absent, 0);
  assert.equal(f.net, 30000);
});

test('payroll: each day missed costs one day of the month', () => {
  const days = Array.from({ length: 29 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, status: 'present' }));
  const f = hr.monthFigures(employee, days, '2026-10', { today: '2026-11-02' });
  assert.equal(f.absent, 2);
  assert.equal(f.absence_deduction, 1935.48);
  assert.equal(f.net, 28064.52);
});

test('payroll: weekly off and leave are paid, bonus and deduction apply', () => {
  const person = { ...employee, weekly_off: 0 };
  const sundays = ['04', '11', '18', '25'];
  const days = [];
  for (let i = 1; i <= 31; i += 1) {
    const d = String(i).padStart(2, '0');
    if (!sundays.includes(d)) days.push({ date: `2026-10-${d}`, status: i === 5 ? 'leave' : 'present' });
  }
  const f = hr.monthFigures(person, days, '2026-10', { bonus: 1000, deduction: 500, today: '2026-11-02' });
  assert.equal(f.off, 4);
  assert.equal(f.leave, 1);
  assert.equal(f.absent, 0);
  assert.equal(f.net, 30500);
});

test('payroll: a person who joined mid-month is paid from that day', () => {
  const days = Array.from({ length: 16 }, (_, i) => ({ date: `2026-10-${String(i + 16).padStart(2, '0')}`, status: 'present' }));
  const f = hr.monthFigures({ ...employee, joined_on: '2026-10-16' }, days, '2026-10', { today: '2026-11-02' });
  assert.equal(f.not_joined, 15);
  assert.equal(f.absent, 0);
  assert.equal(f.net, 15483.87);
});

test('payroll: days still to come are not counted as absent', () => {
  const f = hr.monthFigures(employee, [{ date: '2026-11-01', status: 'present' }], '2026-11', { today: '2026-11-02' });
  assert.equal(f.absent, 1);
  assert.equal(f.net, 29000);
});

test('payroll: net pay never goes below zero', () => {
  assert.equal(hr.monthFigures(employee, [], '2026-10', { deduction: 5000, today: '2026-11-02' }).net, 0);
});

test('attendance: a phone must send its location', async () => {
  const { status, body } = await mark(markDb().db, { photo: jpeg(), source: 'phone' });
  assert.equal(status, 400);
  assert.match(body.message, /location/i);
});

test('attendance: a phone cannot pretend to be a PC to skip location', async () => {
  const { status } = await mark(markDb().db, { photo: jpeg(), source: 'pc' }, { ua: PHONE });
  assert.equal(status, 400);
});

test('attendance: a phone with location checks in and the location is saved', async () => {
  const { db, log } = markDb();
  const { status, body } = await mark(db, { photo: jpeg(), source: 'phone', ...here }, { ua: PHONE });
  assert.equal(status, 200);
  assert.equal(body.action, 'in');
  assert.ok(log.some((q) => /INSERT INTO attendance/.test(q) && /check_in_latitude/.test(q)));
});

test('attendance: a PC webcam needs no location', async () => {
  const { status, body } = await mark(markDb().db, { photo: jpeg(), source: 'pc' }, { ua: PC });
  assert.equal(status, 200);
  assert.equal(body.action, 'in');
});

test('attendance: the second mark checks out', async () => {
  const { status, body } = await mark(markDb({ open: { id: 5, check_in_at: new Date(Date.now() - 3600000) } }).db, { photo: jpeg(), source: 'pc' }, { ua: PC });
  assert.equal(status, 200);
  assert.equal(body.action, 'out');
});

test('attendance: checking out then marking again comes back, and keeps the trip', async () => {
  const when = new Date(Date.now() - 3600000);
  const { db, log } = markDb({ record: { id: 5, check_in_at: when, check_out_at: when, check_out_reason: 'bank' } });
  const { status, body } = await mark(db, { photo: jpeg(), source: 'pc' }, { ua: PC });
  assert.equal(status, 200);
  assert.equal(body.action, 'back');
  assert.ok(log.some((q) => /INSERT INTO attendance_trips/.test(q)));
  assert.ok(log.some((q) => /UPDATE attendance SET check_out_at = NULL/.test(q)));
});

test('attendance: no reason from an older app means going home', async () => {
  const { body } = await mark(markDb({ open: { id: 5, check_in_at: new Date(Date.now() - 3600000) } }).db, { photo: jpeg(), source: 'pc' }, { ua: PC });
  assert.equal(body.reason, 'home');
});

test('attendance: a named reason is kept', async () => {
  const { body } = await mark(markDb({ open: { id: 5, check_in_at: new Date(Date.now() - 3600000) } }).db, { photo: jpeg(), source: 'pc', reason: 'bank' }, { ua: PC });
  assert.equal(body.reason, 'bank');
  assert.match(body.message, /Bank Work/);
});

test('attendance: a photo is required and must be a real JPEG', async () => {
  for (const photo of [undefined, 'hello', 'data:image/png;base64,AAAA', `data:image/jpeg;base64,${Buffer.alloc(4000, 1).toString('base64')}`, 'data:image/jpeg;base64,/9j/4AAQ']) {
    assert.equal((await mark(markDb().db, { photo, source: 'pc' }, { ua: PC })).status, 400);
  }
});

test('attendance: someone not on the staff list cannot mark', async () => {
  const { status } = await mark(markDb({ person: null }).db, { photo: jpeg(), source: 'pc' }, { ua: PC });
  assert.equal(status, 403);
});

test('attendance: a rider marks with their own rider record', async () => {
  const { db, log } = markDb({ type: 'rider', person: { ...employee, user_id: null, rider_id: 7 } });
  const { status } = await mark(db, { photo: jpeg(), source: 'phone', ...here }, { user: { id: 7, user_type: 'rider', email: 'r@x.pk' }, ua: PHONE });
  assert.equal(status, 200);
  assert.ok(log.some((q) => /FROM employees WHERE rider_id = \?/.test(q)));
});

const hrGet = (database, url, user) => request(hr, '/api/hr', database, { path: url, user });

test('rights: staff without the HR right see nothing', async () => {
  for (const url of ['/api/hr/employees', '/api/hr/attendance', '/api/hr/payroll', '/api/hr/attendance/1/photo/in']) {
    clearAccountStatusCache();
    const { db } = fakeDb((q) => activeAccount(q, 'standard_user') || (/user_permissions/.test(q) ? [[]] : undefined));
    assert.equal((await hrGet(db, url, staff)).status, 403, url);
  }
});

test('rights: customers, store owners and riders cannot open the HR screens', async () => {
  for (const type of ['customer', 'store_owner', 'rider']) {
    clearAccountStatusCache();
    const { db } = fakeDb((q) => activeAccount(q, type) || undefined);
    assert.equal((await hrGet(db, '/api/hr/payroll', { id: 4, user_type: type, email: 'x@x.pk' })).status, 403, type);
  }
});

test('rights: attendance staff do not see salaries', async () => {
  const { db } = fakeDb((q, p) => {
    const a = activeAccount(q, 'standard_user');
    if (a) return a;
    if (/user_permissions|permission_group/.test(q)) return p.flat().includes('menu_hr') ? [[{ 1: 1 }]] : [[]];
    if (/FROM employees e LEFT JOIN branches/.test(q)) return [[{ ...employee }]];
    return undefined;
  });
  const { status, body } = await hrGet(db, '/api/hr/employees', staff);
  assert.equal(status, 200);
  assert.equal(body.can_see_pay, false);
  assert.equal(body.employees[0].monthly_salary, undefined);
  assert.equal(body.employees[0].name, 'Sana');
});

test('a salary voucher is a draft on 5100 and touches no wallet', async () => {
  const inserted = [];
  const conn = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    execute: async (q, p) => {
      inserted.push([q, p]);
      if (/FOR UPDATE/.test(q)) return [[{ voucher_id: null, status: null }]];
      return [{ insertId: 77, affectedRows: 1 }];
    },
  };
  const { db } = fakeDb((q) => {
    const a = activeAccount(q, 'admin');
    if (a) return a;
    if (/SELECT \* FROM employees WHERE id = \?/.test(q)) return [[employee]];
    if (/FROM employees e\s+LEFT JOIN payroll_lines/.test(q)) return [[{ ...employee, bonus: 0, deduction: 0 }]];
    if (/FROM attendance/.test(q)) return [Array.from({ length: 31 }, (_, i) => ({ employee_id: 9, date: `2026-10-${String(i + 1).padStart(2, '0')}`, status: 'present' }))];
    return undefined;
  });
  db.getConnection = async () => conn;
  const { status } = await request(hr, '/api/hr', db, { method: 'POST', path: '/api/hr/payroll/9/voucher', user: admin, body: { month: '2026-10' } });
  assert.equal(status, 201);
  const [sql, params] = inserted.find(([q]) => /INSERT INTO cash_payment_vouchers/.test(q));
  assert.match(sql, /'draft'/);
  assert.equal(params[3], 'employee');
  assert.equal(params[4], null);
  assert.equal(params[5], 30000);
  assert.equal(params[params.length - 1], '5100');
  assert.ok(!inserted.some(([q]) => /wallet/i.test(q)));
});

test('photos are outside anything the web server serves', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(!/express\.static\(path\.join\(__dirname, "private_uploads"/.test(server));
  assert.ok(!/express\.static\(__dirname\)/.test(server));
});

test('branch accounts may reach HR, whose routes cut to their branch', () => {
  assert.deepEqual(classify('GET', '/api/hr/attendance'), { allow: true });
});

test('the HR rights exist', () => {
  assert.deepEqual(unknownRights(['menu_hr', 'menu_hr_payroll']), []);
});
