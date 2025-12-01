// Cart functionality (cart is global from app.js)

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
    alert('Displaying ' + cart.length + ' items');
    if (!checkoutItems) {
        alert('checkoutItems not found');
        return;
    }

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
            <span>PKR ${itemTotal.toFixed(2)}</span>
        `;
        checkoutItems.appendChild(itemElement);
    });

    console.log('Total:', total);
    if (checkoutTotal) {
        checkoutTotal.textContent = `Total: PKR ${total.toFixed(2)}`;
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
async function handleCheckoutSubmit(e) {
    e.preventDefault();

    if (cart.length === 0) {
        alert('Your cart is empty. Please add items before checkout.');
        return;
    }

    const formData = new FormData(e.target);
    const orderData = {
        store_id: 1, // For demo, using store_id 1
        items: cart.map(item => ({
            product_id: item.id,
            quantity: item.quantity
        })),
        delivery_address: formData.get('deliveryAddress'),
        delivery_time: formData.get('deliveryTime'),
        payment_method: formData.get('paymentMethod'),
        special_instructions: '' // Not implemented in form
    };

    try {
        const response = await fetch(`${API_BASE}/api/orders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify(orderData)
        });

        const data = await response.json();
        if (data.success) {
            alert('Order placed successfully! Order number: ' + data.order.order_number);

            // Clear cart and redirect
            localStorage.removeItem('serveNowCart');
            cart = [];
            updateCartCount();

            // Redirect to order confirmation page
            window.location.href = 'order-confirmation.html';
        } else {
            alert('Failed to place order: ' + data.message);
        }
    } catch (error) {
        console.error('Order placement error:', error);
        alert('Failed to place order. Please try again.');
    }
}

// Pre-fill user information if logged in
async function prefillUserInfo() {
    let userData = localStorage.getItem('serveNowUser');
    if (!userData) {
        // For testing, set a test user
        const testUser = {
            first_name: 'Test',
            last_name: 'User',
            phone: '+1234567890',
            address: '123 Test Street, Test City'
        };
        localStorage.setItem('serveNowUser', JSON.stringify(testUser));
        userData = JSON.stringify(testUser);
        console.log('Using test user data');
    }

    try {
        const user = JSON.parse(userData);
        document.getElementById('fullName').value = `${user.first_name} ${user.last_name}`;
        document.getElementById('phone').value = user.phone || '';
        document.getElementById('deliveryAddress').value = user.address || '';
        console.log('Form prefilled');
    } catch (error) {
        console.error('Error parsing user data:', error);
    }

    const authToken = localStorage.getItem('serveNowToken');
    if (!authToken) {
        console.log('No auth token, using localStorage data');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/auth/me`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        console.log('Response status:', response.status);
        const data = await response.json();
        console.log('User data from API:', data);
        if (data.success) {
            const user = data.user;
            document.getElementById('fullName').value = `${user.first_name} ${user.last_name}`;
            document.getElementById('phone').value = user.phone || '';
            document.getElementById('deliveryAddress').value = user.address || '';
            console.log('Form updated from API');
        } else {
            console.log('Failed to get user data from API:', data.message);
        }
    } catch (error) {
        console.error('Error fetching user info from API:', error);
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

    // Note: Not redirecting if cart is empty for debugging
    // if (cart.length === 0) {
    //     console.log('Cart is empty, redirecting');
    //     alert('Your cart is empty. Redirecting to home page.');
    //     window.location.href = 'index.html';
    // }
});
