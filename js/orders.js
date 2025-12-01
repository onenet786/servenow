// Display orders
async function displayOrders(status = 'pending') {
    const ordersContainer = document.getElementById('ordersContainer');
    if (!ordersContainer) return;

    try {
        const response = await fetch(`${API_BASE}/api/orders?status=${status}`, {
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
                        <p><strong>Items:</strong> ${order.items_count || 0} items</p>
                        ${order.rider_location ? `<p><strong>Rider Location:</strong> ${order.rider_location}</p>` : ''}
                        ${order.estimated_delivery_time ? `<p><strong>Estimated Delivery:</strong> ${new Date(order.estimated_delivery_time).toLocaleString()}</p>` : ''}
                    </div>
                    <div class="order-actions">
                        ${status === 'pending' ? `
                            <button onclick="updateOrderStatus(${order.id}, 'confirmed')" class="btn btn-primary">Confirm Order</button>
                            <button onclick="assignRider(${order.id})" class="btn btn-secondary">Assign Rider</button>
                            <button onclick="updateOrderStatus(${order.id}, 'cancelled')" class="btn btn-danger">Cancel Order</button>
                        ` : order.status === 'out_for_delivery' ? `
                            <button onclick="updateRiderLocation(${order.id})" class="btn btn-info">Update Rider Location</button>
                            <button onclick="markAsDelivered(${order.id})" class="btn btn-success">Mark as Delivered</button>
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
        const response = await fetch(`${API_BASE}/api/orders/${orderId}/status`, {
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
    // Create modal
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Assign Rider</h3>
                <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
            </div>
            <div class="modal-body">
                <form id="assignRiderForm">
                    <div class="form-group">
                        <label for="riderSelect">Select Available Rider:</label>
                        <select id="riderSelect" required>
                            <option value="">Loading riders...</option>
                        </select>
                    </div>
                </form>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove()">Cancel</button>
                <button type="button" class="btn btn-primary" id="assignRiderBtn">Assign Rider</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Load available riders
    try {
        const response = await fetch(`${API_BASE}/api/orders/available-riders`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            }
        });

        const data = await response.json();
        if (data.success) {
            const select = document.getElementById('riderSelect');
            select.innerHTML = '<option value="">Select a rider</option>';
            data.riders.forEach(rider => {
                const option = document.createElement('option');
                option.value = rider.id;
                option.textContent = `${rider.first_name} ${rider.last_name} - ${rider.vehicle_type} (${rider.phone})`;
                select.appendChild(option);
            });
        } else {
            alert('Failed to load available riders');
            modal.remove();
            return;
        }
    } catch (error) {
        console.error('Error loading riders:', error);
        alert('Failed to load available riders');
        modal.remove();
        return;
    }

    // Handle assign button
    document.getElementById('assignRiderBtn').addEventListener('click', async function() {
        const riderId = document.getElementById('riderSelect').value;
        if (!riderId) {
            alert('Please select a rider');
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/api/orders/${orderId}/assign-rider`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
                },
                body: JSON.stringify({ rider_id: parseInt(riderId) })
            });

            const data = await response.json();
            if (data.success) {
                alert('Rider assigned successfully!');
                modal.remove();
                displayOrders('pending');
            } else {
                alert('Failed to assign rider: ' + data.message);
            }
        } catch (error) {
            console.error('Error assigning rider:', error);
            alert('Failed to assign rider.');
        }
    });
}

// Update rider location
async function updateRiderLocation(orderId) {
    const location = prompt('Enter current rider location:');
    if (!location) return;

    try {
        const response = await fetch(`${API_BASE}/api/orders/${orderId}/rider-location`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify({ location })
        });

        const data = await response.json();
        if (data.success) {
            alert('Rider location updated successfully!');
            displayOrders('pending');
        } else {
            alert('Failed to update rider location: ' + data.message);
        }
    } catch (error) {
        console.error('Error updating rider location:', error);
        alert('Failed to update rider location.');
    }
}

// Mark order as delivered
async function markAsDelivered(orderId) {
    if (!confirm('Are you sure the order has been delivered to the customer?')) return;

    try {
        const response = await fetch(`${API_BASE}/api/orders/${orderId}/deliver`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            }
        });

        const data = await response.json();
        if (data.success) {
            alert('Order marked as delivered successfully! Customer has been notified.');
            displayOrders('pending');
        } else {
            alert('Failed to mark order as delivered: ' + data.message);
        }
    } catch (error) {
        console.error('Error marking order as delivered:', error);
        alert('Failed to mark order as delivered.');
    }
}

// View order details
function viewOrderDetails(orderId) {
    // For now, just alert
    alert('Order details for ID: ' + orderId);
}

// Initialize orders page
document.addEventListener('DOMContentLoaded', function() {
    // Check if user is admin
    const userData = localStorage.getItem('serveNowUser');
    if (userData) {
        const user = JSON.parse(userData);
        if (user.user_type !== 'admin') {
            alert('Access denied. Admin access required.');
            window.location.href = 'index.html';
            return;
        }
    } else {
        alert('Please login as admin first.');
        window.location.href = 'login.html';
        return;
    }

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
