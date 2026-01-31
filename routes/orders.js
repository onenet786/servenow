const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken, requireAdmin, requireStoreOwner } = require('../middleware/auth');
const { sendOrderThanksEmail } = require('../services/emailService');

const router = express.Router();

async function hasColumn(db, table, column) {
    const [rows] = await db.execute(
        'SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        [table, column]
    );
    return rows && rows[0] && rows[0].cnt > 0;
}

async function ensureOrderItemsSchema(db) {
    const columns = [
        { name: 'size_id', definition: 'INT NULL' },
        { name: 'unit_id', definition: 'INT NULL' },
        { name: 'variant_label', definition: 'VARCHAR(255) NULL' },
        { name: 'store_id', definition: 'INT NULL', constraint: 'FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE SET NULL' }
    ];

    for (const col of columns) {
        try {
            const exists = await hasColumn(db, 'order_items', col.name);
            if (!exists) {
                await db.execute(`ALTER TABLE order_items ADD COLUMN ${col.name} ${col.definition}`);
                if (col.constraint) {
                    try {
                        await db.execute(`ALTER TABLE order_items ADD ${col.constraint}`);
                    } catch (err) {
                        // Constraint might already exist or fail for other reasons
                    }
                }
            }
        } catch (e) {
            console.error(`Failed to ensure column ${col.name}:`, e);
        }
    }
}

async function ensureOrdersParentColumn(db) {
    try {
        // Try to select the column to check existence (more robust than information_schema)
        await db.execute('SELECT parent_order_number FROM orders LIMIT 1');
    } catch (e) {
        // If error is about missing column, add it
        if (e.code === 'ER_BAD_FIELD_ERROR' || (e.message && e.message.includes('Unknown column'))) {
            try {
                await db.execute('ALTER TABLE orders ADD COLUMN parent_order_number VARCHAR(50) NULL');
                try {
                    await db.execute('CREATE INDEX idx_orders_parent_order_number ON orders(parent_order_number)');
                } catch (idxErr) {
                    // Ignore index creation error
                }
            } catch (alterErr) {
                console.error('Failed to add parent_order_number column:', alterErr);
            }
        }
    }
}

async function ensureOrdersStoreIdNullable(db) {
    try {
        // Check if store_id is nullable (simplified: just try to modify it)
        await db.execute('ALTER TABLE orders MODIFY COLUMN store_id INT NULL');
    } catch (e) {
        // Ignore if already nullable or other non-critical errors
        // console.error('Failed to make store_id nullable:', e);
    }
}

async function ensureRiderLocationColumns(db) {
    try {
        const hasRiderLatitude = await hasColumn(db, 'orders', 'rider_latitude');
        if (!hasRiderLatitude) {
            await db.execute('ALTER TABLE orders ADD COLUMN rider_latitude DECIMAL(10, 8) NULL');
        }
    } catch (e) {
        console.error('Failed to add rider_latitude column:', e);
    }

    try {
        const hasRiderLongitude = await hasColumn(db, 'orders', 'rider_longitude');
        if (!hasRiderLongitude) {
            await db.execute('ALTER TABLE orders ADD COLUMN rider_longitude DECIMAL(11, 8) NULL');
        }
    } catch (e) {
        console.error('Failed to add rider_longitude column:', e);
    }
}

