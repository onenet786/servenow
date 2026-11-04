const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { RIGHTS, MODULES, ADMIN_ONLY, TEMPLATES, unknownRights, highRisk } = require('../utils/rightsCatalog');
const router = express.Router();

// Rights changes are recorded and never edited.
async function ensureRightsAudit(db) {
    await db.query(`
        CREATE TABLE IF NOT EXISTS rights_audit_log (
            id INT PRIMARY KEY AUTO_INCREMENT,
            actor_id INT NULL,
            actor_name VARCHAR(160) NULL,
            action VARCHAR(40) NOT NULL,
            target_type VARCHAR(20) NOT NULL,
            target_id INT NULL,
            target_name VARCHAR(160) NULL,
            added TEXT NULL,
            removed TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            KEY idx_rights_audit_created (created_at)
        )
    `);
}

async function recordRightsChange(req, { action, targetType, targetId = null, targetName = null, added = [], removed = [] }) {
    try {
        await ensureRightsAudit(req.db);
        const actor = `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || req.user.email || null;
        await req.db.execute(
            `INSERT INTO rights_audit_log (actor_id, actor_name, action, target_type, target_id, target_name, added, removed)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.user.id, actor, action, targetType, targetId, targetName, added.join(', ') || null, removed.join(', ') || null]
        );
    } catch (err) {
        console.error('Rights audit write failed:', err);
    }
}

// Only staff logins can hold rights: customers and store owners never do.
async function findStaffUser(db, id) {
    const [rows] = await db.execute(
        "SELECT id, first_name, last_name, email FROM users WHERE id = ? AND user_type = 'standard_user'",
        [id]
    );
    return rows[0] || null;
}

const staffName = (user) => `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;

// Bad keys are refused; newly added high-risk rights must be confirmed by the caller.
function checkRightsRequest(res, permissions, previous, confirmed) {
    if (!Array.isArray(permissions)) {
        res.status(400).json({ success: false, message: 'Permissions must be an array' });
        return false;
    }
    const unknown = unknownRights(permissions);
    if (unknown.length) {
        res.status(400).json({ success: false, message: `Unknown rights: ${unknown.join(', ')}` });
        return false;
    }
    const newHighRisk = highRisk(permissions.filter((key) => !previous.includes(key)));
    if (newHighRisk.length && confirmed !== true) {
        res.status(409).json({
            success: false,
            needs_confirmation: true,
            message: 'These high-risk rights need confirming',
            rights: newHighRisk.map((r) => r.label),
        });
        return false;
    }
    return true;
}

router.get('/catalog', authenticateToken, requireAdmin, (req, res) => {
    res.json({ success: true, rights: RIGHTS, modules: MODULES, admin_only: ADMIN_ONLY, templates: TEMPLATES });
});

router.get('/audit', authenticateToken, requireAdmin, async (req, res) => {
    try {
        await ensureRightsAudit(req.db);
        const [rows] = await req.db.query(
            `SELECT id, actor_name, action, target_type, target_name, added, removed, created_at
             FROM rights_audit_log ORDER BY id DESC LIMIT 300`
        );
        res.json({ success: true, entries: rows });
    } catch (error) {
        console.error('Error loading rights audit:', error);
        res.status(500).json({ success: false, message: 'Failed to load the rights log' });
    }
});

// Ensure permissions table exists
async function ensurePermissionsTable(db) {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS user_permissions (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user_id INT NOT NULL,
                permission_key VARCHAR(100) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_user_perm (user_id, permission_key),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        // console.log("Verified user_permissions table exists");
    } catch (err) {
        console.error("Error creating user_permissions table:", err);
    }
}

async function ensurePermissionGroupTables(db) {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS permission_groups (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(100) NOT NULL UNIQUE,
                description VARCHAR(255) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS permission_group_permissions (
                id INT PRIMARY KEY AUTO_INCREMENT,
                group_id INT NOT NULL,
                permission_key VARCHAR(100) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_group_perm (group_id, permission_key),
                FOREIGN KEY (group_id) REFERENCES permission_groups(id) ON DELETE CASCADE
            )
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS user_permission_groups (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user_id INT NOT NULL,
                group_id INT NOT NULL,
                assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_user_group (user_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (group_id) REFERENCES permission_groups(id) ON DELETE CASCADE
            )
        `);
    } catch (err) {
        console.error("Error creating permission group tables:", err);
    }
}

