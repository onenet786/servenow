// Going Home ends the day, shifts, month-end payroll and the incentive agreed at enrolment.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { fakeDb, activeAccount, request } = require('./helpers');
const { clearAccountStatusCache } = require('../middleware/auth');
const hr = require('../routes/hr');

test.beforeEach(() => clearAccountStatusCache());
// Test files run side by side and share the photo folder, so these tests write no photos at all.
fs.promises.mkdir = async () => {};
fs.promises.writeFile = async () => {};

const staff = { id: 3, user_type: 'standard_user', email: 's@servenow.pk' };
const admin = { id: 1, user_type: 'admin', email: 'admin@servenow.com' };
const employee = { id: 9, branch_id: 1, user_id: 3, rider_id: null, name: 'Sana', is_active: 1, monthly_salary: 31000, weekly_off: 0, joined_on: null };
const jpeg = () => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4000, 7)]).toString('base64')}`;
const PC = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36';
const MORNING = { id: 2, name: 'Morning', start_time: '09:00:00', end_time: '17:00:00', grace_minutes: 10, is_active: 1 };

function markDb({ record = null, open = null, person = employee, shift = MORNING } = {}) {
  return fakeDb((q) => {
    const a = activeAccount(q, 'standard_user');
    if (a) return a;
    if (/FROM employees WHERE/.test(q)) return [[person]];
    if (/FROM shifts WHERE id/.test(q)) return [[shift]];
    if (/check_out_at IS NULL\s+AND check_in_at >= NOW/.test(q)) return [open ? [open] : []];
    if (/SELECT \* FROM attendance WHERE employee_id = \? AND work_date/.test(q)) return [record ? [record] : []];
    if (/TIMESTAMPDIFF/.test(q)) return [[{ seconds: 3600 }]];
    if (/^\s*(UPDATE|INSERT)/.test(q)) return [{ affectedRows: 1, insertId: 1 }];
    return undefined;
  });
}
const mark = (db, body = {}) => request(hr, '/api/hr', db, {
  method: 'POST', path: '/api/hr/attendance/mark', user: staff, body: { photo: jpeg(), source: 'pc', ...body }, headers: { 'user-agent': PC },
});
const earlier = new Date(Date.now() - 3 * 3600000);

test('going home ends the day: no check in again', async () => {
  for (const reason of ['home', null]) {
    const { db, log } = markDb({ record: { id: 5, check_in_at: earlier, check_out_at: earlier, check_out_reason: reason } });
    const { status, body } = await mark(db);
    assert.equal(status, 409);
    assert.match(body.message, /duty for today is complete/);
    assert.ok(!log.some((q) => /INSERT INTO attendance_trips/.test(q)));
  }
});

test('out on work still comes back, and a day HR reopened does too', async () => {
  for (const reason of ['bank', 'reopened']) {
    const { db } = markDb({ record: { id: 5, check_in_at: earlier, check_out_at: earlier, check_out_reason: reason } });
    assert.equal((await mark(db)).body.action, 'back');
  }
});

test('/me tells the app and the website the day is done', async () => {
  const { db } = markDb({ record: { id: 5, check_in_at: earlier, check_out_at: earlier, check_out_reason: 'home' } });
  const { body } = await request(hr, '/api/hr', db, { method: 'GET', path: '/api/hr/me', user: staff });
  assert.equal(body.next_action, 'done');
});

test('HR can reopen today only, with a reason', async () => {
  const run = (date, note = 'Pressed by mistake') => {
    const { db, log } = fakeDb((q) => {
      const a = activeAccount(q, 'admin');
      if (a) return a;
      if (/SELECT \* FROM employees WHERE id/.test(q)) return [[employee]];
      return undefined;
    });
    return request(hr, '/api/hr', db, { method: 'PUT', path: '/api/hr/attendance', user: admin, body: { employee_id: 9, date, status: 'reopen', note } }).then((res) => ({ ...res, log }));
  };
  const today = hr.hr.ymdIn();
  const done = await run(today);
  assert.equal(done.status, 200);
  assert.ok(done.log.some((q) => /check_out_reason = \?/.test(q)));
  assert.equal((await run('2026-10-01')).status, 400);
  assert.equal((await run(today, '')).status, 400);
});

test('check in saves the shift of that day', async () => {
  const { db, log } = markDb({ person: { ...employee, shift_id: 2 } });
  const { status } = await mark(db);
  assert.equal(status, 200);
  assert.ok(log.some((q) => /INSERT INTO attendance/.test(q) && /shift_name/.test(q) && /late_minutes/.test(q)));
});

test('late and early follow the clock, also past midnight', () => {
  const at = (h, m = 0) => h * 60 + m;
  assert.equal(hr.lateBy(MORNING, at(9, 5)), 0, 'inside the grace');
  assert.equal(hr.lateBy(MORNING, at(9, 25)), 15);
  assert.equal(hr.lateBy(MORNING, at(8, 30)), 0, 'early arrival');
  assert.equal(hr.earlyBy('17:00:00', at(16, 30)), 30);
  assert.equal(hr.earlyBy('17:00:00', at(18)), 0);
  const night = { start_time: '22:00:00', end_time: '06:00:00', grace_minutes: 0 };
  assert.equal(hr.lateBy(night, at(0, 15)), 135);
  assert.equal(hr.earlyBy('06:00:00', at(5, 30)), 30);
  assert.equal(hr.shiftLength('22:00', '06:00'), 480);
  assert.equal(hr.shiftLength('09:00', '17:30'), 510);
});

const day = (date, extra = {}) => ({ date, status: 'present', checked_in: 1, span: 480, away: 0, late_minutes: 0, early_minutes: 0, ...extra });
const october = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
const onShift = { ...employee, shift_name: 'Morning', shift_start: '09:00:00', shift_end: '17:00:00' };
const OPTS = { today: '2026-11-02' };

test('the month reconciles days and hours', () => {
  // October 2026 has 4 Sundays, so 27 working days.
  const sundays = new Set(['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25']);
  const records = october.filter((d) => !sundays.has(d)).slice(0, 25).map((d) => day(d));
  records[0] = day(records[0].date, { late_minutes: 20, span: 460 });
  records[1] = day(records[1].date, { span: 500, away: 60 });
  records[2] = day(records[2].date, { span: null });
  const f = hr.monthFigures(onShift, records, '2026-10', OPTS);
  assert.equal(f.days_in_month, 31);
  assert.equal(f.working_days, 27);
  assert.equal(f.present, 25);
  assert.equal(f.absent, 2);
  assert.equal(f.off, 4);
  assert.equal(f.required_minutes, 27 * 480);
  assert.equal(f.worked_minutes, 22 * 480 + 460 + 440 + 0);
  assert.equal(f.late_days, 1);
  assert.equal(f.missed_checkouts, 1);
  assert.equal(f.short_minutes, 20 + 40 + 480);
  assert.equal(f.absence_deduction, 2000);
  assert.equal(f.net, 29000);
});

test('a day HR entered by hand counts as the full shift', () => {
  const f = hr.monthFigures(onShift, [{ date: '2026-10-01', status: 'present' }], '2026-10', OPTS);
  assert.equal(f.worked_minutes, 480);
  assert.equal(f.short_minutes, 0);
});

test('each incentive pays as agreed at enrolment', () => {
  const worked = ['2026-10-01', '2026-10-02'].map((d) => day(d));
  const paid = (incentive_type, options = {}, records = worked) => hr.monthFigures({ ...employee, incentive_type, incentive_amount: 500 }, records, '2026-10', { ...OPTS, ...options }).incentive;
  assert.equal(paid('none'), 0);
  assert.equal(paid('monthly'), 500);
  assert.equal(paid('per_day'), 1000);
  assert.equal(paid('per_delivery', { deliveries: 7 }), 3500);
  assert.equal(paid('full_attendance'), 0, 'absent days');
  assert.equal(paid('full_attendance', { today: '2026-10-01' }, [day('2026-10-01')]), 500);
});

test('incentive joins the net pay', () => {
  const records = october.map((d) => day(d));
  const f = hr.monthFigures({ ...employee, incentive_type: 'monthly', incentive_amount: 2000 }, records, '2026-10', { ...OPTS, bonus: 100, deduction: 50 });
  assert.equal(f.net, 31000 + 2000 + 100 - 50);
});

test('payroll vouchers wait for the last day of the month', async () => {
  const month = hr.hr.ymdIn().slice(0, 7);
  const last = hr.hr.daysOf(month).pop().date;
  if (hr.hr.ymdIn() === last) return; // nothing to refuse on the last day itself
  const { db } = fakeDb((q) => {
    const a = activeAccount(q, 'admin');
    if (a) return a;
    if (/SELECT \* FROM employees WHERE id = \?/.test(q)) return [[employee]];
    if (/FROM employees e\s+LEFT JOIN shifts/.test(q)) return [[{ ...employee, bonus: 0, deduction: 0 }]];
    return undefined;
  });
  const { status, body } = await request(hr, '/api/hr', db, { method: 'POST', path: '/api/hr/payroll/9/voucher', user: admin, body: { month } });
  assert.equal(status, 409);
  assert.ok(body.message.includes(last));
});

test('shift times are checked, and overnight is allowed', async () => {
  const add = (body) => {
    const { db } = fakeDb((q) => activeAccount(q, 'admin') || (/FROM branches/.test(q) ? [[{ id: 1, is_active: 1 }]] : undefined));
    return request(hr, '/api/hr', db, { method: 'POST', path: '/api/hr/shifts', user: { ...admin, branch_id: 1 }, body: { branch_id: 1, ...body } });
  };
  assert.equal((await add({ name: '', start_time: '09:00', end_time: '17:00' })).status, 400);
  assert.equal((await add({ name: 'Bad', start_time: '25:00', end_time: '17:00' })).status, 400);
  assert.equal((await add({ name: 'Same', start_time: '09:00', end_time: '09:00' })).status, 400);
  assert.equal((await add({ name: 'Grace', start_time: '09:00', end_time: '17:00', grace_minutes: 500 })).status, 400);
  assert.equal((await add({ name: 'Night', start_time: '22:00', end_time: '06:00' })).status, 201);
});

test('staff without the payroll right cannot set an incentive or see one', async () => {
  const { db } = fakeDb((q, p) => {
    const a = activeAccount(q, 'standard_user');
    if (a) return a;
    if (/user_permissions|permission_group/.test(q)) return [(p || []).flat().includes('menu_hr') ? [{ 1: 1 }] : []];
    if (/FROM employees e LEFT JOIN branches/.test(q)) return [[{ ...employee, incentive_type: 'monthly', incentive_amount: 500 }]];
    return undefined;
  });
  const { body } = await request(hr, '/api/hr', db, { method: 'GET', path: '/api/hr/employees', user: staff });
  assert.ok(body.employees);
  assert.equal(body.employees[0].incentive_amount, undefined);
  assert.equal(body.employees[0].incentive_type, undefined);
});

test('several incentives are each checked and all that are earned are paid together', () => {
  const every = october.map((d) => day(d)); // worked all 31 days, Sundays too
  const list = [
    { type: 'monthly', amount: 1000 },
    { type: 'full_attendance', amount: 500 },
    { type: 'no_day_off', amount: 700 },
    { type: 'top_deliveries', amount: 2000 },
    { type: 'per_delivery', amount: 10 },
  ];
  const f = hr.monthFigures({ ...employee, incentives: JSON.stringify(list) }, every, '2026-10', { ...OPTS, deliveries: 300, topPerformer: true });
  assert.equal(f.incentive, 1000 + 500 + 700 + 2000 + 3000);
  assert.deepEqual(f.incentive_lines.map((l) => l.earned), [1000, 500, 700, 2000, 3000]);
});

test('no day off is lost by one weekly off or one leave; best performer needs the top spot', () => {
  const sundays = new Set(['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25']);
  const list = JSON.stringify([{ type: 'no_day_off', amount: 700 }, { type: 'top_deliveries', amount: 2000 }]);
  const restOnSundays = october.filter((d) => !sundays.has(d)).map((d) => day(d));
  let f = hr.monthFigures({ ...employee, incentives: list }, restOnSundays, '2026-10', { ...OPTS, deliveries: 120, topPerformer: false });
  assert.equal(f.incentive, 0, 'rested on Sundays and was not the top rider');
  const oneLeave = october.map((d) => (d === '2026-10-15' ? { date: d, status: 'leave' } : day(d)));
  f = hr.monthFigures({ ...employee, incentives: list }, oneLeave, '2026-10', { ...OPTS, deliveries: 120, topPerformer: true });
  assert.equal(f.incentive, 2000, 'top rider, but took a leave day');
});

test('the old single incentive still counts when no list is saved', () => {
  const f = hr.monthFigures({ ...employee, incentive_type: 'monthly', incentive_amount: 800 }, [day('2026-10-01')], '2026-10', OPTS);
  assert.equal(f.incentive, 800);
  assert.equal(f.incentive_lines.length, 1);
});
