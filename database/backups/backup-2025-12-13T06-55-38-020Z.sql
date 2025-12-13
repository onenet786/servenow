-- ServeNow database dump
-- Database: servenow
-- Generated: 2025-12-13T06:55:38.020Z

DROP TABLE IF EXISTS `categories`;
CREATE TABLE `categories` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `description` text DEFAULT NULL,
  `image_url` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=32 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

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
(25,'Meat','Beef Meat','',1,'2025-12-03 13:50:01.000'),
(26,'Karahi Goshat',NULL,'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxITEhUTExMWFhUXGR4bGBgXGBsbGBogHRgXHRsYHx8dHSogHholHR4aITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGhAQGi0lICYtLS8vLy0tLS0vMi0tLS0tLS0tLS0tLS4vLi0rLS0tLS0tLS8tLS0tLS0tLy0tLS0tLf/AABEIALcBEwMBIgACEQEDEQH/',1,'2025-12-10 17:58:09.000'),
(27,'Chicken',NULL,'',1,'2025-12-11 14:26:02.000'),
(28,'Pharmacy',NULL,'C:\\Users\\ZM COMPUTERS\\Downloads\\Pharmacy.jfif',1,'2025-12-11 19:20:07.000'),
(29,'Dairy Products',NULL,'C:\\Users\\Administrator\\Downloads\\Dairy Products.jpg',1,'2025-12-12 08:30:21.000'),
(30,'Dairy Products',NULL,'https://www.health.harvard.edu/blog/dairy-health-food-or-health-risk-2019012515849',0,'2025-12-13 09:59:27.000'),
(31,'Serve Fruits',NULL,'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQSW4zTttbwjxcoOza4IXTcKarIKsHI8b7nKg&s',1,'2025-12-13 10:24:42.000');

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
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `orders` (`id`, `order_number`, `user_id`, `store_id`, `rider_id`, `total_amount`, `delivery_fee`, `status`, `rider_location`, `estimated_delivery_time`, `payment_method`, `payment_status`, `delivery_address`, `delivery_time`, `special_instructions`, `created_at`, `updated_at`) VALUES
(1,'ORD1764531252527666',2,1,2,'5.48','2.99','delivered','Delivered to customer','2025-12-01 02:31:17.000','cash','paid','83, The Mall, Lahore','asap','','2025-12-01 00:34:12.000','2025-12-01 02:31:17.000'),
(2,'ORD1764615236422289',3,1,2,'222.99','2.99','delivered','Delivered to customer','2025-12-01 23:58:33.000','cash','paid','Aziz Avenuw','asap','','2025-12-01 23:53:56.000','2025-12-01 23:58:33.000'),
(3,'ORD1764616172568831',6,3,1,'217.99','2.99','delivered','Delivered to customer','2025-12-03 03:06:12.000','cash','paid','Admin','asap','dd','2025-12-02 00:09:32.000','2025-12-03 03:06:12.000'),
(4,'ORD1764620797541798',6,2,2,'152.99','2.99','delivered','Delivered to customer','2025-12-02 02:12:38.000','cash','pending','Admin','tomorrow','callme','2025-12-02 01:26:37.000','2025-12-02 02:12:38.000'),
(5,'ORD176466273772762',6,2,2,'1656.98','2.99','delivered','Delivered to customer','2025-12-03 02:33:48.000','cash','paid','25 B','tomorrow','call','2025-12-02 13:05:37.000','2025-12-03 02:33:48.000'),
(6,'ORD1764765208521107',3,1,3,'106.98','2.99','delivered','Delivered to customer','2025-12-03 17:37:43.000','cash','paid','Aziz Avenuw','1hour',NULL,'2025-12-03 17:33:28.000','2025-12-03 17:37:43.000'),
(7,'ORD1765041550567500',6,1,2,'226.98','2.99','delivered','Delivered to customer','2025-12-06 22:32:01.000','cash','paid','Township','2hours',NULL,'2025-12-06 22:19:10.000','2025-12-06 22:32:01.000'),
(8,'ORD1765069746484268',6,2,2,'442.99','2.99','delivered','Delivered to customer','2025-12-07 06:11:27.000','cash','paid','home','1hour','don\'t bell','2025-12-07 06:09:06.000','2025-12-07 06:11:27.000'),
(9,'ORD1765189378632621',3,1,4,'127.99','2.99','out_for_delivery',NULL,'2025-12-12 21:06:27.000','cash','pending','Aziz Avenuw','asap',NULL,'2025-12-08 15:22:58.000','2025-12-12 20:36:27.000'),
(10,'ORD1765189445709387',3,1,2,'172.99','2.99','out_for_delivery',NULL,'2025-12-12 21:06:21.000','cash','pending','Aziz Avenuw','1hour',NULL,'2025-12-08 15:24:05.000','2025-12-12 20:36:21.000'),
(11,'ORD1765376726091355',3,1,2,'2002.99','2.99','out_for_delivery',NULL,'2025-12-12 21:06:06.000','cash','pending','Aziz Avenuw','asap',NULL,'2025-12-10 19:25:26.000','2025-12-12 20:36:06.000'),
(12,'ORD1765554294375868',6,1,2,'466.48','2.99','delivered','Delivered to customer','2025-12-12 21:08:53.000','cash','paid','Township','2hours',NULL,'2025-12-12 20:44:54.000','2025-12-12 21:08:53.000');

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
(18,10,2,1,'170.00','2025-12-08 15:24:05.000'),
(19,11,22,1,'2000.00','2025-12-10 19:25:26.000'),
(20,12,10,1,'3.49','2025-12-12 20:44:54.000'),
(21,12,12,1,'405.00','2025-12-12 20:44:54.000'),
(22,12,16,1,'55.00','2025-12-12 20:44:54.000');

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
  PRIMARY KEY (`id`),
  KEY `idx_products_store_id` (`store_id`),
  KEY `idx_products_category_id` (`category_id`),
  KEY `fk_products_unit` (`unit_id`),
  KEY `fk_products_size` (`size_id`),
  CONSTRAINT `fk_products_size` FOREIGN KEY (`size_id`) REFERENCES `sizes` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_products_unit` FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE SET NULL,
  CONSTRAINT `products_ibfk_1` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL,
  CONSTRAINT `products_ibfk_2` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=42 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `products` (`id`, `name`, `description`, `price`, `image_url`, `category_id`, `store_id`, `stock_quantity`, `is_available`, `created_at`, `updated_at`, `image_bg_r`, `image_bg_g`, `image_bg_b`, `image_overlay_alpha`, `image_contrast`, `unit_id`, `size_id`) VALUES
(1,'Organic Tomatoes','','250.00','',1,1,50,1,'2025-11-30 20:48:32.000','2025-12-10 18:07:49.000',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(2,'Fresh Spinach',NULL,'170.00',NULL,1,1,30,1,'2025-11-30 20:48:32.000','2025-12-07 21:28:55.000',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(3,'Carrots',NULL,'15.00',NULL,1,2,40,1,'2025-11-30 20:48:32.000','2025-12-08 09:59:19.000',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(4,'Chicken Biryani',NULL,'215.00',NULL,2,3,20,1,'2025-11-30 20:48:32.000','2025-12-07 21:34:41.000',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(5,'Vegetable Pizza',NULL,'1500.00',NULL,2,2,15,1,'2025-11-30 20:48:32.000','2025-12-07 21:34:41.000',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(6,'Grilled Chicken',NULL,'50.00',NULL,2,1,25,1,'2025-11-30 20:48:32.000','2025-12-07 21:34:41.000',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(7,'Dish Soap',NULL,'45.00',NULL,3,1,35,1,'2025-11-30 20:48:32.000','2025-12-07 21:34:41.000',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(8,'Laundry Detergent',NULL,'150.00',NULL,3,2,20,1,'2025-11-30 20:48:32.000','2025-12-07 21:34:41.000',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(9,'Toilet Paper',NULL,'200.00',NULL,3,3,50,1,'2025-11-30 20:48:32.000','2025-12-07 21:34:41.000',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(10,'Milk',NULL,'3.49',NULL,4,1,30,1,'2025-11-30 20:48:32.000','2025-12-07 21:34:41.000',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(11,'Bread',NULL,'200.00',NULL,4,2,40,1,'2025-11-30 20:48:32.000','2025-12-07 21:34:41.000',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(12,'Rice',NULL,'405.00',NULL,4,3,60,1,'2025-11-30 20:48:32.000','2025-12-07 21:34:41.000',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(13,'Hico 1 lts','','1095.00','',20,4,5,1,'2025-12-06 15:28:00.000','2025-12-07 21:34:41.000',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(14,'Sugar`','1KG Packing','205.00','/uploads/upload_1765504421636_102.jpeg',4,1,5,1,'2025-12-07 21:40:23.000','2025-12-12 06:54:08.000',NULL,NULL,NULL,NULL,NULL,1,NULL),
(15,'Biryani','Tasty','200.00','/uploads/upload_1765368275767_489.jpg',12,1,1,1,'2025-12-08 01:01:03.000','2025-12-10 17:04:36.000',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(16,'Salt','CHASHNIK SALT','55.00','https://media.naheed.pk/catalog/product/cache/ff36c7bc52e2e5dbc63cd67fba513679/1/1/1111753-1.jpg',4,2,9,1,'2025-12-08 07:52:57.000','2025-12-08 07:52:57.000',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(17,'Rusk','Bundu Khan Rusk','210.00','https://www.bundukhansweets.pk/wp-content/uploads/2025/05/Plain-Rusk-Round.jpeg',4,1,8,1,'2025-12-08 08:00:29.000','2025-12-08 08:00:29.000',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(18,'Tea','100 grams','125.00','https://tapaltea.com/wp-content/uploads/2025/04/FM-BNo.8961103600363-900gm-Barcode-Side.png',4,1,10,1,'2025-12-08 08:31:26.000','2025-12-08 08:31:26.000',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(19,'Mpli','sfsff','12.00','/uploads/upload_1765343446127_577.jpg',13,7,1,1,'2025-12-10 10:10:46.000','2025-12-10 10:10:46.000',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(20,'bbnm','vnbnnb','12.00','',15,9,2,1,'2025-12-10 10:12:15.000','2025-12-13 11:43:05.000',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
(21,'RusMalai','Best Rus Maliay in the town','25.00','/uploads/upload_1765369512331_800.jpg',15,9,1,1,'2025-12-10 17:25:12.000','2025-12-10 18:09:55.000',NULL,NULL,NULL,NULL,NULL,1,NULL),
(22,'Karahi Goshat','Best Taste','2000.00','/uploads/upload_1765371828636_785.jfif',26,13,1,1,'2025-12-10 17:59:12.000','2025-12-10 18:03:49.000',NULL,NULL,NULL,NULL,NULL,1,NULL),
(23,'Naseeb Biryani','','200.00','/uploads/upload_1765443491610_160.jpg',12,8,1,1,'2025-12-11 13:58:12.000','2025-12-11 13:58:12.000',NULL,NULL,NULL,NULL,NULL,3,3),
(24,'Apple','Good Quality Apple by Fresh Market','250.00','/uploads/upload_1765448225011_433.jfif',4,1,5,1,'2025-12-11 15:17:05.000','2025-12-13 11:42:56.000',NULL,NULL,NULL,NULL,NULL,1,NULL),
(25,'Disprin','Disprin','10.00','/uploads/upload_1765463038433_680.jfif',28,16,5,1,'2025-12-11 19:23:58.000','2025-12-11 19:23:58.000',NULL,NULL,NULL,NULL,NULL,3,NULL),
(26,'Milk','Pure','200.00','',29,17,20,1,'2025-12-12 08:41:13.000','2025-12-12 08:41:13.000',NULL,NULL,NULL,NULL,NULL,1,NULL),
(27,'Milk','Pure','200.00','',29,17,20,1,'2025-12-12 08:41:13.000','2025-12-12 08:41:13.000',NULL,NULL,NULL,NULL,NULL,1,NULL),
(28,'Milk','Pure','200.00','',29,17,20,1,'2025-12-12 08:41:13.000','2025-12-12 08:41:13.000',NULL,NULL,NULL,NULL,NULL,1,NULL),
(29,'Milk','Pure','200.00','',29,17,20,1,'2025-12-12 08:41:13.000','2025-12-12 08:41:13.000',NULL,NULL,NULL,NULL,NULL,1,NULL),
(30,'Milk','Pure','200.00','',29,17,20,1,'2025-12-12 08:41:13.000','2025-12-12 08:41:13.000',NULL,NULL,NULL,NULL,NULL,1,NULL),
(31,'Milk','Pure','200.00','/uploads/upload_1765510872561_805.jpg',29,17,20,1,'2025-12-12 08:41:13.000','2025-12-12 08:41:13.000',NULL,NULL,NULL,NULL,NULL,1,NULL),
(32,'Milk','Pure','200.00','/uploads/upload_1765510872781_827.jpg',29,17,20,1,'2025-12-12 08:41:13.000','2025-12-12 08:41:13.000',NULL,NULL,NULL,NULL,NULL,1,NULL),
(33,'Milk','Pure','200.00','/uploads/upload_1765510873003_784.jpg',29,17,20,1,'2025-12-12 08:41:13.000','2025-12-12 08:41:13.000',NULL,NULL,NULL,NULL,NULL,1,NULL),
(34,'Milk','Pure','200.00','/uploads/upload_1765510873114_957.jpg',29,17,20,1,'2025-12-12 08:41:13.000','2025-12-12 08:41:13.000',NULL,NULL,NULL,NULL,NULL,1,NULL),
(35,'Milk','Pure','200.00','/uploads/upload_1765510873206_77.jpg',29,17,20,1,'2025-12-12 08:41:13.000','2025-12-12 08:41:13.000',NULL,NULL,NULL,NULL,NULL,1,NULL),
(36,'Milk','Pure','200.00','/uploads/upload_1765510873226_934.jpg',29,17,20,1,'2025-12-12 08:41:13.000','2025-12-12 08:41:13.000',NULL,NULL,NULL,NULL,NULL,1,NULL),
(37,'Milk','Pure','200.00','/uploads/upload_1765510873364_554.jpg',29,17,20,1,'2025-12-12 08:41:13.000','2025-12-12 08:41:13.000',NULL,NULL,NULL,NULL,NULL,1,NULL),
(38,'Milk','Pure','200.00','/uploads/upload_1765510873448_472.jpg',29,17,20,1,'2025-12-12 08:41:14.000','2025-12-12 08:41:14.000',NULL,NULL,NULL,NULL,NULL,1,NULL),
(39,'Milk','Pure','200.00','/uploads/upload_1765510873444_775.jpg',29,17,20,1,'2025-12-12 08:41:14.000','2025-12-12 08:41:14.000',NULL,NULL,NULL,NULL,NULL,1,NULL),
(40,'Milk','Pure','200.00','/uploads/upload_1765510873450_296.jpg',29,17,20,1,'2025-12-12 08:41:14.000','2025-12-12 08:41:14.000',NULL,NULL,NULL,NULL,NULL,1,NULL),
(41,'Dahi','Pure','200.00','/uploads/upload_1765602247535_657.jfif',30,17,25,1,'2025-12-13 10:04:07.000','2025-12-13 10:04:07.000',NULL,NULL,NULL,NULL,NULL,1,NULL);

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
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `riders` (`id`, `first_name`, `last_name`, `email`, `phone`, `password`, `vehicle_type`, `license_number`, `is_available`, `is_active`, `created_at`, `updated_at`) VALUES
(1,'Ahmed','Khan','ahmed.rider@servenow.pk','+1234567894','rider123','Motorcycle','LIC123456',1,1,'2025-11-30 20:48:32.000','2025-12-13 00:36:12.000'),
(2,'Fatima','Ali','fatima.rider@servenow.pk','+1234567895','rider456','Bicycle','LIC123457',1,1,'2025-11-30 20:48:32.000','2025-12-01 15:18:18.000'),
(3,'Omar','Hassan','omar.rider@servenow.pk','+1234567896','rider789','Scooter','LIC123458',1,0,'2025-11-30 20:48:32.000','2025-12-08 10:53:26.000'),
(4,'Aqeel','Rehman','aaqueel@gmail.com','03214424625','$2a$10$ZsliHvLJC.VG2B9xVgvH.O/jDg.lDctdxkQXCcUihH1Qgm6P/QbI.','Motorcycle','12365423',1,1,'2025-12-03 02:19:25.000','2025-12-03 02:19:25.000'),
(5,'Kashif','Bilal','Kashif@serve.pk','03014178380','$2a$10$.wlf9VayYL4AD2HTFymeYuB0Va4Q/ixUFx72eKkLCexgBgyQHPlvG','Motorcycle','MNV123',1,1,'2025-12-11 14:21:09.000','2025-12-11 14:21:09.000');

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

DROP TABLE IF EXISTS `sizes`;
CREATE TABLE `sizes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `label` varchar(50) NOT NULL,
  `description` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `sizes` (`id`, `label`, `description`, `created_at`) VALUES
(1,'Small','Small size / portion','2025-12-10 17:00:58.000'),
(2,'Medium','Medium size / portion','2025-12-10 17:00:58.000'),
(3,'Large','Large size / portion','2025-12-10 17:00:58.000'),
(4,'Extra Large','Extra Large Size / Portion','2025-12-10 22:03:38.000'),
(5,'XL','Extra Large','2025-12-11 11:49:31.000'),
(11,'1kg','Kilogram/Portion','2025-12-11 14:29:20.000');

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
  PRIMARY KEY (`id`),
  KEY `owner_id` (`owner_id`),
  KEY `idx_stores_category_id` (`category_id`),
  CONSTRAINT `fk_stores_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `stores_ibfk_1` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=20 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `stores` (`id`, `name`, `description`, `location`, `latitude`, `longitude`, `rating`, `delivery_time`, `phone`, `email`, `address`, `owner_id`, `is_active`, `created_at`, `updated_at`, `opening_time`, `closing_time`, `min_order_value`, `base_delivery_fee`, `cover_image`, `category_id`, `delivery_zones`, `supports_pickup`, `supports_preorder`, `is_open`, `holiday_mode`, `tags`, `owner_name`) VALUES
(1,'Fresh Market','Fresh ','Downtown','40.71280000','-74.00600000','4.50','30-45 mins','+1234567891','fresh@market.com','25-B',1,1,'2025-11-30 20:48:32.000','2025-12-13 00:15:27.000','11:00:00','23:00:00',NULL,'0.00','/uploads/store_upload_1765566927325_64.png',18,NULL,1,0,NULL,0,NULL,'OneNetSol'),
(2,'Green Grocery',NULL,'Midtown','40.75890000','-73.98510000','4.20','25-40 mins','+1234567892','green@grocery.com',NULL,1,1,'2025-11-30 20:48:32.000','2025-12-08 21:43:12.000',NULL,NULL,NULL,'0.00',NULL,NULL,NULL,1,0,NULL,0,NULL,NULL),
(3,'Al Nadeem Pharmacy','ttt','Brooklyn','40.67820000','-73.94420000','4.70','35-50 mins','+1234567893','local@foods.com','sss',1,1,'2025-11-30 20:48:32.000','2025-12-12 23:56:28.000','10:00:00','22:00:00',NULL,'0.00','/uploads/store_upload_1765565788439_218.png',18,NULL,1,0,NULL,0,NULL,NULL),
(4,'Bao Jee Gernal Store Kotaddu','Good taste ','Railway Road',NULL,NULL,'0.00','45','0300','ab526wyhs@gmail.com','Railway Station',4,1,'2025-12-03 08:04:29.000','2025-12-08 21:43:12.000',NULL,NULL,NULL,'0.00',NULL,NULL,NULL,1,0,NULL,0,NULL,NULL),
(5,'Al Sheikh Pharmacy Kotaddu','12','Thana Chowk',NULL,NULL,'0.00','45','032311','gjhljhg@gmail.com','Thana Chowk Kotaddu',4,1,'2025-12-03 13:43:32.000','2025-12-08 21:43:12.000',NULL,NULL,NULL,'0.00',NULL,NULL,NULL,1,0,NULL,0,NULL,NULL),
(6,'Ali Grocery store Kotaddu','Best Items','Noor Shah Chowk',NULL,NULL,'0.00','35','1275454','gasgsgh@gmail.com','Noor Shah Chowk Kotaddu ',4,1,'2025-12-03 13:58:12.000','2025-12-08 21:43:12.000',NULL,NULL,NULL,'0.00',NULL,NULL,NULL,1,0,NULL,0,NULL,NULL),
(7,'Naseeb Biryani','','Railway Road',NULL,NULL,'0.00','25 sy 30 mnt','03186009659','Naseeb@servenow.pk','Railway road kot addu',4,1,'2025-12-08 01:04:51.000','2025-12-11 14:01:39.000','08:00:00','20:00:00',NULL,'0.00',NULL,NULL,NULL,1,0,NULL,0,NULL,NULL),
(8,'Naseeb Biryani','Tasty','Railway Road',NULL,NULL,'0.00','25 sy 30 mnt','03186009659','Naseeb@servenow.pk','Railway Road Kot Addu',4,1,'2025-12-08 01:08:00.000','2025-12-08 21:43:12.000',NULL,NULL,NULL,'0.00',NULL,NULL,NULL,1,0,NULL,0,NULL,NULL),
(9,'Mehtab Halwa Puri','DES','Thana Chowk',NULL,NULL,'0.00','35','032311','jshksj@gmail.com','ADD',4,1,'2025-12-08 09:57:14.000','2025-12-08 21:43:12.000',NULL,NULL,NULL,'0.00',NULL,NULL,NULL,1,0,NULL,0,NULL,NULL),
(10,'TEST','Test','test',NULL,NULL,'0.00','50','+923334444555','123@servenow.pk','Aziz',4,1,'2025-12-08 18:45:26.000','2025-12-08 21:43:12.000','08:00:00','22:00:00',NULL,'0.00',NULL,NULL,NULL,1,0,NULL,0,NULL,NULL),
(11,'ONENET','BEST PARATHE','ZEESHAN GARMENTS',NULL,NULL,'0.00','40 MIN','32122222222','admin@servenow.com','LAHROE',1,1,'2025-12-08 21:40:06.000','2025-12-08 21:43:12.000','09:00:00','22:00:00',NULL,'0.00',NULL,NULL,NULL,1,0,NULL,0,NULL,NULL),
(12,'Dawood Halwa Puri','Fantastic Taste','Chota Bazar',NULL,NULL,'0.00','35','032155852','dhadjhak@gmail.com','Chota Bazar Kotaddu',4,1,'2025-12-10 15:18:30.000','2025-12-12 22:42:06.000',NULL,NULL,NULL,'0.00',NULL,NULL,NULL,1,0,NULL,0,NULL,NULL),
(13,'Pakeeza Karahi Goshat','Best Taste','NearHospital',NULL,NULL,'0.00','45-50','2316546','jioj@gmail.com','Near Hospital Kotaddu',4,1,'2025-12-10 17:53:55.000','2025-12-12 22:42:06.000','12:00:00','02:00:00',NULL,'0.00',NULL,NULL,NULL,1,0,NULL,0,NULL,NULL),
(14,'Karachi Naseeb Biryani','','Railway Road',NULL,NULL,'0.00','25 sy 30 mnt','03186009659','nazirahmed@servenow.pk','Kali pull Kot Addu',4,1,'2025-12-11 14:04:37.000','2025-12-12 22:42:06.000','08:00:00','20:00:00',NULL,'0.00','/uploads/store_upload_1765505163585_508.jpeg',NULL,NULL,1,0,NULL,0,NULL,NULL),
(15,'Fresh Fruit','adjfjads','Lahore- Sabzi Mandi',NULL,NULL,'0.00','45 to 50 Mints','03214444444','nazir2@servenow.pk','fdfdf',4,1,'2025-12-11 15:21:08.000','2025-12-12 22:42:06.000','10:00:00','22:00:00',NULL,'0.00',NULL,NULL,NULL,1,0,NULL,0,NULL,NULL),
(16,'Zeeshan Pharmacy Kotaddu','Good Medicines','Thana Chowk',NULL,NULL,'0.00','25-45','03214666566465644','ghfgfgf@gmail.com','Thana Chowk',4,1,'2025-12-11 19:18:30.000','2025-12-12 22:42:06.000','10:00:00','22:00:00',NULL,'0.00',NULL,NULL,NULL,1,0,NULL,0,NULL,NULL),
(17,'Shafiq Milk Merchant','Pure Products','Chowk Noor Shah',NULL,NULL,'0.00','35-45','0321444646','abcd@gmail.com','Bukkhi Road ',4,1,'2025-12-12 08:39:00.000','2025-12-12 22:42:06.000','05:00:00','18:00:00',NULL,'0.00','/uploads/store_upload_1765510740211_400.jpg',NULL,NULL,1,0,NULL,0,NULL,NULL),
(19,'Serve Fruits','Best Food','Railway Road',NULL,NULL,'0.00','30-45','+923004722231','jeero.sahib@gmail.com','Railway Road',4,1,'2025-12-13 10:29:45.000','2025-12-13 10:29:45.000','08:00:00','12:00:00',NULL,NULL,'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT_udc1KZkWBSvGz8Iuk99s-RSomLNlfa2WnA&s',31,NULL,1,0,NULL,0,NULL,'Nazir Ahmed');

DROP TABLE IF EXISTS `units`;
CREATE TABLE `units` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `abbreviation` varchar(10) DEFAULT NULL,
  `multiplier` decimal(10,4) DEFAULT 1.0000,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `units` (`id`, `name`, `abbreviation`, `multiplier`, `created_at`) VALUES
(1,'Kilogram','kg','1.0000','2025-12-10 17:00:58.000'),
(2,'Gram','g','0.0010','2025-12-10 17:00:58.000'),
(3,'Piece','pc','1.0000','2025-12-10 17:00:58.000'),
(4,'Liter','L','1.0000','2025-12-10 17:00:58.000');

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
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `users` (`id`, `first_name`, `last_name`, `email`, `phone`, `password`, `address`, `user_type`, `is_active`, `created_at`, `updated_at`) VALUES
(1,'Admin','User','admin@servenow.com','+1234567890','$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',NULL,'admin',1,'2025-11-30 20:48:32.000','2025-12-09 14:59:22.000'),
(2,'MCS','RWP','mcsrwp@gmail.com','03334488205','$2a$10$IAKAP2VIEQcdnXYeEJOMuOWxyN/PfPiWATC9NkrripeILCNfB5Q9.','83, The Mall, Lahore','customer',1,'2025-11-30 20:59:00.000','2025-12-09 14:59:26.000'),
(3,'user','pk','user@servenow.pk','+923334444555','$2a$10$Yi4rY2mS2UTVvVWgid5C.OxPqNeg5N3Rc6/g/LX5YXUbvpemzteN6','Aziz Avenuw','customer',1,'2025-12-01 15:28:34.000','2025-12-09 14:59:31.000'),
(4,'Nazir','Ahmed','nazirahmed@servenow.pk','+923213213213','$2a$10$3.Uc/2/qXzY2/T0xnINUeuK43vARuxbydmpke7prC9lPHAMOiL9N.','Model Town','admin',1,'2025-12-01 15:33:06.000','2025-12-09 15:01:29.000'),
(5,'User','11','user1@servenow.pk','+923214444555','$2a$10$5oYRfalThKPYy0FyFAijVuEO.yt9uJH8yLizMWXnXqnixk2cKI7fO','Lahore','customer',1,'2025-12-01 16:45:17.000','2025-12-09 14:59:36.000'),
(6,'Junaid','Javed','junaid@servenow.pk','+923211231231','$2a$10$/OT0Wt4IOk0gG7k2adU5qe7qXkxJo93oGhH9QQrZhJa.ZrmSeL5g2','Township','customer',1,'2025-12-01 22:36:26.000','2025-12-09 14:59:40.000'),
(7,'Fraz','Aziz','cfsdfsd@gmail.com','03186009659','$2a$10$FkSAIc/xbAmYIODBcYHJ1ejoWOGKCx5F2H0HKGBvbiSN1lKelEKnO','Kotaddu','admin',1,'2025-12-03 14:40:05.000','2025-12-09 14:59:43.000'),
(8,'Hamza','Ateeq','hamza@servenow.pk','0323252528','$2a$10$c1VAQakw1INlX7N6dKuUB.GS9NFhi4ErxC9zL9hNCu.2MmJzZ58UW','Manawan','admin',1,'2025-12-07 04:55:30.000','2025-12-07 04:55:30.000'),
(9,'Bilal','Aqeel','bilalaaqueel@gmail.com','+923334444556','$2a$10$h09vDuDLmdLU9sKOoaUkwewe9qNd6XqglANxzjePjfQ8IM8Rx2d2e','25-B, ARG4','customer',1,'2025-12-10 18:27:42.000','2025-12-10 18:32:15.000'),
(10,'Hafeez','Anjum','ghjhgh@gmail.com','6565654','$2a$10$iJTuXN3OeNopP//qPqmpFu89e3Ukt9Kv2k5DeHFwklrnuCx5ZB2vq','G T Road','customer',1,'2025-12-10 18:33:28.000','2025-12-10 18:33:28.000');

