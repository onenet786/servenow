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
        let { name, description, image_url } = req.body;
        if (description === undefined) description = null;
        if (image_url === undefined) image_url = null;

        if (!name || name.trim().length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Category name must be at least 2 characters'
            });
        }

        // If image_url is a remote link, download it to uploads
        try {
            if (image_url && /^https?:\/\//i.test(String(image_url))) {
                const dl = await downloadImageToUploads(String(image_url));
                if (dl && dl.publicPath) {
                    image_url = dl.publicPath;
                }
            }
        } catch (e) {}
        try {
            if (image_url && /^data:(image\/[a-zA-Z0-9.+-]+);base64,/.test(String(image_url))) {
                const saved = await saveDataUriToUploads(String(image_url), 'category');
                if (saved) image_url = saved;
            }
        } catch (e) {}

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
        let { name, description, image_url, is_active } = req.body;

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
            try {
                if (image_url && /^https?:\/\//i.test(String(image_url))) {
                    const dl = await downloadImageToUploads(String(image_url));
                    if (dl && dl.publicPath) {
                        image_url = dl.publicPath;
                    }
                }
            } catch (e) {}
            try {
                if (image_url && /^data:(image\/[a-zA-Z0-9.+-]+);base64,/.test(String(image_url))) {
                    const saved = await saveDataUriToUploads(String(image_url), 'category');
                    if (saved) image_url = saved;
                }
            } catch (e) {}
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

async function saveDataUriToUploads(dataUri, prefix) {
    try {
        const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(String(dataUri));
        if (!m) return null;
        const mime = m[1];
        const base64 = m[2];
        let ext = '.jpg';
        if (mime === 'image/png') ext = '.png';
        else if (mime === 'image/gif') ext = '.gif';
        else if (mime === 'image/webp') ext = '.webp';
        else if (mime === 'image/svg+xml') ext = '.svg';
        else if (mime === 'image/jpeg') ext = '.jpg';
        const uploadDir = path.join(__dirname, '..', 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        const baseName = `${prefix}_${Date.now()}_${Math.round(Math.random()*1000)}`;
        const outName = `${baseName}${ext}`;
        const outPath = path.join(uploadDir, outName);
        fs.writeFileSync(outPath, Buffer.from(base64, 'base64'));
        if (sharp && ext !== '.svg') {
            const sizes = [320, 640, 1024];
            for (const w of sizes) {
                try {
                    const vname = `${baseName}_${w}${ext}`;
                    const vpath = path.join(uploadDir, vname);
                    await sharp(outPath).resize({ width: w }).toFile(vpath);
                } catch (err) {}
            }
        }
        return '/uploads/' + outName;
    } catch (e) {
        return null;
    }
}
