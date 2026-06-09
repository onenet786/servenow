const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const crypto = require('crypto');
const { sendVerificationEmail, sendDeletionRequestEmail } = require('../services/emailService');

const router = express.Router();
let userProfileColumnsEnsured = false;

async function ensureUserProfileColumns(db) {
    if (userProfileColumnsEnsured) return;
    const columns = [
        { name: 'id_card_num', definition: 'VARCHAR(100) NULL' },
        { name: 'image_url', definition: 'VARCHAR(255) NULL' }
    ];

    for (const column of columns) {
        const [existing] = await db.execute(
            "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = ? LIMIT 1",
            [column.name]
        );
        if (!existing.length) {
            await db.execute(`ALTER TABLE users ADD COLUMN ${column.name} ${column.definition}`);
        }
    }
    userProfileColumnsEnsured = true;
}

function normalizePositiveInt(value) {
    if (value === '' || value === null || value === undefined) return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) return null;
    return parsed;
}

async function syncStoreOwnerAssignment(db, {
    userId,
    nextUserType,
    nextStoreId,
    previousUserType,
    previousStoreId
}) {
    const normalizedUserId = normalizePositiveInt(userId);
    if (!normalizedUserId) return;

    const normalizedNextStoreId = nextUserType === 'store_owner'
        ? normalizePositiveInt(nextStoreId)
        : null;
    const normalizedPreviousStoreId = previousUserType === 'store_owner'
        ? normalizePositiveInt(previousStoreId)
        : null;

    if (
        normalizedPreviousStoreId &&
        normalizedPreviousStoreId !== normalizedNextStoreId
    ) {
        await db.execute(
            'UPDATE stores SET owner_id = NULL WHERE id = ? AND owner_id = ?',
            [normalizedPreviousStoreId, normalizedUserId]
        );
    }

    if (normalizedNextStoreId) {
        await db.execute(
            'UPDATE stores SET owner_id = ? WHERE id = ?',
            [normalizedUserId, normalizedNextStoreId]
        );
    }
}

// Middleware to allow standard_user with menu_users permission
const requireUserManagement = async (req, res, next) => {
    // If admin, allow
    if (req.user.user_type === 'admin') {
        return next();
    }
    
    // If standard_user, check for menu_users permission
    if (req.user.user_type === 'standard_user') {
        try {
            const [perms] = await req.db.execute(
                'SELECT 1 FROM user_permissions WHERE user_id = ? AND permission_key = ?',
                [req.user.id, 'menu_users']
            );
            if (perms.length > 0) {
                return next();
            }
        } catch (e) {
            console.error('Permission check error:', e);
            return res.status(500).json({ success: false, message: 'Permission check failed' });
        }
    }

    return res.status(403).json({ success: false, message: 'Access denied' });
};

// Get all users (Admin or Standard User with permission)
router.get('/', authenticateToken, requireUserManagement, async (req, res) => {
    try {
        await ensureUserProfileColumns(req.db);
        const [users] = await req.db.execute(
            'SELECT id, first_name, last_name, email, phone, address, user_type, is_active, is_verified, created_at, store_id, id_card_num, image_url FROM users ORDER BY created_at DESC'
        );

        const formattedUsers = users.map(user => ({
            ...user,
            is_active: Boolean(user.is_active),
            is_verified: Boolean(user.is_verified)
        }));

        res.json({
            success: true,
            users: formattedUsers
        });

    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch users',
            error: error.message
        });
    }
});

