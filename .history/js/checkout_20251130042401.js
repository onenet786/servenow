// Cart functionality
let cart = JSON.parse(localStorage.getItem('serveNowCart')) || [];

function updateCartCount() {
    const cartCount = document.getElementById('cartCount');
    if (cartCount) {
        cartCount.textContent = cart.length;
    }
}

// Display cart items in checkout
function displayCheckoutItems() {
    const checkoutItems = document.getElementById('checkoutItems');
    const checkoutTotal = document.getElementById('checkoutTotal');

    console.log('Displaying checkout items, cart:', cart);
    if (!checkoutItems) return;

    checkoutItems.innerHTML = '';
    let total = 0;

    cart.forEach(item => {
        console.log('Item:', item);
        const itemTotal = parseFloat(item.price) * item.quantity;
        console.log('Item total:', itemTotal);
        total += itemTotal;

        const itemElement = document.createElement('div');
        itemElement.className = 'checkout-item';
        itemElement.innerHTML = `
            <span>${item.name} x ${item.quantity}</span>
            <span>$${itemTotal.toFixed(2)}</span>
        `;
        checkoutItems.appendChild(itemElement);
    });

    console.log('Total:', total);
    if (checkoutTotal) {
        checkoutTotal.textContent = `Total: $${total.toFixed(2)}`;
    }
}

// Handle payment method selection
function handlePaymentMethodChange() {
    const paymentMethod = document.getElementById('paymentMethod');
    const cardDetails = document.getElementById('cardDetails');

    if (paymentMethod.value === 'card') {
        cardDetails.style.display = 'block';
        // Make card fields required
        document.getElementById('cardNumber').required = true;
        document.getElementById('expiryDate').required = true;
        document.getElementById('cvv').required = true;
    } else {
        cardDetails.style.display = 'none';
        // Remove required from card fields
        document.getElementById('cardNumber').required = false;
        document.getElementById('expiryDate').required = false;
        document.getElementById('cvv').required = false;
    }
}

// Handle checkout form submission
function handleCheckoutSubmit(e) {
    e.preventDefault();

    if (cart.length === 0) {
        alert('Your cart is empty. Please add items before checkout.');
        return;
    }

    // In a real app, you would send this data to your backend
    alert('Order placed successfully! You will receive a confirmation email shortly.');

    // Clear cart and redirect to home
    localStorage.removeItem('serveNowCart');
    cart = [];
    updateCartCount();

    // Redirect to order confirmation page
    window.location.href = 'order-confirmation.html';
}

// Pre-fill user information if logged in
async function prefillUserInfo() {
    const userData = localStorage.getItem('serveNowUser');
    if (userData) {
        try {
            const user = JSON.parse(userData);
            document.getElementById('fullName').value = `${user.first_name} ${user.last_name}`;
            document.getElementById('phone').value = user.phone || '';
            document.getElementById('deliveryAddress').value = user.address || '';
            console.log('Form prefilled from localStorage');
            return;
        } catch (error) {
            console.error('Error parsing user data from localStorage:', error);
        }
    }

    const authToken = localStorage.getItem('serveNowToken');
    console.log('Auth token:', authToken);
    if (!authToken) {
        console.log('No auth token, skipping prefill');
        return;
    }

    try {
        const response = await fetch(`${window.location.origin}/api/auth/me`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        console.log('Response status:', response.status);
        const data = await response.json();
        console.log('User data:', data);
        if (data.success) {
            const user = data.user;
            document.getElementById('fullName').value = `${user.first_name} ${user.last_name}`;
            document.getElementById('phone').value = user.phone || '';
            document.getElementById('deliveryAddress').value = user.address || '';
            console.log('Form prefilled from API');
        } else {
            console.log('Failed to get user data:', data.message);
        }
    } catch (error) {
        console.error('Error fetching user info:', error);
    }
}

// Initialize checkout page
document.addEventListener('DOMContentLoaded', function() {
    console.log('Cart length:', cart.length);
    displayCheckoutItems();
    prefillUserInfo();

    // Payment method change handler
    const paymentMethod = document.getElementById('paymentMethod');
    if (paymentMethod) {
        paymentMethod.addEventListener('change', handlePaymentMethodChange);
    }

    // Checkout form submission
    const checkoutForm = document.getElementById('checkoutForm');
    if (checkoutForm) {
        checkoutForm.addEventListener('submit', handleCheckoutSubmit);
    }

    // Redirect if cart is empty
    if (cart.length === 0) {
        console.log('Cart is empty, redirecting');
        alert('Your cart is empty. Redirecting to home page.');
        window.location.href = 'index.html';
    }
});
