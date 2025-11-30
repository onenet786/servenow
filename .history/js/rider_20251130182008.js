// Rider dashboard functionality

// Display rider's deliveries
async function displayRiderDeliveries(status = 'assigned') {
    const deliveriesContainer = document.getElementById('deliveriesContainer');
    if (!deliveriesContainer) return;

    try {
        const response = await fetch(`/api/orders/rider/deliveries?status=${status}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            }
        });

        const data = await response.json();
        if (data.success) {
            deliveriesContainer.innerHTML = '';

            if (data.deliveries.length === 0) {
                deliveriesContainer.innerHTML = '<p>No deliveries found.</p>';
                return;
            }

            data.deliveries.forEach(delivery => {
                const deliveryCard = document.createElement('div');
                deliveryCard.className = 'order-card';
                deliveryCard.innerHTML = `
                    <div class="order-header">
                        <h3>Order #${delivery.order_number}</h3>
                        <span class="order-status status-${delivery.status}">${delivery.status}</span>
                    </div>
                    <div class="order-details">
                        <p><strong>Customer:</strong> ${delivery.first_name} ${delivery.last_name}</p>
                        <p><strong>Store:</strong> ${delivery.store_name}</p>
                        <p><strong>Total:</strong> PKR ${delivery.total_amount}</p>
                        <p><strong>Delivery Address:</strong> ${delivery.delivery_address}</p>
                        <p><strong>Phone:</strong> ${delivery.phone || 'N/A'}</p>
                        <p><strong>Payment Status:</strong> <span class="payment-status">${delivery.payment_status}</span></p>
                        ${delivery.rider_location ? `<p><strong>My Location:</strong> ${delivery.rider_location}</p>` : ''}
                        ${delivery.estimated_delivery_time ? `<p><strong>Estimated Delivery:</strong> ${new Date(delivery.estimated_delivery_time).toLocaleString()}</p>` : ''}
                    </div>
                    <div class="order-actions">
                        ${delivery.status === 'out_for_delivery' ? `
                            <button onclick="updateMyLocation(${delivery.id})" class="btn btn-info">Update My Location</button>
                            <button onclick="markDelivered(${delivery.id})" class="btn btn-success">Mark as Delivered</button>
                            <button onclick="updatePaymentStatus(${delivery.id}, 'paid')" class="btn btn-primary">Mark Payment Received</button>
                        ` : `
                            <button onclick="viewDeliveryDetails(${delivery.id})" class="btn btn-primary">View Details</button>
                        `}
                    </div>
                `;
                deliveriesContainer.appendChild(deliveryCard);
            });
        } else {
            deliveriesContainer.innerHTML = '<p>Failed to load deliveries.</p>';
        }
    } catch (error) {
        console.error('Error loading deliveries:', error);
        deliveriesContainer.innerHTML = '<p>Error loading deliveries.</p>';
    }
}

// Update rider location
async function updateMyLocation(orderId) {
    const location = prompt('Enter your current location:');
    if (!location) return;

    try {
        const response = await fetch(`/api/orders/${orderId}/rider-location`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify({ location })
        });

        const data = await response.json();
        if (data.success) {
            alert('Location updated successfully!');
            displayRiderDeliveries('assigned');
        } else {
            alert('Failed to update location: ' + data.message);
        }
    } catch (error) {
        console.error('Error updating location:', error);
        alert('Failed to update location.');
    }
}

// Mark delivery as completed
async function markDelivered(orderId) {
    if (!confirm('Are you sure the delivery is completed?')) return;

    try {
        const response = await fetch(`/api/orders/${orderId}/deliver`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            }
        });

        const data = await response.json();
        if (data.success) {
            alert('Delivery marked as completed!');
            displayRiderDeliveries('assigned');
        } else {
            alert('Failed to mark delivery as completed: ' + data.message);
        }
    } catch (error) {
        console.error('Error marking delivery as completed:', error);
        alert('Failed to mark delivery as completed.');
    }
}

// Update payment status
async function updatePaymentStatus(orderId, status) {
    if (!confirm('Confirm that payment has been received?')) return;

    try {
        const response = await fetch(`/api/orders/${orderId}/payment-status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify({ payment_status: status })
        });

        const data = await response.json();
        if (data.success) {
            alert('Payment status updated!');
            displayRiderDeliveries('assigned');
        } else {
            alert('Failed to update payment status: ' + data.message);
        }
    } catch (error) {
        console.error('Error updating payment status:', error);
        alert('Failed to update payment status.');
    }
}

// View delivery details
function viewDeliveryDetails(orderId) {
    // For now, just alert
    alert('Delivery details for Order ID: ' + orderId);
}

// Load rider info
async function loadRiderInfo() {
    try {
        const response = await fetch('/api/rider/profile', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            }
        });

        const data = await response.json();
        if (data.success) {
            document.getElementById('riderName').textContent = `${data.rider.first_name} ${data.rider.last_name}`;
            document.getElementById('riderVehicle').textContent = data.rider.vehicle_type;
        }
    } catch (error) {
        console.error('Error loading rider info:', error);
    }
}

// Initialize rider dashboard
document.addEventListener('DOMContentLoaded', function() {
    // Check if user is rider
    const userData = localStorage.getItem('serveNowUser');
    if (userData) {
        const user = JSON.parse(userData);
        if (user.user_type !== 'rider') {
            alert('Access denied. Rider access required.');
            window.location.href = 'index.html';
            return;
        }
    } else {
        alert('Please login as rider first.');
        window.location.href = 'login.html';
        return;
    }

    loadRiderInfo();
    displayRiderDeliveries('assigned');

    // Tab switching
    document.getElementById('assignedTab').addEventListener('click', function() {
        document.getElementById('assignedTab').classList.add('active');
        document.getElementById('completedTab').classList.remove('active');
        displayRiderDeliveries('assigned');
    });

    document.getElementById('completedTab').addEventListener('click', function() {
        document.getElementById('completedTab').classList.add('active');
        document.getElementById('assignedTab').classList.remove('active');
        displayRiderDeliveries('completed');
    });
});
