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

        // 3. Test Search Logic (mimicking routes/stores.js)
        const searchTerms = ['UniqueTestProductXYZ', 'TestSearchStore', 'TestLocation'];
        
        for (const term of searchTerms) {
            console.log(`Searching for: ${term}`);
            const searchTerm = `%${term}%`;
            const [rows] = await connection.execute(`
                SELECT s.* 
                FROM stores s
                WHERE s.is_active = true AND (
                    s.name LIKE ? OR 
                    s.location LIKE ? OR 
                    EXISTS (
                        SELECT 1 FROM products p 
                        WHERE p.store_id = s.id 
                        AND p.is_available = true 
                        AND p.name LIKE ?
                    )
                )
            `, [searchTerm, searchTerm, searchTerm]);

            const found = rows.some(r => r.id === storeId);
            if (found) {
                console.log(`PASS: Found store for term "${term}"`);
            } else {
                console.error(`FAIL: Did not find store for term "${term}"`);
            }
        }

        // 4. Test Negative Case
        const negativeTerm = 'NonExistentProductABC';
        console.log(`Searching for: ${negativeTerm}`);
        const searchTerm = `%${negativeTerm}%`;
        const [negRows] = await connection.execute(`
            SELECT s.* 
            FROM stores s
            WHERE s.is_active = true AND (
                s.name LIKE ? OR 
                s.location LIKE ? OR 
                EXISTS (
                    SELECT 1 FROM products p 
                    WHERE p.store_id = s.id 
                    AND p.is_available = true 
                    AND p.name LIKE ?
                )
            )
        `, [searchTerm, searchTerm, searchTerm]);
        
        if (negRows.length === 0) {
            console.log(`PASS: Correctly found no stores for "${negativeTerm}"`);
        } else {
            // Check if our test store is in there (it shouldn't be)
            const found = negRows.some(r => r.id === storeId);
            if (!found) {
                 console.log(`PASS: Correctly did not find test store for "${negativeTerm}"`);
            } else {
                 console.error(`FAIL: Found test store for negative term "${negativeTerm}"`);
            }
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
