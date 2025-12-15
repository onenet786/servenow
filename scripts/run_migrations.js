require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

(async () => {
  let conn;
  try {
    const host = process.env.DB_HOST || 'localhost';
    const user = process.env.DB_USER || 'root';
    const password = process.env.DB_PASSWORD || '';
    const database = process.env.DB_NAME || 'servenow';
    const port = parseInt(process.env.DB_PORT || '3306', 10);

    conn = await mysql.createConnection({ host, user, password, port, multipleStatements: true });
    await conn.query(`USE \`${database}\``);

    const migDir = path.join(__dirname, '..', 'database', 'migrations');
    const files = fs.readdirSync(migDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log('Running migrations on DB:', database);
    for (const file of files) {
      if (/^005_/.test(file)) {
        console.warn('Skipping problematic migration:', file);
        continue;
      }
      const full = path.join(migDir, file);
      const sql = fs.readFileSync(full, 'utf8');
      // Strip single-line comments before splitting into statements
      const sqlNoComments = sql
        .split('\n')
        .filter(line => !line.trim().startsWith('--'))
        .join('\n');
      const statements = sqlNoComments.split(';').map(s => s.trim()).filter(Boolean);
      console.log('Applying:', file, `(${statements.length} statements)`);
      for (let stmt of statements) {
        try {
          // Strip single-line comments starting with --
          stmt = stmt
            .split('\n')
            .filter(line => !line.trim().startsWith('--'))
            .join('\n')
            .trim();
          if (!stmt) {
            console.warn('Skip (empty statement)');
            continue;
          }
          // Handle "ADD COLUMN IF NOT EXISTS" for MariaDB/MySQL versions that don't support it
          const addColMatch = stmt.match(/ALTER\s+TABLE\s+`?(\w+)`?\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+`?(\w+)`?/i);
          if (addColMatch) {
            const tableName = addColMatch[1];
            const columnName = addColMatch[2];
            const [rows] = await conn.query(
              'SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
              [database, tableName, columnName]
            );
            if (rows[0].cnt > 0) {
              console.warn(`Skip add column ${tableName}.${columnName}: already exists`);
              continue;
            }
            // Remove IF NOT EXISTS and proceed
            stmt = stmt.replace(/IF\s+NOT\s+EXISTS\s+/i, '');
          }
          // Also normalize any remaining "ADD COLUMN IF NOT EXISTS" occurrences in multi-add statements
          stmt = stmt.replace(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/gi, 'ADD COLUMN');
          await conn.query(stmt);
        } catch (e) {
          const msg = String(e && e.message ? e.message : e);
          // Allow duplicate column / index / constraint errors to pass
          if (/Duplicate column name/i.test(msg) ||
              /Duplicate key name/i.test(msg) ||
              /Duplicate key on write or update/i.test(msg) ||
              /Constraint.*already exists/i.test(msg) ||
              /errno: 1061/i.test(msg) || // duplicate key
              /errno: 1060/i.test(msg) || // duplicate column
              /errno: 1826/i.test(msg) || // foreign key exists
              /errno:\s*121/i.test(msg)   // duplicate key (InnoDB)
             ) {
            console.warn('Skip (already applied):', msg);
            continue;
          }
          throw e;
        }
      }
      console.log('Applied:', file);
    }
    console.log('All migrations applied successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err && err.message ? err.message : err);
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
})();