async function getGroupPermissions(db, groupId) {
    const [rows] = await db.execute(
        "SELECT permission_key FROM permission_group_permissions WHERE group_id = ?",
        [groupId]
    );
    return rows.map((r) => r.permission_key);
}

async function syncGroupMembersPermissions(db, groupId, permissions) {
    const perms = Array.isArray(permissions) ? permissions : await getGroupPermissions(db, groupId);
    const [members] = await db.execute(
        "SELECT user_id FROM user_permission_groups WHERE group_id = ?",
        [groupId]
    );
    const userIds = members
        .map((m) => Number.parseInt(m.user_id, 10))
        .filter((id) => Number.isInteger(id) && id > 0);
    if (!userIds.length) return;

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const deletePlaceholders = userIds.map(() => "?").join(",");
        await connection.execute(
            `DELETE FROM user_permissions WHERE user_id IN (${deletePlaceholders})`,
            userIds
        );

        if (perms.length > 0) {
            const placeholders = [];
            const values = [];
            userIds.forEach((userId) => {
                perms.forEach((perm) => {
                    placeholders.push("(?, ?)");
                    values.push(userId, perm);
                });
            });
            await connection.execute(
                `INSERT INTO user_permissions (user_id, permission_key) VALUES ${placeholders.join(",")}`,
                values
            );
        }

        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
}

// Get all users for assignment (Admin only)
router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        await ensurePermissionGroupTables(req.db);
        const [users] = await req.db.execute(`
            SELECT u.id, u.first_name, u.last_name, u.email, u.user_type, u.phone, u.is_active,
                   (SELECT COUNT(*) FROM user_permissions p WHERE p.user_id = u.id) AS rights_count
            FROM users u
            WHERE u.user_type = 'standard_user'
            ORDER BY u.is_active DESC, u.first_name ASC
        `);
        const userIds = users.map((u) => u.id);
        let groupMap = new Map();
        if (userIds.length) {
            const placeholders = userIds.map(() => "?").join(",");
            const [groupRows] = await req.db.execute(
                `
                SELECT ug.user_id, g.id AS group_id, g.name AS group_name
                FROM user_permission_groups ug
                JOIN permission_groups g ON g.id = ug.group_id
                WHERE ug.user_id IN (${placeholders})
                `,
                userIds
            );
            groupMap = new Map(groupRows.map((r) => [r.user_id, { group_id: r.group_id, group_name: r.group_name }]));
        }
        const payload = users.map((u) => ({
            ...u,
            group_id: groupMap.get(u.id)?.group_id || null,
            group_name: groupMap.get(u.id)?.group_name || null
        }));
        res.json({ success: true, users: payload });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch users' });
    }
});

// Get permissions for a specific user
router.get('/user/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await ensurePermissionsTable(req.db);
        
        const [rows] = await req.db.execute(
            'SELECT permission_key FROM user_permissions WHERE user_id = ?',
            [id]
        );
        
        const permissions = rows.map(r => r.permission_key);
        res.json({ success: true, permissions });
    } catch (error) {
        console.error('Error fetching user permissions:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch permissions' });
    }
});

router.get('/user/:id/group', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await ensurePermissionGroupTables(req.db);
        const [rows] = await req.db.execute(
            `
            SELECT g.id, g.name, g.description
            FROM user_permission_groups ug
            JOIN permission_groups g ON g.id = ug.group_id
            WHERE ug.user_id = ?
            `,
            [id]
        );
        const group = rows[0] || null;
        res.json({ success: true, group });
    } catch (error) {
        console.error('Error fetching user group:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch user group' });
    }
});

