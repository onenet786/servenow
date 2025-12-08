const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken, requireAdmin, requireStoreOwner } = require('../middleware/auth');

const router = express.Router();

// Get all stores
router.get('/', async (req, res) => {
    try {
        const [stores] = await req.db.execute(`
            SELECT s.*, u.first_name as owner_first_name, u.last_name as owner_last_name
            FROM stores s
            LEFT JOIN users u ON s.owner_id = u.id
            WHERE s.is_active = true
            ORDER BY s.rating DESC, s.name ASC
        `);

        res.json({
            success: true,
            stores: stores.map(store => ({
                id: store.id,
                name: store.name,
                location: store.location,
                image_url: store.cover_image || store.image_url || null,
                opening_time: store.opening_time || null,
                closing_time: store.closing_time || null,
                latitude: store.latitude,
                longitude: store.longitude,
                rating: store.rating,
                delivery_time: store.delivery_time,
                phone: store.phone,
                email: store.email,
                address: store.address,
                description: store.description,
                owner_name: store.owner_first_name && store.owner_last_name ?
                    `${store.owner_first_name} ${store.owner_last_name}` : null
            }))
        });

    } catch (error) {
        console.error('Error fetching stores:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch stores',
            error: error.message
        });
    }
});

// Get store by ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const [stores] = await req.db.execute(`
            SELECT s.*, u.first_name as owner_first_name, u.last_name as owner_last_name
            FROM stores s
            LEFT JOIN users u ON s.owner_id = u.id
            WHERE s.id = ? AND s.is_active = true
        `, [id]);

        if (stores.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Store not found'
            });
        }

        const store = stores[0];

        // Get products for this store
        const [products] = await req.db.execute(`
            SELECT p.*, c.name as category_name
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.store_id = ? AND p.is_available = true
            ORDER BY p.name ASC
        `, [id]);

        res.json({
            success: true,
            store: {
                id: store.id,
                name: store.name,
                location: store.location,
                opening_time: store.opening_time || null,
                closing_time: store.closing_time || null,
                latitude: store.latitude,
                longitude: store.longitude,
                rating: store.rating,
                delivery_time: store.delivery_time,
                phone: store.phone,
                email: store.email,
                address: store.address,
                description: store.description,
                owner_name: store.owner_first_name && store.owner_last_name ?
                    `${store.owner_first_name} ${store.owner_last_name}` : null
            },
            products: products.map(product => ({
                id: product.id,
                name: product.name,
                description: product.description,
                price: product.price,
                image_url: product.image_url,
                category_name: product.category_name,
                stock_quantity: product.stock_quantity,
                is_available: product.is_available
            }))
        });

    } catch (error) {
        console.error('Error fetching store:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch store',
            error: error.message
        });
    }
});

// Create new store (Admin or Store Owner)
router.post('/', authenticateToken, requireStoreOwner, [
    body('name').trim().isLength({ min: 2 }).withMessage('Store name must be at least 2 characters'),
    body('location').trim().notEmpty().withMessage('Location is required'),
    body('phone').optional().isMobilePhone().withMessage('Please provide a valid phone number'),
    body('email').optional().isEmail().withMessage('Please provide a valid email')
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

        const {
            name,
            description,
            location,
            latitude,
            longitude,
            delivery_time,
            phone,
            email,
            address
            , opening_time, closing_time
        } = req.body;

        // If user is store owner, they can only create stores for themselves
        // If user is admin, they can create stores for any owner
        const ownerId = req.user.user_type === 'admin' ? req.body.owner_id || req.user.id : req.user.id;

        const [result] = await req.db.execute(
            `INSERT INTO stores (name, description, location, latitude, longitude, delivery_time, opening_time, closing_time, phone, email, address, owner_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, description || null, location, latitude || null, longitude || null, delivery_time || null, opening_time || null, closing_time || null, phone || null, email || null, address || null, ownerId]
        );

        res.status(201).json({
            success: true,
            message: 'Store created successfully',
            store: {
                id: result.insertId,
                name,
                location,
                owner_id: ownerId
            }
        });

    } catch (error) {
        console.error('Error creating store:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create store',
            error: error.message
        });
    }
});

// Update store (Admin or Store Owner)
router.put('/:id', authenticateToken, requireStoreOwner, [
    body('name').optional().trim().isLength({ min: 2 }).withMessage('Store name must be at least 2 characters'),
    body('location').optional().trim().notEmpty().withMessage('Location is required'),
    body('phone').optional().isMobilePhone().withMessage('Please provide a valid phone number'),
    body('email').optional().isEmail().withMessage('Please provide a valid email')
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

        // Check if store exists and user has permission
        const [stores] = await req.db.execute(
            'SELECT * FROM stores WHERE id = ?',
            [id]
        );

        if (stores.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Store not found'
            });
        }

        const store = stores[0];

        // Check ownership permission
        if (req.user.user_type !== 'admin' && store.owner_id !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to update this store'
            });
        }

        const {
            name,
            description,
            location,
            latitude,
            longitude,
            delivery_time,
            phone,
            email,
            address,
            is_active,
            opening_time,
            closing_time
        } = req.body;

        const updateData = {};
        const updateFields = [];
        const updateValues = [];

        if (name !== undefined) { updateFields.push('name = ?'); updateValues.push(name); }
        if (description !== undefined) { updateFields.push('description = ?'); updateValues.push(description); }
        if (location !== undefined) { updateFields.push('location = ?'); updateValues.push(location); }
        if (latitude !== undefined) { updateFields.push('latitude = ?'); updateValues.push(latitude); }
        if (longitude !== undefined) { updateFields.push('longitude = ?'); updateValues.push(longitude); }
        if (delivery_time !== undefined) { updateFields.push('delivery_time = ?'); updateValues.push(delivery_time); }
        if (opening_time !== undefined) { updateFields.push('opening_time = ?'); updateValues.push(opening_time); }
        if (closing_time !== undefined) { updateFields.push('closing_time = ?'); updateValues.push(closing_time); }
        if (phone !== undefined) { updateFields.push('phone = ?'); updateValues.push(phone); }
        if (email !== undefined) { updateFields.push('email = ?'); updateValues.push(email); }
        if (address !== undefined) { updateFields.push('address = ?'); updateValues.push(address); }
        if (is_active !== undefined && req.user.user_type === 'admin') { updateFields.push('is_active = ?'); updateValues.push(is_active); }

        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid fields to update'
            });
        }

        updateValues.push(id);

        await req.db.execute(
            `UPDATE stores SET ${updateFields.join(', ')} WHERE id = ?`,
            updateValues
        );

        res.json({
            success: true,
            message: 'Store updated successfully'
        });

    } catch (error) {
        console.error('Error updating store:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update store',
            error: error.message
        });
    }
});

// Delete store (Admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await req.db.execute(
            'UPDATE stores SET is_active = false WHERE id = ?',
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Store not found'
            });
        }

        res.json({
            success: true,
            message: 'Store deactivated successfully'
        });

    } catch (error) {
        console.error('Error deleting store:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete store',
            error: error.message
        });
    }
});

module.exports = router;
