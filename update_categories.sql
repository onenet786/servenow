-- Update category images with local images
UPDATE categories SET image_url = '/images/vegetables.jpg' WHERE name = 'Vegetables';
UPDATE categories SET image_url = '/images/cooked-food.jpg' WHERE name = 'Cooked Food';

-- Add new categories with images
INSERT INTO categories (name, description, image_url) VALUES
('Burgers', 'Delicious burgers and sandwiches', '/images/burgers.jpg'),
('Pizza', 'Fresh and hot pizzas', '/images/pizza.jpg'),
('Desserts', 'Sweet treats and desserts', '/images/desserts.jpg');
