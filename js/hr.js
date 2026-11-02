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

  // ------------------------------------------------------------ employees
  let employees = [];
  let canSeePay = false;

  async function loadHrEmployees() {
    const body = $('hrEmployeesBody');
    body.innerHTML = '<tr><td colspan="8">Loading...</td></tr>';
    try {
      const data = await api('/employees');
      employees = data.employees;
      canSeePay = data.can_see_pay;
      document.querySelectorAll('.hr-pay-only').forEach((el) => { el.style.display = canSeePay ? '' : 'none'; });
      body.innerHTML = employees.map((e) => `<tr>
          <td>${esc(e.name)}</td>
          <td>${esc(e.designation || '-')}</td>
          <td>${e.rider_id ? 'Rider login' : e.user_id ? 'Staff login' : 'No login'}</td>
          <td>${esc(e.branch_name || '-')}</td>
          <td class="hr-pay-only" style="${canSeePay ? '' : 'display:none'}">${rupees(e.monthly_salary)}</td>
          <td>${e.is_active ? 'Active' : 'Left'}</td>
          <td>${e.face_samples ? 'Enrolled' : 'Not enrolled'}</td>
          <td style="white-space: nowrap;"><button type="button" class="btn-small btn-info" data-hr-edit="${e.id}">Edit</button>
            ${e.is_active ? `<button type="button" class="btn-small btn-success" data-hr-face="${e.id}">${e.face_samples ? 'Enroll Again' : 'Enroll Face'}</button>` : ''}
            ${e.face_samples ? `<button type="button" class="btn-small btn-danger" data-hr-face-remove="${e.id}">Remove Face</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="8">No employees yet. Press Add Employee.</td></tr>';
    } catch (error) {
      body.innerHTML = '<tr><td colspan="8">Could not load employees.</td></tr>';
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
  const STATUS = { present: 'Present', absent: 'Absent', leave: 'Leave', off: 'Weekly off', upcoming: '-', not_marked: 'Not marked yet' };

  function place(lat, lng, accuracy) {
    if (lat == null) return '';
    const within = accuracy ? ` (within ${accuracy} m)` : '';
    return `<a href="https://www.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(lng)}" target="_blank" rel="noopener">Map</a>${esc(within)}`;
  }

  function mark(row, which) {
    const at = which === 'in' ? row.check_in_at : row.check_out_at;
    if (!at) return '-';
    const source = which === 'in' ? row.check_in_source : row.check_out_source;
    const hasPhoto = which === 'in' ? row.has_in_photo : row.has_out_photo;
    const map = which === 'in' ? place(row.check_in_latitude, row.check_in_longitude, row.check_in_accuracy) : place(row.check_out_latitude, row.check_out_longitude, row.check_out_accuracy);
    const photo = hasPhoto ? `<a href="#" data-hr-photo="${row.id}/${which}">Photo</a>` : '';
    const why = which === 'out' && row.check_out_reason ? `<br><small>${esc(row.check_out_reason)}</small>` : '';
    return `${esc(time(at))} <small>${esc({ phone: 'Phone', kiosk: 'Kiosk' }[source] || 'PC')}</small>${why}<br><small>${[photo, map].filter(Boolean).join(' · ')}</small>`;
  }

  // Each time this person went out and came back.
  const tripList = (row) => row.trips.map((t) => `<small>${esc(t.reason)}: ${esc(time(t.out_at))} to ${esc(time(t.back_at))}
      ${t.has_out_photo ? `<a href="#" data-hr-photo="trip/${t.id}/out">Out</a>` : ''}
      ${t.has_back_photo ? `<a href="#" data-hr-photo="trip/${t.id}/back">Back</a>` : ''}</small><br>`).join('');

  async function loadHrAttendance() {
    const dateBox = $('hrAttendanceDate');
    if (!dateBox.value) dateBox.value = today();
    const body = $('hrAttendanceBody');
    body.innerHTML = '<tr><td colspan="6">Loading...</td></tr>';
    try {
      const data = await api(`/attendance?date=${encodeURIComponent(dateBox.value)}`);
      const s = data.summary;
      $('hrAttendanceSummary').textContent = `${s.employees} employees: ${s.present} present, ${s.not_marked ? `${s.not_marked} not marked yet, ` : ''}${s.absent} absent, ${s.leave} on leave, ${s.off} weekly off`;
      body.innerHTML = data.attendance.map((r) => `<tr>
          <td>${esc(r.name)}<br><small>${esc(r.designation || '')}</small></td>
          <td>${esc(STATUS[r.day_status] || r.day_status)}</td>
          <td>${mark(r, 'in')}</td>
          <td>${mark(r, 'out')}</td>
          <td>${tripList(r)}${esc(r.note || '')}</td>
          <td><button type="button" class="btn-small btn-info" data-hr-correct="${r.employee_id}" data-hr-name="${esc(r.name)}">Correct</button></td>
        </tr>`).join('') || '<tr><td colspan="6">No employees yet. Add them under Employees.</td></tr>';
    } catch (error) {
      body.innerHTML = '<tr><td colspan="6">Could not load attendance.</td></tr>';
      failed(error);
    }
    loadHrMonth();
    loadHrKiosks();
  }

  async function loadHrKiosks() {
    const body = $('hrKioskBody');
    try {
      const { devices } = await api('/kiosk/devices');
      body.innerHTML = devices.map((d) => `<tr>
          <td>${esc(d.name)}</td>
          <td>${esc(d.branch_name || '-')}</td>
          <td>${d.last_used_at ? esc(new Date(d.last_used_at).toLocaleString('en-PK')) : 'Not yet'}</td>
          <td><button type="button" class="btn-small btn-danger" data-hr-kiosk-remove="${d.id}">Remove</button></td>
        </tr>`).join('') || '<tr><td colspan="4">No kiosk yet. Press Set Up Kiosk on This PC, on the office PC.</td></tr>';
    } catch (error) {
      body.innerHTML = '<tr><td colspan="4">Could not load kiosk screens.</td></tr>';
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
      $('hrMonthTitle').textContent = `Month ${month}`;
      body.innerHTML = data.attendance.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.present}</td><td>${r.leave}</td><td>${r.absent}</td><td>${r.off}</td></tr>`).join('')
        || '<tr><td colspan="5">Nothing yet.</td></tr>';
    } catch (error) {
      body.innerHTML = '<tr><td colspan="5">Could not load the month.</td></tr>';
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
    return `<tr data-hr-pay="${r.employee_id}">
      <td>${esc(r.name)}<br><small>${r.present} present, ${r.leave} leave, ${r.off} off</small></td>
      <td>${rupees(r.salary)}</td>
      <td>${r.absent + r.not_joined}</td>
      <td>${rupees(r.absence_deduction)}</td>
      <td>${r.locked ? lockedValue(r.bonus) : `<input type="number" min="0" step="1" class="form-control hr-bonus" value="${Number(r.bonus)}" style="width:90px">`}</td>
      <td>${r.locked ? lockedValue(r.deduction) : `<input type="number" min="0" step="1" class="form-control hr-deduction" value="${Number(r.deduction)}" style="width:90px">`}</td>
      <td><strong>${rupees(r.net)}</strong></td>
      <td>${r.locked ? `${esc(r.voucher_number)}<br><small>${esc(r.voucher_status)}</small>` : '<button type="button" class="btn-small btn-success" data-hr-voucher="1">Create voucher</button>'}</td>
    </tr>`;
  }

  async function loadHrPayroll() {
    const monthBox = $('hrPayrollMonth');
    if (!monthBox.value) monthBox.value = today().slice(0, 7);
    const body = $('hrPayrollBody');
    body.innerHTML = '<tr><td colspan="8">Loading...</td></tr>';
    try {
      const data = await api(`/payroll?month=${monthBox.value}`);
      body.innerHTML = data.payroll.map(payrollRow).join('') || '<tr><td colspan="8">No employees yet.</td></tr>';
      const t = data.totals;
      $('hrPayrollTotals').textContent = `Salaries ${rupees(t.salary)}, absence ${rupees(t.absence_deduction)}, bonus ${rupees(t.bonus)}, deductions ${rupees(t.deduction)}, net pay ${rupees(t.net)}`;
    } catch (error) {
      body.innerHTML = '<tr><td colspan="8">Could not load payroll.</td></tr>';
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

  document.addEventListener('DOMContentLoaded', () => {
    $('hrEmployeeOff').innerHTML = `<option value="">No weekly off</option>${WEEKDAYS.map((d, i) => `<option value="${i}">${d}</option>`).join('')}`;
    $('hrEmployeeForm').addEventListener('submit', saveEmployee);
    $('hrCorrectForm').addEventListener('submit', saveCorrection);
  });

  window.loadHrEmployees = loadHrEmployees;
  window.loadHrAttendance = loadHrAttendance;
  window.loadHrPayroll = loadHrPayroll;
})();
