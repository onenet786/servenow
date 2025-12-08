const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');

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
        const allowed = ['stores', 'riders_fuel_history'];
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
        const dbUser = process.env.DB_USER || process.env.MYSQL_USER || 'root';
        const dbPass = process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || '';
        const dbHost = process.env.DB_HOST || '127.0.0.1';
        const dbPort = process.env.DB_PORT || '3306';
        const mysqldump = process.env.MYSQLDUMP_PATH || 'mysqldump';

        // Use spawn to stream mysqldump output to a file and avoid exposing password in the process list.
        const args = ['-h', dbHost, '-P', dbPort, '-u', dbUser, dbName];
        const spawnEnv = Object.assign({}, process.env);
        if (dbPass) spawnEnv.MYSQL_PWD = dbPass; // safer than passing -p on the command line

        const dump = spawn(mysqldump, args, { env: spawnEnv });
        const outStream = fs.createWriteStream(filepath, { flags: 'w' });
        dump.stdout.pipe(outStream);

        // Ensure we only send one response
        let responded = false;

        let stderrAccum = '';
        dump.stderr.on('data', (chunk) => {
            stderrAccum += chunk.toString();
        });

        dump.on('error', (err) => {
            console.error('DB backup spawn error:', err);
            try { if (!responded) { responded = true; outStream.close(); } } catch(e) { /* ignore */ }
            if (!responded) return res.status(500).json({ success: false, message: 'Backup spawn failed', error: err.message });
        });

        dump.on('close', (code) => {
            try { outStream.close(); } catch(e) { /* ignore */ }
            if (responded) return;
            responded = true;
            if (code !== 0) {
                console.error('DB backup failed with code:', code, stderrAccum);
                return res.status(500).json({ success: false, message: 'Backup failed', exitCode: code, error: stderrAccum });
            }
            return res.json({ success: true, filename, downloadUrl: `/api/admin/backup-db/download?file=${encodeURIComponent(filename)}` });
        });
    } catch (err) {
        console.error('Backup error:', err);
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
