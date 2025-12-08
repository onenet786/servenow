-- Migration 006: Add common store feature columns to `stores` (NON-DESTRUCTIVE)
-- Adds columns for minimum order, delivery fee, cover image, delivery zones, flags, and tags.
-- This migration is safe: it uses ADD COLUMN IF NOT EXISTS (MySQL 8+). If running on older MySQL, remove IF NOT EXISTS or run checks.

ALTER TABLE `stores`
  ADD COLUMN IF NOT EXISTS `min_order_value` DECIMAL(10,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `base_delivery_fee` DECIMAL(10,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `cover_image` VARCHAR(255) DEFAULT NULL,
  -- If your MySQL supports JSON (5.7+), use JSON. Otherwise, change to TEXT.
  ADD COLUMN IF NOT EXISTS `delivery_zones` JSON DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `supports_pickup` BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS `supports_preorder` BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS `is_open` BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `holiday_mode` BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS `tags` VARCHAR(255) DEFAULT NULL;

-- Optional: populate new fields with sensible defaults for existing stores
-- Example: set base_delivery_fee to 0 where NULL
UPDATE `stores` SET base_delivery_fee = 0.00 WHERE base_delivery_fee IS NULL;
