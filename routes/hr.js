// Small HR: employees, attendance by camera, and a monthly payroll.
//
// In the office everyone uses one kiosk screen: HR sets up the PC once, and its key can only list that
// branch's staff, ask who a face is and save marks. Outside the office, riders and staff mark from their
// own login. Faces are read in the browser into 128 numbers; only those numbers reach us, and matching is
// done here, so a kiosk never holds anyone's face data.
//
// An employee is a person on the staff list, linked to the login they mark attendance with (a staff
// account or a rider). Photos stay in private_uploads/, which is not served by any static route: they
// are only read through this router, by people holding the HR right, inside their branch.
//
// Money never moves here. A payroll line becomes a draft payment voucher posted to 5100 Salaries, and
// the normal voucher approval and ledger do the rest.
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { authenticateToken, staffHasRight } = require('../middleware/auth');
const { resolveStaffBranch, resolveWriteBranch, toBranchId } = require('../utils/branches');
const { runOncePerProcess } = require('../utils/runOnce');

const router = express.Router();

const TIME_ZONE = 'Asia/Karachi';
const PHOTO_ROOT = path.join(__dirname, '..', 'private_uploads', 'attendance');
const MAX_PHOTO_BYTES = 1.5 * 1024 * 1024;
const MIN_PHOTO_BYTES = 2 * 1024;
const OPEN_SHIFT_HOURS = 16;
const DOUBLE_TAP_SECONDS = 60;
const SALARY_ACCOUNT = '5100';
// Why someone is leaving. Anything but 'home' means they are expected back the same day.
const LEAVE_REASONS = [
  { key: 'bank', label: 'Bank Work' },
  { key: 'market', label: 'Store or Market Work' },
  { key: 'delivery', label: 'Delivery or Rider Duty' },
  { key: 'lunch', label: 'Lunch or Namaz' },
  { key: 'office', label: 'Other Office Work' },
  { key: 'personal', label: 'Personal Work' },
  { key: 'home', label: 'Going Home' },
];
const HOME = 'home';
const REOPENED = 'reopened'; // HR undid a Going Home pressed by mistake
const reasonLabel = (key) => (key === REOPENED ? 'Reopened by HR' : (LEAVE_REASONS.find((r) => r.key === key) || LEAVE_REASONS[LEAVE_REASONS.length - 1]).label);
// Going Home ends the duty: nobody checks in again that day unless HR reopens it.
const dutyComplete = (reason) => !reason || reason === HOME;
// Time out on these is still work. Lunch, personal work and anything else is not counted as hours.
const DUTY_TRIPS = ['bank', 'market', 'delivery', 'office'];
const INCENTIVE_TYPES = ['none', 'monthly', 'per_day', 'per_delivery', 'full_attendance', 'no_day_off', 'top_deliveries'];
const MAX_INCENTIVES = 8;
const DEFAULT_GRACE_MINUTES = 10;
const FACE_SIZE = 128;
const FACE_MATCH = 0.5; // below this distance, two faces are the same person
const FACE_MARGIN = 0.04; // and the next closest person must be clearly further away
const FACE_SAMPLES = { min: 3, max: 8 };
const FACE_PASS_SECONDS = 60;

