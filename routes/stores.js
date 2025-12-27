const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken, requireAdmin, requireStoreOwner } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sharp = (() => {
    try { return require('sharp'); } catch (e) { console.warn('sharp not installed, image resizing disabled'); return null; }
})();
const upload = multer({ dest: path.join(__dirname, '..', 'uploads', 'tmp') });

const router = express.Router();

async function loadProductSizeVariants(db, productIds) {
    try {
        const ids = (Array.isArray(productIds) ? productIds : [])
            .map(x => parseInt(String(x), 10))
            .filter(x => Number.isInteger(x) && x > 0);
        if (!ids.length) return {};

        const placeholders = ids.map(() => '?').join(',');
        const [rows] = await db.execute(
            `
                SELECT psp.product_id, psp.size_id, psp.unit_id, psp.price, psp.cost_price, psp.sort_order,
                       sz.label as size_label, u.name as unit_name, u.abbreviation as unit_abbreviation
                FROM product_size_prices psp
                LEFT JOIN sizes sz ON psp.size_id = sz.id
                LEFT JOIN units u ON psp.unit_id = u.id
                WHERE psp.product_id IN (${placeholders})
                ORDER BY psp.product_id ASC, psp.sort_order ASC, psp.id ASC
            `,
            ids
        );

        const out = {};
        for (const r of rows || []) {
            const pid = r.product_id;
            if (!out[pid]) out[pid] = [];
            out[pid].push({
                size_id: r.size_id,
                size_label: r.size_label || null,
                unit_id: r.unit_id === null || r.unit_id === undefined ? null : Number(r.unit_id),
                unit_name: r.unit_name || null,
                unit_abbreviation: r.unit_abbreviation || null,
                price: Number(r.price),
                cost_price: r.cost_price === null || r.cost_price === undefined ? null : Number(r.cost_price)
            });
        }
        return out;
    } catch (e) {
        return {};
    }
}

