-- ServeNow 28 Oct 2026: stock tracking, refunds and the general ledger.
-- The server applies these itself on start-up. Run this file in phpMyAdmin only if the
-- server log shows it could not (e.g. the database user has no ALTER/CREATE rights).
-- Safe to run more than once. Take a backup first.

-- Orders: stock is restored on cancellation only if it was deducted; wallet refunds
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_deducted TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE orders MODIFY COLUMN payment_status ENUM('pending','paid','failed','refunded') DEFAULT 'pending';

-- General ledger (filled automatically by the server; see services/ledger.js)
CREATE TABLE IF NOT EXISTS gl_accounts (
  code VARCHAR(10) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  account_type ENUM('asset','liability','equity','income','expense') NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS gl_journals (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  journal_key VARCHAR(120) NOT NULL,
  source_type VARCHAR(40) NOT NULL,
  source_id VARCHAR(80) NOT NULL,
  seq INT NOT NULL DEFAULT 1,
  journal_date DATE NOT NULL,
  description VARCHAR(255) NULL,
  fingerprint CHAR(64) NULL,
  reversal_of BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_gl_journal_key (journal_key),
  KEY idx_gl_journal_source (source_type, source_id),
  KEY idx_gl_journal_date (journal_date),
  KEY idx_gl_journal_reversal (reversal_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS gl_lines (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  journal_id BIGINT NOT NULL,
  account_code VARCHAR(10) NOT NULL,
  entity_type VARCHAR(20) NULL,
  entity_id VARCHAR(40) NULL,
  debit DECIMAL(14,2) NOT NULL DEFAULT 0,
  credit DECIMAL(14,2) NOT NULL DEFAULT 0,
  memo VARCHAR(255) NULL,
  KEY idx_gl_lines_journal (journal_id),
  KEY idx_gl_lines_account (account_code, entity_type, entity_id),
  CONSTRAINT fk_gl_lines_journal FOREIGN KEY (journal_id) REFERENCES gl_journals(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO gl_accounts (code, name, account_type) VALUES
  ('1000', 'Office cash', 'asset'),
  ('1010', 'Bank and gateway', 'asset'),
  ('1100', 'Rider cash receivable', 'asset'),
  ('1150', 'Cash collections clearing', 'asset'),
  ('1300', 'Rider advances', 'asset'),
  ('2000', 'Store payables', 'liability'),
  ('2100', 'Customer wallet balances', 'liability'),
  ('2150', 'Wallet transfers in transit', 'liability'),
  ('2200', 'Customer prepayments', 'liability'),
  ('3900', 'Suspense (needs review)', 'equity'),
  ('4000', 'Commission income', 'income'),
  ('4050', 'Order adjustments and rounding', 'income'),
  ('4100', 'Delivery fee income', 'income'),
  ('4900', 'Other income', 'income'),
  ('5100', 'Salaries and rider pay', 'expense'),
  ('5200', 'Rent', 'expense'),
  ('5300', 'Utilities and communication', 'expense'),
  ('5400', 'Vehicle, fuel and maintenance', 'expense'),
  ('5500', 'Marketing and printing', 'expense'),
  ('5600', 'Office and stationery', 'expense'),
  ('5800', 'Wallet and cash adjustments', 'expense'),
  ('5900', 'Other expenses', 'expense')
ON DUPLICATE KEY UPDATE name = VALUES(name), account_type = VALUES(account_type);
