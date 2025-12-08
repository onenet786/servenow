const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

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
