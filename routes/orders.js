const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken, requireAdmin, requireStoreOwner } = require('../middleware/auth');

const router = express.Router();

// Get user's orders
router.get('/my-orders', authenticateToken, async (req, res) => {
    try {
        const [orders] = await req.db.execute(`
            SELECT o.*, s.name as store_name, s.location as store_location
            FROM orders o
            JOIN stores s ON o.store_id = s.id
            WHERE o.user_id = ?
            ORDER BY o.created_at DESC
        `, [req.user.id]);

        // Get order items for each order
        for (let order of orders) {
            const [items] = await req.db.execute(`
                SELECT oi.*, p.name as product_name, p.image_url
                FROM order_items oi
                JOIN products p ON oi.product_id = p.id
                WHERE oi.order_id = ?
            `, [order.id]);
            order.items = items;
        }

        res.json({
            success: true,
            orders
        });

    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch orders',
            error: error.message
        });
    }
});

// Create new order
router.post('/', authenticateToken, async (req, res) => {
    try {
        const {
            store_id,
            items,
            delivery_address,
            delivery_time,
            payment_method,
            special_instructions
        } = req.body;

        if (!store_id) {
            return res.status(400).json({
                success: false,
                message: 'Store ID is required'
            });
        }

        if (!items || items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Order must contain at least one item'
            });
        }

        if (!delivery_address || delivery_address.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Delivery address is required'
            });
        }

        if (!payment_method) {
            return res.status(400).json({
                success: false,
                message: 'Payment method is required'
            });
        }

        // Calculate total
        let total = 0;
        const delivery_fee = 2.99;

        for (let item of items) {
            const [products] = await req.db.execute(
                'SELECT price FROM products WHERE id = ? AND is_available = true',
                [item.product_id]
            );
            if (products.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: `Product ${item.product_id} not found or not available`
                });
            }
            total += products[0].price * item.quantity;
        }

        total += delivery_fee;

        // Generate order number
        const orderNumber = 'ORD' + Date.now() + Math.floor(Math.random() * 1000);

        // Create order
        const [orderResult] = await req.db.execute(
            `INSERT INTO orders (order_number, user_id, store_id, total_amount, delivery_fee, payment_method, delivery_address, delivery_time, special_instructions)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [orderNumber, req.user.id, store_id, total, delivery_fee, payment_method, delivery_address, delivery_time || null, special_instructions || null]
        );

        // Add order items
        for (let item of items) {
            const [products] = await req.db.execute(
                'SELECT price FROM products WHERE id = ?',
                [item.product_id]
            );
            await req.db.execute(
                'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)',
                [orderResult.insertId, item.product_id, item.quantity, products[0].price]
            );
        }

        res.status(201).json({
            success: true,
            message: 'Order created successfully',
            order: {
                id: orderResult.insertId,
                order_number: orderNumber,
                total_amount: total
            }
        });

    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create order',
            error: error.message
        });
    }
});

// Get all orders (Admin only)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { status } = req.query;
        let whereClause = '';
        if (status && status !== 'all') {
            whereClause = `WHERE o.status = '${status}'`;
        }

        const [orders] = await req.db.execute(`
            SELECT o.*, u.first_name, u.last_name, u.email, s.name as store_name,
                   r.first_name as rider_first_name, r.last_name as rider_last_name,
                   (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) as items_count
            FROM orders o
            JOIN users u ON o.user_id = u.id
            JOIN stores s ON o.store_id = s.id
            LEFT JOIN riders r ON o.rider_id = r.id
            ${whereClause}
            ORDER BY o.created_at DESC
        `);

        res.json({
            success: true,
            orders
        });

    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch orders',
            error: error.message
        });
    }
});

// Update order status (Admin or Store Owner)
router.put('/:id/status', authenticateToken, requireStoreOwner, [
    body('status').isIn(['pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled']).withMessage('Invalid status')
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
        const { status } = req.body;

        // Check if order exists and user has permission
        const [orders] = await req.db.execute(`
            SELECT o.*, s.owner_id
            FROM orders o
            JOIN stores s ON o.store_id = s.id
            WHERE o.id = ?
        `, [id]);

        if (orders.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        const order = orders[0];

        // Check ownership permission
        if (req.user.user_type !== 'admin' && order.owner_id !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to update this order'
            });
        }

        await req.db.execute(
            'UPDATE orders SET status = ? WHERE id = ?',
            [status, id]
        );

        res.json({
            success: true,
            message: 'Order status updated successfully'
        });

    } catch (error) {
        console.error('Error updating order:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update order',
            error: error.message
        });
    }
});

// Assign rider to order (Admin only)
router.put('/:id/assign-rider', authenticateToken, requireAdmin, [
    body('rider_id').isInt().withMessage('Rider ID must be a valid integer')
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
        const { rider_id } = req.body;

        // Check if order exists
        const [orders] = await req.db.execute('SELECT id FROM orders WHERE id = ?', [id]);
        if (orders.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        // Check if rider exists and is available
        const [riders] = await req.db.execute(
            'SELECT id FROM riders WHERE id = ? AND is_available = true AND is_active = true',
            [rider_id]
        );
        if (riders.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Rider not found or not available'
            });
        }

        // Set estimated delivery time (current time + 30 minutes)
        const estimatedDelivery = new Date(Date.now() + 30 * 60 * 1000);

        // Assign rider and update status
        await req.db.execute(
            'UPDATE orders SET rider_id = ?, status = ?, estimated_delivery_time = ? WHERE id = ?',
            [rider_id, 'out_for_delivery', estimatedDelivery, id]
        );

        res.json({
            success: true,
            message: 'Rider assigned successfully'
        });

    } catch (error) {
        console.error('Error assigning rider:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to assign rider',
            error: error.message
        });
    }
});

// Update rider location (Rider or Admin)
router.put('/:id/rider-location', authenticateToken, [
    body('location').notEmpty().withMessage('Location is required')
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
        const { location } = req.body;

        // Check if order exists and user has permission (rider or admin)
        const [orders] = await req.db.execute(
            'SELECT rider_id FROM orders WHERE id = ?',
            [id]
        );

        if (orders.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        const order = orders[0];

        // Check ownership permission
        if (req.user.user_type !== 'admin' && order.rider_id !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to update this order'
            });
        }

        await req.db.execute(
            'UPDATE orders SET rider_location = ? WHERE id = ?',
            [location, id]
        );

        res.json({
            success: true,
            message: 'Rider location updated successfully'
        });

    } catch (error) {
        console.error('Error updating rider location:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update rider location',
            error: error.message
        });
    }
});

// Mark order as delivered (Rider or Admin)
router.put('/:id/deliver', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Check if order exists and user has permission (rider or admin)
        const [orders] = await req.db.execute(
            'SELECT rider_id FROM orders WHERE id = ?',
            [id]
        );

        if (orders.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        const order = orders[0];

        // Check ownership permission
        if (req.user.user_type !== 'admin' && order.rider_id !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to update this order'
            });
        }

        await req.db.execute(
            'UPDATE orders SET status = ?, rider_location = ? WHERE id = ?',
            ['delivered', 'Delivered to customer', id]
        );

        res.json({
            success: true,
            message: 'Order marked as delivered successfully'
        });

    } catch (error) {
        console.error('Error marking order as delivered:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to mark order as delivered',
            error: error.message
        });
    }
});

// Get available riders
router.get('/available-riders', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [riders] = await req.db.execute(
            'SELECT id, first_name, last_name, email, phone, vehicle_type FROM riders WHERE is_available = true AND is_active = true ORDER BY first_name ASC'
        );

        res.json({
            success: true,
            riders
        });

    } catch (error) {
        console.error('Error fetching available riders:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch available riders',
            error: error.message
        });
    }
});

// Update payment status (Admin or Rider)
router.put('/:id/payment-status', authenticateToken, async (req, res) => {
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
        const { payment_status } = req.body;

        // Check if order exists and user has permission (rider or admin)
        const [orders] = await req.db.execute(
            'SELECT rider_id FROM orders WHERE id = ?',
            [id]
        );

        if (orders.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        const order = orders[0];

        // Check ownership permission
        if (req.user.user_type !== 'admin' && order.rider_id !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to update this order'
            });
        }

        await req.db.execute(
            'UPDATE orders SET payment_status = ? WHERE id = ?',
            [payment_status, id]
        );

        res.json({
            success: true,
            message: 'Payment status updated successfully'
        });

    } catch (error) {
        console.error('Error updating payment status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update payment status',
            error: error.message
        });
    }
});

// Get rider's deliveries
router.get('/rider/deliveries', authenticateToken, async (req, res) => {
    try {
        if (req.user.user_type !== 'rider') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Rider only.'
            });
        }

        const { status } = req.query;
        let whereClause = 'o.rider_id = ?';
        if (status === 'assigned') {
            whereClause += " AND o.status IN ('out_for_delivery', 'confirmed', 'preparing', 'ready')";
        } else if (status === 'completed') {
            whereClause += " AND o.status = 'delivered'";
        }

        const [deliveries] = await req.db.execute(`
            SELECT o.*, u.first_name, u.last_name, u.phone, s.name as store_name
            FROM orders o
            JOIN users u ON o.user_id = u.id
            JOIN stores s ON o.store_id = s.id
            WHERE ${whereClause}
            ORDER BY o.created_at DESC
        `, [req.user.id]);

        res.json({
            success: true,
            deliveries
        });

    } catch (error) {
        console.error('Error fetching rider deliveries:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch deliveries',
            error: error.message
        });
    }
});

// Get rider profile
router.get('/rider/profile', authenticateToken, async (req, res) => {
    try {
        if (req.user.user_type !== 'rider') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Rider only.'
            });
        }

        const [riders] = await req.db.execute(
            'SELECT id, first_name, last_name, email, phone, vehicle_type FROM riders WHERE id = ?',
            [req.user.id]
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
        console.error('Error fetching rider profile:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch rider profile',
            error: error.message
        });
    }
});

module.exports = router;
