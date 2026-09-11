const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken, requireAdmin, requirePermission } = require('../middleware/auth');
const cache = require('../utils/cache');

const router = express.Router();

// Get sizes (cached for 5 min)
router.get('/', async (req, res) => {
    try {
        const cached = cache.get('sizes_list');
        if (cached) {
            res.setHeader('X-Cache', 'HIT');
            res.setHeader('Cache-Control', 'public, max-age=300');
            return res.json(cached);
        }

        const [sizes] = await req.db.execute('SELECT * FROM sizes ORDER BY id ASC');
        const payload = { success: true, sizes };
        cache.set('sizes_list', payload, 5 * 60 * 1000);

        res.setHeader('X-Cache', 'MISS');
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.json(payload);
    } catch (err) {
        console.error('Error fetching sizes:', err.message);
        res.status(500).json({ success: false, message: 'Failed to fetch sizes', error: err.message });
    }
});

// Create size
router.post('/', authenticateToken, requirePermission('action_manage_sizes'), [
    body('label').trim().isLength({ min: 1 }).withMessage('Label required')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
    try {
        const { label, description } = req.body;
        const [result] = await req.db.execute('INSERT INTO sizes (label, description) VALUES (?,?)', [label, description || null]);
        cache.del('sizes_list');
        res.status(201).json({ success: true, size: { id: result.insertId, label, description } });
    } catch (err) {
        console.error('Error creating size:', err.message);
        res.status(500).json({ success: false, message: 'Failed to create size', error: err.message });
    }
});

// Update size
router.put('/:id', authenticateToken, requirePermission('action_manage_sizes'), async (req, res) => {
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
        cache.del('sizes_list');
        res.json({ success: true, message: 'Size updated' });
    } catch (err) {
        console.error('Error updating size:', err.message);
        res.status(500).json({ success: false, message: 'Failed to update size', error: err.message });
    }
});

// Delete size
router.delete('/:id', authenticateToken, requirePermission('action_manage_sizes'), async (req, res) => {
    try {
        const { id } = req.params;
        await req.db.execute('DELETE FROM sizes WHERE id = ?', [id]);
        cache.del('sizes_list');
        res.json({ success: true, message: 'Size deleted' });
    } catch (err) {
        console.error('Error deleting size:', err.message);
        res.status(500).json({ success: false, message: 'Failed to delete size', error: err.message });
    }
});

module.exports = router;
