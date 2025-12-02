const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get all riders (Admin only)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [riders] = await req.db.execute(
            'SELECT id, first_name, last_name, email, phone, vehicle_type, license_number, is_available, is_active, created_at FROM riders ORDER BY first_name ASC'
        );

        res.json({
            success: true,
            riders
        });
    } catch (error) {
        console.error('Error fetching riders:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch riders',
            error: error.message
        });
    }
});

// Get rider by ID (Admin only)
router.get('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const [riders] = await req.db.execute(
            'SELECT id, first_name, last_name, email, phone, vehicle_type, license_number, is_available, is_active, created_at FROM riders WHERE id = ?',
            [id]
        );

        if (riders.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Rider not found'
            });
        }

        res.json({
            success: true,
            rider: riders[0]
        });
    } catch (error) {
        console.error('Error fetching rider:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch rider',
            error: error.message
        });
    }
});

// Create new rider (Admin only)
router.post('/', authenticateToken, requireAdmin, [
    body('firstName').notEmpty().withMessage('First name is required'),
    body('lastName').notEmpty().withMessage('Last name is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('phone').notEmpty().withMessage('Phone is required'),
