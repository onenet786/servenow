# ServeNow Utilities Integration Guide

This guide demonstrates how to use the new utilities created for standardized responses, validation, and configuration management.

---

## Quick Reference

### Response Utilities (`utils/response.js`)
Standardized response helpers for consistent API responses.

**Usage in routes:**
```javascript
const { sendSuccess, sendError, sendValidationError, sendUnauthorized, sendNotFound } = require('../utils/response');

// Success responses
router.get('/products/:id', async (req, res) => {
    try {
        const [products] = await req.db.execute('SELECT * FROM products WHERE id = ?', [req.params.id]);
        if (!products.length) {
            return sendNotFound(res, 'Product not found');
        }
        return sendSuccess(res, { product: products[0] }, 'Product retrieved');
    } catch (error) {
        return sendServerError(res, error);
    }
});
```

**Available Functions:**
- `sendSuccess(res, data, message, statusCode)` - Success response (200)
- `sendError(res, message, statusCode, errors)` - Generic error
- `sendValidationError(res, errors)` - Validation errors (400)
- `sendUnauthorized(res, message)` - Auth errors (401)
- `sendForbidden(res, message)` - Permission errors (403)
- `sendNotFound(res, message)` - Not found (404)
- `sendServerError(res, error)` - Server errors (500)

---

### Validators (`utils/validators.js`)
Reusable validation schemas with consistent error messages.

**Usage Pattern:**
```javascript
const { userValidators, productValidators, validateRequest } = require('../utils/validators');
const { sendValidationError } = require('../utils/response');

// Use predefined validators
router.post('/register', userValidators.register, validateRequest, async (req, res) => {
    // Validation passed, proceed with business logic
});

// Or use inline and validate manually
router.post('/custom', [
    body('name').notEmpty().withMessage('Name required')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return sendValidationError(res, errors);
    }
    // Proceed
});
```

**Available Validators:**
- `userValidators.register` - Register endpoint validation
- `userValidators.login` - Login endpoint validation
- `userValidators.update` - User update validation
- `storeValidators.create` - Store creation validation
- `storeValidators.update` - Store update validation
- `productValidators.create` - Product creation validation
- `productValidators.update` - Product update validation
- `orderValidators.create` - Order creation validation

---

### Environment Configuration (`config/environment.js`)
Multi-environment configuration management.

**Usage:**
```javascript
const { getConfig, isDevelopment, isProduction, validateRequiredEnv } = require('./config/environment');

// Validate required environment variables on startup
try {
    validateRequiredEnv();
} catch (error) {
    console.error('Configuration error:', error.message);
    process.exit(1);
}

// Get current environment config
const config = getConfig();
console.log(`Running in ${config.app.env} mode`);
console.log(`Database pool size: ${config.database.connectionLimit}`);
console.log(`JWT expires in: ${config.security.jwtExpire}`);
```

**Configuration Levels:**
- **Development**: Permissive CORS, debug logging, small pool (5 connections)
- **Production**: Restricted CORS, optimized pool (20 connections), HSTS enabled
- **Test**: Isolated config, test database, error-only logging

---

## Migration Examples

### Before (Inconsistent Error Handling)
```javascript
router.post('/login', async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }
        // ... business logic ...
        res.status(200).json({
            success: true,
            message: 'Login successful',
            token,
            user: { ... }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Login failed',
            error: error.message
        });
    }
});
```

### After (Standardized with Utilities)
```javascript
const { sendSuccess, sendValidationError, sendServerError } = require('../utils/response');
const { userValidators, validateRequest } = require('../utils/validators');

router.post('/login', userValidators.login, validateRequest, async (req, res) => {
    try {
        // ... business logic ...
        return sendSuccess(res, { token, user: { ... } }, 'Login successful');
    } catch (error) {
        return sendServerError(res, error);
    }
});
```

**Benefits:**
- ✅ 10 fewer lines of code per route
- ✅ Consistent response format
- ✅ Centralized validation rules
- ✅ Automatic error messages

---

## Production Deployment Checklist

### Environment Variables
```bash
# Required for production
NODE_ENV=production
JWT_SECRET=<strong-unique-secret>
DB_HOST=<prod-db-host>
DB_USER=<prod-db-user>
DB_PASSWORD=<secure-password>
DB_NAME=servenow
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
PORT=3002
```

### Security Settings
✅ CORS restricted to whitelisted origins  
✅ Rate limiting enabled (100 req/15min general, 5 login attempts)  
✅ Security headers configured (8 headers)  
✅ Database connection pooling (20 connections)  
✅ Request logging enabled (Morgan)  
✅ JWT_SECRET is strong and unique  

