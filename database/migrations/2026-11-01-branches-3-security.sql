-- ServeNow 1 Nov 2026: security fixes, part 3 of the branches update.
-- Run once in phpMyAdmin (database: servenow), AFTER the two branches files and a backup, and
-- BEFORE uploading the new server files. It only adds columns and clears pending reset codes, so
-- the current server keeps working. Safe to run more than once.

-- When the password last changed. A login issued before this date no longer counts. Empty means
-- it has not changed since this was added, so current sessions carry on.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at DATETIME NULL DEFAULT NULL;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS password_changed_at DATETIME NULL DEFAULT NULL;

-- Reset codes are now stored as keyed hashes. Any code stored before this was readable in a
-- backup, so it is removed. Someone in the middle of a reset simply requests a new code.
UPDATE users SET reset_password_token = NULL, reset_password_expires = NULL
 WHERE reset_password_token IS NOT NULL OR reset_password_expires IS NOT NULL;
UPDATE riders SET reset_password_token = NULL, reset_password_expires = NULL
 WHERE reset_password_token IS NOT NULL OR reset_password_expires IS NOT NULL;

-- ===== Check (read these results) =====
SELECT 'columns added (must be 2)' AS check_name, COUNT(*) AS n FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'password_changed_at' AND TABLE_NAME IN ('users', 'riders');
