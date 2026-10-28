const mysql = require('mysql2/promise');

async function checkFK() {
    try {
        const connection = await mysql.createConnection({
            host: 'localhost',
            user: 'root',
            password: '',
            database: 'servenow',
            port: 3306
        });

        console.log('Connected to database');

        const [rows] = await connection.execute(`
            SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = 'servenow' AND TABLE_NAME = 'cash_payment_vouchers' AND COLUMN_NAME = 'payee_id';
        `);

        if (rows.length > 0) {
            console.log('Foreign Key found on payee_id:', rows);
        } else {
            console.log('No Foreign Key on payee_id');
        }

        // Also check columns to see ENUM values
        const [columns] = await connection.execute(`
            SHOW COLUMNS FROM cash_payment_vouchers LIKE 'payee_type';
        `);
        console.log('payee_type column:', columns[0].Type);

        await connection.end();
    } catch (err) {
        console.error('Error:', err);
    }
}

checkFK();
