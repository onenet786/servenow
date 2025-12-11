const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get all users (Admin only)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [users] = await req.db.execute(
            'SELECT id, first_name, last_name, email, phone, address, user_type, is_active, created_at FROM users ORDER BY created_at DESC'
        );

        res.json({
            success: true,
            users
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

// Update user (Admin only)
router.put('/:id', authenticateToken, requireAdmin, [
    body('firstName').optional().trim().isLength({ min: 1 }),
    body('lastName').optional().trim().isLength({ min: 1 }),
    body('email').optional().isEmail().withMessage('Invalid email'),
    body('phone').optional().isMobilePhone().withMessage('Invalid phone'),
    body('address').optional().trim(),
    body('password').optional().isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('user_type').optional().isIn(['customer', 'store_owner', 'admin']).withMessage('Invalid user type'),
    body('is_active').optional().isBoolean().withMessage('is_active must be a boolean')
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

        const { id } = req.params;
        const {
            firstName, lastName, email, phone, address, password,
            user_type, is_active
        } = req.body;

        const updateFields = [];
        const updateValues = [];

        if (firstName !== undefined) { updateFields.push('first_name = ?'); updateValues.push(firstName); }
        if (lastName !== undefined) { updateFields.push('last_name = ?'); updateValues.push(lastName); }
        if (email !== undefined) { updateFields.push('email = ?'); updateValues.push(email); }
        if (phone !== undefined) { updateFields.push('phone = ?'); updateValues.push(phone); }
        if (address !== undefined) { updateFields.push('address = ?'); updateValues.push(address); }
        if (user_type !== undefined) { updateFields.push('user_type = ?'); updateValues.push(user_type); }
        if (is_active !== undefined) { updateFields.push('is_active = ?'); updateValues.push(is_active); }

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
            const [existing] = await req.db.execute('SELECT id FROM users WHERE email = ? AND id != ?', [email, id]);
            if (existing.length > 0) {
                return res.status(400).json({ success: false, message: 'Email already in use by another user' });
            }
        }

        updateValues.push(id);

        await req.db.execute(
            `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
            updateValues
        );

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

module.exports = router;
