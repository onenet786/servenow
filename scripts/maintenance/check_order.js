const mysql = require('mysql2/promise');
async function run() {
  try {
    const conn = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'servenow'
    });
    const [rows] = await conn.execute('SELECT order_number, created_at FROM orders ORDER BY created_at DESC LIMIT 10');
    console.log(JSON.stringify(rows, null, 2));
    await conn.end();
  } catch (e) {
    console.error(e);
  }
}
run();