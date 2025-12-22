-- ServeNow database dump
-- Database: servenow
-- Generated: 2025-12-19T00:21:50.188Z

DROP TABLE IF EXISTS `categories`;
CREATE TABLE `categories` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `description` text DEFAULT NULL,
  `image_url` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=97 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `categories` (`id`, `name`, `description`, `image_url`, `is_active`, `created_at`) VALUES
(1,'Vegetables','Fresh vegetables and greens','/images/vegetables.jpg',1,'2025-11-30 20:48:32.000'),
(60,'Pharmacy','100 % Quality Products','/uploads/category_1765775517922_138.jfif',1,'2025-12-15 10:11:58.000'),
(61,'Chicken Karahi','Good Taste','/uploads/category_1765972500239_676.jpg',1,'2025-12-15 18:24:59.000'),
(62,'Biryani','Tasty','/uploads/category_1765883632453_771.jpeg',1,'2025-12-16 16:13:52.000'),
(63,'Ice Cream','Freah $ Cold','/uploads/category_1765884060179_498.jpeg',1,'2025-12-16 16:21:00.000'),
(64,'Rice','Tasty',NULL,1,'2025-12-16 16:55:13.000'),
(65,'Rice','Tasty',NULL,0,'2025-12-16 16:55:13.000'),
(66,'Drink','Fresh & Cold',NULL,1,'2025-12-16 16:56:52.000'),
(67,'Chicken Qourma','Delicious',NULL,1,'2025-12-16 16:57:37.000'),
(68,'Roti','Fresh',NULL,1,'2025-12-16 16:57:53.000'),
(69,'Fish','Tasty',NULL,1,'2025-12-16 16:58:10.000'),
(70,'Daal','Fresh',NULL,1,'2025-12-16 16:58:24.000'),
(71,'Ready','Fresh',NULL,1,'2025-12-16 16:58:47.000'),
(72,'Beef Pulao','Yummy',NULL,1,'2025-12-16 16:59:10.000'),
(73,'Wings','Hot & Tasty',NULL,1,'2025-12-16 16:59:43.000'),
(74,'Naan','Fresh',NULL,1,'2025-12-16 16:59:59.000'),
(75,'Mutton','Fresh',NULL,1,'2025-12-16 17:00:18.000'),
(76,'Fast Food','Fresh',NULL,1,'2025-12-16 17:00:35.000'),
(77,'Soup','Hot',NULL,1,'2025-12-16 17:00:58.000'),
(78,'BBQ','Tasty',NULL,1,'2025-12-16 17:01:17.000'),
(79,'Coffee','Fresh',NULL,1,'2025-12-16 17:01:40.000'),
(80,'Juice','Fresh',NULL,1,'2025-12-16 17:01:53.000'),
(81,'Shawarma','Hot & Spicy',NULL,1,'2025-12-16 17:02:17.000'),
(82,'Burger','Fresh & Hot','/uploads/category_1765889140664_723.jfif',1,'2025-12-16 17:03:39.000'),
(83,'Fries','Hot & Spicy',NULL,1,'2025-12-16 17:04:51.000'),
(84,'Fries','Hot & Spicy',NULL,1,'2025-12-16 17:04:51.000'),
(85,'Platter','Hot',NULL,1,'2025-12-16 17:07:19.000'),
(86,'Samosa','Fresh','/uploads/category_1765972365647_778.jpeg',1,'2025-12-17 15:52:52.000'),
(87,'Chicken Karahi','Good Taste','/uploads/category_1765972508229_968.jpg',1,'2025-12-17 16:55:08.000'),
(88,'Samosa','Tasty',NULL,1,'2025-12-18 11:54:27.000'),
(89,'Roll','Tasty',NULL,1,'2025-12-18 11:54:40.000'),
(90,'Sandwich','Tasty',NULL,1,'2025-12-18 11:54:59.000'),
(91,'Shami','Tasty',NULL,1,'2025-12-18 11:55:17.000'),
(92,'Pulao','Tasty',NULL,1,'2025-12-18 12:00:53.000'),
(93,'Deal','Tasty',NULL,1,'2025-12-18 12:12:02.000'),
(94,'Gravy','Tasty',NULL,1,'2025-12-18 12:12:43.000'),
(95,'1 Piece','Tasty',NULL,1,'2025-12-18 12:28:07.000'),
(96,'Handi','Tasty',NULL,1,'2025-12-18 21:01:41.000');

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

