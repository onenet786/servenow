const test = require('node:test');
const assert = require('node:assert');
const { fakeDb, activeAccount } = require('./helpers');
const { clearAccountStatusCache } = require('../middleware/auth');
const ai = require('../services/aiagent');
const { shapeHrReport, clock } = require('../services/assistantHr');

test.beforeEach(() => clearAccountStatusCache());

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
const owner = { id: 1, type: 'admin', name: 'Owner', branch_id: null };

// Rows as the attendance screen sends them (times as the driver gives them: real instants).
const dayRows = () => [
  { employee_id: 7, name: 'Ali Raza', designation: 'Rider', day_status: 'present', check_in_at: '2026-11-02T04:05:00.000Z', check_out_at: null, check_out_reason: null, trips: [] },
  {
    employee_id: 8, name: 'Sana Khan', designation: 'Accounts', day_status: 'present', check_in_at: '2026-11-02T03:58:00.000Z', check_out_at: '2026-11-02T08:10:00.000Z',
    check_out_reason: 'Bank Work', trips: [{ reason: 'Lunch or Namaz', out_at: '2026-11-02T07:00:00.000Z', back_at: '2026-11-02T07:40:00.000Z' }],
  },
  { employee_id: 9, name: 'Usman Ali', designation: 'Cook', day_status: 'present', check_in_at: '2026-11-02T04:00:00.000Z', check_out_at: '2026-11-02T13:00:00.000Z', check_out_reason: 'Going Home', trips: [] },
  { employee_id: 10, name: 'Hina Bibi', designation: 'Cleaner', day_status: 'not_marked', check_in_at: null, check_out_at: null, trips: [] },
  { employee_id: 11, name: 'Bilal Ahmed', designation: 'Rider', day_status: 'leave', check_in_at: null, check_out_at: null, trips: [] },
];

test('hr replies: times are Pakistan time, not UTC', () => {
  assert.equal(clock('2026-11-02T04:05:00.000Z'), '9:05 AM');
  assert.equal(clock(new Date('2026-11-02T13:00:00.000Z')), '6:00 PM');
  assert.equal(clock(null), null);
});

test('hr replies: who is in, out on work and gone home today', () => {
  const r = shapeHrReport('attendance_day', { date: today(), summary: { employees: 5, present: 3, not_marked: 1, absent: 0, leave: 1, off: 0 }, attendance: dayRows() });
  const by = Object.fromEntries(r.attendance.map((x) => [x.name, x]));
  assert.equal(by['Ali Raza'].now, 'In (checked in)');
  assert.equal(by['Ali Raza'].checked_in, '9:05 AM');
  assert.equal(by['Sana Khan'].now, 'Out for Bank Work since 1:10 PM');
  assert.deepEqual(by['Sana Khan'].went_out, [{ reason: 'Lunch or Namaz', out: '12:00 PM', back: '12:40 PM' }]);
  assert.equal(by['Usman Ali'].now, 'Gone home');
  assert.equal(by['Hina Bibi'].status, 'Not marked yet');
  assert.equal(by['Bilal Ahmed'].now, 'On leave');
  assert.equal(r.summary.in_now, 1);
  assert.equal(r.summary.out_now, 1);
  assert.equal(r.summary.gone_home, 1);
  // A past day has no "now".
  const past = shapeHrReport('attendance_day', { date: '2026-10-01', summary: {}, attendance: dayRows() });
  assert.equal(past.attendance[0].now, undefined);
  assert.equal(past.summary.in_now, undefined);
});

test('hr replies: payroll hides the internal ids and says what was paid', () => {
  const r = shapeHrReport('payroll', {
    month: '2026-10',
    payroll: [{ employee_id: 7, name: 'Ali Raza', user_id: null, rider_id: 3, branch_id: 1, net: 29500, voucher_number: 'CPV-12', voucher_status: 'approved' }, { employee_id: 8, name: 'Sana', net: 40000 }],
    totals: { net: 69500 },
  }, { employeeId: 7 });
  assert.equal(r.payroll.length, 1);
  assert.equal(r.payroll[0].rider_id, undefined);
  assert.equal(r.payroll[0].paid, 'Voucher CPV-12 (approved)');
  assert.equal(r.totals, undefined);
});

// ------------------------------------------------------------- through the assistant, as staff ask

function hrDb(type = 'admin', extra = () => undefined) {
  return fakeDb((q, p) => {
    const a = activeAccount(q, type);
    if (a) return a;
    if (/SELECT id, email, user_type, first_name, last_name FROM users WHERE id = \?/.test(q)) {
      return [[{ id: p[0], email: 'x@servenow.pk', user_type: type, first_name: 'X', last_name: 'Y' }]];
    }
    if (/FROM branches/.test(q)) return [[{ id: 1, name: 'Kot Addu', city: 'Kot Addu', is_active: 1 }]];
    if (/SELECT id, name, designation FROM employees WHERE is_active = 1 AND name LIKE \?/.test(q)) {
      const all = [{ id: 7, name: 'Ali Raza', designation: 'Rider' }, { id: 12, name: 'Ali Hassan', designation: 'Cook' }];
      const text = String(p[0]).replace(/%/g, '').toLowerCase();
      return [all.filter((e) => e.name.toLowerCase().includes(text))];
    }
    if (/FROM employees e LEFT JOIN attendance a ON a.employee_id = e.id AND a.work_date = \?/.test(q)) {
      return [dayRows().map((r) => ({ ...r, id: r.employee_id * 10, status: r.day_status === 'not_marked' ? null : r.day_status, weekly_off: null }))];
    }
    return extra(q, p);
  });
}

const ask = (database, user, args) => ai.runTool(database, 'admin_report', args, user);

