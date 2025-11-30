const express = require('express');
const { body, validationResult } = require('express-validator');
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
        const { user_type, is_active } = req.body;

        const updateFields = [];
        const updateValues = [];

        if (user_type !== undefined) { updateFields.push('user_type = ?'); updateValues.push(user_type); }
        if (is_active !== undefined) { updateFields.push('is_active = ?'); updateValues.push(is_active); }

        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid fields to update'
            });
        }

        updateValues.push(id);

        await req.db.execute(
            `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
            updateValues
        );

        res.json({
            success: true,
            message: 'User updated successfully'
        });

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
