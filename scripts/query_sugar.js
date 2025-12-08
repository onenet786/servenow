const mysql = require('mysql2/promise');

(async () => {
  try {
    const c = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '',
      database: 'servenow',
      port: 3306
    });

    const [rows] = await c.execute("SELECT id, name, image_url, store_id FROM products WHERE name LIKE ?", ['%Sugar%']);
    console.log(JSON.stringify(rows, null, 2));
    await c.end();
  } catch (e) {
    console.error('DB_ERR', e);
    process.exit(1);
  }
})();
