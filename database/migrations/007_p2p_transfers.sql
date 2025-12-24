-- ServeNow P2P Transfers Migration
-- Date: December 25, 2025
-- Feature: Enable users to send money to other users via wallet

USE servenow;

-- 1. Create Transfer Requests Table
CREATE TABLE IF NOT EXISTS wallet_transfers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    sender_id INT NOT NULL,
    recipient_id INT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    status ENUM('pending', 'completed', 'rejected', 'cancelled') DEFAULT 'pending',
    description VARCHAR(255),
    reference_id VARCHAR(255),
    rejection_reason VARCHAR(255),
    sender_wallet_id INT,
    recipient_wallet_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_wallet_id) REFERENCES wallets(id) ON DELETE SET NULL,
    FOREIGN KEY (recipient_wallet_id) REFERENCES wallets(id) ON DELETE SET NULL,
    
    INDEX idx_sender_id (sender_id),
    INDEX idx_recipient_id (recipient_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at),
    INDEX idx_sender_recipient (sender_id, recipient_id),
    INDEX idx_status_created (status, created_at)
);

-- 2. Create Transfer Notifications Table (optional for audit)
CREATE TABLE IF NOT EXISTS transfer_notifications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    transfer_id INT NOT NULL,
    type ENUM('transfer_sent', 'transfer_received', 'transfer_rejected') NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (transfer_id) REFERENCES wallet_transfers(id) ON DELETE CASCADE,
    
    INDEX idx_user_id (user_id),
    INDEX idx_transfer_id (transfer_id),
    INDEX idx_is_read (is_read)
);

-- 3. Add transfer fields to wallet_transactions for linking
ALTER TABLE wallet_transactions MODIFY reference_id VARCHAR(255);

-- 4. Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_wallet_transfers_user_status 
ON wallet_transfers(sender_id, status);
CREATE INDEX IF NOT EXISTS idx_wallet_transfers_recipient_status 
ON wallet_transfers(recipient_id, status);

-- Migration completed successfully
SELECT 'P2P Transfers Migration - COMPLETED' AS status;