// Get user's orders
router.get('/my-orders', authenticateToken, async (req, res) => {
    try {
        await ensureOrderItemsSchema(req.db);
        
        const { status } = req.query;
        let query = `
            SELECT o.*, s.name as store_name, s.location as store_location,
                   r.first_name as rider_first_name, r.last_name as rider_last_name, r.phone as rider_phone
            FROM orders o
            LEFT JOIN stores s ON o.store_id = s.id
            LEFT JOIN riders r ON o.rider_id = r.id
            WHERE o.user_id = ?
        `;
        const params = [req.user.id];

        if (status && status !== 'all') {
            if (status === 'pending') {
                query += " AND o.status IN ('pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery')";
            } else {
                query += " AND o.status = ?";
                params.push(status);
            }
        }

        query += " ORDER BY o.created_at DESC";
        
        const [orders] = await req.db.execute(query, params);

        // Get order items for each order
        for (let order of orders) {
            const [items] = await req.db.execute(`
                SELECT oi.*, p.name as product_name, p.image_url, p.store_id, s.name as item_store_name
                FROM order_items oi
                JOIN products p ON oi.product_id = p.id
                LEFT JOIN stores s ON oi.store_id = s.id
                WHERE oi.order_id = ?
            `, [order.id]);
            order.items = items;
            
            // If store_id is NULL (multi-store order), set display name
            if (!order.store_id) {
                order.store_name = 'Multiple Stores';
                order.is_group = true; // reusing existing frontend logic
                
                // Group items by store for display if needed, or just let frontend handle it
                // We can construct sub_orders mock structure for frontend compatibility
                const storeGroups = {};
                items.forEach(item => {
                    if (!storeGroups[item.store_id]) {
                        storeGroups[item.store_id] = {
                            store_name: item.item_store_name,
                            status: order.status, // Inherit main order status
                            items: []
                        };
                    }
                    storeGroups[item.store_id].items.push(item);
                });
                order.sub_orders = Object.values(storeGroups);
            }
        }

        res.json({
            success: true,
            orders: orders
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

// Test notification endpoint
router.get('/test-notification', (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');
        const logEvent = (msg) => {
            fs.appendFileSync(path.join(__dirname, '../socket_debug.log'), `[${new Date().toISOString()}] ${msg}\n`);
        };

        logEvent(`Attempting to emit TEST notification. req.io present: ${!!req.io}`);
        if (req.io) {
            req.io.to('admins').emit('new_order', {
                id: 0,
                order_number: 'TEST-SOCKET',
                total_amount: 0.00,
                created_at: new Date()
            });
            logEvent('TEST notification emitted');
            return res.json({ success: true, message: 'Test notification emitted' });
        }
        logEvent('ERROR: req.io not found for TEST notification');
        res.status(500).json({ success: false, message: 'req.io not found' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Create new order
router.post('/', authenticateToken, async (req, res) => {
    try {
        const {
            items,
            delivery_address,
            delivery_time,
            payment_method,
            special_instructions
        } = req.body;

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

        // Generate Order Number: Ordyymmddxxxx
        const now = new Date();
        const yy = String(now.getFullYear()).slice(-2);
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const datePart = `${yy}${mm}${dd}`;
        const prefix = `Ord${datePart}`;
        
        const [rows] = await req.db.execute(
            'SELECT order_number FROM orders WHERE order_number LIKE ? ORDER BY order_number DESC LIMIT 1',
            [`${prefix}%`]
        );
        
        let sequence = 1;
        if (rows && rows.length > 0) {
            const lastOrderNumber = rows[0].order_number;
            const lastSequenceStr = lastOrderNumber.slice(-4);
            if (/^\d{4}$/.test(lastSequenceStr)) {
                sequence = parseInt(lastSequenceStr, 10) + 1;
            }
        }
        
        const order_number = `${prefix}${String(sequence).padStart(4, '0')}`;
        
        // Validate and prepare items
        const preparedItems = [];
        const storeIds = new Set();
        let itemsSubtotal = 0;

        for (let item of items) {
            const productId = parseInt(String(item.product_id), 10);
            const quantity = parseInt(String(item.quantity), 10);
            const sizeId = item.size_id === null || item.size_id === undefined ? null : parseInt(String(item.size_id), 10);
            const unitId = item.unit_id === null || item.unit_id === undefined ? null : parseInt(String(item.unit_id), 10);
            const providedVariantLabel = item.variant_label ? String(item.variant_label) : null;

            if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
                return res.status(400).json({ success: false, message: 'Invalid order item payload' });
            }

            const [products] = await req.db.execute(
                'SELECT id, price, store_id, name, size_id, unit_id FROM products WHERE id = ? AND is_available = true',
                [productId]
            );

            if (!products || products.length === 0) {
                return res.status(400).json({ success: false, message: `Product ${productId} not found or not available` });
            }

            const product = products[0];
            storeIds.add(product.store_id);
            let unitPrice = Number(product.price);
            let variantLabel = providedVariantLabel;

            if (sizeId || unitId) {
                let query = `
                    SELECT psp.price, sz.label as size_label, u.name as unit_name, u.abbreviation as unit_abbreviation
                    FROM product_size_prices psp
                    LEFT JOIN sizes sz ON psp.size_id = sz.id
                    LEFT JOIN units u ON psp.unit_id = u.id
                    WHERE psp.product_id = ?
                `;
                const params = [productId];

                if (sizeId && unitId) {
                    query += " AND psp.size_id = ? AND psp.unit_id = ?";
                    params.push(sizeId, unitId);
                } else if (sizeId) {
                    query += " AND psp.size_id = ? AND psp.unit_id IS NULL";
                    params.push(sizeId);
                } else if (unitId) {
                    query += " AND psp.unit_id = ? AND psp.size_id IS NULL";
                    params.push(unitId);
                }

                query += " LIMIT 1";

                const [rows] = await req.db.execute(query, params);
                
                if (rows && rows.length > 0) {
                    unitPrice = Number(rows[0].price);
                    if (!variantLabel) {
                        const sizeLabel = rows[0].size_label ? String(rows[0].size_label) : '';
                        const unitLabel = rows[0].unit_abbreviation || rows[0].unit_name ? String(rows[0].unit_abbreviation || rows[0].unit_name) : '';
                        variantLabel = (sizeLabel && unitLabel) ? `${sizeLabel} ${unitLabel}` : (sizeLabel || unitLabel || null);
                    }
                } else {
                    // Fallback: Check if requested variant matches the base product's size/unit
                    const productSizeId = product.size_id === null || product.size_id === undefined ? null : parseInt(String(product.size_id), 10);
                    const productUnitId = product.unit_id === null || product.unit_id === undefined ? null : parseInt(String(product.unit_id), 10);
                    
                    if (sizeId === productSizeId && unitId === productUnitId) {
                        // Match found on base product
                        unitPrice = Number(product.price);
                        // Label remains default or provided
                    } else {
                        return res.status(400).json({ 
                            success: false, 
                            message: `Variant with ${sizeId ? `size ${sizeId}` : ''} ${sizeId && unitId ? 'and ' : ''} ${unitId ? `unit ${unitId}` : ''} not found for product ${productId}` 
                        });
                    }
                }
            }

            preparedItems.push({ productId, quantity, unitPrice, sizeId, unitId, variantLabel, storeId: product.store_id });
            itemsSubtotal += unitPrice * quantity;
        }

        // Enforce store open/closed hours before proceeding
        const storeIdArray = Array.from(storeIds).filter(Boolean);
        if (storeIdArray.length > 0) {
            const placeholders = storeIdArray.map(() => '?').join(',');
            const [storeRows] = await req.db.execute(
                `SELECT id, name, opening_time, closing_time, is_active FROM stores WHERE id IN (${placeholders})`,
                storeIdArray
            );

            const now = new Date();
            const nowDouble = now.getHours() + now.getMinutes() / 60.0;
            const parseTimeStr = (t) => {
                if (!t) return null;
                const parts = String(t).split(':');
                const h = parseInt(parts[0], 10);
                const m = parseInt(parts[1], 10);
                if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
                return h + (m / 60.0);
            };

            for (const s of storeRows) {
                if (!s.is_active) {
                    return res.status(400).json({
                        success: false,
                        message: `Store "${s.name}" is not active at the moment. Please try later.`
                    });
                }
                const openD = parseTimeStr(s.opening_time);
                const closeD = parseTimeStr(s.closing_time);
                if (openD === null || closeD === null) {
                    return res.status(400).json({
                        success: false,
                        message: `Store "${s.name}" is currently closed.`
                    });
                }
                let isOpen;
                if (openD <= closeD) {
                    isOpen = nowDouble >= openD && nowDouble <= closeD;
                } else {
                    // Overnight hours (e.g., 22:00 - 04:00)
                    isOpen = nowDouble >= openD || nowDouble <= closeD;
                }
                if (!isOpen) {
                    return res.status(400).json({
                        success: false,
                        message: `Store "${s.name}" is currently closed. Please order during open hours.`
                    });
                }
            }
        }

        // Calculate delivery fee based on number of unique stores
        const storeCount = storeIds.size;
        let delivery_fee = 0;
        if (storeCount === 1) {
            delivery_fee = 70;
        } else if (storeCount === 2) {
            delivery_fee = 100;
        } else if (storeCount >= 3) {
            delivery_fee = 130 + (storeCount - 3) * 30;
        } else {
            delivery_fee = 70; // Fallback
        }

        const grandTotal = itemsSubtotal + delivery_fee;

        // Check Wallet
        let wallet = null;
        if (payment_method === 'wallet') {
            const [wallets] = await req.db.execute(
                'SELECT id, balance FROM wallets WHERE user_id = ?',
                [req.user.id]
            );

            if (!wallets.length) {
                return res.status(400).json({
                    success: false,
                    message: 'Wallet not found'
                });
            }

            wallet = wallets[0];
            const balance = parseFloat(wallet.balance);
            
            if (balance < grandTotal) {
                return res.status(400).json({
                    success: false,
                    message: `Insufficient wallet balance. Required: PKR ${grandTotal.toFixed(2)}, Available: PKR ${balance.toFixed(2)}`
                });
            }
        }

        // Create Single Order
        await ensureOrderItemsSchema(req.db);
        await ensureOrdersStoreIdNullable(req.db); // Ensure store_id can be NULL
        
        // Determine store_id for the order
        let orderStoreId = null;
        if (storeIds.size === 1) {
            orderStoreId = Array.from(storeIds)[0];
        }

        const [orderResult] = await req.db.execute(
            `INSERT INTO orders (order_number, user_id, store_id, total_amount, delivery_fee, payment_method, delivery_address, delivery_time, special_instructions)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [order_number, req.user.id, orderStoreId, grandTotal, delivery_fee, payment_method, delivery_address, delivery_time || null, special_instructions || null]
        );

        const orderId = orderResult.insertId;

        for (let item of preparedItems) {
            await req.db.execute(
                'INSERT INTO order_items (order_id, product_id, store_id, quantity, price, size_id, unit_id, variant_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [orderId, item.productId, item.storeId, item.quantity, item.unitPrice, item.sizeId, item.unitId, item.variantLabel]
            );
        }

        // Update Wallet
        if (payment_method === 'wallet' && wallet) {
            const newBalance = parseFloat(wallet.balance) - grandTotal;
            
            await req.db.execute(
                'UPDATE wallets SET balance = ?, total_spent = total_spent + ? WHERE id = ?',
                [newBalance, grandTotal, wallet.id]
            );
            
            await req.db.execute(
                `INSERT INTO wallet_transactions (wallet_id, type, amount, description, 
                 reference_type, reference_id, balance_after) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [wallet.id, 'debit', grandTotal, `Order payment - ${order_number}`, 
                 'order', orderId, newBalance]
            );
        }

        // Emit new_order event to admin
        try {
            const fs = require('fs');
            const path = require('path');
            const logEvent = (msg) => {
                try {
                    fs.appendFileSync(path.join(__dirname, '../socket_debug.log'), `[${new Date().toISOString()}] ${msg}\n`);
                } catch (e) {
                    console.error('Failed to write to socket_debug.log:', e);
                }
            };

            logEvent(`Order Created: ${order_number} (ID: ${orderId}). req.io present: ${!!req.io}`);
            if (req.io) {
                req.io.to('admins').emit('new_order', {
                    id: orderId,
                    order_number: order_number,
                    total_amount: grandTotal,
                    store_id: orderStoreId,
                    created_at: new Date(),
                    user_id: req.user.id
                });
                logEvent(`new_order event emitted for ${order_number}. Total clients: ${req.io.engine.clientsCount}`);
            } else {
                logEvent(`WARNING: req.io missing for order ${order_number}`);
            }
        } catch (e) {
            console.error('Socket emit error:', e);
        }

        res.status(201).json({
            success: true,
            message: 'Order created successfully',
            order: {
                id: orderId,
                order_number: order_number,
                total_amount: grandTotal,
                store_id: orderStoreId
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

// Get available riders
router.get('/available-riders', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [riders] = await req.db.execute(
            'SELECT id, first_name, last_name, email, phone, vehicle_type FROM riders WHERE is_active = true AND is_available = true ORDER BY first_name ASC LIMIT 500'
        );

        res.json({
            success: true,
            riders: riders || []
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

// Get current rider's deliveries (for mobile app)
router.get('/rider/deliveries', authenticateToken, async (req, res) => {
    try {
        await ensureOrderItemsSchema(req.db);
        if (req.user.user_type !== 'rider') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Rider only.'
            });
        }

        const riderId = req.user.id;

        // Check if rider exists and is active
        const [riders] = await req.db.execute(
            'SELECT id FROM riders WHERE id = ? AND is_active = true',
            [riderId]
        );

        if (riders.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'Rider account is inactive or not found. Access denied.'
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
            SELECT o.*, u.first_name, u.last_name, u.phone, s.name as store_name, s.location as store_location
            FROM orders o
            JOIN users u ON o.user_id = u.id
            LEFT JOIN stores s ON o.store_id = s.id
            WHERE ${whereClause}
            ORDER BY o.created_at DESC
        `, [riderId]);

        // Fetch items for each delivery
        for (let delivery of deliveries) {
            // Set display name for multi-store orders
            if (!delivery.store_id) {
                delivery.store_name = 'Multiple Stores';
                delivery.store_location = 'Various Locations';
            }

            const [items] = await req.db.execute(`
                SELECT oi.*, p.name as product_name, p.image_url, s.name as store_name
                FROM order_items oi
                LEFT JOIN products p ON oi.product_id = p.id
                LEFT JOIN stores s ON oi.store_id = s.id
                WHERE oi.order_id = ?
            `, [delivery.id]);
            delivery.items = items;
        }

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

// Get rider's deliveries by ID (for admins viewing a specific rider)
router.get('/rider/:riderId/deliveries', authenticateToken, async (req, res) => {
    try {
        await ensureOrderItemsSchema(req.db);
        const { riderId } = req.params;
        const { status } = req.query;
        
        // Only riders can view their own deliveries, admins can view any rider's deliveries
        if (req.user.user_type === 'rider' && req.user.id != riderId) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. You can only view your own deliveries.'
            });
        }
        if (req.user.user_type !== 'rider' && req.user.user_type !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied.'
            });
        }

        let whereClause = 'o.rider_id = ?';
        if (status === 'assigned') {
            whereClause += " AND o.status IN ('out_for_delivery', 'confirmed', 'preparing', 'ready')";
        } else if (status === 'completed') {
            whereClause += " AND o.status = 'delivered'";
        }

        const [deliveries] = await req.db.execute(`
            SELECT o.*, u.first_name, u.last_name, u.phone, s.name as store_name, s.location as store_location
            FROM orders o
            JOIN users u ON o.user_id = u.id
            LEFT JOIN stores s ON o.store_id = s.id
            WHERE ${whereClause}
            ORDER BY o.created_at DESC
        `, [riderId]);

        // Fetch items for each delivery
        for (let delivery of deliveries) {
            // Set display name for multi-store orders
            if (!delivery.store_id) {
                delivery.store_name = 'Multiple Stores';
                delivery.store_location = 'Various Locations';
            }

            const [items] = await req.db.execute(`
                SELECT oi.*, p.name as product_name, p.image_url, s.name as store_name
                FROM order_items oi
                LEFT JOIN products p ON oi.product_id = p.id
                LEFT JOIN stores s ON oi.store_id = s.id
                WHERE oi.order_id = ?
            `, [delivery.id]);
            delivery.items = items;
        }

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
            'SELECT id, first_name, last_name, email, phone, vehicle_type, image_url, id_card_url FROM riders WHERE id = ? AND is_active = true',
            [req.user.id]
        );

        if (riders.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'Rider account is inactive or not found. Access denied.'
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

// Update rider location
router.put('/rider/location', authenticateToken, [
    body('latitude').isFloat().withMessage('Invalid latitude'),
    body('longitude').isFloat().withMessage('Invalid longitude')
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

        if (req.user.user_type !== 'rider') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Rider only.'
            });
        }

        const { latitude, longitude } = req.body;
        const riderId = req.user.id;

        await ensureRiderLocationColumns(req.db);

        // Update rider location in database
        await req.db.execute(
            `UPDATE orders SET rider_latitude = ?, rider_longitude = ?
             WHERE rider_id = ? AND status = 'out_for_delivery'`,
            [latitude, longitude, riderId]
        );

        // Also store in a rider location log table if available
        try {
            await req.db.execute(
                `INSERT INTO rider_location_logs (rider_id, latitude, longitude) VALUES (?, ?, ?)`,
                [riderId, latitude, longitude]
            );
        } catch (e) {
            // Table might not exist yet, that's okay
        }

        res.json({
            success: true,
            message: 'Location updated successfully',
            location: { latitude, longitude }
        });

    } catch (error) {
        console.error('Error updating rider location:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update location',
            error: error.message
        });
    }
});

// Get rider wallet stats (Daily, Weekly, Monthly)
router.get('/rider/wallet-stats', authenticateToken, async (req, res) => {
    try {
        if (req.user.user_type !== 'rider') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Rider only.'
            });
        }

        const riderId = req.user.id;
        const { period } = req.query; // daily, weekly, monthly

        // Check if rider exists and is active
        const [riders] = await req.db.execute(
            'SELECT id FROM riders WHERE id = ? AND is_active = true',
            [riderId]
        );

        if (riders.length === 0) {
            return res.status(403).json({
                success: false,
                message: 'Rider account is inactive or not found. Access denied.'
            });
        }

        let dateCondition = '';
        if (period === 'daily') {
            dateCondition = 'DATE(o.created_at) = CURDATE()';
        } else if (period === 'weekly') {
            dateCondition = 'o.created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)';
        } else if (period === 'monthly') {
            dateCondition = 'o.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)';
        } else {
            dateCondition = 'DATE(o.created_at) = CURDATE()'; // Default to daily
        }

        // 1. Daily Cash Received (Items amount only for cash orders, excluding delivery fee)
        const [cashReceivedResult] = await req.db.execute(`
            SELECT COALESCE(SUM(total_amount - COALESCE(delivery_fee, 0)), 0) as total_cash
            FROM orders o
            WHERE o.rider_id = ? AND o.payment_method = 'cash' AND o.payment_status = 'paid' AND o.status = 'delivered' AND ${dateCondition}
        `, [riderId]);

        // 2. Delivery Fees (All delivered orders regardless of payment method)
        const [deliveryFeesResult] = await req.db.execute(`
            SELECT COALESCE(SUM(delivery_fee), 0) as total_delivery_fees
            FROM orders o
            WHERE o.rider_id = ? AND o.status = 'delivered' AND ${dateCondition}
        `, [riderId]);

        // 3. Payment Summary (Breakdown by payment method)
        const [summaryResult] = await req.db.execute(`
            SELECT 
                payment_method,
                COUNT(*) as order_count,
                SUM(total_amount) as total_amount,
                SUM(delivery_fee) as total_delivery_fees
            FROM orders o
            WHERE o.rider_id = ? AND o.status = 'delivered' AND ${dateCondition}
            GROUP BY payment_method
        `, [riderId]);

        res.json({
            success: true,
            stats: {
                period,
                cash_received: cashReceivedResult[0].total_cash,
                total_delivery_fees: deliveryFeesResult[0].total_delivery_fees,
                payment_summary: summaryResult
            }
        });

    } catch (error) {
        console.error('Error fetching rider wallet stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch wallet stats',
            error: error.message
        });
    }
});

// Get single order details
router.get('/:id(\\d+)', authenticateToken, async (req, res) => {
    console.log(`[orders] Fetching order details for ID: ${req.params.id}`);
    try {
        const { id } = req.params;
        await ensureOrderItemsSchema(req.db);

        const [orders] = await req.db.execute(`
            SELECT o.*, u.first_name, u.last_name, u.email, u.phone, s.name as store_name,
                   r.first_name as rider_first_name, r.last_name as rider_last_name, r.phone as rider_phone
            FROM orders o
            JOIN users u ON o.user_id = u.id
            LEFT JOIN stores s ON o.store_id = s.id
            LEFT JOIN riders r ON o.rider_id = r.id
            WHERE o.id = ?
        `, [id]);

        console.log(`[orders] Found ${orders.length} orders for ID: ${id}`);

        if (orders.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        const order = orders[0];

        // Check permission: Admin, Rider assigned, or Customer who owns the order
        if (req.user.user_type !== 'admin' && 
            req.user.id !== order.user_id && 
            (req.user.user_type === 'rider' && req.user.id !== order.rider_id)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

        // Get order items with store info
        const [items] = await req.db.execute(`
            SELECT oi.*, p.name as product_name, p.image_url, s.name as store_name
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            LEFT JOIN stores s ON oi.store_id = s.id
            WHERE oi.order_id = ?
        `, [id]);
        
        order.items = items;

        // Group items by store for proper multi-store display
        const storeGroups = {};
        items.forEach(item => {
            const sId = item.store_id || 'unknown';
            if (!storeGroups[sId]) {
                storeGroups[sId] = {
                    store_id: item.store_id,
                    store_name: item.store_name || 'Unknown Store',
                    items: []
                };
            }
            storeGroups[sId].items.push(item);
        });
        
        order.store_wise_items = Object.values(storeGroups);

        res.json({
            success: true,
            order
        });

    } catch (error) {
        console.error('Error fetching order details:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch order details',
            error: error.message
        });
    }
});

// Get all orders (Admin only)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { status, assignment, startDate, endDate } = req.query;
        let conditions = [];
        let params = [];
        
        if (status && status !== 'all') {
            conditions.push(`o.status = ?`);
            params.push(status);
        }

        if (assignment === 'unassigned') {
            conditions.push(`o.rider_id IS NULL AND o.status NOT IN ('delivered', 'cancelled')`);
        } else if (assignment === 'assigned') {
            conditions.push(`o.rider_id IS NOT NULL`);
        }

        if (startDate) {
            conditions.push(`DATE(o.created_at) >= ?`);
            params.push(startDate);
        }

        if (endDate) {
            conditions.push(`DATE(o.created_at) <= ?`);
            params.push(endDate);
        }

        let whereClause = '';
        if (conditions.length > 0) {
            whereClause = 'WHERE ' + conditions.join(' AND ');
        }

        const [orders] = await req.db.execute(`
            SELECT o.*, u.first_name, u.last_name, u.email, s.name as store_name,
                   r.first_name as rider_first_name, r.last_name as rider_last_name,
                   CAST((SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS SIGNED) as items_count
            FROM orders o
            JOIN users u ON o.user_id = u.id
            LEFT JOIN stores s ON o.store_id = s.id
            LEFT JOIN riders r ON o.rider_id = r.id
            ${whereClause}
            ORDER BY o.created_at DESC
        `, params);

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
router.put('/:id(\\d+)/status', authenticateToken, requireStoreOwner, [
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
            LEFT JOIN stores s ON o.store_id = s.id
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
        if (req.user.user_type !== 'admin' && (!order.owner_id || order.owner_id !== req.user.id)) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to update this order'
            });
        }

        await req.db.execute(
            'UPDATE orders SET status = ? WHERE id = ?',
            [status, id]
        );

        // Emit order_status_update event - only to specific rooms to avoid duplicates
        try {
            if (req.io) {
                const statusUpdateData = {
                    id: id,
                    order_number: order.order_number,
                    status: status,
                    user_id: order.user_id,
                    updated_at: new Date()
                };
                // Send to user room only (avoid duplicate by not sending to all)
                req.io.to(`user_${order.user_id}`).emit('order_status_update', statusUpdateData);
                req.io.to('admins').emit('order_status_update', statusUpdateData);
                
                const fs = require('fs');
                const path = require('path');
                const logMsg = `[${new Date().toISOString()}] Status updated: ${order.order_number} -> ${status}. Total clients: ${req.io.engine.clientsCount}\n`;
                fs.appendFileSync(path.join(__dirname, '../socket_debug.log'), logMsg);
            }
        } catch (e) {
            console.error('Socket emit error:', e);
        }

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
router.put('/:id(\\d+)/assign-rider', authenticateToken, requireAdmin, [
    body('rider_id').isInt().withMessage('Rider ID must be a valid integer'),
    body('delivery_fee').optional().isFloat({ min: 0 }).withMessage('Invalid delivery fee')
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
        const { rider_id, delivery_fee } = req.body;

        // Check if order exists
        const [orders] = await req.db.execute('SELECT id, order_number, user_id, total_amount, delivery_fee, status FROM orders WHERE id = ?', [id]);
        if (orders.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        const order = orders[0];

        // Do not allow assigning riders to already completed or cancelled orders
        if (order.status === 'delivered' || order.status === 'cancelled') {
            return res.status(400).json({
                success: false,
                message: `Cannot assign rider to an order that is already ${order.status}`
            });
        }

        // Check if rider exists and is available
        const [riders] = await req.db.execute(
            'SELECT id, first_name, last_name FROM riders WHERE id = ? AND is_active = true',
            [rider_id]
        );
        if (riders.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Rider not found or not active'
            });
        }

        const rider = riders[0];

        // Set estimated delivery time (current time + 30 minutes)
        const estimatedDelivery = new Date(Date.now() + 30 * 60 * 1000);

        // Recalculate total based on actual items
        const [items] = await req.db.execute(
            'SELECT price, quantity FROM order_items WHERE order_id = ?',
            [id]
        );

        let itemsSubtotal = 0;
        for (const item of items) {
            itemsSubtotal += (parseFloat(item.price) || 0) * (parseInt(item.quantity) || 0);
        }

        let newTotal = order.total_amount;
        let finalDeliveryFee = parseFloat(order.delivery_fee) || 0;

        if (delivery_fee !== undefined) {
            finalDeliveryFee = parseFloat(delivery_fee);
            newTotal = Number(itemsSubtotal) + Number(finalDeliveryFee);
        } else if (itemsSubtotal > 0) {
            // Ensure total_amount is correct even if delivery_fee is not being updated
            newTotal = parseFloat(itemsSubtotal) + parseFloat(finalDeliveryFee);
        }

        // Assign rider and update status
        await req.db.execute(
            'UPDATE orders SET rider_id = ?, status = ?, estimated_delivery_time = ?, delivery_fee = ?, total_amount = ? WHERE id = ?',
            [rider_id, 'out_for_delivery', estimatedDelivery, finalDeliveryFee, newTotal, id]
        );

        // Emit order_assigned event
        try {
            if (req.io) {
                const orderData = {
                    id: id,
                    order_number: order.order_number,
                    rider_id: rider_id,
                    rider_name: `${rider.first_name} ${rider.last_name}`,
                    status: 'out_for_delivery',
                    estimated_delivery_time: estimatedDelivery,
                    delivery_fee: finalDeliveryFee,
                    total_amount: newTotal
                };

                console.log(`[Orders] Broadcasting order_assigned to admins`, orderData);
                req.io.to('admins').emit('order_assigned', orderData);

                const riderRoomName = `rider_${rider_id}`;
                const userRoomName = `user_${order.user_id}`;
                
                console.log(`[Orders] Emitting rider_notification to room: ${riderRoomName}`, { rider_id, order_number: order.order_number });
                req.io.to(riderRoomName).emit('rider_notification', {
                    type: 'assigned',
                    rider_id: rider_id,
                    order_id: id,
                    order_number: order.order_number,
                    message: `New order assigned: ${order.order_number}`,
                    timestamp: new Date()
                });

                console.log(`[Orders] Emitting user_notification to room: ${userRoomName}`, { user_id: order.user_id, order_number: order.order_number });
                req.io.to(userRoomName).emit('user_notification', {
                    type: 'order_update',
                    user_id: order.user_id,
                    order_id: id,
                    order_number: order.order_number,
                    status: 'out_for_delivery',
                    message: `Your order ${order.order_number} has been assigned to rider ${rider.first_name}.`,
                    timestamp: new Date()
                });

                const fs = require('fs');
                const path = require('path');
                const logMsg = `[${new Date().toISOString()}] Order assigned: ${order.order_number} to ${rider.first_name}. Sent to rooms: ${riderRoomName}, ${userRoomName}\n`;
                fs.appendFileSync(path.join(__dirname, '../socket_debug.log'), logMsg);
            }
        } catch (e) {
            console.error('Socket emit error:', e);
        }

        res.json({
            success: true,
            message: 'Rider assigned successfully',
            delivery_fee: finalDeliveryFee,
            total_amount: newTotal
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

// Update delivery fee (Admin only) - Auto-calculates based on unique stores in order
router.put('/:id(\\d+)/delivery-fee', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { delivery_fee: manual_delivery_fee } = req.body;

        // Check if order exists
        const [orders] = await req.db.execute(
            'SELECT id, total_amount, delivery_fee as old_delivery_fee FROM orders WHERE id = ?',
            [id]
        );
        if (orders.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        const order = orders[0];
        
        // Get order items to calculate items subtotal
        const [items] = await req.db.execute(`
            SELECT DISTINCT store_id, price, quantity FROM order_items WHERE order_id = ?
        `, [id]);
        
        // Calculate items subtotal from actual items
        let itemsSubtotal = 0;
        for (const item of items) {
            itemsSubtotal += (parseFloat(item.price) || 0) * (parseInt(item.quantity) || 0);
        }
        
        let delivery_fee;
        let is_manual = false;

        if (manual_delivery_fee !== undefined && manual_delivery_fee !== null) {
            delivery_fee = parseFloat(manual_delivery_fee);
            if (isNaN(delivery_fee)) {
                return res.status(400).json({ success: false, message: 'Invalid delivery fee provided' });
            }
            is_manual = true;
        } else {
            // Count unique stores for auto-calculation
            const storeIds = new Set(items.map(item => item.store_id).filter(Boolean));
            const storeCount = storeIds.size;
            
            // Calculate delivery fee based on number of unique stores
            if (storeCount === 1) {
                delivery_fee = 70;
            } else if (storeCount === 2) {
                delivery_fee = 100;
            } else if (storeCount >= 3) {
                delivery_fee = 130 + (storeCount - 3) * 30;
            } else {
                delivery_fee = 70;
            }
        }
        
        // Recalculate total from items subtotal
        const newTotal = itemsSubtotal + delivery_fee;

        // Update delivery fee and total
        await req.db.execute(
            'UPDATE orders SET delivery_fee = ?, total_amount = ? WHERE id = ?',
            [Number(delivery_fee), newTotal, id]
        );

        res.json({
            success: true,
            message: is_manual ? 'Delivery fee updated manually' : 'Delivery fee auto-calculated and updated successfully',
            delivery_fee: parseFloat(delivery_fee),
            total_amount: newTotal
        });

    } catch (error) {
        console.error('Error updating delivery fee:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update delivery fee',
            error: error.message
        });
    }
});

// Update rider location (Rider or Admin)
router.put('/:id(\\d+)/rider-location', authenticateToken, [
    body('latitude').optional().isFloat().withMessage('Invalid latitude'),
    body('longitude').optional().isFloat().withMessage('Invalid longitude'),
    body('location').optional().notEmpty().withMessage('Location is required')
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
        const { location, latitude, longitude } = req.body;

        // Check if order exists and user has permission (rider or admin)
        const [orders] = await req.db.execute(
            'SELECT id, rider_id, user_id, order_number, total_amount, payment_status, status FROM orders WHERE id = ?',
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

        await ensureRiderLocationColumns(req.db);

        if (latitude !== undefined && longitude !== undefined) {
            await req.db.execute(
                'UPDATE orders SET rider_latitude = ?, rider_longitude = ? WHERE id = ?',
                [latitude, longitude, id]
            );
        }

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
router.put('/:id(\\d+)/deliver', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Check if order exists and user has permission (rider or admin)
        const [orders] = await req.db.execute(
            `SELECT o.id, o.rider_id, o.user_id, o.order_number, o.total_amount, o.delivery_fee, o.payment_method, o.payment_status, o.status,
                    u.email as user_email, u.first_name as user_first_name
             FROM orders o
             JOIN users u ON o.user_id = u.id
             WHERE o.id = ?`,
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
            'UPDATE orders SET status = ? WHERE id = ?',
            ['delivered', id]
        );

        // Notifications - only to specific rooms to avoid duplicates
        try {
            if (req.io) {
                // Status update to user room only (not to all)
                const statusUpdateData = {
                    id: id,
                    order_number: order.order_number,
                    status: 'delivered',
                    user_id: order.user_id,
                    updated_at: new Date()
                };
                req.io.to(`user_${order.user_id}`).emit('order_status_update', statusUpdateData);
                req.io.to('admins').emit('order_status_update', statusUpdateData);

                // User notification
                const userNotifData = {
                    type: 'order_update',
                    user_id: order.user_id,
                    order_id: id,
                    order_number: order.order_number,
                    status: 'delivered',
                    message: `Your order ${order.order_number} has been delivered.`,
                    timestamp: new Date()
                };
                req.io.to(`user_${order.user_id}`).emit('user_notification', userNotifData);

                // Admin notification
                const adminNotifData = {
                    type: 'order_update',
                    order_id: id,
                    order_number: order.order_number,
                    status: 'delivered',
                    message: `Order ${order.order_number} has been delivered by rider.`,
                    timestamp: new Date()
                };
                req.io.to('admins').emit('user_notification', adminNotifData);

                // Check if completed (paid + delivered)
                if (order.payment_status === 'paid') {
                    const completedData = {
                        id: id,
                        order_number: order.order_number,
                        user_id: order.user_id,
                        total_amount: order.total_amount,
                        message: `Thank you for choosing ServeNow! Your order ${order.order_number} has been completed and delivered.`,
                        timestamp: new Date()
                    };
                    // Send to user room only (not to all)
                    req.io.to(`user_${order.user_id}`).emit('order_completed', completedData);
                    req.io.to('admins').emit('order_completed', completedData);

                    // Send Thanks Email
                    if (order.user_email) {
                        sendOrderThanksEmail(order.user_email, order.user_first_name || 'Customer', order.order_number);
                    }
                }
            }
        } catch (e) {
            console.error('Socket emit error in deliver:', e);
        }

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

// Update payment status (Admin or Rider)
router.put('/:id(\\d+)/payment-status', authenticateToken, [
    body('payment_status').isIn(['pending', 'paid', 'failed']).withMessage('Invalid payment status')
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
        const { payment_status } = req.body;

        if (!payment_status) {
            return res.status(400).json({
                success: false,
                message: 'Payment status is required'
            });
        }

        // Check if order exists and user has permission (rider or admin)
        const [orders] = await req.db.execute(
            `SELECT o.id, o.rider_id, o.user_id, o.order_number, o.total_amount, o.delivery_fee, o.payment_method, o.payment_status, o.status,
                    u.email as user_email, u.first_name as user_first_name
             FROM orders o
             JOIN users u ON o.user_id = u.id
             WHERE o.id = ?`,
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

        if (payment_status === 'paid' && order.rider_id && order.payment_status !== 'paid') {
            // Calculate rider earnings based on payment method
            // For cash: rider gets the full order amount (customer paid cash)
            // For card/wallet: rider gets only delivery fee (customer already paid card/wallet to store)
            const riderEarnings = order.payment_method === 'cash' 
                ? parseFloat(order.total_amount || 0) 
                : parseFloat(order.delivery_fee || 0);
            
            const [wallets] = await req.db.execute(
                'SELECT id, balance FROM wallets WHERE rider_id = ?',
                [order.rider_id]
            );

            if (wallets.length > 0) {
                const wallet = wallets[0];
                const newBalance = parseFloat(wallet.balance || 0) + riderEarnings;
                
                await req.db.execute(
                    'UPDATE wallets SET balance = ?, total_credited = total_credited + ? WHERE id = ?',
                    [newBalance, riderEarnings, wallet.id]
                );

                await req.db.execute(
                    `INSERT INTO wallet_transactions (wallet_id, type, amount, description, reference_type, reference_id, balance_after) 
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [wallet.id, 'credit', riderEarnings, `Payment received for order #${id}`, 'order', id, newBalance]
                );
            } else {
                await req.db.execute(
                    'INSERT INTO wallets (rider_id, user_type, balance, total_credited) VALUES (?, ?, ?, ?)',
                    [order.rider_id, 'rider', riderEarnings, riderEarnings]
                );

                const [newWallets] = await req.db.execute(
                    'SELECT id FROM wallets WHERE rider_id = ?',
                    [order.rider_id]
                );

                if (newWallets.length > 0) {
                    await req.db.execute(
                        `INSERT INTO wallet_transactions (wallet_id, type, amount, description, reference_type, reference_id, balance_after) 
                         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [newWallets[0].id, 'credit', riderEarnings, `Payment received for order #${id}`, 'order', id, riderEarnings]
                    );
                }
            }

            // Create rider cash movement for cash payments to show in financial menu
            if (order.payment_method === 'cash') {
                try {
                    const movementDate = new Date().toISOString().split('T')[0];
                    const dateStr = movementDate.replace(/-/g, '');
                    const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase();
                    const movementNumber = `RCM-${dateStr}-${randomStr}`;
                    
                    await req.db.execute(
                        `INSERT INTO rider_cash_movements 
                         (movement_number, rider_id, movement_date, movement_type, amount, description, reference_type, reference_id, status, recorded_by)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            movementNumber, 
                            order.rider_id, 
                            movementDate, 
                            'cash_collection', 
                            order.total_amount, 
                            `Cash collection for Order #${order.order_number}`, 
                            'order', 
                            id, 
                            'completed',
                            req.user.user_type === 'admin' ? req.user.id : null
                        ]
                    );
                } catch (err) {
                    console.error('Error creating rider cash movement:', err);
                    // Don't fail the whole request if financial recording fails, but log it
                }
            }
        }

        // Notifications - only to specific rooms to avoid duplicates
        try {
            if (req.io) {
                const paymentUpdateData = {
                    id: id,
                    order_number: order.order_number,
                    payment_status: payment_status,
                    user_id: order.user_id,
                    timestamp: new Date()
                };
                // Send to user room only (not to all)
                req.io.to(`user_${order.user_id}`).emit('payment_status_update', paymentUpdateData);
                req.io.to('admins').emit('payment_status_update', paymentUpdateData);

                // User notification
                const userPaymentNotif = {
                    type: 'payment_status_update',
                    order_id: id,
                    order_number: order.order_number,
                    payment_status: payment_status,
                    message: `Payment received for order ${order.order_number}.`,
                    timestamp: new Date()
                };
                req.io.to(`user_${order.user_id}`).emit('user_notification', userPaymentNotif);

                // Admin notification
                const adminPaymentNotif = {
                    type: 'payment_status_update',
                    order_id: id,
                    order_number: order.order_number,
                    payment_status: payment_status,
                    message: `Payment ${payment_status} for order ${order.order_number}.`,
                    timestamp: new Date()
                };
                req.io.to('admins').emit('user_notification', adminPaymentNotif);

                // Check if completed (paid + delivered)
                if (payment_status === 'paid' && order.status === 'delivered') {
                    const completedData = {
                        id: id,
                        order_number: order.order_number,
                        user_id: order.user_id,
                        total_amount: order.total_amount,
                        message: `Thank you for choosing ServeNow! Your order ${order.order_number} has been completed and delivered.`,
                        timestamp: new Date()
                    };
                    // Send to user room only (not to all)
                    req.io.to(`user_${order.user_id}`).emit('order_completed', completedData);
                    req.io.to('admins').emit('order_completed', completedData);

                    // Send Thanks Email
                    if (order.user_email) {
                        sendOrderThanksEmail(order.user_email, order.user_first_name || 'Customer', order.order_number);
                    }
                }
            }
        } catch (e) {
            console.error('Socket emit error in payment-status:', e);
        }

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

router.put('/:id(\\d+)/items', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { items, store_id } = req.body;

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Items array is required and cannot be empty'
            });
        }

        const [orders] = await req.db.execute(
            'SELECT * FROM orders WHERE id = ?',
            [id]
        );

        if (orders.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        const order = orders[0];

        if (order.status === 'delivered' || order.status === 'cancelled') {
            return res.status(400).json({
                success: false,
                message: `Cannot update items for ${order.status} orders`
            });
        }

        let itemsSubtotal = 0;

        for (const item of items) {
            const { id: itemId, quantity } = item;

            if (!quantity || quantity < 1) {
                return res.status(400).json({
                    success: false,
                    message: 'All items must have a quantity of at least 1'
                });
            }

            if (itemId) {
                const [existingItems] = await req.db.execute(
                    'SELECT price FROM order_items WHERE id = ? AND order_id = ?',
                    [itemId, id]
                );

                if (existingItems.length === 0) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid item ID'
                    });
                }

                const price = existingItems[0].price;
                const updateFields = ['quantity = ?'];
                const updateValues = [quantity];

                if (store_id && store_id !== null) {
                    updateFields.push('store_id = ?');
                    updateValues.push(store_id);
                }

                updateValues.push(itemId);
                updateValues.push(id);

                await req.db.execute(
                    `UPDATE order_items SET ${updateFields.join(', ')} WHERE id = ? AND order_id = ?`,
                    updateValues
                );

                itemsSubtotal += price * quantity;
            }
        }

        const totalAmount = Number(itemsSubtotal) + Number(order.delivery_fee || 0);

        await req.db.execute(
            'UPDATE orders SET total_amount = ? WHERE id = ?',
            [totalAmount, id]
        );

        res.json({
            success: true,
            message: 'Order items updated successfully'
        });

    } catch (error) {
        console.error('Error updating order items:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update order items',
            error: error.message
        });
    }
});

router.get('/:id(\\d+)/items', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        const [orders] = await req.db.execute(
            'SELECT id, status, store_id, total_amount, delivery_fee, rider_id, rider_location, rider_latitude, rider_longitude FROM orders WHERE id = ?',
            [id]
        );

        if (orders.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        const [items] = await req.db.execute(`
            SELECT oi.id, oi.product_id, oi.quantity, oi.price, oi.store_id,
                   p.name as product_name, p.image_url,
                   s.name as store_name
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            LEFT JOIN stores s ON oi.store_id = s.id
            WHERE oi.order_id = ?
            ORDER BY oi.id ASC
        `, [id]);

        const [stores] = await req.db.execute(`
            SELECT DISTINCT s.id, s.name
            FROM stores s
            INNER JOIN products p ON s.id = p.store_id
            WHERE s.is_active = true AND p.is_available = true
            ORDER BY s.name ASC
        `);

        res.json({
            success: true,
            order: orders[0],
            items: items || [],
            availableStores: stores || []
        });

    } catch (error) {
        console.error('Error fetching order items:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch order items',
            error: error.message
        });
    }
});

router.post('/:id(\\d+)/items/add', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { product_id, quantity, store_id } = req.body;

        if (!product_id || !quantity || quantity < 1) {
            return res.status(400).json({
                success: false,
                message: 'Product ID and quantity (minimum 1) are required'
            });
        }

        const [orders] = await req.db.execute(
            'SELECT * FROM orders WHERE id = ?',
            [id]
        );

        if (orders.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        const order = orders[0];

        if (order.status === 'delivered' || order.status === 'cancelled') {
            return res.status(400).json({
                success: false,
                message: `Cannot add items to ${order.status} orders`
            });
        }

        const [products] = await req.db.execute(
            'SELECT id, price, cost_price, store_id FROM products WHERE id = ? AND is_available = true',
            [product_id]
        );

        if (products.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Product not found or unavailable'
            });
        }

        const product = products[0];
        const price = product.price;

        const itemStoreId = store_id || order.store_id || product.store_id || null;

        const [result] = await req.db.execute(`
            INSERT INTO order_items (order_id, product_id, quantity, price, store_id)
            VALUES (?, ?, ?, ?, ?)
        `, [id, product_id, quantity, price, itemStoreId]);

        const [currentItems] = await req.db.execute(
            'SELECT SUM(quantity * price) as total FROM order_items WHERE order_id = ?',
            [id]
        );

        const itemsSubtotal = Number(currentItems[0]?.total || 0);
        const newTotal = itemsSubtotal + Number(order.delivery_fee || 0);
        await req.db.execute(
            'UPDATE orders SET total_amount = ? WHERE id = ?',
            [newTotal, id]
        );

        res.json({
            success: true,
            message: 'Item added successfully',
            item_id: result.insertId
        });

    } catch (error) {
        console.error('Error adding item to order:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add item to order',
            error: error.message
        });
    }
});

