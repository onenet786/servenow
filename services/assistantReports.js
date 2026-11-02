// Admin panel reports for the assistant (the admin_report tool).
//
// A report here is the panel's own route, called in-process as the person asking (no HTTP, no
// browser), so the figures are the panel's and so are its rules: the route checks the person's
// rights and cuts to their branch, and a branch account passes the same guard as on the website.
// Only the routes listed in REPORTS can be reached, always with GET; nothing in the tool's
// arguments becomes part of a path.
//
// What goes back to the model is trimmed: contact and bank details are removed, and long lists are
// cut to fit what AIAgent accepts from a tool (10 seconds, 16,000 characters). Totals are kept.
const jwt = require('jsonwebtoken');
const { branchGuard } = require('../middleware/branchGuard');
const { listBranches, staffScope, toBranchId } = require('../utils/branches');
const { scopedDb } = require('../utils/branchFinance');
const { REPORTS: REPORTS_CENTRE } = require('./reportsCentre');
const { shapeHrReport, findEmployee } = require('./assistantHr');

const ADMIN = '/api/admin';
const FINANCIAL = '/api/financial';
const HR = '/api/hr';
const TIME_LIMIT_MS = 8500;
const SIZE_LIMIT = 11000;

// dates: 'range' (start_date, end_date), 'fromto' (from, to), 'settlement' (period_from, period_to),
// 'day' (one date), 'upto' (to), or none. filters: which of store, rider, customer the route takes.
const PANEL_REPORTS = {
  daily_sale: { title: 'Daily sale report', mount: ADMIN, path: '/daily-sale-report', dates: 'day' },
  daily_summary: { title: 'Daily sale summary with rider cash', mount: ADMIN, path: '/daily-sales-summary', dates: 'day' },
  recent_activity: { title: 'Recent activity', mount: ADMIN, path: '/recent-activity' },
  inventory: { title: 'Inventory report', mount: ADMIN, path: '/inventory-report', filters: ['store'] },
  store_sales: { title: 'Store sales', mount: ADMIN, path: '/store-sales-report', dates: 'range', filters: ['store'] },
  store_product_sales: { title: 'Product sales of a store', mount: ADMIN, path: '/store-product-sales-report', dates: 'range', filters: ['store'] },
  product_sales: { title: 'Product sales across stores', mount: ADMIN, path: '/combined-product-sales-report', dates: 'range', filters: ['store'] },
  customer_sales: { title: 'Customer sales', mount: ADMIN, path: '/customer-details-sales-report', dates: 'range', filters: ['store', 'customer'], extra: { view: 'customer-summary' } },
  order_list: { title: 'Orders', mount: ADMIN, path: '/order-wise-sales-report', dates: 'range', filters: ['store'], order: true },
  sales_with_delivery: { title: 'Sales with delivery', mount: ADMIN, path: '/sales-with-delivery-report', dates: 'range', filters: ['store'] },
  sales_by_term: { title: 'Sales by store payment term', mount: ADMIN, path: '/sales-by-payment-report', dates: 'range', filters: ['store'] },
  manual_orders: { title: 'Manual order sales', mount: ADMIN, path: '/manual-order-sales-report', dates: 'range', filters: ['store'] },
  wallets: { title: 'Wallet totals', mount: ADMIN, path: '/wallets/stats' },
  payments: { title: 'Payment totals', mount: ADMIN, path: '/payments/stats' },
  financial_dashboard: { title: 'Financial dashboard', mount: FINANCIAL, path: '/dashboard' },
  platform_summary: { title: 'Platform summary', mount: FINANCIAL, path: '/reports/platform-summary', dates: 'range' },
  profit_loss: { title: 'Profit and loss', mount: FINANCIAL, path: '/gl/profit-loss', dates: 'fromto' },
  balance_sheet: { title: 'Balance sheet', mount: FINANCIAL, path: '/gl/balance-sheet', dates: 'upto' },
  trial_balance: { title: 'Trial balance', mount: FINANCIAL, path: '/gl/trial-balance', dates: 'fromto' },
  cash_flow: { title: 'Cash flow', mount: FINANCIAL, path: '/reports/cash-flow' },
  top_products: { title: 'Top selling products', mount: FINANCIAL, path: '/reports/top-products', extra: { limit: '15' } },
  category_sales: { title: 'Sales by category', mount: FINANCIAL, path: '/reports/category-sales' },
  rider_performance: { title: 'Rider performance', mount: FINANCIAL, path: '/reports/rider-performance' },
  store_performance: { title: 'Store performance', mount: FINANCIAL, path: '/reports/store-performance' },
  riders_detail: { title: 'Riders in detail', mount: FINANCIAL, path: '/reports/riders-detailed', dates: 'range', filters: ['rider'] },
  stores_detail: { title: 'Stores in detail', mount: FINANCIAL, path: '/reports/stores-detailed', dates: 'range', filters: ['store'] },
  stores_due: { title: 'Stores due for settlement', mount: FINANCIAL, path: '/store-settlements/due-stores', dates: 'settlement' },
  attendance_day: { title: 'Attendance for a day', mount: HR, path: '/attendance', dates: 'day', hr: true },
  attendance_month: { title: 'Attendance for a month', mount: HR, path: '/attendance/monthly', dates: 'month', hr: true },
  payroll: { title: 'Payroll for a month', mount: HR, path: '/payroll', dates: 'month', hr: true },
  store_balances: { title: 'Store balances', mount: FINANCIAL, path: '/reports/store-payments', dates: 'fromto', filters: ['store'] },
};

