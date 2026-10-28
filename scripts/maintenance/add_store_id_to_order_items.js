const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
    try {
        const conn = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'servenow'
        });

        console.log('Checking order_items schema...');
        const [columns] = await conn.execute("SHOW COLUMNS FROM order_items LIKE 'store_id'");
        
        if (columns.length === 0) {
            console.log('Adding store_id column to order_items...');
            await conn.execute('ALTER TABLE order_items ADD COLUMN store_id INT AFTER product_id');
            console.log('Column added.');
            
            console.log('Adding foreign key...');
            // Check if FK exists first to avoid error? Or just try adding.
            // Usually safe to just add if we know column is new.
            try {
                await conn.execute('ALTER TABLE order_items ADD CONSTRAINT fk_order_items_store FOREIGN KEY (store_id) REFERENCES stores(id)');
                console.log('Foreign key added.');
            } catch (e) {
                console.log('Foreign key might already exist or failed:', e.message);
            }

            console.log('Backfilling store_id from products...');
            await conn.execute(`
                UPDATE order_items oi
                JOIN products p ON oi.product_id = p.id
                SET oi.store_id = p.store_id
                WHERE oi.store_id IS NULL
            `);
            console.log('Backfill complete.');
        } else {
            console.log('store_id column already exists.');
        }

        await conn.end();
    } catch (e) {
        console.error(e);
    }
})();
