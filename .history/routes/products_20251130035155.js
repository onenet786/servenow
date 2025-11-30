const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken, requireAdmin, requireStoreOwner } = require('../middleware/auth');

const router = express.Router();

// Get all products with optional category filter
router.get('/', async (req, res) => {
    try {
        const { category, store } = req.query;

        let query = `
            SELECT p.*, c.name as category_name, s.name as store_name, s.location as store_location
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN stores s ON p.store_id = s.id
            WHERE p.is_available = true AND s.is_active = true
        `;
        const queryParams = [];

        if (category) {
            query += ' AND LOWER(c.name) = LOWER(REPLACE(?, "-", " "))';
            queryParams.push(category);
        }

        if (store) {
            query += ' AND p.store_id = ?';
            queryParams.push(store);
        }

        query += ' ORDER BY p.name ASC';

        const [products] = await req.db.execute(query, queryParams);

        res.json({
            success: true,
            products: products.map(product => ({
                id: product.id,
                name: product.name,
                description: product.description,
                price: product.price,
                image_url: product.image_url,
                category_name: product.category_name,
                store_name: product.store_name,
                store_location: product.store_location,
                stock_quantity: product.stock_quantity,
                is_available: product.is_available,
                store_id: product.store_id,
                category_id: product.category_id
            }))
        });

    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch products',
            error: error.message
        });
    }
});

// Get product by ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const [products] = await req.db.execute(`
            SELECT p.*, c.name as category_name, s.name as store_name, s.location as store_location
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN stores s ON p.store_id = s.id
            WHERE p.id = ? AND p.is_available = true AND s.is_active = true
        `, [id]);

        if (products.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        const product = products[0];

        res.json({
            success: true,
            product: {
                id: product.id,
                name: product.name,
                description: product.description,
                price: product.price,
                image_url: product.image_url,
                category_name: product.category_name,
                store_name: product.store_name,
                store_location: product.store_location,
                stock_quantity: product.stock_quantity,
                is_available: product.is_available,
                store_id: product.store_id,
                category_id: product.category_id
            }
        });

    } catch (error) {
        console.error('Error fetching product:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch product',
            error: error.message
        });
    }
});

// Create new product (Admin or Store Owner)
router.post('/', authenticateToken, requireStoreOwner, [
    body('name').trim().isLength({ min: 2 }).withMessage('Product name must be at least 2 characters'),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    body('store_id').isInt().withMessage('Store ID must be a valid integer'),
    body('stock_quantity').optional().isInt({ min: 0 }).withMessage('Stock quantity must be a non-negative integer')
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
            price,
            image_url,
            category_id,
            store_id,
            stock_quantity = 0
        } = req.body;

        // Check if store exists and user has permission
        const [stores] = await req.db.execute(
            'SELECT owner_id FROM stores WHERE id = ? AND is_active = true',
            [store_id]
        );

        if (stores.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Store not found'
            });
        }

        // Check ownership permission
        if (req.user.user_type !== 'admin' && stores[0].owner_id !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to add products to this store'
            });
        }

        // Check if category exists (if provided)
        if (category_id) {
            const [categories] = await req.db.execute(
                'SELECT id FROM categories WHERE id = ? AND is_active = true',
                [category_id]
            );
            if (categories.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid category'
                });
            }
        }

        const [result] = await req.db.execute(
            `INSERT INTO products (name, description, price, image_url, category_id, store_id, stock_quantity)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [name, description, price, image_url, category_id, store_id, stock_quantity]
        );

        res.status(201).json({
            success: true,
            message: 'Product created successfully',
            product: {
                id: result.insertId,
                name,
                price,
                store_id
            }
        });

    } catch (error) {
        console.error('Error creating product:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create product',
            error: error.message
        });
    }
});

// Update product (Admin or Store Owner)
router.put('/:id', authenticateToken, requireStoreOwner, [
    body('name').optional().trim().isLength({ min: 2 }).withMessage('Product name must be at least 2 characters'),
    body('price').optional().isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    body('stock_quantity').optional().isInt({ min: 0 }).withMessage('Stock quantity must be a non-negative integer')
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

        // Check if product exists and get store info
        const [products] = await req.db.execute(`
            SELECT p.*, s.owner_id
            FROM products p
            JOIN stores s ON p.store_id = s.id
            WHERE p.id = ?
        `, [id]);

        if (products.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        const product = products[0];

        // Check ownership permission
        if (req.user.user_type !== 'admin' && product.owner_id !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to update this product'
            });
        }

        const {
            name,
            description,
            price,
            image_url,
            category_id,
            stock_quantity,
            is_available
        } = req.body;

        const updateFields = [];
        const updateValues = [];

        if (name !== undefined) { updateFields.push('name = ?'); updateValues.push(name); }
        if (description !== undefined) { updateFields.push('description = ?'); updateValues.push(description); }
        if (price !== undefined) { updateFields.push('price = ?'); updateValues.push(price); }
        if (image_url !== undefined) { updateFields.push('image_url = ?'); updateValues.push(image_url); }
        if (category_id !== undefined) { updateFields.push('category_id = ?'); updateValues.push(category_id); }
        if (stock_quantity !== undefined) { updateFields.push('stock_quantity = ?'); updateValues.push(stock_quantity); }
        if (is_available !== undefined) { updateFields.push('is_available = ?'); updateValues.push(is_available); }

        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid fields to update'
            });
        }

        updateValues.push(id);

        await req.db.execute(
            `UPDATE products SET ${updateFields.join(', ')} WHERE id = ?`,
            updateValues
        );

        res.json({
            success: true,
            message: 'Product updated successfully'
        });

    } catch (error) {
        console.error('Error updating product:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update product',
            error: error.message
        });
    }
});

// Delete product (Admin or Store Owner)
router.delete('/:id', authenticateToken, requireStoreOwner, async (req, res) => {
    try {
        const { id } = req.params;

        // Check if product exists and get store info
        const [products] = await req.db.execute(`
            SELECT p.*, s.owner_id
            FROM products p
            JOIN stores s ON p.store_id = s.id
            WHERE p.id = ?
        `, [id]);

        if (products.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        const product = products[0];

        // Check ownership permission
        if (req.user.user_type !== 'admin' && product.owner_id !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to delete this product'
            });
        }

        await req.db.execute(
            'UPDATE products SET is_available = false WHERE id = ?',
            [id]
        );

        res.json({
            success: true,
            message: 'Product deactivated successfully'
        });

    } catch (error) {
        console.error('Error deleting product:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete product',
            error: error.message
        });
    }
});

module.exports = router;