test('hr replies: one person by name, with Pakistan times', async () => {
  const { db } = hrDb();
  const r = await ask(db, owner, { report: 'attendance_day', employee: 'ali raza' });
  assert.equal(r.error, undefined, JSON.stringify(r));
  assert.equal(r.employee, 'Ali Raza');
  assert.equal(r.attendance.length, 1);
  assert.equal(r.attendance[0].checked_in, '9:05 AM');
  assert.equal(r.attendance[0].now, 'In (checked in)');
  assert.deepEqual(r.period, { date: today() });
});

test('hr replies: asks which person when a name matches several', async () => {
  const r = await ask(hrDb().db, owner, { report: 'attendance_day', employee: 'Ali' });
  assert.equal(r.error, 'choose');
  assert.equal(r.choices.length, 2);
});

test('hr replies: says which day a one-day report covers when a range was asked', async () => {
  const r = await ask(hrDb().db, owner, { report: 'attendance_day', period: 'last_7_days' });
  assert.deepEqual(r.period, { date: today() });
  assert.match(r.period_note, /one day/);
});

test('hr replies: staff without the HR right are refused', async () => {
  const { db } = hrDb('standard_user', (q) => (/user_permissions/.test(q) ? [[]] : undefined));
  const r = await ask(db, { id: 3, type: 'standard_user', name: 'Staff', branch_id: null }, { report: 'attendance_day' });
  assert.equal(r.error, 'not_permitted');
});

test('hr replies: an employee filter only on staff reports', async () => {
  const r = await ask(hrDb().db, owner, { report: 'daily_sale', employee: 'Ali' });
  assert.equal(r.error, 'no_filter');
});

// ------------------------------------------------------------- a rider asking about themselves

const rider = { id: 3, type: 'rider', name: 'Ali Raza', branch_id: 1 };
const employee = { id: 7, name: 'Ali Raza', designation: 'Rider', monthly_salary: '31000.00', weekly_off: 0, joined_on: null, rider_id: 3 };

// October 2026: Sundays (weekly off) 4, 11, 18, 25. Leave 5-6, absent 7, nothing on 8, present otherwise.
function octoberRecords() {
  const rows = [];
  for (let d = 1; d <= 31; d++) {
    const date = `2026-10-${String(d).padStart(2, '0')}`;
    if ([4, 11, 18, 25, 8].includes(d)) continue;
    rows.push({ date, status: d === 5 || d === 6 ? 'leave' : d === 7 ? 'absent' : 'present' });
  }
  return rows;
}

function riderDb({ onStaff = true, open = null } = {}) {
  return fakeDb((q, p) => {
    const a = activeAccount(q, 'rider', 1);
    if (a) return a;
    if (/FROM employees WHERE rider_id = \? AND is_active = 1/.test(q)) return [onStaff && p[0] === 3 ? [employee] : []];
    if (/FROM attendance WHERE employee_id = \? AND check_in_at IS NOT NULL AND check_out_at IS NULL/.test(q)) return [open ? [open] : []];
    if (/SELECT \* FROM attendance WHERE employee_id = \? AND work_date = \?/.test(q)) return [[]];
    if (/FROM attendance_trips WHERE attendance_id = \?/.test(q)) return [[{ reason: 'lunch', out_at: '2026-11-02T07:00:00.000Z', back_at: '2026-11-02T07:30:00.000Z' }]];
    if (/DATE_FORMAT\(work_date, '%Y-%m-%d'\) AS date, status FROM attendance WHERE employee_id = \?/.test(q)) return [octoberRecords()];
    if (/FROM payroll_lines p/.test(q)) return [[{ bonus: '500.00', deduction: '0.00', snapshot: null, voucher_id: null }]];
    return undefined;
  });
}

test('my attendance: a rider sees their own day and month, worked out like payroll', async () => {
  const { db } = riderDb({ open: { id: 70, status: 'present', check_in_at: '2026-11-02T04:05:00.000Z', check_out_at: null } });
  const r = await ai.runTool(db, 'my_attendance', { month: '2026-10' }, rider);
  assert.equal(r.error, undefined, JSON.stringify(r));
  assert.equal(r.today.checked_in, '9:05 AM');
  assert.equal(r.today.now, 'In (checked in)');
  assert.equal(r.today.next_step, 'Check out (choose why, if coming back)');
  assert.deepEqual(r.today.went_out, [{ reason: 'Lunch or Namaz', out: '12:00 PM', back: '12:30 PM' }]);
  assert.deepEqual(
    { present: r.month.present, absent: r.month.absent, leave: r.month.leave, off: r.month.weekly_off },
    { present: 23, absent: 2, leave: 2, off: 4 },
  );
  assert.deepEqual(r.month.absent_days, ['2026-10-07', '2026-10-08']);
  assert.deepEqual(r.month.leave_days, ['2026-10-05', '2026-10-06']);
  assert.equal(r.month.absence_deduction, 2000);
  assert.equal(r.month.net, 29500);
  assert.match(r.month.pay_status, /Not paid out yet/);
});

test('my attendance: not on the staff list, and not for customers', async () => {
  const r = await ai.runTool(riderDb({ onStaff: false }).db, 'my_attendance', {}, rider);
  assert.equal(r.error, 'not_on_staff_list');
  const c = await ai.runTool(riderDb().db, 'my_attendance', {}, { id: 9, type: 'customer', name: 'C', branch_id: 1 });
  assert.equal(c.error, 'not_permitted');
});

test('my attendance: is in the manifest for riders and staff', () => {
  const tool = ai.TOOLS.find((t) => t.name === 'my_attendance');
  assert.deepEqual(tool.who, ['rider', 'admin', 'standard_user']);
  const report = ai.TOOLS.find((t) => t.name === 'admin_report');
  assert.ok(report.inputSchema.properties.employee);
});
