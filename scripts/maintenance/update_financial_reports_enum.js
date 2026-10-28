const mysql = require('mysql2/promise');
require('dotenv').config();

async function fixFinancialReports() {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'servenow'
        });

        console.log('Connected to database');

        // 1. Alter Table
        console.log('Updating report_type ENUM...');
        // Note: We must list ALL existing values plus new ones.
        await connection.execute(`
            ALTER TABLE financial_reports 
            MODIFY COLUMN report_type 
            ENUM('daily_summary', 'weekly_summary', 'monthly_summary', 'store_settlement', 'rider_cash_report', 'expense_report', 'general_voucher', 'store_financials', 'rider_fuel_report', 'custom') 
            NOT NULL
        `);
        console.log('ENUM updated.');

        // 2. Fix Data
        console.log('Fixing existing records...');
        
        // Fix RFR
        const [rfrResult] = await connection.execute(`
            UPDATE financial_reports 
            SET report_type = 'rider_fuel_report' 
            WHERE report_type = '' AND report_number LIKE 'RFR-%'
        `);
        console.log(`Updated ${rfrResult.affectedRows} Rider Fuel Reports.`);

        // Check remaining empty
        const [remaining] = await connection.execute("SELECT count(*) as cnt FROM financial_reports WHERE report_type = ''");
        console.log(`Remaining empty types: ${remaining[0].cnt}`);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

fixFinancialReports();
