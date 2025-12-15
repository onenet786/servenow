const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const mysqlLib = require('mysql2');

const BACKUP_DIR = path.join(__dirname, '..', 'database', 'backups');

function ensureBackupDir() {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
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
