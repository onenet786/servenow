-- ServeNow Database Schema
-- Create database
CREATE DATABASE IF NOT EXISTS servenow;
USE servenow;

-- Users table
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    date_of_birth DATE DEFAULT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(20),
    password VARCHAR(255) NOT NULL,
    address TEXT,
    id_card_num VARCHAR(100) DEFAULT NULL,
    image_url VARCHAR(255) DEFAULT NULL,
    user_type ENUM('customer', 'store_owner', 'admin', 'standard_user') DEFAULT 'customer',
    verification_code VARCHAR(6),
    verification_expires_at TIMESTAMP,
    is_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Refresh tokens table
CREATE TABLE refresh_tokens (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    user_type ENUM(
        'customer',
        'store_owner',
        'admin',
        'standard_user',
        'staff',
        'vendor',
        'rider'
    ) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP NULL,
    replaced_by_hash CHAR(64) NULL,
    device_id VARCHAR(128) DEFAULT NULL,
    INDEX idx_refresh_token_hash (token_hash),
    INDEX idx_refresh_user (user_id, user_type),
    INDEX idx_refresh_expires (expires_at)
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
    priority INT DEFAULT NULL,
    commission_rate DECIMAL(5, 2) DEFAULT 10.00,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE KEY unique_priority (priority)
);

-- Store status messages (closed reason / temporary notices)
CREATE TABLE store_status_messages (
    id INT PRIMARY KEY AUTO_INCREMENT,
    store_id INT NOT NULL,
    status_message TEXT,
    is_closed BOOLEAN DEFAULT FALSE,
    updated_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_store_status_message_store (store_id),
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
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
    rider_latitude DECIMAL(10, 8),
    rider_longitude DECIMAL(11, 8),
    estimated_delivery_time TIMESTAMP,
    payment_method ENUM('card', 'cash', 'wallet') NOT NULL,
    payment_status ENUM('pending', 'paid', 'failed') DEFAULT 'pending',
    delivery_address TEXT NOT NULL,
    delivery_time VARCHAR(50),
    special_instructions TEXT,
    parent_order_number VARCHAR(50) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
    FOREIGN KEY (rider_id) REFERENCES riders(id) ON DELETE SET NULL
);

CREATE TABLE rider_location_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    rider_id INT NOT NULL,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (rider_id) REFERENCES riders(id) ON DELETE CASCADE,
    INDEX idx_rider_location_logs_rider_created (rider_id, created_at)
);

-- Order items table
CREATE TABLE order_items (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    store_id INT,
    quantity INT NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE SET NULL
);

-- Insert default categories
INSERT INTO categories (name, description) VALUES
('Vegetables', 'Fresh vegetables and greens'),
('Cooked Food', 'Ready-to-eat meals and cooked dishes'),
('Household', 'Household items and essentials'),
('Groceries', 'General grocery items');

-- Security: no default accounts, passwords, stores, products, or riders are seeded.
-- Provision the first administrator through a controlled, audited deployment process.

