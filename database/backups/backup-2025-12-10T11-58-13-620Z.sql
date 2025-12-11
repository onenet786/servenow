-- ServeNow database dump
-- Database: servenow
-- Generated: 2025-12-10T11:58:13.620Z

DROP TABLE IF EXISTS `categories`;
CREATE TABLE `categories` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `description` text DEFAULT NULL,
  `image_url` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=26 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `categories` (`id`, `name`, `description`, `image_url`, `is_active`, `created_at`) VALUES
(1,'Vegetables','Fresh vegetables and greens','/images/vegetables.jpg',1,'2025-11-30 20:48:32.000'),
(2,'Dahi Bhale','Ready-to-eat meals and cooked dishes','/images/cooked-food.jpg',1,'2025-11-30 20:48:32.000'),
(3,'Household','Household items and essentials',NULL,1,'2025-11-30 20:48:32.000'),
(4,'Groceries','General grocery items',NULL,1,'2025-11-30 20:48:32.000'),
(5,'Burgers','Delicious burgers and sandwiches','/images/burgers.jpg',1,'2025-12-01 15:00:13.000'),
(6,'Pizza','Fresh and hot pizzas','/images/pizza.jpg',1,'2025-12-01 15:00:13.000'),
(7,'Desserts','Sweet treats and desserts','/images/desserts.jpg',1,'2025-12-01 15:00:13.000'),
(11,'Juices','A','',1,'2025-12-03 08:05:59.000'),
(12,'Biryani','','',1,'2025-12-03 12:46:01.000'),
(13,'Fast Food','','',1,'2025-12-03 12:46:39.000'),
(14,'Pakistani','','',1,'2025-12-03 12:47:11.000'),
(15,'Halwa Puri','','',1,'2025-12-03 12:47:47.000'),
(16,'Pratha','','',1,'2025-12-03 12:48:07.000'),
(17,'Chinese','','',1,'2025-12-03 12:48:32.000'),
(18,'Pasta','','',1,'2025-12-03 12:48:50.000'),
(19,'Shawarma','','',1,'2025-12-03 12:49:09.000'),
(20,'Ice Cream','','',1,'2025-12-03 12:49:30.000'),
(21,'BBQ','','',1,'2025-12-03 12:49:43.000'),
(22,'Samosa','','',1,'2025-12-03 12:50:05.000'),
(23,'Pulao','','',1,'2025-12-03 12:50:15.000'),
(24,'Medicines','','',1,'2025-12-03 13:39:51.000'),
(25,'Meat','Beef Meat','',1,'2025-12-03 13:50:01.000');

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
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `orders` (`id`, `order_number`, `user_id`, `store_id`, `rider_id`, `total_amount`, `delivery_fee`, `status`, `rider_location`, `estimated_delivery_time`, `payment_method`, `payment_status`, `delivery_address`, `delivery_time`, `special_instructions`, `created_at`, `updated_at`) VALUES
(1,'ORD1764531252527666',2,1,2,'5.48','2.99','delivered','Delivered to customer','2025-12-01 02:31:17.000','cash','paid','83, The Mall, Lahore','asap','','2025-12-01 00:34:12.000','2025-12-01 02:31:17.000'),
(2,'ORD1764615236422289',3,1,2,'222.99','2.99','delivered','Delivered to customer','2025-12-01 23:58:33.000','cash','paid','Aziz Avenuw','asap','','2025-12-01 23:53:56.000','2025-12-01 23:58:33.000'),
(3,'ORD1764616172568831',6,3,1,'217.99','2.99','delivered','Delivered to customer','2025-12-03 03:06:12.000','cash','paid','Admin','asap','dd','2025-12-02 00:09:32.000','2025-12-03 03:06:12.000'),
(4,'ORD1764620797541798',6,2,2,'152.99','2.99','delivered','Delivered to customer','2025-12-02 02:12:38.000','cash','pending','Admin','tomorrow','callme','2025-12-02 01:26:37.000','2025-12-02 02:12:38.000'),
(5,'ORD176466273772762',6,2,2,'1656.98','2.99','delivered','Delivered to customer','2025-12-03 02:33:48.000','cash','paid','25 B','tomorrow','call','2025-12-02 13:05:37.000','2025-12-03 02:33:48.000'),
(6,'ORD1764765208521107',3,1,3,'106.98','2.99','delivered','Delivered to customer','2025-12-03 17:37:43.000','cash','paid','Aziz Avenuw','1hour',NULL,'2025-12-03 17:33:28.000','2025-12-03 17:37:43.000'),
(7,'ORD1765041550567500',6,1,2,'226.98','2.99','delivered','Delivered to customer','2025-12-06 22:32:01.000','cash','paid','Township','2hours',NULL,'2025-12-06 22:19:10.000','2025-12-06 22:32:01.000'),
(8,'ORD1765069746484268',6,2,2,'442.99','2.99','delivered','Delivered to customer','2025-12-07 06:11:27.000','cash','paid','home','1hour','don\'t bell','2025-12-07 06:09:06.000','2025-12-07 06:11:27.000'),
(9,'ORD1765189378632621',3,1,4,'127.99','2.99','out_for_delivery',NULL,'2025-12-08 16:35:15.000','cash','pending','Aziz Avenuw','asap',NULL,'2025-12-08 15:22:58.000','2025-12-08 16:05:15.000'),
(10,'ORD1765189445709387',3,1,2,'172.99','2.99','out_for_delivery',NULL,'2025-12-10 12:12:11.000','cash','pending','Aziz Avenuw','1hour',NULL,'2025-12-08 15:24:05.000','2025-12-10 11:42:11.000');

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
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `order_items` (`id`, `order_id`, `product_id`, `quantity`, `price`, `created_at`) VALUES
(1,1,2,1,'2.49','2025-12-01 00:34:12.000'),
(2,2,2,1,'170.00','2025-12-01 23:53:56.000'),
(3,2,3,1,'50.00','2025-12-01 23:53:56.000'),
(4,3,4,1,'215.00','2025-12-02 00:09:32.000'),
(5,4,8,1,'150.00','2025-12-02 01:26:37.000'),
(6,5,5,1,'1500.00','2025-12-02 13:05:37.000'),
(7,5,1,1,'3.99','2025-12-02 13:05:37.000'),
(8,5,8,1,'150.00','2025-12-02 13:05:37.000'),
(9,6,3,2,'50.00','2025-12-03 17:33:28.000'),
(10,6,1,1,'3.99','2025-12-03 17:33:28.000'),
(11,7,3,1,'50.00','2025-12-06 22:19:10.000'),
(12,7,2,1,'170.00','2025-12-06 22:19:10.000'),
(13,7,1,1,'3.99','2025-12-06 22:19:10.000'),
(14,8,11,1,'200.00','2025-12-07 06:09:06.000'),
(15,8,3,2,'50.00','2025-12-07 06:09:06.000'),
(16,8,7,2,'70.00','2025-12-07 06:09:06.000'),
(17,9,18,1,'125.00','2025-12-08 15:22:58.000'),
(18,10,2,1,'170.00','2025-12-08 15:24:05.000');

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
  PRIMARY KEY (`id`),
  KEY `idx_products_store_id` (`store_id`),
  KEY `idx_products_category_id` (`category_id`),
  CONSTRAINT `products_ibfk_1` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL,
  CONSTRAINT `products_ibfk_2` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `products` (`id`, `name`, `description`, `price`, `image_url`, `category_id`, `store_id`, `stock_quantity`, `is_available`, `created_at`, `updated_at`, `image_bg_r`, `image_bg_g`, `image_bg_b`, `image_overlay_alpha`, `image_contrast`) VALUES
