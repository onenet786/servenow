-- ServeNow Phase 1: Payments & Wallet System Migration
-- Date: December 25, 2025
-- Tables: payments, wallets, wallet_transactions

USE servenow;

-- 1. Payments Table
CREATE TABLE IF NOT EXISTS payments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_id INT NOT NULL,
    user_id INT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    payment_method ENUM('card', 'wallet', 'cash') NOT NULL,
    gateway ENUM('stripe', 'paypal', 'local') DEFAULT 'stripe',
    transaction_id VARCHAR(255) UNIQUE,
    status ENUM('pending', 'success', 'failed', 'refunded') DEFAULT 'pending',
    error_message TEXT,
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    
    INDEX idx_order_id (order_id),
    INDEX idx_user_id (user_id),
    INDEX idx_transaction_id (transaction_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
);

-- 2. Wallets Table
CREATE TABLE IF NOT EXISTS wallets (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT UNIQUE NOT NULL,
    balance DECIMAL(10, 2) DEFAULT 0.00,
    total_credited DECIMAL(10, 2) DEFAULT 0.00,
    total_spent DECIMAL(10, 2) DEFAULT 0.00,
    auto_recharge_enabled BOOLEAN DEFAULT FALSE,
    auto_recharge_amount DECIMAL(10, 2),
    auto_recharge_threshold DECIMAL(10, 2),
    last_credited_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    
    INDEX idx_user_id (user_id),
    INDEX idx_balance (balance)
);

-- 3. Wallet Transactions Table
CREATE TABLE IF NOT EXISTS wallet_transactions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    wallet_id INT NOT NULL,
    type ENUM('credit', 'debit', 'refund', 'adjustment') NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    description VARCHAR(255),
    reference_type VARCHAR(50),  -- 'order', 'refund', 'topup', 'refund'
    reference_id INT,
    balance_after DECIMAL(10, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE,
    
    INDEX idx_wallet_id (wallet_id),
    INDEX idx_type (type),
    INDEX idx_created_at (created_at),
    INDEX idx_reference (reference_type, reference_id)
);

-- 4. Add payment_gateway_customer_id to users (for Stripe customer tracking)
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS paypal_customer_id VARCHAR(255);
ALTER TABLE users ADD INDEX IF NOT EXISTS idx_stripe_customer_id (stripe_customer_id);

-- 5. Add payment fields to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_gateway ENUM('stripe', 'paypal', 'local') DEFAULT 'stripe';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS transaction_id VARCHAR(255);
ALTER TABLE orders ADD INDEX IF NOT EXISTS idx_transaction_id (transaction_id);

-- 6. Create Saved Payment Methods Table (optional but recommended)
CREATE TABLE IF NOT EXISTS saved_payment_methods (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    type ENUM('card', 'paypal') NOT NULL,
    gateway_id VARCHAR(255) UNIQUE,
    card_last_four VARCHAR(4),
    card_brand VARCHAR(50),  -- 'visa', 'mastercard', etc.
    card_expiry_month INT,
    card_expiry_year INT,
    is_primary BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    
    INDEX idx_user_id (user_id),
    INDEX idx_is_primary (is_primary)
);

-- 7. Create Refunds Table
CREATE TABLE IF NOT EXISTS refunds (
    id INT PRIMARY KEY AUTO_INCREMENT,
    payment_id INT NOT NULL,
    order_id INT NOT NULL,
    user_id INT NOT NULL,
    refund_amount DECIMAL(10, 2) NOT NULL,
    reason VARCHAR(255),
    status ENUM('pending', 'processed', 'failed') DEFAULT 'pending',
    refund_transaction_id VARCHAR(255),
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP NULL DEFAULT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    
    INDEX idx_status (status),
    INDEX idx_requested_at (requested_at),
    INDEX idx_order_id (order_id)
);

-- 8. Payment Configuration Table (for storing gateway API keys, fees, etc.)
CREATE TABLE IF NOT EXISTS payment_config (
    id INT PRIMARY KEY AUTO_INCREMENT,
    gateway_name VARCHAR(50) UNIQUE NOT NULL,
    is_enabled BOOLEAN DEFAULT TRUE,
    api_key VARCHAR(255),
    secret_key VARCHAR(255),
    webhook_secret VARCHAR(255),
    transaction_fee DECIMAL(5, 3) DEFAULT 2.9,
    fixed_fee DECIMAL(10, 2) DEFAULT 0.30,
    config JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_gateway (gateway_name)
);

-- 9. Initialize Wallets for Existing Users
INSERT INTO wallets (user_id, balance, total_credited, total_spent)
SELECT id, 0, 0, 0 FROM users 
WHERE id NOT IN (SELECT user_id FROM wallets);

-- 10. Create Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_payments_user_status ON payments(user_id, status);
CREATE INDEX IF NOT EXISTS idx_wallet_txn_user_date ON wallet_transactions(wallet_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(id, payment_status);

-- 11. Grant Permissions (adjust for your user)
-- GRANT ALL PRIVILEGES ON servenow.payments TO 'servenow'@'localhost';
-- GRANT ALL PRIVILEGES ON servenow.wallets TO 'servenow'@'localhost';
-- GRANT ALL PRIVILEGES ON servenow.wallet_transactions TO 'servenow'@'localhost';
-- FLUSH PRIVILEGES;

-- Migration completed successfully
SELECT 'Phase 1 Migration: Payments & Wallet System - COMPLETED' AS status;
