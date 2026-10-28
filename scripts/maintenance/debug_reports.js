const mysql = require('mysql2/promise');
require('dotenv').config();

async function debugReports() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'servenow'
        });

        console.log('Connected to database');
        
        console.log('--- Report Types in DB ---');
        const [rows] = await connection.execute('SELECT report_type, COUNT(*) as count FROM financial_reports GROUP BY report_type');
        console.table(rows);

        console.log('--- All Reports Sample (first 5) ---');
        const [sample] = await connection.execute('SELECT id, report_type, report_number FROM financial_reports LIMIT 5');
        console.table(sample);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

debugReports();
