<?php
session_start();
require_once 'config.php';

// Check if user is logged in and is admin
if (!isset($_SESSION['user_id']) || $_SESSION['user_type'] !== 'admin') {
    header('Location: login.php');
    exit();
}

// Handle logout
if (isset($_GET['logout'])) {
    session_destroy();
    header('Location: login.php');
    exit();
}

// Get dashboard statistics
try {
    $userCount = $pdo->query("SELECT COUNT(*) as count FROM users")->fetch()['count'];
    $storeCount = $pdo->query("SELECT COUNT(*) as count FROM stores")->fetch()['count'];
    $productCount = $pdo->query("SELECT COUNT(*) as count FROM products")->fetch()['count'];
    $orderCount = $pdo->query("SELECT COUNT(*) as count FROM orders")->fetch()['count'];
} catch (PDOException $e) {
    die("Database error: " . $e->getMessage());
}

// Handle tab switching and data loading
$activeTab = isset($_GET['tab']) ? $_GET['tab'] : 'dashboard';
$users = [];
$stores = [];
$products = [];
$orders = [];
$categories = [];

try {
    if ($activeTab === 'users') {
        $stmt = $pdo->query("SELECT id, first_name, last_name, email, user_type, is_active, created_at FROM users ORDER BY created_at DESC");
        $users = $stmt->fetchAll();
    } elseif ($activeTab === 'stores') {
        $stmt = $pdo->query("SELECT id, name, location, phone, email, rating, delivery_time, is_active FROM stores ORDER BY name");
        $stores = $stmt->fetchAll();
    } elseif ($activeTab === 'products') {
        $stmt = $pdo->query("SELECT p.id, p.name, p.price, p.stock_quantity, p.is_available, c.name as category_name, s.name as store_name FROM products p LEFT JOIN categories c ON p.category_id = c.id LEFT JOIN stores s ON p.store_id = s.id ORDER BY p.name");
        $products = $stmt->fetchAll();
    } elseif ($activeTab === 'orders') {
        $stmt = $pdo->query("SELECT o.id, o.order_number, o.total_amount, o.status, o.created_at, u.first_name, u.last_name, s.name as store_name FROM orders o JOIN users u ON o.user_id = u.id JOIN stores s ON o.store_id = s.id ORDER BY o.created_at DESC");
        $orders = $stmt->fetchAll();
    } elseif ($activeTab === 'categories') {
        $stmt = $pdo->query("SELECT id, name, description, is_active FROM categories ORDER BY name");
        $categories = $stmt->fetchAll();
    }
} catch (PDOException $e) {
    die("Database error: " . $e->getMessage());
}
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Dashboard - ServeNow</title>
    <link rel="stylesheet" href="css/style.css">
    <link rel="stylesheet" href="css/admin.css">
