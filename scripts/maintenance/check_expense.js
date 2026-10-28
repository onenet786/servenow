const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkExpense() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'servenow'
        });

        const expenseNumber = 'EXP-20260209-NEGL33';

        console.log(`Checking Expense: ${expenseNumber}`);

        const [expenses] = await connection.execute(
            'SELECT * FROM admin_expenses WHERE expense_number = ?',
            [expenseNumber]
        );

        if (expenses.length === 0) {
            console.log('Expense NOT FOUND in admin_expenses table.');
        } else {
            console.log('Expense Found:', expenses[0]);
            
            const [transactions] = await connection.execute(
                'SELECT * FROM financial_transactions WHERE reference_id = ? OR (related_entity_type = "admin_expense" AND related_entity_id = ?)',
                [expenseNumber, expenses[0].id]
            );

            if (transactions.length === 0) {
                console.log('Corresponding Financial Transaction NOT FOUND.');
            } else {
                console.log('Corresponding Financial Transaction Found:', transactions[0]);
            }
        }

        await connection.end();
    } catch (error) {
        console.error('Error:', error);
    }
}

checkExpense();