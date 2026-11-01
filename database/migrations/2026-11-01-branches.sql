-- ServeNow 1 Nov 2026: branches (Kot Addu + Muzaffargarh) in one system.
-- Run once in phpMyAdmin (database: servenow), AFTER taking a backup and BEFORE uploading
-- the new server files. It only ADDS things, so the current server keeps working on the
-- changed database. Safe to run more than once; a second run changes nothing.
--
-- What it does
--   1. Creates the branches list: Kot Addu (live) and Muzaffargarh (switched OFF until launch).
--   2. Adds a branch to users, stores, riders and orders. Every existing row becomes Kot Addu,
--      so nothing changes for Kot Addu customers, stores, riders or orders.
--   3. Staff logins (admin, standard_user) keep an empty branch = they see ALL branches,
--      exactly as today. A branch manager is a staff login given one branch (done in the app).
--
-- What it does NOT touch: wallets, vouchers, settlements, expenses, the ledger or any balance.
-- Branch totals for those are worked out from the rider and store each document belongs to.

-- ===== 1. Branches =====
CREATE TABLE IF NOT EXISTS branches (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(100) NOT NULL,
  city VARCHAR(100) NOT NULL,
  center_latitude DECIMAL(10,8) NULL,
  center_longitude DECIMAL(11,8) NULL,
  radius_km DECIMAL(6,2) NULL,
  phone VARCHAR(30) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_branches_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- id 1 must be Kot Addu: the columns below default to 1 so old code keeps writing Kot Addu.
INSERT INTO branches (id, code, name, city, center_latitude, center_longitude, radius_km, is_active, sort_order)
VALUES (1, 'kot-addu', 'Kot Addu', 'Kot Addu', 30.46860000, 70.96610000, NULL, 1, 1)
ON DUPLICATE KEY UPDATE code = code;

-- Muzaffargarh starts OFF: customers cannot choose it and no order can be placed there until
-- an admin switches it on in the app. Check the map centre before launch.
INSERT INTO branches (id, code, name, city, center_latitude, center_longitude, radius_km, is_active, sort_order)
VALUES (2, 'muzaffargarh', 'Muzaffargarh', 'Muzaffargarh', 30.07360000, 71.19300000, NULL, 0, 2)
ON DUPLICATE KEY UPDATE code = code;

-- ===== 2. Branch on the main records =====
-- Stores, riders and orders always belong to one branch; the default keeps old code working.
ALTER TABLE stores ADD COLUMN IF NOT EXISTS branch_id INT NOT NULL DEFAULT 1;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS branch_id INT NOT NULL DEFAULT 1;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS branch_id INT NOT NULL DEFAULT 1;

-- Users: customers and store owners belong to a branch; staff may be empty (all branches).
ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id INT NULL DEFAULT NULL;
UPDATE users SET branch_id = 1 WHERE branch_id IS NULL AND user_type IN ('customer', 'store_owner');

-- The delivery-area rule (city / radius) is per branch, so Kot Addu's rule never blocks
-- Muzaffargarh customers. The existing rule stays with Kot Addu; Muzaffargarh has none yet.
CREATE TABLE IF NOT EXISTS service_geo_limits (
  id INT PRIMARY KEY AUTO_INCREMENT,
  is_active BOOLEAN DEFAULT TRUE,
  city VARCHAR(120) NULL,
  center_latitude DECIMAL(10, 8) NULL,
  center_longitude DECIMAL(11, 8) NULL,
  radius_km DECIMAL(10, 2) NULL,
  require_location BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
ALTER TABLE service_geo_limits ADD COLUMN IF NOT EXISTS branch_id INT NOT NULL DEFAULT 1;

-- A store copied from another branch remembers its source, so a copy can run again safely:
-- the unique key refuses a second copy of one store into the same branch.
ALTER TABLE stores ADD COLUMN IF NOT EXISTS source_store_id INT NULL DEFAULT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_stores_branch_source ON stores (branch_id, source_store_id);

-- Delivery notices, promotions and flash messages can be for one branch; empty = every branch.
-- Existing rows stay "every branch". (Fees per branch need no column: they are extra settings.)
ALTER TABLE IF EXISTS global_delivery_status ADD COLUMN IF NOT EXISTS branch_id INT NULL DEFAULT NULL;
ALTER TABLE IF EXISTS live_promotions ADD COLUMN IF NOT EXISTS branch_id INT NULL DEFAULT NULL;
ALTER TABLE IF EXISTS customer_flash_messages ADD COLUMN IF NOT EXISTS branch_id INT NULL DEFAULT NULL;

-- ===== 3. Links and indexes =====
ALTER TABLE stores ADD FOREIGN KEY IF NOT EXISTS fk_stores_branch (branch_id) REFERENCES branches(id);
ALTER TABLE riders ADD FOREIGN KEY IF NOT EXISTS fk_riders_branch (branch_id) REFERENCES branches(id);
ALTER TABLE orders ADD FOREIGN KEY IF NOT EXISTS fk_orders_branch (branch_id) REFERENCES branches(id);
ALTER TABLE users  ADD FOREIGN KEY IF NOT EXISTS fk_users_branch (branch_id) REFERENCES branches(id);

CREATE INDEX IF NOT EXISTS idx_stores_branch ON stores (branch_id, is_active);
CREATE INDEX IF NOT EXISTS idx_riders_branch ON riders (branch_id, is_active);
CREATE INDEX IF NOT EXISTS idx_orders_branch_status ON orders (branch_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_users_branch ON users (branch_id, user_type);

-- ===== 4. Check (read these results) =====
-- Every count below must be 0 for the second and third lines; the first shows who is where.
SELECT 'orders per branch' AS check_name, branch_id, COUNT(*) AS n FROM orders GROUP BY branch_id;
SELECT 'orders not in their store branch' AS check_name, COUNT(*) AS n
  FROM orders o JOIN stores s ON s.id = o.store_id WHERE o.branch_id <> s.branch_id;
SELECT 'customers or store owners with no branch' AS check_name, COUNT(*) AS n
  FROM users WHERE user_type IN ('customer', 'store_owner') AND branch_id IS NULL;