router.post('/user/:id/group', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const groupId = req.body?.group_id ? Number(req.body.group_id) : null;
        await ensurePermissionsTable(req.db);
        await ensurePermissionGroupTables(req.db);

        if (groupId && !Number.isInteger(groupId)) {
            return res.status(400).json({ success: false, message: 'Invalid group_id' });
        }
        const staff = await findStaffUser(req.db, id);
        if (!staff) {
            return res.status(404).json({ success: false, message: 'Rights can only be given to staff accounts' });
        }
        const [currentRows] = await req.db.execute('SELECT permission_key FROM user_permissions WHERE user_id = ?', [id]);
        const previous = currentRows.map((r) => r.permission_key);

        let groupPermissions = [];
        if (groupId) {
            const [groupRows] = await req.db.execute(
                "SELECT id FROM permission_groups WHERE id = ?",
                [groupId]
            );
            if (!groupRows.length) {
                return res.status(404).json({ success: false, message: 'Group not found' });
            }
            groupPermissions = await getGroupPermissions(req.db, groupId);
            const newHighRisk = highRisk(groupPermissions.filter((key) => !previous.includes(key)));
            if (newHighRisk.length && req.body?.confirm_high_risk !== true) {
                return res.status(409).json({
                    success: false,
                    needs_confirmation: true,
                    message: 'This group gives high-risk rights',
                    rights: newHighRisk.map((r) => r.label),
                });
            }
        }

        const connection = await req.db.getConnection();
        try {
            await connection.beginTransaction();
            await connection.execute('DELETE FROM user_permission_groups WHERE user_id = ?', [id]);
            if (groupId) {
                await connection.execute(
                    'INSERT INTO user_permission_groups (user_id, group_id) VALUES (?, ?)',
                    [id, groupId]
                );
            }

            await connection.execute('DELETE FROM user_permissions WHERE user_id = ?', [id]);
            if (groupPermissions.length > 0) {
                const placeholders = groupPermissions.map(() => '(?, ?)').join(',');
                const values = [];
                groupPermissions.forEach((perm) => {
                    values.push(id, perm);
                });
                await connection.execute(
                    `INSERT INTO user_permissions (user_id, permission_key) VALUES ${placeholders}`,
                    values
                );
            }

            await connection.commit();
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }

        await recordRightsChange(req, {
            action: groupId ? 'assign_group' : 'remove_group',
            targetType: 'user',
            targetId: Number(id),
            targetName: staffName(staff),
            added: groupPermissions.filter((key) => !previous.includes(key)),
            removed: previous.filter((key) => !groupPermissions.includes(key)),
        });
        res.json({ success: true, message: 'User group updated successfully' });
    } catch (error) {
        console.error('Error updating user group:', error);
        res.status(500).json({ success: false, message: 'Failed to update user group' });
    }
});

// Update permissions for a specific user
router.post('/user/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { permissions } = req.body; // Array of permission keys

        await ensurePermissionsTable(req.db);
        const staff = await findStaffUser(req.db, id);
        if (!staff) {
            return res.status(404).json({ success: false, message: 'Rights can only be given to staff accounts' });
        }
        const [currentRows] = await req.db.execute('SELECT permission_key FROM user_permissions WHERE user_id = ?', [id]);
        const previous = currentRows.map((r) => r.permission_key);
        if (!checkRightsRequest(res, permissions, previous, req.body?.confirm_high_risk)) return;

        const connection = await req.db.getConnection();
        try {
            await connection.beginTransaction();
            
            // Remove existing permissions
            await connection.execute('DELETE FROM user_permissions WHERE user_id = ?', [id]);
            
            // Add new permissions
            if (permissions.length > 0) {
                const placeholders = permissions.map(() => '(?, ?)').join(',');
                const values = [];
                permissions.forEach(p => {
                    values.push(id, p);
                });
                
                await connection.execute(
                    `INSERT INTO user_permissions (user_id, permission_key) VALUES ${placeholders}`,
                    values
                );
            }
            
            await connection.commit();
            await recordRightsChange(req, {
                action: 'set_user_rights',
                targetType: 'user',
                targetId: Number(id),
                targetName: staffName(staff),
                added: permissions.filter((key) => !previous.includes(key)),
                removed: previous.filter((key) => !permissions.includes(key)),
            });
            res.json({ success: true, message: 'Permissions updated successfully' });
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Error updating permissions:', error);
        res.status(500).json({ success: false, message: 'Failed to update permissions' });
    }
});

