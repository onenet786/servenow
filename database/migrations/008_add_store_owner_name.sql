-- Migration 008: Add owner_name to stores (text owner field)
-- Safe, non-destructive: uses IF NOT EXISTS where supported (MySQL 8+).

ALTER TABLE `stores`
  ADD COLUMN IF NOT EXISTS `owner_name` VARCHAR(255) DEFAULT NULL;

