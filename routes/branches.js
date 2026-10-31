const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { listBranches, clearBranchCache, isOwnerEmail, staffScope, toBranchId, STAFF_TYPES } = require('../utils/branches');

const router = express.Router();

const publicBranch = (b) => ({
    id: Number(b.id),
    code: b.code,
    name: b.name,
    city: b.city,
    center_latitude: b.center_latitude === null ? null : Number(b.center_latitude),
    center_longitude: b.center_longitude === null ? null : Number(b.center_longitude),
    radius_km: b.radius_km === null ? null : Number(b.radius_km),
    phone: b.phone || null,
});

// Branches a customer can choose. Branches that are switched off are not listed.
router.get('/', async (req, res) => {
    try {
        const rows = await listBranches(req.db, { activeOnly: true });
        res.set('Cache-Control', 'public, max-age=30');
        res.json({ success: true, branches: rows.map(publicBranch) });
    } catch (error) {
        console.error('Error listing branches:', error);
        res.status(500).json({ success: false, message: 'Failed to load branches' });
    }
});

// Names for branch dropdowns on staff screens. Head office gets every branch, including closed
// ones being set up; a branch account gets only its own. Nothing here is sensitive.
router.get('/options', authenticateToken, async (req, res) => {
    if (!STAFF_TYPES.has(req.user.user_type)) return res.status(403).json({ success: false, message: 'Access denied' });
    try {
        const scope = staffScope(req.user);
        const rows = await listBranches(req.db);
        res.json({
            success: true,
            scope,
            branches: rows
                .filter((b) => scope === null || Number(b.id) === scope)
                .map((b) => ({ id: Number(b.id), name: b.name, is_active: Number(b.is_active) === 1 })),
        });
    } catch (error) {
        console.error('Error listing branch options:', error);
        res.status(500).json({ success: false, message: 'Failed to load branches' });
    }
});

// Only the owner account manages branches. The email is read from the database. Everyone else,
// other admins included, gets the same answer as for an address that does not exist.
const requireOwner = [authenticateToken, async (req, res, next) => {
    const notFound = () => res.status(404).json({ success: false, message: 'Not found' });
    if (req.user.user_type !== 'admin') return notFound();
    try {
        const [rows] = await req.db.execute(
            'SELECT email, user_type, is_active, branch_id FROM users WHERE id = ? LIMIT 1',
            [req.user.id]
        );
        const u = rows[0];
        if (!u || u.user_type !== 'admin' || !u.is_active || toBranchId(u.branch_id) !== null || !isOwnerEmail(u.email)) {
            return notFound();
        }
        next();
    } catch (error) {
        console.error('Branch owner check failed:', error);
        return notFound();
    }
}];

router.get('/all', requireOwner, async (req, res) => {
    try {
        const [rows] = await req.db.execute(
            `SELECT b.*,
                    (SELECT COUNT(*) FROM stores s WHERE s.branch_id = b.id) AS stores,
                    (SELECT COUNT(*) FROM riders r WHERE r.branch_id = b.id) AS riders,
                    (SELECT COUNT(*) FROM users u WHERE u.branch_id = b.id AND u.user_type = 'customer') AS customers
               FROM branches b ORDER BY b.sort_order ASC, b.id ASC`
        );
        res.json({ success: true, branches: rows });
    } catch (error) {
        console.error('Error listing all branches:', error);
        res.status(500).json({ success: false, message: 'Failed to load branches' });
    }
});

// Validates the editable fields. Returns { values } or { error }.
function readBranchFields(body, { partial }) {
    const values = {};
    const text = (key, max) => {
        if (body[key] === undefined) return partial ? undefined : `${key} is required`;
        const v = String(body[key]).trim();
        if (!v || v.length > max) return `${key} must be 1 to ${max} characters`;
        values[key] = v;
        return undefined;
    };
    const number = (key, min, max, { nullable = true } = {}) => {
        if (body[key] === undefined) return undefined;
        if ((body[key] === null || body[key] === '') && nullable) { values[key] = null; return undefined; }
        const n = Number(body[key]);
        if (!Number.isFinite(n) || n < min || n > max) return `${key} must be between ${min} and ${max}`;
        values[key] = n;
        return undefined;
    };

    const errors = [text('name', 100), text('city', 100)];
    if (body.code !== undefined || !partial) {
        const code = String(body.code || '').trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9-]{1,28}$/.test(code)) errors.push('code must be 2 to 29 letters, numbers or dashes');
        else values.code = code;
    }
    errors.push(
        number('center_latitude', -90, 90),
        number('center_longitude', -180, 180),
        number('radius_km', 0.1, 500),
        number('sort_order', 0, 1000, { nullable: false }),
    );
    if (body.phone !== undefined) {
        const v = body.phone === null ? '' : String(body.phone).trim();
        if (v.length > 30) errors.push('phone is too long');
        else values.phone = v || null;
    }
    if (body.is_active !== undefined) values.is_active = body.is_active === true || body.is_active === 1 || body.is_active === '1' ? 1 : 0;

    const error = errors.find(Boolean);
    return error ? { error } : { values };
}

router.post('/', requireOwner, async (req, res) => {
    const { values, error } = readBranchFields(req.body || {}, { partial: false });
    if (error) return res.status(400).json({ success: false, message: error });
    // A new branch starts switched off until it is ready to take orders.
    values.is_active = 0;
    try {
        if (values.sort_order === undefined) {
            const [[last]] = await req.db.execute('SELECT COALESCE(MAX(sort_order), 0) AS n FROM branches');
            values.sort_order = Number(last.n) + 1;
        }
        const cols = Object.keys(values);
        const [result] = await req.db.execute(
            `INSERT INTO branches (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
            cols.map((c) => values[c])
        );
        clearBranchCache();
        console.log(`[branches] ${req.user.email || req.user.id} created branch ${result.insertId} (${values.code})`);
        res.status(201).json({ success: true, id: result.insertId });
    } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'A branch with this code already exists' });
        console.error('Error creating branch:', e);
        res.status(500).json({ success: false, message: 'Failed to create branch' });
    }
});

router.put('/:id(\\d+)', requireOwner, async (req, res) => {
    const id = toBranchId(req.params.id);
    const { values, error } = readBranchFields(req.body || {}, { partial: true });
    if (error) return res.status(400).json({ success: false, message: error });
    const cols = Object.keys(values);
    if (!cols.length) return res.status(400).json({ success: false, message: 'Nothing to change' });
    try {
        const [existing] = await req.db.execute('SELECT id, is_active FROM branches WHERE id = ?', [id]);
        if (!existing.length) return res.status(404).json({ success: false, message: 'Branch not found' });

        // Never switch off the last open branch: customers would have nowhere to order.
        if (values.is_active === 0 && Number(existing[0].is_active) === 1) {
            const [[open]] = await req.db.execute('SELECT COUNT(*) AS n FROM branches WHERE is_active = 1 AND id <> ?', [id]);
            if (!Number(open.n)) {
                return res.status(409).json({ success: false, message: 'At least one branch must stay open' });
            }
        }

        await req.db.execute(
            `UPDATE branches SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
            [...cols.map((c) => values[c]), id]
        );
        clearBranchCache();
        console.log(`[branches] ${req.user.email || req.user.id} changed branch ${id}: ${cols.join(', ')}`);
        res.json({ success: true });
    } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'A branch with this code already exists' });
        console.error('Error updating branch:', e);
        res.status(500).json({ success: false, message: 'Failed to update branch' });
    }
});

module.exports = router;
