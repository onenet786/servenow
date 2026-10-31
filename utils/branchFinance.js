// Branch rules for money.
//
// Reading: scopedDb() wraps a database handle so every SELECT sees one branch only. Report code
// (thousands of lines of SQL) stays as it is; each table it reads is swapped for a filtered copy
// of that table. Writes, DDL and anything that is not a SELECT pass through untouched.
//
// Writing: documentBranch() works out the branch of a new document from its rider, store,
// customer or order. The client never chooses it when the document names one of those.

const { DEFAULT_BRANCH_ID, STAFF_TYPES, listBranches, resolveStaffBranch, staffScope, toBranchId } = require('./branches');
const { softAuth } = require('../middleware/auth');

// How to read each table for branch N. The id is checked to be a whole number before it is used.
const SCOPED_TABLES = {
    orders: (n) => `SELECT * FROM orders WHERE branch_id = ${n}`,
    stores: (n) => `SELECT * FROM stores WHERE branch_id = ${n}`,
    riders: (n) => `SELECT * FROM riders WHERE branch_id = ${n}`,
    financial_transactions: (n) => `SELECT * FROM financial_transactions WHERE branch_id = ${n}`,
    cash_payment_vouchers: (n) => `SELECT * FROM cash_payment_vouchers WHERE branch_id = ${n}`,
    cash_receipt_vouchers: (n) => `SELECT * FROM cash_receipt_vouchers WHERE branch_id = ${n}`,
    rider_cash_movements: (n) => `SELECT * FROM rider_cash_movements WHERE branch_id = ${n}`,
    rider_cash_submission_orders: (n) => `SELECT * FROM rider_cash_submission_orders WHERE branch_id = ${n}`,
    rider_day_closings: (n) => `SELECT * FROM rider_day_closings WHERE branch_id = ${n}`,
    rider_fuel_payment_entries: (n) => `SELECT * FROM rider_fuel_payment_entries WHERE branch_id = ${n}`,
    riders_fuel_history: (n) => `SELECT * FROM riders_fuel_history WHERE branch_id = ${n}`,
    rider_store_payments: (n) => `SELECT * FROM rider_store_payments WHERE branch_id = ${n}`,
    store_settlements: (n) => `SELECT * FROM store_settlements WHERE branch_id = ${n}`,
    journal_vouchers: (n) => `SELECT * FROM journal_vouchers WHERE branch_id = ${n}`,
    admin_expenses: (n) => `SELECT * FROM admin_expenses WHERE branch_id = ${n}`,
    payments: (n) => `SELECT * FROM payments WHERE branch_id = ${n}`,
    financial_reports: (n) => `SELECT * FROM financial_reports WHERE branch_id = ${n}`,
    gl_journals: (n) => `SELECT * FROM gl_journals WHERE branch_id = ${n}`,
    gl_lines: (n) => `SELECT gl.* FROM gl_lines gl JOIN gl_journals gj ON gj.id = gl.journal_id WHERE gj.branch_id = ${n}`,
    journal_voucher_entries: (n) => `SELECT * FROM journal_voucher_entries WHERE jnv_id IN (SELECT id FROM journal_vouchers WHERE branch_id = ${n})`,
    order_items: (n) => `SELECT bi.* FROM order_items bi JOIN orders bo ON bo.id = bi.order_id WHERE bo.branch_id = ${n}`,
    products: (n) => `SELECT * FROM products WHERE store_id IN (SELECT id FROM stores WHERE branch_id = ${n})`,
    // Staff have no branch, so they stay visible (their names appear on documents).
    users: (n) => `SELECT * FROM users WHERE branch_id = ${n} OR branch_id IS NULL`,
    wallets: (n) => `SELECT * FROM wallets WHERE rider_id IN (SELECT id FROM riders WHERE branch_id = ${n})
        OR store_id IN (SELECT id FROM stores WHERE branch_id = ${n})
        OR user_id IN (SELECT id FROM users WHERE branch_id = ${n})`,
    wallet_transactions: (n) => `SELECT * FROM wallet_transactions WHERE wallet_id IN (SELECT id FROM wallets WHERE
        rider_id IN (SELECT id FROM riders WHERE branch_id = ${n})
        OR store_id IN (SELECT id FROM stores WHERE branch_id = ${n})
        OR user_id IN (SELECT id FROM users WHERE branch_id = ${n}))`,
};