router.delete('/:id(\\d+)/items/:itemId(\\d+)', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id, itemId } = req.params;

        const [orders] = await req.db.execute(
            'SELECT * FROM orders WHERE id = ?',
            [id]
        );

        if (orders.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        const order = orders[0];

        if (order.status === 'delivered' || order.status === 'cancelled') {
            return res.status(400).json({
                success: false,
                message: `Cannot remove items from ${order.status} orders`
            });
        }

        const [items] = await req.db.execute(
            'SELECT id FROM order_items WHERE id = ? AND order_id = ?',
            [itemId, id]
        );

        if (items.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Item not found in this order'
            });
        }

        await req.db.execute(
            'DELETE FROM order_items WHERE id = ? AND order_id = ?',
            [itemId, id]
        );

        const [currentItems] = await req.db.execute(
            'SELECT SUM(quantity * price) as total FROM order_items WHERE order_id = ?',
            [id]
        );

        const itemsSubtotal = Number(currentItems[0]?.total || 0);
        const newTotal = itemsSubtotal + Number(order.delivery_fee || 0);
        await req.db.execute(
            'UPDATE orders SET total_amount = ? WHERE id = ?',
            [newTotal, id]
        );

        const [remainingItems] = await req.db.execute(
            'SELECT COUNT(*) as count FROM order_items WHERE order_id = ?',
            [id]
        );

        if (remainingItems[0].count === 0) {
            return res.json({
                success: true,
                message: 'Item removed. Order has no items left.',
                empty: true
            });
        }

        res.json({
            success: true,
            message: 'Item removed successfully'
        });

    } catch (error) {
        console.error('Error removing item from order:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to remove item from order',
            error: error.message
        });
    }
});

router.get('/:id(\\d+)/available-products', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { store_id } = req.query;

        const [orders] = await req.db.execute(
            'SELECT store_id FROM orders WHERE id = ?',
            [id]
        );

        if (orders.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        const orderStoreId = orders[0].store_id;
        const filterStoreId = store_id || orderStoreId;

        let query = `
            SELECT p.id, p.name, p.price
            FROM products p
            INNER JOIN stores s ON p.store_id = s.id
            WHERE p.is_available = true AND s.is_active = true
        `;
        
        const params = [];
        
        if (filterStoreId) {
            query += ' AND p.store_id = ?';
            params.push(filterStoreId);
        }

        query += ' ORDER BY p.name ASC LIMIT 1000';

        const [products] = await req.db.execute(query, params);

        res.json({
            success: true,
            products: products || [],
            order_store_id: orderStoreId
        });

    } catch (error) {
        console.error('Error fetching available products:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch products',
            error: error.message
        });
    }
});

module.exports = router;
