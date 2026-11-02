// Marking attendance in a browser, on a phone or a PC: a live camera photo, plus location on a phone.
(function () {
  const $ = (id) => document.getElementById(id);
  const token = localStorage.getItem('serveNowToken') || sessionStorage.getItem('serveNowToken');
  if (!token) {
    window.location.replace('login.html');
    return;
  }

  const phone = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || navigator.userAgentData?.mobile === true;
  const user = (() => {
    try { return JSON.parse(localStorage.getItem('serveNowUser') || sessionStorage.getItem('serveNowUser') || '{}'); } catch (_) { return {}; }
  })();
  if (user.user_type === 'admin' || user.user_type === 'standard_user') $('backLink').href = 'admin.html';
  else if (user.user_type === 'rider') $('backLink').href = 'rider.html';

  const button = $('markButton');
  let cameraReady = false;
  let position = null;
  let action = null;
  let stream = null;
  let reason = 'home';

  function tick() {
    $('clock').textContent = new Date().toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit' });
  }
  tick();
  setInterval(tick, 15000);

  function showReasons(list) {
    const box = $('reasons');
    box.replaceChildren(...list.map((item) => {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.textContent = item.label;
      choice.dataset.reason = item.key;
      choice.classList.toggle('is-on', item.key === reason);
      return choice;
    }));
    box.hidden = false;
    $('reasonTitle').hidden = false;
  }

  function hideReasons() {
    $('reasons').hidden = true;
    $('reasonTitle').hidden = true;
  }

  function finish(text, good) {
    stopCamera();
    say('cameraLine', '');
    say('locationLine', '');
    say('resultLine', '');
    hideReasons();
    button.hidden = true;
    $('doneBox').hidden = false;
    $('doneBox').className = `done ${good ? '' : 'bad'}`;
    $('doneTick').textContent = good ? '\u2713' : '!';
    $('doneText').textContent = text;
  }

  $('reasons').addEventListener('click', (event) => {
    const choice = event.target.closest('[data-reason]');
    if (!choice) return;
    reason = choice.dataset.reason;
    $('reasons').querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b === choice));
  });

  function say(id, text, kind) {
    const line = $(id);
    line.hidden = !text;
    line.textContent = text || '';
    line.className = `status ${kind || ''}`;
  }

  async function api(path, options = {}) {
    const response = await fetch(`/api/hr${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
      window.location.replace('login.html');
      throw new Error('Please sign in');
    }
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || 'Something went wrong');
    return data;
  }

  function refreshButton() {
    const label = action === 'out' ? 'Check Out' : 'Check In';
    const missing = !cameraReady ? 'Waiting for camera...' : phone && !position ? 'Waiting for location...' : '';
    button.textContent = missing || label;
    button.disabled = Boolean(missing);
    button.classList.toggle('out', action === 'out');
  }

  function stopCamera() {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    $('cameraBox').hidden = true;
  }

  async function startCamera() {
    $('cameraBox').hidden = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      say('cameraLine', 'This browser cannot open the camera. Use Chrome, or the ServeNow app.', 'bad');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false });
      const video = $('video');
      video.srcObject = stream;
      await video.play();
      cameraReady = true;
      say('cameraLine', '');
    } catch (_) {
      say('cameraLine', 'Allow the camera for this site, then reload the page.', 'bad');
    }
    refreshButton();
  }

  function startLocation() {
    if (!phone) return;
    if (!navigator.geolocation) {
      say('locationLine', 'This phone browser cannot share location. Use the ServeNow app.', 'bad');
      return;
    }
    say('locationLine', 'Finding your location...');
    navigator.geolocation.watchPosition(
      (found) => {
        position = found.coords;
        say('locationLine', 'Location on.', 'good');
        refreshButton();
      },
      () => {
        position = null;
        say('locationLine', 'Turn on location and allow it for this site, then reload the page.', 'bad');
        refreshButton();
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 }
    );
  }

  function photo() {
    const video = $('video');
    const scale = Math.min(1, 640 / video.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.75);
  }

  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Saving...';
    say('resultLine', '');
    try {
      const data = await api('/attendance/mark', {
        method: 'POST',
        body: JSON.stringify({
          photo: photo(),
          source: phone ? 'phone' : 'pc',
          latitude: position?.latitude,
          longitude: position?.longitude,
          accuracy: position?.accuracy,
          reason: action === 'out' ? reason : undefined,
        }),
      });
      finish(data.message, true);
    } catch (error) {
      say('resultLine', error.message, 'bad');
      refreshButton();
    }
  });

  (async () => {
    try {
      const me = await api('/me');
      if (!me.employee) {
        $('who').textContent = 'Attendance';
        finish('You are not on the staff list yet. Ask HR to add you.', false);
        return;
      }
      $('who').textContent = me.employee.name;
      $('today').textContent = `${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}${me.employee.designation ? ` · ${me.employee.designation}` : ''}`;
      if (me.shift) $('today').textContent += ` · ${me.shift.name}`;
      if (me.next_action === 'done') {
        finish('Your duty for today is complete. See you tomorrow.', true);
        return;
      }
      action = me.next_action;
      if (action === 'out') {
        showReasons(me.reasons);
      }
      refreshButton();
      startLocation();
      await startCamera();
    } catch (error) {
      finish(error.message, false);
    }
  })();
})();
