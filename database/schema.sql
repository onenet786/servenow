-- ServeNow Database Schema
-- Create database
CREATE DATABASE IF NOT EXISTS servenow;
USE servenow;

-- Users table
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(20),
    password VARCHAR(255) NOT NULL,
    address TEXT,
    user_type ENUM('customer', 'store_owner', 'admin') DEFAULT 'customer',
    verification_code VARCHAR(6),
    verification_expires_at TIMESTAMP,
    is_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Stores table
CREATE TABLE stores (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    location VARCHAR(100),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    rating DECIMAL(3, 2) DEFAULT 0.00,
    delivery_time VARCHAR(50),
    opening_time TIME DEFAULT NULL,
    closing_time TIME DEFAULT NULL,
    payment_term ENUM('Cash Only','Cash with Discount','Credit','Credit with Discount') DEFAULT NULL,
    phone VARCHAR(20),
    email VARCHAR(100),
    address TEXT,
    owner_id INT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Categories table
CREATE TABLE categories (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL,
    description TEXT,
    image_url VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Products table
CREATE TABLE products (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    cost_price DECIMAL(10, 2) DEFAULT NULL,
    price DECIMAL(10, 2) NOT NULL,
    image_url VARCHAR(255),
    -- Image color metadata for client-side rendering without canvas
    image_bg_r INT DEFAULT NULL,
    image_bg_g INT DEFAULT NULL,
    image_bg_b INT DEFAULT NULL,
    image_overlay_alpha DECIMAL(4,3) DEFAULT NULL,
    image_contrast VARCHAR(7) DEFAULT NULL,
    category_id INT,
    store_id INT NOT NULL,
    stock_quantity INT DEFAULT 0,
    is_available BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
);

-- Riders table
CREATE TABLE riders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(20),
    password VARCHAR(255) NOT NULL,
    vehicle_type VARCHAR(50),
    license_number VARCHAR(50),
    is_available BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Orders table
CREATE TABLE orders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_number VARCHAR(20) UNIQUE NOT NULL,
    user_id INT NOT NULL,
    store_id INT NOT NULL,
    rider_id INT,
    total_amount DECIMAL(10, 2) NOT NULL,
    delivery_fee DECIMAL(5, 2) DEFAULT 2.99,
    status ENUM('pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled') DEFAULT 'pending',
    rider_location TEXT,
    estimated_delivery_time TIMESTAMP,
    payment_method ENUM('card', 'cash', 'wallet') NOT NULL,
    payment_status ENUM('pending', 'paid', 'failed') DEFAULT 'pending',
    delivery_address TEXT NOT NULL,
    delivery_time VARCHAR(50),
    special_instructions TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
    FOREIGN KEY (rider_id) REFERENCES riders(id) ON DELETE SET NULL
);

-- Order items table
CREATE TABLE order_items (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Insert default categories
INSERT INTO categories (name, description) VALUES
('Vegetables', 'Fresh vegetables and greens'),
('Cooked Food', 'Ready-to-eat meals and cooked dishes'),
('Household', 'Household items and essentials'),
('Groceries', 'General grocery items');

-- Insert sample admin user (password: admin123)
INSERT INTO users (first_name, last_name, email, phone, password, user_type) VALUES
('Admin', 'User', 'admin@servenow.com', '+1234567890', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin');

-- Insert sample stores
INSERT INTO stores (name, location, latitude, longitude, rating, delivery_time, phone, email, owner_id) VALUES
('Fresh Market', 'Downtown', 40.7128, -74.0060, 4.5, '30-45 mins', '+1234567891', 'fresh@market.com', 1),
('Green Grocery', 'Midtown', 40.7589, -73.9851, 4.2, '25-40 mins', '+1234567892', 'green@grocery.com', 1),
('Local Foods', 'Brooklyn', 40.6782, -73.9442, 4.7, '35-50 mins', '+1234567893', 'local@foods.com', 1);

-- Insert sample products
INSERT INTO products (name, price, category_id, store_id, stock_quantity) VALUES
('Organic Tomatoes', 3.99, 1, 1, 50),
('Fresh Spinach', 2.49, 1, 1, 30),
('Carrots', 1.99, 1, 2, 40),
('Chicken Biryani', 12.99, 2, 3, 20),
('Vegetable Pizza', 15.99, 2, 2, 15),
('Grilled Chicken', 18.99, 2, 1, 25),
('Dish Soap', 4.99, 3, 1, 35),
('Laundry Detergent', 8.99, 3, 2, 20),
('Toilet Paper', 6.99, 3, 3, 50),
('Milk', 3.49, 4, 1, 30),
('Bread', 2.99, 4, 2, 40),
('Rice', 5.99, 4, 3, 60);

INSERT INTO riders (first_name, last_name, email, phone, password, vehicle_type, license_number) VALUES
('Ahmed', 'Khan', 'ahmed.rider@servenow.com', '+1234567894', 'rider123', 'Motorcycle', 'LIC123456'),
('Fatima', 'Ali', 'fatima.rider@servenow.com', '+1234567895', 'rider456', 'Bicycle', 'LIC123457'),
('Omar', 'Hassan', 'omar.rider@servenow.com', '+1234567896', 'rider789', 'Scooter', 'LIC123458');

CREATE INDEX idx_products_store_id ON products(store_id);
CREATE INDEX idx_products_category_id ON products(category_id);
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_store_id ON orders(store_id);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);

-- Table: riders_fuel_history
-- Stores rider fuel entries with start/end meter, distance and cost
CREATE TABLE IF NOT EXISTS `riders_fuel_history` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `rider_id` INT NOT NULL,
    `entry_date` DATE DEFAULT NULL,
    `start_meter` VARCHAR(64) DEFAULT NULL,
    `end_meter` VARCHAR(64) DEFAULT NULL,
    `distance` DECIMAL(10,2) DEFAULT NULL,
    `petrol_rate` DECIMAL(10,2) DEFAULT NULL,
    `fuel_cost` DECIMAL(10,2) DEFAULT NULL,
    `notes` TEXT DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_rfh_rider` (`rider_id`),
    CONSTRAINT `fk_rfh_rider` FOREIGN KEY (`rider_id`) REFERENCES `riders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Wallets table
CREATE TABLE IF NOT EXISTS wallets (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT UNIQUE NOT NULL,
    balance DECIMAL(10, 2) DEFAULT 0.00,
    total_credited DECIMAL(10, 2) DEFAULT 0.00,
    total_spent DECIMAL(10, 2) DEFAULT 0.00,
    auto_recharge_enabled BOOLEAN DEFAULT FALSE,
    auto_recharge_amount DECIMAL(10, 2) DEFAULT 0.00,
    auto_recharge_threshold DECIMAL(10, 2) DEFAULT 0.00,
    last_credited_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_wallets_user_id (user_id)
);

-- Wallet transactions table
CREATE TABLE IF NOT EXISTS wallet_transactions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    wallet_id INT NOT NULL,
    type ENUM('credit', 'debit', 'refund', 'transfer') NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    description VARCHAR(255),
    reference_type VARCHAR(50),  -- 'order', 'refund', 'topup', 'transfer'
    reference_id VARCHAR(255),
    balance_after DECIMAL(10, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE,
    INDEX idx_wt_wallet_id (wallet_id),
    INDEX idx_wt_type (type),
    INDEX idx_wt_created_at (created_at)
);

-- Wallet transfers table
CREATE TABLE IF NOT EXISTS wallet_transfers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    sender_id INT NOT NULL,
    recipient_id INT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    description TEXT,
    sender_wallet_id INT NOT NULL,
    recipient_wallet_id INT NOT NULL,
    status ENUM('pending', 'completed', 'rejected', 'cancelled') DEFAULT 'pending',
    rejection_reason TEXT,
    completed_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_wallet_id) REFERENCES wallets(id),
    FOREIGN KEY (recipient_wallet_id) REFERENCES wallets(id)
);

