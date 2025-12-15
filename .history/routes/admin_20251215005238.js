const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const mysqlLib = require('mysql2');

const BACKUP_DIR = path.join(__dirname, '..', 'database', 'backups');

const multer = require('multer');
const sharp = (() => { try { return require('sharp'); } catch(e){ return null; } })();
const upload = multer({ dest: path.join(__dirname, '..', 'uploads', 'tmp') });
function ensureBackupDir() {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}
const SUPER_USER = process.env.SUPER_ADMIN_USER || 'sadmin';
const SUPER_PASS = process.env.SUPER_ADMIN_PASS || 'Admin786';
function ensureSuperAdmin(req, res) {
    const u = req.body && req.body.username;
    const p = req.body && req.body.password;
    if (u !== SUPER_USER || p !== SUPER_PASS) {
        res.status(403).json({ success: false, message: 'Forbidden' });
        return false;
    }
    return true;
}

// Execute a limited ALTER TABLE statement (admin-only)
// Body: { sql: "ALTER TABLE ..." }
router.post('/execute-sql', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { sql } = req.body || {};
        if (!sql || typeof sql !== 'string') return res.status(400).json({ success: false, message: 'Missing sql statement' });

        // Only allow ALTER TABLE statements and restrict table names
        const m = sql.trim().match(/^ALTER\s+TABLE\s+`?(\w+)`?/i);
        if (!m) return res.status(400).json({ success: false, message: 'Only ALTER TABLE statements are permitted' });

        const table = m[1];
        const allowed = ['stores', 'riders_fuel_history', 'riders'];
        if (!allowed.includes(table)) return res.status(403).json({ success: false, message: `ALTER TABLE on '${table}' is not permitted` });

        // Execute
        const [result] = await req.db.execute(sql);
        return res.json({ success: true, result });
    } catch (err) {
        console.error('Error executing SQL:', err && err.stack ? err.stack : err);
        const payload = { success: false, message: 'SQL execution failed' };
        if (err && err.message) payload.error = err.message;
        if (err && err.sqlMessage) payload.sqlMessage = err.sqlMessage;
        return res.status(500).json(payload);
    }
});

module.exports = router;

// --- Database backup endpoints ---
// POST /api/admin/backup-db  -> create a new dump (admin only)
// GET  /api/admin/backup-db/list -> list available dumps
// GET  /api/admin/backup-db/download?file=<name> -> download a dump file

router.post('/backup-db', authenticateToken, requireAdmin, async (req, res) => {
    try {
        ensureBackupDir();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `backup-${timestamp}.sql`;
        const filepath = path.join(BACKUP_DIR, filename);

        const dbName = process.env.DB_NAME || process.env.MYSQL_DATABASE || 'servenow';

        const outStream = fs.createWriteStream(filepath, { flags: 'w' });
        // write header
        outStream.write(`-- ServeNow database dump\n-- Database: ${dbName}\n-- Generated: ${new Date().toISOString()}\n\n`);

        // Get list of tables
        const [tables] = await req.db.execute("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?", [dbName]);

        for (const trow of tables) {
            const table = trow.TABLE_NAME;
            // Write DROP + CREATE statement
            const [createRes] = await req.db.execute(`SHOW CREATE TABLE \`${table}\``);
            const createSql = createRes && createRes[0] && (createRes[0]['Create Table'] || createRes[0]['Create View'] || Object.values(createRes[0])[1]);
            outStream.write(`DROP TABLE IF EXISTS \`${table}\`;\n`);
            outStream.write(createSql + `;\n\n`);

            // Dump rows as INSERTs
            const [rows] = await req.db.execute(`SELECT * FROM \`${table}\``);
            if (rows && rows.length > 0) {
                const cols = Object.keys(rows[0]).map(c => `\`${c}\``).join(', ');
                // Batch inserts in groups of 100
                const batchSize = 100;
                for (let i = 0; i < rows.length; i += batchSize) {
                    const batch = rows.slice(i, i + batchSize);
                    const values = batch.map(r => '(' + Object.keys(r).map(c => mysqlLib.escape(r[c])).join(',') + ')');
                    outStream.write(`INSERT INTO \`${table}\` (${cols}) VALUES\n${values.join(',\n')};\n`);
                }
                outStream.write('\n');
            }
        }

        outStream.end();
        return res.json({ success: true, filename, downloadUrl: `/api/admin/backup-db/download?file=${encodeURIComponent(filename)}` });
    } catch (err) {
        console.error('Backup error (mysql2):', err);
        try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch(e) { /* ignore */ }
        return res.status(500).json({ success: false, message: 'Backup failed', error: err.message });
    }
});

