// Store and product routes are public, so customers can browse without logging in, but the same
// rows hold owner contacts, bank accounts, payment terms and cost prices. These filters run on the
// way out and remove those fields unless the caller may see them: staff, or a store owner for
// their own store. Run them after softAuth.

const { STAFF_TYPES } = require('../utils/branches');

const PRIVATE_STORE_KEYS = [
    'owner_id', 'owner_email', 'owner_name', 'owner_first_name', 'owner_last_name',
    'bank_id', 'bank_info', 'bank_name', 'bank_account_number', 'bank_code', 'bank_branch_name', 'bank_account_title',
    'store_bank_account_title', 'store_bank_account_number',
    'payment_term', 'payment_grace_days', 'payment_grace_start_date', 'payment_grace_due_date', 'grace_alert_muted_until',
    'commission_rate', 'store_discount_percent', 'store_discount_apply_all_products',
];
const PRIVATE_PRODUCT_KEYS = new Set(['cost_price', 'profit_type', 'profit_value', 'manual_variant_cost_override']);

const isStaff = (user) => !!user && STAFF_TYPES.has(user.user_type);

// Removes cost and profit fields at any depth (a product carries them on its size variants too).
function stripProductCosts(value) {
    if (Array.isArray(value)) return value.map(stripProductCosts);
    if (!value || typeof value !== 'object' || value instanceof Date) return value;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (!PRIVATE_PRODUCT_KEYS.has(k)) out[k] = stripProductCosts(v);
    }
    return out;
}

// The agreed store discount is ServeNow's margin. It is only taken off a product's top level:
// offers shown to customers carry their own discount fields further down.
function stripProduct(product) {
    const out = stripProductCosts(product);
    delete out.discount_type;
    delete out.discount_value;
    return out;
}

function stripStore(store) {
    const out = { ...store };
    for (const k of PRIVATE_STORE_KEYS) delete out[k];
    if (Array.isArray(out.products)) out.products = out.products.map(stripProduct);
    return out;
}

async function ownStoreIds(req) {
    if (!req.user || req.user.user_type !== 'store_owner') return new Set();
    const [rows] = await req.db.execute('SELECT id FROM stores WHERE owner_id = ?', [req.user.id]);
    return new Set((rows || []).map((r) => Number(r.id)));
}

// admin=1 asks for inactive and hidden records. Only staff and store owners get that.
function trustedAdminFlag(req) {
    const asked = ['1', 'true'].includes(String(req.query.admin || '').toLowerCase());
    return asked && !!req.user && (isStaff(req.user) || req.user.user_type === 'store_owner');
}

// Wraps res.json so every way out of the route is filtered. The filter is async because a store
// owner's stores must be looked up; a failed lookup means "not their store" (fails closed).
function filterPrivateData(req, res, next) {
    if (isStaff(req.user)) return next();
    const send = res.json.bind(res);
    res.json = (body) => {
        if (!body || typeof body !== 'object' || body.success === false) return send(body);
        ownStoreIds(req).catch(() => new Set()).then((own) => {
            const out = { ...body };
            const mine = (id) => own.has(Number(id));
            if (Array.isArray(out.stores)) out.stores = out.stores.map((s) => (mine(s.id) ? s : stripStore(s)));
            if (out.store && !mine(out.store.id)) out.store = stripStore(out.store);
            if (Array.isArray(out.products)) out.products = out.products.map((p) => (mine(p.store_id ?? (out.store && out.store.id)) ? p : stripProduct(p)));
            if (out.product && !mine(out.product.store_id)) out.product = stripProduct(out.product);
            send(out);
        });
        return res;
    };
    next();
}

module.exports = { filterPrivateData, trustedAdminFlag, stripProductCosts, stripProduct, stripStore, PRIVATE_STORE_KEYS };
