-- Migration 005: Add extra fields to riders (father_name, image_url, id_card_url)
-- Safe for MySQL 8+ using IF NOT EXISTS. For older versions, run conditional checks manually.
USE servenow;

ALTER TABLE `riders`
  ADD COLUMN IF NOT EXISTS `father_name` VARCHAR(100) NULL;

ALTER TABLE `riders`
  ADD COLUMN IF NOT EXISTS `image_url` VARCHAR(255) NULL;

ALTER TABLE `riders`
  ADD COLUMN IF NOT EXISTS `id_card_url` VARCHAR(255) NULL;
ALTER TABLE `riders`
  ADD COLUMN IF NOT EXISTS `id_card_num` VARCHAR(100) NULL;

