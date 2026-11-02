// Attendance and payroll for the assistant.
//
// Two parts:
//   - shapeHrReport: tidies the HR screen's own answers (admin_report: attendance_day, attendance_month,
//     payroll) into what a person asks about: Karachi times instead of UTC, where each person is right
//     now, and one employee when a name is given.
//   - myAttendance (my_attendance tool): a rider or staff member's own day and month, with the salary
//     worked out the same way as the payroll screen. It needs no HR right: it only ever shows the asker.
const hrRouter = require('../routes/hr');

const { ensureTables, ymdIn, reasonLabel, daysOf, TIME_ZONE, OPEN_SHIFT_HOURS, HOME } = hrRouter.hr;
const HOME_LABEL = reasonLabel(HOME);

/** "9:05 AM" in Karachi, from a DATETIME (a Date from the driver, or text in tests). */
function clock(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' });
}

const STATUS = {
  present: 'Present',
  absent: 'Absent',
  leave: 'On leave (paid)',
  off: 'Weekly off',
  not_marked: 'Not marked yet',
  upcoming: 'Day still to come',
};

/** Where someone is now, from a day's record: only meaningful for today. */
function whereNow(row) {
  if (!row.check_in_at) return row.day_status === 'leave' ? 'On leave' : row.day_status === 'off' ? 'Weekly off' : 'Not in';
  if (!row.check_out_at) return 'In (checked in)';
  const reason = row.check_out_reason || HOME_LABEL;
  return reason === HOME_LABEL ? 'Gone home' : `Out for ${reason} since ${clock(row.check_out_at)}`;
}

