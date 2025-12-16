-- ServeNow database dump
-- Database: servenow
-- Generated: 2025-12-15T21:11:19.204Z

DROP TABLE IF EXISTS `categories`;
CREATE TABLE `categories` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `description` text DEFAULT NULL,
  `image_url` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=62 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `categories` (`id`, `name`, `description`, `image_url`, `is_active`, `created_at`) VALUES
(1,'Vegetables','Fresh vegetables and greens','/images/vegetables.jpg',1,'2025-11-30 20:48:32.000'),
(60,'Pharmacy','100 % Quality Products','/uploads/category_1765775517922_138.jfif',1,'2025-12-15 10:11:58.000'),
(61,'Karahi Goshat','Good Taste','/uploads/category_1765805099295_119.jfif',1,'2025-12-15 18:24:59.000');

DROP TABLE IF EXISTS `items`;
CREATE TABLE `items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `image_url` varchar(255) DEFAULT NULL,
  `category_id` int(11) DEFAULT NULL,
  `unit_id` int(11) DEFAULT NULL,
  `size_id` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_items` (`name`,`category_id`,`unit_id`,`size_id`)
) ENGINE=InnoDB AUTO_INCREMENT=32 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `items` (`id`, `name`, `description`, `image_url`, `category_id`, `unit_id`, `size_id`, `created_at`) VALUES
(1,'Apple','Good Quality Apple by Fresh Market','/uploads/upload_1765448225011_433.jfif',4,1,NULL,'2025-12-14 13:44:02.000');

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
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

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
) ENGINE=InnoDB AUTO_INCREMENT=23 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DROP TABLE IF EXISTS `products`;
CREATE TABLE `products` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `price` decimal(10,2) NOT NULL,
  `image_url` varchar(255) DEFAULT NULL,
  `category_id` int(11) DEFAULT NULL,
  `store_id` int(11) NOT NULL,
  `stock_quantity` int(11) DEFAULT 0,
  `is_available` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `image_bg_r` int(11) DEFAULT NULL,
  `image_bg_g` int(11) DEFAULT NULL,
  `image_bg_b` int(11) DEFAULT NULL,
  `image_overlay_alpha` decimal(4,3) DEFAULT NULL,
  `image_contrast` varchar(7) DEFAULT NULL,
  `unit_id` int(11) DEFAULT NULL,
  `size_id` int(11) DEFAULT NULL,
  `item_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_products_store_id` (`store_id`),
  KEY `idx_products_category_id` (`category_id`),
  KEY `fk_products_unit` (`unit_id`),
  KEY `fk_products_size` (`size_id`),
  CONSTRAINT `fk_products_size` FOREIGN KEY (`size_id`) REFERENCES `sizes` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_products_unit` FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE SET NULL,
  CONSTRAINT `products_ibfk_1` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL,
  CONSTRAINT `products_ibfk_2` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=76 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `products` (`id`, `name`, `description`, `price`, `image_url`, `category_id`, `store_id`, `stock_quantity`, `is_available`, `created_at`, `updated_at`, `image_bg_r`, `image_bg_g`, `image_bg_b`, `image_overlay_alpha`, `image_contrast`, `unit_id`, `size_id`, `item_id`) VALUES
(55,'Chicken Karahi','dfds','1600.00','/uploads/upload_1765741997545_194.jpg',61,23,1,1,'2025-12-15 00:53:17.000','2025-12-15 18:28:33.000',NULL,NULL,NULL,NULL,NULL,1,NULL,NULL),
(56,'panadol','110%','70.00','/uploads/upload_1765777195506_369.jfif',60,27,200,1,'2025-12-15 10:39:55.000','2025-12-15 10:39:55.000',NULL,NULL,NULL,NULL,NULL,31,15,NULL),
(57,'Chicken Karahi','dfds','1600.00','/uploads/upload_1765807141449_913.jpg',61,27,10,1,'2025-12-15 18:59:01.000','2025-12-15 18:59:01.000',NULL,NULL,NULL,NULL,NULL,1,NULL,NULL),
(58,'Chicken Karahi','','450.00','/uploads/upload_1765823619794_770.jpg',NULL,30,1,1,'2025-12-15 23:33:40.000','2025-12-15 23:33:40.000',NULL,NULL,NULL,NULL,NULL,1,NULL,NULL),
(59,'Sada Shami Burger','','140.00','/uploads/upload_1765825894066_520.jpg',NULL,31,1,1,'2025-12-16 00:11:34.000','2025-12-16 00:11:34.000',NULL,NULL,NULL,NULL,NULL,NULL,24,NULL),
(60,'Anda Shami Burger','','150.00','/uploads/upload_1765826025751_82.jpg',NULL,31,1,1,'2025-12-16 00:13:46.000','2025-12-16 00:13:46.000',NULL,NULL,NULL,NULL,NULL,NULL,24,NULL),
(61,'Chicken Anda Shami Burger','','210.00','/uploads/upload_1765826164853_85.jpg',NULL,31,0,1,'2025-12-16 00:16:05.000','2025-12-16 00:16:05.000',NULL,NULL,NULL,NULL,NULL,NULL,24,NULL),
(62,'Chicken Tower Burger','','240.00','/uploads/upload_1765826421013_108.jpg',NULL,31,0,1,'2025-12-16 00:20:21.000','2025-12-16 00:20:21.000',NULL,NULL,NULL,NULL,NULL,NULL,24,NULL),
(63,'King Special shawarma','','140.00','/uploads/upload_1765826556470_493.jpg',NULL,31,1,1,'2025-12-16 00:22:36.000','2025-12-16 00:22:36.000',NULL,NULL,NULL,NULL,NULL,NULL,19,NULL),
(64,'zinger Burger','','310.00','/uploads/upload_1765826722235_468.webp',NULL,31,1,1,'2025-12-16 00:25:22.000','2025-12-16 00:25:22.000',NULL,NULL,NULL,NULL,NULL,NULL,23,NULL),
(65,'Zinger Shawarma','','260.00','/uploads/upload_1765826855025_265.jpg',NULL,31,1,1,'2025-12-16 00:27:35.000','2025-12-16 00:27:35.000',NULL,NULL,NULL,NULL,NULL,NULL,24,NULL),
(66,'Crispy Thai Piece','','200.00','/uploads/upload_1765827113102_289.jpg',NULL,31,1,1,'2025-12-16 00:31:53.000','2025-12-16 00:31:53.000',NULL,NULL,NULL,NULL,NULL,NULL,24,NULL),
(67,'Alo Wala Samosa','','40.00','/uploads/upload_1765827517709_493.jpg',NULL,33,1,1,'2025-12-16 00:38:38.000','2025-12-16 00:38:38.000',NULL,NULL,NULL,NULL,NULL,NULL,23,NULL),
(68,'Qeema Wala Samosa','','40.00','/uploads/upload_1765827651859_937.jpg',NULL,33,1,1,'2025-12-16 00:40:52.000','2025-12-16 00:40:52.000',NULL,NULL,NULL,NULL,NULL,NULL,23,NULL),
(69,'Roll Fry','','70.00','/uploads/upload_1765827762209_127.jpg',NULL,33,1,1,'2025-12-16 00:42:42.000','2025-12-16 00:42:42.000',NULL,NULL,NULL,NULL,NULL,NULL,23,NULL),
(70,'Chicken Shami','','40.00','/uploads/upload_1765827856112_796.jpg',NULL,33,0,1,'2025-12-16 00:44:16.000','2025-12-16 00:44:16.000',NULL,NULL,NULL,NULL,NULL,NULL,23,NULL),
(71,'Sandwich','','70.00','/uploads/upload_1765827976903_299.jpg',NULL,33,1,1,'2025-12-16 00:46:17.000','2025-12-16 00:46:17.000',NULL,NULL,NULL,NULL,NULL,NULL,24,NULL),
(72,'Chicken Biryani','','210.00','/uploads/upload_1765828178489_570.jpg',NULL,32,1,1,'2025-12-16 00:49:38.000','2025-12-16 00:49:38.000',NULL,NULL,NULL,NULL,NULL,NULL,31,NULL),
(73,'Simple Biryani','','130.00','/uploads/upload_1765828283336_476.jpg',NULL,32,1,1,'2025-12-16 00:51:23.000','2025-12-16 00:51:23.000',NULL,NULL,NULL,NULL,NULL,NULL,31,NULL),
(74,'Beef Pulao','','210.00','/uploads/upload_1765828363904_532.jpg',NULL,32,1,1,'2025-12-16 00:52:44.000','2025-12-16 00:52:44.000',NULL,NULL,NULL,NULL,NULL,NULL,31,NULL),
(75,'Simple Pulao','','130.00','/uploads/upload_1765828506409_0.jpg',NULL,32,1,1,'2025-12-16 00:55:06.000','2025-12-16 00:55:06.000',NULL,NULL,NULL,NULL,NULL,NULL,31,NULL);

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
  `father_name` varchar(100) DEFAULT NULL,
  `image_url` varchar(255) DEFAULT NULL,
  `id_card_url` varchar(255) DEFAULT NULL,
  `id_card_num` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `riders` (`id`, `first_name`, `last_name`, `email`, `phone`, `password`, `vehicle_type`, `license_number`, `is_available`, `is_active`, `created_at`, `updated_at`, `father_name`, `image_url`, `id_card_url`, `id_card_num`) VALUES
(1,'Ahmed','Khan','ahmed.rider@servenow.pk','+1234567894','rider123','Motorcycle','LIC123456',1,1,'2025-11-30 20:48:32.000','2025-12-15 01:08:10.000','','/uploads/upload_1765742890081_67.png','/uploads/upload_1765742890101_933.jpeg','35202-5955742-3'),
(20,'Aqeel Ur Rehman','','aaqueel@gmail.com','+920321442462','$2a$10$AwVL5uX5/nV2gFlbONhdMOSQSVA0FRlYSUamY0.hS0P9a1dSfNqfG','Motorcycle','LIC2025',1,1,'2025-12-15 01:12:33.000','2025-12-15 01:12:33.000','Ch. Allah Bukhash','/uploads/upload_1765743153706_737.jpeg','/uploads/upload_1765743153716_733.jpeg','35201-9055966-6');

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
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `riders_fuel_history` (`id`, `rider_id`, `entry_date`, `start_meter`, `end_meter`, `distance`, `petrol_rate`, `fuel_cost`, `notes`, `created_at`, `updated_at`) VALUES
(1,1,'2025-12-15 00:00:00.000','525','565','40.00','7.50','300.00','Delivery To Customer at Kot Addu Power Station','2025-12-15 02:30:27.000',NULL);

DROP TABLE IF EXISTS `sizes`;
CREATE TABLE `sizes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `label` varchar(50) NOT NULL,
  `description` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=33 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `sizes` (`id`, `label`, `description`, `created_at`) VALUES