CREATE INDEX idx_products_store_id ON products(store_id);
CREATE INDEX idx_products_category_id ON products(category_id);
CREATE INDEX idx_products_is_available ON products(is_available);
CREATE INDEX idx_products_store_is_available ON products(store_id, is_available);
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_store_id ON orders(store_id);
CREATE INDEX idx_orders_parent_order_number ON orders(parent_order_number);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_items_product_id ON order_items(product_id);
CREATE INDEX idx_order_items_store_id ON order_items(store_id);
CREATE INDEX idx_riders_is_active ON riders(is_active);
CREATE INDEX idx_riders_is_available ON riders(is_available);
CREATE INDEX idx_stores_is_active ON stores(is_active);

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
    user_id INT UNIQUE,
    rider_id INT UNIQUE,
    balance DECIMAL(10, 2) DEFAULT 0.00,
    total_credited DECIMAL(10, 2) DEFAULT 0.00,
    total_spent DECIMAL(10, 2) DEFAULT 0.00,
    user_type ENUM('customer', 'rider') DEFAULT 'customer',
    auto_recharge_enabled BOOLEAN DEFAULT FALSE,
    auto_recharge_amount DECIMAL(10, 2) DEFAULT 0.00,
    auto_recharge_threshold DECIMAL(10, 2) DEFAULT 0.00,
    last_credited_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (rider_id) REFERENCES riders(id) ON DELETE CASCADE,
    INDEX idx_wallets_user_id (user_id),
    INDEX idx_wallets_rider_id (rider_id)
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
    payment_method ENUM('cash', 'card', 'bank_transfer', 'wallet', 'cheque') NOT NULL,
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
    payee_type ENUM('store', 'rider', 'vendor', 'employee', 'expense', 'other') NOT NULL,
    payee_id INT,
    amount DECIMAL(12, 2) NOT NULL,
    purpose VARCHAR(255),
    description TEXT,
    payment_method ENUM('cash', 'cheque', 'bank_transfer') NOT NULL,
    cheque_number VARCHAR(50),
    bank_details TEXT,
    status ENUM('draft', 'pending', 'approved', 'paid', 'cancelled') DEFAULT 'draft',
    prepared_by INT,
    approved_by INT,
    paid_by INT,
    approved_at TIMESTAMP NULL,
    paid_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    -- FOREIGN KEY (payee_id) removed to support polymorphic relationships (stores, riders, employees)
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
    payment_method ENUM('cash', 'cheque', 'bank_transfer') NOT NULL,
    cheque_number VARCHAR(50),
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
    payment_method ENUM('cash', 'cheque', 'bank_transfer') NOT NULL,
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

-- Journal Vouchers (JNV) table
CREATE TABLE IF NOT EXISTS journal_vouchers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    voucher_number VARCHAR(50) UNIQUE NOT NULL,
    voucher_date DATE NOT NULL,
    description TEXT,
    reference_number VARCHAR(100),
    total_amount DECIMAL(12, 2) NOT NULL,
    status ENUM('draft', 'posted', 'cancelled') DEFAULT 'draft',
    prepared_by INT,
    approved_by INT,
    posted_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (prepared_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_jnv_status (status),
    INDEX idx_jnv_voucher_date (voucher_date)
);

-- Journal Voucher Entries table
CREATE TABLE IF NOT EXISTS journal_voucher_entries (
    id INT PRIMARY KEY AUTO_INCREMENT,
    jnv_id INT NOT NULL,
    account_name VARCHAR(100) NOT NULL,
    entity_type ENUM('customer', 'store', 'rider', 'vendor', 'platform', 'other') DEFAULT 'other',
    entity_id INT,
    entry_type ENUM('debit', 'credit') NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    description TEXT,
    FOREIGN KEY (jnv_id) REFERENCES journal_vouchers(id) ON DELETE CASCADE,
    INDEX idx_jnv_entry_entity (entity_type, entity_id)
);

-- Admin Expenses table
CREATE TABLE IF NOT EXISTS admin_expenses (
    id INT PRIMARY KEY AUTO_INCREMENT,
    expense_number VARCHAR(50) UNIQUE NOT NULL,
    expense_date DATE NOT NULL,
    category VARCHAR(100) NOT NULL,
    description TEXT,
    amount DECIMAL(12, 2) NOT NULL,
    payment_method ENUM('cash', 'card', 'cheque', 'bank_transfer') NOT NULL,
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
    report_type ENUM('daily_summary', 'weekly_summary', 'monthly_summary', 'store_settlement', 'rider_cash_report', 'rider_orders_report', 'rider_payments_report', 'rider_receivings_report', 'rider_wallet_report', 'rider_petrol_report', 'rider_daily_mileage_report', 'rider_daily_activity_report', 'rider_day_closing_report', 'order_profit_report', 'expense_report', 'general_voucher', 'store_financials', 'rider_fuel_report', 'comprehensive_report', 'store_payable_reconciliation', 'unsettled_amounts_report', 'cash_discrepancy_report', 'store_order_settlement_report', 'credit_store_order_reconciliation', 'delivery_charges_breakdown', 'order_wise_sale_summary', 'periodic_sales_report', 'periodic_credit_cash_report', 'periodic_comprehensive_summary_report', 'periodic_store_payments_balance_report', 'transaction_summary', 'custom') NOT NULL,
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

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_id INT NOT NULL,
    user_id INT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    gateway VARCHAR(50),
    transaction_id VARCHAR(255),
    status ENUM('pending', 'success', 'failed', 'refunded') DEFAULT 'pending',
    error_message TEXT,
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
