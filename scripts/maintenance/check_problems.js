const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config();

async function runCheck() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'servenow',
        port: process.env.DB_PORT || 3306
    });

    console.log('--- SYSTEM DIAGNOSTICS REPORT ---');

    // 1. Admin User
    const [admins] = await connection.execute("SELECT COUNT(*) as count FROM users WHERE user_type = 'admin'");
    console.log(`Admin Users: ${admins[0].count}`);

    // 2. Orphan Products
    const [orphanedProducts] = await connection.execute("SELECT COUNT(*) as count FROM products WHERE store_id NOT IN (SELECT id FROM stores)");
    console.log(`Orphaned Products: ${orphanedProducts[0].count}`);

    // 3. Orphan Order Items
    const [orphanedItems] = await connection.execute("SELECT COUNT(*) as count FROM order_items WHERE order_id NOT IN (SELECT id FROM orders)");
    console.log(`Orphaned Order Items: ${orphanedItems[0].count}`);

    // 4. Invalid Order Statuses
    const [invalidOrders] = await connection.execute("SELECT COUNT(*) as count FROM orders WHERE status NOT IN ('pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled')");
    console.log(`Invalid Order Statuses: ${invalidOrders[0].count}`);

    // 5. Negative Wallets
    const [negativeWallets] = await connection.execute("SELECT COUNT(*) as count FROM wallets WHERE balance < 0");
    console.log(`Negative Wallets: ${negativeWallets[0].count}`);
    
    // 6. Products without categories
    const [productsNoCat] = await connection.execute("SELECT COUNT(*) as count FROM products WHERE category_id IS NULL");
    console.log(`Products without categories: ${productsNoCat[0].count}`);

    await connection.end();
}

runCheck().catch(err => {
    console.error('Check failed:', err.message);
    process.exit(1);
});
