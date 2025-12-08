// API Base URL - dynamically determine based on current location
const API_BASE = window.location.protocol + '//' + window.location.host;

// Toast Notification System
function showToast(title, message, type = 'info', duration = 3000) {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toastId = 'toast-' + Date.now();
    const toast = document.createElement('div');
    toast.id = toastId;
    toast.className = `toast ${type} slideIn`;
    toast.innerHTML = `
        <div class="toast-icon">
            ${type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warning' ? '!' : 'ℹ'}
        </div>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close" onclick="document.getElementById('${toastId}').remove()">×</button>
        <div class="toast-progress" style="animation: progressBar ${duration}ms linear forwards;"></div>
    `;
    container.appendChild(toast);

    setTimeout(() => {
        const elem = document.getElementById(toastId);
        if (elem) {
            elem.classList.remove('slideIn');
            elem.classList.add('slideOut');
            setTimeout(() => elem.remove(), 300);
        }
    }, duration);
}

function showSuccess(title, message, duration = 3000) {
    showToast(title, message, 'success', duration);
}

function showError(title, message, duration = 3000) {
    showToast(title, message, 'error', duration);
}

function showWarning(title, message, duration = 3000) {
    showToast(title, message, 'warning', duration);
}

function showInfo(title, message, duration = 3000) {
    showToast(title, message, 'info', duration);
}

// Authentication state
let currentUser = null;
let authToken = localStorage.getItem('serveNowToken');

// Cart functionality
var cart = JSON.parse(localStorage.getItem('serveNowCart')) || [];

function updateCartCount() {
    const cartCount = document.getElementById('cartCount');
    if (cartCount) {
        cartCount.textContent = cart.length;
    }
}

function addToCart(productId, productName, price) {
    const existingItem = cart.find(item => item.id === productId);
    if (existingItem) {
        existingItem.quantity += 1;
    } else {
        cart.push({
            id: productId,
            name: productName,
            price: price,
            quantity: 1
        });
    }
    localStorage.setItem('serveNowCart', JSON.stringify(cart));
    updateCartCount();
    showSuccess('Added to Cart', 'Item added to cart successfully!');
}

function removeFromCart(productId) {
    cart = cart.filter(item => item.id !== productId);
    localStorage.setItem('serveNowCart', JSON.stringify(cart));
    updateCartCount();
    displayCart();
}

function displayCart() {
    const cartContainer = document.getElementById('cartItems');
    const cartTotal = document.getElementById('cartTotal');

    if (!cartContainer) return;

    cartContainer.innerHTML = '';
    let total = 0;

    cart.forEach(item => {
        const itemTotal = item.price * item.quantity;
        total += itemTotal;

        const itemElement = document.createElement('div');
        itemElement.className = 'cart-item';
        itemElement.innerHTML = `
            <div class="cart-item-info">
                <h4>${item.name}</h4>
                <p>Quantity: ${item.quantity}</p>
            </div>
                        <span class="cart-item-price">PKR ${itemTotal.toFixed(2)}</span>
            <button class="cart-item-remove" onclick="removeFromCart(${item.id})">Remove</button>
        `;
        cartContainer.appendChild(itemElement);
    });

    if (cartTotal) {
        cartTotal.textContent = `Total: PKR ${total.toFixed(2)}`;
    }
}

// Location-based functionality
function getUserLocation() {
    if (!navigator.geolocation) {
        showInfo('Geolocation Unavailable', 'Geolocation is not supported by this browser.');
        return;
    }

    // Show loading state
    const locationBtn = document.getElementById('getLocation');
    if (locationBtn) {
        locationBtn.textContent = 'Getting location...';
        locationBtn.disabled = true;
    }

    navigator.geolocation.getCurrentPosition(
        showPosition,
        showError,
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 300000 // 5 minutes
        }
    );
}

function showPosition(position) {
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;

    console.log(`User location: ${latitude}, ${longitude}`);

    // Reset button state
    const locationBtn = document.getElementById('getLocation');
    if (locationBtn) {
        locationBtn.textContent = 'Stores Found!';
        locationBtn.disabled = false;
        setTimeout(() => {
            locationBtn.textContent = 'Find Stores Near Me';
        }, 2000);
    }

    // In a real app, you would send this to your backend to find nearby stores
    // For now, we'll just show all stores with a success message
    displayNearbyStores();
}

