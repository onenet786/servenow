// One-time upgrade when order, product, fuel and approval actions got their own rights.
//
// Before, any staff login with the screen could change an order's status, mark it paid, cancel it,
// delete products, log fuel and approve vouchers. Those now need a right, so on the first start after
// the upgrade each new right is given only to the staff (groups and individual logins) who already
// held the matching older right. Nobody gains anything they could not do before; maker-checker still
// applies. It runs once (recorded in schema_upgrades) and writes one entry to the rights audit log,
// so an admin can see and remove any of it on the User Rights screen.

const UPGRADE = 'rights-2026-11-split';

// new right -> older rights that already allowed the same action
const GRANTS = {
  action_order_status: ['action_edit_order', 'menu_orders'],
  action_order_create: ['action_edit_order'],
  action_order_payment: ['action_edit_order'],
  action_order_cancel: ['action_edit_order'],
  action_delete_products: ['action_manage_products'],
  action_manage_fuel: ['menu_riders', 'menu_financial_rider_cash'],
  approve_cpv: ['menu_financial_cpv'],
  approve_bpv: ['menu_financial_bpv'],
  approve_crv: ['menu_financial_crv'],
  approve_brv: ['menu_financial_brv'],
  approve_jnv: ['menu_financial_jnv'],
  approve_rider_cash: ['menu_financial_rider_cash'],
  approve_settlements: ['menu_financial_settlements'],
  approve_expenses: ['menu_financial_expenses'],
};

async function tableExists(db, name) {
  const [rows] = await db.execute(
    'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1',
    [name]
  );
  return rows.length > 0;
}

/** Returns { applied: false } when already done (or nothing to upgrade), else what was granted. */
async function grantSplitRights(db, { log = console } = {}) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_upgrades (
      name VARCHAR(80) PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
  const [done] = await db.execute('SELECT 1 FROM schema_upgrades WHERE name = ?', [UPGRADE]);
  if (done.length) return { applied: false };
  // A fresh database has no rights yet: nothing to carry over. The marker waits for real tables.
  if (!(await tableExists(db, 'user_permissions'))) return { applied: false };
  const hasGroups = await tableExists(db, 'permission_group_permissions');

  const conn = await db.getConnection();
  const summary = { users: 0, groups: 0, rights: {} };
  try {
    await conn.beginTransaction();
    // Re-check inside the transaction so two processes starting together do it once.
    const [again] = await conn.execute('SELECT 1 FROM schema_upgrades WHERE name = ? FOR UPDATE', [UPGRADE]);
    if (again.length) {
      await conn.rollback();
      return { applied: false };
    }
    for (const [right, from] of Object.entries(GRANTS)) {
      const marks = from.map(() => '?').join(', ');
      // Only staff logins hold rights (customers, store owners and riders never do).
      const [u] = await conn.execute(
        `INSERT IGNORE INTO user_permissions (user_id, permission_key)
         SELECT DISTINCT up.user_id, ? FROM user_permissions up
           JOIN users usr ON usr.id = up.user_id AND usr.user_type = 'standard_user'
          WHERE up.permission_key IN (${marks})`,
        [right, ...from]
      );
      let g = { affectedRows: 0 };
      if (hasGroups) {
        [g] = await conn.execute(
          `INSERT IGNORE INTO permission_group_permissions (group_id, permission_key)
           SELECT DISTINCT gp.group_id, ? FROM permission_group_permissions gp WHERE gp.permission_key IN (${marks})`,
          [right, ...from]
        );
      }
      const added = Number(u.affectedRows || 0) + Number(g.affectedRows || 0);
      if (added) summary.rights[right] = { users: Number(u.affectedRows || 0), groups: Number(g.affectedRows || 0) };
      summary.users += Number(u.affectedRows || 0);
      summary.groups += Number(g.affectedRows || 0);
    }
    await conn.execute('INSERT INTO schema_upgrades (name) VALUES (?)', [UPGRADE]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const lines = Object.entries(summary.rights).map(([k, v]) => `${k} (${v.users} users, ${v.groups} groups)`);
  try {
    if (await tableExists(db, 'rights_audit_log')) {
      await db.execute(
        `INSERT INTO rights_audit_log (actor_id, actor_name, action, target_type, target_id, target_name, added, removed)
         VALUES (NULL, 'System upgrade', 'upgrade', 'system', NULL, ?, ?, NULL)`,
        ['New rights given to staff who held the matching older right', lines.join('; ') || 'nothing to give']
      );
    }
  } catch (err) {
    log.error('[rights] audit entry failed:', err.message);
  }
  log.log(`[rights] upgrade ${UPGRADE}: ${lines.join('; ') || 'nothing to give'}`);
  return { applied: true, ...summary };
}

module.exports = { grantSplitRights, GRANTS, UPGRADE };
