-- Migration 007: Add category_id to stores and FK to categories
-- Safe to run multiple times: errors for duplicate column/FK can be ignored by the runner.

USE servenow;

ALTER TABLE `stores`
  ADD COLUMN `category_id` INT NULL AFTER `cover_image`;

ALTER TABLE `stores`
  ADD INDEX `idx_stores_category_id` (`category_id`);

ALTER TABLE `stores`
  ADD CONSTRAINT `fk_stores_category`
  FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