function showError(error) {
    // Reset button state
    const locationBtn = document.getElementById('getLocation');
    if (locationBtn) {
        locationBtn.textContent = 'Find Stores Near Me';
        locationBtn.disabled = false;
    }

    let errorMessage = "Location access failed: ";
    switch(error.code) {
        case error.PERMISSION_DENIED:
            errorMessage += "Please enable location permissions in your browser settings.";
            break;
        case error.POSITION_UNAVAILABLE:
            errorMessage += "Location information is unavailable.";
            break;
        case error.TIMEOUT:
            errorMessage += "Location request timed out. Please try again.";
            break;
        case error.UNKNOWN_ERROR:
            errorMessage += "An unknown error occurred.";
            break;
    }
    showError('Error', errorMessage);
}

async function displayNearbyStores() {
    const storeGrid = document.getElementById('featuredStores');
    if (!storeGrid) return;

    try {
        const response = await fetch(`${API_BASE}/api/stores`);
        const data = await response.json();

        if (data.success) {
            storeGrid.innerHTML = '';

            data.stores.slice(0, 3).forEach(store => {
                const storeCard = document.createElement('div');
                storeCard.className = 'store-card';
                storeCard.innerHTML = `
                    <h4>${store.name}</h4>
                    <p>Location: ${store.location}</p>
                    <p>Rating: ${store.rating} ⭐</p>
                    <p>Delivery: ${store.delivery_time}</p>
                    <a href="store.html?id=${store.id}" class="btn btn-primary">View Store</a>
                `;
                storeGrid.appendChild(storeCard);
            });
        }
    } catch (error) {
        console.error('Error loading stores:', error);
        storeGrid.innerHTML = '<p>Unable to load stores at this time.</p>';
    }
}

// Load products by category
async function loadProducts(category) {
    const productGrid = document.getElementById('productGrid');
    const categoryTitle = document.getElementById('categoryTitle');
    if (!productGrid) return;

    // Update the page title
    if (categoryTitle) {
        const formattedCategory = category.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        categoryTitle.textContent = formattedCategory;
    }

    try {
        const response = await fetch(`${API_BASE}/api/products?category=${category}`);
        const data = await response.json();

        if (data.success) {
            productGrid.innerHTML = '';

            data.products.forEach(product => {
                const productCard = document.createElement('div');
                productCard.className = 'product-card';

                // Normalize image URL: if it's a relative path, prefix with API_BASE
                let imageSrc = 'https://via.placeholder.com/200x150/E0E0E0/666666?text=No+Image';
                if (product.image_url) {
                    const url = product.image_url.trim();
                    if (/^https?:\/\//i.test(url) || url.startsWith('/')) {
                        imageSrc = url;
                    } else {
                        imageSrc = API_BASE.replace(/\/$/, '') + '/' + url.replace(/^\/+/, '');
                    }
                }

                productCard.innerHTML = `
                    <img src="${imageSrc}" alt="${product.name}">
                    <div class="product-card-content">
                        <h4>${product.name}</h4>
                        <p class="price">PKR ${product.price}</p>
                        <button class="add-to-cart" onclick="addToCart(${product.id}, '${product.name}', ${product.price})">Add to Cart</button>
                    </div>
                `;
                productGrid.appendChild(productCard);
            });
        }
    } catch (error) {
        console.error('Error loading products:', error);
        productGrid.innerHTML = '<p>Unable to load products at this time.</p>';
    }
}

// Authentication functions
async function handleLogin(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    const loginData = {
        email: formData.get('email'),
        password: formData.get('password')
    };

    try {
        const response = await fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(loginData)
        });

        const data = await response.json();

        if (data.success) {
            localStorage.setItem('serveNowToken', data.token);
            localStorage.setItem('serveNowUser', JSON.stringify(data.user));
            currentUser = data.user;
            showSuccess('Login Successful', 'Logged in successfully!');

            // Redirect based on user type
            if (data.user.user_type === 'admin') {
                window.location.href = 'admin.html';
            } else if (data.user.user_type === 'rider') {
                window.location.href = 'rider.html';
            } else {
                window.location.href = 'index.html';
            }
        } else {
            showError('Login Failed', data.message || 'Login failed. Please try again.');
        }
    } catch (error) {
        console.error('Login error:', error);
        showError('Error', 'Login failed. Please try again.');
    }
}