router.get('/groups', authenticateToken, requireAdmin, async (req, res) => {
    try {
        await ensurePermissionGroupTables(req.db);
        const [groups] = await req.db.execute(
            `
            SELECT
                g.id,
                g.name,
                g.description,
                (SELECT COUNT(*) FROM permission_group_permissions gp WHERE gp.group_id = g.id) AS permissions_count,
                (SELECT COUNT(*) FROM user_permission_groups ug WHERE ug.group_id = g.id) AS member_count
            FROM permission_groups g
            ORDER BY g.name ASC
            `
        );
        res.json({ success: true, groups });
    } catch (error) {
        console.error('Error loading permission groups:', error);
        res.status(500).json({ success: false, message: 'Failed to load groups' });
    }
});

router.post('/groups', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const name = String(req.body?.name || '').trim();
        const description = String(req.body?.description || '').trim();
        if (!name) {
            return res.status(400).json({ success: false, message: 'Group name is required' });
        }
        await ensurePermissionGroupTables(req.db);
        const [result] = await req.db.execute(
            "INSERT INTO permission_groups (name, description) VALUES (?, ?)",
            [name, description || null]
        );
        await recordRightsChange(req, { action: 'create_group', targetType: 'group', targetId: result.insertId, targetName: name });
        res.json({ success: true, group_id: result.insertId });
    } catch (error) {
        if (error && error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: 'Group name already exists' });
        }
        console.error('Error creating permission group:', error);
        res.status(500).json({ success: false, message: 'Failed to create group' });
    }
});

router.put('/groups/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const name = String(req.body?.name || '').trim();
        const description = String(req.body?.description || '').trim();
        if (!name) {
            return res.status(400).json({ success: false, message: 'Group name is required' });
        }
        await ensurePermissionGroupTables(req.db);
        const [result] = await req.db.execute(
            "UPDATE permission_groups SET name = ?, description = ? WHERE id = ?",
            [name, description || null, id]
        );
        if (!result.affectedRows) {
            return res.status(404).json({ success: false, message: 'Group not found' });
        }
        await recordRightsChange(req, { action: 'rename_group', targetType: 'group', targetId: Number(id), targetName: name });
        res.json({ success: true, message: 'Group updated successfully' });
    } catch (error) {
        if (error && error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: 'Group name already exists' });
        }
        console.error('Error updating permission group:', error);
        res.status(500).json({ success: false, message: 'Failed to update group' });
    }
});