(1,'Organic Tomatoes',NULL,'250.00',NULL,1,1,50,1,'2025-11-30 20:48:32.000','2025-12-07 21:28:47.000',NULL,NULL,NULL,NULL,NULL),
(2,'Fresh Spinach',NULL,'170.00',NULL,1,1,30,1,'2025-11-30 20:48:32.000','2025-12-07 21:28:55.000',NULL,NULL,NULL,NULL,NULL),
(3,'Carrots',NULL,'15.00',NULL,1,2,40,1,'2025-11-30 20:48:32.000','2025-12-08 09:59:19.000',NULL,NULL,NULL,NULL,NULL),
(4,'Chicken Biryani',NULL,'215.00',NULL,2,3,20,1,'2025-11-30 20:48:32.000','2025-12-07 21:34:41.000',NULL,NULL,NULL,NULL,NULL),
(5,'Vegetable Pizza',NULL,'1500.00',NULL,2,2,15,1,'2025-11-30 20:48:32.000','2025-12-07 21:34:41.000',NULL,NULL,NULL,NULL,NULL),
(6,'Grilled Chicken',NULL,'50.00',NULL,2,1,25,1,'2025-11-30 20:48:32.000','2025-12-07 21:34:41.000',NULL,NULL,NULL,NULL,NULL),
(7,'Dish Soap',NULL,'45.00',NULL,3,1,35,1,'2025-11-30 20:48:32.000','2025-12-07 21:34:41.000',NULL,NULL,NULL,NULL,NULL),
(8,'Laundry Detergent',NULL,'150.00',NULL,3,2,20,1,'2025-11-30 20:48:32.000','2025-12-07 21:34:41.000',NULL,NULL,NULL,NULL,NULL),
(9,'Toilet Paper',NULL,'200.00',NULL,3,3,50,1,'2025-11-30 20:48:32.000','2025-12-07 21:34:41.000',NULL,NULL,NULL,NULL,NULL),
(10,'Milk',NULL,'3.49',NULL,4,1,30,1,'2025-11-30 20:48:32.000','2025-12-07 21:34:41.000',NULL,NULL,NULL,NULL,NULL),
(11,'Bread',NULL,'200.00',NULL,4,2,40,1,'2025-11-30 20:48:32.000','2025-12-07 21:34:41.000',NULL,NULL,NULL,NULL,NULL),
(12,'Rice',NULL,'405.00',NULL,4,3,60,1,'2025-11-30 20:48:32.000','2025-12-07 21:34:41.000',NULL,NULL,NULL,NULL,NULL),
(13,'Hico 1 lts','','1095.00','',20,4,5,1,'2025-12-06 15:28:00.000','2025-12-07 21:34:41.000',NULL,NULL,NULL,NULL,NULL),
(14,'Sugar','1KG Packing','205.00','/uploads/product_14_1765127862785.jpg',4,1,5,1,'2025-12-07 21:40:23.000','2025-12-07 22:17:42.000',NULL,NULL,NULL,NULL,NULL),
(15,'Biryani','Tasty','200.00','Naseeb Biryani',12,1,1,1,'2025-12-08 01:01:03.000','2025-12-10 10:03:59.000',NULL,NULL,NULL,NULL,NULL),
(16,'Salt','CHASHNIK SALT','55.00','https://media.naheed.pk/catalog/product/cache/ff36c7bc52e2e5dbc63cd67fba513679/1/1/1111753-1.jpg',4,2,9,1,'2025-12-08 07:52:57.000','2025-12-08 07:52:57.000',NULL,NULL,NULL,NULL,NULL),
(17,'Rusk','Bundu Khan Rusk','210.00','https://www.bundukhansweets.pk/wp-content/uploads/2025/05/Plain-Rusk-Round.jpeg',4,1,8,1,'2025-12-08 08:00:29.000','2025-12-08 08:00:29.000',NULL,NULL,NULL,NULL,NULL),
(18,'Tea','100 grams','125.00','https://tapaltea.com/wp-content/uploads/2025/04/FM-BNo.8961103600363-900gm-Barcode-Side.png',4,1,10,1,'2025-12-08 08:31:26.000','2025-12-08 08:31:26.000',NULL,NULL,NULL,NULL,NULL),
(19,'Mpli','sfsff','12.00','/uploads/upload_1765343446127_577.jpg',13,7,1,1,'2025-12-10 10:10:46.000','2025-12-10 10:10:46.000',NULL,NULL,NULL,NULL,NULL),
(20,'bbnm','vnbnnb','12.00','',15,9,2,1,'2025-12-10 10:12:15.000','2025-12-10 10:12:15.000',NULL,NULL,NULL,NULL,NULL);

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
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `riders` (`id`, `first_name`, `last_name`, `email`, `phone`, `password`, `vehicle_type`, `license_number`, `is_available`, `is_active`, `created_at`, `updated_at`) VALUES
(1,'Ahmed','Khan','ahmed.rider@servenow.pk','+1234567894','rider123','aqeel Rehman','LIC123456',1,1,'2025-11-30 20:48:32.000','2025-12-07 14:55:17.000'),
(2,'Fatima','Ali','fatima.rider@servenow.pk','+1234567895','rider456','Bicycle','LIC123457',1,1,'2025-11-30 20:48:32.000','2025-12-01 15:18:18.000'),
(3,'Omar','Hassan','omar.rider@servenow.pk','+1234567896','rider789','Scooter','LIC123458',1,0,'2025-11-30 20:48:32.000','2025-12-08 10:53:26.000'),
(4,'Aqeel','Rehman','aaqueel@gmail.com','03214424625','$2a$10$ZsliHvLJC.VG2B9xVgvH.O/jDg.lDctdxkQXCcUihH1Qgm6P/QbI.','Motorcycle','12365423',1,1,'2025-12-03 02:19:25.000','2025-12-03 02:19:25.000');

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
(1,1,'2025-12-08 00:00:00.000','234','244','15.00','1.00','1.00','tes','2025-12-08 17:04:42.000',NULL);

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
  `delivery_zones` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`delivery_zones`)),
  `supports_pickup` tinyint(1) DEFAULT 1,
  `supports_preorder` tinyint(1) DEFAULT 0,
  `is_open` tinyint(1) DEFAULT NULL,
  `holiday_mode` tinyint(1) DEFAULT 0,
  `tags` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `owner_id` (`owner_id`),
  CONSTRAINT `stores_ibfk_1` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `stores` (`id`, `name`, `description`, `location`, `latitude`, `longitude`, `rating`, `delivery_time`, `phone`, `email`, `address`, `owner_id`, `is_active`, `created_at`, `updated_at`, `opening_time`, `closing_time`, `min_order_value`, `base_delivery_fee`, `cover_image`, `delivery_zones`, `supports_pickup`, `supports_preorder`, `is_open`, `holiday_mode`, `tags`) VALUES