async function handleRegister(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    const registerData = {
        firstName: formData.get('firstName'),
        lastName: formData.get('lastName'),
        email: formData.get('email'),
        phone: formData.get('phone'),
        address: formData.get('address'),
        password: formData.get('password'),
        userType: formData.get('userType') || 'customer'
    };

    // Validate password confirmation
    if (registerData.password !== formData.get('confirmPassword')) {
        showWarning('Invalid Password', 'Passwords do not match');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/auth/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(registerData)
        });

        const data = await response.json();

        if (data.success) {
            localStorage.setItem('serveNowToken', data.token);
            localStorage.setItem('serveNowUser', JSON.stringify(data.user));
            currentUser = data.user;
            showSuccess('Registration Successful', 'Registration successful!');

            // Redirect based on user type
            if (data.user.user_type === 'admin') {
                window.location.href = 'admin.html';
            } else {
                window.location.href = 'index.html';
            }
        } else {
            showError('Registration Failed', data.message || 'Registration failed. Please try again.');
        }
    } catch (error) {
        console.error('Registration error:', error);
        showError('Error', 'Registration failed. Please try again.');
    }
}

// Form validation
function validateForm(formId) {
    const form = document.getElementById(formId);
    if (!form) return false;

    const inputs = form.querySelectorAll('input[required], select[required], textarea[required]');
    let isValid = true;

    inputs.forEach(input => {
        if (!input.value.trim()) {
            input.style.borderColor = 'red';
            isValid = false;
        } else {
            input.style.borderColor = '#ddd';
        }
    });

    return isValid;
}

function logout() {
    localStorage.clear();
    window.location.href = 'login.html';
}

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    // Redirect to login if not authenticated
    const currentPage = window.location.pathname;
    const isLoginPage = currentPage.includes('login.html');
    const isRegisterPage = currentPage.includes('register.html');

    const token = localStorage.getItem('serveNowToken');
    if (!token && !isLoginPage && !isRegisterPage) {
        window.location.href = 'login.html';
        return;
    }

    // Hide Home/Stores/Cart navigation on login page
    if (isLoginPage) {
        const navUl = document.querySelector('nav ul');
        if (navUl) {
            // Keep only non-navigation items (like login/register links if they exist)
            const listItems = navUl.querySelectorAll('li');
            listItems.forEach(item => {
                const link = item.querySelector('a');
                if (link) {
                    const href = link.getAttribute('href');
                    // Hide Home, Stores, Cart links
                    if (href && (href.includes('index.html') || href.includes('stores.html') || href.includes('cart.html'))) {
                        item.style.display = 'none';
                    }
                }
            });
        }
    }
    // Update nav if logged in - only for customers
    else if (token) {
        const userData = localStorage.getItem('serveNowUser');
        if (userData) {
            try {
                const user = JSON.parse(userData);
                // Only update navigation for customers, not for riders or admins
                if (user.user_type === 'customer') {
                    const navUl = document.querySelector('nav ul');
                    if (navUl) {
                        navUl.innerHTML = `
                            <li><a href="index.html"><i class="fas fa-home"></i> Home</a></li>
                            <li><a href="stores.html"><i class="fas fa-store"></i> Stores</a></li>
                            <li><a href="cart.html"><i class="fas fa-shopping-cart"></i> Cart <span id="cartCount">0</span></a></li>
                            <li>Welcome ${user.first_name}</li>
                            <li><a href="#" onclick="logout()">Logout</a></li>
                        `;
                    }
                }
            } catch (error) {
                console.error('Error parsing user data:', error);
            }
        }
    }

    updateCartCount();

    // Get location button
    const getLocationBtn = document.getElementById('getLocation');
    if (getLocationBtn) {
        getLocationBtn.addEventListener('click', getUserLocation);
    }

    // Load products if on products page
    const urlParams = new URLSearchParams(window.location.search);
    const category = urlParams.get('category');
    if (category) {
        loadProducts(category);
    }

    // Display cart if on cart page
    if (document.getElementById('cartItems')) {
        displayCart();
    }

    // Display featured stores on homepage
    if (document.getElementById('featuredStores')) {
        displayNearbyStores();
    }

    // Form submission
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');

    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    if (registerForm) {
        registerForm.addEventListener('submit', handleRegister);
    }

    // Other forms
    const otherForms = document.querySelectorAll('form:not(#loginForm):not(#registerForm)');
    otherForms.forEach(form => {
        form.addEventListener('submit', function(e) {
            if (!validateForm(form.id)) {
                e.preventDefault();
                showWarning('Incomplete Form', 'Please fill in all required fields.');
            }
        });
    });
});
