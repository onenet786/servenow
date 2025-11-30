const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function setupDatabase() {
    let connection;

    try {
        console.log('Connecting to MySQL...');

        // Connect without database first
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            port: process.env.DB_PORT
        });

        console.log('Connected to MySQL server');

        // Drop and create database
        await connection.query('DROP DATABASE IF EXISTS servenow');
        await connection.query('CREATE DATABASE servenow');
        console.log('Database created');

        // Switch to the database
        await connection.query('USE servenow');

        // Read and execute schema
        const schemaPath = path.join(__dirname, 'database', 'schema.sql');
        const schemaSQL = fs.readFileSync(schemaPath, 'utf8');

        // Split SQL commands and execute them
        const commands = schemaSQL.split(';').filter(cmd => cmd.trim().length > 0);

        for (const command of commands) {
            if (command.trim()) {
                await connection.query(command);
            }
        }

        console.log('Database schema created successfully');
        console.log('Sample data inserted');
        console.log('');
        console.log('Admin login credentials:');
        console.log('Email: admin@servenow.com');
        console.log('Password: admin123');
        console.log('');
        console.log('Database setup complete!');

    } catch (error) {
        console.error('Database setup failed:', error);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

setupDatabase();
