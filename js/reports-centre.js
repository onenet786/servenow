// Reports Centre (admin > Reports Centre).
// API: GET /api/financial/reports-centre and GET /api/financial/reports-centre/:key
// Every value from the API is escaped before it is put into the page.

(function () {
    'use strict';

    const state = { catalogue: [], report: null, listsLoaded: false };
    const el = (id) => document.getElementById(id);

    const esc = (value) => String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const fmt = (value) => Number(value || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const dateText = (ymd) => {
        if (!ymd) return '-';
        const [y, m, d] = String(ymd).slice(0, 10).split('-');
        return y && m && d ? `${d}-${m}-${y}` : String(ymd);
    };
    const cellText = (column, row) => {
        const value = row[column.key];
        if (column.type === 'money') return fmt(value);
        if (column.type === 'date') return dateText(value);
        return value === null || value === undefined ? '' : String(value);
    };

    async function api(path) {
        const response = await fetch(`${API_BASE}/api/financial/${path}`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('serveNowToken')}` }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) throw new Error(data.message || 'Could not load this report');
        return data;
    }

    function selected() {
        return state.catalogue.find((r) => r.key === el('rcReport').value) || null;
    }

    function syncFilters() {
        const report = selected();
        if (!report) return;
        el('rcRiderGroup').style.display = report.filters.includes('rider') ? '' : 'none';
        el('rcStoreGroup').style.display = report.filters.includes('store') ? '' : 'none';
        el('rcDates').style.display = report.noDates ? 'none' : 'contents';
    }

    async function loadLists() {
        if (state.listsLoaded) return;
        const fill = (select, rows, label) => {
            select.innerHTML = '<option value="">All</option>' + rows
                .map((r) => `<option value="${esc(r.id)}">${esc(label(r))}</option>`).join('');
        };
        const [riders, stores] = await Promise.all([api('entities?type=rider'), api('entities?type=store')]);
        const list = (data) => data.entities || data.data || [];
        fill(el('rcRider'), list(riders), (r) => r.name);
        fill(el('rcStore'), list(stores), (s) => s.name);
        state.listsLoaded = true;
    }

    async function init() {
        if (state.catalogue.length) return;
        try {
            const data = await api('reports-centre');
            state.catalogue = data.reports;
            const groups = [...new Set(data.reports.map((r) => r.group))];
            el('rcReport').innerHTML = groups.map((g) => `<optgroup label="${esc(g)}">${data.reports
                .filter((r) => r.group === g)
                .map((r) => `<option value="${esc(r.key)}">${esc(r.title)}</option>`).join('')}</optgroup>`).join('');
            syncFilters();
            await loadLists();
        } catch (error) {
            el('rcResult').innerHTML = `<p class="rc-note">${esc(error.message)}</p>`;
        }
    }

    function render() {
        const { report, data } = state.report;
        const head = data.columns.map((c) => `<th class="${c.type === 'money' || c.type === 'number' ? 'num' : ''}">${esc(c.label)}</th>`).join('');
        const body = data.rows.map((row) => `<tr>${data.columns.map((c) =>
            `<td class="${c.type === 'money' || c.type === 'number' ? 'num' : ''}">${esc(cellText(c, row))}</td>`).join('')}</tr>`).join('');
        const hasTotals = Object.keys(data.totals || {}).length > 0 && data.rows.length > 0;
        const foot = hasTotals ? `<tfoot><tr>${data.columns.map((c, i) => {
            if (data.totals[c.key] !== undefined) return `<td class="num">${esc(c.type === 'money' ? fmt(data.totals[c.key]) : data.totals[c.key])}</td>`;
            return `<td>${i === 0 ? 'Total' : ''}</td>`;
        }).join('')}</tr></tfoot>` : '';
        const notes = (data.notes || []).map((n) => `<p class="rc-note">${esc(n)}</p>`).join('');
        el('rcResult').innerHTML = `
            <h3 class="rc-title">${esc(report.title)}</h3>
            ${notes}
            ${data.rows.length ? `<div class="table-responsive"><table class="data-table rc-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table></div>
                <p class="rc-note">${data.rows.length} row(s)</p>` : '<p class="rc-note">Nothing to show for these filters.</p>'}`;
    }

    async function load() {
        const report = selected();
        if (!report) return;
        const params = new URLSearchParams();
        if (!report.noDates && el('rcFrom').value) params.set('from', el('rcFrom').value);
        if (!report.noDates && el('rcTo').value) params.set('to', el('rcTo').value);
        if (report.filters.includes('rider') && el('rcRider').value) params.set('rider_id', el('rcRider').value);
        if (report.filters.includes('store') && el('rcStore').value) params.set('store_id', el('rcStore').value);
        el('rcResult').innerHTML = '<p class="rc-note">Loading...</p>';
        try {
            const data = await api(`reports-centre/${encodeURIComponent(report.key)}?${params.toString()}`);
            state.report = { report, data };
            render();
        } catch (error) {
            state.report = null;
            el('rcResult').innerHTML = `<p class="rc-note">${esc(error.message)}</p>`;
        }
    }

    function exportExcel() {
        if (!state.report) return;
        const { report, data } = state.report;
        const csv = (value) => `"${String(value === null || value === undefined ? '' : value).replace(/"/g, '""')}"`;
        const lines = [data.columns.map((c) => csv(c.label)).join(',')];
        data.rows.forEach((row) => lines.push(data.columns.map((c) =>
            csv(c.type === 'money' ? Number(row[c.key] || 0).toFixed(2) : cellText(c, row))).join(',')));
        const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${report.key}-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    function exportPdf() {
        if (!state.report) return;
        const { report, data } = state.report;
        const doc = new window.jspdf.jsPDF({ orientation: data.columns.length > 6 ? 'landscape' : 'portrait' });
        doc.setFontSize(13);
        doc.text(`ServeNow: ${report.title}`, 14, 14);
        doc.setFontSize(8);
        const from = el('rcFrom').value;
        const to = el('rcTo').value;
        doc.text(`${from || to ? `Period ${dateText(from)} to ${dateText(to)}. ` : ''}Printed ${new Date().toLocaleString('en-GB')}`, 14, 19);
        const hasTotals = Object.keys(data.totals || {}).length > 0 && data.rows.length > 0;
        doc.autoTable({
            startY: 23,
            head: [data.columns.map((c) => c.label)],
            body: data.rows.map((row) => data.columns.map((c) => cellText(c, row))),
            foot: hasTotals ? [data.columns.map((c, i) => {
                if (data.totals[c.key] !== undefined) return c.type === 'money' ? fmt(data.totals[c.key]) : String(data.totals[c.key]);
                return i === 0 ? 'Total' : '';
            })] : undefined,
            showFoot: 'lastPage',
            styles: { fontSize: 7, cellPadding: 1.4 },
            headStyles: { fillColor: [22, 128, 72] },
            footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
            columnStyles: Object.fromEntries(data.columns.map((c, i) => [i, { halign: c.type === 'money' || c.type === 'number' ? 'right' : 'left' }]))
        });
        doc.save(`${report.key}-${new Date().toISOString().slice(0, 10)}.pdf`);
    }

    window.loadReportsCentre = init;
    window.runReportsCentre = load;
    window.syncReportsCentreFilters = syncFilters;
    window.exportReportsCentreExcel = exportExcel;
    window.exportReportsCentrePdf = exportPdf;
})();