const ensureTables = runOncePerProcess(async (db) => {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS employees (
      id INT PRIMARY KEY AUTO_INCREMENT,
      branch_id INT NOT NULL,
      user_id INT NULL,
      rider_id INT NULL,
      name VARCHAR(120) NOT NULL,
      designation VARCHAR(80) NULL,
      phone VARCHAR(30) NULL,
      monthly_salary DECIMAL(12,2) NOT NULL DEFAULT 0,
      weekly_off TINYINT NULL,
      joined_on DATE NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_employee_user (user_id),
      UNIQUE KEY uq_employee_rider (rider_id),
      KEY idx_employee_branch (branch_id)
    )`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INT PRIMARY KEY AUTO_INCREMENT,
      employee_id INT NOT NULL,
      work_date DATE NOT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'present',
      check_in_at DATETIME NULL,
      check_in_source VARCHAR(10) NULL,
      check_in_photo VARCHAR(120) NULL,
      check_in_latitude DECIMAL(10,7) NULL,
      check_in_longitude DECIMAL(10,7) NULL,
      check_in_accuracy INT NULL,
      check_out_at DATETIME NULL,
      check_out_source VARCHAR(10) NULL,
      check_out_photo VARCHAR(120) NULL,
      check_out_latitude DECIMAL(10,7) NULL,
      check_out_longitude DECIMAL(10,7) NULL,
      check_out_accuracy INT NULL,
      note VARCHAR(200) NULL,
      changed_by INT NULL,
      UNIQUE KEY uq_attendance_day (employee_id, work_date),
      KEY idx_attendance_date (work_date)
    )`);
  await db.execute('ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_out_reason VARCHAR(20) NULL');
  // One row per time someone went out and came back. The attendance row always shows where they are now.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS attendance_trips (
      id INT PRIMARY KEY AUTO_INCREMENT,
      attendance_id INT NOT NULL,
      reason VARCHAR(20) NOT NULL,
      out_at DATETIME NOT NULL,
      out_source VARCHAR(10) NULL,
      out_photo VARCHAR(120) NULL,
      out_latitude DECIMAL(10,7) NULL,
      out_longitude DECIMAL(10,7) NULL,
      back_at DATETIME NOT NULL,
      back_source VARCHAR(10) NULL,
      back_photo VARCHAR(120) NULL,
      back_latitude DECIMAL(10,7) NULL,
      back_longitude DECIMAL(10,7) NULL,
      KEY idx_trip_attendance (attendance_id)
    )`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS shifts (
      id INT PRIMARY KEY AUTO_INCREMENT,
      branch_id INT NOT NULL,
      name VARCHAR(60) NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      grace_minutes INT NOT NULL DEFAULT 10,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_shift_branch (branch_id)
    )`);
  await db.execute('ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift_id INT NULL');
  await db.execute(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS incentive_type VARCHAR(20) NOT NULL DEFAULT 'none'`);
  await db.execute('ALTER TABLE employees ADD COLUMN IF NOT EXISTS incentive_amount DECIMAL(12,2) NOT NULL DEFAULT 0');
  await db.execute('ALTER TABLE employees ADD COLUMN IF NOT EXISTS incentive_note VARCHAR(200) NULL');
  // Several incentives a person can earn at once, as JSON [{ type, amount, note }].
  // The single incentive_* columns keep the first one for older readers.
  await db.execute('ALTER TABLE employees ADD COLUMN IF NOT EXISTS incentives TEXT NULL');
  // The shift as it was that day, so changing a shift later never rewrites past attendance.
  await db.execute('ALTER TABLE attendance ADD COLUMN IF NOT EXISTS shift_name VARCHAR(60) NULL');
  await db.execute('ALTER TABLE attendance ADD COLUMN IF NOT EXISTS shift_start TIME NULL');
  await db.execute('ALTER TABLE attendance ADD COLUMN IF NOT EXISTS shift_end TIME NULL');
  await db.execute('ALTER TABLE attendance ADD COLUMN IF NOT EXISTS late_minutes INT NOT NULL DEFAULT 0');
  await db.execute('ALTER TABLE attendance ADD COLUMN IF NOT EXISTS early_minutes INT NOT NULL DEFAULT 0');
  await db.execute(`
    CREATE TABLE IF NOT EXISTS payroll_lines (
      id INT PRIMARY KEY AUTO_INCREMENT,
      month CHAR(7) NOT NULL,
      employee_id INT NOT NULL,
      bonus DECIMAL(12,2) NOT NULL DEFAULT 0,
      deduction DECIMAL(12,2) NOT NULL DEFAULT 0,
      note VARCHAR(200) NULL,
      voucher_id INT NULL,
      snapshot TEXT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_payroll_line (month, employee_id)
    )`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS employee_faces (
      id INT PRIMARY KEY AUTO_INCREMENT,
      employee_id INT NOT NULL,
      descriptor TEXT NOT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_face_employee (employee_id)
    )`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS kiosk_devices (
      id INT PRIMARY KEY AUTO_INCREMENT,
      branch_id INT NOT NULL,
      name VARCHAR(60) NOT NULL,
      key_hash CHAR(64) NOT NULL,
      created_by INT NULL,
      last_used_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_kiosk_key (key_hash)
    )`);
});

async function tablesReady(req, res, next) {
  try {
    await ensureTables(req.db);
    next();
  } catch (err) {
    console.error('[hr] tables failed:', err.message);
    res.status(500).json({ success: false, message: 'HR is not available just now' });
  }
}

// ---------------------------------------------------------------- the office kiosk (no login, its own key)

const hashKey = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');
const kiosk = express.Router();

kiosk.use(tablesReady);
kiosk.use(async (req, res, next) => {
  try {
    const key = String(req.get('x-kiosk-key') || '');
    const [rows] = key ? await req.db.execute(
      `SELECT k.id, k.branch_id, b.name AS branch_name FROM kiosk_devices k LEFT JOIN branches b ON b.id = k.branch_id WHERE k.key_hash = ?`,
      [hashKey(key)]
    ) : [[]];
    if (!rows.length) return res.status(401).json({ success: false, message: 'This screen is not set up.' });
    req.kiosk = rows[0];
    await req.db.execute('UPDATE kiosk_devices SET last_used_at = NOW() WHERE id = ?', [rows[0].id]);
    return next();
  } catch (err) {
    console.error('[hr] kiosk key failed:', err.message);
    return res.status(500).json({ success: false, message: 'Please try again' });
  }
});

const validDescriptor = (d) => Array.isArray(d) && d.length === FACE_SIZE && d.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 2);
const faceDistance = (a, b) => Math.sqrt(a.reduce((sum, n, i) => sum + (n - b[i]) ** 2, 0));

/** The one person this face is, or null. Unsure is null: a wrong name is worse than asking them to tap. */
function matchFace(descriptor, rows) {
  const best = new Map();
  for (const row of rows) {
    const distance = faceDistance(descriptor, JSON.parse(row.descriptor));
    if (!best.has(row.employee_id) || distance < best.get(row.employee_id)) best.set(row.employee_id, distance);
  }
  const ranked = [...best.entries()].sort((a, b) => a[1] - b[1]);
  if (!ranked.length || ranked[0][1] >= FACE_MATCH) return null;
  if (ranked[1] && ranked[1][1] - ranked[0][1] < FACE_MARGIN) return null;
  return { employee_id: ranked[0][0], distance: ranked[0][1] };
}

// Proof for /mark that this screen just recognised this person. It works for one person, one screen, one minute.
const passSignature = (device, employee, until) => crypto.createHmac('sha256', `${process.env.JWT_SECRET}:kiosk-face`).update(`${device}.${employee}.${until}`).digest('hex');
function issuePass(device, employee) {
  const until = Math.floor(Date.now() / 1000) + FACE_PASS_SECONDS;
  return `${until}.${passSignature(device, employee, until)}`;
}
function validPass(pass, device, employee) {
  const [until, signature] = String(pass || '').split('.');
  if (!(Number(until) >= Date.now() / 1000) || !signature) return false;
  const expected = Buffer.from(passSignature(device, employee, until));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

// Names and whether each person is in, nothing else: no salary, photo, phone, location or face data.
async function kioskPeople(db, branchId) {
  const [rows] = await db.execute(
    `SELECT e.id, e.name, e.designation, a.work_date, a.check_in_at, a.check_out_at, a.check_out_reason,
            EXISTS (SELECT 1 FROM employee_faces f WHERE f.employee_id = e.id) AS face,
            TIMESTAMPDIFF(SECOND, COALESCE(a.check_out_at, (SELECT MAX(t.back_at) FROM attendance_trips t WHERE t.attendance_id = a.id), a.check_in_at), NOW()) AS since_mark
       FROM employees e
       LEFT JOIN attendance a ON a.employee_id = e.id AND a.check_in_at IS NOT NULL
        AND (a.work_date = ? OR (a.check_out_at IS NULL AND a.check_in_at >= NOW() - INTERVAL ${OPEN_SHIFT_HOURS} HOUR))
      WHERE e.is_active = 1 AND e.branch_id = ? ORDER BY e.name, a.check_in_at`,
    [ymdIn(), branchId]
  );
  const people = new Map();
  for (const r of rows) {
    const finished = !r.check_out_reason || r.check_out_reason === HOME;
    const state = !r.check_in_at ? 'out' : !r.check_out_at ? 'in' : finished ? 'done' : 'away';
    const known = people.get(r.id);
    // A shift still open from last night counts first: the next mark closes it.
    if (known && known.state === 'in') continue;
    people.set(r.id, {
      id: r.id, name: r.name, designation: r.designation, face: Boolean(r.face), state,
      check_in_at: r.check_in_at, check_out_at: r.check_out_at, since_mark: r.since_mark,
      reason: r.check_out_at && !finished ? reasonLabel(r.check_out_reason) : undefined,
    });
  }
  return [...people.values()];
}

kiosk.get('/employees', async (req, res) => {
  try {
    return res.json({ success: true, branch: req.kiosk.branch_name || 'ServeNow', reasons: LEAVE_REASONS, employees: await kioskPeople(req.db, req.kiosk.branch_id) });
  } catch (err) {
    console.error('[hr] kiosk list failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not load the staff list' });
  }
});

kiosk.post('/identify', async (req, res) => {
  try {
    if (!validDescriptor(req.body.descriptor)) return res.status(400).json({ success: false, message: 'No face' });
    const [rows] = await req.db.execute(
      `SELECT f.employee_id, f.descriptor FROM employee_faces f JOIN employees e ON e.id = f.employee_id
        WHERE e.is_active = 1 AND e.branch_id = ?`,
      [req.kiosk.branch_id]
    );
    const found = matchFace(req.body.descriptor, rows);
    if (!found) return res.json({ success: true, match: null });
    const person = (await kioskPeople(req.db, req.kiosk.branch_id)).find((p) => p.id === found.employee_id);
    if (!person) return res.json({ success: true, match: null });
    return res.json({ success: true, match: { ...person, pass: issuePass(req.kiosk.id, person.id) } });
  } catch (err) {
    console.error('[hr] identify failed:', err.message);
    return res.status(500).json({ success: false, message: 'Please try again' });
  }
});

kiosk.post('/mark', async (req, res) => {
  try {
    const [rows] = await req.db.execute('SELECT * FROM employees WHERE id = ? AND branch_id = ? AND is_active = 1', [Number(req.body.employee_id) || 0, req.kiosk.branch_id]);
    if (!rows[0]) return res.status(404).json({ success: false, message: 'That name is not on this list.' });
    const bytes = decodePhoto(req.body.photo);
    if (!bytes) return res.status(400).json({ success: false, message: 'The camera photo did not work. Please try again.' });
    // Someone enrolled is marked by their face only, so nobody can tap their name for them.
    const [enrolled] = await req.db.execute('SELECT 1 FROM employee_faces WHERE employee_id = ? LIMIT 1', [rows[0].id]);
    if (enrolled.length && !validPass(req.body.pass, req.kiosk.id, rows[0].id)) {
      return res.status(403).json({ success: false, message: 'Please look at the camera.' });
    }
    const reason = LEAVE_REASONS.some((r) => r.key === req.body.reason) ? req.body.reason : null;
    const out = await recordMark(req.db, rows[0], { bytes, source: 'kiosk', location: null, reason, reasonRequired: true });
    return res.status(out.status).json(out.body);
  } catch (err) {
    console.error('[hr] kiosk mark failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not save your attendance. Please try again.' });
  }
});

router.use('/kiosk/screen', kiosk);

router.use(authenticateToken);
router.use(tablesReady);

// ---------------------------------------------------------------- helpers

const ymdIn = (date = new Date()) => date.toLocaleDateString('en-CA', { timeZone: TIME_ZONE });
const validDate = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(value)) ? String(value) : null);
const validMonth = (value) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || '')) ? String(value) : null);
const money = (value) => Math.round(Number(value || 0) * 100) / 100;

function requireRight(...rights) {
  return async (req, res, next) => {
    try {
      if (req.user.user_type === 'admin') return next();
      if (req.user.user_type === 'standard_user' && (await staffHasRight(req.db, req.user.id, rights))) return next();
    } catch (err) {
      console.error('[hr] right check failed:', err.message);
    }
    return res.status(403).json({ success: false, message: 'You do not have the right to open this.' });
  };
}

const canSeePay = async (req) => req.user.user_type === 'admin' || staffHasRight(req.db, req.user.id, 'menu_hr_payroll');

// The branch a screen is limited to: a branch account's own, or the one head office picked.
function branchOf(req, res) {
  const scope = resolveStaffBranch(req.user, req.query.branch_id);
  if (scope.error) {
    res.status(403).json({ success: false, message: scope.error });
    return undefined;
  }
  return scope.branchId;
}

async function employeeFor(db, user) {
  const column = user.user_type === 'rider' ? 'rider_id' : 'user_id';
  const [rows] = await db.execute(`SELECT * FROM employees WHERE ${column} = ? AND is_active = 1 LIMIT 1`, [user.id]);
  return rows[0] || null;
}

// An employee the asker may touch, or null: the same answer for another branch as for no record.
async function employeeInScope(req, id) {
  const [rows] = await req.db.execute('SELECT * FROM employees WHERE id = ?', [Number(id) || 0]);
  const row = rows[0];
  if (!row) return null;
  const { branchId } = resolveStaffBranch(req.user);
  return branchId !== null && Number(row.branch_id) !== branchId ? null : row;
}

function decodePhoto(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const bytes = Buffer.from(m[1], 'base64');
  const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return isJpeg && bytes.length >= MIN_PHOTO_BYTES && bytes.length <= MAX_PHOTO_BYTES ? bytes : null;
}

async function savePhoto(bytes, date) {
  const folder = date.slice(0, 7);
  await fs.promises.mkdir(path.join(PHOTO_ROOT, folder), { recursive: true });
  const name = `${folder}/${crypto.randomBytes(16).toString('hex')}.jpg`;
  await fs.promises.writeFile(path.join(PHOTO_ROOT, name), bytes, { mode: 0o640 });
  return name;
}

function readLocation(body) {
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const known = body.latitude != null && body.longitude != null && Number.isFinite(latitude) && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && (latitude !== 0 || longitude !== 0);
  if (!known) return null;
  const accuracy = Number(body.accuracy);
  return { latitude, longitude, accuracy: Number.isFinite(accuracy) ? Math.min(Math.round(accuracy), 100000) : null };
}

// A phone is what the client says, or what its browser gives away. A PC needs no location.
const isPhone = (req) => req.body.source === 'phone' || /Android|iPhone|iPad|iPod|Mobile/i.test(String(req.get('user-agent') || ''));

const attendanceView = (row) => (row ? {
  id: row.id,
  status: row.status,
  check_in_at: row.check_in_at,
  check_out_at: row.check_out_at,
} : null);

// ---------------------------------------------------------------- shifts

const minutesOf = (time) => {
  const [hours, minutes] = String(time || '0:0').split(':').map(Number);
  return hours * 60 + minutes;
};
const nowMinutes = (date = new Date()) => minutesOf(date.toLocaleTimeString('en-GB', { timeZone: TIME_ZONE, hour12: false }));
// a minus b on a 24 hour clock, between -12 and +12 hours, so a night shift works across midnight.
const clockGap = (a, b) => ((a - b + 2160) % 1440) - 720;
const lateBy = (shift, now) => Math.max(0, clockGap(now, minutesOf(shift.start_time)) - Number(shift.grace_minutes || 0));
const earlyBy = (shiftEnd, now) => Math.max(0, clockGap(minutesOf(shiftEnd), now));
/** A shift's length. End before start means it runs past midnight. */
const shiftLength = (start, end) => ((minutesOf(end) - minutesOf(start) + 1440) % 1440) || 1440;

async function shiftOf(db, employee) {
  if (!employee.shift_id) return null;
  const [rows] = await db.execute('SELECT * FROM shifts WHERE id = ? AND is_active = 1', [employee.shift_id]);
  return rows[0] || null;
}

// ---------------------------------------------------------------- marking (the employee)

// A shift still open from today or last night: the next mark closes it.
async function openShift(db, employeeId) {
  const [rows] = await db.execute(
    `SELECT * FROM attendance WHERE employee_id = ? AND check_in_at IS NOT NULL AND check_out_at IS NULL
       AND check_in_at >= NOW() - INTERVAL ${OPEN_SHIFT_HOURS} HOUR ORDER BY check_in_at DESC LIMIT 1`,
    [employeeId]
  );
  return rows[0] || null;
}

router.get('/me', async (req, res) => {
  try {
    const employee = await employeeFor(req.db, req.user);
    if (!employee) return res.json({ success: true, employee: null });
    const today = ymdIn();
    const open = await openShift(req.db, employee.id);
    const [rows] = await req.db.execute('SELECT * FROM attendance WHERE employee_id = ? AND work_date = ?', [employee.id, today]);
    const shift = await shiftOf(req.db, employee);
    return res.json({
      success: true,
      employee: { name: employee.name, designation: employee.designation },
      today,
      next_action: open ? 'out' : rows[0]?.check_out_at && dutyComplete(rows[0].check_out_reason) ? 'done' : 'in',
      shift: shift ? { name: shift.name, start: shift.start_time, end: shift.end_time } : null,
      reasons: LEAVE_REASONS,
      record: attendanceView(open || rows[0] || null),
    });
  } catch (err) {
    console.error('[hr] me failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not load your attendance' });
  }
});

// Checks out of the open shift, comes back from being out, or starts the day. Answers with the HTTP
// status and body to send. A person can go out and come back as often as the day needs.
async function recordMark(db, employee, { bytes, source, location, reason, reasonRequired = false }) {
  let savedName = null;
  const refused = (status, message) => ({ status, body: { success: false, message } });
  const secondsSince = async (when) => {
    const [[{ seconds }]] = await db.execute('SELECT TIMESTAMPDIFF(SECOND, ?, NOW()) AS seconds', [when]);
    return Number(seconds);
  };
  try {
    const today = ymdIn();
    const open = await openShift(db, employee.id);

    if (open) {
      if (reasonRequired && !reason) return refused(400, 'Choose why you are leaving.');
      if ((await secondsSince(open.check_in_at)) < DOUBLE_TAP_SECONDS) return refused(409, 'You have just checked in.');
      const why = reason || HOME;
      savedName = await savePhoto(bytes, today);
      const [done] = await db.execute(
        `UPDATE attendance SET check_out_at = NOW(), check_out_reason = ?, early_minutes = ?, check_out_source = ?, check_out_photo = ?, check_out_latitude = ?,
                check_out_longitude = ?, check_out_accuracy = ? WHERE id = ? AND check_out_at IS NULL`,
        [why, why === HOME && open.shift_end ? earlyBy(open.shift_end, nowMinutes()) : 0, source, savedName, location?.latitude ?? null, location?.longitude ?? null, location?.accuracy ?? null, open.id]
      );
      if (!done.affectedRows) {
        await fs.promises.unlink(path.join(PHOTO_ROOT, savedName)).catch(() => {});
        return refused(409, 'You have already checked out.');
      }
      const message = why === HOME ? 'Duty complete for today. Thank you.' : `Checked out for ${reasonLabel(why)}. See you soon.`;
      return { status: 200, body: { success: true, action: 'out', reason: why, message } };
    }

    const [rows] = await db.execute('SELECT * FROM attendance WHERE employee_id = ? AND work_date = ?', [employee.id, today]);
    const day = rows[0];

    if (day && day.check_in_at && day.check_out_at) {
      if (dutyComplete(day.check_out_reason)) return refused(409, 'Your duty for today is complete. See you tomorrow.');
      if ((await secondsSince(day.check_out_at)) < DOUBLE_TAP_SECONDS) return refused(409, 'You have just checked out.');
      savedName = await savePhoto(bytes, today);
      const [back] = await db.execute(
        `UPDATE attendance SET check_out_at = NULL, check_out_reason = NULL, check_out_source = NULL, check_out_photo = NULL,
                check_out_latitude = NULL, check_out_longitude = NULL, check_out_accuracy = NULL WHERE id = ? AND check_out_at IS NOT NULL`,
        [day.id]
      );
      if (!back.affectedRows) {
        await fs.promises.unlink(path.join(PHOTO_ROOT, savedName)).catch(() => {});
        return refused(409, 'You are already checked in.');
      }
      await db.execute(
        `INSERT INTO attendance_trips (attendance_id, reason, out_at, out_source, out_photo, out_latitude, out_longitude, back_at, back_source, back_photo, back_latitude, back_longitude)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?)`,
        [day.id, day.check_out_reason || HOME, day.check_out_at, day.check_out_source, day.check_out_photo, day.check_out_latitude, day.check_out_longitude,
          source, savedName, location?.latitude ?? null, location?.longitude ?? null]
      );
      return { status: 200, body: { success: true, action: 'back', message: 'Welcome back.' } };
    }

    savedName = await savePhoto(bytes, today);
    const shift = await shiftOf(db, employee);
    const late = shift ? lateBy(shift, nowMinutes()) : 0;
    // A day HR marked ahead (leave or absent) becomes present when the person actually comes in.
    await db.execute(
      `INSERT INTO attendance (employee_id, work_date, status, check_in_at, check_in_source, check_in_photo, check_in_latitude, check_in_longitude, check_in_accuracy,
         shift_name, shift_start, shift_end, late_minutes)
       VALUES (?, ?, 'present', NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = 'present', check_in_at = NOW(), check_in_source = VALUES(check_in_source), check_in_photo = VALUES(check_in_photo),
         check_in_latitude = VALUES(check_in_latitude), check_in_longitude = VALUES(check_in_longitude), check_in_accuracy = VALUES(check_in_accuracy),
         shift_name = VALUES(shift_name), shift_start = VALUES(shift_start), shift_end = VALUES(shift_end), late_minutes = VALUES(late_minutes)`,
      [employee.id, today, source, savedName, location?.latitude ?? null, location?.longitude ?? null, location?.accuracy ?? null,
        shift?.name ?? null, shift?.start_time ?? null, shift?.end_time ?? null, late]
    );
    const message = late ? `Checked in, ${late} minutes late for ${shift.name}.` : 'Checked in. Have a good day.';
    return { status: 200, body: { success: true, action: 'in', message, late_minutes: late } };
  } catch (err) {
    if (savedName) await fs.promises.unlink(path.join(PHOTO_ROOT, savedName)).catch(() => {});
    throw err;
  }
}

router.post('/attendance/mark', async (req, res) => {
  try {
    const employee = await employeeFor(req.db, req.user);
    if (!employee) return res.status(403).json({ success: false, message: 'You are not on the staff list. Ask HR to add you.' });

    const bytes = decodePhoto(req.body.photo);
    if (!bytes) return res.status(400).json({ success: false, message: 'Take your photo first.' });
    const phone = isPhone(req);
    const location = readLocation(req.body);
    if (phone && !location) {
      return res.status(400).json({ success: false, message: 'Turn on location on your phone and allow it, then try again.' });
    }
    // An older app sends no reason: its check out means the end of the day, as it always did.
    const reason = LEAVE_REASONS.some((r) => r.key === req.body.reason) ? req.body.reason : null;
    const out = await recordMark(req.db, employee, { bytes, source: phone ? 'phone' : 'pc', location, reason });
    return res.status(out.status).json(out.body);
  } catch (err) {
    console.error('[hr] mark failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not save your attendance. Please try again.' });
  }
});

// ---------------------------------------------------------------- kiosk screens (HR)

router.get('/kiosk/devices', requireRight('menu_hr_attendance'), async (req, res) => {
  try {
    const branchId = branchOf(req, res);
    if (branchId === undefined) return undefined;
    const [rows] = await req.db.execute(
      `SELECT k.id, k.name, k.last_used_at, b.name AS branch_name FROM kiosk_devices k LEFT JOIN branches b ON b.id = k.branch_id
        ${branchId === null ? '' : 'WHERE k.branch_id = ?'} ORDER BY k.id`,
      branchId === null ? [] : [branchId]
    );
    return res.json({ success: true, devices: rows });
  } catch (err) {
    console.error('[hr] kiosks failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not load kiosk screens' });
  }
});

// The key is shown once, to this browser. Only its hash is kept.
router.post('/kiosk/devices', requireRight('menu_hr_attendance'), async (req, res) => {
  try {
    const branch = await resolveWriteBranch(req.db, req.user, req.body.branch_id);
    if (branch.error) return res.status(400).json({ success: false, message: branch.error });
    const key = crypto.randomBytes(32).toString('hex');
    const name = String(req.body.name || '').trim().slice(0, 60) || 'Office PC';
    await req.db.execute('INSERT INTO kiosk_devices (branch_id, name, key_hash, created_by) VALUES (?, ?, ?, ?)', [branch.branchId, name, hashKey(key), req.user.id]);
    return res.status(201).json({ success: true, key, message: 'Kiosk ready' });
  } catch (err) {
    console.error('[hr] add kiosk failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not set up the kiosk' });
  }
});

router.delete('/kiosk/devices/:id(\\d+)', requireRight('menu_hr_attendance'), async (req, res) => {
  try {
    const { branchId } = resolveStaffBranch(req.user);
    const [done] = await req.db.execute(
      `DELETE FROM kiosk_devices WHERE id = ?${branchId === null ? '' : ' AND branch_id = ?'}`,
      branchId === null ? [Number(req.params.id)] : [Number(req.params.id), branchId]
    );
    if (!done.affectedRows) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, message: 'Kiosk removed' });
  } catch (err) {
    console.error('[hr] remove kiosk failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not remove the kiosk' });
  }
});

// A new direct link for a kiosk screen (to open it on another PC). The old key stops working at once.
router.post('/kiosk/devices/:id(\\d+)/link', requireRight('menu_hr_attendance'), async (req, res) => {
  try {
    const { branchId } = resolveStaffBranch(req.user);
    const key = crypto.randomBytes(32).toString('hex');
    const [done] = await req.db.execute(
      `UPDATE kiosk_devices SET key_hash = ? WHERE id = ?${branchId === null ? '' : ' AND branch_id = ?'}`,
      branchId === null ? [hashKey(key), Number(req.params.id)] : [hashKey(key), Number(req.params.id), branchId]
    );
    if (!done.affectedRows) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, key, message: 'New kiosk link ready. The old link no longer works.' });
  } catch (err) {
    console.error('[hr] new kiosk link failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not make a new link' });
  }
});

// ---------------------------------------------------------------- employees (HR)

// ---------------------------------------------------------------- shift setup (HR)

const validTime = (value) => (/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(value || '')) ? String(value).slice(0, 5) : null);

function readShift(body) {
  const name = String(body.name || '').trim().slice(0, 60);
  if (!name) return { error: 'Enter the shift name.' };
  const start = validTime(body.start_time);
  const end = validTime(body.end_time);
  if (!start || !end) return { error: 'Enter the start and end time.' };
  if (start === end) return { error: 'Start and end time cannot be the same.' };
  const grace = body.grace_minutes === undefined || body.grace_minutes === '' ? DEFAULT_GRACE_MINUTES : Number(body.grace_minutes);
  if (!Number.isInteger(grace) || grace < 0 || grace > 120) return { error: 'Grace must be 0 to 120 minutes.' };
  return { name, start, end, grace };
}

async function shiftInScope(req, id) {
  const [rows] = await req.db.execute('SELECT * FROM shifts WHERE id = ? AND is_active = 1', [Number(id) || 0]);
  const row = rows[0];
  if (!row) return null;
  const { branchId } = resolveStaffBranch(req.user);
  return branchId !== null && Number(row.branch_id) !== branchId ? null : row;
}

router.get('/shifts', requireRight('menu_hr', 'menu_hr_attendance', 'menu_hr_payroll'), async (req, res) => {
  try {
    const branchId = branchOf(req, res);
    if (branchId === undefined) return undefined;
    const [rows] = await req.db.execute(
      `SELECT s.*, b.name AS branch_name,
              (SELECT COUNT(*) FROM employees e WHERE e.shift_id = s.id AND e.is_active = 1) AS employees
         FROM shifts s LEFT JOIN branches b ON b.id = s.branch_id
        WHERE s.is_active = 1${branchId === null ? '' : ' AND s.branch_id = ?'} ORDER BY s.start_time, s.name`,
      branchId === null ? [] : [branchId]
    );
    return res.json({ success: true, shifts: rows.map((r) => ({ ...r, hours: Math.round((shiftLength(r.start_time, r.end_time) / 60) * 100) / 100 })) });
  } catch (err) {
    console.error('[hr] shifts failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not load shifts' });
  }
});

router.post('/shifts', requireRight('menu_hr_attendance'), async (req, res) => {
  try {
    const shift = readShift(req.body);
    if (shift.error) return res.status(400).json({ success: false, message: shift.error });
    const branch = await resolveWriteBranch(req.db, req.user, req.body.branch_id);
    if (branch.error) return res.status(400).json({ success: false, message: branch.error });
    const [result] = await req.db.execute(
      'INSERT INTO shifts (branch_id, name, start_time, end_time, grace_minutes) VALUES (?, ?, ?, ?, ?)',
      [branch.branchId, shift.name, shift.start, shift.end, shift.grace]
    );
    return res.status(201).json({ success: true, id: result.insertId, message: 'Shift added' });
  } catch (err) {
    console.error('[hr] add shift failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not add the shift' });
  }
});

router.put('/shifts/:id(\\d+)', requireRight('menu_hr_attendance'), async (req, res) => {
  try {
    const current = await shiftInScope(req, req.params.id);
    if (!current) return res.status(404).json({ success: false, message: 'Shift not found' });
    const shift = readShift(req.body);
    if (shift.error) return res.status(400).json({ success: false, message: shift.error });
    await req.db.execute('UPDATE shifts SET name = ?, start_time = ?, end_time = ?, grace_minutes = ? WHERE id = ?',
      [shift.name, shift.start, shift.end, shift.grace, current.id]);
    return res.json({ success: true, message: 'Shift saved. Days already marked keep their old times.' });
  } catch (err) {
    console.error('[hr] save shift failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not save the shift' });
  }
});

router.delete('/shifts/:id(\\d+)', requireRight('menu_hr_attendance'), async (req, res) => {
  try {
    const current = await shiftInScope(req, req.params.id);
    if (!current) return res.status(404).json({ success: false, message: 'Shift not found' });
    const [[{ people }]] = await req.db.execute('SELECT COUNT(*) AS people FROM employees WHERE shift_id = ? AND is_active = 1', [current.id]);
    if (Number(people)) return res.status(409).json({ success: false, message: `Move everyone off this shift first (${people} now).` });
    await req.db.execute('UPDATE shifts SET is_active = 0 WHERE id = ?', [current.id]);
    return res.json({ success: true, message: 'Shift removed' });
  } catch (err) {
    console.error('[hr] remove shift failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not remove the shift' });
  }
});

router.get('/employees', requireRight('menu_hr', 'menu_hr_payroll'), async (req, res) => {
  try {
    const branchId = branchOf(req, res);
    if (branchId === undefined) return undefined;
    const [rows] = await req.db.execute(
      `SELECT e.*, b.name AS branch_name, s.name AS shift_name, s.start_time AS shift_start, s.end_time AS shift_end,
              (SELECT COUNT(*) FROM employee_faces f WHERE f.employee_id = e.id) AS face_samples
         FROM employees e LEFT JOIN branches b ON b.id = e.branch_id LEFT JOIN shifts s ON s.id = e.shift_id
        ${branchId === null ? '' : 'WHERE e.branch_id = ?'} ORDER BY e.is_active DESC, e.name`,
      branchId === null ? [] : [branchId]
    );
    const pay = await canSeePay(req);
    return res.json({ success: true, can_see_pay: Boolean(pay), employees: rows.map((e) => (pay ? { ...e, incentives: incentiveList(e) } : { ...e, monthly_salary: undefined, incentive_type: undefined, incentive_amount: undefined, incentive_note: undefined, incentives: undefined })) });
  } catch (err) {
    console.error('[hr] employees failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not load employees' });
  }
});

// Logins not on the staff list yet, for the Link box.
router.get('/accounts', requireRight('menu_hr', 'menu_hr_payroll'), async (req, res) => {
  try {
    const branchId = branchOf(req, res);
    if (branchId === undefined) return undefined;
    const inBranch = branchId === null ? '' : ' AND (branch_id = ? OR branch_id IS NULL)';
    const p = branchId === null ? [] : [branchId];
    const [staff] = await req.db.execute(
      `SELECT id, TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) AS name FROM users
        WHERE user_type IN ('admin', 'standard_user') AND is_active = 1${inBranch}
          AND id NOT IN (SELECT user_id FROM employees WHERE user_id IS NOT NULL) ORDER BY name`, p
    );
    const [riders] = await req.db.execute(
      `SELECT id, TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) AS name FROM riders
        WHERE is_active = 1${branchId === null ? '' : ' AND branch_id = ?'}
          AND id NOT IN (SELECT rider_id FROM employees WHERE rider_id IS NOT NULL) ORDER BY name`, p
    );
    return res.json({ success: true, staff, riders });
  } catch (err) {
    console.error('[hr] accounts failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not load accounts' });
  }
});

function readEmployee(body) {
  const name = String(body.name || '').trim().slice(0, 120);
  if (!name) return { error: 'Enter the name.' };
  const salary = body.monthly_salary === undefined ? undefined : Number(body.monthly_salary);
  if (salary !== undefined && (!Number.isFinite(salary) || salary < 0)) return { error: 'Enter a valid salary.' };
  const off = body.weekly_off === '' || body.weekly_off == null ? null : Number(body.weekly_off);
  if (off !== null && !(Number.isInteger(off) && off >= 0 && off <= 6)) return { error: 'Choose a valid weekly off day.' };
  const joined = body.joined_on ? validDate(body.joined_on) : null;
  if (body.joined_on && !joined) return { error: 'Enter a valid joining date.' };
  let incentives;
  if (Array.isArray(body.incentives)) incentives = body.incentives;
  else if (body.incentive_type !== undefined) {
    incentives = String(body.incentive_type) === 'none' ? [] : [{ type: body.incentive_type, amount: body.incentive_amount, note: body.incentive_note }];
  }
  if (incentives !== undefined) {
    if (incentives.length > MAX_INCENTIVES) return { error: `At most ${MAX_INCENTIVES} incentives.` };
    const seen = new Set();
    const clean = [];
    for (const item of incentives) {
      const type = String((item && item.type) || '');
      if (type === 'none' || type === '') continue;
      if (!INCENTIVE_TYPES.includes(type)) return { error: 'Choose a valid incentive.' };
      if (seen.has(type)) return { error: 'Each incentive can be added once.' };
      seen.add(type);
      const amount = Number(item.amount || 0);
      if (!Number.isFinite(amount) || amount <= 0) return { error: 'Enter the amount for each incentive.' };
      clean.push({ type, amount: money(amount), note: String(item.note || '').trim().slice(0, 200) || null });
    }
    incentives = clean;
  }
  return {
    shiftId: Number(body.shift_id) || null,
    incentives,
    name,
    designation: String(body.designation || '').trim().slice(0, 80) || null,
    phone: String(body.phone || '').trim().slice(0, 30) || null,
    salary,
    off,
    joined,
  };
}

async function shiftAllowed(db, shiftId, branchId) {
  if (!shiftId) return true;
  const [rows] = await db.execute('SELECT id FROM shifts WHERE id = ? AND branch_id = ? AND is_active = 1', [shiftId, branchId]);
  return rows.length > 0;
}

const fromLink = (link) => {
  const m = /^(user|rider):(\d{1,10})$/.exec(String(link || ''));
  return m ? { user_id: m[1] === 'user' ? Number(m[2]) : null, rider_id: m[1] === 'rider' ? Number(m[2]) : null } : { user_id: null, rider_id: null };
};

const duplicateLink = (err, res) => {
  if (err.code !== 'ER_DUP_ENTRY') return false;
  res.status(409).json({ success: false, message: 'That login is already linked to another employee.' });
  return true;
};

router.post('/employees', requireRight('menu_hr', 'menu_hr_payroll'), async (req, res) => {
  try {
    const e = readEmployee(req.body);
    if (e.error) return res.status(400).json({ success: false, message: e.error });
    if (e.salary && !(await canSeePay(req))) return res.status(403).json({ success: false, message: 'Setting a salary needs the Payroll right.' });
    const branch = await resolveWriteBranch(req.db, req.user, req.body.branch_id);
    if (branch.error) return res.status(400).json({ success: false, message: branch.error });
    if (e.incentives?.length && !(await canSeePay(req))) return res.status(403).json({ success: false, message: 'Setting an incentive needs the Payroll right.' });
    const first = (e.incentives || [])[0] || {};
    if (!(await shiftAllowed(req.db, e.shiftId, branch.branchId))) return res.status(400).json({ success: false, message: 'Choose a shift of this branch.' });
    const link = fromLink(req.body.link);
    const [result] = await req.db.execute(
      `INSERT INTO employees (branch_id, user_id, rider_id, name, designation, phone, monthly_salary, weekly_off, joined_on, shift_id, incentive_type, incentive_amount, incentive_note, incentives)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [branch.branchId, link.user_id, link.rider_id, e.name, e.designation, e.phone, e.salary || 0, e.off, e.joined, e.shiftId,
        first.type || 'none', first.amount || 0, first.note || null, JSON.stringify(e.incentives || [])]
    );
    return res.status(201).json({ success: true, id: result.insertId, message: 'Employee added' });
  } catch (err) {
    if (duplicateLink(err, res)) return undefined;
    console.error('[hr] add employee failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not add the employee' });
  }
});

