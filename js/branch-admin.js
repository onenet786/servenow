// Utilities > Branches: create, edit, open and close branches. Only the owner account gets it:
// the server answers "not found" to anyone else, and then nothing is drawn on the page at all.
(function () {
  const esc = (v) => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const slug = (text) => String(text).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 29);
  const say = (ok, title, text) => {
    const fn = ok ? window.showSuccess : window.showError;
    if (typeof fn === 'function') fn(title, text);
  };

  const send = (url, method, body) => fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json().then((j) => ({ ok: r.ok, ...j })));

  const FIELDS = [
    ['name', 'Branch name', 'text', 'e.g. Layyah'],
    ['city', 'City', 'text', 'e.g. Layyah'],
    ['center_latitude', 'Map centre latitude', 'number', 'e.g. 30.9693'],
    ['center_longitude', 'Map centre longitude', 'number', 'e.g. 70.9428'],
    ['radius_km', 'Delivery radius (km, optional)', 'number', ''],
    ['phone', 'Branch phone', 'text', ''],
  ];

  function draw(host, branches) {
    host.innerHTML = '';
    const widget = document.createElement('details');
    widget.className = 'utility-widget';
    widget.name = 'utility-tool';
    widget.id = 'branchManager';
    widget.innerHTML = `
      <summary>
        <span class="utility-summary-icon utility-icon-backup"><i class="fas fa-code-branch"></i></span>
        <span class="utility-summary-copy">
          <span class="utility-title">Branches</span>
          <span class="utility-subtitle">Create a new branch, edit one, or open and close it for customers.</span>
        </span>
        <i class="fas fa-chevron-down utility-chevron"></i>
      </summary>
      <div class="utility-widget-body">
        <div class="table-container">
          <table>
            <thead><tr><th>Branch</th><th>City</th><th>Stores</th><th>Riders</th><th>Customers</th><th>Status</th><th></th></tr></thead>
            <tbody>${branches.map((b) => `
              <tr>
                <td>${esc(b.name)}</td><td>${esc(b.city)}</td><td>${esc(b.stores)}</td><td>${esc(b.riders)}</td><td>${esc(b.customers)}</td>
                <td><span class="status-${Number(b.is_active) ? 'active' : 'inactive'}">${Number(b.is_active) ? 'Open' : 'Closed'}</span></td>
                <td>
                  <button type="button" class="btn-small btn-edit" data-edit="${esc(b.id)}">Edit</button>
                  <button type="button" class="btn-small ${Number(b.is_active) ? 'btn-danger' : 'btn-edit'}" data-toggle="${esc(b.id)}">${Number(b.is_active) ? 'Close' : 'Open'}</button>
                </td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
        <h4 id="branchFormTitle" style="margin:1rem 0 .5rem;">Add a new branch</h4>
        <form id="branchForm" class="filter-controls utility-control-grid">
          ${FIELDS.map(([key, label, type, hint]) => `
            <div class="form-group">
              <label for="branch_${key}">${label}</label>
              <input id="branch_${key}" name="${key}" type="${type}" ${type === 'number' ? 'step="any"' : ''} placeholder="${esc(hint)}" ${key === 'name' || key === 'city' ? 'required maxlength="100"' : ''}>
            </div>`).join('')}
          <div style="grid-column:1/-1;display:flex;gap:.5rem;">
            <button type="submit" class="btn-primary" id="branchSaveBtn">Add branch</button>
            <button type="button" class="btn-secondary" id="branchCancelBtn" hidden>Cancel</button>
          </div>
          <p style="grid-column:1/-1;margin:0;opacity:.75;">A new branch starts closed. Add its stores and riders, then press Open. Customers can only see open branches.</p>
        </form>
      </div>`;

    const stack = document.querySelector('#db-backup .utilities-widget-stack');
    if (!stack) return;
    const old = stack.querySelector('#branchManager');
    if (old) old.remove();
    stack.prepend(widget);

    const form = widget.querySelector('#branchForm');
    let editingId = null;
    const reset = () => {
      editingId = null;
      form.reset();
      widget.querySelector('#branchFormTitle').textContent = 'Add a new branch';
      widget.querySelector('#branchSaveBtn').textContent = 'Add branch';
      widget.querySelector('#branchCancelBtn').hidden = true;
    };
    widget.querySelector('#branchCancelBtn').addEventListener('click', reset);

    widget.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => {
      const b = branches.find((x) => String(x.id) === btn.dataset.edit);
      if (!b) return;
      editingId = b.id;
      FIELDS.forEach(([key]) => { form.elements[key].value = b[key] === null || b[key] === undefined ? '' : b[key]; });
      widget.querySelector('#branchFormTitle').textContent = `Edit ${b.name}`;
      widget.querySelector('#branchSaveBtn').textContent = 'Save changes';
      widget.querySelector('#branchCancelBtn').hidden = false;
    }));

    widget.querySelectorAll('[data-toggle]').forEach((btn) => btn.addEventListener('click', async () => {
      const b = branches.find((x) => String(x.id) === btn.dataset.toggle);
      if (!b) return;
      const opening = !Number(b.is_active);
      const question = opening
        ? `Open ${b.name}? Customers will be able to choose it and order.`
        : `Close ${b.name}? Customers there will not be able to order.`;
      if (!window.confirm(question)) return;
      const r = await send(`/api/branches/${b.id}`, 'PUT', { is_active: opening });
      say(r.ok, r.ok ? 'Saved' : 'Not saved', r.ok ? `${b.name} is now ${opening ? 'open' : 'closed'}.` : r.message);
      if (r.ok) load(host, true);
    }));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {};
      FIELDS.forEach(([key]) => { body[key] = form.elements[key].value.trim(); });
      if (!editingId) body.code = slug(body.name);
      const r = editingId
        ? await send(`/api/branches/${editingId}`, 'PUT', body)
        : await send('/api/branches', 'POST', body);
      say(r.ok, r.ok ? 'Saved' : 'Not saved', r.ok ? 'Branch saved.' : r.message);
      if (r.ok) load(host, true);
    });
  }

  function load(host, open) {
    fetch('/api/branches/all')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || !data.success) return;
        draw(host, data.branches || []);
        if (open) document.getElementById('branchManager').open = true;
      })
      .catch(() => {});
  }

  load(document.createElement('div'), false);
})();
