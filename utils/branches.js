// Branches (Kot Addu, Muzaffargarh, ...). One system and one database serve every branch;
// stores, riders, orders and customers each belong to one branch.
//
// Who sees what:
//   customer / store owner  their own branch only
//   rider                   their own branch only
//   admin / standard_user   branch_id empty  = "all branches" (head office, as before)
//                           branch_id set    = a branch account, limited to that branch
//
// The branch of a logged-in account is always read from the database (see
// middleware/auth.js), never from the token or the request, so it cannot be forged.

const DEFAULT_BRANCH_ID = 1;

// The one account that may create, change, open or close branches. Checked against the
// database, never the token; every other account is told the feature does not exist.
const OWNER_EMAIL = 'admin@servenow.com';
const isOwnerEmail = (email) => String(email || '').trim().toLowerCase() === OWNER_EMAIL;
const STAFF_TYPES = new Set(['admin', 'standard_user']);

const BRANCH_CACHE_MS = 30 * 1000;
let branchCache = { rows: null, expires: 0 };

function clearBranchCache() {
    branchCache = { rows: null, expires: 0 };
}

async function listBranches(db, { activeOnly = false } = {}) {
    if (!branchCache.rows || branchCache.expires < Date.now()) {
        const [rows] = await db.execute(
            `SELECT id, code, name, city, center_latitude, center_longitude, radius_km, phone, is_active, sort_order
               FROM branches ORDER BY sort_order ASC, id ASC`
        );
        branchCache = { rows: rows || [], expires: Date.now() + BRANCH_CACHE_MS };
    }
    return activeOnly ? branchCache.rows.filter((b) => Number(b.is_active) === 1) : branchCache.rows;
}

async function getBranch(db, id) {
    const n = toBranchId(id);
    if (n === null) return null;
    const rows = await listBranches(db);
    return rows.find((b) => Number(b.id) === n) || null;
}

// A branch id from user input: a positive whole number, else null. Never trusts the caller.
function toBranchId(value) {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
}

// A branch account is head-office staff limited to one branch.
function isBranchLimited(user) {
    return !!user && STAFF_TYPES.has(user.user_type) && toBranchId(user.branch_id) !== null;
}

// Head office: staff with no branch set. They see every branch.
function isHeadOffice(user) {
    return !!user && STAFF_TYPES.has(user.user_type) && toBranchId(user.branch_id) === null;
}

// The one branch a staff request is limited to, or null when it may span branches.
function staffScope(user) {
    return isBranchLimited(user) ? toBranchId(user.branch_id) : null;
}

// Branch a staff list should show. A branch account always gets its own branch; a request for
// another branch is refused. Head office gets the requested branch, or null for all.
// Returns { branchId, error }.
function resolveStaffBranch(user, requested) {
    const wanted = toBranchId(requested);
    const own = staffScope(user);
    if (own !== null) {
        if (wanted !== null && wanted !== own) return { branchId: null, error: 'You can only use your own branch' };
        return { branchId: own, error: null };
    }
    return { branchId: wanted, error: null };
}

// Branch for a new store, rider or manual order. A branch account can only create in its own
// branch; head office must name an active branch (falls back to Kot Addu when one is live).
async function resolveWriteBranch(db, user, requested) {
    const wanted = toBranchId(requested);
    const own = staffScope(user);
    if (own !== null) {
        if (wanted !== null && wanted !== own) return { branchId: null, error: 'You can only add to your own branch' };
        return { branchId: own, error: null };
    }
    const id = wanted === null ? DEFAULT_BRANCH_ID : wanted;
    const branch = await getBranch(db, id);
    if (!branch) return { branchId: null, error: 'Unknown branch' };
    return { branchId: id, error: null };
}

// May this account act on a record that belongs to `recordBranchId`?
function canAccessBranch(user, recordBranchId) {
    const own = staffScope(user);
    if (own === null) return true;
    return toBranchId(recordBranchId) === own;
}

// SQL fragment limiting `column` to the account's branch. Empty for head office.
// Returns { sql, params } to append to a WHERE with AND.
function branchFilter(user, column, requested) {
    const { branchId, error } = resolveStaffBranch(user, requested);
    if (error) return { sql: '', params: [], error };
    if (branchId === null) return { sql: '', params: [], error: null };
    return { sql: ` AND ${column} = ?`, params: [branchId], error: null };
}

