const jwt = require('jsonwebtoken');

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
        try {
            const status = await getAccountStatus(req.db, user);
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

        req.user = user;
        next();
    });
};

// Short-lived cache so the status check doesn't hit the DB on every request.
const ACCOUNT_STATUS_TTL_MS = 60 * 1000;
const accountStatusCache = new Map();

async function getAccountStatus(db, user) {
    if (user.user_type === 'guest' || user.is_guest) {
        return { ok: true };
    }
    if (!db) {
        throw new Error('Database connection missing in request');
    }

    const cacheKey = `${user.user_type}:${user.id}`;
    const cached = accountStatusCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
        return cached.status;
    }

    let status;
    if (user.user_type === 'rider') {
        const [rows] = await db.execute('SELECT is_active FROM riders WHERE id = ?', [user.id]);
        if (!rows.length || !rows[0].is_active) {
            status = { ok: false, message: 'Account is inactive or no longer exists. Please log in again.' };
        } else {
            status = { ok: true };
        }
    } else {
        const [rows] = await db.execute('SELECT is_active, user_type FROM users WHERE id = ?', [user.id]);
        if (!rows.length || rows[0].is_active === 0 || rows[0].is_active === false) {
            status = { ok: false, message: 'Account is inactive or no longer exists. Please log in again.' };
        } else if (rows[0].user_type !== user.user_type) {
            status = { ok: false, message: 'Your account role has changed. Please log in again.' };
        } else {
            status = { ok: true };
        }
    }

    if (accountStatusCache.size > 10000) accountStatusCache.clear();
    accountStatusCache.set(cacheKey, { status, expires: Date.now() + ACCOUNT_STATUS_TTL_MS });
    return status;
}

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
                req.user = user;
            }
            next();
        });
    } else {
        next();
    }
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

module.exports = {
    authenticateToken,
    requireAdmin,
    requireStoreOwner,
    requireStaffAccess,
    requireDispatchAccess,
    optionalAuth,
    requirePermission
};
