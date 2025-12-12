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
      const full = path.join(migDir, file);
      const sql = fs.readFileSync(full, 'utf8');
      const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
      console.log('Applying:', file, `(${statements.length} statements)`);
      for (const stmt of statements) {
        try {
          await conn.query(stmt);
        } catch (e) {
          const msg = String(e && e.message ? e.message : e);
          // Allow duplicate column / index / constraint errors to pass
          if (/Duplicate column name/i.test(msg) ||
              /Duplicate key name/i.test(msg) ||
              /Constraint.*already exists/i.test(msg) ||
              /errno: 1061/i.test(msg) || // duplicate key
              /errno: 1060/i.test(msg) || // duplicate column
              /errno: 1826/i.test(msg)) { // foreign key exists
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

