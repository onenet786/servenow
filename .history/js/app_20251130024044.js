// Sample data - in a real app, this would come from a backend API
const stores = [
    {
        id: 1,
        name: "Fresh Market",
        location: "Downtown",
        latitude: 40.7128,
        longitude: -74.0060,
        rating: 4.5,
        deliveryTime: "30-45 mins"
    },
    {
        id: 2,
        name: "Green Grocery",
        location: "Midtown",
        latitude: 40.7589,
        longitude: -73.9851,
        rating: 4.2,
        deliveryTime: "25-40 mins"
    },
    {
        id: 3,
        name: "Local Foods",
        location: "Brooklyn",
        latitude: 40.6782,
        longitude: -73.9442,
        rating: 4.7,
        deliveryTime: "35-50 mins"
    }
];

const products = {
    vegetables: [
        { id: 1, name: "Organic Tomatoes", price: 3.99, image: "images/tomatoes.jpg", storeId: 1 },
        { id: 2, name: "Fresh Spinach", price: 2.49, image: "images/spinach.jpg", storeId: 1 },
        { id: 3, name: "Carrots", price: 1.99, image: "images/carrots.jpg", storeId: 2 }
    ],
    "cooked-food": [
        { id: 4, name: "Chicken Biryani", price: 12.99, image: "images/biryani.jpg", storeId: 3 },
        { id: 5, name: "Vegetable Pizza", price: 15.99, image: "images/pizza.jpg", storeId: 2 },
        { id: 6, name: "Grilled Chicken", price: 18.99, image: "images/grilled-chicken.jpg", storeId: 1 }
    ],
    household: [
        { id: 7, name: "Dish Soap", price: 4.99, image: "images/dish-soap.jpg", storeId: 1 },
        { id: 8, name: "Laundry Detergent", price: 8.99, image: "images/detergent.jpg", storeId: 2 },
        { id: 9, name: "Toilet Paper", price: 6.99, image: "images/toilet-paper.jpg", storeId: 3 }
    ],
    groceries: [
        { id: 10, name: "Milk", price: 3.49, image: "images/milk.jpg", storeId: 1 },
        { id: 11, name: "Bread", price: 2.99, image: "images/bread.jpg", storeId: 2 },
        { id: 12, name: "Rice", price: 5.99, image: "images/rice.jpg", storeId: 3 }
    ]
};

// Cart functionality
let cart = JSON.parse(localStorage.getItem('serveNowCart')) || [];

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
            <span class="cart-item-price">$${itemTotal.toFixed(2)}</span>
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

function displayNearbyStores() {
    const storeGrid = document.getElementById('featuredStores');
    if (!storeGrid) return;

    storeGrid.innerHTML = '';

    stores.forEach(store => {
        const storeCard = document.createElement('div');
        storeCard.className = 'store-card';
        storeCard.innerHTML = `
            <h4>${store.name}</h4>
            <p>Location: ${store.location}</p>
            <p>Rating: ${store.rating} ⭐</p>
            <p>Delivery: ${store.deliveryTime}</p>
            <a href="store.html?id=${store.id}" class="btn btn-primary">View Store</a>
        `;
        storeGrid.appendChild(storeCard);
    });
}

// Load products by category
function loadProducts(category) {
    const productGrid = document.getElementById('productGrid');
    if (!productGrid) return;

    const categoryProducts = products[category] || [];
    productGrid.innerHTML = '';

    categoryProducts.forEach(product => {
        const productCard = document.createElement('div');
        productCard.className = 'product-card';
        productCard.innerHTML = `
            <img src="${product.image}" alt="${product.name}">
            <div class="product-card-content">
                <h4>${product.name}</h4>
                <p class="price">$${product.price.toFixed(2)}</p>
                <button class="add-to-cart" onclick="addToCart(${product.id}, '${product.name}', ${product.price})">Add to Cart</button>
            </div>
        `;
        productGrid.appendChild(productCard);
    });
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
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
        form.addEventListener('submit', function(e) {
            if (!validateForm(form.id)) {
                e.preventDefault();
                alert('Please fill in all required fields.');
            }
        });
    });
});
