// Admin page: which branch head office is working in.
// Head office picks a branch in the header; every list and report then asks the server for that
// branch only, and settings saved are for that branch ("All branches" = every branch). Branch
// accounts get no picker: the server holds them to their own branch whatever is sent here.
(function () {
  const KEY = 'serveNowAdminBranch';
  const LISTS = /^\/api\/(orders|stores|riders|users|products|admin|financial|wallet|payments)(\/|$)/;
  const SAVES = /^\/api\/(stores$|stores\/(global-delivery-status|live-promotions|customer-flash-message|customer-push-notification)|admin\/delivery-fee-settings|financial\/)/;
  const FORMS = [
    { id: 'addStoreForm', blank: null },
    { id: 'addRiderForm', blank: null },
    { id: 'editAccountForm', blank: 'Head office (all branches)' },
  ];

  let branches = [];
  let scope = null;
  // The saved branch filters lists from the very first request, so a page's first lists are never
  // loaded across all branches by accident. It is confirmed (or dropped) once the branch list
  // arrives; until then it is never added to a save.
  const savedAtStart = Number(localStorage.getItem(KEY));
  let selected = Number.isInteger(savedAtStart) && savedAtStart > 0 ? savedAtStart : null;
  let confirmed = false;
  let usedBeforeConfirmed = false;

  const headOfficeWithChoice = () => scope === null && branches.length > 1;
  const nameOf = (id) => {
    const b = branches.find((x) => x.id === Number(id));
    return b ? b.name : '';
  };

  // Layered on app.js's fetch wrapper (this file loads after it), so the token is still added.
  const baseFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      if (selected !== null && typeof input === 'string') {
        const url = new URL(input, window.location.href);
        const method = String((init && init.method) || 'GET').toUpperCase();
        if (url.origin === window.location.origin) {
          if (method === 'GET' && LISTS.test(url.pathname) && !url.searchParams.has('branch_id')) {
            url.searchParams.set('branch_id', String(selected));
            input = url.toString();
            if (!confirmed) usedBeforeConfirmed = true;
          } else if (confirmed && (method === 'POST' || method === 'PUT') && SAVES.test(url.pathname) && init && typeof init.body === 'string') {
            const body = JSON.parse(init.body);
            if (body && typeof body === 'object' && !Array.isArray(body) && body.branch_id === undefined) {
              body.branch_id = selected;
              init = { ...init, body: JSON.stringify(body) };
            }
          }
        }
      }
    } catch (_) { /* send the request as it was */ }
    return baseFetch(input, init);
  };

  // In the sidebar, like the theme box: the page's top bar only shows on phones.
  function addPicker() {
    const themeItem = document.querySelector('.sidebar-theme-item');
    if (!themeItem) return;
    const item = document.createElement('li');
    item.className = 'sidebar-theme-item';
    const box = document.createElement('div');
    box.className = 'sidebar-theme-settings';
    const label = document.createElement('label');
    label.className = 'theme-label';
    label.htmlFor = 'adminBranchPicker';
    label.innerHTML = '<i class="fas fa-code-branch"></i> Branch';
    const select = document.createElement('select');
    select.id = 'adminBranchPicker';
    select.className = 'theme-select';
    select.add(new Option('All branches', ''));
    branches.forEach((b) => select.add(new Option(b.is_active ? b.name : `${b.name} (closed)`, String(b.id))));
    select.value = selected === null ? '' : String(selected);
    select.addEventListener('change', () => {
      if (select.value) localStorage.setItem(KEY, select.value);
      else localStorage.removeItem(KEY);
      window.location.reload();
    });
    box.append(label, select);
    item.appendChild(box);
    themeItem.parentNode.insertBefore(item, themeItem);
  }

  function addFormFields() {
    FORMS.forEach(({ id, blank }) => {
      const form = document.getElementById(id);
      if (!form || form.querySelector('[name="branch_id"]')) return;
      const group = document.createElement('div');
      group.className = 'form-group';
      const label = document.createElement('label');
      label.textContent = 'Branch:';
      const select = document.createElement('select');
      select.name = 'branch_id';
      select.style.width = '100%';
      if (blank) select.add(new Option(blank, ''));
      branches.forEach((b) => select.add(new Option(b.name, String(b.id))));
      group.append(label, select);
      const grid = form.querySelector('div');
      (grid || form).prepend(group);
    });
  }

  const fieldOf = (formId) => {
    const form = document.getElementById(formId);
    return form ? form.querySelector('select[name="branch_id"]') : null;
  };

  window.BranchScope = {
    // Show a record's branch in the form, or the branch in use for a new record.
    setField(formId, branchId) {
      const el = fieldOf(formId);
      if (!el) return;
      const value = branchId === undefined ? selected : branchId;
      el.value = value === null || value === undefined ? (el.options[0] ? el.options[0].value : '') : String(value);
    },
    // { branch_id } for a save, or {} on screens with no field (branch accounts).
    payload(formId) {
      const el = fieldOf(formId);
      if (!el) return {};
      return { branch_id: el.value === '' ? null : Number(el.value) };
    },
    // Small label for lists, only useful while head office looks across branches.
    badge(branchId) {
      if (!headOfficeWithChoice() || selected !== null) return '';
      const name = nameOf(branchId);
      if (!name) return '';
      const safe = name.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
      return ` <small style="opacity:.7;">(${safe})</small>`;
    },
  };

  const saved = savedAtStart;
  // A saved branch that turned out wrong (removed, or this login is now a branch account) may already
  // have filtered the first lists: forget it and load the page once more with the right data.
  const dropSaved = () => {
    const reload = selected !== null && usedBeforeConfirmed;
    selected = null;
    localStorage.removeItem(KEY);
    if (reload) window.location.reload();
    return reload;
  };
  const ready = baseFetch('/api/branches/options')
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data || !data.success) {
        dropSaved();
        return;
      }
      branches = data.branches || [];
      scope = data.scope;
      if (scope !== null) {
        document.querySelectorAll('#db-backup .utility-icon-backup, #db-backup .utility-icon-restore').forEach((icon) => {
          const widget = icon.closest('.utility-widget');
          if (widget) widget.remove();
        });
      }
      if (!headOfficeWithChoice()) {
        dropSaved();
        return;
      }
      if (branches.some((b) => b.id === saved)) selected = saved;
      else if (dropSaved()) return;
      confirmed = true;
      addPicker();
      addFormFields();
    })
    .catch(() => {
      // Branch list unreachable: keep filtering lists by the saved branch, but never add it to saves.
    });

  window.BranchScope.ready = ready;
})();
