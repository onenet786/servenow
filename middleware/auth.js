const jwt = require('jsonwebtoken');
const { toBranchId, isOwnerEmail } = require('../utils/branches');

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
    // Look for token in several common locations to make local/dev debugging easier
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    let tokenSource = null;

    if (token) tokenSource = 'authorization';
    // Check x-access-token header as alternative
    if (!token && req.headers['x-access-token']) {
        token = req.headers['x-access-token'];
        tokenSource = 'x-access-token';
    }
    // URL query tokens are intentionally rejected because URLs leak into logs and history.

    // Development-only debug logging to help diagnose 401/403 issues
    if (process.env.NODE_ENV === 'development') {
        console.log('[auth] Authorization header present:', !!authHeader);
        console.log('[auth] Token source:', tokenSource);
        console.log('[auth] Extracted token present:', !!token);
    }

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Access token required'
        });
    }

    jwt.verify(token, process.env.JWT_SECRET, async (err, user) => {
        if (err) {
            if (process.env.NODE_ENV === 'development') {
                console.error('[auth] JWT verify error:', err && err.message ? err.message : err);
            }
            return res.status(403).json({
                success: false,
                message: 'Invalid or expired token'
            });
        }

        // Tokens are long-lived, so re-check that the account still exists, is
        // active, and still has the role the token claims.
        let status;
        try {
            status = await getAccountStatus(req.db, user);
            if (!status.ok) {
                return res.status(401).json({
                    success: false,
                    message: status.message
                });
            }
        } catch (e) {
            console.error('[auth] Account status check failed:', e.message);
            return res.status(503).json({
                success: false,
                message: 'Authentication service unavailable'
            });
        }

        // The branch always comes from the database, never from the token: a signed token
        // (or a stale one issued before branches existed) must not choose its own branch.
        user.branch_id = status.branch_id === undefined ? null : status.branch_id;
        req.user = user;
        next();
    });
};

// Short-lived cache so the status check doesn't hit the DB on every request.
const ACCOUNT_STATUS_TTL_MS = 60 * 1000;
const accountStatusCache = new Map();

async function getAccountStatus(db, user) {
    if (user.user_type === 'guest' || user.is_guest) {
        return { ok: true, branch_id: null };
    }
    if (!db) {
        throw new Error('Database connection missing in request');
    }

    const cacheKey = `${user.user_type}:${user.id}`;
    const cached = accountStatusCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
        return checkSessionAge(cached.status, user);
    }

    let status;
    if (user.user_type === 'rider') {
        const [rows] = await db.execute('SELECT is_active, branch_id, UNIX_TIMESTAMP(password_changed_at) AS password_changed_ts FROM riders WHERE id = ?', [user.id]);
        if (!rows.length || !rows[0].is_active) {
            status = { ok: false, message: 'Account is inactive or no longer exists. Please log in again.' };
        } else {
            status = { ok: true, branch_id: toBranchId(rows[0].branch_id), password_changed_ts: rows[0].password_changed_ts };
        }
    } else {
        const [rows] = await db.execute('SELECT is_active, user_type, branch_id, UNIX_TIMESTAMP(password_changed_at) AS password_changed_ts FROM users WHERE id = ?', [user.id]);
        if (!rows.length || rows[0].is_active === 0 || rows[0].is_active === false) {
            status = { ok: false, message: 'Account is inactive or no longer exists. Please log in again.' };
        } else if (rows[0].user_type !== user.user_type) {
            status = { ok: false, message: 'Your account role has changed. Please log in again.' };
        } else {
            status = { ok: true, branch_id: toBranchId(rows[0].branch_id), password_changed_ts: rows[0].password_changed_ts };
        }
    }

    if (accountStatusCache.size > 10000) accountStatusCache.clear();
    accountStatusCache.set(cacheKey, { status, expires: Date.now() + ACCOUNT_STATUS_TTL_MS });
    return checkSessionAge(status, user);
}

// A login issued before the password last changed no longer counts. Accounts whose password has
// not changed since this check was added have no date, so their sessions carry on.
function checkSessionAge(status, user) {
    const changed = Number(status.password_changed_ts);
    if (status.ok && changed > 0 && Number(user.iat) > 0 && Number(user.iat) < changed) {
        return { ok: false, message: 'Your password was changed. Please log in again.' };
    }
    return status;
}

// Ends every session of an account: after this, tokens issued earlier and refresh tokens are dead.
async function endSessions(db, accountType, id) {
    const rider = accountType === 'rider';
    await db.execute(`UPDATE ${rider ? 'riders' : 'users'} SET password_changed_at = NOW() WHERE id = ?`, [id]);
    await db.execute(
        `UPDATE refresh_tokens SET revoked_at = NOW()
          WHERE user_id = ? AND revoked_at IS NULL AND user_type ${rider ? "= 'rider'" : "<> 'rider'"}`,
        [id]
    );
    for (const type of rider ? ['rider'] : ['customer', 'store_owner', 'admin', 'standard_user']) {
        forgetAccountStatus(type, id);
    }
}

// Drop the cached status so a change to an account (its branch, or being switched off) applies at once.
function clearAccountStatusCache() {
    accountStatusCache.clear();
}

function forgetAccountStatus(userType, id) {
    accountStatusCache.delete(`${userType}:${id}`);
}