router.put('/employees/:id', requireRight('menu_hr', 'menu_hr_payroll'), async (req, res) => {
  try {
    const current = await employeeInScope(req, req.params.id);
    if (!current) return res.status(404).json({ success: false, message: 'Employee not found' });
    const e = readEmployee(req.body);
    if (e.error) return res.status(400).json({ success: false, message: e.error });
    const pay = await canSeePay(req);
    const salary = pay && e.salary !== undefined ? e.salary : current.monthly_salary;
    const link = req.body.link === undefined ? current : fromLink(req.body.link);
    const active = req.body.is_active === undefined ? current.is_active : (req.body.is_active ? 1 : 0);
    const shiftId = req.body.shift_id === undefined ? current.shift_id : e.shiftId;
    if (shiftId !== current.shift_id && !(await shiftAllowed(req.db, shiftId, current.branch_id))) {
      return res.status(400).json({ success: false, message: 'Choose a shift of this branch.' });
    }
    const list = pay && e.incentives !== undefined ? e.incentives : incentiveList(current);
    const incentive = list[0] || { type: 'none', amount: 0, note: null };
    await req.db.execute(
      `UPDATE employees SET name = ?, designation = ?, phone = ?, monthly_salary = ?, weekly_off = ?, joined_on = ?, user_id = ?, rider_id = ?, is_active = ?,
              shift_id = ?, incentive_type = ?, incentive_amount = ?, incentive_note = ?, incentives = ?
        WHERE id = ?`,
      [e.name, e.designation, e.phone, salary, e.off, e.joined, link.user_id, link.rider_id, active, shiftId ?? null,
        incentive.type ?? 'none', incentive.amount ?? 0, incentive.note ?? null, JSON.stringify(list), current.id]
    );
    // Face data is kept only while the person works here.
    if (!active) await req.db.execute('DELETE FROM employee_faces WHERE employee_id = ?', [current.id]);
    return res.json({ success: true, message: 'Employee saved' });
  } catch (err) {
    if (duplicateLink(err, res)) return undefined;
    console.error('[hr] save employee failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not save the employee' });
  }
});

