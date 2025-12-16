const express = require('express');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sharp = (() => { try { return require('sharp'); } catch(e){ return null; } })();
const upload = multer({ dest: path.join(__dirname, '..', 'uploads', 'tmp') });

const router = express.Router();

async function hasColumn(db, table, column) {
    const [rows] = await db.execute(
        'SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        [table, column]
    );
    return rows && rows[0] && rows[0].cnt > 0;
}

// Get all riders (Admin only)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const hasFullName = await hasColumn(req.db, 'riders', 'full_name');
        let sql;
        if (hasFullName) {
            sql = 'SELECT id, full_name, email, phone, vehicle_type, license_number, is_available, is_active, created_at FROM riders ORDER BY full_name ASC';
        } else {
            sql = 'SELECT id, first_name, last_name, email, phone, vehicle_type, license_number, is_available, is_active, created_at FROM riders ORDER BY first_name ASC';
        }
        const [riders] = await req.db.execute(sql);

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
        const hasFullName = await hasColumn(req.db, 'riders', 'full_name');
        let sql;
        if (hasFullName) {
            sql = 'SELECT id, full_name, email, phone, vehicle_type, license_number, is_available, is_active, father_name, image_url, id_card_url, id_card_num, created_at, updated_at FROM riders WHERE id = ?';
        } else {
            sql = 'SELECT id, first_name, last_name, email, phone, vehicle_type, license_number, is_available, is_active, father_name, image_url, id_card_url, id_card_num, created_at, updated_at FROM riders WHERE id = ?';
        }
        const [riders] = await req.db.execute(sql, [id]);

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
    body('fullName').notEmpty().trim().withMessage('Full name is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('phone').notEmpty().withMessage('Phone is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('vehicleType').notEmpty().withMessage('Vehicle type is required'),
    body('licenseNumber').notEmpty().withMessage('License number is required'),
    body('fatherName').optional().trim(),
    body('image_url').optional().isString(),
    body('id_card_url').optional().isString(),
    body('imageUrl').optional().isString(),
    body('idCardUrl').optional().isString(),
    body('imageBase64').optional().isString(),
    body('idCardBase64').optional().isString(),
    body('idCardNum').optional().matches(/^\d{5}-\d{7}-\d$/).withMessage('Invalid idCardNum format')
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

        const {
            firstName, lastName, fullName, email, phone, password, vehicleType, licenseNumber,
            fatherName, image_url, id_card_url, imageUrl, idCardUrl, imageBase64, idCardBase64, idCardNum
        } = req.body;
        let imageUrlFinal = image_url || imageUrl || null;
        let idCardUrlFinal = id_card_url || idCardUrl || null;
        const uploadDir = path.join(__dirname, '..', 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        const saveDataUrl = async (dataUrl, prefix) => {
            const m = String(dataUrl || '').match(/^data:(image\/[^;]+);base64,(.+)$/);
            if (!m) return null;
            const mime = m[1];
            const b64 = m[2];
            const buf = Buffer.from(b64, 'base64');
            const ext = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg';
            const base = `${prefix}_${Date.now()}_${Math.round(Math.random()*1000)}`;
            const outName = `${base}${ext}`;
            const outPath = path.join(uploadDir, outName);
            fs.writeFileSync(outPath, buf);
            return '/uploads/' + outName;
        };
        if (!imageUrlFinal && imageBase64) imageUrlFinal = await saveDataUrl(imageBase64, 'rider');
        if (!idCardUrlFinal && idCardBase64) idCardUrlFinal = await saveDataUrl(idCardBase64, 'rider_id');

        // Ensure we have a name
        const nameProvided = (typeof fullName === 'string' && fullName.trim().length) || (typeof firstName === 'string' && firstName.trim().length);
        if (!nameProvided) {
            return res.status(400).json({ success: false, message: 'Full name is required' });
        }

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

        // Insert dynamically: prefer full_name if column exists
        const hasFullName = await hasColumn(req.db, 'riders', 'full_name');
        let insertSql, params;
        if (hasFullName) {
            insertSql = `
                INSERT INTO riders
                (full_name, email, phone, password, vehicle_type, license_number, father_name, image_url, id_card_url, id_card_num)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            params = [
                String((fullName || firstName || '') || ''),
                String(email || ''),
                String(phone || ''),
                String(hashedPassword || ''),
                String(vehicleType || ''),
                String(licenseNumber || ''),
                fatherName != null ? String(fatherName) : null,
                imageUrlFinal != null ? String(imageUrlFinal) : null,
                idCardUrlFinal != null ? String(idCardUrlFinal) : null,
                idCardNum != null ? String(idCardNum) : null
            ];
        } else {
            insertSql = `
                INSERT INTO riders
                (first_name, last_name, email, phone, password, vehicle_type, license_number, father_name, image_url, id_card_url, id_card_num)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            // Map fullName into first_name and leave last_name empty
            params = [
                String((fullName || firstName || '') || ''),
                String((lastName || '') || ''),
                String(email || ''),
                String(phone || ''),
                String(hashedPassword || ''),
                String(vehicleType || ''),
                String(licenseNumber || ''),
                fatherName != null ? String(fatherName) : null,
                imageUrlFinal != null ? String(imageUrlFinal) : null,
                idCardUrlFinal != null ? String(idCardUrlFinal) : null,
                idCardNum != null ? String(idCardNum) : null
            ];
        }
        const [result] = await req.db.execute(insertSql, params);

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

// Upload rider image (photo or ID card)
router.post('/upload-image', authenticateToken, requireAdmin, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
        const uploadDir = path.join(__dirname, '..', 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        const originalPath = req.file.path;
        const ext = path.extname(req.file.originalname) || '.jpg';
        const baseName = `rider_${Date.now()}_${Math.round(Math.random()*1000)}`;
        const outName = `${baseName}${ext}`;
        const outPath = path.join(uploadDir, outName);
        fs.renameSync(originalPath, outPath);
        const publicPath = '/uploads/' + outName;
        const variants = {};
        if (sharp) {
            const sizes = [320, 640];
            for (const w of sizes) {
                try {
                    const vname = `${baseName}_${w}${ext}`;
                    const vpath = path.join(uploadDir, vname);
                    await sharp(outPath).resize({ width: w }).toFile(vpath);
                    variants[w] = '/uploads/' + vname;
                } catch (err) {}
            }
        }
        res.json({ success: true, image_url: publicPath, variants });
    } catch (error) {
        console.error('Rider image upload failed:', error);
        res.status(500).json({ success: false, message: 'Image upload failed', error: error.message });
    }
});

// Update rider (Admin only)
router.put('/:id', authenticateToken, requireAdmin, [
    body('firstName').optional().trim(),
    body('lastName').optional().trim(),
    body('fullName').optional().trim(),
    body('email').optional().isEmail().withMessage('Valid email is required'),
    body('phone').optional().notEmpty().withMessage('Phone cannot be empty'),
    body('vehicleType').optional().notEmpty().withMessage('Vehicle type cannot be empty'),
    body('licenseNumber').optional().notEmpty().withMessage('License number cannot be empty'),
    body('isAvailable').optional().isBoolean().withMessage('isAvailable must be boolean'),
    body('isActive').optional().isBoolean().withMessage('isActive must be boolean'),
    body('fatherName').optional().trim(),
    body('image_url').optional().isString(),
    body('id_card_url').optional().isString(),
    body('imageUrl').optional().isString(),
    body('idCardUrl').optional().isString(),
    body('imageBase64').optional().isString(),
    body('idCardBase64').optional().isString(),
    body('idCardNum').optional().matches(/^\d{5}-\d{7}-\d$/).withMessage('Invalid idCardNum format')
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
        const {
            firstName, lastName, fullName, email, phone, vehicleType, licenseNumber,
            isAvailable, isActive, fatherName, image_url, id_card_url, imageUrl, idCardUrl, imageBase64, idCardBase64, idCardNum
        } = req.body;
        let imageUrlFinal = image_url || imageUrl || null;
        let idCardUrlFinal = id_card_url || idCardUrl || null;
        const uploadDir = path.join(__dirname, '..', 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        const saveDataUrl = async (dataUrl, prefix) => {
            const m = String(dataUrl || '').match(/^data:(image\/[^;]+);base64,(.+)$/);
            if (!m) return null;
            const mime = m[1];
            const b64 = m[2];
            const buf = Buffer.from(b64, 'base64');
            const ext = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg';
            const base = `${prefix}_${Date.now()}_${Math.round(Math.random()*1000)}`;
            const outName = `${base}${ext}`;
            const outPath = path.join(uploadDir, outName);
            fs.writeFileSync(outPath, buf);
            return '/uploads/' + outName;
        };
        if (!imageUrlFinal && imageBase64) imageUrlFinal = await saveDataUrl(imageBase64, 'rider');
        if (!idCardUrlFinal && idCardBase64) idCardUrlFinal = await saveDataUrl(idCardBase64, 'rider_id');

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

        const hasFullName = await hasColumn(req.db, 'riders', 'full_name');
        if (hasFullName) {
            if (fullName !== undefined || firstName !== undefined) {
                updateFields.push('full_name = ?');
                updateValues.push(fullName !== undefined ? fullName : firstName);
            }
        } else {
            if (firstName !== undefined) {
                updateFields.push('first_name = ?');
                updateValues.push(firstName);
            }
            if (lastName !== undefined) {
                updateFields.push('last_name = ?');
                updateValues.push(lastName);
            }
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
        if (fatherName !== undefined) {
            updateFields.push('father_name = ?');
            updateValues.push(fatherName);
        }
        if (image_url !== undefined) {
            updateFields.push('image_url = ?');
            updateValues.push(imageUrlFinal);
        }
        if (id_card_url !== undefined) {
            updateFields.push('id_card_url = ?');
            updateValues.push(idCardUrlFinal);
        }
        if (idCardNum !== undefined) {
            updateFields.push('id_card_num = ?');
            updateValues.push(idCardNum);
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
// id, rider_id, entry_date, start_meter, end_meter, distance, petrol_rate, fuel_cost, notes, created_at
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
        // Choose a safe column to ORDER BY depending on what exists in the table
        const [colsAll] = await req.db.execute(
            "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'riders_fuel_history'"
        );
        const colNamesAll = Array.isArray(colsAll) ? colsAll.map(c => c.COLUMN_NAME) : [];
        // Return all existing columns from the fuel history table and order by id.
        // This avoids errors when specific columns are missing in the runtime schema.
        const [rows] = await req.db.execute(
            `SELECT fh.*, r.first_name, r.last_name
             FROM riders_fuel_history fh
             LEFT JOIN riders r ON r.id = fh.rider_id
             ORDER BY fh.id DESC`
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
        // Check which columns exist so we can ORDER BY a safe column
        const [cols] = await req.db.execute(
            "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'riders_fuel_history'"
        );
        const colNames = Array.isArray(cols) ? cols.map(c => c.COLUMN_NAME) : [];
        // Select all available columns for the rider and order by id to avoid relying on specific columns.
        const [rows] = await req.db.execute(
            `SELECT * FROM riders_fuel_history WHERE rider_id = ? ORDER BY id DESC`,
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
    body('entryDate').optional().isISO8601().withMessage('entryDate must be a valid date'),
    body('startMeter').optional().trim().isLength({ max: 64 }).withMessage('startMeter must be a short string'),
    body('endMeter').optional().trim().isLength({ max: 64 }).withMessage('endMeter must be a short string'),
    body('distance').optional().isNumeric().withMessage('distance must be numeric'),
    body('petrolRate').optional().isNumeric().withMessage('petrolRate must be numeric'),
    body('fuelCost').optional().isNumeric().withMessage('fuelCost must be numeric'),
    body('notes').optional().trim()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, message: 'Validation errors', errors: errors.array() });
        }
        const { id } = req.params;
        const { entryDate, startMeter, endMeter, distance, petrolRate, fuelCost: fuelCostProvided, notes } = req.body;

        // Ensure rider exists
        const [riderRows] = await req.db.execute('SELECT id FROM riders WHERE id = ?', [id]);
        if (!riderRows || riderRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Rider not found' });
        }

        // Coerce numeric fields
        const pr = (petrolRate !== undefined && petrolRate !== null && petrolRate !== '') ? parseFloat(petrolRate) : null;
        const dist = (distance !== undefined && distance !== null && distance !== '') ? parseFloat(distance) : null;
        const sm = (startMeter !== undefined && startMeter !== null && startMeter !== '') ? startMeter : null;
        const em = (endMeter !== undefined && endMeter !== null && endMeter !== '') ? endMeter : null;

        // Determine fuel_cost: prefer provided fuelCost; otherwise leave NULL
        let fuel_cost = null;
        const fcp = (fuelCostProvided !== undefined && fuelCostProvided !== null && fuelCostProvided !== '') ? parseFloat(fuelCostProvided) : null;
        if (fcp !== null && Number.isFinite(fcp)) {
            fuel_cost = Math.round(fcp * 100) / 100;
        }

        // Build an INSERT dynamically using only columns that exist in the actual DB table.
        const [columns] = await req.db.execute(
            "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'riders_fuel_history'"
        );
        const existingCols = Array.isArray(columns) ? columns.map(c => c.COLUMN_NAME) : [];

        // Map of desired column -> value (match new schema)
        const desired = {
            rider_id: id,
            entry_date: entryDate || null,
            start_meter: sm,
            end_meter: em,
            distance: dist,
            petrol_rate: pr,
            fuel_cost: fuel_cost,
            notes: notes || null
        };

        const insertCols = [];
        const placeholders = [];
        const values = [];
        for (const [col, val] of Object.entries(desired)) {
            if (existingCols.includes(col)) {
                insertCols.push(col);
                placeholders.push('?');
                values.push(val);
            }
        }

        if (insertCols.length === 0) {
            return res.status(500).json({ success: false, message: 'No matching columns found in riders_fuel_history table' });
        }

        const insertSql = `INSERT INTO riders_fuel_history (${insertCols.join(', ')}) VALUES (${placeholders.join(', ')})`;
        // Debug: log final SQL and values so we can confirm which columns are being written
        console.debug('Inserting into riders_fuel_history:', insertSql, values);
        const [result] = await req.db.execute(insertSql, values);

        res.status(201).json({ success: true, id: result.insertId, message: 'Fuel history entry created' });
    } catch (error) {
        console.error('Error creating fuel history entry:', error && error.stack ? error.stack : error);
        // If SQL error details are available, include them for admin debugging
        const errPayload = { success: false, message: 'Failed to create fuel history entry' };
        if (error && error.message) errPayload.error = error.message;
        if (error && error.code) errPayload.code = error.code;
        if (error && error.sqlMessage) errPayload.sqlMessage = error.sqlMessage;
        return res.status(500).json(errPayload);
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

        // Fetch a few rows to inspect schema - choose safe ORDER BY column
        const [colsDbg] = await req.db.execute(
            "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'riders_fuel_history'"
        );
        const colNamesDbg = Array.isArray(colsDbg) ? colsDbg.map(c => c.COLUMN_NAME) : [];
        // Fetch a few sample rows using a safe ORDER BY
        const [sample] = await req.db.execute(`SELECT * FROM riders_fuel_history WHERE rider_id = ? ORDER BY id DESC LIMIT 5`, [id]);

        return res.json({ success: true, tableExists: true, totalForRider: total, sampleRows: sample });
    } catch (err) {
        console.error('Debug fuel-history error:', err && err.stack ? err.stack : err);
        return res.status(500).json({ success: false, message: 'Debug query failed', error: err && err.message ? err.message : String(err) });
    }
});

module.exports = router;
