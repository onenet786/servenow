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
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('vehicleType').notEmpty().withMessage('Vehicle type is required'),
    body('licenseNumber').notEmpty().withMessage('License number is required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation errors',
                errors: errors.array()
            });
        }

        const { firstName, lastName, email, phone, password, vehicleType, licenseNumber } = req.body;

        // Check if email already exists
        const [existingRiders] = await req.db.execute(
            'SELECT id FROM riders WHERE email = ?',
            [email]
        );

        if (existingRiders.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Email already exists'
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert new rider
        const [result] = await req.db.execute(
            'INSERT INTO riders (first_name, last_name, email, phone, password, vehicle_type, license_number) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [firstName, lastName, email, phone, hashedPassword, vehicleType, licenseNumber]
        );

        res.status(201).json({
            success: true,
            message: 'Rider created successfully',
            riderId: result.insertId
        });
    } catch (error) {
        console.error('Error creating rider:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create rider',
            error: error.message
        });
    }
});

// Update rider (Admin only)
router.put('/:id', authenticateToken, requireAdmin, [
    body('firstName').optional().notEmpty().withMessage('First name cannot be empty'),
    body('lastName').optional().notEmpty().withMessage('Last name cannot be empty'),
    body('email').optional().isEmail().withMessage('Valid email is required'),
    body('phone').optional().notEmpty().withMessage('Phone cannot be empty'),
    body('vehicleType').optional().notEmpty().withMessage('Vehicle type cannot be empty'),
    body('licenseNumber').optional().notEmpty().withMessage('License number cannot be empty'),
    body('isAvailable').optional().isBoolean().withMessage('isAvailable must be boolean'),
    body('isActive').optional().isBoolean().withMessage('isActive must be boolean')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation errors',
                errors: errors.array()
            });
        }

        const { id } = req.params;
        const { firstName, lastName, email, phone, vehicleType, licenseNumber, isAvailable, isActive } = req.body;

        // Check if rider exists
        const [existingRiders] = await req.db.execute(
            'SELECT id FROM riders WHERE id = ?',
            [id]
        );

        if (existingRiders.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Rider not found'
            });
        }

        // Check if email is already used by another rider
        if (email) {
            const [emailCheck] = await req.db.execute(
                'SELECT id FROM riders WHERE email = ? AND id != ?',
                [email, id]
            );

            if (emailCheck.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Email already exists'
                });
            }
        }

        // Build update query dynamically
        const updateFields = [];
        const updateValues = [];

        if (firstName !== undefined) {
            updateFields.push('first_name = ?');
            updateValues.push(firstName);
        }
        if (lastName !== undefined) {
            updateFields.push('last_name = ?');
            updateValues.push(lastName);
        }
        if (email !== undefined) {
            updateFields.push('email = ?');
            updateValues.push(email);
        }
        if (phone !== undefined) {
            updateFields.push('phone = ?');
            updateValues.push(phone);
        }
        if (vehicleType !== undefined) {
            updateFields.push('vehicle_type = ?');
            updateValues.push(vehicleType);
        }
        if (licenseNumber !== undefined) {
            updateFields.push('license_number = ?');
            updateValues.push(licenseNumber);
        }
        if (isAvailable !== undefined) {
            updateFields.push('is_available = ?');
            updateValues.push(isAvailable);
        }
        if (isActive !== undefined) {
            updateFields.push('is_active = ?');
            updateValues.push(isActive);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No fields to update'
            });
        }

        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        updateValues.push(id);

        const query = `UPDATE riders SET ${updateFields.join(', ')} WHERE id = ?`;

        await req.db.execute(query, updateValues);

        res.json({
            success: true,
            message: 'Rider updated successfully'
        });
    } catch (error) {
        console.error('Error updating rider:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update rider',
            error: error.message
        });
    }
});

// Delete rider (Admin only) - Soft delete by setting is_active to false
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Check if rider exists
        const [existingRiders] = await req.db.execute(
            'SELECT id FROM riders WHERE id = ?',
            [id]
        );

        if (existingRiders.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Rider not found'
            });
        }

        // Soft delete by setting is_active to false
        await req.db.execute(
            'UPDATE riders SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [id]
        );

        res.json({
            success: true,
            message: 'Rider deactivated successfully'
        });
    } catch (error) {
        console.error('Error deactivating rider:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to deactivate rider',
            error: error.message
        });
    }
});

// Get available vehicle types (Admin only)
router.get('/types/vehicle', authenticateToken, requireAdmin, async (req, res) => {
    try {
        // Get distinct vehicle types from existing riders
        const [vehicleTypes] = await req.db.execute(
            'SELECT DISTINCT vehicle_type FROM riders WHERE vehicle_type IS NOT NULL AND vehicle_type != "" ORDER BY vehicle_type ASC'
        );

        const types = vehicleTypes.map(row => row.vehicle_type);

        // If no vehicle types exist, provide default ones
        if (types.length === 0) {
            types.push('Motorcycle', 'Bicycle', 'Scooter', 'Car', 'Van');
        }

        res.json({
            success: true,
            vehicleTypes: types
        });
    } catch (error) {
        console.error('Error fetching vehicle types:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch vehicle types',
            error: error.message
        });
    }
});

