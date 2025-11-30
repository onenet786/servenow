// Display cart items in checkout
function displayCheckoutItems() {
    const checkoutItems = document.getElementById('checkoutItems');
    const checkoutTotal = document.getElementById('checkoutTotal');

    if (!checkoutItems) return;

    checkoutItems.innerHTML = '';
    let total = 0;

    cart.forEach(item => {
        const itemTotal = item.price * item.quantity;
        total += itemTotal;

        const itemElement = document.createElement('div');
        itemElement.className = 'checkout-item';
        itemElement.innerHTML = `
            <span>${item.name} x ${item.quantity}</span>
            <span>$${itemTotal.toFixed(2)}</span>
        `;
        checkoutItems.appendChild(itemElement);
    });

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

// Initialize checkout page
document.addEventListener('DOMContentLoaded', function() {
    displayCheckoutItems();

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
        alert('Your cart is empty. Redirecting to home page.');
        window.location.href = 'index.html';
    }
});
