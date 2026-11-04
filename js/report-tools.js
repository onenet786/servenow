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
.rt-group { display:inline-flex; align-items:stretch; flex:none; align-self:stretch; border-radius:10px; overflow:hidden; background:#fff; border:1px solid #d1d5db;
  box-shadow:0 1px 2px rgba(15,23,42,.06); }
.rt-group button { display:inline-flex; align-items:center; gap:7px; min-height:38px; padding:0 14px; border:0; background:transparent; color:#1f2937;
  font:inherit; font-size:13px; font-weight:600; white-space:nowrap; cursor:pointer; transition:background .15s ease, color .15s ease; }
.rt-group button + button { border-left:1px solid #d1d5db; }
.rt-group button:hover { background:#f3f4f6; }
.rt-group button:focus-visible { outline:2px solid #15803d; outline-offset:-2px; }
.rt-group button:disabled { opacity:.65; cursor:wait; }
.rt-group button i { font-size:13px; color:#6b7280; }
.rt-group button.rt-primary { background:#15803d; color:#fff; }
.rt-group button.rt-primary:hover { background:#166534; }
.rt-group button.rt-primary i { color:#dcfce7; }
.rt-row { display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap; margin-bottom:14px; }
.rt-row > :first-child { flex:1 1 auto; min-width:0; margin-top:0; margin-bottom:0; }
.rt-host-row { display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap; }
.rt-host-row .rt-group { margin-left:auto; }
.rt-overlay { position:fixed; inset:0; z-index:100000; display:flex; padding:22px; background:rgba(15,23,42,.6); backdrop-filter:blur(3px); animation:rt-in .15s ease; }
@keyframes rt-in { from { opacity:0; } to { opacity:1; } }
.rt-sheet { display:flex; flex-direction:column; min-height:0; width:100%; max-width:1240px; margin:0 auto; overflow:hidden; border-radius:16px; background:#fff; color:#111827;
  box-shadow:0 24px 60px rgba(15,23,42,.35); }
.rt-sheet-head { display:flex; align-items:center; gap:14px; flex-wrap:wrap; padding:14px 18px; color:#fff; background:linear-gradient(120deg,#14532d,#15803d); }
.rt-logo { width:40px; height:40px; flex:none; object-fit:cover; object-position:left center; border-radius:10px; background:#fff; }
.rt-sheet-title { flex:1; min-width:180px; }
.rt-sheet-title span { display:block; font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:#bbf7d0; }
.rt-sheet-title strong { display:block; font-size:18px; line-height:1.25; }
.rt-sheet-head .rt-group { border-color:transparent; box-shadow:none; }
.rt-sheet-body { flex:1; min-height:0; overflow:auto; padding:18px 20px 22px; }
.rt-meta { display:flex; flex-wrap:wrap; gap:6px; margin:0 0 14px; }
.rt-meta span { padding:4px 10px; border-radius:99px; background:#f3f4f6; color:#374151; font-size:12px; font-weight:500; overflow-wrap:anywhere; }
.rt-tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin:0 0 16px; }
.rt-tile { padding:11px 13px; border-radius:12px; border:1px solid #e5e7eb; background:#f9fafb; min-width:0; }
.rt-tile span { display:block; font-size:11.5px; font-weight:600; color:#6b7280; }
.rt-tile b { display:block; margin-top:2px; font-size:17px; color:#111827; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
.rt-section { margin:18px 0 8px; font-size:14px; font-weight:700; color:#14532d; }
.rt-scroll { overflow-x:auto; border:1px solid #e5e7eb; border-radius:12px; }
.rt-table { border-collapse:separate; border-spacing:0; width:100%; font-size:12.5px; }
.rt-table th, .rt-table td { padding:8px 11px; text-align:left; vertical-align:top; border-bottom:1px solid #eef0f3; }
.rt-table thead th { position:sticky; top:0; background:#14532d; color:#fff; font-size:11px; font-weight:700; letter-spacing:.03em; text-transform:uppercase; white-space:nowrap; }
.rt-table tbody tr:nth-child(even) td { background:#f9fafb; }
.rt-table tbody tr:hover td { background:#f0fdf4; }
.rt-table tfoot td, .rt-table tfoot th { background:#ecfdf5; color:#14532d; font-weight:700; border-top:2px solid #15803d; border-bottom:0; }
.rt-table td.rt-num, .rt-table th.rt-num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
.rt-count { margin:7px 2px 0; color:#6b7280; font-size:12px; }
@media (max-width:640px) {
  .rt-overlay { padding:0; }
  .rt-sheet { border-radius:0; }
  .rt-group { width:100%; }
  .rt-group button { flex:1; justify-content:center; }
}
@media print {
  body.rt-printing > *:not(.rt-overlay) { display:none !important; }
  body.rt-printing .rt-overlay { position:static; padding:0; background:none; backdrop-filter:none; display:block; }
  body.rt-printing .rt-sheet { display:block; max-width:none; border-radius:0; box-shadow:none; }
  body.rt-printing .rt-sheet-head { color:#111827; background:none; border-bottom:2px solid #15803d; }
  body.rt-printing .rt-sheet-head .rt-group { display:none; }
  body.rt-printing .rt-sheet-title span { color:#15803d; }
  body.rt-printing .rt-sheet-body { overflow:visible; padding:10px 0 0; }
  body.rt-printing .rt-scroll { overflow:visible; }
  body.rt-printing .rt-table thead th { position:static; }
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
        copy.querySelectorAll('button, .action-buttons, script, style, .sn-combo-panel, [data-rt-skip]').forEach((n) => n.remove());
        // Lines that sit under each other on screen must not run together in the text.
        copy.querySelectorAll('br, div, p, li, b, small, .hr-pill, .hr-sub, .hr-trip').forEach((n) => n.after(' '));
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
                    if (heading) {
                        const copy = heading.cloneNode(true);
                        copy.querySelectorAll('small').forEach((n) => n.remove());
                        return clean(copy.textContent);
                    }
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
            if (field.closest('table, .modal, .rt-group') || field.matches('.sn-combo-input, .sn-list-search, #hrEmployeeSearch')) return;
            if (field.tagName === 'SELECT' && !field.classList.contains('sn-combo-native') && !visible(field)) return;
            if (field.tagName === 'SELECT' && !visible(field.nextElementSibling)) return;
            const value = field.tagName === 'SELECT' ? clean(field.options[field.selectedIndex]?.text) : clean(field.value);
            if (!value) return;
            const label = (field.id && document.querySelector(`label[for="${CSS.escape(field.id)}"]`))
                || field.closest('.form-group, .filter-group')?.querySelector('label');
            const name = label ? clean(label.textContent).replace(/:$/, '') : clean(field.getAttribute('aria-label'));
            parts.push(name ? `${name}: ${value}` : value);
        });
        return parts.join(' | ');
    }

    function tileOf(tile) {
        const lines = String(tile.innerText || '').split('\n').map(clean).filter(Boolean);
        const named = (selector) => clean(tile.querySelector(selector)?.textContent);
        const label = named('[class*="label"], [class*="title"]');
        const value = named('[class*="value"], [class*="amount"], [class*="number"]');
        if (label && value) return { label, value };
        const at = lines.findIndex((line) => /\d/.test(line));
        if (lines.length < 2 || at < 0) return { label: lines.join(' '), value: '' };
        return { label: lines.filter((_, i) => i !== at).join(' '), value: lines[at] };
    }

    function tilesOf(page) {
        const seen = new Set();
        const tiles = [];
        page.querySelectorAll('.stat-card, .summary-card, .dx-tile, .kpi-card, .metric-card, .hr-kpi').forEach((el) => {
            if (!visible(el) || el.closest('table')) return;
            const tile = tileOf(el);
            const key = `${tile.label}|${tile.value}`;
            if (tile.label && !seen.has(key)) {
                seen.add(key);
                tiles.push(tile);
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
        const chips = [...(data.filters ? data.filters.split(' | ') : []), `Printed ${data.printed}`];
        parts.push(`<div class="rt-meta">${chips.map((c) => `<span>${esc(c)}</span>`).join('')}</div>`);
        if (data.tiles.length) {
            parts.push(`<div class="rt-tiles">${data.tiles.map((t) => `<div class="rt-tile"><span>${esc(t.label)}</span><b>${esc(t.value)}</b></div>`).join('')}</div>`);
        }
        data.tables.forEach(({ section, model }) => {
            if (section && section !== data.title) parts.push(`<p class="rt-section">${esc(section)}</p>`);
            parts.push(`<div class="rt-scroll"><table class="rt-table">
                <thead>${model.head.map((r) => `<tr>${cellsHtml(r, 'th')}</tr>`).join('')}</thead>
                <tbody>${model.body.map((r) => `<tr>${cellsHtml(r, 'td')}</tr>`).join('')}</tbody>
                ${model.foot.length ? `<tfoot>${model.foot.map((r) => `<tr>${cellsHtml(r, 'td')}</tr>`).join('')}</tfoot>` : ''}
            </table></div>
            <p class="rt-count">${model.body.length} ${model.body.length === 1 ? 'row' : 'rows'}</p>`);
        });
        return parts.join('');
    }

    // The PDF font has Latin letters only.
    const pdfText = (text) => String(text || '').replace(/₨/g, 'Rs').replace(/[–—]/g, '-').replace(/[^\x20-\xFF]/g, '');
    const pdfRow = (row) => row.map((c) => {
        const content = pdfText(c.text);
        return { content, colSpan: c.span, styles: numeric(c.text) ? { halign: 'right' } : {} };
    });

    const LOGO = 'images/servenow_brand_logo.png?v=2';
    let logoData = null;

    // The logo file is large, so the PDF gets a small copy.
    function loadLogo() {
        if (logoData !== null) return Promise.resolve(logoData);
        return new Promise((resolve) => {
            const image = new Image();
            image.onload = () => {
                const size = 96;
                const side = Math.min(image.width, image.height);
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const pen = canvas.getContext('2d');
                pen.fillStyle = '#fff';
                pen.fillRect(0, 0, size, size);
                // The emblem is at the left of the logo file.
                pen.drawImage(image, 0, 0, side, side, 0, 0, size, size);
                logoData = canvas.toDataURL('image/jpeg', 0.9);
                resolve(logoData);
            };
            image.onerror = () => {
                logoData = '';
                resolve('');
            };
            image.src = LOGO;
        });
    }

    const GREEN = [21, 128, 61];
    const DEEP = [20, 83, 45];

    async function downloadPdf(data) {
        if (!window.jspdf || !window.jspdf.jsPDF) {
            say('PDF', 'The PDF tool did not load. Check the internet connection and refresh the page.');
            return;
        }
        const widest = Math.max(1, ...data.tables.map(({ model }) => Math.max(0, ...model.body.map((r) => r.reduce((n, c) => n + c.span, 0)))));
        const doc = new window.jspdf.jsPDF({ orientation: widest > 6 ? 'landscape' : 'portrait' });
        const fontSize = widest > 14 ? 6 : widest > 9 ? 7 : 8;
        const left = 10;
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const usable = pageWidth - left * 2;

        doc.setFillColor(...DEEP);
        doc.rect(0, 0, pageWidth, 24, 'F');
        doc.setFillColor(...GREEN);
        doc.rect(0, 24, pageWidth, 1.2, 'F');
        const logo = await loadLogo();
        if (logo) doc.addImage(logo, 'JPEG', left, 5, 14, 14);
        const textLeft = logo ? left + 18 : left;
        doc.setTextColor(187, 247, 208);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.text('SERVENOW', textLeft, 10);
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(15);
        doc.text(pdfText(data.title), textLeft, 17);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(220, 252, 231);
        doc.text(`Printed ${pdfText(data.printed)}`, pageWidth - left, 17, { align: 'right' });

        doc.setTextColor(75, 85, 99);
        let y = 30;
        if (data.filters) {
            const lines = doc.splitTextToSize(pdfText(data.filters), usable);
            doc.text(lines, left, y);
            y += lines.length * 3.6 + 2;
        }
        for (let at = 0; at < data.tiles.length; at += 5) {
            const row = data.tiles.slice(at, at + 5);
            doc.autoTable({
                startY: y,
                theme: 'plain',
                body: [row.map((t) => pdfText(t.label)), row.map((t) => pdfText(t.value))],
                margin: { left, right: left },
                styles: { fontSize: 7, cellPadding: { top: 1, right: 2, bottom: 0.6, left: 2 }, fillColor: [240, 253, 244], textColor: [75, 85, 99], overflow: 'linebreak' },
                didParseCell: (cell) => {
                    if (cell.row.index === 1) {
                        cell.cell.styles.fontSize = 10;
                        cell.cell.styles.fontStyle = 'bold';
                        cell.cell.styles.textColor = DEEP;
                    }
                },
            });
            y = doc.lastAutoTable.finalY + 2;
        }
        y += 2;
        data.tables.forEach(({ section, model }) => {
            if (section && section !== data.title) {
                if (y > pageHeight - 30) {
                    doc.addPage();
                    y = 14;
                }
                doc.setFontSize(10);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(...DEEP);
                doc.text(pdfText(section), left, y + 3);
                doc.setFont('helvetica', 'normal');
                y += 5;
            }
            doc.autoTable({
                startY: y,
                head: model.head.map(pdfRow),
                body: model.body.map(pdfRow),
                foot: model.foot.length ? model.foot.map(pdfRow) : undefined,
                showFoot: 'lastPage',
                margin: { left, right: left, bottom: 13 },
                styles: { fontSize, cellPadding: 1.5, overflow: 'linebreak', lineColor: [229, 231, 235], lineWidth: 0.1, textColor: [31, 41, 55] },
                headStyles: { fillColor: DEEP, textColor: [255, 255, 255], fontStyle: 'bold' },
                alternateRowStyles: { fillColor: [249, 250, 251] },
                footStyles: { fillColor: [236, 253, 245], textColor: DEEP, fontStyle: 'bold' },
            });
            y = doc.lastAutoTable.finalY + 6;
        });

        const pages = doc.getNumberOfPages();
        for (let page = 1; page <= pages; page += 1) {
            doc.setPage(page);
            doc.setDrawColor(229, 231, 235);
            doc.line(left, pageHeight - 9, pageWidth - left, pageHeight - 9);
            doc.setFontSize(7);
            doc.setTextColor(107, 114, 128);
            doc.text('ServeNow  |  servenow.pk', left, pageHeight - 5);
            doc.text(`Page ${page} of ${pages}`, pageWidth - left, pageHeight - 5, { align: 'right' });
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
            <div class="rt-sheet-head">
                <img class="rt-logo" src="${LOGO}" alt="" />
                <div class="rt-sheet-title"><span>ServeNow</span><strong>${esc(data.title)}</strong></div>
                <div class="rt-group">
                    <button type="button" class="rt-primary" data-do="pdf"><i class="fas fa-download"></i> Download PDF</button>
                    <button type="button" data-do="print"><i class="fas fa-print"></i> Print</button>
                    <button type="button" data-do="close" aria-label="Close"><i class="fas fa-times"></i> Close</button>
                </div>
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
            await action(data);
        } catch (error) {
            console.error('Report tools failed:', error);
            say('Report', 'The report could not be prepared. Please try again.');
        } finally {
            button.disabled = false;
            button.innerHTML = label;
        }
    }

    // The buttons sit in the page's own header, beside its title and any other actions.
    function placeBar(page, bar) {
        const actions = page.querySelector('.hr-actions, .sp-actions, .page-actions, .header-actions');
        if (actions && !actions.closest('.modal')) {
            actions.append(bar);
            return;
        }
        const hero = page.querySelector(':scope > .orders-hero, :scope > .page-header, :scope > .section-header, :scope > .tab-header');
        if (hero) {
            hero.classList.add('rt-host-row');
            hero.append(bar);
            return;
        }
        const heading = page.querySelector(':scope > h2, :scope > h1');
        if (!heading) {
            page.prepend(bar);
            return;
        }
        const row = document.createElement('div');
        row.className = 'rt-row';
        heading.before(row);
        row.append(heading, bar);
    }

    function addBar(page, options) {
        if (page.querySelector('.rt-page-bar')) return;
        const bar = document.createElement('div');
        bar.className = 'rt-group rt-page-bar';
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', 'Report');
        bar.innerHTML = `<button type="button" data-do="view"><i class="fas fa-eye"></i> View</button>${options.ownPdf ? '' :
            '<button type="button" class="rt-primary" data-do="pdf"><i class="fas fa-download"></i> Download PDF</button>'}`;
        bar.addEventListener('click', (event) => {
            const button = event.target.closest('[data-do]');
            if (button) run(page, options, button.dataset.do === 'pdf' ? downloadPdf : view, button);
        });
        placeBar(page, bar);
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