-- Saved payment methods table
CREATE TABLE IF NOT EXISTS saved_payment_methods (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    type ENUM('card', 'paypal') NOT NULL,
    gateway_id VARCHAR(255) NOT NULL,
    card_last_four VARCHAR(4),
    card_brand VARCHAR(20),
    card_expiry_month INT,
    card_expiry_year INT,
    is_primary BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_spm_user_id (user_id)
);

-- Financial Transactions table
CREATE TABLE IF NOT EXISTS financial_transactions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    transaction_number VARCHAR(50) UNIQUE NOT NULL,
    transaction_type ENUM('income', 'expense', 'settlement', 'refund', 'adjustment') NOT NULL,
    category VARCHAR(50),
    description TEXT,
    amount DECIMAL(12, 2) NOT NULL,
    payment_method ENUM('cash', 'card', 'bank_transfer', 'wallet', 'check') NOT NULL,
    related_entity_type VARCHAR(50),
    related_entity_id INT,
    reference_id VARCHAR(100),
    reference_type VARCHAR(50),
    status ENUM('pending', 'completed', 'cancelled', 'reversed') DEFAULT 'completed',
    notes TEXT,
    created_by INT,
    approved_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_ft_transaction_type (transaction_type),
    INDEX idx_ft_created_at (created_at),
    INDEX idx_ft_payment_method (payment_method)
);

