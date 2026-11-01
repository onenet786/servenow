-- ServeNow 1 Nov 2026: branches, part 2. Tags every money document with its branch.
-- Run once in phpMyAdmin (database: servenow), AFTER 2026-11-01-branches.sql and a backup, and
-- BEFORE uploading the new server files. It only ADDS columns and indexes, so the current
-- server keeps working on the changed database. Safe to run more than once.
--
-- The books stay one set of books: a branch column on each document lets the same data be read
-- combined (head office) or for one branch. Every existing row becomes Kot Addu (branch 1).
-- No amount, balance, status or journal line changes. Ledger fingerprints use journal lines
-- only, so the ledger does not re-post anything because of this file.
--
-- Wallets and wallet transactions have no branch of their own: they belong to their rider,
-- store or customer, and are read through that owner.

-- ===== 1. Branch on each money table =====
ALTER TABLE IF EXISTS financial_transactions       ADD COLUMN IF NOT EXISTS branch_id INT NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS cash_payment_vouchers        ADD COLUMN IF NOT EXISTS branch_id INT NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS cash_receipt_vouchers        ADD COLUMN IF NOT EXISTS branch_id INT NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS rider_cash_movements         ADD COLUMN IF NOT EXISTS branch_id INT NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS rider_cash_submission_orders ADD COLUMN IF NOT EXISTS branch_id INT NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS rider_day_closings           ADD COLUMN IF NOT EXISTS branch_id INT NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS rider_fuel_payment_entries   ADD COLUMN IF NOT EXISTS branch_id INT NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS riders_fuel_history          ADD COLUMN IF NOT EXISTS branch_id INT NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS rider_store_payments         ADD COLUMN IF NOT EXISTS branch_id INT NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS store_settlements            ADD COLUMN IF NOT EXISTS branch_id INT NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS journal_vouchers             ADD COLUMN IF NOT EXISTS branch_id INT NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS admin_expenses               ADD COLUMN IF NOT EXISTS branch_id INT NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS payments                     ADD COLUMN IF NOT EXISTS branch_id INT NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS financial_reports            ADD COLUMN IF NOT EXISTS branch_id INT NULL DEFAULT 1;
ALTER TABLE IF EXISTS gl_journals                  ADD COLUMN IF NOT EXISTS branch_id INT NOT NULL DEFAULT 1;

-- ===== 2. Indexes =====
ALTER TABLE IF EXISTS financial_transactions       ADD INDEX IF NOT EXISTS idx_ft_branch (branch_id, created_at);
ALTER TABLE IF EXISTS cash_payment_vouchers        ADD INDEX IF NOT EXISTS idx_cpv_branch (branch_id, voucher_date);
ALTER TABLE IF EXISTS cash_receipt_vouchers        ADD INDEX IF NOT EXISTS idx_crv_branch (branch_id, voucher_date);
ALTER TABLE IF EXISTS rider_cash_movements         ADD INDEX IF NOT EXISTS idx_rcm_branch (branch_id, movement_date);
ALTER TABLE IF EXISTS rider_cash_submission_orders ADD INDEX IF NOT EXISTS idx_rcso_branch (branch_id);
ALTER TABLE IF EXISTS rider_day_closings           ADD INDEX IF NOT EXISTS idx_rdc_branch (branch_id, closed_date);
ALTER TABLE IF EXISTS rider_fuel_payment_entries   ADD INDEX IF NOT EXISTS idx_rfpe_branch (branch_id);
ALTER TABLE IF EXISTS riders_fuel_history          ADD INDEX IF NOT EXISTS idx_rfh_branch (branch_id, entry_date);
ALTER TABLE IF EXISTS rider_store_payments         ADD INDEX IF NOT EXISTS idx_rsp_branch (branch_id);
ALTER TABLE IF EXISTS store_settlements            ADD INDEX IF NOT EXISTS idx_ss_branch (branch_id, settlement_date);
ALTER TABLE IF EXISTS journal_vouchers             ADD INDEX IF NOT EXISTS idx_jnv_branch (branch_id, voucher_date);
ALTER TABLE IF EXISTS admin_expenses               ADD INDEX IF NOT EXISTS idx_ae_branch (branch_id, expense_date);
ALTER TABLE IF EXISTS payments                     ADD INDEX IF NOT EXISTS idx_payments_branch (branch_id);
ALTER TABLE IF EXISTS financial_reports            ADD INDEX IF NOT EXISTS idx_fr_branch (branch_id);
ALTER TABLE IF EXISTS gl_journals                  ADD INDEX IF NOT EXISTS idx_gl_journal_branch (branch_id, journal_date);

-- ===== 3. Check (read these results) =====
-- Both counts must be 0 before Muzaffargarh opens, and debit must equal credit.
SELECT 'journals outside branch 1' AS check_name, COUNT(*) AS n FROM gl_journals WHERE branch_id <> 1;
SELECT 'rider cash outside branch 1' AS check_name, COUNT(*) AS n FROM rider_cash_movements WHERE branch_id <> 1;
SELECT 'ledger totals' AS check_name, SUM(debit) AS debit, SUM(credit) AS credit FROM gl_lines;
