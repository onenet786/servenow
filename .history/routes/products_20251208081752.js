const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken, requireAdmin, requireStoreOwner, optionalAuth } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const multer = require('multer');
const sharp = (() => {
    try { return require('sharp'); } catch (e) { console.warn('sharp not installed, image resizing disabled'); return null; }
})();
const upload = multer({ dest: path.join(__dirname, '..', 'uploads', 'tmp') });

// Helper: given a public imageUrl like '/uploads/xxx.jpg', compute avg RGB and overlay alpha using sharp
async function extractImageVarsFromPath(imageUrl) {
    try {
        if (!sharp) return null;
        if (!imageUrl || typeof imageUrl !== 'string') return null;
        if (!imageUrl.startsWith('/uploads/')) return null;
        const uploadDir = path.join(__dirname, '..', 'uploads');
        const rel = imageUrl.replace(/^\//, '');
        const filePath = path.join(__dirname, '..', rel);
        if (!fs.existsSync(filePath)) return null;

        // Resize to small raw buffer and compute average
        const small = await sharp(filePath).resize({ width: 40, height: 40, fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const { data, info } = small;
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i + 3];
            if (alpha === 0) continue;
            r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
        }
        if (!count) return null;
        r = Math.round(r / count); g = Math.round(g / count); b = Math.round(b / count);
        const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        let alpha = 0.20;
        if (lum > 0.75) alpha = 0.55;
        else if (lum > 0.6) alpha = 0.45;
        else if (lum > 0.45) alpha = 0.32;
        else alpha = 0.20;
        const contrast = (lum > 0.5) ? '#111' : '#fff';
        return { image_bg_r: r, image_bg_g: g, image_bg_b: b, image_overlay_alpha: parseFloat(alpha.toFixed(3)), image_contrast: contrast };
    } catch (e) {
        console.warn('extractImageVarsFromPath failed', e.message);
        return null;
    }
}

// Get all products with optional category filter
router.get('/', optionalAuth, async (req, res) => {
    try {
        const { category, store, admin } = req.query;
        const isAdminUser = req.user && req.user.user_type === 'admin';

        let query = `
            SELECT p.*, c.name as category_name, s.name as store_name, s.location as store_location
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN stores s ON p.store_id = s.id
        `;
        const queryParams = [];
        const whereClauses = [];

        // Only apply availability filters if not admin request
        if (!admin && !isAdminUser) {
            // whereClauses.push('p.is_available = true');
            whereClauses.push('s.is_active = true');
        }

        if (category) {
            // normalize incoming category (dashes allowed) in SQL parameter
            whereClauses.push('LOWER(c.name) = LOWER(REPLACE(?, "-", " "))');
            queryParams.push(category);
        }

        if (store) {
            whereClauses.push('p.store_id = ?');
            queryParams.push(store);
        }

        if (whereClauses.length > 0) {
            query += ' WHERE ' + whereClauses.join(' AND ');
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
                image_variants: getImageVariants(product.image_url),
                image_bg_r: product.image_bg_r,
                image_bg_g: product.image_bg_g,
                image_bg_b: product.image_bg_b,
                image_overlay_alpha: product.image_overlay_alpha,
                image_contrast: product.image_contrast,
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

// helper to compute available image variants for products stored under /uploads
function getImageVariants(imageUrl) {
    try {
        if (!imageUrl || typeof imageUrl !== 'string') return null;
        if (!imageUrl.startsWith('/uploads/')) return null;
        const uploadDir = path.join(__dirname, '..', 'uploads');
        const rel = imageUrl.replace(/^\//, '');
        const baseName = path.basename(rel, path.extname(rel));
        const ext = path.extname(rel) || '.jpg';
        const sizes = [320, 640, 1024];
        const variants = {};
        for (const w of sizes) {
            const fn = `${baseName}_${w}${ext}`;
            const p = path.join(uploadDir, fn);
            if (fs.existsSync(p)) {
                variants[w] = `/uploads/${fn}`;
            }
        }
        return Object.keys(variants).length ? variants : null;
    } catch (e) {
        console.warn('getImageVariants failed', e.message);
        return null;
    }
}

// Upload image endpoint — accepts single file and generates resized variants
router.post('/upload-image', authenticateToken, requireStoreOwner, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
        const uploadDir = path.join(__dirname, '..', 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

        const originalPath = req.file.path; // tmp file
        const ext = path.extname(req.file.originalname) || '.jpg';
        const baseName = `upload_${Date.now()}_${Math.round(Math.random()*1000)}`;
        const outName = `${baseName}${ext}`;
        const outPath = path.join(uploadDir, outName);

        // Move tmp file to final location
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

        // Try to extract image vars for this uploaded file and include in response
        let meta = null;
        try { meta = await extractImageVarsFromPath(publicPath); } catch(e) { /* ignore */ }

        res.json({ success: true, image_url: publicPath, variants, image_meta: meta });
    } catch (error) {
        console.error('Upload image failed:', error);
        res.status(500).json({ success: false, message: 'Image upload failed', error: error.message });
    }
});

// Get product by ID
router.get('/:id', optionalAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { admin } = req.query;
        const isAdminUser = req.user && req.user.user_type === 'admin';

        let detailQuery = `
            SELECT p.*, c.name as category_name, s.name as store_name, s.location as store_location
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN stores s ON p.store_id = s.id
        `;
        const detailParams = [id];
        const detailWhere = ['p.id = ?'];

        if (!admin && !isAdminUser) {
            // detailWhere.push('p.is_available = true');
            // detailWhere.push('s.is_active = true');
        }

        detailQuery += ' WHERE ' + detailWhere.join(' AND ');

        const [products] = await req.db.execute(detailQuery, detailParams);

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
                image_variants: getImageVariants(product.image_url),
                image_bg_r: product.image_bg_r,
                image_bg_g: product.image_bg_g,
                image_bg_b: product.image_bg_b,
                image_overlay_alpha: product.image_overlay_alpha,
                image_contrast: product.image_contrast,
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

// Export base64 images to files under /uploads and update DB image_url
router.post('/export-base64-images', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const [rows] = await req.db.execute("SELECT id, image_url FROM products WHERE image_url LIKE 'data:%'");

        const uploadDir = path.join(__dirname, '..', 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const results = [];

        for (const row of rows) {
            const id = row.id;
            const dataUri = row.image_url || '';
            const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(dataUri);
            if (!match) {
                results.push({ id, success: false, error: 'Invalid data URI' });
                continue;
            }

            const mime = match[1];
            const base64 = match[2];
            let ext = 'jpg';
            if (mime === 'image/png') ext = 'png';
            else if (mime === 'image/gif') ext = 'gif';
            else if (mime === 'image/webp') ext = 'webp';
            else if (mime === 'image/svg+xml') ext = 'svg';
            else if (/jpeg/i.test(mime)) ext = 'jpg';

            const filename = `product_${id}_${Date.now()}.${ext}`;
            const filePath = path.join(uploadDir, filename);

            try {
                fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
                const publicPath = '/uploads/' + filename;

                // If sharp is available, generate resized variants
                if (sharp) {
                    const sizes = [320, 640, 1024];
                    for (const w of sizes) {
                        try {
                            const vname = `product_${id}_${Date.now()}_${w}${path.extname(filename)}`;
                            const vpath = path.join(uploadDir, vname);
                            await sharp(filePath).resize({ width: w }).toFile(vpath);
                        } catch (err) {
                            console.warn('Failed to write variant for product', id, err.message);
                        }
                    }
                }

                await req.db.execute('UPDATE products SET image_url = ? WHERE id = ?', [publicPath, id]);
                results.push({ id, success: true, new: publicPath });
            } catch (err) {
                console.error('Error writing file for product', id, err);
                results.push({ id, success: false, error: err.message });
            }
        }

        // After exporting files, attempt to compute and persist image vars for converted products
        for (const r of results.filter(x => x.success)) {
            try {
                const meta = await extractImageVarsFromPath(r.new);
                if (meta) {
                    await req.db.execute(
                        `UPDATE products SET image_bg_r = ?, image_bg_g = ?, image_bg_b = ?, image_overlay_alpha = ?, image_contrast = ? WHERE id = ?`,
                        [meta.image_bg_r, meta.image_bg_g, meta.image_bg_b, meta.image_overlay_alpha, meta.image_contrast, r.id]
                    );
                }
            } catch (e) { console.warn('Failed to persist image meta for product', r.id, e.message); }
        }

        res.json({ success: true, count: rows.length, converted: results.filter(r => r.success).length, results });
    } catch (error) {
        console.error('Error exporting base64 images:', error);
        res.status(500).json({ success: false, message: 'Failed to export images', error: error.message });
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

        // If image_url points to an uploads path, try to extract image meta to persist
        let meta = null;
        try {
            meta = await extractImageVarsFromPath(String(image_url || ''));
        } catch (e) { /* ignore */ }

        const insertFields = ['name','description','price','image_url','category_id','store_id','stock_quantity'];
        const insertPlaceholders = ['?','?','?','?','?','?','?'];
        const insertValues = [name, description, price, image_url, category_id, store_id, stock_quantity];
        if (meta) {
            insertFields.push('image_bg_r','image_bg_g','image_bg_b','image_overlay_alpha','image_contrast');
            insertPlaceholders.push('?,?,?,?,?');
            insertValues.push(meta.image_bg_r, meta.image_bg_g, meta.image_bg_b, meta.image_overlay_alpha, meta.image_contrast);
        }

        const sql = `INSERT INTO products (${insertFields.join(',')}) VALUES (${insertPlaceholders.join(',')})`;
        const [result] = await req.db.execute(sql, insertValues);

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
        if (image_url !== undefined) { updateFields.push('image_url = ?'); updateValues.push(image_url); 
            // try to compute and persist image meta when image_url changed
            try {
                const meta = await extractImageVarsFromPath(String(image_url || ''));
                if (meta) {
                    updateFields.push('image_bg_r = ?', 'image_bg_g = ?', 'image_bg_b = ?', 'image_overlay_alpha = ?', 'image_contrast = ?');
                    updateValues.push(meta.image_bg_r, meta.image_bg_g, meta.image_bg_b, meta.image_overlay_alpha, meta.image_contrast);
                }
            } catch (e) { /* ignore */ }
        }
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
