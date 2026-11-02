// Admin page: Employees, Attendance and Payroll. Every rule is on the server (routes/hr.js).
(function () {
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rupees = (value) => `Rs ${Number(value || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`;
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
  const time = (value) => (value ? new Date(value).toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit' }) : '-');

  async function api(path, options = {}) {
    const response = await fetch(`/api/hr${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('serveNowToken')}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.message || 'Something went wrong');
    return data;
  }

  const failed = (error) => showError('Error', error.message);

  const ICONS = { day: 'fa-calendar-day', month: 'fa-calendar-alt', kiosk: 'fa-desktop', staff: 'fa-users', pay: 'fa-wallet' };

  function avatar(name) {
    const words = String(name || '?').trim().split(/\s+/);
    const letters = `${words[0][0] || '?'}${words.length > 1 ? words[words.length - 1][0] : ''}`.toUpperCase();
    const shade = [...String(name || '')].reduce((n, c) => n + c.charCodeAt(0), 0) % 5;
    return `<span class="hr-ava hr-ava-${shade}" data-rt-skip>${esc(letters)}</span>`;
  }
  const person = (name, sub) => `<div class="hr-person">${avatar(name)}<div><b>${esc(name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div></div>`;
  const pill = (kind, text) => `<span class="hr-pill ${kind}">${esc(text)}</span>`;
  const empty = (columns, icon, text) => `<tr><td colspan="${columns}" class="hr-empty"><i class="fas ${icon}"></i>${esc(text)}</td></tr>`;
  const loadingRow = (columns) => `<tr><td colspan="${columns}" class="hr-empty">Loading...</td></tr>`;
  const meter = (percent) => `<div class="hr-meter"><span style="width:${Math.max(0, Math.min(100, percent))}%"></span></div>`;
  const percentOf = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

  function kpi({ label, value, note, tone, icon, bar }) {
    return `<div class="hr-kpi ${tone || ''}">
      <div class="hr-kpi-top"><span class="hr-kpi-label">${esc(label)}</span><span class="hr-kpi-icon"><i class="fas ${icon}"></i></span></div>
      <div class="hr-kpi-value">${esc(value)}</div>
      ${bar === undefined ? '' : meter(bar)}
      ${note ? `<div class="hr-kpi-note">${esc(note)}</div>` : ''}
    </div>`;
  }

  // ------------------------------------------------------------ employees
  let employees = [];
  let canSeePay = false;

  let employeeFilter = 'all';

  function employeeRow(e) {
    return `<tr>
      <td>${person(e.name, e.designation || '')}</td>
      <td>${e.rider_id ? 'Rider login' : e.user_id ? 'Staff login' : '<span class="hr-none">No login</span>'}</td>
      <td>${esc(e.branch_name || '-')}</td>
      <td class="hr-pay-only hr-num" style="${canSeePay ? '' : 'display:none'}">${rupees(e.monthly_salary)}</td>
      <td>${e.is_active ? pill('good', 'Active') : pill('', 'Left')}</td>
      <td>${e.face_samples ? pill('good', 'Enrolled') : pill('warn', 'Not enrolled')}</td>
      <td><div class="hr-row-actions"><button type="button" class="btn-small btn-info" data-hr-edit="${e.id}">Edit</button>
        ${e.is_active ? `<button type="button" class="btn-small btn-success" data-hr-face="${e.id}">${e.face_samples ? 'Enroll Again' : 'Enroll Face'}</button>` : ''}
        ${e.face_samples ? `<button type="button" class="btn-small btn-danger" data-hr-face-remove="${e.id}">Remove Face</button>` : ''}</div></td>
    </tr>`;
  }

  function showEmployees() {
    const words = $('hrEmployeeSearch').value.trim().toLowerCase();
    const rows = employees.filter((e) => {
      if (employeeFilter === 'active' && !e.is_active) return false;
      if (employeeFilter === 'left' && e.is_active) return false;
      if (employeeFilter === 'noface' && (!e.is_active || e.face_samples)) return false;
      return !words || `${e.name} ${e.designation || ''}`.toLowerCase().includes(words);
    });
    $('hrEmployeeCount').textContent = `${rows.length} of ${employees.length} shown`;
    $('hrEmployeesBody').innerHTML = rows.map(employeeRow).join('')
      || empty(7, 'fa-users', employees.length ? 'Nobody matches this search.' : 'No employees yet. Press Add Employee.');
  }

  function employeeKpis() {
    const active = employees.filter((e) => e.is_active);
    const enrolled = active.filter((e) => e.face_samples).length;
    const linked = active.filter((e) => e.rider_id || e.user_id).length;
    const cards = [
      { label: 'Active staff', value: active.length, note: `${employees.length - active.length} left`, icon: ICONS.staff, tone: 'good' },
      { label: 'Face enrolled', value: `${enrolled} / ${active.length}`, bar: percentOf(enrolled, active.length), icon: 'fa-user-check', tone: enrolled < active.length ? 'warn' : 'good' },
      { label: 'With a login', value: `${linked} / ${active.length}`, bar: percentOf(linked, active.length), icon: 'fa-id-badge', tone: 'info' },
    ];
    if (canSeePay) {
      cards.push({ label: 'Monthly salaries', value: rupees(active.reduce((n, e) => n + Number(e.monthly_salary || 0), 0)), note: 'Active staff', icon: ICONS.pay, tone: 'lead' });
    }
    $('hrEmployeeKpis').innerHTML = cards.map(kpi).join('');
  }

  async function loadHrEmployees() {
    const body = $('hrEmployeesBody');
    body.innerHTML = loadingRow(7);
    try {
      const data = await api('/employees');
      employees = data.employees;
      canSeePay = data.can_see_pay;
      document.querySelectorAll('.hr-pay-only').forEach((el) => { el.style.display = canSeePay ? '' : 'none'; });
      employeeKpis();
      showEmployees();
    } catch (error) {
      body.innerHTML = empty(7, 'fa-exclamation-circle', 'Could not load employees.');
      failed(error);
    }
  }

  async function fillLinks(current) {
    const box = $('hrEmployeeLink');
    box.innerHTML = '<option value="">No login (HR marks attendance)</option>';
    if (current) box.add(new Option(current.label, current.value));
    const { staff, riders } = await api('/accounts');
    staff.forEach((a) => box.add(new Option(`Staff: ${a.name}`, `user:${a.id}`)));
    riders.forEach((a) => box.add(new Option(`Rider: ${a.name}`, `rider:${a.id}`)));
    box.value = current ? current.value : '';
  }

  function linkOf(e) {
    if (e.rider_id) return { value: `rider:${e.rider_id}`, label: `Rider: ${e.name}` };
    if (e.user_id) return { value: `user:${e.user_id}`, label: `Staff: ${e.name}` };
    return null;
  }

  async function openEmployee(employee) {
    const e = employee || {};
    $('hrEmployeeId').value = e.id || '';
    $('hrEmployeeName').value = e.name || '';
    $('hrEmployeeDesignation').value = e.designation || '';
    $('hrEmployeePhone').value = e.phone || '';
    $('hrEmployeeSalary').value = e.monthly_salary ?? '';
    $('hrEmployeeOff').value = e.weekly_off ?? '';
    $('hrEmployeeJoined').value = e.joined_on ? new Date(e.joined_on).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }) : '';
    $('hrEmployeeActive').value = e.id && !e.is_active ? '0' : '1';
    $('hrEmployeeActiveGroup').style.display = e.id ? '' : 'none';
    document.querySelector('#hrEmployeeModal h2').textContent = e.id ? 'Edit Employee' : 'Add Employee';
    try {
      await fillLinks(e.id ? linkOf(e) : null);
    } catch (error) {
      failed(error);
    }
    openModal('hrEmployeeModal');
  }

  async function saveEmployee(event) {
    event.preventDefault();
    const id = $('hrEmployeeId').value;
    const payload = {
      name: $('hrEmployeeName').value,
      designation: $('hrEmployeeDesignation').value,
      phone: $('hrEmployeePhone').value,
      weekly_off: $('hrEmployeeOff').value,
      joined_on: $('hrEmployeeJoined').value,
      link: $('hrEmployeeLink').value,
      is_active: $('hrEmployeeActive').value === '1',
    };
    if (canSeePay) payload.monthly_salary = $('hrEmployeeSalary').value || 0;
    try {
      const data = await api(id ? `/employees/${id}` : '/employees', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      showSuccess('Saved', data.message);
      closeModal('hrEmployeeModal');
      loadHrEmployees();
    } catch (error) {
      failed(error);
    }
  }

  // ------------------------------------------------------------ face enrolment
  const FACE_SAMPLES = 5;
  const FACE_MIN_PX = 110;
  const FACE_TIME_LIMIT_MS = 45 * 1000;
  let enrolling = null;

  const faceStatus = (text) => { $('hrFaceStatus').textContent = text; };
  const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

  function stopEnrolling() {
    if (enrolling?.stream) enrolling.stream.getTracks().forEach((track) => track.stop());
    enrolling = null;
    $('hrFaceVideo').srcObject = null;
    closeModal('hrFaceModal');
  }

  async function enrollFace(employee) {
    const run = { stream: null };
    enrolling = run;
    $('hrFaceTitle').textContent = `Enroll ${employee.name}`;
    faceStatus('Starting camera...');
    openModal('hrFaceModal');
    try {
      run.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false });
      const video = $('hrFaceVideo');
      video.srcObject = run.stream;
      await video.play();
      faceStatus('Loading face recognition...');
      await window.ServeNowFace.load();
      const samples = [];
      const until = Date.now() + FACE_TIME_LIMIT_MS;
      while (samples.length < FACE_SAMPLES && enrolling === run && Date.now() < until) {
        const seen = await window.ServeNowFace.read(video);
        if (enrolling !== run) return;
        if (seen.count === 1 && seen.width >= FACE_MIN_PX) {
          samples.push(seen.descriptor);
          faceStatus(`Hold still, and turn your head a little. ${samples.length} of ${FACE_SAMPLES}`);
          await wait(600);
        } else {
          faceStatus(seen.count > 1 ? 'Only one person should be in the picture.' : seen.count ? 'Come closer to the camera.' : 'Look at the camera.');
          await wait(300);
        }
      }
      if (enrolling !== run) return;
      if (samples.length < FACE_SAMPLES) throw new Error('No clear face was found. Check the light and try again.');
      faceStatus('Saving...');
      const data = await api(`/employees/${employee.id}/face`, { method: 'POST', body: JSON.stringify({ descriptors: samples }) });
      showSuccess('Enrolled', data.message);
      stopEnrolling();
      loadHrEmployees();
    } catch (error) {
      if (enrolling === run) stopEnrolling();
      showError('Error', error.name === 'NotAllowedError' ? 'Allow the camera for this site.' : error.message);
    }
  }

  async function removeFace(employee) {
    if (!window.confirm(`Remove the face of ${employee.name}?`)) return;
    try {
      const data = await api(`/employees/${employee.id}/face`, { method: 'DELETE' });
      showSuccess('Removed', data.message);
      loadHrEmployees();
    } catch (error) {
      failed(error);
    }
  }

  // ------------------------------------------------------------ attendance
  const STATUS = {
    present: ['good', 'Present'],
    absent: ['bad', 'Absent'],
    leave: ['info', 'Leave'],
    off: ['', 'Weekly off'],
    upcoming: ['', 'Upcoming'],
    not_marked: ['warn', 'Not marked yet'],
  };

  function place(lat, lng, accuracy) {
    if (lat == null) return '';
    const within = accuracy ? ` (within ${accuracy} m)` : '';
    return `<a href="https://www.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(lng)}" target="_blank" rel="noopener">Map</a>${esc(within)}`;
  }

  function mark(row, which) {
    const at = which === 'in' ? row.check_in_at : row.check_out_at;
    if (!at) return '<span class="hr-none">-</span>';
    const source = which === 'in' ? row.check_in_source : row.check_out_source;
    const hasPhoto = which === 'in' ? row.has_in_photo : row.has_out_photo;
    const map = which === 'in' ? place(row.check_in_latitude, row.check_in_longitude, row.check_in_accuracy) : place(row.check_out_latitude, row.check_out_longitude, row.check_out_accuracy);
    const photo = hasPhoto ? `<a href="#" data-hr-photo="${row.id}/${which}">Photo</a>` : '';
    const why = which === 'out' && row.check_out_reason ? `<span class="hr-sub">${esc(row.check_out_reason)}</span>` : '';
    const links = [photo, map].filter(Boolean).join(' · ');
    return `<div class="hr-time"><b>${esc(time(at))}</b><span class="hr-src">${esc({ phone: 'Phone', kiosk: 'Kiosk' }[source] || 'PC')}</span></div>${why}
      ${links ? `<div class="hr-links" data-rt-skip>${links}</div>` : ''}`;
  }

  // Each time this person went out and came back.
  const tripList = (row) => row.trips.map((t) => `<span class="hr-trip">${esc(t.reason)}: ${esc(time(t.out_at))} to ${esc(time(t.back_at))}<span data-rt-skip>
      ${t.has_out_photo ? `<a href="#" data-hr-photo="trip/${t.id}/out">Out</a>` : ''}
      ${t.has_back_photo ? `<a href="#" data-hr-photo="trip/${t.id}/back">Back</a>` : ''}</span></span>`).join('');

  function attendanceRow(r) {
    const [kind, label] = STATUS[r.day_status] || ['', r.day_status];
    const inside = r.check_in_at && !r.check_out_at;
    return `<tr>
      <td>${person(r.name, r.designation || '')}</td>
      <td>${pill(kind, label)}${inside ? '<span class="hr-sub">In now</span>' : ''}</td>
      <td>${mark(r, 'in')}</td>
      <td>${mark(r, 'out')}</td>
      <td>${tripList(r)}${r.note ? `<span class="hr-sub">${esc(r.note)}</span>` : (r.trips.length ? '' : '<span class="hr-none">-</span>')}</td>
      <td><div class="hr-row-actions"><button type="button" class="btn-small btn-info" data-hr-correct="${r.employee_id}" data-hr-name="${esc(r.name)}">Correct</button></div></td>
    </tr>`;
  }

  function attendanceKpis(s, rows) {
    const inNow = rows.filter((r) => r.check_in_at && !r.check_out_at).length;
    return [
      { label: 'Present', value: s.present, bar: percentOf(s.present, s.employees), note: `${percentOf(s.present, s.employees)}% of ${s.employees}`, icon: 'fa-user-check', tone: 'lead' },
      { label: 'In now', value: inNow, note: `${s.present - inNow} checked out`, icon: 'fa-door-open', tone: 'good' },
      { label: 'Not marked', value: s.not_marked, note: 'Yet to arrive', icon: 'fa-hourglass-half', tone: s.not_marked ? 'warn' : '' },
      { label: 'Absent', value: s.absent, icon: 'fa-user-times', tone: s.absent ? 'bad' : '' },
      { label: 'On leave', value: s.leave, icon: 'fa-umbrella-beach', tone: 'info' },
      { label: 'Weekly off', value: s.off, icon: 'fa-bed' },
    ].map(kpi).join('');
  }

  const longDate = (ymd) => new Date(`${ymd}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const longMonth = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  async function loadHrAttendance() {
    const dateBox = $('hrAttendanceDate');
    if (!dateBox.value) dateBox.value = today();
    const body = $('hrAttendanceBody');
    body.innerHTML = loadingRow(6);
    try {
      const data = await api(`/attendance?date=${encodeURIComponent(dateBox.value)}`);
      $('hrAttendanceSummary').textContent = longDate(dateBox.value);
      $('hrAttendanceKpis').innerHTML = attendanceKpis(data.summary, data.attendance);
      body.innerHTML = data.attendance.map(attendanceRow).join('') || empty(6, ICONS.day, 'No employees yet. Add them under Employees.');
    } catch (error) {
      body.innerHTML = empty(6, 'fa-exclamation-circle', 'Could not load attendance.');
      failed(error);
    }
    loadHrMonth();
    loadHrKiosks();
  }

  function shiftDay(step) {
    const box = $('hrAttendanceDate');
    if (step === 0) box.value = today();
    else {
      const next = new Date(`${box.value || today()}T12:00:00Z`);
      next.setUTCDate(next.getUTCDate() + step);
      box.value = next.toISOString().slice(0, 10);
    }
    loadHrAttendance();
  }

  function shiftMonth(step) {
    const box = $('hrPayrollMonth');
    const [year, month] = (box.value || today().slice(0, 7)).split('-').map(Number);
    const next = new Date(Date.UTC(year, month - 1 + step, 1));
    box.value = next.toISOString().slice(0, 7);
    loadHrPayroll();
  }

  const VIEW_TITLES = { Day: 'Daily attendance', Month: 'Month summary', Kiosk: 'Kiosk screens' };

  function showView(name) {
    Object.keys(VIEW_TITLES).forEach((key) => { $(`hrView${key}`).hidden = key !== name; });
    document.querySelectorAll('[data-hr-view]').forEach((b) => b.classList.toggle('is-on', b.dataset.hrView === name));
    $('hrViewTitle').textContent = name === 'Month' ? `${VIEW_TITLES.Month}, ${longMonth(($('hrAttendanceDate').value || today()).slice(0, 7))}` : VIEW_TITLES[name];
  }

  async function loadHrKiosks() {
    const body = $('hrKioskBody');
    try {
      const { devices } = await api('/kiosk/devices');
      body.innerHTML = devices.map((d) => `<tr>
          <td><b>${esc(d.name)}</b></td>
          <td>${esc(d.branch_name || '-')}</td>
          <td>${d.last_used_at ? esc(new Date(d.last_used_at).toLocaleString('en-PK')) : pill('warn', 'Not yet')}</td>
          <td><div class="hr-row-actions"><button type="button" class="btn-small btn-danger" data-hr-kiosk-remove="${d.id}">Remove</button></div></td>
        </tr>`).join('') || empty(4, ICONS.kiosk, 'No kiosk yet. Press Set Up Kiosk on the office PC.');
    } catch (error) {
      body.innerHTML = empty(4, 'fa-exclamation-circle', 'Could not load kiosk screens.');
    }
  }

  async function setUpKiosk() {
    const name = window.prompt('Name this screen, for example Office Reception', 'Office PC');
    if (name === null) return;
    try {
      const data = await api('/kiosk/devices', { method: 'POST', body: JSON.stringify({ name }) });
      localStorage.setItem('serveNowKioskKey', data.key);
      window.location.href = 'kiosk.html';
    } catch (error) {
      failed(error);
    }
  }

  async function removeKiosk(id) {
    if (!window.confirm('Remove this kiosk screen? It stops working at once.')) return;
    try {
      const data = await api(`/kiosk/devices/${id}`, { method: 'DELETE' });
      showSuccess('Removed', data.message);
      loadHrKiosks();
    } catch (error) {
      failed(error);
    }
  }

  async function loadHrMonth() {
    const body = $('hrMonthBody');
    const month = ($('hrAttendanceDate').value || today()).slice(0, 7);
    try {
      const data = await api(`/attendance/monthly?month=${month}`);
      if (!$('hrViewMonth').hidden) $('hrViewTitle').textContent = `${VIEW_TITLES.Month}, ${longMonth(month)}`;
      body.innerHTML = data.attendance.map((r) => {
        const rate = percentOf(Number(r.present) + Number(r.leave), Number(r.present) + Number(r.leave) + Number(r.absent));
        return `<tr><td>${person(r.name)}</td><td class="hr-num">${r.present}</td><td class="hr-num">${r.leave}</td><td class="hr-num">${r.absent}</td><td class="hr-num">${r.off}</td>
          <td><div class="hr-rate">${meter(rate)}<b>${rate}%</b></div></td></tr>`;
      }).join('') || empty(6, ICONS.month, 'Nothing yet.');
    } catch (error) {
      body.innerHTML = empty(6, 'fa-exclamation-circle', 'Could not load the month.');
    }
  }

  async function showPhoto(path) {
    try {
      const url = path.startsWith('trip/') ? path.replace(/^trip\/(\d+)\//, 'trip/$1/photo/') : path.replace('/', '/photo/');
      const response = await fetch(`/api/hr/attendance/${url}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('serveNowToken')}` },
      });
      if (!response.ok) throw new Error('This photo could not be loaded.');
      const image = $('hrPhotoImage');
      if (image.src.startsWith('blob:')) URL.revokeObjectURL(image.src);
      image.src = URL.createObjectURL(await response.blob());
      openModal('hrPhotoModal');
    } catch (error) {
      failed(error);
    }
  }

  function openCorrection(employeeId, name) {
    $('hrCorrectEmployee').value = employeeId;
    $('hrCorrectName').textContent = `${name}, ${$('hrAttendanceDate').value}`;
    $('hrCorrectStatus').value = 'present';
    $('hrCorrectNote').value = '';
    openModal('hrCorrectModal');
  }

  async function saveCorrection(event) {
    event.preventDefault();
    try {
      const data = await api('/attendance', {
        method: 'PUT',
        body: JSON.stringify({
          employee_id: $('hrCorrectEmployee').value,
          date: $('hrAttendanceDate').value,
          status: $('hrCorrectStatus').value,
          note: $('hrCorrectNote').value,
        }),
      });
      showSuccess('Saved', data.message);
      closeModal('hrCorrectModal');
      loadHrAttendance();
    } catch (error) {
      failed(error);
    }
  }

  // ------------------------------------------------------------ payroll
  function payrollRow(r) {
    const lockedValue = (value) => esc(rupees(value));
    const money = (name, value) => `<input type="number" min="0" step="1" class="form-control hr-money-input ${name}" value="${Number(value)}" aria-label="${name === 'hr-bonus' ? 'Bonus' : 'Deduction'}">`;
    return `<tr data-hr-pay="${r.employee_id}">
      <td>${person(r.name, `${r.present} present, ${r.leave} leave, ${r.off} off`)}</td>
      <td class="hr-num">${rupees(r.salary)}</td>
      <td class="hr-num">${r.absent + r.not_joined}</td>
      <td class="hr-num">${rupees(r.absence_deduction)}</td>
      <td class="hr-num">${r.locked ? lockedValue(r.bonus) : money('hr-bonus', r.bonus)}</td>
      <td class="hr-num">${r.locked ? lockedValue(r.deduction) : money('hr-deduction', r.deduction)}</td>
      <td class="hr-num hr-net">${rupees(r.net)}</td>
      <td>${r.locked ? `<div class="hr-voucher"><b>${esc(r.voucher_number)}</b>${pill('good', r.voucher_status)}</div>` : '<div class="hr-row-actions" style="justify-content:flex-start"><button type="button" class="btn-small btn-success" data-hr-voucher="1">Create voucher</button></div>'}</td>
    </tr>`;
  }

  async function loadHrPayroll() {
    const monthBox = $('hrPayrollMonth');
    if (!monthBox.value) monthBox.value = today().slice(0, 7);
    const body = $('hrPayrollBody');
    const foot = $('hrPayrollFoot');
    body.innerHTML = loadingRow(8);
    foot.innerHTML = '';
    try {
      const data = await api(`/payroll?month=${monthBox.value}`);
      const t = data.totals;
      const rows = data.payroll;
      const paid = rows.filter((r) => r.locked).length;
      body.innerHTML = rows.map(payrollRow).join('') || empty(8, ICONS.pay, 'No employees yet.');
      if (rows.length) {
        foot.innerHTML = `<tr><td>Total</td><td class="hr-num">${rupees(t.salary)}</td><td></td><td class="hr-num">${rupees(t.absence_deduction)}</td>
          <td class="hr-num">${rupees(t.bonus)}</td><td class="hr-num">${rupees(t.deduction)}</td><td class="hr-num hr-net">${rupees(t.net)}</td><td></td></tr>`;
      }
      $('hrPayrollTotals').textContent = `${longMonth(monthBox.value)}: ${rows.length} employees`;
      $('hrPayrollKpis').innerHTML = [
        { label: 'Net pay', value: rupees(t.net), note: longMonth(monthBox.value), icon: ICONS.pay, tone: 'lead' },
        { label: 'Salaries', value: rupees(t.salary), icon: 'fa-money-bill-wave', tone: 'good' },
        { label: 'Absence', value: rupees(t.absence_deduction), icon: 'fa-user-times', tone: Number(t.absence_deduction) ? 'bad' : '' },
        { label: 'Bonus', value: rupees(t.bonus), icon: 'fa-gift', tone: 'info' },
        { label: 'Deductions', value: rupees(t.deduction), icon: 'fa-minus-circle', tone: Number(t.deduction) ? 'warn' : '' },
        { label: 'Vouchers', value: `${paid} / ${rows.length}`, bar: percentOf(paid, rows.length), icon: 'fa-file-invoice', tone: 'good' },
      ].map(kpi).join('');
    } catch (error) {
      body.innerHTML = empty(8, 'fa-exclamation-circle', 'Could not load payroll.');
      failed(error);
    }
  }

  async function savePayLine(row) {
    await api(`/payroll/${row.dataset.hrPay}`, {
      method: 'PUT',
      body: JSON.stringify({
        month: $('hrPayrollMonth').value,
        bonus: row.querySelector('.hr-bonus').value || 0,
        deduction: row.querySelector('.hr-deduction').value || 0,
      }),
    });
  }

  async function createVoucher(row) {
    try {
      await savePayLine(row);
      const data = await api(`/payroll/${row.dataset.hrPay}/voucher`, { method: 'POST', body: JSON.stringify({ month: $('hrPayrollMonth').value }) });
      showSuccess('Voucher created', data.message);
    } catch (error) {
      failed(error);
    }
    loadHrPayroll();
  }

  // ------------------------------------------------------------ events
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (target.closest?.('#hrAddEmployee')) openEmployee(null);
    if (target.closest?.('#hrSetUpKiosk')) setUpKiosk();
    if (target.closest?.('#hrFaceCancel')) stopEnrolling();
    const face = target.closest?.('[data-hr-face]');
    if (face) enrollFace(employees.find((e) => e.id === Number(face.dataset.hrFace)));
    const faceRemove = target.closest?.('[data-hr-face-remove]');
    if (faceRemove) removeFace(employees.find((e) => e.id === Number(faceRemove.dataset.hrFaceRemove)));
    const kioskRemove = target.closest?.('[data-hr-kiosk-remove]');
    if (kioskRemove) removeKiosk(kioskRemove.dataset.hrKioskRemove);
    const edit = target.closest?.('[data-hr-edit]');
    if (edit) openEmployee(employees.find((e) => e.id === Number(edit.dataset.hrEdit)));
    const photo = target.closest?.('[data-hr-photo]');
    if (photo) {
      event.preventDefault();
      showPhoto(photo.dataset.hrPhoto);
    }
    const filter = target.closest?.('[data-hr-filter]');
    if (filter) {
      employeeFilter = filter.dataset.hrFilter;
      document.querySelectorAll('[data-hr-filter]').forEach((b) => b.classList.toggle('is-on', b === filter));
      showEmployees();
    }
    const view = target.closest?.('[data-hr-view]');
    if (view) showView(view.dataset.hrView);
    const day = target.closest?.('[data-hr-day]');
    if (day) shiftDay(Number(day.dataset.hrDay));
    const month = target.closest?.('[data-hr-month]');
    if (month) shiftMonth(Number(month.dataset.hrMonth));
    const correct = target.closest?.('[data-hr-correct]');
    if (correct) openCorrection(correct.dataset.hrCorrect, correct.dataset.hrName);
    const voucher = target.closest?.('[data-hr-voucher]');
    if (voucher) createVoucher(voucher.closest('tr'));
  });

  document.addEventListener('change', (event) => {
    if (event.target.id === 'hrAttendanceDate') loadHrAttendance();
    if (event.target.id === 'hrPayrollMonth') loadHrPayroll();
    if (event.target.classList?.contains('hr-bonus') || event.target.classList?.contains('hr-deduction')) {
      savePayLine(event.target.closest('tr')).then(loadHrPayroll).catch(failed);
    }
  });

  document.addEventListener('input', (event) => {
    if (event.target.id === 'hrEmployeeSearch') showEmployees();
  });

  document.addEventListener('DOMContentLoaded', () => {
    $('hrEmployeeOff').innerHTML = `<option value="">No weekly off</option>${WEEKDAYS.map((d, i) => `<option value="${i}">${d}</option>`).join('')}`;
    $('hrEmployeeForm').addEventListener('submit', saveEmployee);
    $('hrCorrectForm').addEventListener('submit', saveCorrection);
  });

  window.loadHrEmployees = loadHrEmployees;
  window.loadHrAttendance = loadHrAttendance;
  window.loadHrPayroll = loadHrPayroll;
})();
