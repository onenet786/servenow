// Display orders
async function displayOrders(status = 'pending') {
    const ordersContainer = document.getElementById('ordersContainer');
    if (!ordersContainer) return;

    try {
        const response = await fetch(`/api/orders?status=${status}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            }
        });

        const data = await response.json();
        if (data.success) {
            ordersContainer.innerHTML = '';

            if (data.orders.length === 0) {
                ordersContainer.innerHTML = '<p>No orders found.</p>';
                return;
            }

            data.orders.forEach(order => {
                const orderCard = document.createElement('div');
                orderCard.className = 'order-card';
                orderCard.innerHTML = `
                    <div class="order-header">
                        <h3>Order #${order.order_number}</h3>
                        <span class="order-status status-${order.status}">${order.status}</span>
                    </div>
                    <div class="order-details">
                        <p><strong>Customer:</strong> ${order.first_name} ${order.last_name}</p>
                        <p><strong>Store:</strong> ${order.store_name}</p>
                        <p><strong>Total:</strong> PKR ${order.total_amount}</p>
                        <p><strong>Delivery Address:</strong> ${order.delivery_address}</p>
                        <p><strong>Items:</strong> ${order.items ? order.items.length : 0} items</p>
                    </div>
                    <div class="order-actions">
                        ${status === 'pending' ? `
                            <button onclick="updateOrderStatus(${order.id}, 'confirmed')" class="btn btn-primary">Confirm Order</button>
                            <button onclick="assignRider(${order.id})" class="btn btn-secondary">Assign Rider</button>
                            <button onclick="updateOrderStatus(${order.id}, 'cancelled')" class="btn btn-danger">Cancel Order</button>
                        ` : `
                            <button onclick="viewOrderDetails(${order.id})" class="btn btn-primary">View Details</button>
                        `}
                    </div>
                `;
                ordersContainer.appendChild(orderCard);
            });
        } else {
            ordersContainer.innerHTML = '<p>Failed to load orders.</p>';
        }
    } catch (error) {
        console.error('Error loading orders:', error);
        ordersContainer.innerHTML = '<p>Error loading orders.</p>';
    }
}

// Update order status
async function updateOrderStatus(orderId, status) {
    try {
        const response = await fetch(`/api/orders/${orderId}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify({ status })
        });

        const data = await response.json();
        if (data.success) {
            alert('Order status updated successfully!');
            displayOrders('pending');
        } else {
            alert('Failed to update order status: ' + data.message);
        }
    } catch (error) {
        console.error('Error updating order status:', error);
        alert('Failed to update order status.');
    }
}

// Assign rider to order
async function assignRider(orderId) {
    const riderId = prompt('Enter Rider ID:');
    if (!riderId) return;

    try {
        const response = await fetch(`/api/orders/${orderId}/assign-rider`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify({ rider_id: riderId })
        });

        const data = await response.json();
        if (data.success) {
            alert('Rider assigned successfully!');
            displayOrders('pending');
        } else {
            alert('Failed to assign rider: ' + data.message);
        }
    } catch (error) {
        console.error('Error assigning rider:', error);
        alert('Failed to assign rider.');
    }
}

// View order details
function viewOrderDetails(orderId) {
    // For now, just alert
    alert('Order details for ID: ' + orderId);
}

// Initialize orders page
document.addEventListener('DOMContentLoaded', function() {
    displayOrders('pending');

    // Tab switching
    document.getElementById('pendingTab').addEventListener('click', function() {
        document.getElementById('pendingTab').classList.add('active');
        document.getElementById('allTab').classList.remove('active');
        displayOrders('pending');
    });

    document.getElementById('allTab').addEventListener('click', function() {
        document.getElementById('allTab').classList.add('active');
        document.getElementById('pendingTab').classList.remove('active');
        displayOrders('all');
    });
});
