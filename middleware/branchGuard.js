// Front door for branch accounts (admin / standard_user with a branch set).
//
// A branch account may only use screens that have been made branch-aware. Everything else is
// refused here, before any route runs, so a route nobody remembered to scope cannot leak
// another branch's data. Head office (staff with no branch), customers, store owners and
// riders pass straight through; their own checks are unchanged.
//
// To open another area to branch accounts: scope its queries by branch, then add it below.

const jwt = require('jsonwebtoken');
const { getAccountStatus } = require('./auth');
const { STAFF_TYPES, toBranchId } = require('../utils/branches');

const DENY_MESSAGE = 'This area is not available to branch accounts yet. Please ask head office.';

function tokenFrom(req) {
    const header = req.headers['authorization'];
    const bearer = header && header.split(' ')[1];
    return bearer || req.headers['x-access-token'] || null;
}

// Which record a branch account is reaching for, so its branch can be checked.
//   returns { allow: true }                      the route may run (it scopes itself)
//           { deny: true }                       refused
//           { check: 'orders'|'stores'|'riders'|'products', id }   allowed only if the record is in the branch
function classify(method, path) {
    const m = method.toUpperCase();
    const read = m === 'GET' || m === 'HEAD';
    const p = path.replace(/\/+$/, '') || '/';
    let hit;

    if (/^\/api\/auth(\/|$)/.test(p)) return { allow: true };
    // The help chat page; what the assistant can see is cut to the branch inside its tools.
    if (p === '/api/aiagent/widget') return read ? { allow: true } : { deny: true };
    // Branch management answers "not found" to everyone but the owner, in the route itself.
    if (p === '/api/branches' || /^\/api\/branches\//.test(p)) return { allow: true };

    if (p === '/api/orders') return read ? { allow: true } : { deny: true };
    if (p === '/api/orders/admin/manual-create') return { allow: true };
    // Both cut to the branch by the route.
    if (p === '/api/orders/admin/manual-products' || p === '/api/orders/available-riders') {
        return read ? { allow: true } : { deny: true };
    }
    if (p === '/api/orders/delivery-fee-config' || p === '/api/orders/customer-support-contact') {
        return read ? { allow: true } : { deny: true };
    }
    if ((hit = p.match(/^\/api\/orders\/(\d+)(\/|$)/))) return { check: 'orders', id: Number(hit[1]) };

    if (p === '/api/stores') return { allow: true };
    // Notices, promotions, flash messages and customer pushes: the route holds a branch account
    // to its own branch (settings, recipients and the customer picker).
    if (/^\/api\/stores\/(global-delivery-status|live-promotions|customer-flash-message)$/.test(p)) return { allow: true };
    // Every app asks this at start. Sending the update notice stays with head office.
    if (p === '/api/stores/app-update-status') return read ? { allow: true } : { deny: true };
    if (p === '/api/stores/notification-customers') return read ? { allow: true } : { deny: true };
    if (p === '/api/stores/customer-push-notification') return m === 'POST' ? { allow: true } : { deny: true };
    if (p === '/api/admin/delivery-fee-settings') return { allow: true };
    if (p === '/api/admin/dashboard-overview') return read ? { allow: true } : { deny: true };
    if ((hit = p.match(/^\/api\/stores\/(\d+)(\/|$)/))) return { check: 'stores', id: Number(hit[1]) };

    if (p === '/api/riders') return { allow: true };
    if (p === '/api/riders/upload-image') return m === 'POST' ? { allow: true } : { deny: true };
    if (p === '/api/riders/types/vehicle') return read ? { allow: true } : { deny: true };
    if (p === '/api/riders/fuel-history') return read ? { allow: true } : { deny: true };
    if ((hit = p.match(/^\/api\/riders\/(\d+)(\/|$)/))) return { check: 'riders', id: Number(hit[1]) };

    // Customer accounts: the list is cut to the branch by the route; changes stay head office.
    if (p === '/api/users') return read ? { allow: true } : { deny: true };

    // Products: the list is cut to the branch by the route. A change must be to a product of the
    // branch, and any store named in the request must be in the branch too, so a product cannot be
    // added to another branch or moved there. The routes still check the staff rights.
    if (p === '/api/products') {
        if (read) return { allow: true };
        return m === 'POST' ? { bodyStore: true } : { deny: true };
    }
    if (p === '/api/products/upload-image') return m === 'POST' ? { allow: true } : { deny: true };
    if ((hit = p.match(/^\/api\/products\/(\d+)$/))) {
        const rule = { check: 'products', id: Number(hit[1]) };
        if (read || m === 'DELETE') return rule;
        return m === 'PUT' ? { ...rule, bodyStore: true } : { deny: true };
    }

    // Money and reports: every read goes through the branch filter in utils/branchFinance.js, and
    // routes/financial.js checks each document that is changed. Banks are shared by the company,
    // and the ledger sync always covers every branch, so those stay with head office.
    if (p === '/api/financial/banks' || p === '/api/financial/gl/sync') return read ? { allow: true } : { deny: true };
    if (/^\/api\/financial(\/|$)/.test(p)) return { allow: true };
    // Attendance marks are the person's own; the HR screens are cut to the branch by the routes.
    if (/^\/api\/hr(\/|$)/.test(p)) return { allow: true };

    // Reports, payments and wallets on the admin side: reads only, through the same filter.
    // Wallet adjustments, report edits, backups, restore, SQL and data clearing stay head office.
    if (read && /^\/api\/admin\/(daily-sales-summary|recent-activity|inventory-report|store-order-breakdown|[a-z-]*-report(\/[a-z]+)?|payments(\/stats|\/\d+)?|wallets(\/stats|\/\d+)?)$/.test(p)) {
        return { allow: true };
    }

    // Shared catalogue (the same data in every branch): read only.
    if (/^\/api\/(categories|units|sizes)(\/|$)/.test(p)) return read ? { allow: true } : { deny: true };

    return { deny: true };
}

const TABLES = {
    orders: 'SELECT branch_id FROM orders WHERE id = ? LIMIT 1',
    stores: 'SELECT branch_id FROM stores WHERE id = ? LIMIT 1',
    riders: 'SELECT branch_id FROM riders WHERE id = ? LIMIT 1',
    products: 'SELECT s.branch_id FROM products p JOIN stores s ON s.id = p.store_id WHERE p.id = ? LIMIT 1',
};

async function branchGuard(req, res, next) {
    try {
        // Express routing ignores case, so the guard must too: /API/admin reaches the same route.
        const path = String(req.path || '').toLowerCase();
        if (!/^\/(api|integrations)(\/|$)/.test(path)) return next();

        const token = tokenFrom(req);
        if (!token) return next();

        let user;
        try {
            user = jwt.verify(token, process.env.JWT_SECRET);
        } catch (_) {
            return next(); // the route's own authentication reports a bad token
        }
        if (!user || !STAFF_TYPES.has(user.user_type)) return next();

        const status = await getAccountStatus(req.db, user);
        if (!status.ok) return next(); // the route's own authentication reports it
        const branchId = toBranchId(status.branch_id);
        if (branchId === null) return next(); // head office

        const rule = /^\/integrations(\/|$)/.test(path) ? { deny: true } : classify(req.method, path);
        if (rule.deny) return res.status(403).json({ success: false, message: DENY_MESSAGE });
        if (rule.allow) return next();

        // Unknown record: let the route answer 404. A record in another branch: refuse, and
        // say the same thing as for a missing one so ids in other branches are not confirmed.
        const inOtherBranch = async (table, id) => {
            const [rows] = await req.db.execute(TABLES[table], [id]);
            return rows.length > 0 && toBranchId(rows[0].branch_id) !== branchId;
        };
        const notFound = () => res.status(404).json({ success: false, message: 'Not found' });

        if (rule.check && (await inOtherBranch(rule.check, rule.id))) return notFound();
        if (rule.bodyStore) {
            const named = req.body && req.body.store_id;
            const storeId = Number(named);
            // Adding needs a store. An edit that names none stays in the product's own store.
            if (named === undefined || named === null || named === '') {
                if (!rule.check) return res.status(400).json({ success: false, message: 'Store is required' });
            } else if (!Number.isInteger(storeId) || storeId <= 0) {
                return res.status(400).json({ success: false, message: 'Invalid store' });
            } else if (await inOtherBranch('stores', storeId)) {
                return notFound();
            }
        }
        return next();
    } catch (err) {
        // Fail closed: if the branch cannot be worked out, a branch account gets nothing.
        console.error('[branchGuard]', err.message);
        return res.status(503).json({ success: false, message: 'Authentication service unavailable' });
    }
}

module.exports = { branchGuard, classify, DENY_MESSAGE };
