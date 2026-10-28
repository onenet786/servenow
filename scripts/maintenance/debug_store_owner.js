const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'servenow'
};

(async () => {
    try {
        const conn = await mysql.createConnection(dbConfig);
        
        console.log('--- Checking User ---');
        // Search for the specific user first
        const [users] = await conn.execute('SELECT id, email, first_name, last_name, user_type FROM users WHERE email = ? OR id = ?', ['owner@servenow.pk', 11]);
        console.log('User found:', users);

        if (users.length === 0) {
            console.log('\nUser owner@servenow.pk not found. Listing all store owners:');
            const [allStoreOwners] = await conn.execute('SELECT id, email, first_name, last_name FROM users WHERE user_type = "store_owner"');
            console.log(allStoreOwners);

            console.log('\n--- Listing All Stores ---');
            const [allStores] = await conn.execute('SELECT id, name, owner_id FROM stores');
            console.log(allStores);
        } else {
            const userId = users[0].id;
            
            console.log('\n--- Checking Stores for User ---');
            const [stores] = await conn.execute('SELECT id, name, owner_id FROM stores WHERE owner_id = ?', [userId]);
            console.log('Stores:', stores);
            
            console.log('\n--- Checking Order ---');
            const [order] = await conn.execute('SELECT id, order_number, store_id FROM orders ORDER BY created_at DESC LIMIT 5');
            console.log('Recent Orders:', order);
            
            if (order.length > 0) {
                const orderId = order[0].id;
                
                console.log('\n--- Checking Order Items ---');
                const [items] = await conn.execute('SELECT id, order_id, product_id, store_id, quantity, price FROM order_items WHERE order_id = ?', [orderId]);
                console.log('Order Items:', items);
                
                // Check if any item matches the user's stores
                const userStoreIds = stores.map(s => s.id);
                const matchingItems = items.filter(i => userStoreIds.includes(i.store_id));
                console.log('\n--- Matching Items ---');
                console.log('User Store IDs:', userStoreIds);
                console.log('Matching Items:', matchingItems);
            }
        }
        await conn.end();
    } catch (err) {
        console.error(err);
    }
})();
