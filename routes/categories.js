const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sharp = (() => {
    try { return require('sharp'); } catch (e) { return null; }
})();
const upload = multer({ dest: path.join(__dirname, '..', 'uploads', 'tmp') });

const router = express.Router();

// Get all categories
router.get('/', async (req, res) => {
    try {
        const { includeInactive } = req.query;
        const whereClause = includeInactive === 'true' ? '' : 'WHERE is_active = true';
        const [categories] = await req.db.execute(
            `SELECT * FROM categories ${whereClause} ORDER BY name ASC`
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
        let { name, description, image_url } = req.body;
        if (description === undefined) description = null;
        if (image_url === undefined) image_url = null;
        // if (typeof description === 'string') {
        //     description = description.trim();
        //     if (description.length === 0) description = null;
        // }
        if (typeof image_url === 'string') {
            image_url = image_url.trim();
            if (image_url.length === 0) image_url = null;
        }

        if (!name || name.trim().length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Category name must be at least 2 characters'
            });
        }

         if (!description || description.trim().length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Category name must be at least 2 characters'
            });
        }


        try {
            if (image_url && /^https?:\/\//i.test(String(image_url))) {
                const dl = await downloadImageToUploads(String(image_url));
                if (dl && dl.publicPath) {
                    image_url = dl.publicPath;
                }
            }
        } catch (e) {}

        const [result] = await req.db.execute(
            'INSERT INTO categories (name, description, image_url) VALUES (?, ?, ?)',
            [name.trim(), description.trim(), image_url]
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
        let { name, description, image_url, is_active } = req.body;

        const updateFields = [];
        const updateValues = [];

        if (name !== undefined && name.trim().length >= 2) {
            updateFields.push('name = ?');
            updateValues.push(name.trim());
        }
        if (description !== undefined) {
            if (typeof description === 'string') {
                description = description.trim();
                if (description.length === 0) description = null;
            }
            updateFields.push('description = ?');
            updateValues.push(description);
        }
        if (image_url !== undefined) {
            try {
                if (image_url && /^https?:\/\//i.test(String(image_url))) {
                    const dl = await downloadImageToUploads(String(image_url));
                    if (dl && dl.publicPath) {
                        image_url = dl.publicPath;
                    }
                }
            } catch (e) {}
            if (typeof image_url === 'string') {
                image_url = image_url.trim();
                if (image_url.length === 0) image_url = null;
            }
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

// Download a remote image URL into uploads and return public path
async function downloadImageToUploads(remoteUrl) {
    try {
        if (!remoteUrl || !/^https?:\/\//i.test(remoteUrl)) return null;
        const uploadDir = path.join(__dirname, '..', 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        const resp = await fetch(remoteUrl);
        if (!resp.ok) return null;
        const contentType = resp.headers.get('content-type') || '';
        let ext = '.jpg';
        if (contentType.includes('png')) ext = '.png';
        else if (contentType.includes('gif')) ext = '.gif';
        else if (contentType.includes('webp')) ext = '.webp';
        else if (contentType.includes('svg')) ext = '.svg';
        else if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = '.jpg';
        try {
            const u = new URL(remoteUrl);
            const urlExt = path.extname(decodeURIComponent(u.pathname)) || '';
            if (urlExt && urlExt.length <= 5) {
                ext = urlExt.toLowerCase();
            }
        } catch (e) {}
        const baseName = `category_${Date.now()}_${Math.round(Math.random()*1000)}`;
        const outName = `${baseName}${ext}`;
        const outPath = path.join(uploadDir, outName);
        const buffer = Buffer.from(await resp.arrayBuffer());
        fs.writeFileSync(outPath, buffer);
        if (sharp) {
            const sizes = [320, 640, 1024];
            for (const w of sizes) {
                try {
                    const vname = `${baseName}_${w}${ext}`;
                    const vpath = path.join(uploadDir, vname);
                    await sharp(outPath).resize({ width: w }).toFile(vpath);
                } catch (err) {}
            }
        }
        return { publicPath: '/uploads/' + outName };
    } catch (e) {
        return null;
    }
}

// Upload image endpoint — accepts single file
router.post('/upload-image', authenticateToken, requireAdmin, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
        const uploadDir = path.join(__dirname, '..', 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        const originalPath = req.file.path;
        const ext = path.extname(req.file.originalname) || '.jpg';
        const baseName = `category_${Date.now()}_${Math.round(Math.random()*1000)}`;
        const outName = `${baseName}${ext}`;
        const outPath = path.join(uploadDir, outName);
        fs.renameSync(originalPath, outPath);
        const publicPath = '/uploads/' + outName;
        if (sharp) {
            const sizes = [320, 640, 1024];
            for (const w of sizes) {
                try {
                    const vname = `${baseName}_${w}${ext}`;
                    const vpath = path.join(uploadDir, vname);
                    await sharp(outPath).resize({ width: w }).toFile(vpath);
                } catch (err) {}
            }
        }
        res.json({ success: true, image_url: publicPath });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Image upload failed', error: error.message });
    }
});