// Active branch a customer's request is for: the account's own branch when signed in as a
// customer or store owner, otherwise the one named in the request, otherwise Kot Addu.
// Returns { branchId, error }; a named branch that is unknown or switched off is an error.
async function resolveCustomerBranch(db, user, requested) {
    const wanted = toBranchId(requested);
    const own = user && !STAFF_TYPES.has(user.user_type) ? toBranchId(user.branch_id) : null;
    const id = own !== null ? own : wanted !== null ? wanted : DEFAULT_BRANCH_ID;
    const branch = await getBranch(db, id);
    if (!branch) return { branchId: null, error: 'Unknown branch' };
    if (Number(branch.is_active) !== 1) return { branchId: null, error: `${branch.name} is not open yet` };
    return { branchId: id, error: null };
}

// Branch ids of the given stores. Used to check a cart or an order against one branch.
async function storeBranches(db, storeIds) {
    const ids = [...new Set((storeIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (!ids.length) return new Map();
    const [rows] = await db.execute(
        `SELECT id, branch_id FROM stores WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
    );
    return new Map((rows || []).map((r) => [Number(r.id), Number(r.branch_id)]));
}

// The setting (delivery notice, promotion, flash message) that applies to a branch. A table
// holds rows for one branch (branch_id set) and rows for every branch (branch_id empty); the
// newest of each counts. The branch's own row wins while it is switched on, otherwise the
// all-branches one. `table` and `columns` are constants from the code, never user input.
async function latestSetting(db, table, columns, branchId) {
    const [all] = await db.execute(`SELECT ${columns} FROM ${table} WHERE branch_id IS NULL ORDER BY id DESC LIMIT 1`);
    const everyBranch = all[0] || null;
    if (branchId === null || branchId === undefined) return everyBranch;
    const [own] = await db.execute(`SELECT ${columns} FROM ${table} WHERE branch_id = ? ORDER BY id DESC LIMIT 1`, [branchId]);
    const branchRow = own[0] || null;
    if (branchRow && branchRow.is_enabled) return branchRow;
    return everyBranch && everyBranch.is_enabled ? everyBranch : (branchRow || everyBranch);
}

// Branch whose settings a request is about. Staff: their own, or the one named, or null for the
// all-branches setting. Everyone else: their customer branch; a closed branch reads all-branches.
async function settingBranchFor(db, user, requested) {
    if (user && STAFF_TYPES.has(user.user_type)) return resolveStaffBranch(user, requested);
    const chosen = await resolveCustomerBranch(db, user, requested);
    return { branchId: chosen.error ? null : chosen.branchId, error: null };
}

const FEE_KEYS = { base_fee: 'delivery_fee_base', additional_per_store: 'delivery_fee_additional_per_store' };
const feeKey = (field, branchId) => `${FEE_KEYS[field]}_b${branchId}`;

// Delivery fees: a branch's own value if it has one, otherwise the all-branches value in `cfg`.
async function applyBranchFees(db, branchId, cfg) {
    if (branchId === null || branchId === undefined) return cfg;
    const [rows] = await db.execute(
        'SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN (?, ?)',
        [feeKey('base_fee', branchId), feeKey('additional_per_store', branchId)]
    );
    const out = { ...cfg };
    for (const field of Object.keys(FEE_KEYS)) {
        const row = (rows || []).find((r) => r.setting_key === feeKey(field, branchId));
        const n = row ? Number.parseFloat(row.setting_value) : NaN;
        if (Number.isFinite(n) && n >= 0) out[field] = n;
    }
    return out;
}

// Socket rooms for staff. Head office joins "admins" (everything); a branch account joins only
// its own branch room, so live order events never cross branches.
function adminRoomsFor(branchId) {
    const id = toBranchId(branchId);
    return id === null ? ['admins'] : ['admins', `admins_b${id}`];
}

function staffRoomFor(user) {
    const own = staffScope(user);
    return own === null ? 'admins' : `admins_b${own}`;
}

module.exports = {
    DEFAULT_BRANCH_ID,
    OWNER_EMAIL,
    isOwnerEmail,
    STAFF_TYPES,
    clearBranchCache,
    listBranches,
    getBranch,
    toBranchId,
    isBranchLimited,
    isHeadOffice,
    staffScope,
    resolveStaffBranch,
    resolveWriteBranch,
    canAccessBranch,
    branchFilter,
    resolveCustomerBranch,
    storeBranches,
    adminRoomsFor,
    staffRoomFor,
    latestSetting,
    settingBranchFor,
    applyBranchFees,
    feeKey,
};
