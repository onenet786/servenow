-- Migration: 001_add_riders_fuel_history.sql
-- Creates riders_fuel_history table

CREATE TABLE IF NOT EXISTS `riders_fuel_history` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `rider_id` INT NOT NULL,
  `fuel_date` DATE DEFAULT NULL,
  `meter_reading` VARCHAR(64) DEFAULT NULL,
  `petrol_rate` DECIMAL(10,2) DEFAULT NULL,
  `petrol_qty` DECIMAL(10,3) DEFAULT NULL,
  `cost` DECIMAL(10,2) DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_rfh_rider` (`rider_id`),
  CONSTRAINT `fk_rfh_rider` FOREIGN KEY (`rider_id`) REFERENCES `riders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
