-- Insert sample orders for testing
USE servenow;

-- Insert a sample customer user (password: customer123)
INSERT INTO users (first_name, last_name, email, phone, password, address, user_type) VALUES
('John', 'Doe', 'john@example.com', '+1234567899', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '123 Main St, City', 'customer');

-- Insert sample orders for the customer
INSERT INTO orders (order_number, user_id, store_id, total_amount, delivery_fee, status, payment_method, delivery_address, created_at) VALUES
('ORD001', 2, 1, 25.97, 2.99, 'delivered', 'card', '123 Main St, City', NOW() - INTERVAL 2 DAY),
('ORD002', 2, 2, 18.98, 2.99, 'pending', 'cash', '123 Main St, City', NOW() - INTERVAL 1 DAY),
('ORD003', 2, 3, 15.97, 2.99, 'confirmed', 'wallet', '123 Main St, City', NOW());

-- Insert order items
INSERT INTO order_items (order_id, product_id, quantity, price) VALUES
(1, 1, 2, 3.99),  -- 2 Organic Tomatoes for order 1
(1, 2, 1, 2.49),  -- 1 Fresh Spinach for order 1
(1, 7, 1, 4.99),  -- 1 Dish Soap for order 1
(2, 3, 3, 1.99),  -- 3 Carrots for order 2
(2, 5, 1, 15.99), -- 1 Vegetable Pizza for order 2
(3, 4, 1, 12.99); -- 1 Chicken Biryani for order 3
