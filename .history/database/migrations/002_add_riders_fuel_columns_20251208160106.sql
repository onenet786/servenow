-- Migration: Add new columns for enhanced riders_fuel_history entries
-- Adds: entry_date, start_meter, end_meter, distance, fuel_cost
-- Safe to run multiple times on MySQL 8+ (uses IF NOT EXISTS)

ALTER TABLE `riders_fuel_history`
  ADD COLUMN IF NOT EXISTS `entry_date` DATE NULL,
  ADD COLUMN IF NOT EXISTS `start_meter` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `end_meter` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `distance` DECIMAL(10,2) NULL,
  ADD COLUMN IF NOT EXISTS `fuel_cost` DECIMAL(10,2) NULL;

-- Note: If your MySQL version does not support IF NOT EXISTS for ADD COLUMN,
-- run the individual ALTER TABLE ... ADD COLUMN statements after verifying the column absence.