const NOT_ALIASES = new Set(['WHERE', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'JOIN', 'ON', 'GROUP', 'ORDER', 'HAVING',
    'LIMIT', 'UNION', 'USING', 'SET', 'FOR', 'STRAIGHT_JOIN', 'NATURAL', 'FORCE', 'USE', 'IGNORE', 'WINDOW', 'LOCK', 'INTO']);

const TABLE_REF = new RegExp(
    `\\b(FROM|JOIN)(\\s+)\`?(${Object.keys(SCOPED_TABLES).join('|')})\`?(?![\\w.])(?:(\\s+)(AS\\s+)?([A-Za-z_][A-Za-z0-9_]*))?`,
    'gi'
);

function scopeSql(sql, branchId) {
    const n = toBranchId(branchId);
    if (n === null) throw new Error('scopeSql needs a branch');
    const text = String(sql);
    if (!/^\s*\(?\s*(SELECT|WITH)\b/i.test(text)) return text;
    return text.replace(TABLE_REF, (match, keyword, space, table, aliasSpace, as, alias) => {
        const scoped = SCOPED_TABLES[table.toLowerCase()](n);
        if (alias && !NOT_ALIASES.has(alias.toUpperCase())) return `${keyword}${space}(${scoped}) AS ${alias}`;
        return `${keyword}${space}(${scoped}) AS ${table}${aliasSpace || ''}${alias || ''}`;
    });
}

// A handle that behaves like `db`, except that SELECTs see one branch. `__unscoped` is the real
// handle: ledger sync must never run through this, or it would reverse other branches' journals.
function scopedDb(db, branchId) {
    const n = toBranchId(branchId);
    if (n === null) return db;
    const wrap = (target) => new Proxy(target, {
        get(obj, prop) {
            if (prop === '__unscoped') return obj;
            if (prop === 'execute' || prop === 'query') {
                return (sql, ...rest) => obj[prop](typeof sql === 'string' ? scopeSql(sql, n) : sql, ...rest);
            }
            if (prop === 'getConnection') return async () => wrap(await obj.getConnection());
            const value = obj[prop];
            return typeof value === 'function' ? value.bind(obj) : value;
        },
    });
    return wrap(db);
}

const unscoped = (db) => (db && db.__unscoped) || db;

// For staff: read one branch. A branch account is held to its own; head office picks with
// branch_id (query, or the body of a report request), or sees everything. Runs after req.user.
function applyBranchScope(req, res, next) {
    if (!req.user || !STAFF_TYPES.has(req.user.user_type)) return next();
    const requested = req.query.branch_id ?? (req.method === 'GET' ? undefined : req.body && req.body.branch_id);
    if (requested !== undefined && requested !== '' && toBranchId(requested) === null) {
        return res.status(400).json({ success: false, message: 'Unknown branch' });
    }
    const scope = resolveStaffBranch(req.user, requested);
    if (scope.error) return res.status(403).json({ success: false, message: scope.error });
    req.branchId = scope.branchId;
    req.db = scopedDb(req.db, scope.branchId);
    return next();
}

// For routers whose routes authenticate one by one: look the caller up first. A failed lookup
// leaves req.user empty, and then the route's own authentication refuses the request.
const scopeReads = (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    return softAuth(req, res, () => applyBranchScope(req, res, next));
};

async function branchOfRow(db, table, id) {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) return null;
    const [rows] = await unscoped(db).execute(`SELECT branch_id FROM ${table} WHERE id = ? LIMIT 1`, [n]);
    return rows.length ? toBranchId(rows[0].branch_id) : null;
}

