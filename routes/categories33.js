const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/categories — list categories (active first use-case)
router.get('/', async (req, res) => {
    try {
        const [rows] = await req.db.execute(
            'SELECT * FROM categories ORDER BY name ASC'
        );
        res.json({ success: true, categories: rows });
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch categories', error: error.message });
    }
});

// POST /api/categories — create category (admin only)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        let { name, description, image_url } = req.body || {};
        if (!name || String(name).trim().length < 2) {
            return res.status(400).json({ success: false, message: 'Category name must be at least 2 characters' });
        }
        name = String(name).trim();
        if (typeof description === 'string') description = description.trim();
        else if (description === undefined) description = null;
        if (typeof image_url === 'string') {
            image_url = image_url.trim();
            if (image_url.length === 0) image_url = null;
        } else if (image_url === undefined) {
            image_url = null;
        }

        const [result] = await req.db.execute(
            'INSERT INTO categories (name, description, image_url) VALUES (?, ?, ?)',
            [name, description, image_url]
        );

        res.status(201).json({
            success: true,
            message: 'Category created successfully',
            category: { id: result.insertId, name, description, image_url }
        });
    } catch (error) {
        console.error('Error creating category:', error);
        res.status(500).json({ success: false, message: 'Failed to create category', error: error.message });
    }
});

// PUT /api/categories/:id — update category (admin only)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        let { name, description, image_url, is_active } = req.body || {};

        const fields = [];
        const values = [];

        if (name !== undefined) {
            const n = String(name).trim();
            if (n.length >= 2) { fields.push('name = ?'); values.push(n); }
        }
        if (description !== undefined) {
            const d = typeof description === 'string' ? description.trim() : description;
            fields.push('description = ?'); values.push(d);
        }
        if (image_url !== undefined) {
            if (typeof image_url === 'string') {
                const i = image_url.trim();
                fields.push('image_url = ?'); values.push(i.length ? i : null);
            } else {
                fields.push('image_url = ?'); values.push(image_url);
            }
        }
        if (is_active !== undefined) {
            fields.push('is_active = ?'); values.push(!!is_active);
        }

        if (fields.length === 0) {
            return res.status(400).json({ success: false, message: 'No valid fields to update' });
        }

        values.push(id);
        await req.db.execute(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`, values);
        res.json({ success: true, message: 'Category updated successfully' });
    } catch (error) {
        console.error('Error updating category:', error);
        res.status(500).json({ success: false, message: 'Failed to update category', error: error.message });
    }
});

module.exports = router;

