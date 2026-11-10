// One-time grants for rights that were split into one right per sub-menu
// (SPLITS in utils/rightsCatalog.js). Whoever held the old right, a group or a
// staff login, gets the new ones, so nobody loses a screen they could open.
// Each split runs once per database; rights_migrations remembers it. After that
// the new rights are given and taken away like any other.

const { SPLITS } = require('./rightsCatalog');

const MISSING_TABLE = 1146;

async function applyRightSplits(db, splits = SPLITS) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS rights_migrations (
      id VARCHAR(80) PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
  const [done] = await db.query('SELECT id FROM rights_migrations');
  const applied = new Set(done.map((r) => r.id));
  const results = [];

  for (const split of splits) {
    if (applied.has(split.id)) continue;
    const conn = await db.getConnection();
    let groups = 0;
    let users = 0;
    try {
      await conn.beginTransaction();
      const from = split.from.map(() => '?').join(',');
      for (const key of split.add) {
        for (const [table, owner] of [['permission_group_permissions', 'group_id'], ['user_permissions', 'user_id']]) {
          try {
            const [res] = await conn.query(
              `INSERT IGNORE INTO ${table} (${owner}, permission_key)
               SELECT DISTINCT ${owner}, ? FROM ${table} WHERE permission_key IN (${from})`,
              [key, ...split.from]
            );
            if (owner === 'group_id') groups += res.affectedRows; else users += res.affectedRows;
          } catch (err) {
            if (err.errno !== MISSING_TABLE) throw err; // no rights given yet on this database
          }
        }
      }
      await conn.query('INSERT INTO rights_migrations (id) VALUES (?)', [split.id]);
      await conn.commit();
      results.push({ id: split.id, groups, users });
      console.log(`[rights] ${split.id}: added to ${groups} group right(s) and ${users} staff right(s)`);
    } catch (err) {
      await conn.rollback();
      console.error(`[rights] ${split.id} failed, will try again at next start:`, err.message);
    } finally {
      conn.release();
    }
  }
  return results;
}

module.exports = { applyRightSplits };
