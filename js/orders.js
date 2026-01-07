// Display orders
async function displayOrders(status = 'pending') {
    const ordersContainer = document.getElementById('ordersContainer');
    if (!ordersContainer) return;

    try {
        const userData = localStorage.getItem('serveNowUser');
        const user = userData ? JSON.parse(userData) : null;
        const isAdmin = user && user.user_type === 'admin';

        let url = `${API_BASE}/api/orders?status=${status}`;
        if (!isAdmin) {
            url = `${API_BASE}/api/orders/my-orders`;
            // Hide tabs for non-admin
            const tabs = document.querySelector('.orders-tabs');
            if (tabs) tabs.style.display = 'none';
        }

        const response = await fetch(url, {
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
                
                let contactRiderHtml = '';
                if (order.rider_phone) {
                    const cleanPhone = order.rider_phone.replace(/[^0-9]/g, '');
                    contactRiderHtml = `
                        <div class="rider-contact" style="margin-top: 15px; padding: 10px; background: #f9f9f9; border-radius: 8px; border: 1px solid #eee;">
                            <p style="margin-bottom: 10px;"><strong>Rider:</strong> ${order.rider_first_name} ${order.rider_last_name}</p>
                            <div class="contact-actions" style="display: flex; gap: 10px; flex-wrap: wrap;">
                                <a href="tel:${order.rider_phone}" class="btn btn-sm" style="background: #2196F3; color: white; padding: 5px 10px; border-radius: 4px; text-decoration: none; font-size: 14px;">
                                    <i class="fas fa-phone"></i> Call
                                </a>
                                <a href="sms:${order.rider_phone}" class="btn btn-sm" style="background: #FF9800; color: white; padding: 5px 10px; border-radius: 4px; text-decoration: none; font-size: 14px;">
                                    <i class="fas fa-sms"></i> SMS
                                </a>
                                <a href="https://wa.me/${cleanPhone}" target="_blank" class="btn btn-sm" style="background: #4CAF50; color: white; padding: 5px 10px; border-radius: 4px; text-decoration: none; font-size: 14px;">
                                    <i class="fab fa-whatsapp"></i> WhatsApp
                                </a>
                            </div>
                        </div>
                    `;
                }

                let storeHtml = `<p><strong>Store:</strong> ${order.store_name}</p>`;
                if (order.is_group && order.sub_orders) {
                    storeHtml = `<p><strong>Store:</strong> <span style="color: #2196F3; font-weight: bold;">Multiple Stores</span></p>`;
                    storeHtml += `<div style="margin-top: 10px; padding: 10px; background-color: #f5f5f5; border-radius: 5px;">
                        <p style="margin-bottom: 5px;"><strong>Shipments:</strong></p>`;
                    order.sub_orders.forEach(sub => {
                        storeHtml += `<div style="display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 0.9em;">
                            <span>${sub.store_name}</span>
                            <span class="status-${sub.status}" style="padding: 2px 6px; border-radius: 4px; font-size: 0.8em;">${sub.status}</span>
                        </div>`;
                    });
                    storeHtml += `</div>`;
                }

                orderCard.innerHTML = `
                    <div class="order-header">
                        <h3>Order ${order.order_number}</h3>
                        ${order.is_group ? '' : `<span class="order-status status-${order.status}">${order.status}</span>`}
                    </div>
                    <div class="order-details">
                        <p><strong>Customer:</strong> ${order.first_name || (user ? user.first_name : '')} ${order.last_name || (user ? user.last_name : '')}</p>
                        ${storeHtml}
                        <p><strong>Total:</strong> PKR ${order.total_amount}</p>
                        <p><strong>Delivery Address:</strong> ${order.delivery_address}</p>
                        <p><strong>Items:</strong> ${order.items_count || (order.items ? order.items.length : 0)} items</p>
                        ${order.rider_latitude && order.rider_longitude ? 
                            `<p><strong>Rider Location:</strong> ${order.rider_latitude.toFixed(6)}, ${order.rider_longitude.toFixed(6)} 
                            <a href="https://www.google.com/maps?q=${order.rider_latitude},${order.rider_longitude}" target="_blank" style="margin-left: 8px; font-size: 0.9em; color: #2196F3;"><i class="fas fa-map-marker-alt"></i> View on Map</a></p>` : 
                            (order.rider_location ? `<p><strong>Rider Location:</strong> ${order.rider_location}</p>` : '')}
                        ${order.estimated_delivery_time ? `<p><strong>Estimated Delivery:</strong> ${new Date(order.estimated_delivery_time).toLocaleString()}</p>` : ''}
                        ${contactRiderHtml}
                    </div>
                    <div class="order-actions">
                        ${isAdmin ? (status === 'pending' ? `
                            <button onclick="updateOrderStatus(${order.id}, 'confirmed')" class="btn btn-primary">Confirm Order</button>
                            <button onclick="assignRider(${order.id})" class="btn btn-secondary">Assign Rider</button>
                            <button onclick="updateOrderStatus(${order.id}, 'cancelled')" class="btn btn-danger">Cancel Order</button>
                        ` : order.status === 'out_for_delivery' ? `
                            <button onclick="updateRiderLocation(${order.id})" class="btn btn-info">Update Rider Location</button>
                            <button onclick="markAsDelivered(${order.id})" class="btn btn-success">Mark as Delivered</button>
                        ` : `
                            <button onclick="viewOrderDetails(${order.id})" class="btn btn-primary">View Details</button>
                        `) : `
                            <button onclick="viewOrderDetails(${order.id})" class="btn btn-primary">View Details</button>
                        `}
                    </div>
                `;
                ordersContainer.appendChild(orderCard);
            });
        } else {
            ordersContainer.innerHTML = `<p>${data.message || 'Failed to load orders.'}</p>`;
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
                    <div class="form-group" style="margin-top: 15px;">
                        <label for="deliveryFeeInput">Delivery Fee (PKR) (Optional Override):</label>
                        <input type="number" id="deliveryFeeInput" step="0.01" class="form-control" placeholder="Leave empty for default">
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
        const deliveryFee = document.getElementById('deliveryFeeInput').value;
        
        if (!riderId) {
            alert('Please select a rider');
            return;
        }

        const assignBody = { rider_id: parseInt(riderId) };
        if (deliveryFee && !isNaN(deliveryFee)) {
            assignBody.delivery_fee = parseFloat(deliveryFee);
        }

        try {
            const response = await fetch(`${API_BASE}/api/orders/${orderId}/assign-rider`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
                },
                body: JSON.stringify(assignBody)
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
    const input = prompt('Enter current rider location (e.g., "Main St" or "24.8607, 67.0011"):');
    if (!input) return;

    let body = { location: input };
    
    // Check if input is lat, lng
    const coords = input.split(',').map(s => s.trim());
    if (coords.length === 2) {
        const lat = parseFloat(coords[0]);
        const lng = parseFloat(coords[1]);
        if (!isNaN(lat) && !isNaN(lng)) {
            body.latitude = lat;
            body.longitude = lng;
        }
    }

    try {
        const response = await fetch(`${API_BASE}/api/orders/${orderId}/rider-location`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify(body)
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
    // Check if user is logged in
    const userData = localStorage.getItem('serveNowUser');
    if (!userData) {
        alert('Please login first.');
        window.location.href = 'login.html';
        return;
    }

    const user = JSON.parse(userData);
    const isAdmin = user.user_type === 'admin';

    displayOrders(isAdmin ? 'pending' : 'all');

    if (isAdmin) {
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
    }
});