const centreKey = (key) => key.replace(/-/g, '_');

// Every Reports Centre report is available under its own name (rider-cash-position: rider_cash_position).
const REPORTS = { ...PANEL_REPORTS };
for (const r of REPORTS_CENTRE) {
  REPORTS[centreKey(r.key)] = {
    title: r.title,
    mount: FINANCIAL,
    path: `/reports-centre/${r.key}`,
    dates: r.noDates ? undefined : 'fromto',
    filters: r.filters,
  };
}

const REPORT_KEYS = Object.keys(REPORTS);

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** A named period, or from/to dates, as { from, to }. Returns { error } for dates that are not dates. */
function resolvePeriod({ period, from, to }, now = new Date()) {
  const day = (offset) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const valid = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
  if (from || to) {
    const start = String(from || to).trim();
    const end = String(to || from).trim();
    if (!valid(start) || !valid(end)) return { error: 'Dates must look like 2026-10-31.' };
    return start <= end ? { from: start, to: end } : { from: end, to: start };
  }
  const year = now.getFullYear();
  const month = now.getMonth();
  switch (period) {
    case 'yesterday': return { from: ymd(day(-1)), to: ymd(day(-1)) };
    case 'last_7_days': return { from: ymd(day(-6)), to: ymd(day(0)) };
    case 'last_30_days': return { from: ymd(day(-29)), to: ymd(day(0)) };
    case 'this_month': return { from: ymd(new Date(year, month, 1)), to: ymd(day(0)) };
    case 'last_month': return { from: ymd(new Date(year, month - 1, 1)), to: ymd(new Date(year, month, 0)) };
    case 'this_year': return { from: ymd(new Date(year, 0, 1)), to: ymd(day(0)) };
    default: return { from: ymd(day(0)), to: ymd(day(0)) };
  }
}

function dateQuery(style, { from, to }) {
  switch (style) {
    case 'range': return { start_date: from, end_date: to };
    case 'fromto': return { from, to };
    case 'settlement': return { period_from: from, period_to: to };
    case 'day': return { date: to };
    case 'month': return { month: to.slice(0, 7) };
    case 'upto': return { to };
    default: return {};
  }
}

const HIDDEN_FIELD = /^(success|columns)$|phone|mobile|contact|whatsapp|e_?mail|address|cnic|bank_|iban|account_no|account_number|password|token|image|photo|latitude|longitude/i;

function withoutPrivate(value) {
  if (Array.isArray(value)) return value.map(withoutPrivate);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => !HIDDEN_FIELD.test(k)).map(([k, v]) => [k, withoutPrivate(v)]));
}

function cutLists(value, limit, cut, at = '') {
  if (Array.isArray(value)) {
    if (value.length > limit) cut[at || 'list'] = value.length;
    return value.slice(0, limit).map((v) => cutLists(v, limit, cut, at));
  }
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cutLists(v, limit, cut, k)]));
}

// Rows without the lists inside them (an order's items, a store's orders).
function withoutNestedLists(value, inRow = false) {
  if (Array.isArray(value)) return inRow ? undefined : value.map((v) => withoutNestedLists(v, true));
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withoutNestedLists(v, inRow)]).filter(([, v]) => v !== undefined));
}