DROP TABLE IF EXISTS `login_logs`;
CREATE TABLE `login_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `user_type` varchar(20) NOT NULL,
  `login_time` timestamp NOT NULL DEFAULT current_timestamp(),
  `ip_address` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=37 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `login_logs` (`id`, `user_id`, `user_type`, `login_time`, `ip_address`) VALUES
(1,0,'admin','2025-12-18 21:49:32.000','192.168.55.1'),
(2,12,'customer','2025-12-18 21:53:04.000','192.168.55.1'),
(3,12,'customer','2025-12-18 21:56:31.000','192.168.55.1'),
(4,12,'customer','2025-12-18 22:05:52.000','192.168.55.1'),
(5,0,'admin','2025-12-18 22:07:00.000','192.168.55.1'),
(6,0,'admin','2025-12-18 22:10:33.000','192.168.55.1'),
(7,11,'admin','2025-12-18 22:12:20.000','192.168.55.1'),
(8,0,'admin','2025-12-18 22:14:47.000','192.168.55.1'),
(9,12,'customer','2025-12-18 22:17:40.000','192.168.55.1'),
(10,1,'rider','2025-12-18 22:38:33.000','192.168.55.1'),
(11,12,'customer','2025-12-18 22:44:43.000','192.168.55.1'),
(12,12,'customer','2025-12-18 22:44:44.000','192.168.55.1'),
(13,1,'rider','2025-12-18 22:49:00.000','192.168.55.1'),
(14,1,'rider','2025-12-18 22:52:44.000','192.168.55.1'),
(15,1,'rider','2025-12-18 22:57:47.000','192.168.55.1'),
(16,1,'rider','2025-12-18 22:59:00.000','192.168.55.1'),
(17,1,'rider','2025-12-18 22:59:58.000','192.168.55.1'),
(18,1,'rider','2025-12-18 23:08:52.000','192.168.55.1'),
(19,1,'rider','2025-12-18 23:11:29.000','192.168.55.1'),
(20,12,'customer','2025-12-18 23:14:58.000','192.168.55.1'),
(21,12,'customer','2025-12-18 23:23:57.000','192.168.55.1'),
(22,12,'customer','2025-12-18 23:28:17.000','192.168.55.1'),
(23,12,'customer','2025-12-18 23:30:48.000','192.168.55.1'),
(24,12,'customer','2025-12-18 23:52:00.000','192.168.55.1'),
(25,1,'rider','2025-12-18 23:54:09.000','192.168.55.1'),
(26,0,'admin','2025-12-18 23:54:32.000','192.168.55.1'),
(27,12,'customer','2025-12-19 00:22:23.000','192.168.55.1'),
(28,12,'customer','2025-12-19 00:27:06.000','192.168.55.1'),
(29,12,'customer','2025-12-19 00:32:55.000','192.168.55.1'),
(30,13,'customer','2025-12-19 02:29:21.000','192.168.55.1'),
(31,15,'customer','2025-12-19 04:08:20.000','192.168.55.1'),
(32,17,'customer','2025-12-19 04:36:17.000','192.168.55.1'),
(33,17,'customer','2025-12-19 04:44:23.000','192.168.55.1'),
(34,1,'rider','2025-12-19 04:44:42.000','192.168.55.1'),
(35,0,'admin','2025-12-19 05:06:37.000','192.168.55.1'),
(36,0,'admin','2025-12-19 05:07:48.000','192.168.55.1');

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
) ENGINE=InnoDB AUTO_INCREMENT=22 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `orders` (`id`, `order_number`, `user_id`, `store_id`, `rider_id`, `total_amount`, `delivery_fee`, `status`, `rider_location`, `estimated_delivery_time`, `payment_method`, `payment_status`, `delivery_address`, `delivery_time`, `special_instructions`, `created_at`, `updated_at`) VALUES
(14,'ORD1765839117875277',12,32,1,'722.99','2.99','delivered','Delivered to customer','2025-12-16 03:53:35.000','cash','pending','25-B','1hour','Call First','2025-12-16 03:51:57.000','2025-12-16 03:53:35.000'),
(20,'ORD1766083978016871',12,23,1,'9402.99','2.99','out_for_delivery',NULL,'2025-12-19 00:24:54.000','cash','pending','83, The Mall, Lahore','1hour',NULL,'2025-12-18 23:52:58.000','2025-12-18 23:54:54.000'),
(21,'ORD1766086088861479',12,23,NULL,'4702.99','2.99','pending',NULL,'2025-12-19 00:28:08.000','cash','pending','25-B','as soon as possible','Do Ring Door  Bell Only Call','2025-12-19 00:28:08.000','2025-12-19 00:28:08.000');

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
) ENGINE=InnoDB AUTO_INCREMENT=38 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `order_items` (`id`, `order_id`, `product_id`, `quantity`, `price`, `created_at`) VALUES
(23,14,75,1,'130.00','2025-12-16 03:51:57.000'),
(24,14,73,2,'130.00','2025-12-16 03:51:57.000'),
(25,14,59,1,'140.00','2025-12-16 03:51:57.000'),
(26,14,67,1,'40.00','2025-12-16 03:51:57.000'),
(27,14,60,1,'150.00','2025-12-16 03:51:57.000'),
(28,20,123,1,'1100.00','2025-12-18 23:52:58.000'),
(29,20,119,1,'1700.00','2025-12-18 23:52:58.000'),
(30,20,120,1,'900.00','2025-12-18 23:52:58.000'),
(31,20,55,1,'1600.00','2025-12-18 23:52:58.000'),
(32,20,118,1,'900.00','2025-12-18 23:52:58.000'),
(33,20,121,1,'1100.00','2025-12-18 23:52:58.000'),
(34,20,122,1,'2100.00','2025-12-18 23:52:58.000'),
(35,21,55,1,'1600.00','2025-12-19 00:28:08.000'),
(36,21,121,2,'1100.00','2025-12-19 00:28:08.000'),
(37,21,118,1,'900.00','2025-12-19 00:28:08.000');

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
) ENGINE=InnoDB AUTO_INCREMENT=124 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `products` (`id`, `name`, `description`, `price`, `image_url`, `category_id`, `store_id`, `stock_quantity`, `is_available`, `created_at`, `updated_at`, `image_bg_r`, `image_bg_g`, `image_bg_b`, `image_overlay_alpha`, `image_contrast`, `unit_id`, `size_id`, `item_id`) VALUES
(55,'Chicken Karahi','dfds','1600.00','/uploads/upload_1765741997545_194.jpg',61,23,50,1,'2025-12-15 00:53:17.000','2025-12-17 03:29:15.000',NULL,NULL,NULL,NULL,NULL,1,NULL,NULL),
(56,'panadol','110%','70.00','/uploads/upload_1765777195506_369.jfif',60,27,200,1,'2025-12-15 10:39:55.000','2025-12-17 04:32:42.000',NULL,NULL,NULL,NULL,NULL,31,15,NULL),
(57,'Chicken Karahi','dfds','160.00','/uploads/upload_1765889529665_107.jfif',60,27,10,0,'2025-12-15 18:59:01.000','2025-12-16 17:56:02.000',NULL,NULL,NULL,NULL,NULL,1,NULL,NULL),
(58,'Chicken Karahi','','450.00','/uploads/upload_1765823619794_770.jpg',61,30,1000,0,'2025-12-15 23:33:40.000','2025-12-18 12:10:55.000',NULL,NULL,NULL,NULL,NULL,1,23,NULL),
(59,'Sada Shami Burger','','140.00','/uploads/upload_1765825894066_520.jpg',82,31,1000,1,'2025-12-16 00:11:34.000','2025-12-18 12:02:40.000',NULL,NULL,NULL,NULL,NULL,NULL,24,NULL),
(60,'Anda Shami Burger','','150.00','/uploads/upload_1765826025751_82.jpg',82,31,1000,1,'2025-12-16 00:13:46.000','2025-12-18 11:57:27.000',NULL,NULL,NULL,NULL,NULL,NULL,24,NULL),
(61,'Chicken Anda Shami Burger','','210.00','/uploads/upload_1765826164853_85.jpg',82,31,1000,1,'2025-12-16 00:16:05.000','2025-12-18 12:01:28.000',NULL,NULL,NULL,NULL,NULL,NULL,24,NULL),
(62,'Chicken Tower Burger','','240.00','/uploads/upload_1765826421013_108.jpg',82,31,1000,1,'2025-12-16 00:20:21.000','2025-12-18 12:04:57.000',NULL,NULL,NULL,NULL,NULL,NULL,24,NULL),
(63,'King Special shawarma','','140.00','/uploads/upload_1765826556470_493.jpg',81,31,1000,1,'2025-12-16 00:22:36.000','2025-12-18 11:59:23.000',NULL,NULL,NULL,NULL,NULL,NULL,19,NULL),
(64,'zinger Burger','','310.00','/uploads/upload_1765826722235_468.webp',82,31,1000,1,'2025-12-16 00:25:22.000','2025-12-18 12:04:03.000',NULL,NULL,NULL,NULL,NULL,NULL,23,NULL),
(65,'Zinger Shawarma','','260.00','/uploads/upload_1765826855025_265.jpg',81,31,1000,1,'2025-12-16 00:27:35.000','2025-12-18 12:04:27.000',NULL,NULL,NULL,NULL,NULL,NULL,24,NULL),
(66,'Crispy Thai Piece','','200.00','/uploads/upload_1765827113102_289.jpg',82,31,1000,1,'2025-12-16 00:31:53.000','2025-12-18 12:05:12.000',NULL,NULL,NULL,NULL,NULL,NULL,24,NULL),
(67,'Alo Wala Samosa','','40.00','/uploads/upload_1765827517709_493.jpg',86,33,2000,1,'2025-12-16 00:38:38.000','2025-12-18 11:56:37.000',NULL,NULL,NULL,NULL,NULL,NULL,23,NULL),
(68,'Qeema Wala Samosa','','40.00','/uploads/upload_1765827651859_937.jpg',88,33,1000,1,'2025-12-16 00:40:52.000','2025-12-18 11:59:40.000',NULL,NULL,NULL,NULL,NULL,NULL,23,NULL),
(69,'Roll Fry','','70.00','/uploads/upload_1765827762209_127.jpg',NULL,33,1000,1,'2025-12-16 00:42:42.000','2025-12-18 12:02:06.000',NULL,NULL,NULL,NULL,NULL,NULL,23,NULL),
(70,'Chicken Shami','','40.00','/uploads/upload_1765827856112_796.jpg',91,33,1000,1,'2025-12-16 00:44:16.000','2025-12-18 12:01:47.000',NULL,NULL,NULL,NULL,NULL,NULL,23,NULL),
(71,'Sandwich','','70.00','/uploads/upload_1765827976903_299.jpg',90,33,1000,1,'2025-12-16 00:46:17.000','2025-12-18 12:02:59.000',NULL,NULL,NULL,NULL,NULL,NULL,24,NULL),
(72,'Chicken Biryani','','210.00','/uploads/upload_1765828178489_570.jpg',62,32,1000,1,'2025-12-16 00:49:38.000','2025-12-18 11:50:54.000',NULL,NULL,NULL,NULL,NULL,NULL,31,NULL),
(73,'Simple Biryani','','130.00','/uploads/upload_1765828283336_476.jpg',62,32,1000,1,'2025-12-16 00:51:23.000','2025-12-18 12:03:24.000',NULL,NULL,NULL,NULL,NULL,NULL,31,NULL),
(74,'Beef Pulao','','210.00','/uploads/upload_1765828363904_532.jpg',62,32,200,1,'2025-12-16 00:52:44.000','2025-12-18 11:56:58.000',NULL,NULL,NULL,NULL,NULL,NULL,31,NULL),
(75,'Simple Pulao','','130.00','/uploads/upload_1765828506409_0.jpg',62,32,1000,1,'2025-12-16 00:55:06.000','2025-12-18 12:00:28.000',NULL,NULL,NULL,NULL,NULL,NULL,31,NULL),
(78,'Special Cup','','200.00','/uploads/upload_1765999234537_417.webp',63,29,2000,1,'2025-12-18 00:20:34.000','2025-12-18 00:20:34.000',NULL,NULL,NULL,NULL,NULL,NULL,24,NULL),
(79,'Ice Cream Cup','','150.00','/uploads/upload_1765999668065_719.jpg',63,29,1000,1,'2025-12-18 00:27:48.000','2025-12-18 00:27:48.000',NULL,NULL,NULL,NULL,NULL,NULL,20,NULL),
(80,'Medium Cup','Cold','100.00','/uploads/upload_1765999759881_215.jpg',63,29,1000,1,'2025-12-18 00:29:20.000','2025-12-18 00:29:20.000',NULL,NULL,NULL,NULL,NULL,NULL,19,NULL),
(81,'Small Cup','Cold','80.00','/uploads/upload_1765999816914_552.jpg',63,29,1000,1,'2025-12-18 00:30:17.000','2025-12-18 00:30:17.000',NULL,NULL,NULL,NULL,NULL,NULL,15,NULL),
(82,'Simple Ice Cream Cup','Cold','50.00','/uploads/upload_1765999889534_183.jpg',63,29,1000,1,'2025-12-18 00:31:29.000','2025-12-18 00:31:29.000',NULL,NULL,NULL,NULL,NULL,NULL,24,NULL),
(83,'Special Kujja Ice Cream','Cold','200.00','/uploads/upload_1766000194054_105.jpg',63,29,1000,1,'2025-12-18 00:36:34.000','2025-12-18 01:13:34.000',NULL,NULL,NULL,NULL,NULL,NULL,24,NULL),
(84,'Medium Kujja Ice Cream','Cold','150.00','/uploads/upload_1766000251621_460.jpg',63,29,1000,1,'2025-12-18 00:37:31.000','2025-12-18 00:37:31.000',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(85,'Family Pack Ice Cream','Cold','800.00','/uploads/upload_1766000506333_406.jpg',63,29,1000,1,'2025-12-18 00:41:46.000','2025-12-18 00:44:57.000',NULL,NULL,NULL,NULL,NULL,NULL,35,NULL),
(86,'Family Pack Ice Cream','Cold','400.00','/uploads/upload_1766000814117_891.jpg',63,29,1000,1,'2025-12-18 00:46:54.000','2025-12-18 00:46:54.000',NULL,NULL,NULL,NULL,NULL,NULL,34,NULL),
(87,'Tikka Chest Piece','Tasty','250.00','/uploads/upload_1766001686425_473.jpg',78,36,1000,1,'2025-12-18 00:58:34.000','2025-12-18 01:01:26.000',NULL,NULL,NULL,NULL,NULL,NULL,24,NULL),
(88,'Tikka Leg Piece','Tasty','200.00','/uploads/upload_1766001654450_191.jpg',78,36,1000,1,'2025-12-18 01:00:54.000','2025-12-18 01:00:54.000',NULL,NULL,NULL,NULL,NULL,NULL,23,NULL),
(89,'Tikka Boti','Tasty','100.00','/uploads/upload_1766001859782_623.jpg',78,36,1000,1,'2025-12-18 01:04:20.000','2025-12-18 01:04:20.000',NULL,NULL,NULL,NULL,NULL,NULL,37,NULL),
(90,'Grill Fish','Tasty','1400.00','/uploads/upload_1766001964041_845.jpg',78,36,1000,1,'2025-12-18 01:06:04.000','2025-12-18 01:06:04.000',NULL,NULL,NULL,NULL,NULL,1,23,NULL),
(91,'Grill Fresh','Tasty','700.00','/uploads/upload_1766002091948_450.jpg',78,36,1000,1,'2025-12-18 01:08:12.000','2025-12-18 01:08:12.000',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(92,'Beef Seekh Kabab','Tasty','70.00','/uploads/upload_1766002202070_115.jpg',78,36,1000,1,'2025-12-18 01:10:02.000','2025-12-18 01:10:02.000',NULL,NULL,NULL,NULL,NULL,NULL,37,NULL),
(93,'Fry Fish','Tasty','1250.00','/uploads/upload_1766002389506_227.jpg',78,36,1000,1,'2025-12-18 01:13:09.000','2025-12-18 01:13:09.000',NULL,NULL,NULL,NULL,NULL,1,24,NULL),
(94,'Fry Fish','Tasty','650.00','/uploads/upload_1766002564944_31.jpg',78,36,1000,1,'2025-12-18 01:16:05.000','2025-12-18 01:16:05.000',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(95,'Kaleji Fry','Tasty','40.00','/uploads/upload_1766002671015_107.jpg',78,36,1000,1,'2025-12-18 01:17:51.000','2025-12-18 01:17:51.000',NULL,NULL,NULL,NULL,NULL,NULL,23,NULL),
(96,'Pota Fry','Tasty','30.00','/uploads/upload_1766002855337_821.jpg',78,36,1000,1,'2025-12-18 01:20:55.000','2025-12-18 01:20:55.000',NULL,NULL,NULL,NULL,NULL,NULL,24,NULL),
(97,'Neck Fry','Tasty','60.00','/uploads/upload_1766002995784_43.avif',78,36,1000,1,'2025-12-18 01:23:16.000','2025-12-18 01:23:16.000',NULL,NULL,NULL,NULL,NULL,NULL,24,NULL),
(98,'Tikki Kabab','Tasty','25.00','/uploads/upload_1766003359372_740.jpg',78,36,1000,1,'2025-12-18 01:29:19.000','2025-12-18 01:29:19.000',NULL,NULL,NULL,NULL,NULL,NULL,23,NULL),
(99,'Shami Kabab','Tasty','30.00','/uploads/upload_1766003414953_186.jpg',78,36,1000,1,'2025-12-18 01:30:15.000','2025-12-18 01:30:15.000',NULL,NULL,NULL,NULL,NULL,NULL,24,NULL),
(100,'Roti','','12.00','/uploads/upload_1766003502759_587.jpg',78,36,1000,1,'2025-12-18 01:31:43.000','2025-12-18 01:31:43.000',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(101,'Chicken Karahi','Tasty','450.00','/uploads/upload_1766042098034_329.jpg',61,30,1000,1,'2025-12-18 12:14:58.000','2025-12-18 12:14:58.000',NULL,NULL,NULL,NULL,NULL,33,23,NULL),
(102,'Chicken Kali Mirchi Karahi','Tasty','700.00','/uploads/upload_1766042242657_878.jpg',61,30,1000,1,'2025-12-18 12:17:23.000','2025-12-18 12:17:23.000',NULL,NULL,NULL,NULL,NULL,37,24,NULL),
(103,'Chicken Hari Mirchi Karahi','Tasty','700.00','/uploads/upload_1766042491455_910.jpg',61,30,1000,1,'2025-12-18 12:21:31.000','2025-12-18 12:21:31.000',NULL,NULL,NULL,NULL,NULL,36,24,NULL),
(104,'Kabab Gravy','Tasty','150.00','/uploads/upload_1766042655942_436.jpg',94,30,1000,1,'2025-12-18 12:24:16.000','2025-12-18 12:24:16.000',NULL,NULL,NULL,NULL,NULL,NULL,37,NULL),
(105,'Tikka Gravy','Tasty','200.00','/uploads/upload_1766042783070_434.jpg',94,30,1000,1,'2025-12-18 12:26:23.000','2025-12-18 12:26:23.000',NULL,NULL,NULL,NULL,NULL,NULL,37,NULL),
(106,'Tawa Leg Piece','Tasty','300.00','/uploads/upload_1766043066164_504.jpg',95,30,1000,1,'2025-12-18 12:31:06.000','2025-12-18 12:31:06.000',NULL,NULL,NULL,NULL,NULL,NULL,23,NULL),
(107,'Tawa Chest Piece','Tasty','350.00','/uploads/upload_1766043131308_994.png',95,30,1000,1,'2025-12-18 12:32:11.000','2025-12-18 12:32:11.000',NULL,NULL,NULL,NULL,NULL,NULL,23,NULL),
(108,'Tikka Leg Piece','Tasty','300.00','/uploads/upload_1766043207763_216.png',78,30,1000,1,'2025-12-18 12:33:28.000','2025-12-18 12:35:00.000',NULL,NULL,NULL,NULL,NULL,NULL,24,NULL),
(109,'Tikka Chest Piece','Tasty','350.00','/uploads/upload_1766043273581_661.jpg',78,30,1000,1,'2025-12-18 12:34:33.000','2025-12-18 12:34:33.000',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(110,'Tikka Boti Seekh','Tasty','150.00','/uploads/upload_1766043381573_245.jpg',78,30,1000,1,'2025-12-18 12:36:21.000','2025-12-18 12:36:21.000',NULL,NULL,NULL,NULL,NULL,NULL,38,NULL),
(111,'Chicken Kabab Seekh','Tasty','100.00','/uploads/upload_1766043558948_710.jpg',78,30,1000,1,'2025-12-18 12:39:27.000','2025-12-18 12:39:27.000',NULL,NULL,NULL,NULL,NULL,NULL,37,NULL),
(112,'Chicken Kabab Seekh','Tasty','100.00','/uploads/upload_1766043561810_969.jpg',78,30,1000,1,'2025-12-18 12:39:27.000','2025-12-18 12:39:27.000',NULL,NULL,NULL,NULL,NULL,NULL,37,NULL),
(113,'Chicken Kabab Seekh','Tasty','100.00','/uploads/upload_1766043558747_174.jpg',78,30,1000,1,'2025-12-18 12:39:27.000','2025-12-18 12:39:27.000',NULL,NULL,NULL,NULL,NULL,NULL,37,NULL),
(114,'Chicken Kabab Seekh','Tasty','100.00','/uploads/upload_1766043567691_881.jpg',78,30,1000,1,'2025-12-18 12:39:28.000','2025-12-18 12:39:28.000',NULL,NULL,NULL,NULL,NULL,NULL,37,NULL),
(115,'Anda Shami','Tasty','150.00','/uploads/upload_1766043707713_163.jpg',91,30,1000,1,'2025-12-18 12:41:48.000','2025-12-18 12:41:48.000',NULL,NULL,NULL,NULL,NULL,NULL,23,NULL),
(116,'Masala Roti','Hot','40.00','/uploads/upload_1766043915671_283.jpg',68,30,1000,1,'2025-12-18 12:45:16.000','2025-12-18 12:45:16.000',NULL,NULL,NULL,NULL,NULL,NULL,24,NULL),
(117,'Roti','Hot','15.00','/uploads/upload_1766044262710_522.jpg',68,30,1000,1,'2025-12-18 12:51:03.000','2025-12-18 12:51:03.000',NULL,NULL,NULL,NULL,NULL,NULL,23,NULL),
(118,'Chicken Karahi','Tasty','900.00','/uploads/upload_1766044411546_284.jpg',61,23,500,1,'2025-12-18 12:53:31.000','2025-12-18 12:53:31.000',NULL,NULL,NULL,NULL,NULL,36,24,NULL),
(119,'Chicken Hari Mirchi Karahi','','1700.00','/uploads/upload_1766072861602_338.webp',61,23,1000,1,'2025-12-18 20:47:42.000','2025-12-18 20:54:25.000',NULL,NULL,NULL,NULL,NULL,1,NULL,NULL),
(120,'Chicken Hari Mirchi Karahi','','900.00','/uploads/upload_1766072866525_263.webp',61,23,1000,1,'2025-12-18 20:47:47.000','2025-12-18 20:52:29.000',NULL,NULL,NULL,NULL,NULL,36,39,NULL),
(121,'Chicken White Handi','','1100.00','/uploads/upload_1766074154655_770.jfif',96,23,1000,1,'2025-12-18 21:09:15.000','2025-12-18 21:17:02.000',NULL,NULL,NULL,NULL,NULL,36,NULL,NULL),
(122,'Chicken White Handi','','2100.00','/uploads/upload_1766075710143_67.jfif',96,23,1000,1,'2025-12-18 21:35:10.000','2025-12-18 21:35:10.000',NULL,NULL,NULL,NULL,NULL,1,NULL,NULL),
(123,'Chicken Afghani Handi','','1100.00','/uploads/upload_1766076720573_451.jfif',96,23,1000,1,'2025-12-18 21:52:01.000','2025-12-18 21:52:01.000',NULL,NULL,NULL,NULL,NULL,36,NULL,NULL);

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
) ENGINE=InnoDB AUTO_INCREMENT=41 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

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
(40,'500grm',NULL,'2025-12-18 01:07:17.000');

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
) ENGINE=InnoDB AUTO_INCREMENT=37 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `stores` (`id`, `name`, `description`, `location`, `latitude`, `longitude`, `rating`, `delivery_time`, `phone`, `email`, `address`, `owner_id`, `is_active`, `created_at`, `updated_at`, `opening_time`, `closing_time`, `min_order_value`, `base_delivery_fee`, `cover_image`, `category_id`, `delivery_zones`, `supports_pickup`, `supports_preorder`, `is_open`, `holiday_mode`, `tags`, `owner_name`, `payment_term`) VALUES
(23,'Aghosh Hotel','Ready made food','Kalii Pull Kot Addu',NULL,NULL,'0.00','35 Minute ','+923175592503','ShahG@servenow.pk','kali pull canal colony',11,1,'2025-12-15 00:46:48.000','2025-12-15 20:10:55.000','12:00:00','23:00:00',NULL,'0.00','/uploads/store_upload_1765741607644_791.jpg',NULL,NULL,1,0,NULL,0,NULL,'Khurram Shah',NULL),
(27,'Al Sheikh Pharmacy','100% ','Thana Chowk',NULL,NULL,'0.00','35-45','+923001234567','ghjjhhj@gmail.com','Thana Chowk G T Road Kotaddu',11,1,'2025-12-15 10:09:07.000','2025-12-15 17:35:31.000','08:00:00','12:00:00',NULL,NULL,'/uploads/store_upload_1765782923998_508.jfif',60,NULL,1,0,NULL,0,NULL,'Sheikh Furqan',NULL),
(28,'Pakeeza Hotel','','Kali pull Kot Addu',NULL,NULL,'0.00','35 to 40 minute','+923330713898','Pakeeza@servenow.pk','Kali pull Kot Addu ',11,1,'2025-12-15 18:26:48.000','2025-12-15 23:50:55.000','11:00:00','12:00:00',NULL,NULL,'/uploads/store_upload_1765824654762_64.jpg',61,NULL,1,0,NULL,0,NULL,'Akram Bhai','Credit with Discount'),
(29,'ZamZam Ice Cream Parlour','','Stadium Colony Kot Addu',NULL,NULL,'0.00','30 minute','+923336055050','mshahid@servenow.pk','Noor Shah Road Near Stadium KotAddu',11,1,'2025-12-15 21:43:54.000','2025-12-15 23:30:58.000','11:00:00','23:00:00',NULL,NULL,'/uploads/store_upload_1765823458043_757.png',NULL,NULL,1,0,NULL,0,NULL,NULL,NULL),
(30,'Shah G Hotel','','Noor Shah ChwokKot Addu',NULL,NULL,'0.00','35 minute','+923175592503','ShahgHotel@servenow.pk','Noor Shah Chowk Kot Addu Near By Stadium',11,1,'2025-12-15 21:47:23.000','2025-12-15 23:28:16.000','16:00:00','23:30:00',NULL,NULL,'/uploads/store_upload_1765823296556_344.png',NULL,NULL,1,0,NULL,0,NULL,NULL,NULL),
(31,'King Burger','','Thana Chowk KotAddu',NULL,NULL,'0.00','35 Minute ','+923428012699','king@servrnow.pk','Tana Chowk Near by Faislabad bakery',11,1,'2025-12-15 23:43:39.000','2025-12-16 17:39:04.000','16:00:00','23:00:00',NULL,NULL,'/uploads/store_upload_1765824218715_926.avif',NULL,NULL,1,0,NULL,0,NULL,NULL,NULL),
(32,'Naseeb Biryani','','Railway Road Kot Addu',NULL,NULL,'0.00','30 minute','+923366001926','Naseeb@servenow.pk','Railway Road KotAddu',11,1,'2025-12-15 23:58:06.000','2025-12-16 16:18:18.000','11:00:00','19:00:00',NULL,NULL,'/uploads/store_upload_1765825086047_100.jpg',NULL,NULL,1,0,NULL,0,NULL,NULL,NULL),
(33,'Haji Naeem Samosa','','Railway chowk Kot Addu',NULL,NULL,'0.00','30 minute','+923216661595','HajiNaeem@servenow.pk','Railway Chowk Kot Addu',11,1,'2025-12-16 00:37:36.000','2025-12-17 15:53:22.000','11:00:00','21:00:00',NULL,NULL,'/uploads/store_upload_1765827455920_924.jpg',NULL,NULL,1,0,NULL,0,NULL,NULL,NULL),
(36,'Rana B.B.Q','Tasty','Noor Shah Chowk Kot Addu',NULL,NULL,'0.00','35 Minute ','+923111003773','Ranabbq@servenow.pk','Noor Shah Chowk Kot Addu',11,1,'2025-12-18 00:55:40.000','2025-12-18 00:55:40.000','16:00:00','22:00:00',NULL,NULL,'/uploads/store_upload_1766001340068_534.png',NULL,NULL,1,0,NULL,0,NULL,NULL,NULL);

DROP TABLE IF EXISTS `units`;
CREATE TABLE `units` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `abbreviation` varchar(10) DEFAULT NULL,
  `multiplier` decimal(10,4) DEFAULT 1.0000,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=38 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `units` (`id`, `name`, `abbreviation`, `multiplier`, `created_at`) VALUES
(1,'Kilogram','kg','1.0000','2025-12-10 17:00:58.000'),
(30,'Dozen','DZ','1.0000','2025-12-15 10:30:40.000'),
(31,'Blister pack','BL','1.0000','2025-12-15 10:31:39.000'),
(32,'Liter','Ltr','1.0000','2025-12-15 12:18:28.000'),
(33,'250 Gram','Pao','1.0000','2025-12-16 16:47:20.000'),
(34,'Half Kilogram','HK','1.0000','2025-12-16 16:48:00.000'),
(35,'750 Gram','QK','1.0000','2025-12-16 16:48:36.000'),
(36,'500grm',NULL,'1.0000','2025-12-18 01:15:15.000'),
(37,'500grm',NULL,'1.0000','2025-12-18 01:15:16.000');

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
  `verification_code` varchar(6) DEFAULT NULL,
  `verification_expires_at` timestamp NULL DEFAULT NULL,
  `is_verified` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `users` (`id`, `first_name`, `last_name`, `email`, `phone`, `password`, `address`, `user_type`, `is_active`, `created_at`, `updated_at`, `verification_code`, `verification_expires_at`, `is_verified`) VALUES
(1,'Admin','User','admin@servenow.com','+1234567890','$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',NULL,'admin',1,'2025-11-30 20:48:32.000','2025-12-09 14:59:22.000',NULL,NULL,0),
(11,'Nazir','Admed','nazirahmed@servenow.pk','+923214455252','$2a$10$YHi1OtM1KR9a6uOPzIt7IO7VntdoFqBgzSamAFwqG/qwwTTysGvlO','Lahore','admin',1,'2025-12-15 00:31:52.000','2025-12-15 00:31:52.000',NULL,NULL,0),
(12,'user','11','user@servenow.pk','+923254444441','$2a$10$VzgXJ3q/nPTlDjS3cfWx.eskcUbzAoe2RqDTBq7.axLDLddenXFZG','83, The Mall, Lahore','customer',1,'2025-12-15 00:46:36.000','2025-12-15 10:16:19.000',NULL,NULL,0),
(13,'Aqeel Ur','Rehman','aaqueel@gmail.com','03214424625','$2a$10$wPOp5kpWyysrwQLTPiDiROMMzqRYXX4WLCmFGl0T4XSLz..Zrd6Fa','Aziz Avenue','customer',1,'2025-12-19 02:28:39.000','2025-12-19 02:28:39.000',NULL,NULL,0),
(17,'OneNet','Solutions','aaqueelrzbn@gmail.com','03214444444','$2a$10$8WnbWYg8Xz5SnbM9R6oAaO2FpYHroh.3Wv3jyvFSUqTZFpi5slX86','Mall','customer',1,'2025-12-19 04:35:32.000','2025-12-19 04:35:50.000',NULL,NULL,1);

