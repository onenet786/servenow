const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get sizes
router.get('/', async (req, res) => {
    try {
        const [sizes] = await req.db.execute('SELECT * FROM sizes ORDER BY id ASC');
        res.json({ success: true, sizes });
    } catch (err) {
        console.error('Error fetching sizes:', err.message);
        res.status(500).json({ success: false, message: 'Failed to fetch sizes', error: err.message });
    }
});

// Create size (admin)
router.post('/', authenticateToken, requireAdmin, [
    body('label').trim().isLength({ min: 1 }).withMessage('Label required')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
    try {
        const { label, description } = req.body;
        const [result] = await req.db.execute('INSERT INTO sizes (label, description) VALUES (?,?)', [label, description || null]);
        res.status(201).json({ success: true, size: { id: result.insertId, label, description } });
    } catch (err) {
        console.error('Error creating size:', err.message);
        res.status(500).json({ success: false, message: 'Failed to create size', error: err.message });
    }
});

// Update size (admin)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { label, description } = req.body;
        const fields = [];
        const vals = [];
        if (label !== undefined) { fields.push('label = ?'); vals.push(label); }
        if (description !== undefined) { fields.push('description = ?'); vals.push(description); }
        if (fields.length === 0) return res.status(400).json({ success: false, message: 'No fields to update' });
        vals.push(id);
        await req.db.execute(`UPDATE sizes SET ${fields.join(', ')} WHERE id = ?`, vals);
        res.json({ success: true, message: 'Size updated' });
    } catch (err) {
        console.error('Error updating size:', err.message);
        res.status(500).json({ success: false, message: 'Failed to update size', error: err.message });
    }
});

// Delete size (admin)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await req.db.execute('DELETE FROM sizes WHERE id = ?', [id]);
        res.json({ success: true, message: 'Size deleted' });
    } catch (err) {
        console.error('Error deleting size:', err.message);
        res.status(500).json({ success: false, message: 'Failed to delete size', error: err.message });
    }
});

module.exports = router;
