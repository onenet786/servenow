<?php
session_start();
require_once 'config.php';

// Get featured stores and categories for homepage
$stores = [];
$categories = [];

try {
    $stmt = $pdo->query("SELECT id, name, location, rating, delivery_time FROM stores WHERE is_active = 1 LIMIT 3");
    $stores = $stmt->fetchAll();

    $stmt = $pdo->query("SELECT id, name FROM categories WHERE is_active = 1 LIMIT 4");
    $categories = $stmt->fetchAll();
} catch (PDOException $e) {
    // Handle error silently for demo
}
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ServeNow - Grocery Delivery</title>
    <link rel="stylesheet" href="css/style.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>
<body>
    <header>
        <nav>
            <div class="logo">
                <h1>ServeNow</h1>
            </div>
            <ul>
                <li><a href="index.php"><i class="fas fa-home"></i> Home</a></li>
                <li><a href="stores.php"><i class="fas fa-store"></i> Stores</a></li>
                <li><a href="cart.php"><i class="fas fa-shopping-cart"></i> Cart <span id="cartCount">0</span></a></li>
                <?php if (isset($_SESSION['user_id'])): ?>
                    <li>Welcome <?php echo htmlspecialchars($_SESSION['user_name']); ?></li>
                    <li><a href="?logout">Logout</a></li>
                <?php else: ?>
                    <li><a href="login.php"><i class="fas fa-sign-in-alt"></i> Login</a></li>
                    <li><a href="register.php"><i class="fas fa-user-plus"></i> Register</a></li>
                <?php endif; ?>
            </ul>
        </nav>
    </header>

    <main>
        <section class="hero">
            <h2>Welcome to ServeNow</h2>
            <p>Get fresh groceries, cooked food, and household items delivered to your doorstep from registered stores near you.</p>
            <button onclick="getLocation()">Find Stores Near Me</button>
        </section>

        <section class="categories">
            <h3>Shop by Category</h3>
            <div class="category-grid">
                <?php
                $categoryImages = [
                    'vegetables' => 'https://via.placeholder.com/200x150/4CAF50/FFFFFF?text=Vegetables',
                    'cooked-food' => 'https://via.placeholder.com/200x150/FF9800/FFFFFF?text=Cooked+Food',
                    'household' => 'https://via.placeholder.com/200x150/2196F3/FFFFFF?text=Household',
                    'groceries' => 'https://via.placeholder.com/200x150/9C27B0/FFFFFF?text=Groceries'
                ];
                foreach ($categories as $category):
                ?>
                <div class="category-card">
                    <img src="<?php echo $categoryImages[strtolower(str_replace(' ', '-', $category['name']))] ?? 'https://via.placeholder.com/200x150/E0E0E0/666666?text=Category'; ?>" alt="<?php echo htmlspecialchars($category['name']); ?>">
                    <div class="category-card-content">
                        <h4><?php echo htmlspecialchars($category['name']); ?></h4>
                        <a href="products.php?category=<?php echo urlencode(strtolower(str_replace(' ', '-', $category['name']))); ?>">Shop Now</a>
                    </div>
                </div>
                <?php endforeach; ?>
            </div>
        </section>

        <section class="featured-stores">
            <h3>Featured Stores</h3>
            <div class="store-grid">
                <?php foreach ($stores as $store): ?>
                <div class="store-card">
                    <h4><?php echo htmlspecialchars($store['name']); ?></h4>
                    <p>Location: <?php echo htmlspecialchars($store['location']); ?></p>
                    <p>Rating: <?php echo $store['rating']; ?> ⭐</p>
                    <p>Delivery: <?php echo htmlspecialchars($store['delivery_time']); ?></p>
                    <a href="store.php?id=<?php echo $store['id']; ?>" class="btn btn-primary">View Store</a>
                </div>
                <?php endforeach; ?>
            </div>
        </section>
    </main>

    <footer>
        <p>&copy; 2023 ServeNow. All rights reserved.</p>
    </footer>

    <!-- Scroll to Top Button -->
    <button class="scroll-to-top" id="scrollToTop" onclick="window.scrollTo({top: 0, behavior: 'smooth'})">
        ↑
    </button>

    <script>
        // Scroll to Top functionality
        const scrollToTopBtn = document.getElementById('scrollToTop');

        window.addEventListener('scroll', function() {
            if (window.pageYOffset > 300) {
                scrollToTopBtn.classList.add('visible');
            } else {
                scrollToTopBtn.classList.remove('visible');
            }
        });

        function getLocation() {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(function(position) {
                    console.log(`User location: ${position.coords.latitude}, ${position.coords.longitude}`);
                    // In a real app, you would send this to your backend to find nearby stores
                    alert('Location detected! Loading nearby stores...');
                }, function(error) {
                    alert('Unable to get your location. Please allow location access.');
                });
            } else {
                alert("Geolocation is not supported by this browser.");
            }
        }

        // Handle logout
        <?php if (isset($_GET['logout'])): ?>
            <?php session_destroy(); ?>
            window.location.href = 'index.php';
        <?php endif; ?>
    </script>
</body>
</html>