// A new enrolment replaces the old one. One person cannot be enrolled under two names.
router.post('/employees/:id(\\d+)/face', requireRight('menu_hr'), async (req, res) => {
  try {
    const employee = await employeeInScope(req, req.params.id);
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });
    if (!employee.is_active) return res.status(400).json({ success: false, message: 'This employee has left.' });
    const samples = req.body.descriptors;
    if (!Array.isArray(samples) || samples.length < FACE_SAMPLES.min || samples.length > FACE_SAMPLES.max || !samples.every(validDescriptor)) {
      return res.status(400).json({ success: false, message: 'The face was not captured properly. Please try again.' });
    }
    const [others] = await req.db.execute(
      `SELECT f.employee_id, f.descriptor, e.name FROM employee_faces f JOIN employees e ON e.id = f.employee_id WHERE f.employee_id <> ? AND e.is_active = 1`,
      [employee.id]
    );
    const twin = others.find((row) => samples.some((sample) => faceDistance(sample, JSON.parse(row.descriptor)) < FACE_MATCH - 0.05));
    if (twin) return res.status(409).json({ success: false, message: `This face looks like ${twin.name}, who is already enrolled.` });
    await req.db.execute('DELETE FROM employee_faces WHERE employee_id = ?', [employee.id]);
    for (const sample of samples) {
      await req.db.execute('INSERT INTO employee_faces (employee_id, descriptor, created_by) VALUES (?, ?, ?)', [employee.id, JSON.stringify(sample), req.user.id]);
    }
    return res.status(201).json({ success: true, message: `${employee.name} is enrolled.` });
  } catch (err) {
    console.error('[hr] enrol failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not save the face' });
  }
});

