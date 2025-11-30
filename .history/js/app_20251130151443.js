// API Base URL
const API_BASE = window.location.origin;

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
    alert('Item added to cart!');
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
        cartTotal.textContent = `Total: $${total.toFixed(2)}`;
    }
}

// Location-based functionality
function getUserLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(showPosition, showError);
    } else {
        alert("Geolocation is not supported by this browser.");
    }
}

function showPosition(position) {
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;

    // In a real app, you would send this to your backend to find nearby stores
    console.log(`User location: ${latitude}, ${longitude}`);

    // For demo purposes, we'll just show all stores
    displayNearbyStores();
}

function showError(error) {
    switch(error.code) {
        case error.PERMISSION_DENIED:
            alert("User denied the request for Geolocation.");
            break;
        case error.POSITION_UNAVAILABLE:
            alert("Location information is unavailable.");
            break;
        case error.TIMEOUT:
            alert("The request to get user location timed out.");
            break;
        case error.UNKNOWN_ERROR:
            alert("An unknown error occurred.");
            break;
    }
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
                productCard.innerHTML = `
                    <img src="${product.image_url || 'images/placeholder.jpg'}" alt="${product.name}">
                    <div class="product-card-content">
                        <h4>${product.name}</h4>
                        <p class="price">$${product.price}</p>
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
            alert('Login successful!');

            // Redirect based on user type
            if (data.user.user_type === 'admin') {
                window.location.href = 'admin.html';
            } else {
                window.location.href = 'index.html';
            }
        } else {
            alert(data.message || 'Login failed');
        }
    } catch (error) {
        console.error('Login error:', error);
        alert('Login failed. Please try again.');
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
        alert('Passwords do not match');
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
            alert('Registration successful!');

            // Redirect based on user type
            if (data.user.user_type === 'admin') {
                window.location.href = 'admin.html';
            } else {
                window.location.href = 'index.html';
            }
        } else {
            alert(data.message || 'Registration failed');
        }
    } catch (error) {
        console.error('Registration error:', error);
        alert('Registration failed. Please try again.');
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

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    // Redirect to login if not authenticated
    const currentPage = window.location.pathname;
    const isLoginPage = currentPage.includes('login.html');
    const isRegisterPage = currentPage.includes('register.html');

    if (!localStorage.getItem('serveNowToken') && !isLoginPage && !isRegisterPage) {
        window.location.href = 'login.html';
        return;
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
                alert('Please fill in all required fields.');
            }
        });
    });
});
