// Cart functionality (cart is global from app.js)

// Toast Notification System (copied from app.js)
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
    if (!checkoutItems) {
        showError('Error', 'Checkout items container not found');
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
async function handlePaymentMethodChange() {
    const paymentMethod = document.getElementById('paymentMethod');
    const cardDetails = document.getElementById('cardDetails');
    const walletBalanceInfo = document.getElementById('walletBalanceInfo');

    if (paymentMethod.value === 'card') {
        cardDetails.style.display = 'block';
        if (walletBalanceInfo) walletBalanceInfo.style.display = 'none';
        // Make card fields required
        document.getElementById('cardNumber').required = true;
        document.getElementById('expiryDate').required = true;
        document.getElementById('cvv').required = true;
    } else if (paymentMethod.value === 'wallet') {
        cardDetails.style.display = 'none';
        // Remove required from card fields
        document.getElementById('cardNumber').required = false;
        document.getElementById('expiryDate').required = false;
        document.getElementById('cvv').required = false;
        
        // Fetch and show wallet balance
        await showWalletBalance();
    } else {
        cardDetails.style.display = 'none';
        if (walletBalanceInfo) walletBalanceInfo.style.display = 'none';
        // Remove required from card fields
        document.getElementById('cardNumber').required = false;
        document.getElementById('expiryDate').required = false;
        document.getElementById('cvv').required = false;
    }
}

async function showWalletBalance() {
    const authToken = localStorage.getItem('serveNowToken');
    if (!authToken) return;

    let walletBalanceInfo = document.getElementById('walletBalanceInfo');
    if (!walletBalanceInfo) {
        walletBalanceInfo = document.createElement('div');
        walletBalanceInfo.id = 'walletBalanceInfo';
        walletBalanceInfo.className = 'wallet-balance-info';
        document.getElementById('paymentMethod').parentNode.appendChild(walletBalanceInfo);
    }

    walletBalanceInfo.style.display = 'block';
    walletBalanceInfo.innerHTML = 'Loading balance...';

    try {
        const response = await fetch(`${API_BASE}/api/wallet/balance`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();

        if (data.success && data.wallet) {
            const balance = parseFloat(data.wallet.balance);
            const total = calculateTotal();
            const isInsufficient = balance < total;
            
            walletBalanceInfo.innerHTML = `
                <div class="balance-container ${isInsufficient ? 'insufficient' : 'sufficient'}">
                    <span>Your Balance: <strong>PKR ${balance.toFixed(2)}</strong></span>
                    ${isInsufficient ? '<br><span class="error-text">Insufficient balance. <a href="wallet.html">Top up here</a></span>' : ''}
                </div>
            `;
        } else {
            walletBalanceInfo.innerHTML = 'Failed to load wallet balance';
        }
    } catch (error) {
        console.error('Error fetching wallet balance:', error);
        walletBalanceInfo.innerHTML = 'Error loading wallet balance';
    }
}

function calculateTotal() {
    let total = 0;
    cart.forEach(item => {
        total += parseFloat(item.price) * item.quantity;
    });
    return total + 2.99; // Total + Delivery Fee
}

// Handle checkout form submission
async function handleCheckoutSubmit(e) {
    e.preventDefault();

    if (cart.length === 0) {
        showWarning('Empty Cart', 'Your cart is empty. Please add items before checkout.');
        return;
    }

    const formData = new FormData(e.target);
    // Get store_id from cart items (assuming all items are from same store due to add-to-cart check)
    // Fallback to 1 for legacy items or testing
    const storeId = (cart.length > 0 && cart[0].storeId) ? cart[0].storeId : 1;
    
    const orderData = {
        store_id: storeId,
        items: cart.map(item => ({
            product_id: item.id,
            quantity: item.quantity
        })),
        delivery_address: formData.get('deliveryAddress'),
        delivery_time: formData.get('deliveryTime'),
        payment_method: formData.get('paymentMethod'),
        special_instructions: '' // Not implemented in form
    };

    if (orderData.payment_method === 'wallet') {
        try {
            const response = await fetch(`${API_BASE}/api/wallet/balance`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
            });
            const data = await response.json();
            if (data.success && data.wallet) {
                const total = calculateTotal();
                const balance = parseFloat(data.wallet.balance);
                if (balance < total) {
                    const needed = (total - balance).toFixed(2);
                    showError('Insufficient Balance', `Your wallet balance is insufficient. Need PKR ${needed} more.`);
                    return;
                }
            }
        } catch (error) {
            console.error('Error checking balance during submit:', error);
            showError('Balance Check Failed', 'Could not verify wallet balance. Please try again.');
            return;
        }
    }

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
            showSuccess('Order Placed', 'Order placed successfully! Order number: ' + data.order.order_number);

            // Clear cart and redirect
            localStorage.removeItem('serveNowCart');
            cart = [];
            updateCartCount();

            // Redirect to order confirmation page
            window.location.href = 'order-confirmation.html';
        } else {
            showError('Order Failed', 'Failed to place order: ' + data.message);
        }
    } catch (error) {
        console.error('Order placement error:', error);
        showError('Error', 'Failed to place order. Please try again.');
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
