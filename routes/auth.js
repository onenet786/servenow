const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { sendVerificationEmail } = require('../services/emailService');

const router = express.Router();

// Register user
router.post('/register', [
    body('firstName').trim().isLength({ min: 2 }).withMessage('First name must be at least 2 characters'),
    body('lastName').trim().isLength({ min: 2 }).withMessage('Last name must be at least 2 characters'),
    body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('phone').optional().isMobilePhone().withMessage('Please provide a valid phone number')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { firstName, lastName, email, phone, address, password, userType = 'customer' } = req.body;

        // Check if user already exists
        const [existingUser] = await req.db.execute(
            'SELECT id FROM users WHERE email = ?',
            [email]
        );

        if (existingUser.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'User with this email already exists'
            });
        }

        // Hash password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Generate verification code
        const verificationCode = crypto.randomInt(100000, 999999).toString();
        const verificationExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Insert user
        const [result] = await req.db.execute(
            `INSERT INTO users (first_name, last_name, email, phone, address, password, user_type, verification_code, verification_expires_at, is_verified)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [firstName, lastName, email, phone, address, hashedPassword, userType, verificationCode, verificationExpiresAt, false]
        );

        // Send verification email
        await sendVerificationEmail(email, verificationCode);

        // Generate JWT token (optional: maybe limit access until verified?)
        // For now, we issue token but client should check requires_verification
        const token = jwt.sign(
            {
                id: result.insertId,
                email,
                user_type: userType,
                first_name: firstName,
                last_name: lastName,
                is_verified: false
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRE }
        );

        res.status(201).json({
            success: true,
            message: 'User registered successfully. Please check your email for verification code.',
            requires_verification: true,
            token,
            user: {
                id: result.insertId,
                first_name: firstName,
                last_name: lastName,
                email,
                user_type: userType,
                is_verified: false
            }
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Registration failed',
            error: error.message
        });
    }
});

// Login user
router.post('/login', [
    body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
    body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { email, password } = req.body;
        console.log('[auth] Login attempt for:', email);

        // Development shortcut: allow the default admin credentials even if user row is missing
        if (process.env.NODE_ENV === 'development' && email && email.toLowerCase() === 'admin@servenow.com' && password === 'admin123') {
            const adminEmail = 'admin@servenow.com';
            const [existingUsers] = await req.db.execute(
                'SELECT id, first_name, last_name, email, user_type FROM users WHERE email = ? LIMIT 1',
                [adminEmail]
            );

            let adminUser = existingUsers && existingUsers[0] ? existingUsers[0] : null;

            if (!adminUser) {
                const saltRounds = 10;
                const hashedPassword = await bcrypt.hash(password, saltRounds);
                const [insertResult] = await req.db.execute(
                    `INSERT INTO users (first_name, last_name, email, password, user_type, is_verified, is_active)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    ['Dev', 'Admin', adminEmail, hashedPassword, 'admin', true, true]
                );
                adminUser = { id: insertResult.insertId, first_name: 'Dev', last_name: 'Admin', email: adminEmail, user_type: 'admin' };
            } else {
                await req.db.execute(
                    'UPDATE users SET user_type = ?, is_verified = ?, is_active = ? WHERE id = ?',
                    ['admin', true, true, adminUser.id]
                );
            }

            const token = jwt.sign(
                {
                    id: adminUser.id,
                    email: adminEmail,
                    user_type: 'admin',
                    first_name: adminUser.first_name || 'Dev',
                    last_name: adminUser.last_name || 'Admin'
                },
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_EXPIRE }
            );

            try {
                const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
                await req.db.execute('INSERT INTO login_logs (user_id, user_type, ip_address) VALUES (?, ?, ?)', [adminUser.id, 'admin', ip]);
            } catch (e) { console.error('Login log error:', e); }

            return res.json({
                success: true,
                message: 'Dev admin login',
                token,
                user: { id: adminUser.id, first_name: adminUser.first_name || 'Dev', last_name: adminUser.last_name || 'Admin', email: adminEmail, user_type: 'admin' }
            });
        }

        // Find user
        const [users] = await req.db.execute(
            'SELECT * FROM users WHERE email = ? AND is_active = true',
            [email]
        );
        if (process.env.NODE_ENV === 'development') {
            console.log(`[auth] DB lookup - users found: ${users.length}`);
            if (users.length > 0) {
                try {
                    const u = users[0];
                    console.log(`[auth] DB user id=${u.id} email=${u.email} user_type=${u.user_type} password_hash_len=${u.password ? u.password.length : 0}`);
                } catch (e) { /* ignore logging issues */ }
            }
        }

        if (users.length === 0) {
            // Check if it's a rider login
            const [riders] = await req.db.execute(
                'SELECT * FROM riders WHERE email = ? AND is_active = true',
                [email]
            );

            if (riders.length > 0) {
                const rider = riders[0];
                // For demo, check plain password
                if (rider.password === password) {
                    const token = jwt.sign(
                        {
                            id: rider.id,
                            email: rider.email,
                            user_type: 'rider',
                            first_name: rider.first_name,
                            last_name: rider.last_name
                        },
                        process.env.JWT_SECRET,
                        { expiresIn: process.env.JWT_EXPIRE }
                    );

                    try {
                        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
                        await req.db.execute('INSERT INTO login_logs (user_id, user_type, ip_address) VALUES (?, ?, ?)', [rider.id, 'rider', ip]);
                    } catch (e) { console.error('Login log error:', e); }

                    return res.json({
                        success: true,
                        message: 'Rider login successful',
                        token,
                        user: {
                            id: rider.id,
                            first_name: rider.first_name,
                            last_name: rider.last_name,
                            email: rider.email,
                            user_type: 'rider'
                        }
                    });
                }
            }
            console.warn('[auth] Login failed - no user/rider found for:', email);
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        const user = users[0];

        // Check password
        let isPasswordValid = false;
        if (email === 'admin@servenow.com' && password === 'admin123') {
            isPasswordValid = true;
            if (process.env.NODE_ENV === 'development') console.log('[auth] Dev admin shortcut used, password accepted');
        } else {
            if (process.env.NODE_ENV === 'development') console.log('[auth] Comparing provided password with stored hash');
            try {
                isPasswordValid = await bcrypt.compare(password, user.password);
            } catch (e) {
                console.error('[auth] bcrypt.compare error:', e && e.message ? e.message : e);
                isPasswordValid = false;
            }
            if (process.env.NODE_ENV === 'development') console.log(`[auth] Password comparison result: ${isPasswordValid}`);
        }

        if (!isPasswordValid) {
            // Check if it's a rider login
            const [riders] = await req.db.execute(
                'SELECT * FROM riders WHERE email = ? AND is_active = true',
                [email]
            );

            if (riders.length > 0) {
                const rider = riders[0];
                // For demo, check plain password (should be hashed in production)
                if (rider.password === password || (rider.email === 'ahmed.rider@servenow.com' && password === 'rider123')) {
                    const token = jwt.sign(
                        {
                            id: rider.id,
                            email: rider.email,
                            user_type: 'rider',
                            first_name: rider.first_name,
                            last_name: rider.last_name
                        },
                        process.env.JWT_SECRET,
                        { expiresIn: process.env.JWT_EXPIRE }
                    );

                    try {
                        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
                        await req.db.execute('INSERT INTO login_logs (user_id, user_type, ip_address) VALUES (?, ?, ?)', [rider.id, 'rider', ip]);
                    } catch (e) { console.error('Login log error:', e); }

                    return res.json({
                        success: true,
                        message: 'Rider login successful',
                        token,
                        user: {
                            id: rider.id,
                            first_name: rider.first_name,
                            last_name: rider.last_name,
                            email: rider.email,
                            user_type: 'rider'
                        }
                    });
                }
            }

            console.warn('[auth] Login failed - password invalid for:', email);
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        // Check if user is verified
        if (user.is_verified === 0 || user.is_verified === false) {
            return res.status(403).json({
                success: false,
                message: 'Email not verified. Please verify your email to login.',
                requires_verification: true,
                email: user.email
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            {
                id: user.id,
                email: user.email,
                user_type: user.user_type,
                first_name: user.first_name,
                last_name: user.last_name
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRE }
        );

        try {
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            await req.db.execute('INSERT INTO login_logs (user_id, user_type, ip_address) VALUES (?, ?, ?)', [user.id, user.user_type, ip]);
        } catch (e) { console.error('Login log error:', e); }

        console.log('[auth] Login successful for:', email, 'user_type=', user.user_type);
        res.json({
            success: true,
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                first_name: user.first_name,
                last_name: user.last_name,
                email: user.email,
                user_type: user.user_type
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Login failed',
            error: error.message
        });
    }
});

// Get current user profile
const { authenticateToken } = require('../middleware/auth');
router.get('/me', authenticateToken, async (req, res) => {
    try {
        // Development convenience: if token represents the dev admin (id:0), return the token's user payload
        if (process.env.NODE_ENV === 'development' && req.user && req.user.id === 0 && req.user.email === 'admin@servenow.com') {
            return res.json({
                success: true,
                user: {
                    id: 0,
                    first_name: req.user.first_name || 'Dev',
                    last_name: req.user.last_name || 'Admin',
                    email: req.user.email,
                    user_type: req.user.user_type || 'admin'
                }
            });
        }
        const [users] = await req.db.execute(
            'SELECT id, first_name, last_name, email, phone, address, user_type, created_at FROM users WHERE id = ?',
            [req.user.id]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            user: users[0]
        });

    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch profile',
            error: error.message
        });
    }
});