(15,'Small Size','S','2025-12-15 00:38:52.000'),
(19,'Medium Size','M','2025-12-15 10:32:41.000'),
(20,'Large Size','L','2025-12-15 10:32:41.000'),
(21,'Extra Large','XL','2025-12-15 10:33:53.000'),
(22,'Extra Large','XL','2025-12-15 10:33:53.000'),
(23,'1Piece',NULL,'2025-12-15 23:59:44.000'),
(24,'1Piece',NULL,'2025-12-15 23:59:44.000'),
(25,'2Piece',NULL,'2025-12-16 00:00:02.000'),
(26,'2Piece',NULL,'2025-12-16 00:00:02.000'),
(27,'3Piece',NULL,'2025-12-16 00:00:11.000'),
(28,'3Piece',NULL,'2025-12-16 00:00:11.000'),
(29,'4Piece',NULL,'2025-12-16 00:04:06.000'),
(30,'4Piece',NULL,'2025-12-16 00:04:06.000'),
(31,'1Box',NULL,'2025-12-16 00:47:46.000'),
(32,'1Box',NULL,'2025-12-16 00:47:46.000');

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
  `phone` varchar(20) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `owner_id` int(11) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `opening_time` time DEFAULT NULL,
  `closing_time` time DEFAULT NULL,
  `min_order_value` decimal(10,2) DEFAULT NULL,
  `base_delivery_fee` decimal(10,2) DEFAULT NULL,
  `cover_image` varchar(255) DEFAULT NULL,
  `category_id` int(11) DEFAULT NULL,
  `delivery_zones` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`delivery_zones`)),
  `supports_pickup` tinyint(1) DEFAULT 1,
  `supports_preorder` tinyint(1) DEFAULT 0,
  `is_open` tinyint(1) DEFAULT NULL,
  `holiday_mode` tinyint(1) DEFAULT 0,
  `tags` varchar(255) DEFAULT NULL,
  `owner_name` varchar(255) DEFAULT NULL,
  `payment_term` enum('Cash Only','Cash with Discount','Credit','Credit with Discount') DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `owner_id` (`owner_id`),
  KEY `idx_stores_category_id` (`category_id`),
  CONSTRAINT `fk_stores_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `stores_ibfk_1` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=34 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `stores` (`id`, `name`, `description`, `location`, `latitude`, `longitude`, `rating`, `delivery_time`, `phone`, `email`, `address`, `owner_id`, `is_active`, `created_at`, `updated_at`, `opening_time`, `closing_time`, `min_order_value`, `base_delivery_fee`, `cover_image`, `category_id`, `delivery_zones`, `supports_pickup`, `supports_preorder`, `is_open`, `holiday_mode`, `tags`, `owner_name`, `payment_term`) VALUES
(23,'Aghosh Hotel','Ready made food','Kalii Pull Kot Addu',NULL,NULL,'0.00','35 Minute ','+923175592503','ShahG@servenow.pk','kali pull canal colony',11,1,'2025-12-15 00:46:48.000','2025-12-15 20:10:55.000','12:00:00','23:00:00',NULL,'0.00','/uploads/store_upload_1765741607644_791.jpg',NULL,NULL,1,0,NULL,0,NULL,'Khurram Shah',NULL),
(27,'Al Sheikh Pharmacy','100% ','Thana Chowk',NULL,NULL,'0.00','35-45','+923001234567','ghjjhhj@gmail.com','Thana Chowk G T Road Kotaddu',11,1,'2025-12-15 10:09:07.000','2025-12-15 17:35:31.000','08:00:00','12:00:00',NULL,NULL,'/uploads/store_upload_1765782923998_508.jfif',60,NULL,1,0,NULL,0,NULL,'Sheikh Furqan',NULL),
(28,'Pakeeza Hotel','','Kali pull Kot Addu',NULL,NULL,'0.00','35 to 40 minute','+923330713898','Pakeeza@servenow.pk','Kali pull Kot Addu ',11,1,'2025-12-15 18:26:48.000','2025-12-15 23:50:55.000','11:00:00','12:00:00',NULL,NULL,'/uploads/store_upload_1765824654762_64.jpg',61,NULL,1,0,NULL,0,NULL,'Akram Bhai','Credit with Discount'),
(29,'ZamZam Ice Cream Parlour','','Stadium Colony Kot Addu',NULL,NULL,'0.00','30 minute','+923336055050','mshahid@servenow.pk','Noor Shah Road Near Stadium KotAddu',11,1,'2025-12-15 21:43:54.000','2025-12-15 23:30:58.000','11:00:00','23:00:00',NULL,NULL,'/uploads/store_upload_1765823458043_757.png',NULL,NULL,1,0,NULL,0,NULL,NULL,NULL),
(30,'Shah G Hotel','','Noor Shah ChwokKot Addu',NULL,NULL,'0.00','35 minute','+923175592503','ShahgHotel@servenow.pk','Noor Shah Chowk Kot Addu Near By Stadium',11,1,'2025-12-15 21:47:23.000','2025-12-15 23:28:16.000','16:00:00','23:30:00',NULL,NULL,'/uploads/store_upload_1765823296556_344.png',NULL,NULL,1,0,NULL,0,NULL,NULL,NULL),
(31,'King Burger',NULL,'Thana Chowk KotAddu',NULL,NULL,'0.00','35 Minute ','+923428012699','king@servrnow.pk','Tana Chowk Near by Faislabad bakery',11,1,'2025-12-15 23:43:39.000','2025-12-15 23:43:39.000','16:00:00','23:00:00',NULL,NULL,'/uploads/store_upload_1765824218715_926.avif',NULL,NULL,1,0,NULL,0,NULL,NULL,NULL),
(32,'Naseeb Biryani',NULL,'Railway Road Kot Addu',NULL,NULL,'0.00','30 minute','+923366001926','Naseeb@servenow.pk','Railway Road KotAddu',11,1,'2025-12-15 23:58:06.000','2025-12-15 23:58:06.000','11:00:00','19:00:00',NULL,NULL,'/uploads/store_upload_1765825086047_100.jpg',NULL,NULL,1,0,NULL,0,NULL,NULL,NULL),
(33,'Haji Naeem Samosa',NULL,'Railway chowk Kot Addu',NULL,NULL,'0.00','30 minute','+923216661595','HajiNaeem@servenow.pk','Railway Chowk Kot Addu',11,1,'2025-12-16 00:37:36.000','2025-12-16 00:37:36.000','11:00:00','21:00:00',NULL,NULL,'/uploads/store_upload_1765827455920_924.jpg',NULL,NULL,1,0,NULL,0,NULL,NULL,NULL);

DROP TABLE IF EXISTS `units`;
CREATE TABLE `units` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `abbreviation` varchar(10) DEFAULT NULL,
  `multiplier` decimal(10,4) DEFAULT 1.0000,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=33 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `units` (`id`, `name`, `abbreviation`, `multiplier`, `created_at`) VALUES
(1,'Kilogram','kg','1.0000','2025-12-10 17:00:58.000'),
(30,'Dozen','DZ','1.0000','2025-12-15 10:30:40.000'),
(31,'Blister pack','BL','1.0000','2025-12-15 10:31:39.000'),
(32,'Liter','Ltr','1.0000','2025-12-15 12:18:28.000');

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
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `users` (`id`, `first_name`, `last_name`, `email`, `phone`, `password`, `address`, `user_type`, `is_active`, `created_at`, `updated_at`) VALUES
(1,'Admin','User','admin@servenow.com','+1234567890','$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',NULL,'admin',1,'2025-11-30 20:48:32.000','2025-12-09 14:59:22.000'),
(11,'Nazir','Admed','nazirahmed@servenow.pk','+923214455252','$2a$10$YHi1OtM1KR9a6uOPzIt7IO7VntdoFqBgzSamAFwqG/qwwTTysGvlO','Lahore','admin',1,'2025-12-15 00:31:52.000','2025-12-15 00:31:52.000'),
(12,'user','11','user@servenow.pk','+923254444441','$2a$10$VzgXJ3q/nPTlDjS3cfWx.eskcUbzAoe2RqDTBq7.axLDLddenXFZG','83, The Mall, Lahore','customer',1,'2025-12-15 00:46:36.000','2025-12-15 10:16:19.000');

