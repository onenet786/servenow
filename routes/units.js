const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get all units
router.get('/', async (req, res) => {
    try {
        const [units] = await req.db.execute('SELECT * FROM units ORDER BY name ASC');
        res.json({ success: true, units });
    } catch (err) {
        console.error('Error fetching units:', err.message);
        res.status(500).json({ success: false, message: 'Failed to fetch units', error: err.message });
    }
});

// Create unit (admin)
router.post('/', authenticateToken, requireAdmin, [
    body('name').trim().isLength({ min: 1 }).withMessage('Name required')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
    try {
        const { name, abbreviation, multiplier } = req.body;
        const [result] = await req.db.execute('INSERT INTO units (name, abbreviation, multiplier) VALUES (?,?,?)', [name, abbreviation || null, multiplier || 1]);
        res.status(201).json({ success: true, unit: { id: result.insertId, name, abbreviation, multiplier } });
    } catch (err) {
        console.error('Error creating unit:', err.message);
        res.status(500).json({ success: false, message: 'Failed to create unit', error: err.message });
    }
});

// Update unit (admin)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, abbreviation, multiplier } = req.body;
        const fields = [];
        const vals = [];
        if (name !== undefined) { fields.push('name = ?'); vals.push(name); }
        if (abbreviation !== undefined) { fields.push('abbreviation = ?'); vals.push(abbreviation); }
        if (multiplier !== undefined) { fields.push('multiplier = ?'); vals.push(multiplier); }
        if (fields.length === 0) return res.status(400).json({ success: false, message: 'No fields to update' });
        vals.push(id);
        await req.db.execute(`UPDATE units SET ${fields.join(', ')} WHERE id = ?`, vals);
        res.json({ success: true, message: 'Unit updated' });
    } catch (err) {
        console.error('Error updating unit:', err.message);
        res.status(500).json({ success: false, message: 'Failed to update unit', error: err.message });
    }
});

// Delete unit (admin)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await req.db.execute('DELETE FROM units WHERE id = ?', [id]);
        res.json({ success: true, message: 'Unit deleted' });
    } catch (err) {
        console.error('Error deleting unit:', err.message);
        res.status(500).json({ success: false, message: 'Failed to delete unit', error: err.message });
    }
});

module.exports = router;
