// The office attendance screen. It signs nobody in: HR turned this PC into a kiosk once, and the key
// kept here lets it list its branch's staff, ask who a face is, and save marks, nothing else.
//
// The camera stays on. A person who is enrolled just stands in front of it: they are checked in after a
// short countdown they can cancel, and likewise when they return from being out. Checking out always needs
// a reason to be pressed, so walking past never ends a shift, and after Going Home only a press reopens the day.
// A person not enrolled yet taps their name instead.
(function () {
  const KEY = 'serveNowKioskKey';
  const REFRESH_MS = 60 * 1000;
  const IDLE_MS = 20 * 1000;
  const LEAVING_MS = 10 * 1000;
  const RESULT_MS = 2500;
  const SCAN_MS = 700;
  const MIN_FACE_PX = 90;
  const SAME_FACE_TIMES = 2;
  const COUNTDOWN_SECONDS = 3;
  const RECENT_MARK_MS = 2 * 60 * 1000;
  const REST_MS = 45 * 1000;

  const $ = (id) => document.getElementById(id);
  const key = localStorage.getItem(KEY);

  let people = [];
  let reasons = [];
  let current = null;
  let pass = null;
  let idleTimer = null;
  let countdown = null;
  let cameraReady = false;
  let faceReady = false;
  let seenId = null;
  let seenTimes = 0;
  const resting = new Map();

  function notice(text) {
    $('notice').hidden = !text;
    $('notice').textContent = text || '';
    $('main').hidden = Boolean(text);
  }

  const status = (text, waiting = false) => {
    $('status').textContent = text;
    $('status').className = waiting ? 'waiting' : '';
  };
  const rest = (id, ms = REST_MS) => resting.set(id, Date.now() + ms);
  const isResting = (id) => (resting.get(id) || 0) > Date.now();

  async function api(path, options = {}) {
    const response = await fetch(`/api/hr/kiosk/screen${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'X-Kiosk-Key': key },
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      localStorage.removeItem(KEY);
      throw Object.assign(new Error('removed'), { removed: true });
    }
    if (!response.ok || !data.success) throw new Error(data.message || 'Something went wrong');
    return data;
  }

  function tick() {
    const now = new Date();
    $('clock').textContent = now.toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit' });
    $('date').textContent = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  const time = (value) => new Date(value).toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit' });
  const stateText = (p) => ({
    in: () => `In since ${time(p.check_in_at)}`,
    away: () => `Out: ${p.reason} since ${time(p.check_out_at)}`,
    done: () => `Finished at ${time(p.check_out_at)}`,
  }[p.state] || (() => 'Not in yet'))();

  const clockText = (ms) => {
    const seconds = Math.ceil(ms / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };

  // Time left before this person can mark again, by the server's clock, not this PC's.
  function waitLeft(person) {
    if (person.since_mark === null || person.since_mark === undefined) return 0;
    return RECENT_MARK_MS - person.since_mark * 1000 - (person.read_at ? Date.now() - person.read_at : 0);
  }

  function waitText(person, left) {
    const next = { in: 'Check Out', away: 'Check In', done: 'Check In Again' }[person.state];
    const now = person.state === 'in' ? 'checked in' : 'checked out';
    return `${person.name}, you are ${now}. ${next} opens in ${clockText(left)}`;
  }

  function draw() {
    const words = $('search').value.trim().toLowerCase();
    const list = people.filter((p) => p.name.toLowerCase().includes(words));
    const box = $('people');
    box.innerHTML = '';
    list.forEach((p) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = `person ${p.state}`;
      const name = document.createElement('b');
      name.textContent = p.name;
      tile.append(name);
      if (p.designation) {
        const role = document.createElement('small');
        role.textContent = p.designation;
        tile.append(role);
      }
      const state = document.createElement('span');
      state.className = 'state';
      state.textContent = stateText(p);
      tile.append(state);
      tile.addEventListener('click', () => tapped(p));
      box.append(tile);
    });
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'notice';
      empty.textContent = people.length ? 'No name found.' : 'No employees yet. HR adds them under HR, Employees.';
      box.append(empty);
    }
  }

  async function load() {
    try {
      const data = await api('/employees');
      $('title').textContent = `${data.branch} Attendance`;
      people = data.employees.map((p) => ({ ...p, read_at: Date.now() }));
      reasons = data.reasons;
      notice('');
      if (!current) draw();
    } catch (error) {
      if (error.removed) notice('This screen was removed. Ask HR to set it up again from HR, Attendance.');
      else notice('No connection. Trying again...');
    }
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false });
      for (const id of ['live', 'video']) {
        $(id).srcObject = stream;
        await $(id).play().catch(() => {});
      }
      cameraReady = true;
    } catch (_) {
      notice('Allow the camera for this site, then reload this page.');
    }
  }

  function close() {
    clearTimeout(idleTimer);
    clearInterval(countdown);
    current = null;
    pass = null;
    $('overlay').hidden = true;
    $('search').value = '';
    draw();
  }

  function showReasons() {
    const box = $('reasons');
    box.innerHTML = '';
    reasons.forEach((reason) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = reason.label;
      if (reason.key === 'home') button.className = 'home';
      button.addEventListener('click', () => save(reason.key));
      box.append(button);
    });
    box.hidden = false;
  }

  const NOTES = {
    in: (p) => `In since ${time(p.check_in_at)}. Why are you leaving?`,
    away: (p) => `Welcome back from ${p.reason}. Look at the camera.`,
    done: (p) => `You finished at ${time(p.check_out_at)}. Came back to work?`,
    out: () => 'Look at the camera.',
  };

  function open(person, { autoCheckIn }) {
    current = person;
    const leaving = person.state === 'in';
    const label = person.state === 'done' ? 'Check In Again' : 'Check In';
    $('personName').textContent = person.name;
    $('personNote').textContent = NOTES[person.state](person);
    $('confirm').textContent = label;
    $('confirm').disabled = false;
    $('confirm').hidden = leaving;
    $('reasons').hidden = true;
    if (leaving) showReasons();
    $('capture').hidden = false;
    $('result').hidden = true;
    $('overlay').hidden = false;
    clearTimeout(idleTimer);
    clearInterval(countdown);
    if (autoCheckIn) {
      let left = COUNTDOWN_SECONDS;
      $('confirm').textContent = `${label} (${left})`;
      countdown = setInterval(() => {
        left -= 1;
        if (left > 0) {
          $('confirm').textContent = `${label} (${left})`;
          return;
        }
        clearInterval(countdown);
        $('confirm').click();
      }, 1000);
      return;
    }
    idleTimer = setTimeout(close, pass ? LEAVING_MS : IDLE_MS);
  }

  function showResult(text, good) {
    clearInterval(countdown);
    $('capture').hidden = true;
    $('result').hidden = false;
    $('result').textContent = text;
    $('result').className = `done-message ${good ? '' : 'bad'}`;
    $('overlay').hidden = false;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(close, RESULT_MS);
  }

  function tapped(person) {
    if (person.face) {
      showResult(`${person.name}, please look at the camera.`, false);
      return;
    }
    const left = waitLeft(person);
    if (left > 0) {
      showResult(waitText(person, left), false);
      return;
    }
    if (cameraReady) open(person, { autoCheckIn: false });
  }

  function recognised(match) {
    rest(match.id);
    pass = match.pass;
    // After Going Home, passing the camera must not reopen the day: only a press does.
    open(match, { autoCheckIn: match.state === 'out' || match.state === 'away' });
  }

  async function scanOnce() {
    const seen = await window.ServeNowFace.read($('live'));
    if (!seen.count) {
      seenId = null;
      status('Stand in front of the camera');
      return;
    }
    if (seen.count > 1) {
      seenId = null;
      status('One person at a time, please');
      return;
    }
    if (seen.width < MIN_FACE_PX) {
      seenId = null;
      status('Come a little closer');
      return;
    }
    const { match } = await api('/identify', { method: 'POST', body: JSON.stringify({ descriptor: seen.descriptor }) });
    if (!match) {
      seenId = null;
      status('Not recognised. If you are not enrolled, tap your name.');
      return;
    }
    // Standing here just after a mark is neither leaving nor coming back, so it only shows the time left.
    const left = waitLeft(match);
    if (left > 0) {
      seenId = null;
      status(waitText(match, left), true);
      return;
    }
    if (isResting(match.id)) {
      status(`${match.name}, please wait ${clockText(resting.get(match.id) - Date.now())}`, true);
      return;
    }
    seenTimes = seenId === match.id ? seenTimes + 1 : 1;
    seenId = match.id;
    status(`Hello ${match.name}`);
    if (seenTimes >= SAME_FACE_TIMES) {
      seenId = null;
      recognised(match);
    }
  }

  async function scanLoop() {
    try {
      if (faceReady && cameraReady && !current && $('overlay').hidden && $('notice').hidden) await scanOnce();
    } catch (error) {
      if (error.removed) await load();
      else console.error('Face scan failed:', error);
    }
    setTimeout(scanLoop, SCAN_MS);
  }

  function photo() {
    const video = $('live');
    const scale = Math.min(1, 640 / video.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.75);
  }

  async function save(reason) {
    if (!current) return;
    $('confirm').disabled = true;
    $('reasons').hidden = true;
    clearInterval(countdown);
    clearTimeout(idleTimer);
    const person = current;
    try {
      const data = await api('/mark', { method: 'POST', body: JSON.stringify({ employee_id: person.id, photo: photo(), pass, reason }) });
      rest(person.id);
      showResult(`${person.name}: ${data.message}`, true);
    } catch (error) {
      showResult(error.removed ? 'This screen was removed.' : error.message, false);
    }
    load();
  }

  $('confirm').addEventListener('click', () => save(null));
  $('cancel').addEventListener('click', () => {
    if (current) rest(current.id);
    close();
  });
  $('search').addEventListener('input', draw);

  tick();
  setInterval(tick, 1000);
  if (!key) {
    notice('This PC is not set up yet. HR opens HR, Attendance and presses Set Up Kiosk on This PC.');
    return;
  }
  load();
  setInterval(load, REFRESH_MS);
  startCamera().then(async () => {
    status('Loading face recognition...');
    try {
      await window.ServeNowFace.load();
      faceReady = true;
      status('Stand in front of the camera');
    } catch (_) {
      status('Face recognition is off. Tap your name.');
    }
    scanLoop();
  });
})();
