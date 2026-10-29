// Store Payments & Balances report (admin > Reports).
// API: GET /api/financial/reports/store-payments and
//      GET /api/financial/reports/store-payments/:storeId/statement
// Every value from the API is escaped before it is put into the page.

(function () {
    'use strict';

    const state = { data: null, statement: null, storesLoaded: false, view: 'report' };

    const esc = (value) => String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const num = (value) => {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
    };
    const fmt = (value) => Math.abs(num(value)).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const money = (value) => `${num(value) < -0.004 ? '-' : ''}Rs ${fmt(value)}`;
    const moneyCell = (value, extraClass = '') => {
        const zero = Math.abs(num(value)) < 0.005;
        return `<td class="num${zero ? ' sp-zero' : ''}${extraClass ? ` ${extraClass}` : ''}">${zero ? '-' : esc(money(value))}</td>`;
    };
    const dateText = (ymd) => {
        if (!ymd) return '-';
        const [y, m, d] = String(ymd).slice(0, 10).split('-');
        return y && m && d ? `${d}-${m}-${y}` : esc(ymd);
    };
    const termLabel = (term) => esc(term || 'Not set');

    function balanceBadge(status) {
        if (status === 'owed_to_store') return '<span class="status-owed">Owed to store</span>';
        if (status === 'store_credit') return '<span class="status-store-credit">Store credit</span>';
        return '<span class="status-settled">Settled</span>';
    }
    function balanceClass(value) {
        if (num(value) > 0.004) return 'sp-amount-owed';
        if (num(value) < -0.004) return 'sp-amount-credit';
        return 'sp-amount-settled';
    }

    async function api(path) {
        const response = await fetch(`${API_BASE}/api/financial/${path}`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        let data = {};
        try { data = await response.json(); } catch (_) { /* not JSON */ }
        if (!response.ok || !data.success) throw new Error(data.message || 'Request failed');
        return data;
    }

    function filters() {
        return {
            from: document.getElementById('spFrom')?.value || '',
            to: document.getElementById('spTo')?.value || '',
            store: document.getElementById('spStore')?.value || 'all',
            term: document.getElementById('spTerm')?.value || 'all',
            search: (document.getElementById('spSearch')?.value || '').trim(),
            onlyBalance: !!document.getElementById('spOnlyBalance')?.checked
        };
    }

    function periodText(f) {
        if (f.from && f.to) return `${dateText(f.from)} to ${dateText(f.to)}`;
        if (f.from) return `from ${dateText(f.from)}`;
        if (f.to) return `up to ${dateText(f.to)}`;
        return 'all time';
    }

    function showView(view) {
        state.view = view;
        const report = document.getElementById('spReportView');
        const statement = document.getElementById('spStatementView');
        if (report) report.style.display = view === 'report' ? '' : 'none';
        if (statement) statement.style.display = view === 'statement' ? '' : 'none';
    }

    // ------------------------------------------------------------------ report

    async function loadStorePaymentsReport() {
        const wrap = document.getElementById('spTableWrap');
        if (!wrap) return;
        showView('report');
        const f = filters();
        const qs = new URLSearchParams();
        if (f.from) qs.set('from', f.from);
        if (f.to) qs.set('to', f.to);
        if (f.store && f.store !== 'all') qs.set('store_id', f.store);
        if (f.term && f.term !== 'all') qs.set('payment_term', f.term);
        if (f.search) qs.set('search', f.search);
        if (f.onlyBalance) qs.set('only_balance', '1');
        wrap.innerHTML = '<p style="padding:1rem">Loading...</p>';
        try {
            const data = await api(`reports/store-payments?${qs}`);
            state.data = data;
            if (!state.storesLoaded && f.store === 'all' && f.term === 'all' && !f.search && !f.onlyBalance) {
                const select = document.getElementById('spStore');
                if (select) {
                    const options = data.stores
                        .slice()
                        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
                        .map((s) => `<option value="${esc(s.store_id)}">${esc(s.name)}</option>`)
                        .join('');
                    select.innerHTML = `<option value="all">All stores</option>${options}`;
                    state.storesLoaded = true;
                }
            }
            renderKpis(data, f);
            renderTable(data);
            renderNotes(data);
            renderFlags(data);
        } catch (error) {
            console.error('Store payments report:', error);
            wrap.innerHTML = `<p style="padding:1rem">${esc(error.message || 'Failed to load the report')}</p>`;
        }
    }

    function kpi(label, value, note, cls) {
        return `<div class="sp-kpi ${cls || ''}"><div class="sp-kpi-label">${esc(label)}</div>` +
            `<div class="sp-kpi-value">${esc(value)}</div>${note ? `<div class="sp-kpi-note">${esc(note)}</div>` : ''}</div>`;
    }

    function renderKpis(data, f) {
        const t = data.totals || {};
        const flagsCount = (data.flags?.double_payments?.length || 0) + (data.flags?.net_mismatches?.length || 0);
        document.getElementById('spKpis').innerHTML = [
            kpi('Owed to stores', money(t.owed_to_stores), `Closing balance, ${periodText(f)}`, 'is-owed'),
            kpi('Store credit (overpaid)', money(t.store_credit), `${data.flags?.stores_with_credit?.length || 0} store(s) paid more than earned`, 'is-credit'),
            kpi('Unsettled after credit', money(t.unsettled_amount), `${t.unsettled_orders || 0} order(s) still to pay`, t.overdue_stores ? 'is-danger' : 'is-ok'),
            kpi('Credit given in period', money(t.credit_given), `${t.delivered_orders || 0} delivered order(s)`),
            kpi('Paid in period', money(t.total_paid), 'Settlements, pickup, vouchers'),
            kpi('Overdue stores', String(t.overdue_stores || 0), 'Oldest unpaid order past grace days', t.overdue_stores ? 'is-danger' : 'is-ok'),
            kpi('Possible double payments', String(data.flags?.double_payments?.length || 0), flagsCount ? 'See data issues below' : 'None found', data.flags?.double_payments?.length ? 'is-danger' : 'is-ok')
        ].join('');
    }

    function renderTable(data) {
        const wrap = document.getElementById('spTableWrap');
        const rows = data.stores || [];
        if (!rows.length) {
            wrap.innerHTML = '<p style="padding:1rem">No stores match these filters.</p>';
            return;
        }
        const head = `
            <thead>
                <tr>
                    <th rowspan="2">Store</th>
                    <th rowspan="2">Payment term</th>
                    <th class="sp-group" colspan="4">Period</th>
                    <th class="sp-group" colspan="7">Paid in period</th>
                    <th class="sp-group" colspan="2">Balance</th>
                    <th class="sp-group" colspan="4">Unsettled now (after store credit)</th>
                    <th class="sp-group" colspan="4">Aging of unsettled (days)</th>
                    <th rowspan="2">Last payment</th>
                </tr>
                <tr>
                    <th class="num">Orders</th><th class="num">Gross sales</th><th class="num">Kept by ServeNow</th><th class="num">Credit given</th>
                    <th class="num">Cash</th><th class="num">Bank</th><th class="num">Cheque</th><th class="num">Rider at pickup</th><th class="num">Vouchers</th><th class="num">Adjust.</th><th class="num">Total paid</th>
                    <th class="num">Opening</th><th class="num">Closing</th>
                    <th class="num">Orders</th><th class="num">Amount</th><th>Oldest</th><th class="num">Days</th>
                    <th class="num">0-7</th><th class="num">8-15</th><th class="num">16-30</th><th class="num">30+</th>
                </tr>
            </thead>`;
        const body = rows.map((r) => `
            <tr>
                <td class="sp-store"><a href="#" data-sp-store="${esc(r.store_id)}">${esc(r.name)}</a>${r.exists ? '' : '<span class="sp-sub">Deleted store</span>'}${!r.is_active && r.exists ? '<span class="sp-sub">Inactive</span>' : ''}</td>
                <td>${termLabel(r.payment_term)}<span class="sp-sub">${num(r.discount_percent) > 0 ? `${esc(num(r.discount_percent))}% discount` : 'No discount'} &middot; ${esc(r.grace_days || 0)} grace days</span></td>
                <td class="num">${esc(r.delivered_orders)}</td>
                ${moneyCell(r.gross_sales)}${moneyCell(r.commission)}${moneyCell(r.credit_given)}
                ${moneyCell(r.paid_cash)}${moneyCell(r.paid_bank)}${moneyCell(r.paid_cheque)}${moneyCell(r.paid_pickup)}${moneyCell(r.paid_vouchers)}${moneyCell(r.paid_adjustments)}${moneyCell(r.total_paid)}
                ${moneyCell(r.opening_balance)}
                <td class="num"><span class="${balanceClass(r.closing_balance)}">${esc(money(r.closing_balance))}</span><span class="sp-sub">${balanceBadge(r.balance_status)}</span></td>
                <td class="num">${esc(r.unsettled_orders)}</td>
                ${moneyCell(r.unsettled_amount)}
                <td>${r.oldest_unpaid ? dateText(r.oldest_unpaid) : '-'}</td>
                <td class="num">${r.oldest_unpaid ? esc(r.days_outstanding) : '-'}${r.overdue ? ' <span class="status-overdue">Overdue</span>' : ''}</td>
                ${moneyCell(r.aging?.d0_7)}${moneyCell(r.aging?.d8_15)}${moneyCell(r.aging?.d16_30)}${moneyCell(r.aging?.d30_plus)}
                <td>${r.last_payment_date ? `${dateText(r.last_payment_date)}<span class="sp-sub">${esc(money(r.last_payment_amount))}</span>` : '-'}</td>
            </tr>`).join('');
        const t = data.totals || {};
        const foot = `
            <tfoot>
                <tr>
                    <th>Total (${esc(rows.length)} stores)</th><th></th>
                    <th class="num">${esc(t.delivered_orders)}</th>
                    <th class="num">${esc(money(t.gross_sales))}</th><th class="num">${esc(money(t.commission))}</th><th class="num">${esc(money(t.credit_given))}</th>
                    <th class="num">${esc(money(t.paid_cash))}</th><th class="num">${esc(money(t.paid_bank))}</th><th class="num">${esc(money(t.paid_cheque))}</th>
                    <th class="num">${esc(money(t.paid_pickup))}</th><th class="num">${esc(money(t.paid_vouchers))}</th><th class="num">${esc(money(t.paid_adjustments))}</th><th class="num">${esc(money(t.total_paid))}</th>
                    <th class="num">${esc(money(t.opening_balance))}</th><th class="num">${esc(money(t.closing_balance))}</th>
                    <th class="num">${esc(t.unsettled_orders)}</th><th class="num">${esc(money(t.unsettled_amount))}</th><th></th><th></th>
                    <th class="num">${esc(money(t.aging?.d0_7))}</th><th class="num">${esc(money(t.aging?.d8_15))}</th><th class="num">${esc(money(t.aging?.d16_30))}</th><th class="num">${esc(money(t.aging?.d30_plus))}</th>
                    <th></th>
                </tr>
            </tfoot>`;
        wrap.innerHTML = `<table class="data-table sp-table">${head}<tbody>${body}</tbody>${foot}</table>`;
    }

    function renderNotes(data) {
        const n = data.notes || {};
        const parts = [];
        if (num(n.unallocated_store_payments) > 0) {
            parts.push(`Store payments not assigned to any store (for example CPV-40 "Historical Cash Store Purchase Adjustment"): <strong>${esc(money(n.unallocated_store_payments))}</strong>. They reduce total store payables in the general ledger but no single store's balance, so pickup-paid stores from before 19 May 2026 can show a balance owed here.`);
        }
        if (num(n.unidentified_pickup_payments) !== 0) {
            parts.push(`Rider pickup payments whose store could not be identified (posted to suspense in the ledger): <strong>${esc(money(n.unidentified_pickup_payments))}</strong>.`);
        }
        parts.push('Credit stores are owed price less the store discount; pickup-paid stores (Cash Only, Cash with Discount) are owed cost price. Period columns use the delivery date (the rider\'s first cash collection) and the payment date.');
        document.getElementById('spNotes').innerHTML = `<div class="sp-note">${parts.join('<br>')}</div>`;
    }

    // ------------------------------------------------- collapsible data issues
    // Each data-issue list is a native <details> panel, collapsed by default.
    // Open/closed state is remembered per panel in localStorage.

    const PANEL_STORE_KEY = 'spIssuePanels';

    function readPanelState() {
        try {
            const parsed = JSON.parse(localStorage.getItem(PANEL_STORE_KEY) || '{}');
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_) {
            return {};
        }
    }

    function savePanelState(key, open) {
        try {
            const current = readPanelState();
            current[key] = !!open;
            localStorage.setItem(PANEL_STORE_KEY, JSON.stringify(current));
        } catch (_) { /* storage unavailable: state is simply not remembered */ }
    }

    const panelOpenAttr = (key) => (readPanelState()[key] === true ? ' open' : '');

    function panelSummary(title, count, total, totalTitle) {
        return '<summary class="sp-disclosure-head">' +
            `<span class="sp-disclosure-title">${esc(title)}</span>` +
            '<span class="sp-disclosure-meta">' +
            `<span class="sp-flag-count${count ? '' : ' is-zero'}"><span class="sn-visually-hidden">Count: </span>${esc(count)}</span>` +
            (total === null ? '' : `<span class="sp-disclosure-total"${totalTitle ? ` title="${esc(totalTitle)}"` : ''}><span class="sn-visually-hidden">${esc(totalTitle || 'Total')}: </span>${esc(money(total))}</span>`) +
            '</span>' +
            '<i class="fas fa-chevron-down sp-chevron" aria-hidden="true"></i>' +
            '</summary>';
    }

    // items: [{ storeId, storeName, amount, html }] where html is one <tr>.
    function flagSection(key, title, hint, headers, items, totalTitle) {
        const count = items.length;
        const total = items.reduce((sum, it) => sum + num(it.amount), 0);
        const panelId = `spIssue-${key}`;
        let body;
        if (count) {
            const stores = new Map();
            for (const it of items) {
                const id = String(it.storeId === null || it.storeId === undefined ? '' : it.storeId);
                if (!stores.has(id)) stores.set(id, { name: it.storeName || `Store ${id}`, n: 0 });
                stores.get(id).n += 1;
            }
            const options = [...stores.entries()]
                .sort((a, b) => String(a[1].name).localeCompare(String(b[1].name)))
                .map(([id, s]) => `<option value="${esc(id)}">${esc(s.name)} (${esc(s.n)})</option>`)
                .join('');
            const rows = items
                .map((it) => it.html.replace(/^<tr/, `<tr data-sp-row-store="${esc(it.storeId)}" data-sp-row-amount="${esc(num(it.amount))}"`))
                .join('');
            body = `
                <div class="sp-issue-tools">
                    <label for="${panelId}-store">Store</label>
                    <select id="${panelId}-store" class="form-control" data-sp-issue-filter="${esc(key)}">
                        <option value="all">All stores (${esc(stores.size)})</option>${options}
                    </select>
                    <span class="sp-issue-shown" data-sp-issue-shown="${esc(key)}" aria-live="polite">Showing ${esc(count)} of ${esc(count)} &middot; ${esc(money(total))}</span>
                </div>
                <div class="table-container sp-issue-scroll" tabindex="0" role="region" aria-label="${esc(title)}">
                    <table class="data-table sp-table sp-issue-table"><thead><tr>${headers.map((h) => `<th scope="col"${h.num ? ' class="num"' : ''}>${esc(h.label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
                </div>`;
        } else {
            body = '<p class="sp-hint">Nothing found.</p>';
        }
        return `<details class="sp-section sp-disclosure" id="${panelId}" data-sp-panel="${esc(key)}"${panelOpenAttr(key)}>` +
            panelSummary(title, count, count ? total : null, totalTitle) +
            `<div class="sp-disclosure-body"><p class="sp-hint">${esc(hint)}</p>${body}</div>` +
            '</details>';
    }

    function applyIssueFilter(select) {
        const panel = select.closest('.sp-disclosure');
        if (!panel) return;
        const value = select.value;
        let shown = 0;
        let total = 0;
        const rows = panel.querySelectorAll('tbody tr[data-sp-row-store]');
        rows.forEach((tr) => {
            const match = value === 'all' || tr.dataset.spRowStore === value;
            tr.hidden = !match;
            if (match) {
                shown += 1;
                total += num(tr.dataset.spRowAmount);
            }
        });
        const label = panel.querySelector('[data-sp-issue-shown]');
        if (label) {
            const option = select.options[select.selectedIndex];
            const storeName = value === 'all' || !option ? '' : ` for ${option.text.replace(/\s\(\d+\)$/, '')}`;
            label.textContent = `Showing ${shown} of ${rows.length}${storeName} · ${money(total)}`;
        }
        const scroller = panel.querySelector('.sp-issue-scroll');
        if (scroller) scroller.scrollTop = 0;
    }

    const storeLink = (r) => `<a href="#" data-sp-store="${esc(r.store_id)}">${esc(r.store_name)}</a>`;

    function renderFlags(data) {
        const fl = data.flags || {};
        const item = (r, amount, html) => ({ storeId: r.store_id, storeName: r.store_name, amount, html });
        const html = [
            '<h2 style="margin-top:1.5rem">Data issues to review</h2>',
            '<p class="text-muted">Read-only. Nothing here is changed automatically; corrections go through a journal voucher or the documented link script. Open a list to review it.</p>',
            flagSection('credit', 'Stores with credit (possible double payments)',
                'These stores were paid more than they earned from delivered orders. Their unsettled orders are covered by this credit before anything new is paid.',
                [{ label: 'Store' }, { label: 'Payment term' }, { label: 'Store credit', num: true }],
                (fl.stores_with_credit || []).map((r) => item(r, r.store_credit, `<tr><td>${storeLink(r)}</td><td>${termLabel(r.payment_term)}</td><td class="num sp-amount-credit">${esc(money(r.store_credit))}</td></tr>`)),
                'Total store credit'),
            flagSection('unlinked', 'Lump-sum payments not linked to orders',
                'Paid settlements with no order lines. "Payment on account" entries were recorded on purpose; older ones are lump sums whose orders kept showing as due.',
                [{ label: 'Store' }, { label: 'Settlement' }, { label: 'Paid on' }, { label: 'Method' }, { label: 'Amount', num: true }, { label: 'Type' }],
                (fl.unlinked_payments || []).map((r) => item(r, r.amount, `<tr><td>${storeLink(r)}</td><td>${esc(r.settlement_number)}</td><td>${dateText(r.date)}</td><td>${esc(r.payment_method)}</td><td class="num">${esc(money(r.amount))}</td><td>${r.on_account ? '<span class="status-on-account">Payment on account</span>' : '<span class="status-due">Unlinked lump sum</span>'}</td></tr>`)),
                'Total paid'),
            flagSection('double', 'Order lines paid by a lump sum and then settled again',
                'The lump sum paid the oldest open order lines first; a later settlement linked the same lines and paid them again.',
                [{ label: 'Store' }, { label: 'Later settlement' }, { label: 'Status' }, { label: 'Lines delivered' }, { label: 'Paid earlier by' }, { label: 'Paid twice', num: true }],
                (fl.double_payments || []).map((r) => item(r, r.double_paid, `<tr><td>${storeLink(r)}</td><td>${esc(r.settlement_number)}<span class="sp-sub">${dateText(r.settlement_date)}</span></td><td><span class="status-${esc(r.settlement_status)}">${esc(r.settlement_status)}</span></td><td>${dateText(r.items_from)} to ${dateText(r.items_to)}</td><td>${(r.lump_payments || []).map((l) => `${esc(l.ref)} (${esc(money(l.amount))})`).join('<br>')}</td><td class="num"><span class="status-double-paid">${esc(money(r.double_paid))}</span></td></tr>`)),
                'Total paid twice'),
            flagSection('mismatch', 'Settlements whose net does not add up',
                'Net amount differs from total orders - commissions - deductions - store credit applied.',
                [{ label: 'Store' }, { label: 'Settlement' }, { label: 'Status' }, { label: 'Total', num: true }, { label: 'Commissions', num: true }, { label: 'Deductions', num: true }, { label: 'Credit applied', num: true }, { label: 'Expected net', num: true }, { label: 'Net paid', num: true }, { label: 'Difference', num: true }],
                (fl.net_mismatches || []).map((r) => item(r, Math.abs(num(r.difference)), `<tr><td>${storeLink(r)}</td><td>${esc(r.settlement_number)}<span class="sp-sub">${dateText(r.date)}</span></td><td><span class="status-${esc(r.status)}">${esc(r.status)}</span></td><td class="num">${esc(money(r.total_orders_amount))}</td><td class="num">${esc(money(r.commissions))}</td><td class="num">${esc(money(r.deductions))}</td><td class="num">${esc(money(r.credit_applied))}</td><td class="num">${esc(money(r.expected_net))}</td><td class="num">${esc(money(r.net_amount))}</td><td class="num ${num(r.difference) > 0 ? 'sp-amount-credit' : 'sp-amount-owed'}">${esc(money(r.difference))}</td></tr>`)),
                'Total difference (absolute)')
        ].join('');
        document.getElementById('spFlags').innerHTML = html;
    }

    // --------------------------------------------------------------- statement

    async function openStoreStatement(storeId) {
        const view = document.getElementById('spStatementView');
        if (!view) return;
        showView('statement');
        view.innerHTML = '<p style="padding:1rem">Loading statement...</p>';
        const f = filters();
        const qs = new URLSearchParams();
        if (f.from) qs.set('from', f.from);
        if (f.to) qs.set('to', f.to);
        try {
            const data = await api(`reports/store-payments/${encodeURIComponent(storeId)}/statement?${qs}`);
            state.statement = data;
            renderStatement(data, f);
            view.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (error) {
            console.error('Store statement:', error);
            view.innerHTML = `<p style="padding:1rem">${esc(error.message || 'Failed to load the statement')}</p>`;
        }
    }

    function entryDescription(e) {
        if (e.type === 'order' && e.order_id) {
            return `<button type="button" class="sp-link" data-sp-order="${esc(e.order_id)}">${esc(e.label)}</button><span class="sp-sub">${esc(e.lines)} line(s), gross ${esc(money(e.gross))}</span>`;
        }
        if ((e.type === 'settlement' || e.type === 'on_account') && e.settlement_id) {
            const sub = e.type === 'on_account' ? 'Payment on account' : (e.linked_items ? `${esc(e.linked_items)} order line(s) linked` : 'No order lines linked');
            return `<button type="button" class="sp-link" data-sp-settlement="${esc(e.settlement_id)}">${esc(e.label)}</button><span class="sp-sub">${sub} &middot; ${esc(e.payment_method || '')}</span>`;
        }
        if (e.type === 'pickup' && e.order_id) {
            return `<button type="button" class="sp-link" data-sp-order="${esc(e.order_id)}">${esc(e.label)}</button>`;
        }
        return esc(e.label);
    }

    const typeLabels = {
        order: 'Order delivered', settlement: 'Settlement', on_account: 'Payment on account', pickup: 'Rider paid at pickup',
        voucher: 'Payment voucher', receipt: 'Receipt', journal: 'Journal voucher'
    };

    function renderStatement(d, f) {
        const s = d.store;
        const st = d.statement;
        const p = d.position;
        const entries = st.entries.map((e) => `
            <tr>
                <td>${dateText(e.date)}</td>
                <td>${esc(typeLabels[e.type] || e.type)}</td>
                <td>${entryDescription(e)}</td>
                ${moneyCell(e.credit_given)}
                ${moneyCell(e.paid)}
                <td class="num"><span class="${balanceClass(e.balance)}">${esc(money(e.balance))}</span></td>
            </tr>`).join('');
        const openOrders = d.open_orders.map((o) => `
            <tr class="${o.status === 'covered' ? 'sp-row-covered' : ''}">
                <td>${dateText(o.date)}</td>
                <td><button type="button" class="sp-link" data-sp-order="${esc(o.order_id)}">#${esc(o.order_number)}</button></td>
                <td class="num">${esc(o.lines)}</td>
                ${moneyCell(o.payable)}${moneyCell(o.covered_by_credit)}${moneyCell(o.due)}
                <td class="num">${esc(o.days)}</td>
                <td>${o.status === 'covered' ? '<span class="status-covered">Covered by credit</span>' : o.status === 'partly_covered' ? '<span class="status-partly-covered">Partly covered</span>' : (num(o.days) > num(s.grace_days) ? '<span class="status-overdue">Overdue</span>' : '<span class="status-due">Due</span>')}</td>
            </tr>`).join('');
        const settlements = d.settlements.slice().reverse().map((x) => `
            <tr>
                <td><button type="button" class="sp-link" data-sp-settlement="${esc(x.id)}">${esc(x.settlement_number)}</button></td>
                <td>${dateText(x.date)}</td>
                <td><span class="status-${esc(x.status)}">${esc(x.status)}</span></td>
                <td>${x.on_account ? '<span class="status-on-account">On account</span>' : x.linked_items ? `${esc(x.linked_items)} line(s)` : '<span class="status-due">No orders linked</span>'}</td>
                ${moneyCell(x.total_orders_amount)}${moneyCell(x.commissions)}${moneyCell(x.credit_applied)}${moneyCell(x.net_amount)}
            </tr>`).join('');
        const fl = d.flags || {};
        const doubles = (fl.double || []).map((r) => `<li><strong>${esc(r.settlement_number)}</strong> (${dateText(r.settlement_date)}) linked order lines delivered ${dateText(r.items_from)} to ${dateText(r.items_to)} that were already paid by ${(r.lump_payments || []).map((l) => `${esc(l.ref)} ${esc(money(l.amount))}`).join(', ')}: <span class="status-double-paid">${esc(money(r.double_paid))} paid twice</span></li>`).join('');
        const unlinked = (fl.unlinked || []).map((r) => `<li>${esc(r.settlement_number)} on ${dateText(r.date)}: ${esc(money(r.amount))} ${r.on_account ? '(payment on account)' : 'not linked to any order'}</li>`).join('');
        const mismatch = (fl.mismatch || []).map((r) => `<li>${esc(r.settlement_number)}: net ${esc(money(r.net_amount))}, expected ${esc(money(r.expected_net))}</li>`).join('');
        const issueCount = (fl.double || []).length + (fl.unlinked || []).length + (fl.mismatch || []).length;

        document.getElementById('spStatementView').innerHTML = `
            <div class="sp-statement-head">
                <div>
                    <h3>Statement: ${esc(s.name)}</h3>
                    <div class="sp-meta">
                        <span>${termLabel(s.payment_term)}</span>
                        <span>${num(s.discount_percent) > 0 ? `${esc(num(s.discount_percent))}% store discount` : 'No store discount'}</span>
                        <span>${esc(s.grace_days || 0)} grace days</span>
                        <span>Period: ${esc(periodText(f))}</span>
                    </div>
                </div>
                <div class="sp-actions">
                    <button type="button" class="btn btn-secondary" data-sp-back="1"><i class="fas fa-arrow-left"></i> All stores</button>
                    <button type="button" class="btn btn-secondary" onclick="exportStorePaymentsCsv()"><i class="fas fa-file-csv"></i> Export CSV</button>
                    <button type="button" class="btn btn-secondary" onclick="printStorePayments()"><i class="fas fa-print"></i> Print</button>
                </div>
            </div>
            <div class="sp-kpis">
                ${kpi('Opening balance', money(st.opening_balance), f.from ? `Before ${dateText(f.from)}` : 'Start of history')}
                ${kpi('Credit given', money(st.total_credit_given), 'Store payable of delivered orders', '')}
                ${kpi('Paid', money(st.total_paid), 'All payments to the store', '')}
                ${kpi('Closing balance', money(st.closing_balance), st.closing_balance < -0.004 ? 'Store credit: paid more than earned' : st.closing_balance > 0.004 ? 'Owed to the store' : 'Settled', st.closing_balance < -0.004 ? 'is-credit' : st.closing_balance > 0.004 ? 'is-owed' : 'is-ok')}
                ${kpi('Unsettled now', money(p.unsettled_amount), `${money(p.covered_by_credit)} of open orders covered by credit`, num(p.unsettled_amount) > 0 ? 'is-owed' : 'is-ok')}
            </div>
            <div class="sp-note">All time: payable ${esc(money(p.total_payable))} &middot; paid ${esc(money(p.total_paid))} &middot; balance <strong class="${balanceClass(p.balance)}">${esc(money(p.balance))}</strong>. Credit available before open orders ${esc(money(p.credit_before_open_orders))}; open orders ${esc(money(p.open_payable))}, covered ${esc(money(p.covered_by_credit))}, credit left ${esc(money(p.credit_left))}.</div>
            ${issueCount ? `<details class="sp-section sp-disclosure" id="spIssue-statement" data-sp-panel="statement"${panelOpenAttr('statement')}>${panelSummary('Data issues for this store', issueCount, null)}<div class="sp-disclosure-body"><ul class="sp-issue-list">${doubles}${unlinked}${mismatch}</ul></div></details>` : ''}
            <div id="spSettlementDetail"></div>
            <div class="sp-section">
                <h3>Statement</h3>
                <div class="table-container">
                    <table class="data-table sp-table">
                        <thead><tr><th>Date</th><th>Type</th><th>Description</th><th class="num">Credit given</th><th class="num">Paid</th><th class="num">Balance</th></tr></thead>
                        <tbody>
                            <tr><td>${f.from ? dateText(f.from) : '-'}</td><td>Opening</td><td>Opening balance</td><td></td><td></td><td class="num"><span class="${balanceClass(st.opening_balance)}">${esc(money(st.opening_balance))}</span></td></tr>
                            ${entries || '<tr><td colspan="6">No entries in this period</td></tr>'}
                        </tbody>
                        <tfoot><tr><th></th><th>Closing</th><th></th><th class="num">${esc(money(st.total_credit_given))}</th><th class="num">${esc(money(st.total_paid))}</th><th class="num">${esc(money(st.closing_balance))}</th></tr></tfoot>
                    </table>
                </div>
            </div>
            <div class="sp-section">
                <h3>Unsettled orders</h3>
                <p class="sp-hint">Delivered orders not linked to a settlement or paid at pickup. Store credit covers the oldest first.</p>
                <div class="table-container">
                    <table class="data-table sp-table">
                        <thead><tr><th>Delivered</th><th>Order</th><th class="num">Lines</th><th class="num">Payable</th><th class="num">Covered by credit</th><th class="num">Due</th><th class="num">Days</th><th>Status</th></tr></thead>
                        <tbody>${openOrders || '<tr><td colspan="8">No unsettled orders</td></tr>'}</tbody>
                    </table>
                </div>
            </div>
            <div class="sp-section">
                <h3>Settlements</h3>
                <div class="table-container">
                    <table class="data-table sp-table">
                        <thead><tr><th>Settlement</th><th>Date</th><th>Status</th><th>Orders</th><th class="num">Total orders</th><th class="num">Commissions</th><th class="num">Credit applied</th><th class="num">Net</th></tr></thead>
                        <tbody>${settlements || '<tr><td colspan="8">No settlements</td></tr>'}</tbody>
                    </table>
                </div>
            </div>`;
    }

    function showSettlementDetail(id) {
        const box = document.getElementById('spSettlementDetail');
        const x = (state.statement?.settlements || []).find((s) => Number(s.id) === Number(id));
        if (!box || !x) return;
        box.innerHTML = `
            <div class="sp-detail">
                <dl>
                    <dt>Settlement</dt><dd><strong>${esc(x.settlement_number)}</strong> <span class="status-${esc(x.status)}">${esc(x.status)}</span></dd>
                    <dt>Date</dt><dd>${dateText(x.date)}${x.paid_date ? ` (paid ${dateText(x.paid_date)})` : ''}</dd>
                    <dt>Type</dt><dd>${x.on_account ? 'Payment on account' : x.linked_items ? `${esc(x.linked_items)} order line(s) linked` : 'Lump sum, no order lines linked'}</dd>
                    <dt>Method</dt><dd>${esc(x.payment_method)}</dd>
                    <dt>Total orders</dt><dd>${esc(money(x.total_orders_amount))}</dd>
                    <dt>Commissions</dt><dd>${esc(money(x.commissions))}</dd>
                    <dt>Deductions</dt><dd>${esc(money(x.deductions))}</dd>
                    <dt>Store credit applied</dt><dd>${esc(money(x.credit_applied))}</dd>
                    <dt>Net</dt><dd><strong>${esc(money(x.net_amount))}</strong></dd>
                    <dt>Notes</dt><dd>${esc(x.notes || '-')}</dd>
                </dl>
                <button type="button" class="sp-link" data-sp-close-detail="1" style="margin-top:0.5rem">Close</button>
            </div>`;
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // ------------------------------------------------------------- export, print

    function csvCell(value) {
        let v = value === null || value === undefined ? '' : String(value);
        // Spreadsheet formula injection guard for text cells
        if (/^[=+@\t\r]/.test(v) || (/^-/.test(v) && !/^-?\d+(\.\d+)?$/.test(v))) v = `'${v}`;
        return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    }

    function download(name, rows) {
        const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }

    function exportStorePaymentsCsv() {
        const stamp = new Date().toISOString().slice(0, 10);
        if (state.view === 'statement' && state.statement) {
            const d = state.statement;
            const rows = [['Date', 'Type', 'Description', 'Reference', 'Credit given', 'Paid', 'Balance']];
            rows.push(['', 'Opening', 'Opening balance', '', '', '', d.statement.opening_balance]);
            for (const e of d.statement.entries) rows.push([e.date, typeLabels[e.type] || e.type, e.label, e.ref, e.credit_given, e.paid, e.balance]);
            rows.push(['', 'Closing', 'Closing balance', '', d.statement.total_credit_given, d.statement.total_paid, d.statement.closing_balance]);
            download(`store-statement-${d.store.store_id}-${stamp}.csv`, rows);
            return;
        }
        if (!state.data) return;
        const rows = [[
            'Store ID', 'Store', 'Payment term', 'Discount %', 'Grace days', 'Delivered orders', 'Gross sales', 'Kept by ServeNow', 'Credit given',
            'Paid cash', 'Paid bank', 'Paid cheque', 'Paid by rider at pickup', 'Paid by voucher', 'Adjustments', 'Total paid',
            'Opening balance', 'Closing balance', 'Balance status', 'Unsettled orders', 'Unsettled amount', 'Covered by credit', 'Oldest unpaid',
            'Days outstanding', 'Overdue', 'Aging 0-7', 'Aging 8-15', 'Aging 16-30', 'Aging 30+', 'Last payment date', 'Last payment amount'
        ]];
        for (const r of state.data.stores) {
            rows.push([r.store_id, r.name, r.payment_term || '', r.discount_percent, r.grace_days, r.delivered_orders, r.gross_sales, r.commission, r.credit_given,
                r.paid_cash, r.paid_bank, r.paid_cheque, r.paid_pickup, r.paid_vouchers, r.paid_adjustments, r.total_paid,
                r.opening_balance, r.closing_balance, r.balance_status, r.unsettled_orders, r.unsettled_amount, r.covered_by_credit, r.oldest_unpaid || '',
                r.oldest_unpaid ? r.days_outstanding : '', r.overdue ? 'yes' : 'no', r.aging.d0_7, r.aging.d8_15, r.aging.d16_30, r.aging.d30_plus,
                r.last_payment_date || '', r.last_payment_amount == null ? '' : r.last_payment_amount]);
        }
        const t = state.data.totals;
        rows.push(['', 'Total', '', '', '', t.delivered_orders, t.gross_sales, t.commission, t.credit_given, t.paid_cash, t.paid_bank, t.paid_cheque,
            t.paid_pickup, t.paid_vouchers, t.paid_adjustments, t.total_paid, t.opening_balance, t.closing_balance, '', t.unsettled_orders, t.unsettled_amount,
            t.covered_by_credit, '', '', '', t.aging.d0_7, t.aging.d8_15, t.aging.d16_30, t.aging.d30_plus, '', '']);
        download(`store-payments-${stamp}.csv`, rows);
    }

    function printStorePayments() {
        document.body.classList.add('sp-printing');
        const done = () => {
            document.body.classList.remove('sp-printing');
            window.removeEventListener('afterprint', done);
        };
        window.addEventListener('afterprint', done);
        window.print();
        setTimeout(done, 2000);
    }

    function openStorePaymentsReport(event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        if (typeof switchTab === 'function') switchTab('store-payments');
        else window.location.hash = 'store-payments';
        return false;
    }

    // ------------------------------------------------------------------ events

    document.addEventListener('click', (event) => {
        const target = event.target.closest('[data-sp-store],[data-sp-order],[data-sp-settlement],[data-sp-back],[data-sp-close-detail]');
        if (!target || !target.closest('#store-payments')) return;
        event.preventDefault();
        if (target.dataset.spStore) openStoreStatement(target.dataset.spStore);
        else if (target.dataset.spOrder) {
            if (typeof viewOrderDetails === 'function') viewOrderDetails(Number(target.dataset.spOrder));
        } else if (target.dataset.spSettlement) showSettlementDetail(target.dataset.spSettlement);
        else if (target.dataset.spBack) showView('report');
        else if (target.dataset.spCloseDetail) {
            const box = document.getElementById('spSettlementDetail');
            if (box) box.innerHTML = '';
        }
    });

    // Remember open/closed per panel. The click on <summary> (mouse, Enter or
    // Space) is the user's intent; programmatic opening for print is not saved.
    document.addEventListener('click', (event) => {
        const summary = event.target.closest('#store-payments details.sp-disclosure > summary');
        if (!summary) return;
        const panel = summary.parentElement;
        if (panel.dataset.spPanel) savePanelState(panel.dataset.spPanel, !panel.open);
    });

    document.addEventListener('change', (event) => {
        const select = event.target.closest('#store-payments select[data-sp-issue-filter]');
        if (select) applyIssueFilter(select);
    });

    // Printing shows every panel expanded, then restores what was open before.
    window.addEventListener('beforeprint', () => {
        // Browser print (Ctrl+P) on this tab gets the same print layout as the Print button.
        const tab = document.getElementById('store-payments');
        if (tab && tab.classList.contains('active') && !document.body.classList.contains('sp-printing')) {
            document.body.classList.add('sp-printing');
            document.body.dataset.spPrintAuto = '1';
        }
        document.querySelectorAll('#store-payments details.sp-disclosure').forEach((panel) => {
            if (!panel.open) {
                panel.dataset.spPrintOpened = '1';
                panel.open = true;
            }
        });
    });
    window.addEventListener('afterprint', () => {
        document.querySelectorAll('#store-payments details.sp-disclosure[data-sp-print-opened]').forEach((panel) => {
            delete panel.dataset.spPrintOpened;
            panel.open = false;
        });
        if (document.body.dataset.spPrintAuto) {
            delete document.body.dataset.spPrintAuto;
            document.body.classList.remove('sp-printing');
        }
    });

    window.loadStorePaymentsReport = loadStorePaymentsReport;
    window.openStoreStatement = openStoreStatement;
    window.exportStorePaymentsCsv = exportStorePaymentsCsv;
    window.printStorePayments = printStorePayments;
    window.openStorePaymentsReport = openStorePaymentsReport;
})();