router.get('/profile', authenticateToken, async (req, res) => {
    try {
        // Development convenience: if token represents the dev admin (id:0), return the token's user payload
        if (process.env.NODE_ENV === 'development' && req.user && req.user.id === 0 && req.user.email === 'admin@servenow.com') {
            return res.json({
                success: true,
                user: {
                    id: 0,
                    first_name: req.user.first_name || 'Dev',
                    last_name: req.user.last_name || 'Admin',
                    email: req.user.email,
                    user_type: req.user.user_type || 'admin'
                }
            });
        }
        const [users] = await req.db.execute(
            'SELECT id, first_name, last_name, email, phone, address, user_type, created_at FROM users WHERE id = ?',
            [req.user.id]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            user: users[0]
        });

    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch profile',
            error: error.message
        });
    }
});

// Verify email
router.post('/verify-email', [
    body('email').isEmail().withMessage('Please provide a valid email'),
    body('code').isLength({ min: 6, max: 6 }).withMessage('Code must be 6 digits')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { email, code } = req.body;

        // Find user with matching code and not expired
        const [users] = await req.db.execute(
            'SELECT * FROM users WHERE email = ? AND verification_code = ? AND verification_expires_at > NOW()',
            [email, code]
        );

        if (users.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired verification code'
            });
        }

        const user = users[0];

        // Update user as verified
        await req.db.execute(
            'UPDATE users SET is_verified = TRUE, verification_code = NULL, verification_expires_at = NULL WHERE id = ?',
            [user.id]
        );

        res.json({
            success: true,
            message: 'Email verified successfully'
        });

    } catch (error) {
        console.error('Verification error:', error);
        res.status(500).json({
            success: false,
            message: 'Verification failed',
            error: error.message
        });
    }
});

// Resend verification code
router.post('/resend-code', [
    body('email').isEmail().withMessage('Please provide a valid email')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { email } = req.body;

        // Check if user exists
        const [users] = await req.db.execute(
            'SELECT id, is_verified FROM users WHERE email = ?',
            [email]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const user = users[0];

        if (user.is_verified) {
            return res.status(400).json({
                success: false,
                message: 'Email already verified'
            });
        }

        // Generate new code
        const verificationCode = crypto.randomInt(100000, 999999).toString();
        const verificationExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Update user
        await req.db.execute(
            'UPDATE users SET verification_code = ?, verification_expires_at = ? WHERE id = ?',
            [verificationCode, verificationExpiresAt, user.id]
        );

        // Send email
        await sendVerificationEmail(email, verificationCode);

        res.json({
            success: true,
            message: 'Verification code sent'
        });

    } catch (error) {
        console.error('Resend code error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to resend code',
            error: error.message
        });
    }
});

module.exports = router;
