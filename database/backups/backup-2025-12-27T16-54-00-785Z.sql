-- ServeNow database dump
-- Database: servenow
-- Generated: 2025-12-27T16:54:00.785Z

DROP TABLE IF EXISTS `admin_expenses`;
CREATE TABLE `admin_expenses` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `expense_number` varchar(50) NOT NULL,
  `expense_date` date NOT NULL,
  `category` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `payment_method` enum('cash','card','check','bank_transfer') NOT NULL,
  `vendor_name` varchar(100) DEFAULT NULL,
  `receipt_number` varchar(50) DEFAULT NULL,
  `status` enum('pending','approved','paid','rejected') DEFAULT 'pending',
  `submitted_by` int(11) DEFAULT NULL,
  `approved_by` int(11) DEFAULT NULL,
  `approved_at` timestamp NULL DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `expense_number` (`expense_number`),
  KEY `submitted_by` (`submitted_by`),
  KEY `approved_by` (`approved_by`),
  KEY `idx_ae_category` (`category`),
  KEY `idx_ae_expense_date` (`expense_date`),
  KEY `idx_ae_status` (`status`),
  CONSTRAINT `admin_expenses_ibfk_1` FOREIGN KEY (`submitted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `admin_expenses_ibfk_2` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `cash_payment_vouchers`;
CREATE TABLE `cash_payment_vouchers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `voucher_number` varchar(50) NOT NULL,
  `voucher_date` date NOT NULL,
  `payee_name` varchar(100) NOT NULL,
  `payee_type` enum('store','rider','vendor','employee','other') NOT NULL,
  `payee_id` int(11) DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `purpose` varchar(255) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `payment_method` enum('cash','check','bank_transfer') NOT NULL,
  `check_number` varchar(50) DEFAULT NULL,
  `bank_details` text DEFAULT NULL,
  `status` enum('draft','pending','approved','paid','cancelled') DEFAULT 'draft',
  `prepared_by` int(11) DEFAULT NULL,
  `approved_by` int(11) DEFAULT NULL,
  `paid_by` int(11) DEFAULT NULL,
  `approved_at` timestamp NULL DEFAULT NULL,
  `paid_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `voucher_number` (`voucher_number`),
  KEY `payee_id` (`payee_id`),
  KEY `prepared_by` (`prepared_by`),
  KEY `approved_by` (`approved_by`),
  KEY `paid_by` (`paid_by`),
  KEY `idx_cpv_status` (`status`),
  KEY `idx_cpv_payee_type` (`payee_type`),
  KEY `idx_cpv_voucher_date` (`voucher_date`),
  CONSTRAINT `cash_payment_vouchers_ibfk_1` FOREIGN KEY (`payee_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `cash_payment_vouchers_ibfk_2` FOREIGN KEY (`prepared_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `cash_payment_vouchers_ibfk_3` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `cash_payment_vouchers_ibfk_4` FOREIGN KEY (`paid_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `cash_receipt_vouchers`;
CREATE TABLE `cash_receipt_vouchers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `voucher_number` varchar(50) NOT NULL,
  `voucher_date` date NOT NULL,
  `payer_name` varchar(100) NOT NULL,
  `payer_type` enum('customer','store','vendor','other') NOT NULL,
  `payer_id` int(11) DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `details` text DEFAULT NULL,
  `payment_method` enum('cash','check','bank_transfer') NOT NULL,
  `check_number` varchar(50) DEFAULT NULL,
  `bank_details` text DEFAULT NULL,
  `status` enum('draft','pending','received','cancelled') DEFAULT 'draft',
  `prepared_by` int(11) DEFAULT NULL,
  `approved_by` int(11) DEFAULT NULL,
  `received_by` int(11) DEFAULT NULL,
  `approved_at` timestamp NULL DEFAULT NULL,
  `received_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `voucher_number` (`voucher_number`),
  KEY `payer_id` (`payer_id`),
  KEY `prepared_by` (`prepared_by`),
  KEY `approved_by` (`approved_by`),
  KEY `received_by` (`received_by`),
  KEY `idx_crv_status` (`status`),
  KEY `idx_crv_payer_type` (`payer_type`),
  KEY `idx_crv_voucher_date` (`voucher_date`),
  CONSTRAINT `cash_receipt_vouchers_ibfk_1` FOREIGN KEY (`payer_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `cash_receipt_vouchers_ibfk_2` FOREIGN KEY (`prepared_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `cash_receipt_vouchers_ibfk_3` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `cash_receipt_vouchers_ibfk_4` FOREIGN KEY (`received_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `categories`;
CREATE TABLE `categories` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `description` text DEFAULT NULL,
  `image_url` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `categories` (`id`, `name`, `description`, `image_url`, `is_active`, `created_at`) VALUES
(1,'Vegetables','Fresh vegetables and greens',NULL,1,'2025-12-27 21:31:51.000'),
(2,'Cooked Food','Ready-to-eat meals and cooked dishes',NULL,1,'2025-12-27 21:31:51.000'),
(3,'Household','Household items and essentials',NULL,1,'2025-12-27 21:31:51.000'),
(4,'Groceries','General grocery items',NULL,1,'2025-12-27 21:31:51.000');

DROP TABLE IF EXISTS `financial_reports`;
CREATE TABLE `financial_reports` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `report_number` varchar(50) NOT NULL,
  `report_type` enum('daily_summary','weekly_summary','monthly_summary','store_settlement','rider_cash_report','expense_report','custom') NOT NULL,
  `period_from` date DEFAULT NULL,
  `period_to` date DEFAULT NULL,
  `total_income` decimal(12,2) DEFAULT 0.00,
  `total_expense` decimal(12,2) DEFAULT 0.00,
  `total_commissions` decimal(12,2) DEFAULT 0.00,
  `net_profit` decimal(12,2) DEFAULT 0.00,
  `data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`data`)),
  `generated_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `report_number` (`report_number`),
  KEY `generated_by` (`generated_by`),
  KEY `idx_fr_report_type` (`report_type`),
  KEY `idx_fr_period_from` (`period_from`),
  CONSTRAINT `financial_reports_ibfk_1` FOREIGN KEY (`generated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `financial_transactions`;
CREATE TABLE `financial_transactions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `transaction_number` varchar(50) NOT NULL,
  `transaction_type` enum('income','expense','settlement','refund','adjustment') NOT NULL,
  `category` varchar(50) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `payment_method` enum('cash','card','bank_transfer','wallet','check') NOT NULL,
  `related_entity_type` varchar(50) DEFAULT NULL,
  `related_entity_id` int(11) DEFAULT NULL,
  `reference_id` varchar(100) DEFAULT NULL,
  `reference_type` varchar(50) DEFAULT NULL,
  `status` enum('pending','completed','cancelled','reversed') DEFAULT 'completed',
  `notes` text DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `approved_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `transaction_number` (`transaction_number`),
  KEY `created_by` (`created_by`),
  KEY `approved_by` (`approved_by`),
  KEY `idx_ft_transaction_type` (`transaction_type`),
  KEY `idx_ft_created_at` (`created_at`),
  KEY `idx_ft_payment_method` (`payment_method`),
  CONSTRAINT `financial_transactions_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `financial_transactions_ibfk_2` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `login_logs`;
CREATE TABLE `login_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `user_type` varchar(20) NOT NULL,
  `login_time` timestamp NOT NULL DEFAULT current_timestamp(),
  `ip_address` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `orders`;
CREATE TABLE `orders` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `order_number` varchar(20) NOT NULL,
  `user_id` int(11) NOT NULL,
  `store_id` int(11) NOT NULL,
  `rider_id` int(11) DEFAULT NULL,
  `total_amount` decimal(10,2) NOT NULL,
  `delivery_fee` decimal(5,2) DEFAULT 2.99,
  `status` enum('pending','confirmed','preparing','ready','out_for_delivery','delivered','cancelled') DEFAULT 'pending',
  `rider_location` text DEFAULT NULL,
  `estimated_delivery_time` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `payment_method` enum('card','cash','wallet') NOT NULL,
  `payment_status` enum('pending','paid','failed') DEFAULT 'pending',
  `delivery_address` text NOT NULL,
  `delivery_time` varchar(50) DEFAULT NULL,
  `special_instructions` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `order_number` (`order_number`),
  KEY `rider_id` (`rider_id`),
  KEY `idx_orders_user_id` (`user_id`),
  KEY `idx_orders_store_id` (`store_id`),
  CONSTRAINT `orders_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `orders_ibfk_2` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE CASCADE,
  CONSTRAINT `orders_ibfk_3` FOREIGN KEY (`rider_id`) REFERENCES `riders` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `order_items`;
CREATE TABLE `order_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `order_id` int(11) NOT NULL,
  `product_id` int(11) NOT NULL,
  `quantity` int(11) NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `product_id` (`product_id`),
  KEY `idx_order_items_order_id` (`order_id`),
  CONSTRAINT `order_items_ibfk_1` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `order_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `products`;
CREATE TABLE `products` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `cost_price` decimal(10,2) DEFAULT NULL,
  `price` decimal(10,2) NOT NULL,
  `image_url` varchar(255) DEFAULT NULL,
  `image_bg_r` int(11) DEFAULT NULL,
  `image_bg_g` int(11) DEFAULT NULL,
  `image_bg_b` int(11) DEFAULT NULL,
  `image_overlay_alpha` decimal(4,3) DEFAULT NULL,
  `image_contrast` varchar(7) DEFAULT NULL,
  `category_id` int(11) DEFAULT NULL,
  `store_id` int(11) NOT NULL,
  `stock_quantity` int(11) DEFAULT 0,
  `is_available` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_products_store_id` (`store_id`),
  KEY `idx_products_category_id` (`category_id`),
  CONSTRAINT `products_ibfk_1` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL,
  CONSTRAINT `products_ibfk_2` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `products` (`id`, `name`, `description`, `cost_price`, `price`, `image_url`, `image_bg_r`, `image_bg_g`, `image_bg_b`, `image_overlay_alpha`, `image_contrast`, `category_id`, `store_id`, `stock_quantity`, `is_available`, `created_at`, `updated_at`) VALUES
(1,'Organic Tomatoes',NULL,NULL,'3.99',NULL,NULL,NULL,NULL,NULL,NULL,1,1,50,1,'2025-12-27 21:31:51.000','2025-12-27 21:31:51.000'),
(2,'Fresh Spinach',NULL,NULL,'2.49',NULL,NULL,NULL,NULL,NULL,NULL,1,1,30,1,'2025-12-27 21:31:51.000','2025-12-27 21:31:51.000'),
(3,'Carrots',NULL,NULL,'1.99',NULL,NULL,NULL,NULL,NULL,NULL,1,2,40,1,'2025-12-27 21:31:51.000','2025-12-27 21:31:51.000'),
(4,'Chicken Biryani',NULL,NULL,'12.99',NULL,NULL,NULL,NULL,NULL,NULL,2,3,20,1,'2025-12-27 21:31:51.000','2025-12-27 21:31:51.000'),
(5,'Vegetable Pizza',NULL,NULL,'15.99',NULL,NULL,NULL,NULL,NULL,NULL,2,2,15,1,'2025-12-27 21:31:51.000','2025-12-27 21:31:51.000'),
(6,'Grilled Chicken',NULL,NULL,'18.99',NULL,NULL,NULL,NULL,NULL,NULL,2,1,25,1,'2025-12-27 21:31:51.000','2025-12-27 21:31:51.000'),
(7,'Dish Soap',NULL,NULL,'4.99',NULL,NULL,NULL,NULL,NULL,NULL,3,1,35,1,'2025-12-27 21:31:51.000','2025-12-27 21:31:51.000'),
(8,'Laundry Detergent',NULL,NULL,'8.99',NULL,NULL,NULL,NULL,NULL,NULL,3,2,20,1,'2025-12-27 21:31:51.000','2025-12-27 21:31:51.000'),
(9,'Toilet Paper',NULL,NULL,'6.99',NULL,NULL,NULL,NULL,NULL,NULL,3,3,50,1,'2025-12-27 21:31:51.000','2025-12-27 21:31:51.000'),
(10,'Milk',NULL,NULL,'3.49',NULL,NULL,NULL,NULL,NULL,NULL,4,1,30,1,'2025-12-27 21:31:51.000','2025-12-27 21:31:51.000'),
(11,'Bread',NULL,NULL,'2.99',NULL,NULL,NULL,NULL,NULL,NULL,4,2,40,1,'2025-12-27 21:31:51.000','2025-12-27 21:31:51.000'),
(12,'Rice',NULL,NULL,'5.99',NULL,NULL,NULL,NULL,NULL,NULL,4,3,60,1,'2025-12-27 21:31:51.000','2025-12-27 21:31:51.000');

DROP TABLE IF EXISTS `riders`;
CREATE TABLE `riders` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `first_name` varchar(50) NOT NULL,
  `last_name` varchar(50) NOT NULL,
  `email` varchar(100) NOT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `password` varchar(255) NOT NULL,
  `vehicle_type` varchar(50) DEFAULT NULL,
  `license_number` varchar(50) DEFAULT NULL,
  `is_available` tinyint(1) DEFAULT 1,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `riders` (`id`, `first_name`, `last_name`, `email`, `phone`, `password`, `vehicle_type`, `license_number`, `is_available`, `is_active`, `created_at`, `updated_at`) VALUES
(1,'Ahmed','Khan','ahmed.rider@servenow.com','+1234567894','rider123','Motorcycle','LIC123456',1,1,'2025-12-27 21:31:51.000','2025-12-27 21:31:51.000'),
(2,'Fatima','Ali','fatima.rider@servenow.com','+1234567895','rider456','Bicycle','LIC123457',1,1,'2025-12-27 21:31:51.000','2025-12-27 21:31:51.000'),
(3,'Omar','Hassan','omar.rider@servenow.com','+1234567896','rider789','Scooter','LIC123458',1,1,'2025-12-27 21:31:51.000','2025-12-27 21:31:51.000');

DROP TABLE IF EXISTS `riders_fuel_history`;
CREATE TABLE `riders_fuel_history` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `rider_id` int(11) NOT NULL,
  `entry_date` date DEFAULT NULL,
  `start_meter` varchar(64) DEFAULT NULL,
  `end_meter` varchar(64) DEFAULT NULL,
  `distance` decimal(10,2) DEFAULT NULL,
  `petrol_rate` decimal(10,2) DEFAULT NULL,
  `fuel_cost` decimal(10,2) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_rfh_rider` (`rider_id`),
  CONSTRAINT `fk_rfh_rider` FOREIGN KEY (`rider_id`) REFERENCES `riders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `rider_cash_movements`;
CREATE TABLE `rider_cash_movements` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `movement_number` varchar(50) NOT NULL,
  `rider_id` int(11) NOT NULL,
  `movement_date` date NOT NULL,
  `movement_type` enum('cash_collection','cash_submission','advance','settlement','adjustment') NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `description` text DEFAULT NULL,
  `reference_type` varchar(50) DEFAULT NULL,
  `reference_id` int(11) DEFAULT NULL,
  `status` enum('pending','completed','approved','cancelled') DEFAULT 'pending',
  `recorded_by` int(11) DEFAULT NULL,
  `approved_by` int(11) DEFAULT NULL,
  `approved_at` timestamp NULL DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `movement_number` (`movement_number`),
  KEY `recorded_by` (`recorded_by`),
  KEY `approved_by` (`approved_by`),
  KEY `idx_rcm_rider_id` (`rider_id`),
  KEY `idx_rcm_movement_type` (`movement_type`),
  KEY `idx_rcm_movement_date` (`movement_date`),
  CONSTRAINT `rider_cash_movements_ibfk_1` FOREIGN KEY (`rider_id`) REFERENCES `riders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `rider_cash_movements_ibfk_2` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `rider_cash_movements_ibfk_3` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `saved_payment_methods`;
CREATE TABLE `saved_payment_methods` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `type` enum('card','paypal') NOT NULL,
  `gateway_id` varchar(255) NOT NULL,
  `card_last_four` varchar(4) DEFAULT NULL,
  `card_brand` varchar(20) DEFAULT NULL,
  `card_expiry_month` int(11) DEFAULT NULL,
  `card_expiry_year` int(11) DEFAULT NULL,
  `is_primary` tinyint(1) DEFAULT 0,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_spm_user_id` (`user_id`),
  CONSTRAINT `saved_payment_methods_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `sizes`;
CREATE TABLE `sizes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `label` varchar(50) NOT NULL,
  `description` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=79 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `sizes` (`id`, `label`, `description`, `created_at`) VALUES
(15,'Small Size','S','2025-12-15 00:38:52.000'),
(19,'Medium Size','M','2025-12-15 10:32:41.000'),
(20,'Large Size','L','2025-12-15 10:32:41.000'),
(21,'Extra Large','XL','2025-12-15 10:33:53.000'),
(22,'Extra Large','XL','2025-12-15 10:33:53.000'),
(23,'1Piece','1Piece ','2025-12-15 23:59:44.000'),
(24,'1Piece',NULL,'2025-12-15 23:59:44.000'),
(25,'2Piece',NULL,'2025-12-16 00:00:02.000'),
(26,'2Piece',NULL,'2025-12-16 00:00:02.000'),
(27,'3Piece',NULL,'2025-12-16 00:00:11.000'),
(28,'3Piece',NULL,'2025-12-16 00:00:11.000'),
(29,'4Piece',NULL,'2025-12-16 00:04:06.000'),
(30,'4Piece',NULL,'2025-12-16 00:04:06.000'),
(31,'1Box',NULL,'2025-12-16 00:47:46.000'),
(32,'1Box',NULL,'2025-12-16 00:47:46.000'),
(33,'Half Ltr',NULL,'2025-12-18 00:43:29.000'),
(34,'Half Ltr',NULL,'2025-12-18 00:43:29.000'),
(35,'1 Litter',NULL,'2025-12-18 00:43:53.000'),
(36,'1 Litter',NULL,'2025-12-18 00:43:54.000'),
(37,'1 Seekh',NULL,'2025-12-18 01:02:25.000'),
(38,'1 Seekh',NULL,'2025-12-18 01:02:25.000'),
(39,'500grm',NULL,'2025-12-18 01:07:16.000'),
(40,'500grm',NULL,'2025-12-18 01:07:17.000'),
(41,'Small Plate',NULL,'2025-12-20 10:20:57.000'),
(42,'Small Plate',NULL,'2025-12-20 10:20:57.000'),
(43,'Medium Plate',NULL,'2025-12-20 10:21:08.000'),
(44,'Medium Plate',NULL,'2025-12-20 10:21:08.000'),
(45,'Large Plate',NULL,'2025-12-20 10:21:18.000'),
(46,'Large Plate',NULL,'2025-12-20 10:21:18.000'),
(47,'Small Plate',NULL,'2025-12-24 11:55:59.000'),
(48,'Small Plate',NULL,'2025-12-24 11:55:59.000'),
(49,'Large Plate',NULL,'2025-12-24 11:56:09.000'),
(50,'Large Plate',NULL,'2025-12-24 11:56:09.000'),
(51,'Medium Plate',NULL,'2025-12-24 11:56:19.000'),
(52,'Medium Plate',NULL,'2025-12-24 11:56:19.000'),
(53,'Extra Large Plate',NULL,'2025-12-24 11:57:14.000'),
(54,'Extra Large Plate',NULL,'2025-12-24 11:57:14.000'),
(55,'5 Piece',NULL,'2025-12-24 20:46:21.000'),
(56,'5 Piece',NULL,'2025-12-24 20:46:21.000'),
(57,'6 Piece',NULL,'2025-12-24 20:46:29.000'),
(58,'6 Piece',NULL,'2025-12-24 20:46:29.000'),
(59,'8 Seekh',NULL,'2025-12-24 20:53:03.000'),
(60,'8 Seekh',NULL,'2025-12-24 20:53:03.000'),
(61,'1 service',NULL,'2025-12-25 11:19:19.000'),
(62,'1 service',NULL,'2025-12-25 11:19:19.000'),
(63,'12 Pieces',NULL,'2025-12-25 11:43:42.000'),
(64,'12 Pieces',NULL,'2025-12-25 11:43:42.000'),
(65,'Small','S','2025-12-25 12:12:47.000'),
(66,'Small','S','2025-12-25 12:12:47.000'),
(67,'Large','L','2025-12-25 12:12:56.000'),
(68,'Large','L','2025-12-25 12:12:56.000'),
(69,'6 Seekh','S','2025-12-25 15:59:29.000'),
(70,'6 Seekh','S','2025-12-25 15:59:29.000'),
(71,'Shachet','S','2025-12-26 09:37:36.000'),
(72,'Shachet','S','2025-12-26 09:37:36.000'),
(73,'Jar','J','2025-12-26 09:37:46.000'),
(74,'Jar','J','2025-12-26 09:37:46.000'),
(75,'2 Seekh',NULL,'2025-12-26 16:12:54.000'),
(76,'2 Seekh',NULL,'2025-12-26 16:12:55.000'),
(77,'4 Seekh',NULL,'2025-12-26 16:13:07.000'),
(78,'4 Seekh',NULL,'2025-12-26 16:13:07.000');

DROP TABLE IF EXISTS `stores`;
CREATE TABLE `stores` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `location` varchar(100) DEFAULT NULL,
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `rating` decimal(3,2) DEFAULT 0.00,
  `delivery_time` varchar(50) DEFAULT NULL,
  `opening_time` time DEFAULT NULL,
  `closing_time` time DEFAULT NULL,
  `payment_term` enum('Cash Only','Cash with Discount','Credit','Credit with Discount') DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `owner_id` int(11) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `owner_id` (`owner_id`),
  CONSTRAINT `stores_ibfk_1` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `stores` (`id`, `name`, `description`, `location`, `latitude`, `longitude`, `rating`, `delivery_time`, `opening_time`, `closing_time`, `payment_term`, `phone`, `email`, `address`, `owner_id`, `is_active`, `created_at`, `updated_at`) VALUES
(1,'Fresh Market',NULL,'Downtown','40.71280000','-74.00600000','4.50','30-45 mins',NULL,NULL,NULL,'+1234567891','fresh@market.com',NULL,1,1,'2025-12-27 21:31:51.000','2025-12-27 21:31:51.000'),
(2,'Green Grocery',NULL,'Midtown','40.75890000','-73.98510000','4.20','25-40 mins',NULL,NULL,NULL,'+1234567892','green@grocery.com',NULL,1,1,'2025-12-27 21:31:51.000','2025-12-27 21:31:51.000'),
(3,'Local Foods',NULL,'Brooklyn','40.67820000','-73.94420000','4.70','35-50 mins',NULL,NULL,NULL,'+1234567893','local@foods.com',NULL,1,1,'2025-12-27 21:31:51.000','2025-12-27 21:31:51.000');

DROP TABLE IF EXISTS `store_settlements`;
CREATE TABLE `store_settlements` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `settlement_number` varchar(50) NOT NULL,
  `settlement_date` date NOT NULL,
  `store_id` int(11) NOT NULL,
  `period_from` date DEFAULT NULL,
  `period_to` date DEFAULT NULL,
  `total_orders_amount` decimal(12,2) DEFAULT 0.00,
  `commissions` decimal(12,2) DEFAULT 0.00,
  `deductions` decimal(12,2) DEFAULT 0.00,
  `net_amount` decimal(12,2) NOT NULL,
  `payment_method` enum('cash','check','bank_transfer') NOT NULL,
  `status` enum('pending','approved','paid','cancelled') DEFAULT 'pending',
  `approved_by` int(11) DEFAULT NULL,
  `paid_by` int(11) DEFAULT NULL,
  `approved_at` timestamp NULL DEFAULT NULL,
  `paid_at` timestamp NULL DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `settlement_number` (`settlement_number`),
  KEY `approved_by` (`approved_by`),
  KEY `paid_by` (`paid_by`),
  KEY `idx_ss_store_id` (`store_id`),
  KEY `idx_ss_settlement_date` (`settlement_date`),
  KEY `idx_ss_status` (`status`),
  CONSTRAINT `store_settlements_ibfk_1` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE CASCADE,
  CONSTRAINT `store_settlements_ibfk_2` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `store_settlements_ibfk_3` FOREIGN KEY (`paid_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `units`;
CREATE TABLE `units` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `abbreviation` varchar(10) DEFAULT NULL,
  `multiplier` decimal(10,4) DEFAULT 1.0000,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=58 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `units` (`id`, `name`, `abbreviation`, `multiplier`, `created_at`) VALUES
(1,'Kilogram','kg','1.0000','2025-12-10 17:00:58.000'),
(30,'Dozen','DZ','1.0000','2025-12-15 10:30:40.000'),
(31,'Blister pack','BL','1.0000','2025-12-15 10:31:39.000'),
(32,'Liter','Ltr','1.0000','2025-12-15 12:18:28.000'),
(33,'250 Grams','Pao','1.0000','2025-12-16 16:47:20.000'),
(34,'Half Kilogram','HK','1.0000','2025-12-16 16:48:00.000'),
(35,'750 Grams','QK','1.0000','2025-12-16 16:48:36.000'),
(36,'500 Grams','HKg','1.0000','2025-12-18 01:15:15.000'),
(38,'1 Dozen',NULL,'1.0000','2025-12-23 11:46:22.000'),
(39,'Half Dozen','HD','1.0000','2025-12-23 12:03:19.000'),
(40,'Half Plate','HP','1.0000','2025-12-23 12:29:09.000'),
(41,'Full Plate','FP','1.0000','2025-12-23 12:29:39.000'),
(42,'1 Pound','1 lb','1.0000','2025-12-23 17:49:49.000'),
(43,'2 Pound','2 lbs','1.0000','2025-12-23 17:50:12.000'),
(44,'Half Litter','HL','1.0000','2025-12-24 13:16:48.000'),
(45,'1.5 Litter','L','1.0000','2025-12-24 13:17:25.000'),
(46,'2 Litter','L','1.0000','2025-12-24 13:17:44.000'),
(47,'2.5 Litter','L','1.0000','2025-12-24 13:18:05.000'),
(48,'350ml','ML','1.0000','2025-12-24 13:18:56.000'),
(49,'5 Litter','L','1.0000','2025-12-24 13:41:06.000'),
(50,'Tean Pack','TP','1.0000','2025-12-24 13:47:20.000'),
(51,'1 Cup','C','1.0000','2025-12-24 16:54:47.000'),
(54,'Full','F','1.0000','2025-12-24 20:19:45.000'),
(55,'Half','H','1.0000','2025-12-24 20:20:00.000'),
(56,'8 Seekh',NULL,'1.0000','2025-12-24 20:52:10.000'),
(57,'Parcel','P','1.0000','2025-12-25 11:53:30.000');

DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `first_name` varchar(50) NOT NULL,
  `last_name` varchar(50) NOT NULL,
  `email` varchar(100) NOT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `password` varchar(255) NOT NULL,
  `address` text DEFAULT NULL,
  `user_type` enum('customer','store_owner','admin') DEFAULT 'customer',
  `verification_code` varchar(6) DEFAULT NULL,
  `verification_expires_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `is_verified` tinyint(1) DEFAULT 0,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `users` (`id`, `first_name`, `last_name`, `email`, `phone`, `password`, `address`, `user_type`, `verification_code`, `verification_expires_at`, `is_verified`, `is_active`, `created_at`, `updated_at`) VALUES
(1,'Admin','User','admin@servenow.com','+1234567890','$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',NULL,'admin',NULL,'2025-12-27 21:31:51.000',0,1,'2025-12-27 21:31:51.000','2025-12-27 21:31:51.000');

DROP TABLE IF EXISTS `wallets`;
CREATE TABLE `wallets` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `balance` decimal(10,2) DEFAULT 0.00,
  `total_credited` decimal(10,2) DEFAULT 0.00,
  `total_spent` decimal(10,2) DEFAULT 0.00,
  `auto_recharge_enabled` tinyint(1) DEFAULT 0,
  `auto_recharge_amount` decimal(10,2) DEFAULT 0.00,
  `auto_recharge_threshold` decimal(10,2) DEFAULT 0.00,
  `last_credited_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`),
  KEY `idx_wallets_user_id` (`user_id`),
  CONSTRAINT `wallets_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `wallet_transactions`;
CREATE TABLE `wallet_transactions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `wallet_id` int(11) NOT NULL,
  `type` enum('credit','debit','refund','transfer') NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `reference_type` varchar(50) DEFAULT NULL,
  `reference_id` varchar(255) DEFAULT NULL,
  `balance_after` decimal(10,2) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_wt_wallet_id` (`wallet_id`),
  KEY `idx_wt_type` (`type`),
  KEY `idx_wt_created_at` (`created_at`),
  CONSTRAINT `wallet_transactions_ibfk_1` FOREIGN KEY (`wallet_id`) REFERENCES `wallets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `wallet_transfers`;
CREATE TABLE `wallet_transfers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `sender_id` int(11) NOT NULL,
  `recipient_id` int(11) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `description` text DEFAULT NULL,
  `sender_wallet_id` int(11) NOT NULL,
  `recipient_wallet_id` int(11) NOT NULL,
  `status` enum('pending','completed','rejected','cancelled') DEFAULT 'pending',
  `rejection_reason` text DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `sender_id` (`sender_id`),
  KEY `recipient_id` (`recipient_id`),
  KEY `sender_wallet_id` (`sender_wallet_id`),
  KEY `recipient_wallet_id` (`recipient_wallet_id`),
  CONSTRAINT `wallet_transfers_ibfk_1` FOREIGN KEY (`sender_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `wallet_transfers_ibfk_2` FOREIGN KEY (`recipient_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `wallet_transfers_ibfk_3` FOREIGN KEY (`sender_wallet_id`) REFERENCES `wallets` (`id`),
  CONSTRAINT `wallet_transfers_ibfk_4` FOREIGN KEY (`recipient_wallet_id`) REFERENCES `wallets` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

