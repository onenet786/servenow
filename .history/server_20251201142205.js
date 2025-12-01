const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const path = require('path');

// Load environment variables
dotenv.config();
console.log('Server starting... Environment variables loaded.');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const storeRoutes = require('./routes/stores');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const categoryRoutes = require('./routes/categories');

const app = express();
console.log('Express application created.');

// Middleware
console.log('Setting up middleware...');
app.use(cors({
    origin: true, // Allow all origins for development
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
console.log('Middleware setup complete.');

// Static files
console.log('Setting up static file serving...');
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
console.log('Static files configured for /uploads path.');

// Database connection
let db;
async function connectDB() {
    console.log('Attempting to connect to database...');
    try {
        db = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            port: process.env.DB_PORT
        });
        console.log(`Connected to MySQL database: ${process.env.DB_NAME}`);
        console.log(`Database host: ${process.env.DB_HOST}:${process.env.DB_PORT}`);
    } catch (error) {
        console.error('Database connection failed:', error);
        process.exit(1);
    }
}

// Make database connection available to routes
app.use((req, res, next) => {
    req.db = db;
    next();
});

// Request logging middleware
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path} - ${req.ip}`);
    next();
});

// Routes
console.log('Setting up API routes...');
app.use('/api/auth', authRoutes);
console.log('Auth routes mounted at /api/auth');
app.use('/api/users', userRoutes);
console.log('User routes mounted at /api/users');
app.use('/api/stores', storeRoutes);
console.log('Store routes mounted at /api/stores');
app.use('/api/products', productRoutes);
console.log('Product routes mounted at /api/products');
app.use('/api/orders', orderRoutes);
console.log('Order routes mounted at /api/orders');
app.use('/api/categories', categoryRoutes);
console.log('Category routes mounted at /api/categories');
console.log('All API routes configured.');

// Serve static files from the root directory for the frontend
console.log('Setting up frontend static file serving...');
app.use(express.static(path.join(__dirname)));
console.log('Frontend static files configured.');

// Catch all handler: send back index.html for any non-API routes
app.get('*', (req, res) => {
    // Only serve index.html for non-API routes
    if (!req.path.startsWith('/api/')) {
        res.sendFile(path.join(__dirname, 'index.html'));
    } else {
        res.status(404).json({ message: 'API endpoint not found' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        message: 'Something went wrong!',
        error: process.env.NODE_ENV === 'development' ? err.message : {}
    });
});

// Start server
const PORT = process.env.PORT || 3000;
console.log(`Configured PORT: ${PORT}`);

async function startServer() {
    await connectDB();
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`Environment: ${process.env.NODE_ENV}`);
    });
}

startServer().catch(console.error);
