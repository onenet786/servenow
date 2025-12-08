-- Migration 003: Drop and recreate `riders_fuel_history` with updated columns
-- WARNING: This will DROP the existing table and all its data. Backup before running.

DROP TABLE IF EXISTS `riders_fuel_history`;

CREATE TABLE `riders_fuel_history` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `rider_id` INT NOT NULL,
  `entry_date` DATE DEFAULT NULL,
  `start_meter` VARCHAR(64) DEFAULT NULL,
  `end_meter` VARCHAR(64) DEFAULT NULL,
  `distance` DECIMAL(10,2) DEFAULT NULL,
  `petrol_rate` DECIMAL(10,2) DEFAULT NULL,
  `fuel_cost` DECIMAL(10,2) DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_rfh_rider` (`rider_id`),
  CONSTRAINT `fk_rfh_rider` FOREIGN KEY (`rider_id`) REFERENCES `riders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
