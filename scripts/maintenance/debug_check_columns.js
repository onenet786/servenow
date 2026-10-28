const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkColumns() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        console.log("Connected to DB");

        const [orderItemsCols] = await connection.execute("SHOW COLUMNS FROM order_items");
        console.log("Order Items Columns:", orderItemsCols.map(r => r.Field));
        
        const [productsCols] = await connection.execute("SHOW COLUMNS FROM products");
        console.log("Products Columns:", productsCols.map(r => r.Field));

        await connection.end();
    } catch (e) {
        console.error(e);
    }
}

checkColumns();
