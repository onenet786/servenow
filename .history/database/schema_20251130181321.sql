-- ServeNow Database Schema
-- Create database
CREATE DATABASE IF NOT EXISTS servenow;
USE servenow;

-- Users table
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(20),
    password VARCHAR(255) NOT NULL,
    address TEXT,
    user_type ENUM('customer', 'store_owner', 'admin') DEFAULT 'customer',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Stores table
CREATE TABLE stores (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    location VARCHAR(100),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    rating DECIMAL(3, 2) DEFAULT 0.00,
    delivery_time VARCHAR(50),
    phone VARCHAR(20),
    email VARCHAR(100),
    address TEXT,
    owner_id INT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Categories table
CREATE TABLE categories (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL,
    description TEXT,
    image_url VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Products table
CREATE TABLE products (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    image_url VARCHAR(255),
    category_id INT,
    store_id INT NOT NULL,
    stock_quantity INT DEFAULT 0,
    is_available BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
);

-- Riders table
CREATE TABLE riders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(20),
    password VARCHAR(255) NOT NULL,
    vehicle_type VARCHAR(50),
    license_number VARCHAR(50),
    is_available BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Orders table
CREATE TABLE orders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_number VARCHAR(20) UNIQUE NOT NULL,
    user_id INT NOT NULL,
    store_id INT NOT NULL,
    rider_id INT,
    total_amount DECIMAL(10, 2) NOT NULL,
    delivery_fee DECIMAL(5, 2) DEFAULT 2.99,
    status ENUM('pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled') DEFAULT 'pending',
    rider_location TEXT,
    estimated_delivery_time TIMESTAMP,
    payment_method ENUM('card', 'cash', 'wallet') NOT NULL,
    payment_status ENUM('pending', 'paid', 'failed') DEFAULT 'pending',
    delivery_address TEXT NOT NULL,
    delivery_time VARCHAR(50),
    special_instructions TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
    FOREIGN KEY (rider_id) REFERENCES riders(id) ON DELETE SET NULL
);

-- Order items table
CREATE TABLE order_items (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Insert default categories
INSERT INTO categories (name, description) VALUES
('Vegetables', 'Fresh vegetables and greens'),
('Cooked Food', 'Ready-to-eat meals and cooked dishes'),
('Household', 'Household items and essentials'),
('Groceries', 'General grocery items');

-- Insert sample admin user (password: admin123)
INSERT INTO users (first_name, last_name, email, phone, password, user_type) VALUES
('Admin', 'User', 'admin@servenow.com', '+1234567890', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin');

-- Insert sample stores
INSERT INTO stores (name, location, latitude, longitude, rating, delivery_time, phone, email, owner_id) VALUES
('Fresh Market', 'Downtown', 40.7128, -74.0060, 4.5, '30-45 mins', '+1234567891', 'fresh@market.com', 1),
('Green Grocery', 'Midtown', 40.7589, -73.9851, 4.2, '25-40 mins', '+1234567892', 'green@grocery.com', 1),
('Local Foods', 'Brooklyn', 40.6782, -73.9442, 4.7, '35-50 mins', '+1234567893', 'local@foods.com', 1);

-- Insert sample products
INSERT INTO products (name, price, category_id, store_id, stock_quantity) VALUES
('Organic Tomatoes', 3.99, 1, 1, 50),
('Fresh Spinach', 2.49, 1, 1, 30),
('Carrots', 1.99, 1, 2, 40),
('Chicken Biryani', 12.99, 2, 3, 20),
('Vegetable Pizza', 15.99, 2, 2, 15),
('Grilled Chicken', 18.99, 2, 1, 25),
('Dish Soap', 4.99, 3, 1, 35),
('Laundry Detergent', 8.99, 3, 2, 20),
('Toilet Paper', 6.99, 3, 3, 50),
('Milk', 3.49, 4, 1, 30),
('Bread', 2.99, 4, 2, 40),
('Rice', 5.99, 4, 3, 60);

-- Insert sample riders
INSERT INTO riders (first_name, last_name, email, phone, password, vehicle_type, license_number) VALUES
('Ahmed', 'Khan', 'ahmed.rider@servenow.com', '+1234567894', 'rider123', 'Motorcycle', 'LIC123456'),
('Fatima', 'Ali', 'fatima.rider@servenow.com', '+1234567895', 'rider456', 'Bicycle', 'LIC123457'),
('Omar', 'Hassan', 'omar.rider@servenow.com', '+1234567896', 'rider789', 'Scooter', 'LIC123458');

-- Create indexes for better performance
CREATE INDEX idx_products_store_id ON products(store_id);
CREATE INDEX idx_products_category_id ON products(category_id);
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_store_id ON orders(store_id);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