const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** The one employee a name means (within the asker's branch), or a reply listing the choices. */
async function findEmployee(db, name, branchId) {
  await ensureTables(db);
  const text = String(name).trim();
  if (/^\d{1,10}$/.test(text)) return { id: Number(text) };
  const like = `%${text.replace(/[%_\\]/g, ' ').slice(0, 60)}%`;
  const [rows] = await db.execute(
    `SELECT id, name, designation FROM employees WHERE is_active = 1 AND name LIKE ?${branchId ? ' AND branch_id = ?' : ''} ORDER BY name LIMIT 8`,
    branchId ? [like, branchId] : [like]
  );
  const exact = rows.filter((r) => sameName(r.name, text));
  const found = exact.length === 1 ? exact : rows;
  if (found.length === 1) return { id: Number(found[0].id), name: found[0].name };
  if (!found.length) return { reply: { error: 'not_found', message: `Nobody called "${text.slice(0, 60)}" is on the staff list. Ask them to check the name.` } };
  return { reply: { error: 'choose', message: 'Several staff members match. Ask which one; send its id as the employee.', choices: found.map((r) => ({ id: r.id, name: r.name, designation: r.designation })) } };
}

/** The HR screen's answer for one report, shaped for a reply. `employeeId` keeps one person. */
function shapeHrReport(key, body, { employeeId = null, today = ymdIn() } = {}) {
  const keep = (rows) => (employeeId ? rows.filter((r) => Number(r.employee_id) === Number(employeeId)) : rows);

  if (key === 'attendance_day') {
    const isToday = body.date === today;
    const rows = keep(body.attendance || []).map((r) => ({
      employee_id: r.employee_id,
      name: r.name,
      designation: r.designation || undefined,
      status: STATUS[r.day_status] || r.day_status,
      checked_in: clock(r.check_in_at),
      checked_out: clock(r.check_out_at),
      ...(isToday ? { now: whereNow(r) } : {}),
      ...(r.check_out_at && r.check_out_reason && r.check_out_reason !== HOME_LABEL ? { left_for: r.check_out_reason } : {}),
      went_out: (r.trips || []).length ? r.trips.map((t) => ({ reason: t.reason, out: clock(t.out_at), back: clock(t.back_at) })) : undefined,
      note: r.note || undefined,
    }));
    const summary = { ...(body.summary || {}) };
    if (isToday) {
      summary.in_now = rows.filter((r) => r.now === 'In (checked in)').length;
      summary.out_now = rows.filter((r) => String(r.now).startsWith('Out for')).length;
      summary.gone_home = rows.filter((r) => r.now === 'Gone home').length;
    }
    return {
      date: body.date,
      ...(employeeId ? {} : { summary }),
      attendance: rows,
      times_note: 'Times are Pakistan time. "Not marked yet" means no check-in so far today; it becomes absent if the day ends without one.',
    };
  }

  if (key === 'attendance_month') {
    return { month: body.month, attendance: keep(body.attendance || []), days_note: 'Weekly off and leave are paid; only absent days are deducted from salary.' };
  }

  if (key === 'payroll') {
    const rows = keep(body.payroll || []).map(({ user_id: _u, rider_id: _r, branch_id: _b, ...r }) => ({
      ...r,
      paid: r.voucher_number ? `Voucher ${r.voucher_number} (${r.voucher_status})` : 'Not yet',
    }));
    return { month: body.month, payroll: rows, ...(employeeId ? {} : { totals: body.totals }), pay_note: 'Net = salary − absent days + bonus − deduction. Lines with a voucher are final.' };
  }
  return body;
}

// ---------------------------------------------------------------- the asker's own attendance

async function employeeOf(db, user) {
  const column = user.type === 'rider' ? 'rider_id' : 'user_id';
  const [rows] = await db.execute(`SELECT * FROM employees WHERE ${column} = ? AND is_active = 1 LIMIT 1`, [user.id]);
  return rows[0] || null;
}

async function myAttendance(db, args, user) {
  await ensureTables(db);
  const employee = await employeeOf(db, user);
  if (!employee) {
    return {
      error: 'not_on_staff_list',
      message: `${user.name} is not on the HR staff list, so there is no attendance to show. Tell them to ask HR to add them (Admin → HR → Employees).`,
    };
  }
  const today = ymdIn();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(args.month || '')) ? String(args.month) : today.slice(0, 7);

  // Today: a shift still open from last night counts, as on the attendance screen.
  const [open] = await db.execute(
    `SELECT * FROM attendance WHERE employee_id = ? AND check_in_at IS NOT NULL AND check_out_at IS NULL
       AND check_in_at >= NOW() - INTERVAL ${OPEN_SHIFT_HOURS} HOUR ORDER BY check_in_at DESC LIMIT 1`,
    [employee.id]
  );
  const [todays] = await db.execute('SELECT * FROM attendance WHERE employee_id = ? AND work_date = ?', [employee.id, today]);
  const day = open[0] || todays[0] || null;
  const [trips] = day ? await db.execute('SELECT reason, out_at, back_at FROM attendance_trips WHERE attendance_id = ? ORDER BY out_at', [day.id]) : [[]];
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const todayStatus = day ? day.status : Number(employee.weekly_off) === weekday ? 'off' : 'not_marked';
  const todayView = {
    date: today,
    status: STATUS[todayStatus] || todayStatus,
    checked_in: clock(day && day.check_in_at),
    checked_out: clock(day && day.check_out_at),
    now: day ? whereNow({ ...day, day_status: todayStatus, check_out_reason: day.check_out_at ? reasonLabel(day.check_out_reason) : null }) : todayStatus === 'off' ? 'Weekly off' : 'Not checked in',
    went_out: trips.length ? trips.map((t) => ({ reason: reasonLabel(t.reason), out: clock(t.out_at), back: clock(t.back_at) })) : undefined,
    next_step: !day || day.check_out_at ? 'Check in' : 'Check out (choose why, if coming back)',
  };

  // The month, worked out exactly like the payroll screen (a final voucher wins).
  const [records] = await db.execute(
    `SELECT DATE_FORMAT(work_date, '%Y-%m-%d') AS date, status FROM attendance WHERE employee_id = ? AND work_date BETWEEN ? AND LAST_DAY(?)`,
    [employee.id, `${month}-01`, `${month}-01`]
  );
  const [lines] = await db.execute(
    `SELECT p.bonus, p.deduction, p.snapshot, p.voucher_id, v.voucher_number, v.status AS voucher_status
       FROM payroll_lines p LEFT JOIN cash_payment_vouchers v ON v.id = p.voucher_id WHERE p.month = ? AND p.employee_id = ?`,
    [month, employee.id]
  );
  const line = lines[0] || {};
  const final = line.voucher_id && line.voucher_status !== 'cancelled' && line.snapshot ? JSON.parse(line.snapshot) : null;
  const figures = final || hrRouter.monthFigures(employee, records, month, { bonus: line.bonus || 0, deduction: line.deduction || 0, today });

  // Which days, so "which days was I absent?" has an answer.
  const joined = employee.joined_on ? ymdIn(new Date(employee.joined_on)) : null;
  const byDate = new Map(records.map((r) => [r.date, r.status]));
  const absentDays = [];
  const leaveDays = [];
  for (const { date, weekday: wd } of daysOf(month)) {
    if ((joined && date < joined) || date > today) continue;
    const status = byDate.get(date);
    if (status === 'leave') leaveDays.push(date);
    else if (status === 'absent' || (!status && Number(employee.weekly_off) !== wd)) absentDays.push(date);
  }

  return {
    name: employee.name,
    designation: employee.designation || undefined,
    today: todayView,
    month: {
      month,
      days_in_month: figures.days_in_month,
      present: figures.present,
      absent: figures.absent,
      leave: figures.leave,
      weekly_off: figures.off,
      absent_days: absentDays,
      leave_days: leaveDays,
      currency: 'PKR',
      salary: figures.salary,
      absence_deduction: figures.absence_deduction,
      bonus: figures.bonus,
      deduction: figures.deduction,
      net: figures.net,
      pay_status: final ? `Final: voucher ${line.voucher_number} (${line.voucher_status})` : month === today.slice(0, 7) ? 'Worked out so far this month; it changes until payroll is done.' : 'Not paid out yet.',
    },
    rules: 'Weekly off and leave are paid; each absent working day is deducted (salary ÷ days in the month). Like the payroll screen, today counts as absent until they check in.',
    how_to_mark: 'Mark attendance in the ServeNow app (Attendance) with a photo, or at the office kiosk. A missed day can only be corrected by HR.',
  };
}

module.exports = { shapeHrReport, findEmployee, myAttendance, clock };
