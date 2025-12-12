const express = require('express')
const { body, validationResult } = require('express-validator')
const { authenticateToken, requireAdmin, requireStoreOwner } = require('../middleware/auth')
const fs = require('fs')
const path = require('path')
const multer = require('multer')
const sharp = (() => {
    try { return require('sharp') } catch (e) { console.warn('sharp not installed, image resizing disabled'); return null }
})()
const upload = multer({ dest: path.join(__dirname, '..', 'uploads', 'tmp') })

const router = express.Router()

async function hasColumn(db, table, column) {
    const [rows] = await db.execute('SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [table, column])
    return rows[0].cnt > 0
}

// Get all stores
router.get('/', async (req, res) => {
    try {
        const hasCat = await hasColumn(req.db, 'stores', 'category_id')
        const sql = hasCat
            ? `SELECT s.*, u.first_name as owner_first_name, u.last_name as owner_last_name, c.name as category_name
               FROM stores s
               LEFT JOIN users u ON s.owner_id = u.id
               LEFT JOIN categories c ON s.category_id = c.id
               WHERE s.is_active = true
               ORDER BY s.rating DESC, s.name ASC`
            : `SELECT s.*, u.first_name as owner_first_name, u.last_name as owner_last_name
               FROM stores s
               LEFT JOIN users u ON s.owner_id = u.id
               WHERE s.is_active = true
               ORDER BY s.rating DESC, s.name ASC`
        const [stores] = await req.db.execute(sql)

        res.json({
            success: true,
            stores: stores.map(store => ({
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
                owner_id: store.owner_id || null,
                category_id: store.category_id || null,
                category_name: store.category_name || null,
                image_url: store.cover_image || null,
                is_active: store.is_active,
                owner_name: store.owner_first_name && store.owner_last_name ?
                    `${store.owner_first_name} ${store.owner_last_name}` : null
            }))
        })

    } catch (error) {
        console.error('Error fetching stores:', error)
        res.status(500).json({
            success: false,
            message: 'Failed to fetch stores',
            error: error.message
        })
    }
})

// Get store by ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params

        const hasCat = await hasColumn(req.db, 'stores', 'category_id')
        const sql = hasCat
            ? `SELECT s.*, u.first_name as owner_first_name, u.last_name as owner_last_name, c.name as category_name
               FROM stores s
               LEFT JOIN users u ON s.owner_id = u.id
               LEFT JOIN categories c ON s.category_id = c.id
               WHERE s.id = ? AND s.is_active = true`
            : `SELECT s.*, u.first_name as owner_first_name, u.last_name as owner_last_name
               FROM stores s
               LEFT JOIN users u ON s.owner_id = u.id
               WHERE s.id = ? AND s.is_active = true`
        const [stores] = await req.db.execute(sql, [id])

        if (stores.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Store not found'
            })
        }

        const store = stores[0]

        // Get products for this store
        const [products] = await req.db.execute(`
            SELECT p.*, c.name as category_name
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.store_id = ? AND p.is_available = true
            ORDER BY p.name ASC
        `, [id])

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
                owner_id: store.owner_id,
                category_id: store.category_id || null,
                category_name: store.category_name || null,
                image_url: store.cover_image || null,
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
        })

    } catch (error) {
        console.error('Error fetching store:', error)
        res.status(500).json({
            success: false,
            message: 'Failed to fetch store',
            error: error.message
        })
    }
})

// Create new store (Admin or Store Owner)
router.post('/', authenticateToken, requireStoreOwner, [
    body('name').trim().isLength({ min: 2 }).withMessage('Store name must be at least 2 characters'),
    body('location').trim().notEmpty().withMessage('Location is required'),
    body('phone').optional().isString().withMessage('Please provide a valid phone'),
    body('email').optional().isEmail().withMessage('Please provide a valid email'),
    body('owner_id').optional().isInt().withMessage('owner_id must be a valid user id'),
    body('owner_name').optional().isString().isLength({ min: 1 }).withMessage('owner_name must be text')
], async (req, res) => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            })
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
            opening_time, closing_time,
            image_url
        } = req.body

        // Owner assignment:
        // - If owner_id provided (admin use-case), use it; otherwise assign to current user
        let ownerId = req.user.id;
        if (req.user.user_type === 'admin' && req.body.owner_id) {
            ownerId = parseInt(req.body.owner_id, 10);
        }

        const hasCat = await hasColumn(req.db, 'stores', 'category_id')
        const hasOwnerName = await hasColumn(req.db, 'stores', 'owner_name')
        const fields = ['name','description','location','latitude','longitude','delivery_time','opening_time','closing_time','phone','email','address','owner_id','cover_image']
        const placeholders = Array(fields.length).fill('?')
        const values = [name, description || null, location, latitude || null, longitude || null, delivery_time || null, opening_time || null, closing_time || null, phone || null, email || null, address || null, ownerId, image_url || null]
        if (hasOwnerName) {
            fields.push('owner_name')
            placeholders.push('?')
            values.push(req.body.owner_name || null)
        }
        if (hasCat) {
            fields.push('category_id')
            placeholders.push('?')
            values.push(req.body.category_id || null)
        }
        const [result] = await req.db.execute(`INSERT INTO stores (${fields.join(',')}) VALUES (${placeholders.join(',')})`, values)

        res.status(201).json({
            success: true,
            message: 'Store created successfully',
            store: {
                id: result.insertId,
                name,
                location,
                owner_id: ownerId,
                owner_name: req.body.owner_name || null,
                category_id: req.body.category_id || null,
                image_url: image_url || null
            }
        })

    } catch (error) {
        console.error('Error creating store:', error)
        res.status(500).json({
            success: false,
            message: 'Failed to create store',
            error: error.message
        })
    }
})

