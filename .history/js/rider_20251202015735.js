// Rider dashboard functionality

let currentLocation = null;
let locationWatchId = null;

// Get current location using GPS
function getCurrentLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation is not supported by this browser'));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const location = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
                resolve(location);
            },
            (error) => {
                reject(error);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
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
    }
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
    } catch (error) {
        console.error('Error updating location:', error);
        alert('Failed to update location.');
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