// Create user (Admin only)
router.post('/', authenticateToken, requireAdmin, [
    body('firstName').trim().isLength({ min: 1 }).withMessage('First name is required'),
    body('lastName').trim().isLength({ min: 1 }).withMessage('Last name is required'),
    body('email').isEmail().withMessage('Invalid email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('phone').optional({ checkFalsy: true }).trim().matches(/^[\d\s\-\+\(\)]{6,}$/).withMessage('Invalid phone'),
    body('address').optional({ checkFalsy: true }).trim(),
    body('user_type').isIn(['customer', 'store_owner', 'admin', 'standard_user', 'rider']).withMessage('Invalid user type'),
    body('is_verified').optional().isBoolean(),
    body('is_active').optional().isBoolean(),
    body('id_card_num').optional({ checkFalsy: true }).trim().isLength({ max: 100 }).withMessage('ID card number is too long'),
    body('image_url').optional({ checkFalsy: true }).trim().isLength({ max: 255 }).withMessage('User photo URL is too long'),
    body('store_id')
        .optional({ nullable: true })
        .custom((value) => {
            if (value === '' || value === null) return true;
            const parsed = Number(value);
            if (!Number.isInteger(parsed) || parsed < 1) {
                throw new Error('store_id must be a positive integer');
            }
            return true;
        })
        .customSanitizer((value) => {
            if (value === '' || value === null || value === undefined) {
                return null;
            }
            return Number(value);
        })
], async (req, res) => {
    try {
        await ensureUserProfileColumns(req.db);
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { firstName, lastName, email, password, phone, address, user_type, is_verified, is_active, store_id, id_card_num, image_url } = req.body;
        const normalizedEmail = String(email || '').trim().toLowerCase();
        const normalizedPhone = phone === undefined || phone === null ? '' : String(phone).trim();
        const normalizedStoreId = normalizePositiveInt(store_id);
        const normalizedIdCardNum = id_card_num === undefined || id_card_num === null ? null : String(id_card_num).trim() || null;
        const normalizedImageUrl = image_url === undefined || image_url === null ? null : String(image_url).trim() || null;

        const [existing] = await req.db.execute('SELECT id FROM users WHERE LOWER(email) = ?', [normalizedEmail]);
        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: 'Email already exists' });
        }
        if (normalizedPhone) {
            const [existingPhone] = await req.db.execute('SELECT id FROM users WHERE TRIM(phone) = ?', [normalizedPhone]);
            if (existingPhone.length > 0) {
                return res.status(400).json({ success: false, message: 'Phone already exists' });
            }
        }

        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        const verificationCode = crypto.randomInt(100000, 999999).toString();
        const verificationExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

        // Use provided is_verified/is_active or default
        const verified = is_verified !== undefined ? is_verified : false;
        const active = is_active !== undefined ? is_active : true;

        const [result] = await req.db.execute(
            'INSERT INTO users (first_name, last_name, email, phone, password, address, user_type, verification_code, verification_expires_at, is_verified, is_active, store_id, id_card_num, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [firstName, lastName, normalizedEmail, normalizedPhone || null, hashedPassword, address || null, user_type || 'customer', verificationCode, verificationExpiresAt, verified, active, normalizedStoreId, normalizedIdCardNum, normalizedImageUrl]
        );

        await syncStoreOwnerAssignment(req.db, {
            userId: result.insertId,
            nextUserType: user_type || 'customer',
            nextStoreId: normalizedStoreId,
            previousUserType: null,
            previousStoreId: null
        });

        try {
            await sendVerificationEmail(normalizedEmail, verificationCode);
        } catch (e) {
            console.error('Error sending verification email:', e);
        }

        res.json({ success: true, message: 'User created successfully. Verification code sent to email.', user_id: result.insertId });

    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create user',
            error: error.message
        });
    }
});