router.post('/restore-db', authenticateToken, requireAdmin, async (req, res) => {
    try {
        if (!ensureSuperAdmin(req, res)) return;
        const { filename } = req.body || {};
        if (!filename || typeof filename !== 'string') return res.status(400).json({ success: false, message: 'filename is required' });
        const safe = path.basename(filename);
        const filepath = path.join(BACKUP_DIR, safe);
        if (!fs.existsSync(filepath)) return res.status(404).json({ success: false, message: 'Backup file not found' });
        const sqlText = fs.readFileSync(filepath, 'utf8');
        const statements = [];
        let buf = '';
        const lines = sqlText.split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('--')) continue;
            buf += trimmed + ' ';
            if (/[;]\s*$/.test(trimmed)) {
                statements.push(buf.trim().replace(/;$/, ''));
                buf = '';
            }
        }
        if (buf.trim()) statements.push(buf.trim());
        await req.db.execute('SET FOREIGN_KEY_CHECKS=0');
        for (const st of statements) {
            try {
                await req.db.query(st);
            } catch (e) {}
        }
        await req.db.execute('SET FOREIGN_KEY_CHECKS=1');
        return res.json({ success: true, message: 'Database restored', file: safe, statements: statements.length });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Restore failed', error: err.message });
    }
});

router.post('/clear-db', authenticateToken, requireAdmin, async (req, res) => {
    try {
        if (!ensureSuperAdmin(req, res)) return;
        const doBackup = !!req.query.backup || !!(req.body && req.body.backup);
        let backupFilename = null;
        if (doBackup) {
            ensureBackupDir();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            backupFilename = `backup-${timestamp}.sql`;
            const filepath = path.join(BACKUP_DIR, backupFilename);
            const dbName = process.env.DB_NAME || process.env.MYSQL_DATABASE || 'servenow';
            const outStream = fs.createWriteStream(filepath, { flags: 'w' });
            outStream.write(`-- ServeNow database dump\n-- Database: ${dbName}\n-- Generated: ${new Date().toISOString()}\n\n`);
            const [tables] = await req.db.execute("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?", [dbName]);
            for (const trow of tables) {
                const table = trow.TABLE_NAME;
                const [createRes] = await req.db.execute(`SHOW CREATE TABLE \`${table}\``);
                const createSql = createRes && createRes[0] && (createRes[0]['Create Table'] || createRes[0]['Create View'] || Object.values(createRes[0])[1]);
                outStream.write(`DROP TABLE IF EXISTS \`${table}\`;\n`);
                outStream.write(createSql + `;\n\n`);
                const [rows] = await req.db.execute(`SELECT * FROM \`${table}\``);
                if (rows && rows.length > 0) {
                    const cols = Object.keys(rows[0]).map(c => `\`${c}\``).join(', ');
                    const batchSize = 100;
                    for (let i = 0; i < rows.length; i += batchSize) {
                        const batch = rows.slice(i, i + batchSize);
                        const values = batch.map(r => '(' + Object.keys(r).map(c => mysqlLib.escape(r[c])).join(',') + ')');
                        outStream.write(`INSERT INTO \`${table}\` (${cols}) VALUES\n${values.join(',\n')};\n`);
                    }
                    outStream.write('\n');
                }
            }
            outStream.end();
        }
        const dbName = process.env.DB_NAME || process.env.MYSQL_DATABASE || 'servenow';
        const [tables] = await req.db.execute("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?", [dbName]);
        const preserve = new Set(['users', 'categories']);
        await req.db.execute('SET FOREIGN_KEY_CHECKS=0');
        for (const trow of tables) {
            const table = trow.TABLE_NAME;
            if (preserve.has(table)) continue;
            await req.db.execute(`TRUNCATE TABLE \`${table}\``);
        }
        await req.db.execute("DELETE FROM users WHERE user_type <> 'admin'");
        const [admins] = await req.db.execute("SELECT id FROM users WHERE user_type = 'admin' LIMIT 1");
        if (!admins || admins.length === 0) {
            const hashed = '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';
            await req.db.execute("INSERT INTO users (first_name, last_name, email, phone, password, user_type) VALUES ('Admin','User','admin@servenow.com','+1234567890', ?, 'admin')", [hashed]);
        }
        await req.db.execute('SET FOREIGN_KEY_CHECKS=1');
        return res.json({ success: true, message: 'Database cleared', backup: backupFilename || null });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Clear failed', error: err.message });
    }
});

