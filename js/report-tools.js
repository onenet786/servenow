// View and Download PDF for every report page in the admin panel.
//
// Works from what is on screen, so the view and the file show the filters, totals and rows the
// user is looking at, and a new report needs only one line in PAGES.
// A report with its own Export PDF button keeps it (ownPdf), and gets View here.
// A page that loads only its latest rows names its loader and API (full): View and Download
// fetch every row first, then put the page back as it was.
(function () {
    const ALL_ROWS = 20000;
    const PAGES = {
        'reports-centre': { ownPdf: true },
        'financial-dashboard': {},
        'general-ledger': {},
        accounts: {},
        'financial-reports': {},
        'order-reports': {},
        'rider-reports': { ownPdf: true },
        'store-reports': {},
        'store-payment-term-reports': {},
        'inventory-report': { ownPdf: true },
        'store-payments': {},
        'store-settlements': { full: { loader: 'loadStoreSettlements', api: '/api/financial/store-settlements' } },
        'rider-cash': { full: { loader: 'loadRiderCash', api: '/api/financial/rider-cash' } },
        'payment-vouchers': { full: { loader: 'loadPaymentVouchers', api: '/api/financial/payment-vouchers' } },
        'bank-payment-vouchers': { full: { loader: 'loadBankPaymentVouchers', api: '/api/financial/payment-vouchers' } },
        'receipt-vouchers': { full: { loader: 'loadReceiptVouchers', api: '/api/financial/receipt-vouchers' } },
        'bank-receipt-vouchers': { full: { loader: 'loadBankReceiptVouchers', api: '/api/financial/receipt-vouchers' } },
        'journal-vouchers': { full: { loader: 'loadJournalVouchers', api: '/api/financial/journal-vouchers' } },
        expenses: { full: { loader: 'loadExpenses', api: '/api/financial/expenses' } },
        payments: { full: { loader: 'loadPayments', api: '/api/admin/payments' } },
        wallets: { full: { loader: 'loadWallets', api: '/api/admin/wallets' } },
        problems: {},
        orders: {},
        'hr-attendance': {},
        'hr-payroll': {},
    };

    const style = document.createElement('style');
    style.textContent = `
.rt-bar { display:flex; justify-content:flex-end; gap:8px; margin:0 0 12px; flex-wrap:wrap; }
.rt-bar button { display:inline-flex; align-items:center; gap:6px; padding:7px 13px; border-radius:8px; border:1px solid #cbd5e1;
  background:#fff; color:#0f172a; font-size:13px; font-weight:600; cursor:pointer; }
.rt-bar button:hover { background:#f1f5f9; }
.rt-bar button.rt-primary { background:#168048; border-color:#168048; color:#fff; }
.rt-bar button.rt-primary:hover { background:#116539; }
.rt-overlay { position:fixed; inset:0; z-index:100000; background:rgba(15,23,42,.55); display:flex; padding:24px; }
.rt-sheet { background:#fff; color:#0f172a; border-radius:12px; width:100%; max-width:1280px; margin:0 auto; display:flex; flex-direction:column; min-height:0; }
.rt-sheet-head { display:flex; align-items:center; gap:8px; padding:12px 16px; border-bottom:1px solid #e2e8f0; }
.rt-sheet-head strong { flex:1; font-size:16px; min-width:0; }
.rt-sheet-body { overflow:auto; padding:16px; flex:1; min-height:0; }
.rt-meta { color:#475569; font-size:13px; margin:0 0 4px; overflow-wrap:anywhere; }
.rt-section { margin:16px 0 6px; font-size:14px; font-weight:700; }
.rt-table { border-collapse:collapse; width:100%; font-size:12.5px; margin-bottom:6px; }
.rt-table th, .rt-table td { border:1px solid #e2e8f0; padding:5px 8px; text-align:left; vertical-align:top; }
.rt-table thead th { background:#168048; color:#fff; font-weight:600; }
.rt-table tfoot td, .rt-table tfoot th { background:#f1f5f9; font-weight:700; }
.rt-table td.rt-num, .rt-table th.rt-num { text-align:right; font-variant-numeric:tabular-nums; }
@media print {
  body.rt-printing > *:not(.rt-overlay) { display:none !important; }
  body.rt-printing .rt-overlay { position:static; background:none; padding:0; display:block; }
  body.rt-printing .rt-sheet { max-width:none; border-radius:0; display:block; }
  body.rt-printing .rt-sheet-head { display:none; }
  body.rt-printing .rt-sheet-body { overflow:visible; padding:0; }
}`;
    document.head.appendChild(style);

    const clean = (text) => String(text || '').replace(/\s+/g, ' ').trim();
    const esc = (value) => String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const visible = (el) => !!(el && el.getClientRects().length);
    const say = (title, text) => {
        if (typeof window.showWarning === 'function') window.showWarning(title, text);
        else window.alert(text);
    };

    function cellText(cell) {
        const copy = cell.cloneNode(true);
        // cloneNode does not keep typed values or the chosen option, so read those from the real cell.
        const live = cell.querySelectorAll('input, select, textarea');
        const copied = copy.querySelectorAll('input, select, textarea');
        live.forEach((field, i) => {
            const stand = document.createElement('span');
            if (field.matches('.sn-combo-input') || field.type === 'hidden' || field.type === 'checkbox' || field.type === 'radio') stand.textContent = '';
            else if (field.tagName === 'SELECT') stand.textContent = field.options[field.selectedIndex]?.text || '';
            else stand.textContent = field.value;
            copied[i].replaceWith(stand);
        });
        copy.querySelectorAll('button, .action-buttons, script, style, .sn-combo-panel').forEach((n) => n.remove());
        return clean(copy.textContent);
    }

    const isActionHead = (cell) => /^(actions?|manage|options?|operations?)$/i.test(clean(cell.textContent));
    const isTickHead = (cell) => !clean(cell.textContent) && !!cell.querySelector('input[type="checkbox"]');
    const numeric = (text) => /^-?\s*(rs\.?|pkr)?\s*-?[\d,]+(\.\d+)?\s*%?$/i.test(text);

    function rowOf(row, dropped) {
        const out = [];
        let column = 0;
        Array.from(row.cells).forEach((cell) => {
            const span = cell.colSpan || 1;
            const skip = span === 1 && dropped.has(column);
            column += span;
            if (skip) return;
            let width = span;
            for (let c = column - span; c < column; c += 1) if (span > 1 && dropped.has(c)) width -= 1;
            if (width > 0) out.push({ text: cellText(cell), span: width });
        });
        return out;
    }

    function tableModel(table) {
        const headRows = table.tHead ? Array.from(table.tHead.rows).filter(visible) : [];
        const dropped = new Set();
        if (headRows.length) {
            let column = 0;
            Array.from(headRows[headRows.length - 1].cells).forEach((cell) => {
                if ((cell.colSpan || 1) === 1 && (isActionHead(cell) || isTickHead(cell))) dropped.add(column);
                column += cell.colSpan || 1;
            });
        }
        const bodyRows = Array.from(table.tBodies).flatMap((b) => Array.from(b.rows)).filter(visible);
        const body = bodyRows.map((r) => rowOf(r, dropped)).filter((r) => r.some((c) => c.text));
        // "Loading...", "No records found" and the like are one cell across the table.
        const real = body.filter((r) => !(r.length === 1 && r[0].span > 1));
        const foot = table.tFoot ? Array.from(table.tFoot.rows).filter(visible).map((r) => rowOf(r, dropped)) : [];
        if (!real.length) return null;
        return { head: headRows.map((r) => rowOf(r, dropped)), body, foot };
    }

    // The heading nearest above a table, if it sits in the same card.
    function sectionOf(table, page) {
        let node = table;
        while (node && node !== page) {
            let prev = node.previousElementSibling;
            while (prev) {
                if (visible(prev)) {
                    const heading = prev.matches('h1,h2,h3,h4,h5') ? prev : prev.querySelector('h3,h4,h5');
                    if (heading) return clean(heading.textContent);
                }
                prev = prev.previousElementSibling;
            }
            node = node.parentElement;
        }
        return '';
    }

    function filtersOf(page) {
        const parts = [];
        page.querySelectorAll('select, input[type="date"], input[type="month"], input[type="search"], input[type="text"]').forEach((field) => {
            if (!visible(field) && field.tagName !== 'SELECT') return;
            if (field.closest('table, .modal, .rt-bar') || field.matches('.sn-combo-input, .sn-list-search')) return;
            if (field.tagName === 'SELECT' && !field.classList.contains('sn-combo-native') && !visible(field)) return;
            if (field.tagName === 'SELECT' && !visible(field.nextElementSibling)) return;
            const value = field.tagName === 'SELECT' ? clean(field.options[field.selectedIndex]?.text) : clean(field.value);
            if (!value) return;
            const label = (field.id && document.querySelector(`label[for="${CSS.escape(field.id)}"]`))
                || field.closest('.form-group, .filter-group')?.querySelector('label');
            parts.push(label ? `${clean(label.textContent).replace(/:$/, '')}: ${value}` : value);
        });
        return parts.join(' | ');
    }

    function tilesOf(page) {
        const seen = new Set();
        const tiles = [];
        page.querySelectorAll('.stat-card, .summary-card, .dx-tile, .kpi-card, .metric-card').forEach((tile) => {
            if (!visible(tile) || tile.closest('table')) return;
            const text = clean(tile.innerText);
            if (text && !seen.has(text)) {
                seen.add(text);
                tiles.push(text);
            }
        });
        return tiles;
    }

    function collect(page) {
        const heading = page.querySelector('h1, h2, h3');
        const title = clean(page.dataset.rtTitle || (heading && heading.textContent)) || 'Report';
        const tables = Array.from(page.querySelectorAll('table'))
            .filter((t) => visible(t) && !t.closest('.modal') && !t.parentElement.closest('table'))
            .map((t) => ({ section: sectionOf(t, page), model: tableModel(t) }))
            .filter((t) => t.model);
        return { title, filters: filtersOf(page), tiles: tilesOf(page), tables, printed: new Date().toLocaleString('en-GB') };
    }

    function cellsHtml(row, tag) {
        return row.map((c) => `<${tag}${c.span > 1 ? ` colspan="${c.span}"` : ''}${numeric(c.text) ? ' class="rt-num"' : ''}>${esc(c.text)}</${tag}>`).join('');
    }

    function reportHtml(data) {
        const parts = [];
        if (data.filters) parts.push(`<p class="rt-meta">${esc(data.filters)}</p>`);
        parts.push(`<p class="rt-meta">Printed ${esc(data.printed)}</p>`);
        if (data.tiles.length) {
            parts.push(`<table class="rt-table"><tbody>${data.tiles.map((t) => `<tr><td>${esc(t)}</td></tr>`).join('')}</tbody></table>`);
        }
        data.tables.forEach(({ section, model }) => {
            if (section && section !== data.title) parts.push(`<p class="rt-section">${esc(section)}</p>`);
            parts.push(`<table class="rt-table">
                <thead>${model.head.map((r) => `<tr>${cellsHtml(r, 'th')}</tr>`).join('')}</thead>
                <tbody>${model.body.map((r) => `<tr>${cellsHtml(r, 'td')}</tr>`).join('')}</tbody>
                ${model.foot.length ? `<tfoot>${model.foot.map((r) => `<tr>${cellsHtml(r, 'td')}</tr>`).join('')}</tfoot>` : ''}
            </table>`);
        });
        return parts.join('');
    }

    // The PDF font has Latin letters only.
    const pdfText = (text) => String(text || '').replace(/₨/g, 'Rs').replace(/[–—]/g, '-').replace(/[^\x20-\xFF]/g, '');
    const pdfRow = (row) => row.map((c) => {
        const content = pdfText(c.text);
        return { content, colSpan: c.span, styles: numeric(c.text) ? { halign: 'right' } : {} };
    });

    function downloadPdf(data) {
        if (!window.jspdf || !window.jspdf.jsPDF) {
            say('PDF', 'The PDF tool did not load. Check the internet connection and refresh the page.');
            return;
        }
        const widest = Math.max(1, ...data.tables.map(({ model }) => Math.max(0, ...model.body.map((r) => r.reduce((n, c) => n + c.span, 0)))));
        const doc = new window.jspdf.jsPDF({ orientation: widest > 6 ? 'landscape' : 'portrait' });
        const fontSize = widest > 14 ? 6 : widest > 9 ? 7 : 8;
        const left = 10;
        const usable = doc.internal.pageSize.getWidth() - left * 2;
        doc.setFontSize(14);
        doc.text(pdfText(`ServeNow: ${data.title}`), left, 13);
        doc.setFontSize(8);
        const metaLines = doc.splitTextToSize(pdfText([data.filters, `Printed ${data.printed}`].filter(Boolean).join('   ')), usable);
        doc.text(metaLines, left, 18);
        let y = 18 + metaLines.length * 3.6 + 1;
        if (data.tiles.length) {
            const tiles = doc.splitTextToSize(pdfText(data.tiles.join('   |   ')), usable);
            doc.text(tiles, left, y + 1);
            y += tiles.length * 3.6 + 2;
        }
        data.tables.forEach(({ section, model }) => {
            if (section && section !== data.title) {
                if (y > doc.internal.pageSize.getHeight() - 30) {
                    doc.addPage();
                    y = 14;
                }
                doc.setFontSize(10);
                doc.text(pdfText(section), left, y + 3);
                y += 5;
            }
            doc.autoTable({
                startY: y,
                head: model.head.map(pdfRow),
                body: model.body.map(pdfRow),
                foot: model.foot.length ? model.foot.map(pdfRow) : undefined,
                showFoot: 'lastPage',
                margin: { left, right: left, bottom: 12 },
                styles: { fontSize, cellPadding: 1.3, overflow: 'linebreak' },
                headStyles: { fillColor: [22, 128, 72] },
                footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
            });
            y = doc.lastAutoTable.finalY + 6;
        });
        const pages = doc.getNumberOfPages();
        for (let page = 1; page <= pages; page += 1) {
            doc.setPage(page);
            doc.setFontSize(7);
            doc.text(`Page ${page} of ${pages}`, doc.internal.pageSize.getWidth() - left, doc.internal.pageSize.getHeight() - 5, { align: 'right' });
        }
        const name = data.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'report';
        const now = new Date();
        const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        doc.save(`${name}-${day}.pdf`);
    }

    function closeView() {
        document.querySelector('.rt-overlay')?.remove();
        document.body.classList.remove('rt-printing');
        document.removeEventListener('keydown', onKey);
    }
    function onKey(event) {
        if (event.key === 'Escape') closeView();
    }

    function view(data) {
        closeView();
        const overlay = document.createElement('div');
        overlay.className = 'rt-overlay';
        overlay.innerHTML = `<div class="rt-sheet" role="dialog" aria-modal="true" aria-label="${esc(data.title)}">
            <div class="rt-sheet-head rt-bar" style="margin:0">
                <strong>${esc(data.title)}</strong>
                <button type="button" class="rt-primary" data-do="pdf"><i class="fas fa-file-pdf"></i> Download PDF</button>
                <button type="button" data-do="print"><i class="fas fa-print"></i> Print</button>
                <button type="button" data-do="close"><i class="fas fa-times"></i> Close</button>
            </div>
            <div class="rt-sheet-body">${reportHtml(data)}</div>
        </div>`;
        overlay.addEventListener('click', (event) => {
            const action = event.target.closest('[data-do]')?.dataset.do;
            if (action === 'pdf') downloadPdf(data);
            else if (action === 'print') {
                document.body.classList.add('rt-printing');
                window.print();
                document.body.classList.remove('rt-printing');
            } else if (action === 'close' || event.target === overlay) closeView();
        });
        document.body.appendChild(overlay);
        document.addEventListener('keydown', onKey);
    }

    async function collectAll(page, options) {
        const reload = options.full && window[options.full.loader];
        if (typeof reload !== 'function') return collect(page);
        const original = window.fetch;
        window.fetch = (input, init) => {
            const read = !init || !init.method || init.method === 'GET';
            if (typeof input === 'string' && read && input.includes(options.full.api)) {
                const url = new URL(input, window.location.href);
                url.searchParams.set('limit', String(ALL_ROWS));
                url.searchParams.set('page', '1');
                return original.call(window, url.toString(), init);
            }
            return original.call(window, input, init);
        };
        try {
            await reload();
        } finally {
            window.fetch = original;
        }
        const data = collect(page);
        await reload();
        return data;
    }

    async function run(page, options, action, button) {
        if (button.disabled) return;
        const label = button.innerHTML;
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Preparing...';
        try {
            const data = await collectAll(page, options);
            if (!data.tables.length) {
                say('Nothing to show', 'There are no rows on this page yet. Choose your filters and load the report first.');
                return;
            }
            action(data);
        } catch (error) {
            console.error('Report tools failed:', error);
            say('Report', 'The report could not be prepared. Please try again.');
        } finally {
            button.disabled = false;
            button.innerHTML = label;
        }
    }

    function addBar(page, options) {
        if (page.querySelector(':scope > .rt-bar, :scope .rt-page-bar')) return;
        const bar = document.createElement('div');
        bar.className = 'rt-bar rt-page-bar';
        bar.innerHTML = `<button type="button" data-do="view"><i class="fas fa-eye"></i> View</button>${options.ownPdf ? '' :
            '<button type="button" class="rt-primary" data-do="pdf"><i class="fas fa-file-pdf"></i> Download PDF</button>'}`;
        bar.addEventListener('click', (event) => {
            const button = event.target.closest('[data-do]');
            if (button) run(page, options, button.dataset.do === 'pdf' ? downloadPdf : view, button);
        });
        const heading = page.querySelector(':scope > h2, :scope > .page-header, :scope > .section-header, :scope > .tab-header');
        if (heading) heading.after(bar);
        else page.prepend(bar);
    }

    function refresh() {
        Object.entries(PAGES).forEach(([id, options]) => {
            const page = document.getElementById(id);
            if (page && page.classList.contains('active')) addBar(page, options);
        });
    }

    function start() {
        refresh();
        // Pages draw themselves when opened, and some redraw from scratch.
        let waiting = false;
        new MutationObserver(() => {
            if (waiting) return;
            waiting = true;
            setTimeout(() => {
                waiting = false;
                refresh();
            }, 200);
        }).observe(document.getElementById('content') || document.querySelector('.app-content') || document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class'],
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

    window.ServeNowReports = { collect };
})();
