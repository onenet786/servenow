// Admin dashboard: the day's work, money waiting for a decision, and where the money is. One request
// (/api/admin/dashboard-overview) fills it, cut to the person's rights and branch by the server.
(function () {
  const REFRESH_MS = 60 * 1000;
  const STATUS = {
    pending: 'New', confirmed: 'Confirmed', preparing: 'Preparing', ready: 'Ready',
    picked_up: 'Picked up', out_for_delivery: 'On the way',
  };
  const COLORS = { income: '#2563eb', expense: '#d97706' };
  let chart = null;
  let timer = null;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rupees = (value) => `Rs ${Math.round(Number(value || 0)).toLocaleString('en-PK')}`;
  const count = (value) => Number(value || 0).toLocaleString('en-PK');
  const age = (minutes) => {
    const m = Number(minutes || 0);
    if (m < 60) return `${m}m`;
    if (m < 1440) return `${Math.floor(m / 60)}h ${m % 60}m`;
    return `${Math.floor(m / 1440)}d`;
  };
  const day = (value) => (value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '-');
  const monthLabel = (ym) => {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
  };

  const tile = ({ label, value, note, tone = '', go = '' }) => `
    <button type="button" class="dx-tile ${tone ? `dx-${tone}` : ''}" ${go ? `data-dx-go="${go}"` : 'disabled'}>
      <span class="dx-label">${esc(label)}</span>
      <span class="dx-value">${esc(value)}</span>
      <span class="dx-note">${esc(note || '')}</span>
    </button>`;

  const nameList = (rows, amountKey, empty, go) => (rows.length
    ? `<ul class="dx-rank">${rows.map((r) => `<li><button type="button" data-dx-go="${go}">${esc(r.name)}</button><span>${esc(rupees(r[amountKey]))}</span></li>`).join('')}</ul>`
    : `<p class="dx-empty">${esc(empty)}</p>`);

  const panel = (title, body, link) => `
    <section class="dx-panel">
      <div class="dx-panel-head"><h3>${esc(title)}</h3>${link ? `<button type="button" class="dx-link" data-dx-go="${link.go}">${esc(link.text)}</button>` : ''}</div>
      ${body}
    </section>`;

  function attention(rows) {
    if (!rows.length) return '<p class="dx-empty">No orders are open right now.</p>';
    return `<ul class="dx-attention">${rows.map((o) => `
      <li>
        <span class="dx-age ${o.minutes >= 45 ? 'dx-late' : ''}">${esc(age(o.minutes))}</span>
        <span class="dx-tag">${esc(STATUS[o.status] || o.status)}</span>
        <span class="dx-order">${esc(o.order_number)}<small>${esc(o.store_name || 'Several stores')}${o.has_rider ? '' : ' · no rider'}</small></span>
        <span class="dx-amount">${esc(count(o.total_amount))}</span>
      </li>`).join('')}</ul>`;
  }

  function drafts(rows) {
    if (!rows.length) return '<p class="dx-empty">No draft vouchers.</p>';
    return `<div class="dx-table"><table>
      <thead><tr><th>Voucher</th><th>Type</th><th>Date</th><th>For</th><th class="dx-num">Amount</th><th>Status</th></tr></thead>
      <tbody>${rows.map((v) => `<tr>
        <td class="dx-mono">${esc(v.voucher_number)}</td>
        <td>${v.payment_method === 'cash' ? 'CPV' : 'BPV'}</td>
        <td>${esc(day(v.voucher_date))}</td>
        <td>${esc(v.payee_name)}${v.purpose ? ` · ${esc(v.purpose)}` : ''}</td>
        <td class="dx-num">${esc(rupees(v.amount))}</td>
        <td><span class="dx-tag">${esc(v.status)}</span></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  }

  function chartTable(months) {
    return `<details class="dx-details"><summary>Show as a table</summary><div class="dx-table"><table>
      <thead><tr><th>Month</th><th class="dx-num">Income</th><th class="dx-num">Expenses</th></tr></thead>
      <tbody>${months.map((m) => `<tr><td>${esc(monthLabel(m.month))}</td><td class="dx-num">${esc(rupees(m.income))}</td><td class="dx-num">${esc(rupees(m.expense))}</td></tr>`).join('')}</tbody>
    </table></div></details>`;
  }

  function drawChart(months) {
    const canvas = document.getElementById('dxChart');
    if (!canvas || !window.Chart) return;
    if (chart) chart.destroy();
    const series = (key, label) => ({
      label, data: months.map((m) => m[key]), backgroundColor: COLORS[key], borderRadius: 4, borderSkipped: 'start',
      barPercentage: 0.86, categoryPercentage: 0.62,
    });
    chart = new window.Chart(canvas, {
      type: 'bar',
      data: { labels: months.map((m) => monthLabel(m.month)), datasets: [series('income', 'Income'), series('expense', 'Expenses')] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { align: 'end', labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 2, color: '#4b5563', font: { size: 12 } } },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${rupees(c.parsed.y)}` } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#6b7280', font: { size: 11 } } },
          y: { grid: { color: '#f0f1f3' }, border: { display: false }, ticks: { color: '#6b7280', font: { size: 11 }, maxTicksLimit: 5, callback: (v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : v) } },
        },
      },
    });
  }

  function render(data) {
    const { operations: o, money: m, branch } = data;
    const head = document.getElementById('dxHeader');
    head.innerHTML = `<h2>Dashboard</h2><span class="dx-sub">${esc(branch)} · ${esc(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</span>`;

    let html = `<div class="dx-grid">
      ${tile({ label: 'New orders', value: count(o.new_orders), note: o.new_orders ? 'waiting for a store' : 'all clear', tone: o.new_orders ? 'warn' : '', go: 'orders' })}
      ${tile({ label: 'Orders to deliver', value: count(o.to_deliver), note: `${rupees(o.to_deliver_value)} open`, go: 'orders' })}
      ${tile({ label: 'Waiting for a rider', value: count(o.waiting_rider), note: o.waiting_rider ? 'assign now' : 'all assigned', tone: o.waiting_rider ? 'alert' : '', go: 'orders' })}
      ${tile({ label: 'Riders available', value: `${count(o.riders_available)} of ${count(o.riders_active)}`, note: 'active riders', go: 'riders' })}
    </div>`;

    if (m) {
      html += `<div class="dx-grid">
        ${tile({ label: 'Draft vouchers', value: count(m.vouchers.draft_count), note: rupees(m.vouchers.draft_amount), tone: m.vouchers.draft_count ? 'bar-warn' : '', go: 'payment-vouchers' })}
        ${tile({ label: 'Awaiting approval', value: count(m.vouchers.pending_count), note: rupees(m.vouchers.pending_amount), tone: m.vouchers.pending_count ? 'bar-warn' : '', go: 'payment-vouchers' })}
        ${tile({ label: 'Approved, not paid', value: count(m.vouchers.approved_count), note: rupees(m.vouchers.approved_amount), tone: m.vouchers.approved_count ? 'bar-warn' : '', go: 'payment-vouchers' })}
        ${tile({ label: 'Pending expenses', value: count(m.expenses.count), note: rupees(m.expenses.amount), tone: m.expenses.count ? 'bar-info' : '', go: 'expenses' })}
      </div>
      <div class="dx-grid">
        ${tile({ label: 'Cash position', value: rupees(m.balances.cash + m.balances.bank), note: `Cash ${rupees(m.balances.cash)} · Bank ${rupees(m.balances.bank)}`, go: 'general-ledger' })}
        ${tile({ label: 'Cash with riders', value: rupees(m.balances.riders), note: 'to be handed in', go: 'general-ledger' })}
        ${tile({ label: 'Payable to stores', value: rupees(m.balances.stores), note: 'owed now', go: 'store-payments' })}
        ${tile({ label: 'This month', value: rupees(m.month.sale), note: `income ${rupees(m.month.income)} · expenses ${rupees(m.month.expense)}`, go: 'reports-centre' })}
      </div>`;
    } else {
      html += `<div class="dx-grid">
        ${tile({ label: "Today's orders", value: count(o.today_orders), note: `${count(o.today_delivered)} delivered` })}
        ${tile({ label: 'Cancelled today', value: count(o.today_cancelled), note: 'orders' })}
      </div>`;
    }

    html += `<div class="dx-split">
      ${m ? panel('Income vs expenses (12 months)', `<div class="dx-chart"><canvas id="dxChart" role="img" aria-label="ServeNow income and expenses for each of the last 12 months"></canvas></div>${chartTable(m.chart)}`) : ''}
      ${panel('Orders needing attention', attention(data.attention), { go: 'orders', text: 'All orders' })}
    </div>`;

    if (m) {
      html += `<div class="dx-split dx-even">
        ${panel('Riders holding cash', nameList(m.top_riders, 'amount', 'No rider is holding cash.', 'reports-centre'))}
        ${panel('Stores to pay', nameList(m.top_stores, 'amount', 'Nothing is owed to stores.', 'store-payments'))}
      </div>
      ${panel('Recent draft vouchers', drafts(m.drafts), { go: 'payment-vouchers', text: 'All vouchers' })}`;
    }

    document.getElementById('dxBody').innerHTML = html;
    if (m) drawChart(m.chart);
  }

  async function loadDashboardOverview() {
    const body = document.getElementById('dxBody');
    if (!body) return;
    try {
      const response = await fetch('/api/admin/dashboard-overview', {
        headers: { Authorization: `Bearer ${localStorage.getItem('serveNowToken')}` },
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || 'Could not load the dashboard');
      render(data);
    } catch (error) {
      if (!body.children.length) body.innerHTML = '<p class="dx-empty">The dashboard could not load. It will try again shortly.</p>';
      console.error('Dashboard failed:', error);
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (document.getElementById('dashboard')?.classList.contains('active')) loadDashboardOverview();
    }, REFRESH_MS);
  }

  document.addEventListener('click', (event) => {
    const go = event.target.closest?.('[data-dx-go]');
    if (!go) return;
    document.querySelector(`.tab-link[data-tab="${go.dataset.dxGo}"]`)?.click();
  });

  window.loadDashboardOverview = loadDashboardOverview;

  // This script can load after the page has already opened the dashboard.
  if (document.getElementById('dashboard')?.classList.contains('active') && !document.getElementById('dxBody')?.children.length) {
    loadDashboardOverview();
  }
})();