-- Cash Payment Vouchers table
CREATE TABLE IF NOT EXISTS cash_payment_vouchers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    voucher_number VARCHAR(50) UNIQUE NOT NULL,
    voucher_date DATE NOT NULL,
    payee_name VARCHAR(100) NOT NULL,
    payee_type ENUM('store', 'rider', 'vendor', 'employee', 'other') NOT NULL,
    payee_id INT,
    amount DECIMAL(12, 2) NOT NULL,
    purpose VARCHAR(255),
    description TEXT,
    payment_method ENUM('cash', 'check', 'bank_transfer') NOT NULL,
    check_number VARCHAR(50),
    bank_details TEXT,
    status ENUM('draft', 'pending', 'approved', 'paid', 'cancelled') DEFAULT 'draft',
    prepared_by INT,
    approved_by INT,
    paid_by INT,
    approved_at TIMESTAMP NULL,
    paid_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (payee_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (prepared_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (paid_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_cpv_status (status),
    INDEX idx_cpv_payee_type (payee_type),
    INDEX idx_cpv_voucher_date (voucher_date)
);

-- Cash Receipt Vouchers table
CREATE TABLE IF NOT EXISTS cash_receipt_vouchers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    voucher_number VARCHAR(50) UNIQUE NOT NULL,
    voucher_date DATE NOT NULL,
    payer_name VARCHAR(100) NOT NULL,
    payer_type ENUM('customer', 'store', 'vendor', 'other') NOT NULL,
    payer_id INT,
    amount DECIMAL(12, 2) NOT NULL,
    description VARCHAR(255),
    details TEXT,
    payment_method ENUM('cash', 'check', 'bank_transfer') NOT NULL,
    check_number VARCHAR(50),
    bank_details TEXT,
    status ENUM('draft', 'pending', 'received', 'cancelled') DEFAULT 'draft',
    prepared_by INT,
    approved_by INT,
    received_by INT,
    approved_at TIMESTAMP NULL,
    received_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (payer_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (prepared_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_crv_status (status),
    INDEX idx_crv_payer_type (payer_type),
    INDEX idx_crv_voucher_date (voucher_date)
);

-- Rider Cash Movements table
CREATE TABLE IF NOT EXISTS rider_cash_movements (
    id INT PRIMARY KEY AUTO_INCREMENT,
    movement_number VARCHAR(50) UNIQUE NOT NULL,
    rider_id INT NOT NULL,
    movement_date DATE NOT NULL,
    movement_type ENUM('cash_collection', 'cash_submission', 'advance', 'settlement', 'adjustment') NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    description TEXT,
    reference_type VARCHAR(50),
    reference_id INT,
    status ENUM('pending', 'completed', 'approved', 'cancelled') DEFAULT 'pending',
    recorded_by INT,
    approved_by INT,
    approved_at TIMESTAMP NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (rider_id) REFERENCES riders(id) ON DELETE CASCADE,
    FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_rcm_rider_id (rider_id),
    INDEX idx_rcm_movement_type (movement_type),
    INDEX idx_rcm_movement_date (movement_date)
);

-- Store Settlements table
CREATE TABLE IF NOT EXISTS store_settlements (
    id INT PRIMARY KEY AUTO_INCREMENT,
    settlement_number VARCHAR(50) UNIQUE NOT NULL,
    settlement_date DATE NOT NULL,
    store_id INT NOT NULL,
    period_from DATE,
    period_to DATE,
    total_orders_amount DECIMAL(12, 2) DEFAULT 0.00,
    commissions DECIMAL(12, 2) DEFAULT 0.00,
    deductions DECIMAL(12, 2) DEFAULT 0.00,
    net_amount DECIMAL(12, 2) NOT NULL,
    payment_method ENUM('cash', 'check', 'bank_transfer') NOT NULL,
    status ENUM('pending', 'approved', 'paid', 'cancelled') DEFAULT 'pending',
    approved_by INT,
    paid_by INT,
    approved_at TIMESTAMP NULL,
    paid_at TIMESTAMP NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (paid_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_ss_store_id (store_id),
    INDEX idx_ss_settlement_date (settlement_date),
    INDEX idx_ss_status (status)
);

-- Admin Expenses table
CREATE TABLE IF NOT EXISTS admin_expenses (
    id INT PRIMARY KEY AUTO_INCREMENT,
    expense_number VARCHAR(50) UNIQUE NOT NULL,
    expense_date DATE NOT NULL,
    category VARCHAR(100) NOT NULL,
    description TEXT,
    amount DECIMAL(12, 2) NOT NULL,
    payment_method ENUM('cash', 'card', 'check', 'bank_transfer') NOT NULL,
    vendor_name VARCHAR(100),
    receipt_number VARCHAR(50),
    status ENUM('pending', 'approved', 'paid', 'rejected') DEFAULT 'pending',
    submitted_by INT,
    approved_by INT,
    approved_at TIMESTAMP NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_ae_category (category),
    INDEX idx_ae_expense_date (expense_date),
    INDEX idx_ae_status (status)
);

-- Financial Reports table
CREATE TABLE IF NOT EXISTS financial_reports (
    id INT PRIMARY KEY AUTO_INCREMENT,
    report_number VARCHAR(50) UNIQUE NOT NULL,
    report_type ENUM('daily_summary', 'weekly_summary', 'monthly_summary', 'store_settlement', 'rider_cash_report', 'expense_report', 'custom') NOT NULL,
    period_from DATE,
    period_to DATE,
    total_income DECIMAL(12, 2) DEFAULT 0.00,
    total_expense DECIMAL(12, 2) DEFAULT 0.00,
    total_commissions DECIMAL(12, 2) DEFAULT 0.00,
    net_profit DECIMAL(12, 2) DEFAULT 0.00,
    data JSON,
    generated_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (generated_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_fr_report_type (report_type),
    INDEX idx_fr_period_from (period_from)
);
