<?php
session_start();
require_once 'config.php';

// Check if user is already logged in
if (isset($_SESSION['user_id'])) {
    header('Location: dashboard.php');
    exit();
}

$message = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $email = trim($_POST['email']);
    $password = $_POST['password'];

    if (empty($email) || empty($password)) {
        $message = 'Please fill in all fields';
    } else {
        try {
            $stmt = $pdo->prepare("SELECT id, first_name, last_name, email, password, user_type, is_active FROM users WHERE email = ?");
            $stmt->execute([$email]);
            $user = $stmt->fetch(PDO::FETCH_ASSOC);

            if ($user && password_verify($password, $user['password'])) {
                if ($user['is_active']) {
                    // Set session variables
                    $_SESSION['user_id'] = $user['id'];
                    $_SESSION['user_name'] = $user['first_name'] . ' ' . $user['last_name'];
                    $_SESSION['user_email'] = $user['email'];
                    $_SESSION['user_type'] = $user['user_type'];

                    // Redirect based on user type
                    if ($user['user_type'] === 'admin') {
                        header('Location: admin.php');
                    } elseif ($user['user_type'] === 'rider') {
                        header('Location: rider.php');
                    } else {
                        header('Location: index.php');
                    }
                    exit();
                } else {
                    $message = 'Account is deactivated';
                }
            } else {
                $message = 'Invalid email or password';
            }
        } catch (PDOException $e) {
            $message = 'Database error occurred';
        }
    }
}
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login - ServeNow</title>
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
                <li><a href="login.php"><i class="fas fa-sign-in-alt"></i> Login</a></li>
                <li><a href="register.php"><i class="fas fa-user-plus"></i> Register</a></li>
            </ul>
        </nav>
    </header>

    <main>
        <section class="login-form">
            <h2>Login to ServeNow</h2>
            <?php if ($message): ?>
                <div class="alert alert-error"><?php echo htmlspecialchars($message); ?></div>
            <?php endif; ?>
            <form method="post" action="">
                <div class="form-group">
                    <label for="email">Email Address:</label>
                    <input type="email" id="email" name="email" required value="<?php echo isset($_POST['email']) ? htmlspecialchars($_POST['email']) : ''; ?>">
                </div>

                <div class="form-group">
                    <label for="password">Password:</label>
                    <input type="password" id="password" name="password" required>
                </div>

                <button type="submit" class="btn btn-primary">Login</button>
            </form>

            <p>Don't have an account? <a href="register.php">Register here</a></p>
            <p><small><strong>Rider Login:</strong> ahmed.rider@servenow.com / rider123</small></p>
            <p><small><strong>Admin Login:</strong> admin@servenow.com / admin123</small></p>
        </section>
    </main>

    <footer>
        <p>&copy; 2023 ServeNow. All rights reserved.</p>
    </footer>
</body>
</html>