// Riders Fuel History - Admin CRUD
// Table assumed: `riders_fuel_history` with columns like
// id, rider_id, fuel_date, meter_reading, petrol_rate, petrol_qty, cost, notes, created_at
// List all fuel history entries (admin)
router.get('/fuel-history', authenticateToken, requireAdmin, async (req, res) => {
    try {
        // Ensure the table exists to give a clearer error message when missing
        const [tbl] = await req.db.execute(
            "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'riders_fuel_history'"
        );
        if (!tbl || tbl[0].cnt === 0) {
            console.error('Table riders_fuel_history does not exist in database');
            return res.status(500).json({ success: false, message: 'Required table `riders_fuel_history` not found in database' });
        }
        const [rows] = await req.db.execute(
            `SELECT fh.*, r.first_name, r.last_name
             FROM riders_fuel_history fh
             LEFT JOIN riders r ON r.id = fh.rider_id
             ORDER BY fh.fuel_date DESC, fh.id DESC`
        );

        res.json({ success: true, records: rows });
    } catch (error) {
        console.error('Error fetching fuel history:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch fuel history', error: error.message });
    }
});

// List fuel history for a single rider
router.get('/:id/fuel-history', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        // Ensure the table exists
        const [tbl] = await req.db.execute(
            "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'riders_fuel_history'"
        );
        if (!tbl || tbl[0].cnt === 0) {
            console.error('Table riders_fuel_history does not exist in database');
            return res.status(500).json({ success: false, message: 'Required table `riders_fuel_history` not found in database' });
        }
        const [rows] = await req.db.execute(
            'SELECT * FROM riders_fuel_history WHERE rider_id = ? ORDER BY fuel_date DESC, id DESC',
            [id]
        );

        res.json({ success: true, records: rows });
    } catch (error) {
        console.error('Error fetching rider fuel history:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch rider fuel history', error: error.message });
    }
});

// Create a fuel history entry for a rider
router.post('/:id/fuel-history', authenticateToken, requireAdmin, [
    body('fuelDate').optional().isISO8601().withMessage('fuelDate must be a valid date'),
    body('meterReading').optional().trim().isLength({ max: 64 }).withMessage('meterReading must be a short string'),
    body('petrolRate').optional().isNumeric().withMessage('petrolRate must be numeric'),
    body('petrolQty').optional().isNumeric().withMessage('petrolQty must be numeric'),
    body('cost').optional().isNumeric().withMessage('cost must be numeric'),
    body('notes').optional().trim()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, message: 'Validation errors', errors: errors.array() });
        }
        const { id } = req.params;
        const { fuelDate, meterReading, petrolRate, petrolQty, cost: costProvided, notes } = req.body;

        // Ensure rider exists
        const [riderRows] = await req.db.execute('SELECT id FROM riders WHERE id = ?', [id]);
        if (!riderRows || riderRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Rider not found' });
        }

        // Coerce numeric fields and calculate cost safely
        const pr = (petrolRate !== undefined && petrolRate !== null && petrolRate !== '') ? parseFloat(petrolRate) : null;
        const pq = (petrolQty !== undefined && petrolQty !== null && petrolQty !== '') ? parseFloat(petrolQty) : null;
        const mr = (meterReading !== undefined && meterReading !== null && meterReading !== '') ? meterReading : null;


        // Determine cost: if client provided a numeric cost, use it; otherwise compute from rate*qty
        let cost = null;
        const cp = (costProvided !== undefined && costProvided !== null && costProvided !== '') ? parseFloat(costProvided) : null;
        if (cp !== null && Number.isFinite(cp)) {
            cost = Math.round(cp * 100) / 100;
        } else if (Number.isFinite(pr) && Number.isFinite(pq)) {
            cost = Math.round((pr * pq) * 100) / 100; // store as numeric (2 decimals)
        }

        const [result] = await req.db.execute(
            `INSERT INTO riders_fuel_history (rider_id, fuel_date, meter_reading, petrol_rate, petrol_qty, cost, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, fuelDate || null, mr, pr, pq, cost, notes || null]
        );

        res.status(201).json({ success: true, id: result.insertId, message: 'Fuel history entry created' });
    } catch (error) {
        console.error('Error creating fuel history entry:', error);
        // Provide useful error info without exposing sensitive details
        res.status(500).json({ success: false, message: 'Failed to create fuel history entry', error: error.message });
    }
});

// Delete a fuel history entry (admin)
router.delete('/fuel-history/:hid', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { hid } = req.params;
        await req.db.execute('DELETE FROM riders_fuel_history WHERE id = ?', [hid]);
        res.json({ success: true, message: 'Fuel history entry deleted' });
    } catch (error) {
        console.error('Error deleting fuel history entry:', error);
        res.status(500).json({ success: false, message: 'Failed to delete fuel history entry', error: error.message });
    }
});

// Debug: quick check for the fuel history table and sample rows (admin-only, temporary)
router.get('/debug/fuel-history/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        // Check table exists
        const [tbl] = await req.db.execute(
            "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'riders_fuel_history'"
        );
        if (!tbl || tbl[0].cnt === 0) {
            return res.status(500).json({ success: false, message: 'Required table `riders_fuel_history` not found in database' });
        }

        // Count rows for rider
        const [countRows] = await req.db.execute('SELECT COUNT(*) AS cnt FROM riders_fuel_history WHERE rider_id = ?', [id]);
        const total = (countRows && countRows[0]) ? countRows[0].cnt : 0;

        // Fetch a few rows to inspect schema
        const [sample] = await req.db.execute('SELECT * FROM riders_fuel_history WHERE rider_id = ? ORDER BY fuel_date DESC, id DESC LIMIT 5', [id]);

        return res.json({ success: true, tableExists: true, totalForRider: total, sampleRows: sample });
    } catch (err) {
        console.error('Debug fuel-history error:', err && err.stack ? err.stack : err);
        return res.status(500).json({ success: false, message: 'Debug query failed', error: err && err.message ? err.message : String(err) });
    }
});

module.exports = router;
