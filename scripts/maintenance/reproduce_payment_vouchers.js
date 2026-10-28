const mysql = require('mysql2/promise');

async function test() {
    try {
        const connection = await mysql.createConnection({
            host: 'localhost',
            user: 'root',
            password: '',
            database: 'servenow',
            port: 3306
        });

        console.log('Connected to database');

        const page = 1;
        const limit = 20;
        const offset = (page - 1) * limit;
        
        // Test Case 2: Count Query
        console.log('\n--- Testing Count Query ---');
        try {
            const [countResult] = await connection.execute(
                `SELECT COUNT(*) as total FROM cash_payment_vouchers WHERE 1=1`,
                []
            );
            console.log('Count success! Total:', countResult[0].total);
        } catch (err) {
            console.error('Count query failed:', err);
        }

        // Test Case 3: With Payment Method 'bank'
        console.log('\n--- Testing Payment Method "bank" ---');
        try {
            let whereClause = 'WHERE 1=1';
            // Simulate logic from route
            whereClause += ' AND (payment_method = \'bank_transfer\' OR payment_method = \'cheque\')';
            
            const [vouchers] = await connection.execute(
                `SELECT cpv.*, pb.first_name as prepared_by_name, ab.first_name as approved_by_name, pib.first_name as paid_by_name
                 FROM cash_payment_vouchers cpv
                 LEFT JOIN users pb ON cpv.prepared_by = pb.id
                 LEFT JOIN users ab ON cpv.approved_by = ab.id
                 LEFT JOIN users pib ON cpv.paid_by = pib.id
                 ${whereClause}
                 ORDER BY cpv.voucher_date DESC
                 LIMIT ? OFFSET ?`,
                [parseInt(limit), offset]
            );
            console.log('Bank query success! Vouchers:', vouchers.length);
        } catch (err) {
            console.error('Bank query failed:', err);
        }

        await connection.end();
    } catch (err) {
        console.error('Main error:', err);
    }
}

test();
