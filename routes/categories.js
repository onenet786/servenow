const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get all categories
router.get('/', async (req, res) => {
    try {
        const [categories] = await req.db.execute(
            'SELECT * FROM categories WHERE is_active = true ORDER BY name ASC'
        );

        res.json({
            success: true,
            categories
        });

    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch categories',
            error: error.message
        });
    }
});

// Create new category (Admin only)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { name, description, image_url } = req.body;

        if (!name || name.trim().length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Category name must be at least 2 characters'
            });
        }

        const [result] = await req.db.execute(
            'INSERT INTO categories (name, description, image_url) VALUES (?, ?, ?)',
            [name.trim(), description, image_url]
        );

        res.status(201).json({
            success: true,
            message: 'Category created successfully',
            category: {
                id: result.insertId,
                name: name.trim(),
                description,
                image_url
            }
        });

    } catch (error) {
        console.error('Error creating category:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create category',
            error: error.message
        });
    }
});

// Update category (Admin only)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, image_url, is_active } = req.body;

        const updateFields = [];
        const updateValues = [];

        if (name !== undefined && name.trim().length >= 2) {
            updateFields.push('name = ?');
            updateValues.push(name.trim());
        }
        if (description !== undefined) {
            updateFields.push('description = ?');
            updateValues.push(description);
        }
        if (image_url !== undefined) {
            updateFields.push('image_url = ?');
            updateValues.push(image_url);
        }
        if (is_active !== undefined) {
            updateFields.push('is_active = ?');
            updateValues.push(is_active);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid fields to update'
            });
        }

        updateValues.push(id);

        await req.db.execute(
            `UPDATE categories SET ${updateFields.join(', ')} WHERE id = ?`,
            updateValues
        );

        res.json({
            success: true,
            message: 'Category updated successfully'
        });

    } catch (error) {
        console.error('Error updating category:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update category',
            error: error.message
        });
    }
});

module.exports = router;