// Update store (Admin or Store Owner)
router.put('/:id', authenticateToken, requireStoreOwner, [
    body('name').optional().trim().isLength({ min: 2 }).withMessage('Store name must be at least 2 characters'),
    body('location').optional().trim().notEmpty().withMessage('Location is required'),
    body('phone').optional().isString().withMessage('Please provide a valid phone'),
    body('email').optional().isEmail().withMessage('Please provide a valid email')
], async (req, res) => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            })
        }

        const { id } = req.params

        // Check if store exists and user has permission
        const [stores] = await req.db.execute(
            'SELECT * FROM stores WHERE id = ?',
            [id]
        )

        if (stores.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Store not found'
            })
        }

        const store = stores[0]

        // Check ownership permission
        if (req.user.user_type !== 'admin' && store.owner_id !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to update this store'
            })
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
            closing_time,
            image_url,
            owner_id,
            category_id
        } = req.body

        const updateFields = []
        const updateValues = []

        if (name !== undefined) { updateFields.push('name = ?'); updateValues.push(name) }
        if (description !== undefined) { updateFields.push('description = ?'); updateValues.push(description) }
        if (location !== undefined) { updateFields.push('location = ?'); updateValues.push(location) }
        if (latitude !== undefined) { updateFields.push('latitude = ?'); updateValues.push(latitude) }
        if (longitude !== undefined) { updateFields.push('longitude = ?'); updateValues.push(longitude) }
        if (delivery_time !== undefined) { updateFields.push('delivery_time = ?'); updateValues.push(delivery_time) }
        if (opening_time !== undefined) { updateFields.push('opening_time = ?'); updateValues.push(opening_time) }
        if (closing_time !== undefined) { updateFields.push('closing_time = ?'); updateValues.push(closing_time) }
        if (phone !== undefined) { updateFields.push('phone = ?'); updateValues.push(phone) }
        if (email !== undefined) { updateFields.push('email = ?'); updateValues.push(email) }
        if (address !== undefined) { updateFields.push('address = ?'); updateValues.push(address) }
        if (image_url !== undefined) { updateFields.push('cover_image = ?'); updateValues.push(image_url) }
        if (category_id !== undefined) {
            const hasCat = await hasColumn(req.db, 'stores', 'category_id')
            if (hasCat) { updateFields.push('category_id = ?'); updateValues.push(category_id) }
        }
        if (owner_id !== undefined && req.user.user_type === 'admin') { updateFields.push('owner_id = ?'); updateValues.push(owner_id) }
        if (is_active !== undefined && req.user.user_type === 'admin') { updateFields.push('is_active = ?'); updateValues.push(is_active) }

        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid fields to update'
            })
        }

        updateValues.push(id)

        await req.db.execute(
            `UPDATE stores SET ${updateFields.join(', ')} WHERE id = ?`,
            updateValues
        )

        res.json({
            success: true,
            message: 'Store updated successfully'
        })

    } catch (error) {
        console.error('Error updating store:', error)
        res.status(500).json({
            success: false,
            message: 'Failed to update store',
            error: error.message
        })
    }
})

// Delete store (Admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params

        const [result] = await req.db.execute(
            'UPDATE stores SET is_active = false WHERE id = ?',
            [id]
        )

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Store not found'
            })
        }

        res.json({
            success: true,
            message: 'Store deactivated successfully'
        })

    } catch (error) {
        console.error('Error deleting store:', error)
        res.status(500).json({
            success: false,
            message: 'Failed to delete store',
            error: error.message
        })
    }
})

module.exports = router

// Upload cover image for store: accepts single file and generates resized variants
router.post('/upload-image', authenticateToken, requireStoreOwner, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' })
        const uploadDir = path.join(__dirname, '..', 'uploads')
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

        const originalPath = req.file.path
        const ext = path.extname(req.file.originalname) || '.jpg'
        const baseName = `store_upload_${Date.now()}_${Math.round(Math.random()*1000)}`
        const outName = `${baseName}${ext}`
        const outPath = path.join(uploadDir, outName)

        fs.renameSync(originalPath, outPath)

        const publicPath = '/uploads/' + outName
        const variants = {}

        if (sharp) {
            const sizes = [320, 640, 1024]
            for (const w of sizes) {
                try {
                    const vname = `${baseName}_${w}${ext}`
                    const vpath = path.join(uploadDir, vname)
                    await sharp(outPath).resize({ width: w }).toFile(vpath)
                    variants[w] = '/uploads/' + vname
                } catch (err) {
                    console.warn('sharp resize failed for', outPath, err.message)
                }
            }
        }

        res.json({ success: true, image_url: publicPath, variants })
    } catch (error) {
        console.error('Upload image failed:', error)
        res.status(500).json({ success: false, message: 'Image upload failed', error: error.message })
    }
})
