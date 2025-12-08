-- Migration 004: Add opening_time and closing_time to stores
-- Backup your DB before running.

ALTER TABLE `stores`
  ADD COLUMN `opening_time` TIME DEFAULT NULL,
  ADD COLUMN `closing_time` TIME DEFAULT NULL;
