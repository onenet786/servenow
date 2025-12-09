require('dotenv').config();
const mysql = require('mysql2/promise');

const email = process.argv[2];
if (!email) {
  console.error('Usage: node scripts/check_user.js <email>');
  process.exit(2);
}

(async () => {
  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'servenow',
      port: process.env.DB_PORT || 3306
    });

    const [rows] = await conn.execute(
      'SELECT id, email, user_type, is_active, LENGTH(password) AS pw_len, created_at FROM users WHERE email = ?',
      [email]
    );

    if (rows.length === 0) {
      console.log(`No user found with email: ${email}`);
    } else {
      console.log('User row:');
      console.log(JSON.stringify(rows[0], null, 2));
    }

    await conn.end();
    process.exit(0);
  } catch (err) {
    console.error('DB check failed:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