// Only the owner account. The email is read from the database. Everyone else, other admins
// included, gets the same answer as for an address that does not exist.
const requireOwner = [authenticateToken, async (req, res, next) => {
    const notFound = () => res.status(404).json({ success: false, message: 'Not found' });
    if (req.user.user_type !== 'admin') return notFound();
    try {
        const [rows] = await req.db.execute(
            'SELECT email, user_type, is_active, branch_id FROM users WHERE id = ? LIMIT 1',
            [req.user.id]
        );
        const u = rows[0];
        if (!u || u.user_type !== 'admin' || !u.is_active || toBranchId(u.branch_id) !== null || !isOwnerEmail(u.email)) {
            return notFound();
        }
        next();
    } catch (error) {
        console.error('Owner check failed:', error);
        return notFound();
    }
}];

// Middleware to check if user is admin
const requireAdmin = (req, res, next) => {
    if (req.user.user_type !== 'admin') {
        return res.status(403).json({
            success: false,
            message: 'Admin access required'
        });
    }
    next();
};

// Middleware to check if user is store owner or admin
const requireStoreOwner = (req, res, next) => {
    if (req.user.user_type !== 'store_owner' && req.user.user_type !== 'admin') {
        return res.status(403).json({
            success: false,
            message: 'Store owner or admin access required'
        });
    }
    next();
};

// Middleware for Standard User (Product Entry & Dispatch)
// Allows: Admin, Store Owner, Standard User
const requireStaffAccess = (req, res, next) => {
    const allowed = ['admin', 'store_owner', 'standard_user'];
    if (!allowed.includes(req.user.user_type)) {
        return res.status(403).json({
            success: false,
            message: 'Staff access required'
        });
    }
    next();
};

// Middleware for Dispatch/Rider Assignment
// Allows: Admin, Standard User
const requireDispatchAccess = (req, res, next) => {
    const allowed = ['admin', 'standard_user'];
    if (!allowed.includes(req.user.user_type)) {
        return res.status(403).json({
            success: false,
            message: 'Dispatch access required'
        });
    }
    next();
};

// Optional authentication - doesn't fail if no token
const optionalAuth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
        jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
            if (!err) {
                // optionalAuth does not look the account up, so it cannot know the branch.
                // Treat the caller as having none; branch accounts are stopped by branchGuard.
                user.branch_id = null;
                req.user = user;
            }
            next();
        });
    } else {
        next();
    }
};

// Looks the caller up when a valid token is sent, but never refuses the request. For public
// routes that show a bit more (or less) to a logged-in account, e.g. the branch of a customer.
// A bad token, an inactive account or a failed lookup simply means "not logged in".
const softAuth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.split(' ')[1]) || req.headers['x-access-token'];
    if (!token) return next();
    jwt.verify(token, process.env.JWT_SECRET, async (err, user) => {
        if (err) return next();
        try {
            const status = await getAccountStatus(req.db, user);
            if (status.ok) {
                user.branch_id = status.branch_id === undefined ? null : status.branch_id;
                req.user = user;
            }
        } catch (_) { /* treated as not logged in */ }
        next();
    });
};

// Middleware factory for permission checking
const requirePermission = (permissionKey) => {
    return async (req, res, next) => {
        // Admins bypass all checks
        if (req.user.user_type === 'admin') {
            return next();
        }

        // Permissions are only granted to standard users (also blocks rider id collisions)
        if (req.user.user_type !== 'standard_user') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Missing permission: ' + permissionKey
            });
        }

        // Check if DB is available (it should be via server.js middleware)
        if (!req.db) {
            console.error('Database connection missing in request');
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        
        try {
            const [rows] = await req.db.execute(
                'SELECT 1 FROM user_permissions WHERE user_id = ? AND permission_key = ?',
                [req.user.id, permissionKey]
            );
            
            if (rows.length > 0) {
                return next();
            }
            
            return res.status(403).json({
                success: false,
                message: 'Access denied. Missing permission: ' + permissionKey
            });
        } catch (error) {
            console.error('Permission check failed:', error);
            return res.status(500).json({ success: false, message: 'Permission check failed' });
        }
    };
};

async function staffHasRight(db, userId, keys) {
    const list = [].concat(keys);
    const [rows] = await db.execute(
        `SELECT 1 FROM user_permissions WHERE user_id = ? AND permission_key IN (${list.map(() => '?').join(',')}) LIMIT 1`,
        [userId, ...list]
    );
    return rows.length > 0;
}

// Staff logins must hold the right. Admins pass, and other account types fall
// through to the route's own ownership checks (a rider on their order, a store
// owner on their products).
const requireStaffRight = (keys) => async (req, res, next) => {
    if (req.user.user_type !== 'standard_user') return next();
    try {
        if (await staffHasRight(req.db, req.user.id, keys)) return next();
    } catch (e) {
        console.error('Permission check error:', e);
        return res.status(500).json({ success: false, message: 'Permission check failed' });
    }
    return res.status(403).json({ success: false, message: 'You do not have the right to do this' });
};

module.exports = {
    getAccountStatus,
    forgetAccountStatus,
    clearAccountStatusCache,
    endSessions,
    requireOwner,
    staffHasRight,
    requireStaffRight,
    authenticateToken,
    requireAdmin,
    requireStoreOwner,
    requireStaffAccess,
    requireDispatchAccess,
    optionalAuth,
    softAuth,
    requirePermission
};
