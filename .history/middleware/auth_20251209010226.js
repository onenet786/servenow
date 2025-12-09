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
    // Check query parameter as last resort (useful for quick curl/debugging)
    if (!token && req.query && req.query.token) {
        token = req.query.token;
        tokenSource = 'query.token';
    }

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

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            if (process.env.NODE_ENV === 'development') {
                console.error('[auth] JWT verify error:', err && err.message ? err.message : err);
            }
            return res.status(403).json({
                success: false,
                message: 'Invalid or expired token'
            });
        }
        req.user = user;
        next();
    });
};

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

module.exports = {
    authenticateToken,
    requireAdmin,
    requireStoreOwner,
    optionalAuth
};