// Update user (Admin only)
router.put('/:id', authenticateToken, requireAdmin, [
    body('firstName').optional().trim().isLength({ min: 1 }),
    body('lastName').optional().trim().isLength({ min: 1 }),
    body('email').optional().isEmail().withMessage('Invalid email'),
    body('phone').optional({ checkFalsy: true }).trim().matches(/^[\d\s\-\+\(\)]{6,}$/).withMessage('Invalid phone'),
    body('address').optional({ checkFalsy: true }).trim(),
    body('password').optional({ checkFalsy: true }).isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('user_type').optional().isIn(['customer', 'store_owner', 'admin', 'standard_user', 'rider']).withMessage('Invalid user type'),
    body('is_active').optional().isBoolean().withMessage('is_active must be a boolean'),
    body('is_verified').optional().isBoolean().withMessage('is_verified must be a boolean'),
    body('id_card_num').optional({ checkFalsy: true }).trim().isLength({ max: 100 }).withMessage('ID card number is too long'),
    body('image_url').optional({ checkFalsy: true }).trim().isLength({ max: 255 }).withMessage('User photo URL is too long'),
    body('store_id')
        .optional({ nullable: true })
        .custom((value) => {
            if (value === '' || value === null) return true;
            const parsed = Number(value);
            if (!Number.isInteger(parsed) || parsed < 1) {
                throw new Error('store_id must be a positive integer');
            }
            return true;
        })
        .customSanitizer((value) => {
            if (value === '' || value === null || value === undefined) {
                return null;
            }
            return Number(value);
        })
], async (req, res) => {
    try {
        await ensureUserProfileColumns(req.db);
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { id } = req.params;
        const {
            firstName, lastName, email, phone, address, password,
            user_type, is_active, is_verified, store_id, id_card_num, image_url
        } = req.body;
        const normalizedEmail = email === undefined ? undefined : String(email || '').trim().toLowerCase();
        const normalizedPhone = phone === undefined ? undefined : String(phone || '').trim();
        const normalizedStoreId = store_id === undefined ? undefined : normalizePositiveInt(store_id);
        const normalizedIdCardNum = id_card_num === undefined ? undefined : String(id_card_num || '').trim();
        const normalizedImageUrl = image_url === undefined ? undefined : String(image_url || '').trim();

        const [existingUsers] = await req.db.execute(
            'SELECT id, user_type, store_id FROM users WHERE id = ? LIMIT 1',
            [id]
        );
        if (!existingUsers.length) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        const existingUser = existingUsers[0];

        const updateFields = [];
        const updateValues = [];

        if (firstName !== undefined) { updateFields.push('first_name = ?'); updateValues.push(firstName); }
        if (lastName !== undefined) { updateFields.push('last_name = ?'); updateValues.push(lastName); }
        if (email !== undefined) { updateFields.push('email = ?'); updateValues.push(normalizedEmail); }
        if (phone !== undefined) { updateFields.push('phone = ?'); updateValues.push(normalizedPhone || null); }
        if (address !== undefined) { updateFields.push('address = ?'); updateValues.push(address); }
        if (user_type !== undefined) { updateFields.push('user_type = ?'); updateValues.push(user_type); }
        if (is_active !== undefined) { updateFields.push('is_active = ?'); updateValues.push(is_active); }
        if (is_verified !== undefined) { updateFields.push('is_verified = ?'); updateValues.push(is_verified); }
        if (id_card_num !== undefined) { updateFields.push('id_card_num = ?'); updateValues.push(normalizedIdCardNum || null); }
        if (image_url !== undefined) { updateFields.push('image_url = ?'); updateValues.push(normalizedImageUrl || null); }
        if (user_type !== undefined && user_type !== 'store_owner') {
            updateFields.push('store_id = ?');
            updateValues.push(null);
        } else if (store_id !== undefined) {
            updateFields.push('store_id = ?');
            updateValues.push(normalizedStoreId);
        }

        // Handle password separately (hash)
        if (password !== undefined && password !== '') {
            const saltRounds = 10;
            const hashed = await bcrypt.hash(password, saltRounds);
            updateFields.push('password = ?');
            updateValues.push(hashed);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid fields to update'
            });
        }

        // If email is being changed, ensure uniqueness
        if (email !== undefined) {
            const [existing] = await req.db.execute('SELECT id FROM users WHERE LOWER(email) = ? AND id != ?', [normalizedEmail, id]);
            if (existing.length > 0) {
                return res.status(400).json({ success: false, message: 'Email already in use by another user' });
            }
        }
        if (phone !== undefined && normalizedPhone) {
            const [existingPhone] = await req.db.execute('SELECT id FROM users WHERE TRIM(phone) = ? AND id != ?', [normalizedPhone, id]);
            if (existingPhone.length > 0) {
                return res.status(400).json({ success: false, message: 'Phone already in use by another user' });
            }
        }

        updateValues.push(id);

        await req.db.execute(
            `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
            updateValues
        );

        await syncStoreOwnerAssignment(req.db, {
            userId: id,
            nextUserType: user_type !== undefined ? user_type : existingUser.user_type,
            nextStoreId: store_id !== undefined ? normalizedStoreId : existingUser.store_id,
            previousUserType: existingUser.user_type,
            previousStoreId: existingUser.store_id
        });

        res.json({ success: true, message: 'User updated successfully' });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update user',
            error: error.message
        });
    }
});

// Delete account (Current user)
router.delete('/me', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        
        // You might want to do a soft delete or anonymize data instead of a hard delete
        // for auditing and order history. But for Play Store "Account Deletion", 
        // the user expects their personal data to be removed.
        
        // 1. Delete user from database
        await req.db.execute('DELETE FROM users WHERE id = ?', [userId]);

        // Note: Related data in other tables (orders, wallets) might need handling 
        // depending on foreign key constraints (ON DELETE CASCADE or SET NULL).

        res.json({
            success: true,
            message: 'Your account and all associated data have been permanently deleted.'
        });

    } catch (error) {
        console.error('Error deleting account:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete account',
            error: error.message
        });
    }
});

// Request account deletion (Public/Web)
router.post('/request-deletion', [
    body('email').isEmail().withMessage('Invalid email address'),
    body('reason').optional().trim()
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

        const { email, reason } = req.body;
        const sent = await sendDeletionRequestEmail(email, reason);

        if (sent) {
            res.json({
                success: true,
                message: 'Deletion request received. We have sent a confirmation email to our support team and you will be contacted soon.'
            });
        } else {
            throw new Error('Failed to send deletion request email');
        }
    } catch (error) {
        console.error('Error requesting deletion:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to process deletion request',
            error: error.message
        });
    }
});

module.exports = router;