router.delete('/employees/:id(\\d+)/face', requireRight('menu_hr'), async (req, res) => {
  try {
    const employee = await employeeInScope(req, req.params.id);
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });
    await req.db.execute('DELETE FROM employee_faces WHERE employee_id = ?', [employee.id]);
    return res.json({ success: true, message: 'Face removed' });
  } catch (err) {
    console.error('[hr] remove face failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not remove the face' });
  }
});

// ---------------------------------------------------------------- attendance (HR)

router.get('/attendance', requireRight('menu_hr_attendance'), async (req, res) => {
  try {
    const branchId = branchOf(req, res);
    if (branchId === undefined) return undefined;
    const date = validDate(req.query.date) || ymdIn();
    const [rows] = await req.db.execute(
      `SELECT e.id AS employee_id, e.name, e.designation, e.weekly_off, a.id, a.status, a.check_in_at, a.check_in_source,
              a.check_in_latitude, a.check_in_longitude, a.check_in_accuracy, a.check_in_photo IS NOT NULL AS has_in_photo,
              a.check_out_at, a.check_out_source, a.check_out_latitude, a.check_out_longitude, a.check_out_accuracy,
              a.check_out_photo IS NOT NULL AS has_out_photo, a.check_out_reason, a.note, a.late_minutes, a.early_minutes,
              COALESCE(a.shift_name, s.name) AS shift_name, COALESCE(a.shift_start, s.start_time) AS shift_start, COALESCE(a.shift_end, s.end_time) AS shift_end
         FROM employees e LEFT JOIN attendance a ON a.employee_id = e.id AND a.work_date = ?
         LEFT JOIN shifts s ON s.id = e.shift_id
        WHERE e.is_active = 1${branchId === null ? '' : ' AND e.branch_id = ?'} ORDER BY e.name`,
      branchId === null ? [date] : [date, branchId]
    );
    const ids = rows.map((r) => r.id).filter(Boolean);
    const [trips] = ids.length ? await req.db.execute(
      `SELECT id, attendance_id, reason, out_at, back_at, out_photo IS NOT NULL AS has_out_photo, back_photo IS NOT NULL AS has_back_photo
         FROM attendance_trips WHERE attendance_id IN (${ids.map(() => '?').join(', ')}) ORDER BY out_at`, ids
    ) : [[]];
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const day = rows.map((r) => ({
      ...r,
      day_status: r.status || (r.weekly_off === weekday ? 'off' : date > ymdIn() ? 'upcoming' : date === ymdIn() ? 'not_marked' : 'absent'),
      has_in_photo: Boolean(r.has_in_photo),
      has_out_photo: Boolean(r.has_out_photo),
      check_out_reason: r.check_out_at ? reasonLabel(r.check_out_reason) : null,
      trips: trips.filter((t) => t.attendance_id === r.id).map((t) => ({
        id: t.id, reason: reasonLabel(t.reason), out_at: t.out_at, back_at: t.back_at,
        has_out_photo: Boolean(t.has_out_photo), has_back_photo: Boolean(t.has_back_photo),
      })),
    }));
    const count = (s) => day.filter((r) => r.day_status === s).length;
    return res.json({
      success: true,
      date,
      summary: { employees: day.length, present: count('present'), not_marked: count('not_marked'), absent: count('absent'), leave: count('leave'), off: count('off') },
      attendance: day,
    });
  } catch (err) {
    console.error('[hr] attendance failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not load attendance' });
  }
});

