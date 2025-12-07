// Rider dashboard functionality

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

let currentLocation = null;
let locationWatchId = null;

// Get current location using GPS
function getCurrentLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation is not supported by this browser'));
            return;
        }

        // Check if we have permission
        if (navigator.permissions) {
            navigator.permissions.query({name:'geolocation'}).then(function(result) {
                if (result.state === 'denied') {
                    reject(new Error('Location permission denied. Please enable location access in your browser settings.'));
                    return;
                }
            });
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const location = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
                resolve(location);
            },
            (error) => {
                let errorMessage = 'Failed to get location: ';
                switch(error.code) {
                    case error.PERMISSION_DENIED:
                        errorMessage += 'Location permission denied. Please enable location access.';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        errorMessage += 'Location information is unavailable.';
                        break;
                    case error.TIMEOUT:
                        errorMessage += 'Location request timed out.';
                        break;
                    default:
                        errorMessage += 'Unknown error occurred.';
                        break;
                }
                reject(new Error(errorMessage));
            },
            {
                enableHighAccuracy: true,
                timeout: 15000, // Increased timeout
                maximumAge: 300000 // 5 minutes
            }
        );
    });
}

// Start location tracking
function startLocationTracking() {
    if (locationWatchId) {
        navigator.geolocation.clearWatch(locationWatchId);
    }

    locationWatchId = navigator.geolocation.watchPosition(
        (position) => {
            currentLocation = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
            updateLocationDisplay();
        },
        (error) => {
            console.error('Location tracking error:', error);
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 300000 // 5 minutes
        }
    );
}

// Stop location tracking
function stopLocationTracking() {
    if (locationWatchId) {
        navigator.geolocation.clearWatch(locationWatchId);
        locationWatchId = null;
    }
}

// Update location display on dashboard
function updateLocationDisplay() {
    const locationElement = document.getElementById('currentLocation');
    if (locationElement && currentLocation) {
        locationElement.textContent = currentLocation;
        locationElement.style.color = ''; // Reset color
    }
}

// Refresh location manually
function refreshLocation() {
    const locationElement = document.getElementById('currentLocation');
    if (locationElement) {
        locationElement.textContent = 'Getting location...';
        locationElement.style.color = '';
    }

    getCurrentLocation()
        .then((location) => {
            currentLocation = location;
            updateLocationDisplay();
            console.log('Location refreshed:', location);
            showSuccess('Location Updated', 'Location updated successfully!');
        })
        .catch((error) => {
            console.error('Failed to refresh location:', error);
            if (locationElement) {
                locationElement.textContent = 'Location unavailable - ' + error.message;
                locationElement.style.color = '#e53e3e';
            }
            showError('Error', 'Failed to get location: ' + error.message);
        });
}

// Auto-update location for active deliveries
async function autoUpdateLocation() {
    if (!currentLocation) return;

    try {
        // Get active deliveries
        const response = await fetch(`${API_BASE}/api/orders/rider/deliveries?status=assigned`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            }
        });

        const data = await response.json();
        if (data.success && data.deliveries.length > 0) {
            // Update location for all active deliveries
            for (const delivery of data.deliveries) {
                await fetch(`${API_BASE}/api/orders/${delivery.id}/rider-location`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
                    },
                    body: JSON.stringify({ location: currentLocation })
                });
            }
        }
    } catch (error) {
        console.error('Error auto-updating location:', error);
    }
}

// Display rider's deliveries
async function displayRiderDeliveries(status = 'assigned') {
    const deliveriesContainer = document.getElementById('deliveriesContainer');
    if (!deliveriesContainer) return;

    try {
        const response = await fetch(`${API_BASE}/api/orders/rider/deliveries?status=${status}`, {
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

// Update rider location manually (fallback)
async function updateMyLocation(orderId) {
    try {
        if (!currentLocation) {
            showWarning('Location Unavailable', 'Location not available. Please enable GPS and try again.');
            return;
        }

        const response = await fetch(`${API_BASE}/api/orders/${orderId}/rider-location`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify({ location: currentLocation })
        });

        const data = await response.json();
        if (data.success) {
            showSuccess('Location Updated', 'Location updated successfully!');
            displayRiderDeliveries('assigned');
        } else {
            showError('Error', 'Failed to update location: ' + data.message);
        }
    } catch (error) {
        console.error('Error updating location:', error);
        showError('Error', 'Failed to update location.');
    }
}

// Mark delivery as completed
async function markDelivered(orderId) {
    if (!confirm('Are you sure the delivery is completed?')) return;

    try {
        const response = await fetch(`${API_BASE}/api/orders/${orderId}/deliver`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            }
        });

        const data = await response.json();
        if (data.success) {
            showSuccess('Delivery Completed', 'Delivery marked as completed!');
            displayRiderDeliveries('assigned');
        } else {
            showError('Error', 'Failed to mark delivery as completed: ' + data.message);
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
        const response = await fetch(`${API_BASE}/api/orders/${orderId}/payment-status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify({ payment_status: status })
        });

        const data = await response.json();
        if (data.success) {
            showSuccess('Payment Updated', 'Payment status updated!');
            displayRiderDeliveries('assigned');
        } else {
            showError('Error', 'Failed to update payment status: ' + data.message);
        }
    } catch (error) {
        console.error('Error updating payment status:', error);
        showError('Error', 'Failed to update payment status.');
    }
}

// View delivery details
function viewDeliveryDetails(orderId) {
    // For now, just show toast
    showInfo('Delivery Info', 'Delivery details for Order ID: ' + orderId);
}

// Load rider info
async function loadRiderInfo() {
    try {
        const response = await fetch(`${API_BASE}/api/orders/rider/profile`, {
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
            showError('Access Denied', 'Rider access required.');
            window.location.href = 'index.html';
            return;
        }
    } else {
        showWarning('Login Required', 'Please login as rider first.');
        window.location.href = 'login.html';
        return;
    }

    loadRiderInfo();
    displayRiderDeliveries('assigned');

    // Try to get initial location
    getCurrentLocation()
        .then((location) => {
            currentLocation = location;
            updateLocationDisplay();
            console.log('Initial location obtained:', location);
        })
        .catch((error) => {
            console.error('Failed to get initial location:', error);
            const locationElement = document.getElementById('currentLocation');
            if (locationElement) {
                locationElement.textContent = 'Location unavailable - ' + error.message;
                locationElement.style.color = '#e53e3e';
            }
            alert('Location access failed: ' + error.message + '\n\nPlease enable location permissions and refresh the page.');
        });

    // Start location tracking (will handle errors internally)
    startLocationTracking();

    // Auto-update location every 2 minutes
    setInterval(autoUpdateLocation, 120000); // 2 minutes

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

    // Cleanup on page unload
    window.addEventListener('beforeunload', stopLocationTracking);
});
