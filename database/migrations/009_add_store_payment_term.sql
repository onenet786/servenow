-- Migration 009: Add payment_term to stores (NON-DESTRUCTIVE)
-- Adds an ENUM column to capture store payment terms.
-- Values: 'Cash Only', 'Cash with Discount', 'Credit', 'Credit with Discount'
-- Uses IF NOT EXISTS where supported; the migration runner normalizes for older MySQL/MariaDB.

ALTER TABLE `stores`
  ADD COLUMN IF NOT EXISTS `payment_term` ENUM(
    'Cash Only',
    'Cash with Discount',
    'Credit',
    'Credit with Discount'
  ) DEFAULT NULL;