// HR's correction for a day: present, leave (paid) or absent, always with a reason.
router.put('/attendance', requireRight('menu_hr_attendance'), async (req, res) => {
  try {
    const employee = await employeeInScope(req, req.body.employee_id);
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });
    const date = validDate(req.body.date);
    if (!date) return res.status(400).json({ success: false, message: 'Choose a date.' });
    if (date > ymdIn()) {
      if (req.body.status !== 'leave') return res.status(400).json({ success: false, message: 'Only leave can be set for a future day.' });
    }
    const note = String(req.body.note || '').trim().slice(0, 200);
    if (req.body.status === 'reopen') {
      if (!note) return res.status(400).json({ success: false, message: 'Write the reason.' });
      if (date !== ymdIn()) return res.status(400).json({ success: false, message: 'Only today can be reopened.' });
      const [reopened] = await req.db.execute(
        `UPDATE attendance SET check_out_reason = ?, early_minutes = 0, note = ?, changed_by = ?
          WHERE employee_id = ? AND work_date = ? AND check_out_at IS NOT NULL AND (check_out_reason IS NULL OR check_out_reason = ?)`,
        [REOPENED, note, req.user.id, employee.id, date, HOME]
      );
      if (!reopened.affectedRows) return res.status(409).json({ success: false, message: 'This person has not gone home today.' });
      return res.json({ success: true, message: 'Day reopened. They can check in again.' });
    }
    if (!['present', 'leave', 'absent'].includes(req.body.status)) return res.status(400).json({ success: false, message: 'Choose present, leave or absent.' });
    if (!note) return res.status(400).json({ success: false, message: 'Write the reason.' });
    await req.db.execute(
      `INSERT INTO attendance (employee_id, work_date, status, note, changed_by) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), note = VALUES(note), changed_by = VALUES(changed_by)`,
      [employee.id, date, req.body.status, note, req.user.id]
    );
    return res.json({ success: true, message: 'Saved' });
  } catch (err) {
    console.error('[hr] correction failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not save' });
  }
});

router.get('/attendance/:id(\\d+)/photo/:which(in|out)', requireRight('menu_hr_attendance'), async (req, res) => {
  try {
    const [rows] = await req.db.execute('SELECT employee_id, check_in_photo, check_out_photo FROM attendance WHERE id = ?', [Number(req.params.id)]);
    if (!rows[0] || !(await employeeInScope(req, rows[0].employee_id))) return res.status(404).json({ success: false, message: 'Not found' });
    const name = rows[0][req.params.which === 'in' ? 'check_in_photo' : 'check_out_photo'];
    if (!name) return res.status(404).json({ success: false, message: 'Not found' });
    res.set('Cache-Control', 'private, no-store');
    res.type('image/jpeg');
    return res.sendFile(path.join(PHOTO_ROOT, name), (err) => {
      if (err && !res.headersSent) res.status(404).json({ success: false, message: 'Not found' });
    });
  } catch (err) {
    console.error('[hr] photo failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not load the photo' });
  }
});

router.get('/attendance/trip/:id(\\d+)/photo/:which(out|back)', requireRight('menu_hr_attendance'), async (req, res) => {
  try {
    const [rows] = await req.db.execute(
      `SELECT a.employee_id, t.out_photo, t.back_photo FROM attendance_trips t JOIN attendance a ON a.id = t.attendance_id WHERE t.id = ?`,
      [Number(req.params.id)]
    );
    if (!rows[0] || !(await employeeInScope(req, rows[0].employee_id))) return res.status(404).json({ success: false, message: 'Not found' });
    const name = rows[0][req.params.which === 'out' ? 'out_photo' : 'back_photo'];
    if (!name) return res.status(404).json({ success: false, message: 'Not found' });
    res.set('Cache-Control', 'private, no-store');
    res.type('image/jpeg');
    return res.sendFile(path.join(PHOTO_ROOT, name), (err) => {
      if (err && !res.headersSent) res.status(404).json({ success: false, message: 'Not found' });
    });
  } catch (err) {
    console.error('[hr] trip photo failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not load the photo' });
  }
});

