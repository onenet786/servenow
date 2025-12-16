const mysql = require('mysql2/promise');
require('dotenv').config();

async function testStoreSearch() {
    let connection;
    let storeId, productId;

    try {
        console.log('Connecting to database...');
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            port: process.env.DB_PORT
        });

        // 1. Insert Test Store
        console.log('Inserting test store...');
        const [storeResult] = await connection.execute(
            `INSERT INTO stores (name, location, is_active, owner_id) VALUES (?, ?, ?, ?)`,
            ['TestSearchStore', 'TestLocation', 1, 1] // Assuming owner_id 1 exists (admin)
        );
        storeId = storeResult.insertId;

        // 2. Insert Test Product
        console.log('Inserting test product...');
        const [productResult] = await connection.execute(
            `INSERT INTO products (name, price, store_id, is_available) VALUES (?, ?, ?, ?)`,
            ['UniqueTestProductXYZ', 10.00, storeId, 1]
        );
        productId = productResult.insertId;

        // 3. Test Search Logic
        
        // A. Search by Product Name (Should PASS)
        console.log('A. Searching for Product Name: UniqueTestProductXYZ');
        const termA = 'UniqueTestProductXYZ';
        const searchTermA = `%${termA}%`;
        const [rowsA] = await connection.execute(`
            SELECT s.* 
            FROM stores s
            WHERE s.is_active = true AND (
                EXISTS (
                    SELECT 1 FROM products p 
                    WHERE p.store_id = s.id 
                    AND p.is_available = true 
                    AND p.name LIKE ?
                )
            )
        `, [searchTermA]);

        if (rowsA.some(r => r.id === storeId)) {
            console.log(`PASS: Found store for product term "${termA}"`);
        } else {
            console.error(`FAIL: Did not find store for product term "${termA}"`);
        }

        // B. Search by Store Name (Should FAIL to find)
        console.log('B. Searching for Store Name: TestSearchStore');
        const termB = 'TestSearchStore';
        const searchTermB = `%${termB}%`;
        const [rowsB] = await connection.execute(`
            SELECT s.* 
            FROM stores s
            WHERE s.is_active = true AND (
                EXISTS (
                    SELECT 1 FROM products p 
                    WHERE p.store_id = s.id 
                    AND p.is_available = true 
                    AND p.name LIKE ?
                )
            )
        `, [searchTermB]);

        if (rowsB.length === 0 || !rowsB.some(r => r.id === storeId)) {
            console.log(`PASS: Correctly did not find store for store name term "${termB}"`);
        } else {
            console.error(`FAIL: Found store for store name term "${termB}" (Should not happen)`);
        }

        // C. Search by Store Location (Should FAIL to find)
        console.log('C. Searching for Store Location: TestLocation');
        const termC = 'TestLocation';
        const searchTermC = `%${termC}%`;
        const [rowsC] = await connection.execute(`
            SELECT s.* 
            FROM stores s
            WHERE s.is_active = true AND (
                EXISTS (
                    SELECT 1 FROM products p 
                    WHERE p.store_id = s.id 
                    AND p.is_available = true 
                    AND p.name LIKE ?
                )
            )
        `, [searchTermC]);

        if (rowsC.length === 0 || !rowsC.some(r => r.id === storeId)) {
            console.log(`PASS: Correctly did not find store for location term "${termC}"`);
        } else {
            console.error(`FAIL: Found store for location term "${termC}" (Should not happen)`);
        }

    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        // Cleanup
        if (connection) {
            if (productId) {
                await connection.execute('DELETE FROM products WHERE id = ?', [productId]);
            }
            if (storeId) {
                await connection.execute('DELETE FROM stores WHERE id = ?', [storeId]);
            }
            await connection.end();
            console.log('Cleanup complete.');
        }
    }
}

testStoreSearch();