router.post('/clear-db-keep-one', authenticateToken, requireAdmin, async (req, res) => {
    try {
        if (!ensureSuperAdmin(req, res)) return;
        const doBackup = !!req.query.backup || !!(req.body && req.body.backup);
        let backupFilename = null;
        if (doBackup) {
            ensureBackupDir();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            backupFilename = `backup-${timestamp}.sql`;
            const filepath = path.join(BACKUP_DIR, backupFilename);
            const dbName = process.env.DB_NAME || process.env.MYSQL_DATABASE || 'servenow';
            const outStream = fs.createWriteStream(filepath, { flags: 'w' });
            outStream.write(`-- ServeNow database dump\n-- Database: ${dbName}\n-- Generated: ${new Date().toISOString()}\n\n`);
            const [tables] = await req.db.execute("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?", [dbName]);
            for (const trow of tables) {
                const table = trow.TABLE_NAME;
                const [createRes] = await req.db.execute(`SHOW CREATE TABLE \`${table}\``);
                const createSql = createRes && createRes[0] && (createRes[0]['Create Table'] || createRes[0]['Create View'] || Object.values(createRes[0])[1]);
                outStream.write(`DROP TABLE IF EXISTS \`${table}\`;\n`);
                outStream.write(createSql + `;\n\n`);
                const [rows] = await req.db.execute(`SELECT * FROM \`${table}\``);
                if (rows && rows.length > 0) {
                    const cols = Object.keys(rows[0]).map(c => `\`${c}\``).join(', ');
                    const batchSize = 100;
                    for (let i = 0; i < rows.length; i += batchSize) {
                        const batch = rows.slice(i, i + batchSize);
                        const values = batch.map(r => '(' + Object.keys(r).map(c => mysqlLib.escape(r[c])).join(',') + ')');
                        outStream.write(`INSERT INTO \`${table}\` (${cols}) VALUES\n${values.join(',\n')};\n`);
                    }
                    outStream.write('\n');
                }
            }
            outStream.end();
        }
        const dbName = process.env.DB_NAME || process.env.MYSQL_DATABASE || 'servenow';
        const [tables] = await req.db.execute("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?", [dbName]);
        const kept = {};
        await req.db.execute('SET FOREIGN_KEY_CHECKS=0');
        for (const trow of tables) {
            const table = trow.TABLE_NAME;
            if (table === 'users') {
                const [adminRows] = await req.db.execute("SELECT id FROM users WHERE user_type = 'admin' ORDER BY id ASC LIMIT 1");
                let keepId = adminRows && adminRows[0] ? adminRows[0].id : null;
                if (!keepId) {
                    const hashed = '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';
                    const [ins] = await req.db.execute("INSERT INTO users (first_name, last_name, email, phone, password, user_type) VALUES ('Admin','User','admin@servenow.com','+1234567890', ?, 'admin')", [hashed]);
                    keepId = ins.insertId;
                }
                kept[table] = keepId;
                await req.db.execute("DELETE FROM users WHERE id <> ?", [keepId]);
            } else {
                const [[colExists]] = await req.db.execute(`
                    SELECT COUNT(*) AS cnt
                    FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = 'id'
                `, [dbName, table]);
                if (colExists && colExists.cnt > 0) {
                    const [[minRow]] = await req.db.execute(`SELECT MIN(id) AS mid FROM \`${table}\``);
                    const keepId = minRow && minRow.mid ? minRow.mid : null;
                    if (keepId) {
                        kept[table] = keepId;
                        await req.db.execute(`DELETE FROM \`${table}\` WHERE id <> ?`, [keepId]);
                    } else {
                        kept[table] = null;
                        await req.db.execute(`TRUNCATE TABLE \`${table}\``);
                    }
                } else {
                    kept[table] = null;
                    await req.db.execute(`TRUNCATE TABLE \`${table}\``);
                }
            }
        }
        await req.db.execute('SET FOREIGN_KEY_CHECKS=1');
        return res.json({ success: true, message: 'Database cleared (kept one per table)', backup: backupFilename || null, kept });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'Clear (keep one) failed', error: err.message });
    }
});

router.get('/backup-db/list', authenticateToken, requireAdmin, async (req, res) => {
    try {
        ensureBackupDir();
        const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.sql'))
            .map(f => {
                const s = fs.statSync(path.join(BACKUP_DIR, f));
                return { filename: f, size: s.size, mtime: s.mtime };
            })
            .sort((a, b) => b.mtime - a.mtime);
        return res.json({ success: true, backups: files });
    } catch (err) {
        console.error('List backups error:', err);
        return res.status(500).json({ success: false, message: 'List failed', error: err.message });
    }
});