// ---------------------------------------------------------------- payroll

function daysOf(month) {
  const [year, m] = month.split('-').map(Number);
  const total = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return Array.from({ length: total }, (_, i) => {
    const day = String(i + 1).padStart(2, '0');
    return { date: `${month}-${day}`, weekday: new Date(Date.UTC(year, m - 1, i + 1)).getUTCDay() };
  });
}

const lastDayOf = (month) => daysOf(month).pop().date;

// The incentives a person can earn: the list, or the one older single incentive.
function incentiveList(employee) {
  if (employee.incentives) {
    try {
      const list = typeof employee.incentives === 'string' ? JSON.parse(employee.incentives) : employee.incentives;
      if (Array.isArray(list)) return list.filter((i) => i && INCENTIVE_TYPES.includes(i.type) && i.type !== 'none');
    } catch (_e) { /* fall back to the single columns */ }
  }
  if (employee.incentive_type && employee.incentive_type !== 'none') {
    return [{ type: employee.incentive_type, amount: money(employee.incentive_amount), note: employee.incentive_note || null }];
  }
  return [];
}

// Every incentive is checked on its own and all that are earned are paid together.
function incentiveFor(employee, { present, absent, leave = 0, offSoFar = 0, notJoined = 0, deliveries = 0, topPerformer = false }) {
  const lines = incentiveList(employee).map((item) => {
    const amount = money(item.amount);
    let earned = 0;
    switch (item.type) {
      case 'monthly': earned = amount; break;
      case 'per_day': earned = money(amount * present); break;
      case 'per_delivery': earned = money(amount * deliveries); break;
      case 'full_attendance': earned = absent === 0 ? amount : 0; break;
      // Worked every day so far, weekly off and holidays included, with no leave.
      case 'no_day_off': earned = present > 0 && absent === 0 && leave === 0 && offSoFar === 0 && notJoined === 0 ? amount : 0; break;
      // Most delivered orders in the branch this month; riders who tie all earn it.
      case 'top_deliveries': earned = topPerformer && deliveries > 0 ? amount : 0; break;
      default: earned = 0;
    }
    return { type: item.type, amount, note: item.note || null, earned };
  });
  return { total: money(lines.reduce((sum, l) => sum + l.earned, 0)), lines };
}

/**
 * One person's month. Salary is for the whole month, so a day is worth salary / days in the month.
 * Only days lost are deducted: an absent working day, or a day before joining. Weekly off and leave
 * are paid, and days still to come are not counted against anyone. Late days and hours are shown
 * for HR to judge; they take nothing off by themselves (use Deduction).
 */
function monthFigures(employee, records, month, { bonus = 0, deduction = 0, today = ymdIn(), deliveries = 0, topPerformer = false } = {}) {
  const days = daysOf(month);
  const salary = money(employee.monthly_salary);
  const joined = employee.joined_on ? ymdIn(new Date(employee.joined_on)) : null;
  const byDate = new Map(records.map((r) => [r.date, r]));
  const shiftMinutes = employee.shift_start && employee.shift_end ? shiftLength(employee.shift_start, employee.shift_end) : 0;
  let present = 0;
  let leave = 0;
  let absent = 0;
  let off = 0;
  let notJoined = 0;
  let workingDays = 0;
  let workedMinutes = 0;
  let shortMinutes = 0;
  let lateDays = 0;
  let lateMinutes = 0;
  let earlyMinutes = 0;
  let missedOut = 0;
  let offSoFar = 0;
  for (const { date, weekday } of days) {
    if (joined && date < joined) { notJoined += 1; continue; }
    if (employee.weekly_off !== weekday) workingDays += 1;
    const record = byDate.get(date);
    const status = record?.status;
    if (status === 'present') {
      present += 1;
      const late = Number(record.late_minutes || 0);
      if (late) { lateDays += 1; lateMinutes += late; }
      earlyMinutes += Number(record.early_minutes || 0);
      let worked = shiftMinutes; // a day HR entered by hand counts as the full shift
      if (record.checked_in) {
        if (record.span === null || record.span === undefined) {
          worked = 0;
          if (date < today) missedOut += 1;
        } else {
          worked = Math.max(0, Number(record.span) - Number(record.away || 0));
        }
      }
      workedMinutes += worked;
      if (shiftMinutes && date < today) shortMinutes += Math.max(0, shiftMinutes - worked);
    } else if (status === 'leave') leave += 1;
    else if (status === 'absent' && date <= today) absent += 1;
    else if (employee.weekly_off === weekday) { off += 1; if (date <= today) offSoFar += 1; }
    else if (date <= today) absent += 1;
  }
  const perDay = salary / days.length;
  const lost = money(perDay * (absent + notJoined));
  const earned = incentiveFor(employee, { present, absent, leave, offSoFar, notJoined, deliveries, topPerformer });
  const incentive = earned.total;
  const net = Math.max(0, money(salary - lost + incentive + Number(bonus) - Number(deduction)));
  return {
    days_in_month: days.length, working_days: workingDays, present, leave, absent, off, not_joined: notJoined,
    shift_name: employee.shift_name || null,
    worked_minutes: workedMinutes, required_minutes: workingDays * shiftMinutes, short_minutes: shortMinutes,
    late_days: lateDays, late_minutes: lateMinutes, early_minutes: earlyMinutes, missed_checkouts: missedOut,
    incentive_type: employee.incentive_type || 'none', incentive_amount: money(employee.incentive_amount), incentive_note: employee.incentive_note || null,
    incentive_lines: earned.lines, top_performer: Boolean(topPerformer),
    deliveries, incentive,
    salary, absence_deduction: lost, bonus: money(bonus), deduction: money(deduction), net,
  };
}

// Delivered orders per rider, for a per-delivery incentive.
async function deliveriesByRider(db, month, riderIds) {
  if (!riderIds.length) return new Map();
  const [rows] = await db.execute(
    `SELECT rider_id, COUNT(*) AS n FROM orders
      WHERE status = 'delivered' AND created_at >= ? AND created_at < ? + INTERVAL 1 DAY
        AND rider_id IN (${riderIds.map(() => '?').join(', ')}) GROUP BY rider_id`,
    [`${month}-01`, lastDayOf(month), ...riderIds]
  );
  return new Map(rows.map((r) => [Number(r.rider_id), Number(r.n)]));
}

// The rider staff with the most delivered orders in each branch (all who tie).
function topRidersByBranch(riderStaff, delivered) {
  const most = new Map();
  for (const e of riderStaff) {
    const n = delivered.get(Number(e.rider_id)) || 0;
    if (n > (most.get(e.branch_id) || 0)) most.set(e.branch_id, n);
  }
  return new Set(riderStaff.filter((e) => {
    const n = delivered.get(Number(e.rider_id)) || 0;
    return n > 0 && n === most.get(e.branch_id);
  }).map((e) => Number(e.rider_id)));
}

// Best performer for one person, for screens that show a single employee.
async function isTopPerformer(db, month, employee) {
  if (!employee.rider_id) return false;
  const [staff] = await db.execute('SELECT rider_id, branch_id FROM employees WHERE is_active = 1 AND rider_id IS NOT NULL AND branch_id = ?', [employee.branch_id]);
  const delivered = await deliveriesByRider(db, month, staff.map((e) => e.rider_id));
  return topRidersByBranch(staff, delivered).has(Number(employee.rider_id));
}

