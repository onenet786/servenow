// Generate random order number
function generateOrderNumber() {
    return Math.floor(Math.random() * 90000) + 10000;
}

// Display order details
function displayOrderDetails() {
    const orderNumber = document.getElementById('orderNumber');
    const orderItems = document.getElementById('orderItems');
    const orderTotal = document.getElementById('orderTotal');
    const deliveryTime = document.getElementById('deliveryTime');
    const deliveryAddress = document.getElementById('deliveryAddress');

    // Get order details from localStorage or use default
    const lastOrder = JSON.parse(localStorage.getItem('lastOrder')) || {};

    if (orderNumber) {
        orderNumber.textContent = generateOrderNumber();
    }

    if (orderItems) {
        orderItems.innerHTML = '';
        if (lastOrder.items && lastOrder.items.length > 0) {
            lastOrder.items.forEach(item => {
                const itemElement = document.createElement('div');
                itemElement.className = 'order-item';
                itemElement.innerHTML = `
                    <span>${item.name} x ${item.quantity}</span>
                    <span>PKR ${item.price * item.quantity}</span>
                `;
                orderItems.appendChild(itemElement);
            });
        } else {
            // If no order data, show a message
            orderItems.innerHTML = '<p>No order details available.</p>';
        }
    }

    if (orderTotal) {
        orderTotal.textContent = lastOrder.total ? `Total: PKR ${lastOrder.total}` : 'Total: PKR 0.00';
    }

    if (deliveryTime) {
        deliveryTime.textContent = lastOrder.deliveryTime || '30-45 minutes';
    }

    if (deliveryAddress) {
        deliveryAddress.textContent = lastOrder.address || 'Your saved address';
    }
}

// Initialize confirmation page
document.addEventListener('DOMContentLoaded', function() {
    displayOrderDetails();
});