router.delete('/groups/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await ensurePermissionsTable(req.db);
        await ensurePermissionGroupTables(req.db);
        const [groupRows] = await req.db.execute('SELECT name FROM permission_groups WHERE id = ?', [id]);
        if (!groupRows.length) {
            return res.status(404).json({ success: false, message: 'Group not found' });
        }
        const [members] = await req.db.execute(
            `SELECT ug.user_id, TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS name, u.email
             FROM user_permission_groups ug LEFT JOIN users u ON u.id = ug.user_id
             WHERE ug.group_id = ?`,
            [id]
        );
        // Members lose the group's rights, exactly as when moved to "No group" on the Staff tab.
        // The screen shows who first and sends remove_members=1 once confirmed.
        const removeMembers = String(req.query.remove_members || req.body?.remove_members || '') === '1';
        if (members.length && !removeMembers) {
            return res.status(409).json({
                success: false,
                needs_confirmation: true,
                members: members.map((m) => m.name || m.email || `User #${m.user_id}`),
                message: 'This group still has people in it',
            });
        }

        const connection = await req.db.getConnection();
        try {
            await connection.beginTransaction();
            for (const m of members) {
                const [had] = await connection.execute('SELECT permission_key FROM user_permissions WHERE user_id = ?', [m.user_id]);
                m.lost = had.map((r) => r.permission_key);
                await connection.execute('DELETE FROM user_permission_groups WHERE user_id = ? AND group_id = ?', [m.user_id, id]);
                await connection.execute('DELETE FROM user_permissions WHERE user_id = ?', [m.user_id]);
            }
            await connection.execute('DELETE FROM permission_groups WHERE id = ?', [id]);
            await connection.commit();
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
        for (const m of members) {
            await recordRightsChange(req, { action: 'remove_group', targetType: 'user', targetId: Number(m.user_id), targetName: m.name || m.email || null, removed: m.lost || [] });
        }
        await recordRightsChange(req, { action: 'delete_group', targetType: 'group', targetId: Number(id), targetName: groupRows[0].name });

        res.json({ success: true, message: 'Group deleted successfully' });
    } catch (error) {
        console.error('Error deleting permission group:', error);
        res.status(500).json({ success: false, message: 'Failed to delete group' });
    }
});

router.get('/group/:id/permissions', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await ensurePermissionGroupTables(req.db);
        const permissions = await getGroupPermissions(req.db, id);
        res.json({ success: true, permissions });
    } catch (error) {
        console.error('Error fetching group permissions:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch group permissions' });
    }
});

router.post('/group/:id/permissions', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { permissions } = req.body;
        await ensurePermissionsTable(req.db);
        await ensurePermissionGroupTables(req.db);

        const [groupRows] = await req.db.execute('SELECT name FROM permission_groups WHERE id = ?', [id]);
        if (!groupRows.length) {
            return res.status(404).json({ success: false, message: 'Group not found' });
        }
        const previous = await getGroupPermissions(req.db, id);
        if (!checkRightsRequest(res, permissions, previous, req.body?.confirm_high_risk)) return;

        const connection = await req.db.getConnection();
        try {
            await connection.beginTransaction();
            await connection.execute(
                "DELETE FROM permission_group_permissions WHERE group_id = ?",
                [id]
            );

            if (permissions.length > 0) {
                const placeholders = permissions.map(() => "(?, ?)").join(",");
                const values = [];
                permissions.forEach((p) => values.push(id, p));
                await connection.execute(
                    `INSERT INTO permission_group_permissions (group_id, permission_key) VALUES ${placeholders}`,
                    values
                );
            }

            await connection.commit();
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }

        await syncGroupMembersPermissions(req.db, id, permissions);
        await recordRightsChange(req, {
            action: 'set_group_rights',
            targetType: 'group',
            targetId: Number(id),
            targetName: groupRows[0].name,
            added: permissions.filter((key) => !previous.includes(key)),
            removed: previous.filter((key) => !permissions.includes(key)),
        });
        res.json({ success: true, message: 'Group permissions updated successfully' });
    } catch (error) {
        console.error('Error updating group permissions:', error);
        res.status(500).json({ success: false, message: 'Failed to update group permissions' });
    }
});

// Get my permissions (for logged in user)
router.get('/my-permissions', authenticateToken, async (req, res) => {
    try {
        // Admins have all permissions implicitly, but we return a special flag or list
        if (req.user.user_type === 'admin') {
            return res.json({ success: true, isAdmin: true, permissions: ['*'] });
        }
        if (req.user.user_type !== 'standard_user') {
            return res.json({ success: true, permissions: [] });
        }

        await ensurePermissionsTable(req.db);
        
        const [rows] = await req.db.execute(
            'SELECT permission_key FROM user_permissions WHERE user_id = ?',
            [req.user.id]
        );
        
        const permissions = rows.map(r => r.permission_key);
        res.json({ success: true, permissions });
    } catch (error) {
        console.error('Error fetching my permissions:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch permissions' });
    }
});

module.exports = router;