/** Longest lists that still fit, then the same without the detail inside each row. Totals are never cut. */
function fitForModel(data) {
  for (const source of [data, withoutNestedLists(data)]) {
    for (const limit of [80, 40, 20, 10]) {
      const cut = {};
      const out = cutLists(source, limit, cut);
      if (JSON.stringify(out).length <= SIZE_LIMIT) {
        const whole = source === data && !Object.keys(cut).length;
        return whole ? out : { ...out, shortened_lists: cut, shortened_note: `Long lists are shortened to ${limit} rows; totals cover everything. Say so, and offer a narrower period, store or rider.` };
      }
    }
  }
  const figures = Object.fromEntries(Object.entries(withoutNestedLists(data)).filter(([, v]) => !Array.isArray(v)));
  return { ...cutLists(figures, 3, {}), shortened_note: 'This is too long for chat, so only the totals are shown. Offer a narrower period, store or rider.' };
}

/** Runs `handler` with a request as `account`, answering with what the route would have sent. */
function callPanel(handler, account, { fullPath, url, baseUrl, query, db }) {
  const token = jwt.sign(
    { id: account.id, email: account.email, user_type: account.user_type, first_name: account.first_name, last_name: account.last_name },
    process.env.JWT_SECRET,
    { expiresIn: 60 }
  );
  return new Promise((resolve, reject) => {
    const headers = { authorization: `Bearer ${token}` };
    const req = {
      method: 'GET', url, baseUrl, originalUrl: fullPath, headers, query, params: {}, body: {}, db, ip: '127.0.0.1',
      get path() { return String(this.url).split('?')[0]; },
      get: (name) => headers[String(name).toLowerCase()],
      header: (name) => headers[String(name).toLowerCase()],
    };
    const res = {
      statusCode: 200, locals: {},
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
      send(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
      set() { return this; }, setHeader() {}, getHeader() { return undefined; }, on() { return this; },
    };
    handler(req, res, (err) => (err ? reject(err) : resolve({ next: true })));
  });
}

async function runPanelRoute(db, account, spec, query) {
  const router = require({ [ADMIN]: '../routes/admin', [FINANCIAL]: '../routes/financial', [HR]: '../routes/hr' }[spec.mount]); // late: routes load services that load this file
  const fullPath = spec.mount + spec.path;
  const guard = await callPanel(branchGuard, account, { fullPath, url: fullPath, baseUrl: '', query, db });
  if (!guard.next) return guard;
  const url = `${spec.path}?${new URLSearchParams(query)}`;
  const answer = await callPanel((req, res, next) => router.handle(req, res, next), account, { fullPath, url, baseUrl: spec.mount, query, db });
  return answer.next ? { status: 404, body: { message: 'Report not found' } } : answer;
}

const likeText = (v) => `%${String(v).replace(/[%_\\]/g, ' ').trim().slice(0, 60)}%`;

// The one record a name means, or a reply listing the choices. A number is taken as the id.
async function pickOne(kind, name, sql, db) {
  const text = String(name).trim();
  if (/^\d{1,10}$/.test(text)) return { id: text };
  const [rows] = await db.execute(sql, [likeText(text)]);
  const exact = rows.filter((r) => String(r.name).trim().toLowerCase() === text.toLowerCase());
  const found = exact.length === 1 ? exact : rows;
  if (found.length === 1) return { id: String(found[0].id), name: found[0].name };
  if (!found.length) return { reply: { error: 'not_found', message: `No ${kind} matches "${text.slice(0, 60)}". Ask them to check the name.` } };
  return { reply: { error: 'choose', message: `Several ${kind}s match. Ask which one; send its id as the ${kind}.`, choices: found.map((r) => ({ id: r.id, name: r.name })) } };
}

const LOOKUPS = {
  store: 'SELECT id, name FROM stores WHERE name LIKE ? ORDER BY name LIMIT 8',
  rider: `SELECT id, TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) AS name FROM riders
           WHERE CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, '')) LIKE ? ORDER BY name LIMIT 8`,
  customer: `SELECT id, TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) AS name FROM users
              WHERE user_type = 'customer' AND CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, '')) LIKE ? ORDER BY name LIMIT 8`,
};

async function resolveBranch(db, user, requested) {
  const own = staffScope({ user_type: user.type, branch_id: user.branch_id });
  const branches = await listBranches(db);
  const nameOf = (id) => (branches.find((b) => Number(b.id) === Number(id)) || {}).name;
  if (!requested) return own === null ? { name: 'All branches' } : { id: own, name: nameOf(own) };
  const text = String(requested).trim().toLowerCase();
  const hit = branches.find((b) => String(b.name).toLowerCase().includes(text) || String(b.city || '').toLowerCase().includes(text));
  if (!hit) return { reply: { error: 'not_found', message: `There is no branch called ${String(requested).slice(0, 40)}.`, branches: branches.map((b) => b.name) } };
  if (own !== null && toBranchId(hit.id) !== own) return { reply: { error: 'not_permitted', message: `This account can only see ${nameOf(own)}.` } };
  return { id: toBranchId(hit.id), name: hit.name };
}

/** The day or month a report really covers, and a note when that is not the period asked for. */
function periodUsed(style, { from, to }) {
  if (style === 'day') {
    return { period: { date: to }, note: from !== to ? `This report is for one day, so it shows ${to}. For several days use attendance_month (a whole month) or ask day by day.` : undefined };
  }
  if (style === 'month') {
    const month = to.slice(0, 7);
    return { period: { month }, note: from.slice(0, 7) !== month ? `This report is for one calendar month, so it shows ${month}. Ask again for ${from.slice(0, 7)} if needed.` : undefined };
  }
  return { period: style ? { from, to } : 'current' };
}

async function adminReport(db, args, user) {
  const key = String(args.report || '').trim();
  const spec = Object.prototype.hasOwnProperty.call(REPORTS, key) ? REPORTS[key] : null;
  if (!spec) return { error: 'unknown_report', message: 'That report does not exist. Choose one from the list in the report field.' };

  const [accounts] = await db.execute('SELECT id, email, user_type, first_name, last_name FROM users WHERE id = ?', [user.id]);
  if (!accounts.length) return { error: 'not_permitted', message: 'This account can no longer use reports.' };

  const dates = resolvePeriod(args);
  if (dates.error) return { error: 'bad_date', message: dates.error };
  const branch = await resolveBranch(db, user, args.branch);
  if (branch.reply) return branch.reply;

  const query = { ...(spec.extra || {}), ...dateQuery(spec.dates, dates) };
  if (branch.id) query.branch_id = String(branch.id);
  const lookupDb = scopedDb(db, branch.id);
  const named = {};
  for (const kind of ['store', 'rider', 'customer']) {
    if (!args[kind]) continue;
    if (!(spec.filters || []).includes(kind)) {
      return { error: 'no_filter', message: `${spec.title} cannot be limited to one ${kind}. Ask for it without the ${kind}, or choose another report.` };
    }
    const found = await pickOne(kind, args[kind], LOOKUPS[kind], lookupDb);
    if (found.reply) return found.reply;
    query[`${kind}_id`] = found.id;
    named[kind] = found.name || found.id;
  }
  // Attendance and payroll take one person by name: the screen lists everyone, so the rows are kept here.
  let employeeId = null;
  if (args.employee) {
    if (!spec.hr) return { error: 'no_filter', message: `${spec.title} is not about staff. For one person's attendance use attendance_day, attendance_month or payroll.` };
    const found = await findEmployee(db, args.employee, branch.id);
    if (found.reply) return found.reply;
    employeeId = found.id;
    named.employee = found.name || found.id;
  }
  if (spec.order) {
    if (args.status) query.status = String(args.status).trim().toLowerCase().slice(0, 30);
    if (args.search) query.search = String(args.search).trim().slice(0, 60);
  }

  let timer;
  const tooSlow = new Promise((resolve) => { timer = setTimeout(() => resolve({ status: 504 }), TIME_LIMIT_MS); });
  let answer;
  try {
    answer = await Promise.race([runPanelRoute(db, accounts[0], spec, query), tooSlow]);
  } catch (err) {
    console.error(`[aiagent] report ${key} failed:`, err.message);
    answer = { status: 500 };
  } finally {
    clearTimeout(timer);
  }

  if (answer.status === 504) return { error: 'too_slow', message: 'This report took too long. Offer a shorter period, or one store or rider.' };
  if (answer.status === 403) return { error: 'not_permitted', message: `${user.name}'s user rights do not include ${spec.title}. Suggest asking an administrator.` };
  if (answer.status === 404) return { error: 'not_found', message: `${spec.title} found nothing for that.` };
  if (answer.status !== 200 || !answer.body || typeof answer.body !== 'object') {
    return { error: 'failed', message: `${spec.title} could not be loaded just now. Suggest opening it in the admin panel.` };
  }
  const used = periodUsed(spec.dates, dates);
  const body = withoutPrivate(spec.hr ? shapeHrReport(key, answer.body, { employeeId }) : answer.body);
  if (spec.hr && employeeId && !(body.attendance || body.payroll || []).length) {
    return { error: 'not_found', message: `${named.employee} has no ${spec.title.toLowerCase()} entry for that day or month.` };
  }
  return {
    report_name: key,
    title: spec.title,
    period: used.period,
    ...(used.note ? { period_note: used.note } : {}),
    branch: branch.name,
    ...named,
    currency: 'PKR',
    ...fitForModel(body),
  };
}

module.exports = { REPORT_KEYS, adminReport, resolvePeriod, withoutPrivate, fitForModel };
