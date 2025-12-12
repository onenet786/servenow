const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config({ override: true });

(async () => {
  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'servenow',
      port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306
    });

    const [rows] = await conn.execute(
      "SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='stores' AND COLUMN_NAME='owner_name'"
    );
    const exists = rows && rows[0] && rows[0].cnt > 0;
    if (exists) {
      console.log('owner_name column already exists');
    } else {
      await conn.execute("ALTER TABLE `stores` ADD COLUMN `owner_name` VARCHAR(255) DEFAULT NULL");
      console.log('owner_name column added');
    }

    await conn.end();
    process.exit(0);
  } catch (e) {
    console.error('Migration error:', e.message);
    process.exit(1);
  }
})();

