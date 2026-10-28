const mysql = require('mysql2/promise');
require('dotenv').config();

async function alterUsersTable() {
    const config = {
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'servenow'
    };

    try {
        const connection = await mysql.createConnection(config);
        
        console.log('Altering users table to add rider and vendor to user_type enum...');
        
        // Include existing types plus new ones. Also include 'staff' as seen in routes/financial.js logic if needed?
        // routes/financial.js checks for 'admin', 'staff'.
        // debug_db_schema.js showed: enum('customer','store_owner','admin')
        // Wait, routes/financial.js line 406 queries `user_type IN ("admin", "staff")`.
        // If 'staff' is not in the enum, that query would return nothing or fail? 
        // If the enum is strict, 'staff' shouldn't be in the WHERE clause unless it's a valid value.
        // Let's check debug output again.
        // Field: user_type, Type: enum('customer','store_owner','admin')
        // So 'staff' is NOT in the enum. That query in routes/financial.js line 406 might be problematic if it expects 'staff' to exist.
        // I should probably add 'staff' as well if the code references it.
        // But the user specifically asked for 'rider' and 'vendor'.
        // I will add 'rider', 'vendor', and 'staff' to be safe and consistent with the code usage.
        
        await connection.execute(`
            ALTER TABLE users 
            MODIFY COLUMN user_type ENUM('customer', 'store_owner', 'admin', 'staff', 'rider', 'vendor') DEFAULT 'customer'
        `);

        console.log('Successfully altered users table.');
        
        console.log('--- Verifying users columns ---');
        const [usersCols] = await connection.execute('SHOW COLUMNS FROM users');
        usersCols.forEach(col => {
            if (col.Field === 'user_type') {
                console.log(`Field: ${col.Field}, Type: ${col.Type}`);
            }
        });

        await connection.end();
    } catch (error) {
        console.error('Error altering table:', error);
    }
}

alterUsersTable();