// Branch of a new money document. `from` names what it is for: { rider, store, customer, order }.
// Everything named must be in one branch, and a branch account can only write in its own.
// With nothing named, a branch account uses its own branch and head office must choose one
// (unless only one branch is open). Returns { branchId } or { error, status }.
async function documentBranch(db, user, requested, from = {}) {
    const found = new Set();
    const sources = [['riders', from.rider], ['stores', from.store], ['users', from.customer], ['orders', from.order]];
    for (const [table, id] of sources) {
        const branch = await branchOfRow(db, table, id);
        if (branch !== null) found.add(branch);
    }
    if (found.size > 1) return { error: 'One document cannot cover more than one branch', status: 400 };

    const own = staffScope(user);
    const wanted = toBranchId(requested);
    if (found.size === 1) {
        const branchId = [...found][0];
        if (own !== null && own !== branchId) return { error: 'This belongs to another branch', status: 403 };
        if (wanted !== null && wanted !== branchId) return { error: 'This belongs to another branch', status: 400 };
        return { branchId };
    }
    if (own !== null) {
        if (wanted !== null && wanted !== own) return { error: 'You can only use your own branch', status: 403 };
        return { branchId: own };
    }
    const all = await listBranches(unscoped(db));
    if (wanted !== null) {
        return all.some((b) => Number(b.id) === wanted) ? { branchId: wanted } : { error: 'Unknown branch', status: 400 };
    }
    const open = all.filter((b) => Number(b.is_active) === 1);
    if (open.length <= 1) return { branchId: open.length ? Number(open[0].id) : DEFAULT_BRANCH_ID };
    return { error: 'Please choose a branch', status: 400 };
}

// Rows of a journal voucher name their own rider, store or customer.
function journalEntryParties(entries) {
    const from = { rider: new Set(), store: new Set(), customer: new Set() };
    for (const e of entries || []) {
        if (!e || !e.entity_id) continue;
        if (e.entity_type === 'rider') from.rider.add(e.entity_id);
        else if (e.entity_type === 'store') from.store.add(e.entity_id);
        else if (e.entity_type === 'customer' || e.entity_type === 'user') from.customer.add(e.entity_id);
    }
    return from;
}

async function journalVoucherBranch(db, user, requested, entries) {
    const parties = journalEntryParties(entries);
    const found = new Set();
    for (const [table, ids] of [['riders', parties.rider], ['stores', parties.store], ['users', parties.customer]]) {
        for (const id of ids) {
            const branch = await branchOfRow(db, table, id);
            if (branch !== null) found.add(branch);
        }
    }
    if (found.size > 1) return { error: 'One document cannot cover more than one branch', status: 400 };
    if (found.size === 1) {
        const branchId = [...found][0];
        const own = staffScope(user);
        if (own !== null && own !== branchId) return { error: 'This belongs to another branch', status: 403 };
        const wanted = toBranchId(requested);
        if (wanted !== null && wanted !== branchId) return { error: 'This belongs to another branch', status: 400 };
        return { branchId };
    }
    return documentBranch(db, user, requested, {});
}

// Branch for a financial_transactions row, which names its party in several ways.
// Falls back to Kot Addu only for rows with no party at all (legacy callers name a branch).
async function financialEntryBranch(db, data) {
    const explicit = toBranchId(data.branch_id);
    if (explicit !== null) return explicit;
    const type = String(data.related_entity_type || '').toLowerCase();
    const table = { rider: 'riders', store: 'stores', customer: 'users', user: 'users', order: 'orders' }[type];
    if (table) {
        const branch = await branchOfRow(db, table, data.related_entity_id);
        if (branch !== null) return branch;
    }
    if (data.reference_type === 'order') {
        const branch = await branchOfRow(db, 'orders', data.reference_id);
        if (branch !== null) return branch;
    }
    return DEFAULT_BRANCH_ID;
}

module.exports = {
    SCOPED_TABLES,
    scopeSql,
    scopedDb,
    unscoped,
    applyBranchScope,
    scopeReads,
    branchOfRow,
    documentBranch,
    journalVoucherBranch,
    financialEntryBranch,
};
