const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkOrdersColumns() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        const [ordersCols] = await connection.execute("SHOW COLUMNS FROM orders");
        console.log("Orders Columns:", ordersCols.map(r => r.Field));

        await connection.end();
    } catch (e) {
        console.error(e);
    }
}

checkOrdersColumns();
