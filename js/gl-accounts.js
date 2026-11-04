// Chart of Accounts (admin > Financial > Chart of Accounts).
// API: GET/POST /api/financial/gl/accounts, PUT /api/financial/gl/accounts/:code
// System accounts keep their code and type; added accounts can change type until they are used.
(function () {
    'use strict';

    const TYPES = { asset: 'Asset', liability: 'Liability', equity: 'Equity', income: 'Income', expense: 'Expense' };
    const DIGIT = { asset: '1', liability: '2', equity: '3', income: '4', expense: '5' };
    const state = { accounts: [], canManage: false, editing: null, onDone: null };
    const $ = (id) => document.getElementById(id);
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    async function api(path, options = {}) {
        const response = await fetch(`${API_BASE}/api/financial/gl/accounts${path}`, {
            ...options,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('serveNowToken')}` },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) throw new Error(data.message || 'Request failed');
        return data;
    }

    function render() {
        const type = $('coaTypeFilter').value;
        const q = $('coaSearch').value.trim().toLowerCase();
        const rows = state.accounts.filter((a) => (!type || a.type === type) && (!q || `${a.code} ${a.name}`.toLowerCase().includes(q)));
        $('coaNewBtn').style.display = state.canManage ? '' : 'none';
        $('coaBody').innerHTML = rows.length ? rows.map((a) => `
            <tr class="${a.is_active ? '' : 'coa-off'}">
                <td><b>${esc(a.code)}</b></td>
                <td>${esc(a.name)}${a.description ? `<small class="coa-note">${esc(a.description)}</small>` : ''}</td>
                <td>${esc(TYPES[a.type] || a.type)}</td>
                <td>${a.is_system ? '<span class="coa-tag">System</span>' : '<span class="coa-tag coa-added">Added</span>'}</td>
                <td>${a.on_vouchers ? 'Yes' : '<span class="text-muted">Journal only</span>'}</td>
                <td class="coa-num">${Number(a.lines_used).toLocaleString()}</td>
                <td>${a.is_active ? 'On' : '<span class="text-muted">Off</span>'}</td>
                <td>${state.canManage ? `<button type="button" class="btn btn-secondary btn-sm" data-coa-edit="${esc(a.code)}"><i class="fas fa-pen"></i> Edit</button>` : ''}</td>
            </tr>`).join('') : '<tr><td colspan="8" class="text-muted">No accounts match.</td></tr>';
    }

    async function loadGlAccounts() {
        $('coaBody').innerHTML = '<tr><td colspan="8" class="text-muted">Loading...</td></tr>';
        try {
            const data = await api('');
            state.accounts = data.data || [];
            state.canManage = Boolean(data.can_manage);
            render();
        } catch (error) {
            $('coaBody').innerHTML = `<tr><td colspan="8" class="text-muted">${esc(error.message)}</td></tr>`;
        }
    }

    function openForm(account, presetType) {
        state.editing = account || null;
        const a = account || {};
        $('coaFormTitle').textContent = account ? `Edit ${a.code} ${a.name}` : 'New Account';
        $('coaCode').value = a.code || '';
        $('coaCode').disabled = Boolean(account);
        $('coaName').value = a.name || '';
        $('coaType').value = a.type || presetType || 'expense';
        // A system account's type is fixed; an added one can change until it has entries.
        $('coaType').disabled = Boolean(account && (a.is_system || a.lines_used > 0));
        $('coaDescription').value = a.description || '';
        $('coaActive').value = !account || a.is_active ? '1' : '0';
        $('coaActiveGroup').style.display = account && !a.is_system ? '' : 'none';
        $('coaHint').textContent = account
            ? (a.is_system ? 'System account: the automatic postings use it, so only the name and note can change.'
                : (a.lines_used > 0 ? 'This account has entries, so its type is fixed. Switching it off hides it from new vouchers and journals; its history stays.' : ''))
            : 'The first digit follows the type: 1 asset, 2 liability, 3 equity, 4 income, 5 expense. Added expense and income accounts appear on vouchers; the others on journal vouchers.';
        suggestCode();
        openModal('coaModal');
    }

    // Next free code for the chosen type, as a starting point.
    function suggestCode() {
        if (state.editing) return;
        const digit = DIGIT[$('coaType').value];
        const current = $('coaCode').value;
        if (current && current[0] === digit) return;
        const used = new Set(state.accounts.map((a) => a.code));
        for (let n = Number(`${digit}050`); n < Number(`${digit}999`); n += 50) {
            if (!used.has(String(n))) { $('coaCode').value = String(n); return; }
        }
    }

    async function save(event) {
        event.preventDefault();
        const body = { name: $('coaName').value, description: $('coaDescription').value };
        try {
            if (state.editing) {
                if (!$('coaType').disabled) body.type = $('coaType').value;
                if (!state.editing.is_system) body.is_active = $('coaActive').value === '1';
                await api(`/${encodeURIComponent(state.editing.code)}`, { method: 'PUT', body: JSON.stringify(body) });
            } else {
                await api('', { method: 'POST', body: JSON.stringify({ ...body, code: $('coaCode').value, type: $('coaType').value }) });
            }
            showSuccess('Saved', state.editing ? 'Account saved' : 'Account added');
            const added = state.editing ? null : { code: $('coaCode').value, name: $('coaName').value.trim(), type: $('coaType').value };
            closeModal('coaModal');
            finish(added);
            if ($('gl-accounts') && $('gl-accounts').classList.contains('active')) loadGlAccounts();
        } catch (error) {
            showError('Could Not Save', error.message);
        }
    }

    // Tells a waiting voucher form what was added (or null when the form was closed).
    function finish(account) {
        const done = state.onDone;
        state.onDone = null;
        if (done) done(account);
    }

    // Whether this person may add accounts: asked once, from the chart of accounts route.
    let canManageRequest = null;
    function canManageLedgerAccounts() {
        canManageRequest = canManageRequest || api('').then((data) => {
            state.accounts = data.data || state.accounts;
            return Boolean(data.can_manage);
        }).catch(() => false);
        return canManageRequest;
    }

    // From a voucher or journal: open New Account and resolve with the account added, or null.
    async function addLedgerAccountFrom({ type } = {}) {
        if (!(await canManageLedgerAccounts())) return null;
        if (state.onDone) finish(null);
        return new Promise((resolve) => {
            state.onDone = resolve;
            openForm(null, type);
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (!$('coaBody')) return;
        $('coaCancel').addEventListener('click', () => { closeModal('coaModal'); finish(null); });
        $('coaTypeFilter').addEventListener('change', render);
        $('coaSearch').addEventListener('input', render);
        $('coaNewBtn').addEventListener('click', () => openForm(null));
        $('coaType').addEventListener('change', suggestCode);
        $('coaForm').addEventListener('submit', save);
        $('coaBody').addEventListener('click', (e) => {
            const btn = e.target.closest('[data-coa-edit]');
            if (btn) openForm(state.accounts.find((a) => a.code === btn.dataset.coaEdit));
        });
    });

    window.loadGlAccounts = loadGlAccounts;
    window.canManageLedgerAccounts = canManageLedgerAccounts;
    window.addLedgerAccountFrom = addLedgerAccountFrom;
})();
