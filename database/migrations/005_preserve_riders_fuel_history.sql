-- Migration 005: Add new columns to `riders_fuel_history` and migrate existing data (NON-DESTRUCTIVE)
-- This migration will NOT drop existing columns or data. It will:
--  1) Add the new columns if they do not exist
--  2) Copy existing values from the old columns into the new columns where appropriate
-- Run this on the production DB to preserve existing data.

ALTER TABLE `riders_fuel_history`
  ADD COLUMN IF NOT EXISTS `entry_date` DATE NULL,
  ADD COLUMN IF NOT EXISTS `start_meter` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `end_meter` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `distance` DECIMAL(10,2) NULL,
  ADD COLUMN IF NOT EXISTS `petrol_rate` DECIMAL(10,2) NULL,
  ADD COLUMN IF NOT EXISTS `fuel_cost` DECIMAL(10,2) NULL;

-- Copy existing data into new columns where possible. We use COALESCE to avoid overwriting pre-existing values.
UPDATE `riders_fuel_history` SET
  entry_date = COALESCE(entry_date, fuel_date),
  start_meter = COALESCE(start_meter, meter_reading),
  -- We don't know how meter_reading maps to start/end; preserve it in start_meter and leave end_meter NULL for manual correction if needed.
  distance = COALESCE(distance, petrol_qty),
  petrol_rate = COALESCE(petrol_rate, petrol_rate),
  fuel_cost = COALESCE(fuel_cost, cost)
WHERE (fuel_date IS NOT NULL OR meter_reading IS NOT NULL OR petrol_qty IS NOT NULL OR cost IS NOT NULL);

-- Note: This migration preserves the original columns (`fuel_date`, `meter_reading`, `petrol_qty`, `cost`) so you can validate data.
-- After verification, you may later DROP the legacy columns if desired.
