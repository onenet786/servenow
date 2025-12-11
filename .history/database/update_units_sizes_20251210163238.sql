-- Migration: add units and sizes tables and link to products
USE servenow;

-- Create units table
CREATE TABLE IF NOT EXISTS units (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL,
    abbreviation VARCHAR(10),
    multiplier DECIMAL(10,4) DEFAULT 1.0000,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create sizes table
CREATE TABLE IF NOT EXISTS sizes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    label VARCHAR(50) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add references on products
ALTER TABLE products
    ADD COLUMN IF NOT EXISTS unit_id INT NULL,
    ADD COLUMN IF NOT EXISTS size_id INT NULL;

-- Add foreign keys (use IF NOT EXISTS logic by checking information_schema in client migrations if needed)
ALTER TABLE products
    ADD CONSTRAINT fk_products_unit FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_products_size FOREIGN KEY (size_id) REFERENCES sizes(id) ON DELETE SET NULL;

-- Insert some default units and sizes
INSERT INTO units (name, abbreviation, multiplier) VALUES
('Kilogram', 'kg', 1.0000),
('Gram', 'g', 0.0010),
('Piece', 'pc', 1.0000),
('Liter', 'L', 1.0000)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO sizes (label, description) VALUES
('Small', 'Small size / portion'),
('Medium', 'Medium size / portion'),
('Large', 'Large size / portion')
ON DUPLICATE KEY UPDATE label = VALUES(label);
