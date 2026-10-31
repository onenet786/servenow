// User Rights & Groups (admin > Accounts > User Rights).
// API: /api/permissions/*. The list of rights comes from the server, so this
// screen can never offer a right the server does not check.
// Every value from the API is escaped before it is put into the page.

(function () {
    'use strict';

    const state = {
        catalog: null,
        groups: [],
        users: [],
        groupId: null,
        creating: false,
        selected: new Set(),
        saved: new Set(),
        query: '',
        riskOnly: false,
        open: new Set(),
        bound: false,
    };

    const el = (id) => document.getElementById(id);
    const esc = (value) => String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    async function api(path, options = {}) {
        const response = await fetch(`${API_BASE}/api/permissions/${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.getItem('serveNowToken')}`,
            },
        });
        const data = await response.json().catch(() => ({}));
        return { status: response.status, ok: response.ok && data.success, data };
    }

    // Saves, asking first if the server says high-risk rights are being given.
    async function saveWithConfirm(path, body) {
        let result = await api(path, { method: 'POST', body: JSON.stringify(body) });
        if (result.status === 409 && result.data.needs_confirmation) {
            const list = (result.data.rights || []).map((r) => `- ${r}`).join('\n');
            if (!window.confirm(`You are giving these high-risk rights:\n\n${list}\n\nContinue?`)) return null;
            result = await api(path, { method: 'POST', body: JSON.stringify({ ...body, confirm_high_risk: true }) });
        }
        return result;
    }

    const riskPill = (risk) => `<span class="ur-risk ur-risk-${esc(risk)}">${esc(risk)}</span>`;
    const unsavedCount = () => {
        const added = [...state.selected].filter((k) => !state.saved.has(k)).length;
        const removed = [...state.saved].filter((k) => !state.selected.has(k)).length;
        return added + removed;
    };

    function renderGroupList() {
        el('urGroupList').innerHTML = state.groups.length ? state.groups.map((g) => `
            <button type="button" class="ur-group ${Number(g.id) === Number(state.groupId) ? 'is-active' : ''}" data-group="${esc(g.id)}">
                <strong>${esc(g.name)}</strong>
                <span>${esc(g.permissions_count)} rights · ${esc(g.member_count)} ${Number(g.member_count) === 1 ? 'person' : 'people'}</span>
            </button>`).join('') : '<p class="ur-note">No groups yet.</p>';
    }

    function visibleRights(module) {
        const q = state.query.trim().toLowerCase();
        return state.catalog.rights.filter((r) => r.module === module
            && (!state.riskOnly || r.risk === 'high')
            && (!q || r.label.toLowerCase().includes(q) || r.hint.toLowerCase().includes(q) || module.toLowerCase().includes(q)));
    }

    function renderRights() {
        const filtering = Boolean(state.query.trim()) || state.riskOnly;
        el('urRights').innerHTML = state.catalog.modules.map((module) => {
            const rights = visibleRights(module);
            if (!rights.length) return '';
            const all = state.catalog.rights.filter((r) => r.module === module);
            const held = all.filter((r) => state.selected.has(r.key)).length;
            const open = filtering || state.open.has(module);
            return `<section class="ur-module ${open ? 'is-open' : ''}">
                <header>
                    <button type="button" class="ur-module-toggle" data-module="${esc(module)}" aria-expanded="${open}">
                        <i class="fas fa-chevron-right"></i> ${esc(module)}
                        <span class="ur-count">${held} of ${all.length}</span>
                    </button>
                    <button type="button" class="ur-link" data-all="${esc(module)}">${held === all.length ? 'Clear' : 'Select all'}</button>
                </header>
                ${open ? `<div class="ur-rows">${rights.map((r) => `
                    <label class="ur-row">
                        <input type="checkbox" data-right="${esc(r.key)}" ${state.selected.has(r.key) ? 'checked' : ''} />
                        <span class="ur-label">${esc(r.label)}${r.hint ? `<small>${esc(r.hint)}</small>` : ''}</span>
                        ${riskPill(r.risk)}
                    </label>`).join('')}</div>` : ''}
            </section>`;
        }).join('') || '<p class="ur-note">No rights match.</p>';
        renderSummary();
    }

    function renderSummary() {
        const high = state.catalog.rights.filter((r) => r.risk === 'high' && state.selected.has(r.key)).length;
        const changes = unsavedCount();
        el('urSummary').innerHTML = `${state.selected.size} rights, ${high} high-risk${changes ? ` · <strong>${changes} unsaved</strong>` : ''}`;
        el('urSaveRights').disabled = !state.groupId || !changes;
    }

    function renderEditor() {
        const group = state.groups.find((g) => Number(g.id) === Number(state.groupId));
        const showing = Boolean(group) || state.creating;
        el('urEditor').style.display = showing ? '' : 'none';
        el('urEmpty').style.display = showing ? 'none' : '';
        if (!showing) return;
        el('urGroupName').value = group ? group.name : '';
        el('urGroupDesc').value = group ? group.description || '' : '';
        el('urDeleteGroup').style.display = group ? '' : 'none';
        el('urRightsPanel').style.display = group ? '' : 'none';
        el('urSaveGroup').textContent = group ? 'Save Name' : 'Create Group';
        const members = group ? state.users.filter((u) => Number(u.group_id) === Number(group.id)) : [];
        el('urMembers').innerHTML = group
            ? (members.length ? `Members: ${members.map((u) => esc(`${u.first_name} ${u.last_name || ''}`.trim())).join(', ')}` : 'No members yet.')
            : '';
        if (group) renderRights();
    }

    function renderStaff() {
        const groupOptions = state.groups.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');
        el('urStaffBody').innerHTML = state.users.map((u) => {
            const active = Number(u.is_active) === 1;
            const loose = !u.group_id && Number(u.rights_count) > 0;
            return `<tr class="${active ? '' : 'ur-inactive'}">
                <td><strong>${esc(`${u.first_name} ${u.last_name || ''}`.trim())}</strong><small>${esc(u.email)}</small></td>
                <td>${active ? '<span class="ur-state ur-on">Active</span>' : '<span class="ur-state">Inactive</span>'}</td>
                <td>${esc(u.rights_count)}${loose ? '<small class="ur-warn">Not from a group</small>' : ''}</td>
                <td>
                    <select class="form-control ur-staff-group" data-user="${esc(u.id)}" aria-label="Group for ${esc(u.first_name)}">
                        <option value="">No group</option>${groupOptions}
                    </select>
                </td>
            </tr>`;
        }).join('') || '<tr><td colspan="4">No staff accounts.</td></tr>';
        document.querySelectorAll('.ur-staff-group').forEach((select) => {
            const user = state.users.find((u) => Number(u.id) === Number(select.dataset.user));
            select.value = user && user.group_id ? String(user.group_id) : '';
        });
    }

    const ACTION_LABELS = {
        create_group: 'Created group', rename_group: 'Renamed group', delete_group: 'Deleted group',
        set_group_rights: 'Changed group rights', set_user_rights: 'Changed user rights',
        assign_group: 'Moved to group', remove_group: 'Removed from group',
    };

    async function renderLog() {
        const body = el('urLogBody');
        body.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';
        const { ok, data } = await api('audit');
        if (!ok) {
            body.innerHTML = '<tr><td colspan="5">Could not load the log.</td></tr>';
            return;
        }
        const names = new Map(state.catalog.rights.map((r) => [r.key, r.label]));
        const list = (text) => String(text || '').split(', ').filter(Boolean).map((k) => esc(names.get(k) || k)).join(', ');
        body.innerHTML = data.entries.map((e) => `<tr>
            <td>${esc(new Date(e.created_at).toLocaleString('en-GB'))}</td>
            <td>${esc(e.actor_name)}</td>
            <td>${esc(ACTION_LABELS[e.action] || e.action)}: <strong>${esc(e.target_name)}</strong></td>
            <td>${list(e.added) || '-'}</td>
            <td>${list(e.removed) || '-'}</td>
        </tr>`).join('') || '<tr><td colspan="5">No changes recorded yet.</td></tr>';
    }

    async function loadData() {
        const [groups, users] = await Promise.all([api('groups'), api('users')]);
        state.groups = groups.ok ? groups.data.groups : [];
        state.users = users.ok ? users.data.users : [];
    }

    async function selectGroup(id) {
        if (unsavedCount() && !window.confirm('Discard unsaved rights changes?')) return;
        state.groupId = id;
        state.creating = false;
        const { ok, data } = await api(`group/${id}/permissions`);
        const known = new Set(state.catalog.rights.map((r) => r.key));
        const keys = ok ? data.permissions.filter((k) => known.has(k)) : [];
        state.selected = new Set(keys);
        state.saved = new Set(keys);
        renderGroupList();
        renderEditor();
    }

    function showView(view) {
        document.querySelectorAll('.ur-tab').forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
        document.querySelectorAll('.ur-view').forEach((v) => { v.style.display = v.dataset.view === view ? '' : 'none'; });
        if (view === 'log') renderLog();
        if (view === 'staff') renderStaff();
    }

    async function refresh() {
        await loadData();
        renderGroupList();
        renderEditor();
        renderStaff();
    }

    function bind() {
        if (state.bound) return;
        state.bound = true;

        document.querySelectorAll('.ur-tab').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

        el('urGroupList').addEventListener('click', (e) => {
            const button = e.target.closest('[data-group]');
            if (button) selectGroup(Number(button.dataset.group));
        });

        el('urNewGroup').addEventListener('click', () => {
            if (unsavedCount() && !window.confirm('Discard unsaved rights changes?')) return;
            state.groupId = null;
            state.creating = true;
            state.selected = new Set();
            state.saved = new Set();
            renderGroupList();
            renderEditor();
            el('urGroupName').focus();
        });

        el('urSaveGroup').addEventListener('click', async () => {
            const name = el('urGroupName').value.trim();
            const description = el('urGroupDesc').value.trim();
            if (!name) { showWarning('Group Name', 'Enter a group name'); return; }
            const editing = Boolean(state.groupId);
            const { ok, data } = await api(editing ? `groups/${state.groupId}` : 'groups', {
                method: editing ? 'PUT' : 'POST',
                body: JSON.stringify({ name, description }),
            });
            if (!ok) { showError('Could Not Save', data.message || 'Failed to save the group'); return; }
            showSuccess('Saved', editing ? 'Group updated' : 'Group created. Now choose its rights.');
            const id = editing ? state.groupId : data.group_id;
            state.selected = new Set();
            state.saved = new Set();
            await loadData();
            await selectGroup(id);
        });

        el('urDeleteGroup').addEventListener('click', async () => {
            const group = state.groups.find((g) => Number(g.id) === Number(state.groupId));
            if (!group || !window.confirm(`Delete group "${group.name}"?`)) return;
            const { ok, data } = await api(`groups/${group.id}`, { method: 'DELETE' });
            if (!ok) { showError('Could Not Delete', data.message || 'Failed to delete the group'); return; }
            showSuccess('Deleted', 'Group deleted');
            state.groupId = null;
            state.selected = new Set();
            state.saved = new Set();
            await refresh();
        });

        el('urTemplate').addEventListener('change', (e) => {
            const template = state.catalog.templates.find((t) => t.key === e.target.value);
            e.target.value = '';
            if (!template) return;
            if (state.selected.size && !window.confirm(`Replace this group's ticks with "${template.label}"? Nothing is saved yet.`)) return;
            state.selected = new Set(template.rights);
            renderRights();
        });

        el('urSearch').addEventListener('input', (e) => { state.query = e.target.value; renderRights(); });
        el('urRiskOnly').addEventListener('change', (e) => { state.riskOnly = e.target.checked; renderRights(); });
        el('urExpand').addEventListener('click', () => {
            const all = state.open.size === state.catalog.modules.length;
            state.open = all ? new Set() : new Set(state.catalog.modules);
            el('urExpand').textContent = all ? 'Expand all' : 'Collapse all';
            renderRights();
        });

        el('urRights').addEventListener('click', (e) => {
            const toggle = e.target.closest('[data-module]');
            if (toggle) {
                const m = toggle.dataset.module;
                if (state.open.has(m)) state.open.delete(m); else state.open.add(m);
                renderRights();
                return;
            }
            const all = e.target.closest('[data-all]');
            if (all) {
                const rights = state.catalog.rights.filter((r) => r.module === all.dataset.all);
                const every = rights.every((r) => state.selected.has(r.key));
                rights.forEach((r) => (every ? state.selected.delete(r.key) : state.selected.add(r.key)));
                renderRights();
            }
        });
        el('urRights').addEventListener('change', (e) => {
            const key = e.target.dataset.right;
            if (!key) return;
            if (e.target.checked) state.selected.add(key); else state.selected.delete(key);
            renderRights();
        });

        el('urSaveRights').addEventListener('click', async () => {
            const result = await saveWithConfirm(`group/${state.groupId}/permissions`, { permissions: [...state.selected] });
            if (!result) return;
            if (!result.ok) { showError('Could Not Save', result.data.message || 'Failed to save rights'); return; }
            showSuccess('Saved', 'Rights saved. They apply to members straight away.');
            state.saved = new Set(state.selected);
            await refresh();
        });

        el('urStaffBody').addEventListener('change', async (e) => {
            if (!e.target.classList.contains('ur-staff-group')) return;
            const groupId = e.target.value ? Number(e.target.value) : null;
            const result = await saveWithConfirm(`user/${e.target.dataset.user}/group`, { group_id: groupId });
            if (result && result.ok) showSuccess('Saved', 'Staff member updated');
            else if (result) showError('Could Not Save', result.data.message || 'Failed to update');
            await refresh();
        });
    }

    window.loadUserRights = async function loadUserRights() {
        if (!state.catalog) {
            const { ok, data } = await api('catalog');
            if (!ok) {
                el('urEmpty').textContent = data.message || 'Only administrators can manage rights.';
                return;
            }
            state.catalog = data;
            el('urAdminOnly').innerHTML = data.admin_only.map((item) => `<li>${esc(item)}</li>`).join('');
            el('urTemplate').innerHTML = '<option value="">Start from a job template...</option>'
                + data.templates.map((t) => `<option value="${esc(t.key)}" title="${esc(t.description)}">${esc(t.label)}: ${esc(t.description)}</option>`).join('');
        }
        bind();
        await refresh();
    };
})();