### Application Startup
```bash
npm install  # Install dependencies including morgan & express-rate-limit
npm start    # Start production server
```

---

## Rate Limiting

**Default Configuration:**
- **General API**: 100 requests per 15 minutes per IP
- **Authentication**: 5 login/register attempts per 15 minutes per IP
- **Behavior**: Failed attempts counted separately (skipSuccessfulRequests)

**Customize in server.js:**
```javascript
const limiter = rateLimit({
    windowMs: 10 * 60 * 1000,  // 10 minutes instead of 15
    max: 200,                    // Increase to 200 requests
    // ... other options
});
```

---

## Request Logging

**Development Mode:**
```
GET /api/products 200 12.345 ms - 1234
POST /api/auth/login 401 45.678 ms - 456
```

**Production Mode:**
```
::1 - admin@servenow.com [25/Dec/2025:02:30:45 +0500] "POST /api/auth/login HTTP/1.1" 200 1234 "-" "Mozilla/5.0..."
```

**Log Output:**
- Development: Console (colored)
- Production: Standard combined log format (suitable for log aggregation)

---

## Route Migration Priority

### Phase 1 (Critical - Week 1)
- [ ] Auth routes (/api/auth)
- [ ] Product routes (/api/products)
- [ ] Order routes (/api/orders)

**Why**: Most frequently used, highest traffic, auth is security-critical

### Phase 2 (Important - Week 2)
- [ ] User routes (/api/users)
- [ ] Store routes (/api/stores)
- [ ] Category routes (/api/categories)

**Why**: Supporting functionality, moderate traffic

### Phase 3 (Nice-to-have - Week 3)
- [ ] Rider routes (/api/riders)
- [ ] Admin routes (/api/admin)
- [ ] Utility routes (/api/units, /api/sizes)

**Why**: Less frequently used, lower impact

---

## Testing Utilities

### Test Rate Limiting
```bash
# Should succeed (within limit)
curl http://localhost:3002/api/products

# Should get rate limited after 5 attempts
for i in {1..10}; do curl http://localhost:3002/api/auth/login -X POST; done
```

### Test Request Logging
```bash
# Check console output in development
# Check log files in production
npm start 2>&1 | grep Morgan
```

### Test Response Format
```bash
# Successful response
curl http://localhost:3002/api/products
# Output: { "success": true, "data": [...], "message": "..." }

# Error response
curl http://localhost:3002/api/products/9999
# Output: { "success": false, "message": "Resource not found" }
```

---

## Troubleshooting

### Issue: Rate limiting too strict
**Solution**: Increase `max` in server.js limiter config

### Issue: Morgan not showing logs
**Solution**: Check NODE_ENV is set correctly
```bash
export NODE_ENV=development  # Linux/Mac
set NODE_ENV=development     # Windows
```

### Issue: Validation errors not showing
**Solution**: Ensure validateRequest middleware is used
```javascript
router.post('/endpoint', validators.create, validateRequest, handler);
```

### Issue: CORS errors in production
**Solution**: Check ALLOWED_ORIGINS environment variable
```bash
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

---

## Example: Complete Route Migration

**Before (Inline everything):**
```javascript
router.post('/create', [
    body('name').notEmpty(),
    body('email').isEmail()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Invalid input',
            errors: errors.array()
        });
    }
    try {
        const result = await req.db.execute(...);
        res.json({
            success: true,
            message: 'Created',
            id: result.insertId
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error', error: err.message });
    }
});
```

**After (Using utilities):**
```javascript
const { sendSuccess, sendValidationError, sendServerError } = require('../utils/response');
const { userValidators, validateRequest } = require('../utils/validators');

router.post('/create', userValidators.register, validateRequest, async (req, res) => {
    try {
        const result = await req.db.execute(...);
        return sendSuccess(res, { id: result.insertId }, 'Created', 201);
    } catch (err) {
        return sendServerError(res, err);
    }
});
```

**Result:**
- 15 lines → 10 lines
- Consistent with all other routes
- Centralized validation
- Automatic error handling

---

## Next Steps

1. ✅ Understand the utilities (this guide)
2. ✅ Ensure dependencies installed: `npm install`
3. 🔄 Migrate auth routes (highest priority)
4. 🔄 Migrate remaining routes (per priority list)
5. ✅ Test thoroughly in development
6. 🚀 Deploy to production with NODE_ENV=production

---

## Support

For issues or questions:
- Check this guide's Troubleshooting section
- Review OPTIMIZATION_SUMMARY.md
- Check .env.example for configuration help

**Last Updated**: 2025-12-25