// Diagnostic check for backup prerequisites (admin-only)
router.get('/backup-db/check', authenticateToken, requireAdmin, async (req, res) => {
    try {
        ensureBackupDir();
        const mysqldump = process.env.MYSQLDUMP_PATH || 'mysqldump';

        // Check mysqldump availability
        const checkDump = await new Promise((resolve) => {
            const p = spawn(mysqldump, ['--version']);
            let out = '';
            let err = '';
            p.stdout.on('data', c => out += c.toString());
            p.stderr.on('data', c => err += c.toString());
            p.on('error', e => resolve({ ok: false, error: e.message }));
            p.on('close', code => {
                if (code === 0) resolve({ ok: true, version: out.trim() });
                else resolve({ ok: false, error: err.trim() || `exit ${code}` });
            });
        });

        // Check write permission in backup dir
        const testFile = path.join(BACKUP_DIR, `.writetest-${Date.now()}.tmp`);
        let writeOk = false;
        let writeErr = null;
        try {
            fs.writeFileSync(testFile, 'ok');
            fs.unlinkSync(testFile);
            writeOk = true;
        } catch (e) {
            writeErr = e.message;
        }

        // Check env vars
        const env = {
            DB_NAME: process.env.DB_NAME || process.env.MYSQL_DATABASE || null,
            DB_USER: process.env.DB_USER || process.env.MYSQL_USER || null,
            DB_HOST: process.env.DB_HOST || null,
            DB_PORT: process.env.DB_PORT || null,
            MYSQLDUMP_PATH: process.env.MYSQLDUMP_PATH || null
        };

        return res.json({ success: true, mysqldump: checkDump, backupsWritable: writeOk, writeError: writeErr, env });
    } catch (err) {
        console.error('Backup check error:', err);
        return res.status(500).json({ success: false, message: 'Check failed', error: err.message });
    }
});

router.get('/backup-db/download', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const file = req.query.file;
        if (!file) return res.status(400).json({ success: false, message: 'file query parameter required' });
        const safe = path.basename(file);
        const filepath = path.join(BACKUP_DIR, safe);
        if (!fs.existsSync(filepath)) return res.status(404).json({ success: false, message: 'File not found' });
        return res.download(filepath);
    } catch (err) {
        console.error('Download backup error:', err);
        return res.status(500).json({ success: false, message: 'Download failed', error: err.message });
    }
});

router.post('/upload-image', authenticateToken, requireAdmin, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
        const uploadDir = path.join(__dirname, '..', 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        const originalPath = req.file.path;
        const ext = path.extname(req.file.originalname) || '.jpg';
        const baseName = `upload_${Date.now()}_${Math.round(Math.random()*1000)}`;
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
                } catch (_) {}
            }
        }
        res.json({ success: true, image_url: publicPath, variants });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Image upload failed', error: error.message });
    }
});

router.post('/migrate/items', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const createItemsSql = `
            CREATE TABLE IF NOT EXISTS items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                description TEXT NULL,
                image_url VARCHAR(255) NULL,
                category_id INT NULL,
                unit_id INT NULL,
                size_id INT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `;
        await req.db.execute(createItemsSql);

        const [[colExists]] = await req.db.execute(`
            SELECT COUNT(*) AS cnt
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'products' AND COLUMN_NAME = 'item_id'
        `, [process.env.DB_NAME || process.env.MYSQL_DATABASE]);
        if (!colExists || !colExists.cnt) {
            await req.db.execute(`ALTER TABLE products ADD COLUMN item_id INT NULL`);
        }

        await req.db.execute(`ALTER TABLE items ADD UNIQUE KEY uniq_items (name, category_id, unit_id, size_id)`);

        await req.db.execute(`
            INSERT INTO items (name, description, image_url, category_id, unit_id, size_id)
            SELECT p.name, 
                   SUBSTRING_INDEX(GROUP_CONCAT(IFNULL(p.description, '') ORDER BY p.id SEPARATOR '||'), '||', 1),
                   SUBSTRING_INDEX(GROUP_CONCAT(IFNULL(p.image_url, '') ORDER BY p.id SEPARATOR '||'), '||', 1),
                   p.category_id, p.unit_id, p.size_id
            FROM products p
            GROUP BY p.name, p.category_id, p.unit_id, p.size_id
            ON DUPLICATE KEY UPDATE description=VALUES(description), image_url=VALUES(image_url)
        `);

        const [updateRes] = await req.db.execute(`
            UPDATE products p
            JOIN items i
              ON i.name = p.name
             AND (i.category_id <=> p.category_id)
             AND (i.unit_id <=> p.unit_id)
             AND (i.size_id <=> p.size_id)
            SET p.item_id = i.id
            WHERE p.item_id IS NULL
        `);

        return res.json({ success: true, message: 'Migration completed', updated: updateRes.affectedRows || 0 });
    } catch (err) {
        console.error('Items migration error:', err);
        return res.status(500).json({ success: false, message: 'Migration failed', error: err.message });
    }
});