// Get all stores (optionally filter by category via products)
router.get('/', async (req, res) => {
    try {
        const { category, category_id, search, admin } = req.query;
        const whereClauses = admin === '1' ? [] : ['s.is_active = true'];
        const params = [];

        if (search) {
            const searchTerm = `%${search}%`;
            whereClauses.push(`(
                EXISTS (
                    SELECT 1 FROM products p 
                    WHERE p.store_id = s.id 
                    AND p.is_available = true 
                    AND p.name LIKE ?
                )
            )`);
            params.push(searchTerm);
        }

        if (category_id || category) {
            if (category_id && /^\d+$/.test(String(category_id))) {
                whereClauses.push(`
                    EXISTS (
                        SELECT 1
                        FROM products p
                        WHERE p.store_id = s.id
                          AND p.is_available = true
                          AND p.category_id = ?
                    )
                `);
                params.push(parseInt(category_id, 10));
            } else if (category) {
                whereClauses.push(`
                    EXISTS (
                        SELECT 1
                        FROM products p
                        LEFT JOIN categories c ON p.category_id = c.id
                        WHERE p.store_id = s.id
                          AND p.is_available = true
                          AND LOWER(c.name) = LOWER(REPLACE(?, "-", " "))
                    )
                `);
                params.push(String(category));
            }
        }

        const whereClause = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';
        const [stores] = await req.db.execute(`
            SELECT s.*, u.first_name as owner_first_name, u.last_name as owner_last_name, u.email as owner_email
            FROM stores s
            LEFT JOIN users u ON s.owner_id = u.id
            ${whereClause}
            ORDER BY s.rating DESC, s.name ASC
        `, params);

        res.json({
            success: true,
            stores: stores.map(store => ({
                id: store.id,
                name: store.name,
                location: store.location,
                opening_time: store.opening_time || null,
                closing_time: store.closing_time || null,
                payment_term: store.payment_term || null,
                latitude: store.latitude,
                longitude: store.longitude,
                rating: store.rating,
                delivery_time: store.delivery_time,
                phone: store.phone,
                email: store.email,
                address: store.address,
                description: store.description,
                image_url: store.cover_image || null,
                is_active: store.is_active,
                owner_id: store.owner_id || null,
                owner_email: store.owner_email || null,
                owner_name: store.owner_name || null
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
            SELECT s.*, u.first_name as owner_first_name, u.last_name as owner_last_name, u.email as owner_email
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
            SELECT p.*, c.name as category_name, u.name as unit_name, u.abbreviation as unit_abbreviation,
                   sz.label as size_label
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN units u ON p.unit_id = u.id
            LEFT JOIN sizes sz ON p.size_id = sz.id
            WHERE p.store_id = ? AND p.is_available = true
            ORDER BY p.name ASC
        `, [id]);

        const variantsByProductId = await loadProductSizeVariants(req.db, (products || []).map(p => p.id));

        res.json({
            success: true,
            store: {
                id: store.id,
                name: store.name,
                location: store.location,
                opening_time: store.opening_time || null,
                closing_time: store.closing_time || null,
                payment_term: store.payment_term || null,
                latitude: store.latitude,
                longitude: store.longitude,
                rating: store.rating,
                delivery_time: store.delivery_time,
                phone: store.phone,
                email: store.email,
                address: store.address,
                description: store.description,
                owner_id: store.owner_id,
                category_id: store.category_id || null,
                image_url: store.cover_image || null,
                owner_email: store.owner_email || null,
                owner_name: store.owner_name || null
            },
            products: products.map(product => ({
                id: product.id,
                name: product.name,
                description: product.description,
                price: product.price,
                image_url: product.image_url,
                category_name: product.category_name,
                stock_quantity: product.stock_quantity,
                is_available: product.is_available,
                unit_id: product.unit_id,
                unit_name: product.unit_name,
                unit_abbreviation: product.unit_abbreviation,
                size_id: product.size_id,
                size_label: product.size_label,
                store_id: product.store_id
                ,
                size_variants: (variantsByProductId[product.id] && variantsByProductId[product.id].length)
                    ? variantsByProductId[product.id]
                    : (product.size_id || product.unit_id ? [{
                        size_id: product.size_id || null,
                        size_label: product.size_label || null,
                        unit_id: product.unit_id || null,
                        unit_name: product.unit_name || null,
                        unit_abbreviation: product.unit_abbreviation || null,
                        price: Number(product.price),
                        cost_price: product.cost_price === null || product.cost_price === undefined ? null : Number(product.cost_price)
                    }] : [])
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
    body('email').optional().isEmail().withMessage('Please provide a valid email'),
    body('rating').optional().isFloat({ min: 0, max: 5 }).withMessage('Rating must be between 0 and 5')
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
            owner_name,
            location,
            latitude,
            longitude,
            delivery_time,
            phone,
            email,
            address,
            opening_time, closing_time,
            payment_term,
            image_url,
            rating
        } = req.body;

        if (rating !== undefined && req.user.user_type !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Only admins can set store rating'
            });
        }

        // If user is store owner, they can only create stores for themselves
        // If user is admin, they can create stores for any owner
        const rawOwnerId = req.user.user_type === 'admin' ? (req.body.owner_id ?? req.user.id) : req.user.id;
        const parsedOwnerId = rawOwnerId === null || rawOwnerId === undefined ? null : parseInt(String(rawOwnerId), 10);
        const ownerId = Number.isFinite(parsedOwnerId) && parsedOwnerId > 0 ? parsedOwnerId : null;

        const insertFields = [
            'name',
            'description',
            'owner_name',
            'location',
            'latitude',
            'longitude',
            'delivery_time',
            'opening_time',
            'closing_time',
            'payment_term',
            'phone',
            'email',
            'address',
            'owner_id',
            'cover_image'
        ];
        const insertValues = [
            name,
            description || null,
            owner_name || null,
            location,
            latitude || null,
            longitude || null,
            delivery_time || null,
            opening_time || null,
            closing_time || null,
            payment_term || null,
            phone || null,
            email || null,
            address || null,
            ownerId,
            image_url || null
        ];

        if (rating !== undefined && req.user.user_type === 'admin') {
            const n = parseFloat(rating);
            const safeRating = Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : 0;
            insertFields.push('rating');
            insertValues.push(safeRating);
        }

        const placeholders = insertFields.map(() => '?').join(', ');
        const [result] = await req.db.execute(
            `INSERT INTO stores (${insertFields.join(', ')}) VALUES (${placeholders})`,
            insertValues
        );

        res.status(201).json({
            success: true,
            message: 'Store created successfully',
            store: {
                id: result.insertId,
                name,
                location,
                owner_id: ownerId,
                owner_name: owner_name || null,
                image_url: image_url || null
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
    body('email').optional().isEmail().withMessage('Please provide a valid email'),
    body('rating').optional().isFloat({ min: 0, max: 5 }).withMessage('Rating must be between 0 and 5')
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
            owner_name,
            location,
            latitude,
            longitude,
            delivery_time,
            phone,
            email,
            address,
            is_active,
            opening_time,
            closing_time,
            payment_term,
            image_url,
            rating,
            category_id
        } = req.body;

        const updateFields = [];
        const updateValues = [];

        if (name !== undefined) { updateFields.push('name = ?'); updateValues.push(name); }
        if (description !== undefined) { updateFields.push('description = ?'); updateValues.push(description); }
        if (owner_name !== undefined) { updateFields.push('owner_name = ?'); updateValues.push(owner_name); }
        if (location !== undefined) { updateFields.push('location = ?'); updateValues.push(location); }
        if (latitude !== undefined) { updateFields.push('latitude = ?'); updateValues.push(latitude); }
        if (longitude !== undefined) { updateFields.push('longitude = ?'); updateValues.push(longitude); }
        if (delivery_time !== undefined) { updateFields.push('delivery_time = ?'); updateValues.push(delivery_time); }
        if (opening_time !== undefined) { updateFields.push('opening_time = ?'); updateValues.push(opening_time); }
        if (closing_time !== undefined) { updateFields.push('closing_time = ?'); updateValues.push(closing_time); }
        if (payment_term !== undefined) { updateFields.push('payment_term = ?'); updateValues.push(payment_term); }
        if (phone !== undefined) { updateFields.push('phone = ?'); updateValues.push(phone); }
        if (email !== undefined) { updateFields.push('email = ?'); updateValues.push(email); }
        if (address !== undefined) { updateFields.push('address = ?'); updateValues.push(address); }
        if (image_url !== undefined) { updateFields.push('cover_image = ?'); updateValues.push(image_url); }
        if (category_id !== undefined) { updateFields.push('category_id = ?'); updateValues.push(category_id || null); }
        if (rating !== undefined) {
            if (req.user.user_type !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Only admins can set store rating'
                });
            }
            const n = parseFloat(rating);
            const safeRating = Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : 0;
            updateFields.push('rating = ?');
            updateValues.push(safeRating);
        }
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

// Upload cover image for store: accepts single file and generates resized variants
router.post('/upload-image', authenticateToken, requireStoreOwner, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
        const uploadDir = path.join(__dirname, '..', 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

        const originalPath = req.file.path;
        const ext = path.extname(req.file.originalname) || '.jpg';
        const baseName = `store_upload_${Date.now()}_${Math.round(Math.random()*1000)}`;
        const outName = `${baseName}${ext}`;
        const outPath = path.join(uploadDir, outName);

        fs.renameSync(originalPath, outPath);

        const publicPath = '/uploads/' + outName;
        const variants = {};

        if (sharp) {
            const sizes = [320, 640, 1024];
            for (const w of sizes) {
                try {
                    const vname = `${baseName}_${w}${ext}`;
                    const vpath = path.join(uploadDir, vname);
                    await sharp(outPath).resize({ width: w }).toFile(vpath);
                    variants[w] = '/uploads/' + vname;
                } catch (err) {
                    console.warn('sharp resize failed for', outPath, err.message);
                }
            }
        }

        res.json({ success: true, image_url: publicPath, variants });
    } catch (error) {
        console.error('Upload image failed:', error);
        res.status(500).json({ success: false, message: 'Image upload failed', error: error.message });
    }
});