async function monthRows(db, month, branchId) {
  const [employees] = await db.execute(
    `SELECT e.*, s.name AS shift_name, s.start_time AS shift_start, s.end_time AS shift_end,
            p.bonus, p.deduction, p.note, p.voucher_id, p.snapshot, v.voucher_number, v.status AS voucher_status
       FROM employees e
       LEFT JOIN shifts s ON s.id = e.shift_id
       LEFT JOIN payroll_lines p ON p.employee_id = e.id AND p.month = ?
       LEFT JOIN cash_payment_vouchers v ON v.id = p.voucher_id
      WHERE (e.is_active = 1 OR p.voucher_id IS NOT NULL)${branchId === null ? '' : ' AND e.branch_id = ?'} ORDER BY e.name`,
    branchId === null ? [month] : [month, branchId]
  );
  if (!employees.length) return [];
  const [records] = await db.execute(
    `SELECT a.employee_id, DATE_FORMAT(a.work_date, '%Y-%m-%d') AS date, a.status, a.late_minutes, a.early_minutes,
            a.check_in_at IS NOT NULL AS checked_in, TIMESTAMPDIFF(MINUTE, a.check_in_at, a.check_out_at) AS span,
            (SELECT COALESCE(SUM(TIMESTAMPDIFF(MINUTE, t.out_at, t.back_at)), 0) FROM attendance_trips t
              WHERE t.attendance_id = a.id AND t.reason NOT IN (${DUTY_TRIPS.map(() => '?').join(', ')})) AS away
       FROM attendance a
      WHERE a.work_date BETWEEN ? AND LAST_DAY(?) AND a.employee_id IN (${employees.map(() => '?').join(', ')})`,
    [...DUTY_TRIPS, `${month}-01`, `${month}-01`, ...employees.map((e) => e.id)]
  );
  const riderStaff = employees.filter((e) => e.rider_id && e.is_active);
  const delivered = await deliveriesByRider(db, month, employees.filter((e) => e.rider_id).map((e) => e.rider_id));
  const best = topRidersByBranch(riderStaff, delivered);
  return employees.map((e) => {
    // Once a voucher exists the line is frozen at what was sent, unless that voucher was cancelled.
    const frozen = e.voucher_id && e.voucher_status !== 'cancelled' && e.snapshot ? JSON.parse(e.snapshot) : null;
    const figures = frozen || monthFigures(e, records.filter((r) => r.employee_id === e.id), month, { bonus: e.bonus || 0, deduction: e.deduction || 0, deliveries: delivered.get(Number(e.rider_id)) || 0, topPerformer: best.has(Number(e.rider_id)) });
    return {
      employee_id: e.id, name: e.name, designation: e.designation, branch_id: e.branch_id, user_id: e.user_id, rider_id: e.rider_id,
      ...figures, note: e.note, voucher_number: frozen ? e.voucher_number : null, voucher_status: frozen ? e.voucher_status : null, locked: Boolean(frozen),
    };
  });
}

router.get('/attendance/monthly', requireRight('menu_hr_attendance', 'menu_hr_payroll'), async (req, res) => {
  try {
    const branchId = branchOf(req, res);
    if (branchId === undefined) return undefined;
    const month = validMonth(req.query.month) || ymdIn().slice(0, 7);
    const rows = await monthRows(req.db, month, branchId);
    return res.json({
      success: true,
      month,
      attendance: rows.map(({ employee_id, name, designation, days_in_month, working_days, present, leave, absent, off, late_days, worked_minutes, required_minutes, shift_name }) => ({
        employee_id, name, designation, days_in_month, working_days, present, leave, absent, off, late_days, worked_minutes, required_minutes, shift_name,
      })),
    });
  } catch (err) {
    console.error('[hr] monthly failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not load the month' });
  }
});

router.get('/payroll', requireRight('menu_hr_payroll'), async (req, res) => {
  try {
    const branchId = branchOf(req, res);
    if (branchId === undefined) return undefined;
    const month = validMonth(req.query.month) || ymdIn().slice(0, 7);
    const rows = await monthRows(req.db, month, branchId);
    const total = (key) => money(rows.reduce((n, r) => n + Number(r[key] || 0), 0));
    return res.json({
      success: true,
      month,
      payroll: rows,
      opens_on: lastDayOf(month),
      can_generate: ymdIn() >= lastDayOf(month),
      totals: { salary: total('salary'), absence_deduction: total('absence_deduction'), incentive: total('incentive'), bonus: total('bonus'), deduction: total('deduction'), net: total('net') },
    });
  } catch (err) {
    console.error('[hr] payroll failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not load payroll' });
  }
});

router.put('/payroll/:employeeId(\\d+)', requireRight('menu_hr_payroll'), async (req, res) => {
  try {
    const month = validMonth(req.body.month);
    if (!month) return res.status(400).json({ success: false, message: 'Choose a month.' });
    const employee = await employeeInScope(req, req.params.employeeId);
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });
    const bonus = Number(req.body.bonus || 0);
    const deduction = Number(req.body.deduction || 0);
    if (!Number.isFinite(bonus) || bonus < 0 || !Number.isFinite(deduction) || deduction < 0) {
      return res.status(400).json({ success: false, message: 'Bonus and deduction must be positive amounts.' });
    }
    const line = (await monthRows(req.db, month, toBranchId(employee.branch_id))).find((r) => r.employee_id === employee.id);
    if (line?.locked) return res.status(409).json({ success: false, message: 'A voucher already exists for this month.' });
    await req.db.execute(
      `INSERT INTO payroll_lines (month, employee_id, bonus, deduction, note) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE bonus = VALUES(bonus), deduction = VALUES(deduction), note = VALUES(note), voucher_id = NULL, snapshot = NULL`,
      [month, employee.id, bonus, deduction, String(req.body.note || '').trim().slice(0, 200) || null]
    );
    return res.json({ success: true, message: 'Saved' });
  } catch (err) {
    console.error('[hr] payroll save failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not save' });
  }
});

const voucherNumber = () => {
  const day = new Date().toISOString().split('T')[0].replace(/-/g, '');
  return `CPV-${day}-${crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase()}`;
};

// Sends one person's month to the normal voucher flow as a draft. The ledger posts it when it is paid.
router.post('/payroll/:employeeId(\\d+)/voucher', requireRight('menu_hr_payroll'), async (req, res) => {
  const month = validMonth(req.body.month);
  if (!month) return res.status(400).json({ success: false, message: 'Choose a month.' });
  let conn;
  try {
    const employee = await employeeInScope(req, req.params.employeeId);
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });
    const line = (await monthRows(req.db, month, toBranchId(employee.branch_id))).find((r) => r.employee_id === employee.id);
    if (!line) return res.status(404).json({ success: false, message: 'Employee not found' });
    if (line.locked) return res.status(409).json({ success: false, message: `Voucher ${line.voucher_number} already exists for this month.` });
    if (ymdIn() < lastDayOf(month)) {
      return res.status(409).json({ success: false, message: `Payroll for ${month} opens on the last day of the month, ${lastDayOf(month)}.` });
    }
    if (line.net <= 0) return res.status(400).json({ success: false, message: 'There is nothing to pay for this month.' });

    conn = await req.db.getConnection();
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO payroll_lines (month, employee_id, bonus, deduction, note) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [month, employee.id, line.bonus, line.deduction, line.note || null]
    );
    const [[held]] = await conn.execute(
      `SELECT p.voucher_id, v.status FROM payroll_lines p LEFT JOIN cash_payment_vouchers v ON v.id = p.voucher_id
        WHERE p.month = ? AND p.employee_id = ? FOR UPDATE`,
      [month, employee.id]
    );
    if (held.voucher_id && held.status !== 'cancelled') {
      await conn.rollback();
      return res.status(409).json({ success: false, message: 'A voucher already exists for this month.' });
    }
    const number = voucherNumber();
    const rider = Boolean(employee.rider_id);
    // No payee id for staff: a salary is not a wallet payment, and the voucher must not touch one.
    const [voucher] = await conn.execute(
      `INSERT INTO cash_payment_vouchers
         (voucher_number, voucher_date, payee_name, payee_type, payee_id, amount, purpose, description, payment_method, status, prepared_by, branch_id, gl_account_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'cash', 'draft', ?, ?, ?)`,
      [number, ymdIn(), employee.name, rider ? 'rider' : 'employee', rider ? employee.rider_id : null, line.net,
        `Salary ${month}`, `Payroll: worked ${line.present} of ${line.working_days} days, ${line.leave} leave, ${line.absent} absent, incentive ${line.incentive}`, req.user.id, employee.branch_id, SALARY_ACCOUNT]
    );
    const { employee_id: _id, name: _name, designation: _role, branch_id: _branch, user_id: _user, rider_id: _rider, note: _note, voucher_number: _number, voucher_status: _status, locked: _locked, ...figures } = line;
    const snapshot = JSON.stringify(figures);
    await conn.execute('UPDATE payroll_lines SET voucher_id = ?, snapshot = ? WHERE month = ? AND employee_id = ?', [voucher.insertId, snapshot, month, employee.id]);
    await conn.commit();
    return res.status(201).json({ success: true, voucher_number: number, message: `Draft voucher ${number} created. Approve it in Payment Vouchers.` });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('[hr] voucher failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not create the voucher' });
  } finally {
    if (conn) conn.release();
  }
});

router.monthFigures = monthFigures;
router.matchFace = matchFace;
// For the assistant (services/assistantHr.js): the same tables, day, reasons and shift rule as this screen.
router.hr = { ensureTables, ymdIn, reasonLabel, daysOf, deliveriesByRider, incentiveList, isTopPerformer, TIME_ZONE, OPEN_SHIFT_HOURS, HOME };
router.lateBy = lateBy;
router.earlyBy = earlyBy;
router.shiftLength = shiftLength;

module.exports = router;