</head>
<body>
    <header>
        <nav>
            <div class="logo">
                <h1>ServeNow Admin</h1>
            </div>
            <ul>
                <li><a href="index.php">Back to Site</a></li>
                <li><a href="orders.php">Orders</a></li>
                <li><a href="?logout">Logout</a></li>
            </ul>
        </nav>
    </header>

    <main>
        <div class="admin-container">
            <aside class="admin-sidebar">
                <h3>Admin Panel</h3>
                <ul>
                    <li><a href="?tab=dashboard" class="<?php echo $activeTab === 'dashboard' ? 'active' : ''; ?>">Dashboard</a></li>
                    <li><a href="?tab=users" class="<?php echo $activeTab === 'users' ? 'active' : ''; ?>">Users</a></li>
                    <li><a href="?tab=stores" class="<?php echo $activeTab === 'stores' ? 'active' : ''; ?>">Stores</a></li>
                    <li><a href="?tab=products" class="<?php echo $activeTab === 'products' ? 'active' : ''; ?>">Products</a></li>
                    <li><a href="?tab=orders" class="<?php echo $activeTab === 'orders' ? 'active' : ''; ?>">Orders</a></li>
                    <li><a href="?tab=categories" class="<?php echo $activeTab === 'categories' ? 'active' : ''; ?>">Categories</a></li>
                </ul>
            </aside>

            <section class="admin-content">
                <?php if ($activeTab === 'dashboard'): ?>
                    <!-- Dashboard Tab -->
                    <div class="tab-content active">
                        <h2>Dashboard Overview</h2>
                        <div class="stats-grid">
                            <div class="stat-card">
                                <h3><?php echo $userCount; ?></h3>
                                <p>Total Users</p>
                            </div>
                            <div class="stat-card">
                                <h3><?php echo $storeCount; ?></h3>
                                <p>Total Stores</p>
                            </div>
                            <div class="stat-card">
                                <h3><?php echo $productCount; ?></h3>
                                <p>Total Products</p>
                            </div>
                            <div class="stat-card">
                                <h3><?php echo $orderCount; ?></h3>
                                <p>Total Orders</p>
                            </div>
                        </div>
                    </div>

                <?php elseif ($activeTab === 'users'): ?>
                    <!-- Users Tab -->
                    <div class="tab-content active">
                        <h2>Users Management</h2>
                        <div class="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>ID</th>
                                        <th>Name</th>
                                        <th>Email</th>
                                        <th>Type</th>
                                        <th>Status</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <?php foreach ($users as $user): ?>
                                    <tr>
                                        <td><?php echo $user['id']; ?></td>
                                        <td><?php echo htmlspecialchars($user['first_name'] . ' ' . $user['last_name']); ?></td>
                                        <td><?php echo htmlspecialchars($user['email']); ?></td>
                                        <td><?php echo htmlspecialchars($user['user_type']); ?></td>
                                        <td><span class="status-<?php echo $user['is_active'] ? 'active' : 'inactive'; ?>"><?php echo $user['is_active'] ? 'Active' : 'Inactive'; ?></span></td>
                                        <td>
                                            <button class="btn btn-small">Edit</button>
                                            <button class="btn btn-small btn-secondary">Toggle Status</button>
                                        </td>
                                    </tr>
                                    <?php endforeach; ?>
                                </tbody>
                            </table>
                        </div>
                    </div>

                <?php elseif ($activeTab === 'stores'): ?>
                    <!-- Stores Tab -->
                    <div class="tab-content active">
                        <h2>Stores Management</h2>
                        <div class="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>ID</th>
                                        <th>Name</th>
                                        <th>Location</th>
                                        <th>Rating</th>
                                        <th>Status</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <?php foreach ($stores as $store): ?>
                                    <tr>
                                        <td><?php echo $store['id']; ?></td>
                                        <td><?php echo htmlspecialchars($store['name']); ?></td>
                                        <td><?php echo htmlspecialchars($store['location']); ?></td>
                                        <td><?php echo $store['rating']; ?> ⭐</td>
                                        <td><span class="status-<?php echo $store['is_active'] ? 'active' : 'inactive'; ?>"><?php echo $store['is_active'] ? 'Active' : 'Inactive'; ?></span></td>
                                        <td>
                                            <button class="btn btn-small">Edit</button>
                                            <button class="btn btn-small btn-secondary">Toggle Status</button>
                                        </td>
                                    </tr>
                                    <?php endforeach; ?>
                                </tbody>
                            </table>
                        </div>
                    </div>

                <?php elseif ($activeTab === 'products'): ?>
                    <!-- Products Tab -->
                    <div class="tab-content active">
                        <h2>Products Management</h2>
                        <div class="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>ID</th>
                                        <th>Name</th>
                                        <th>Price</th>
                                        <th>Category</th>
                                        <th>Store</th>
                                        <th>Stock</th>
                                        <th>Status</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <?php foreach ($products as $product): ?>
                                    <tr>
                                        <td><?php echo $product['id']; ?></td>
                                        <td><?php echo htmlspecialchars($product['name']); ?></td>
                                        <td>$<?php echo number_format($product['price'], 2); ?></td>
                                        <td><?php echo htmlspecialchars($product['category_name'] ?? 'N/A'); ?></td>
                                        <td><?php echo htmlspecialchars($product['store_name'] ?? 'N/A'); ?></td>
                                        <td><?php echo $product['stock_quantity']; ?></td>
                                        <td><span class="status-<?php echo $product['is_available'] ? 'active' : 'inactive'; ?>"><?php echo $product['is_available'] ? 'Available' : 'Unavailable'; ?></span></td>
                                        <td>
                                            <button class="btn btn-small">Edit</button>
                                            <button class="btn btn-small btn-secondary">Toggle Status</button>
                                        </td>
                                    </tr>
                                    <?php endforeach; ?>
                                </tbody>
                            </table>
                        </div>
                    </div>

                <?php elseif ($activeTab === 'orders'): ?>
                    <!-- Orders Tab -->
                    <div class="tab-content active">
                        <h2>Orders Management</h2>
                        <div class="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Order #</th>
                                        <th>Customer</th>
                                        <th>Store</th>
                                        <th>Total</th>
                                        <th>Status</th>
                                        <th>Date</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <?php foreach ($orders as $order): ?>
                                    <tr>
                                        <td><?php echo htmlspecialchars($order['order_number']); ?></td>
                                        <td><?php echo htmlspecialchars($order['first_name'] . ' ' . $order['last_name']); ?></td>
                                        <td><?php echo htmlspecialchars($order['store_name']); ?></td>
                                        <td>$<?php echo number_format($order['total_amount'], 2); ?></td>
                                        <td><span class="status-<?php echo $order['status']; ?>"><?php echo ucfirst($order['status']); ?></span></td>
                                        <td><?php echo date('M d, Y', strtotime($order['created_at'])); ?></td>
                                        <td>
                                            <button class="btn btn-small">Update Status</button>
                                        </td>
                                    </tr>
                                    <?php endforeach; ?>
                                </tbody>
                            </table>
                        </div>
                    </div>

                <?php elseif ($activeTab === 'categories'): ?>
                    <!-- Categories Tab -->
                    <div class="tab-content active">
                        <h2>Categories Management</h2>
                        <div class="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>ID</th>
                                        <th>Name</th>
                                        <th>Description</th>
                                        <th>Status</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <?php foreach ($categories as $category): ?>
                                    <tr>
                                        <td><?php echo $category['id']; ?></td>
                                        <td><?php echo htmlspecialchars($category['name']); ?></td>
                                        <td><?php echo htmlspecialchars($category['description'] ?? ''); ?></td>
                                        <td><span class="status-<?php echo $category['is_active'] ? 'active' : 'inactive'; ?>"><?php echo $category['is_active'] ? 'Active' : 'Inactive'; ?></span></td>
                                        <td>
                                            <button class="btn btn-small">Edit</button>
                                            <button class="btn btn-small btn-secondary">Toggle Status</button>
                                        </td>
                                    </tr>
                                    <?php endforeach; ?>
                                </tbody>
                            </table>
                        </div>
                    </div>
                <?php endif; ?>
            </section>
        </div>
    </main>

    <footer>
        <p>&copy; 2023 ServeNow. All rights reserved.</p>
    </footer>
</body>
</html>