(1,'Fresh Market',NULL,'Downtown','40.71280000','-74.00600000','4.50','30-45 mins','+1234567891','fresh@market.com',NULL,1,1,'2025-11-30 20:48:32.000','2025-12-08 21:43:12.000',NULL,NULL,NULL,'0.00',NULL,NULL,1,0,NULL,0,NULL),
(2,'Green Grocery',NULL,'Midtown','40.75890000','-73.98510000','4.20','25-40 mins','+1234567892','green@grocery.com',NULL,1,1,'2025-11-30 20:48:32.000','2025-12-08 21:43:12.000',NULL,NULL,NULL,'0.00',NULL,NULL,1,0,NULL,0,NULL),
(3,'Al Nadeem Pharmacy',NULL,'Brooklyn','40.67820000','-73.94420000','4.70','35-50 mins','+1234567893','local@foods.com',NULL,1,1,'2025-11-30 20:48:32.000','2025-12-10 16:33:14.000',NULL,NULL,NULL,'0.00',NULL,NULL,1,0,NULL,0,NULL),
(4,'Bao Jee Gernal Store Kotaddu','Good taste ','Railway Road',NULL,NULL,'0.00','45','0300','ab526wyhs@gmail.com','Railway Station',4,1,'2025-12-03 08:04:29.000','2025-12-08 21:43:12.000',NULL,NULL,NULL,'0.00',NULL,NULL,1,0,NULL,0,NULL),
(5,'Al Sheikh Pharmacy Kotaddu','12','Thana Chowk',NULL,NULL,'0.00','45','032311','gjhljhg@gmail.com','Thana Chowk Kotaddu',4,1,'2025-12-03 13:43:32.000','2025-12-08 21:43:12.000',NULL,NULL,NULL,'0.00',NULL,NULL,1,0,NULL,0,NULL),
(6,'Ali Grocery store Kotaddu','Best Items','Noor Shah Chowk',NULL,NULL,'0.00','35','1275454','gasgsgh@gmail.com','Noor Shah Chowk Kotaddu ',4,1,'2025-12-03 13:58:12.000','2025-12-08 21:43:12.000',NULL,NULL,NULL,'0.00',NULL,NULL,1,0,NULL,0,NULL),
(7,'Naseeb Biryani',NULL,'Railway Road',NULL,NULL,'0.00','25 sy 30 mnt','03186009659','Naseeb@servenow.pk','Railway road kot addu',4,1,'2025-12-08 01:04:51.000','2025-12-08 21:43:12.000',NULL,NULL,NULL,'0.00',NULL,NULL,1,0,NULL,0,NULL),
(8,'Naseeb Biryani','Tasty','Railway Road',NULL,NULL,'0.00','25 sy 30 mnt','03186009659','Naseeb@servenow.pk','Railway Road Kot Addu',4,1,'2025-12-08 01:08:00.000','2025-12-08 21:43:12.000',NULL,NULL,NULL,'0.00',NULL,NULL,1,0,NULL,0,NULL),
(9,'Mehtab Halwa Puri','DES','Thana Chowk',NULL,NULL,'0.00','35','032311','jshksj@gmail.com','ADD',4,1,'2025-12-08 09:57:14.000','2025-12-08 21:43:12.000',NULL,NULL,NULL,'0.00',NULL,NULL,1,0,NULL,0,NULL),
(10,'TEST','Test','test',NULL,NULL,'0.00','50','+923334444555','123@servenow.pk','Aziz',4,1,'2025-12-08 18:45:26.000','2025-12-08 21:43:12.000','08:00:00','22:00:00',NULL,'0.00',NULL,NULL,1,0,NULL,0,NULL),
(11,'ONENET','BEST PARATHE','ZEESHAN GARMENTS',NULL,NULL,'0.00','40 MIN','32122222222','admin@servenow.com','LAHROE',1,1,'2025-12-08 21:40:06.000','2025-12-08 21:43:12.000','09:00:00','22:00:00',NULL,'0.00',NULL,NULL,1,0,NULL,0,NULL),
(12,'Dawood Halwa Puri','Fantastic Taste','Chota Bazar',NULL,NULL,'0.00','35','032155852','dhadjhak@gmail.com','Chota Bazar Kotaddu',4,1,'2025-12-10 15:18:30.000','2025-12-10 15:18:30.000',NULL,NULL,NULL,NULL,NULL,NULL,1,0,NULL,0,NULL);

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
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `users` (`id`, `first_name`, `last_name`, `email`, `phone`, `password`, `address`, `user_type`, `is_active`, `created_at`, `updated_at`) VALUES
(1,'Admin','User','admin@servenow.com','+1234567890','$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',NULL,'admin',1,'2025-11-30 20:48:32.000','2025-12-09 14:59:22.000'),
(2,'MCS','RWP','mcsrwp@gmail.com','03334488205','$2a$10$IAKAP2VIEQcdnXYeEJOMuOWxyN/PfPiWATC9NkrripeILCNfB5Q9.','83, The Mall, Lahore','customer',1,'2025-11-30 20:59:00.000','2025-12-09 14:59:26.000'),
(3,'user','pk','user@servenow.pk','+923334444555','$2a$10$Yi4rY2mS2UTVvVWgid5C.OxPqNeg5N3Rc6/g/LX5YXUbvpemzteN6','Aziz Avenuw','customer',1,'2025-12-01 15:28:34.000','2025-12-09 14:59:31.000'),
(4,'Nazir','Ahmed','nazirahmed@servenow.pk','+923213213213','$2a$10$3.Uc/2/qXzY2/T0xnINUeuK43vARuxbydmpke7prC9lPHAMOiL9N.','Model Town','admin',1,'2025-12-01 15:33:06.000','2025-12-09 15:01:29.000'),
(5,'User','11','user1@servenow.pk','+923214444555','$2a$10$5oYRfalThKPYy0FyFAijVuEO.yt9uJH8yLizMWXnXqnixk2cKI7fO','Lahore','customer',1,'2025-12-01 16:45:17.000','2025-12-09 14:59:36.000'),
(6,'Junaid','Javed','junaid@servenow.pk','+923211231231','$2a$10$/OT0Wt4IOk0gG7k2adU5qe7qXkxJo93oGhH9QQrZhJa.ZrmSeL5g2','Township','customer',1,'2025-12-01 22:36:26.000','2025-12-09 14:59:40.000'),
(7,'Fraz','Aziz','cfsdfsd@gmail.com','03186009659','$2a$10$FkSAIc/xbAmYIODBcYHJ1ejoWOGKCx5F2H0HKGBvbiSN1lKelEKnO','Kotaddu','admin',1,'2025-12-03 14:40:05.000','2025-12-09 14:59:43.000'),
(8,'Hamza','Ateeq','hamza@servenow.pk','0323252528','$2a$10$c1VAQakw1INlX7N6dKuUB.GS9NFhi4ErxC9zL9hNCu.2MmJzZ58UW','Manawan','admin',1,'2025-12-07 04:55:30.000','2025-12-07 04:55:30.000');

