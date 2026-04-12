// Rider dashboard functionality

// Toast Notification System (copied from app.js)
function showToast(title, message, type = 'info', duration = 2000) {
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

function showSuccess(title, message, duration = 2000) {
    showToast(title, message, 'success', duration);
}

function showError(title, message, duration = 2000) {
    showToast(title, message, 'error', duration);
}

function showWarning(title, message, duration = 2000) {
    showToast(title, message, 'warning', duration);
}

function showInfo(title, message, duration = 2000) {
    showToast(title, message, 'info', duration);
}

let currentLocation = null;
let currentLat = null;
let currentLng = null;
let locationWatchId = null;
let lastLocationPushAt = 0;
let lastPushedLat = null;
let lastPushedLng = null;
let locationPushInFlight = false;
window._riderDeliveries = {};
window._deliveryFeeBase = Number(window._deliveryFeeBase ?? 70);
window._deliveryFeeAdditional = Number(window._deliveryFeeAdditional ?? 30);

function calculateDeliveryFee(storeCount) {
    if (storeCount <= 0) return 0;
    return window._deliveryFeeBase + (storeCount - 1) * window._deliveryFeeAdditional;
}

async function loadDeliveryFeeConfig() {
    try {
        const response = await fetch(`${API_BASE}/api/orders/delivery-fee-config`);
        const data = await response.json();
        if (data.success) {
            const base = Number(data.base_fee);
            const add = Number(data.additional_per_store);
            if (Number.isFinite(base) && base >= 0) window._deliveryFeeBase = base;
            if (Number.isFinite(add) && add >= 0) window._deliveryFeeAdditional = add;
        }
    } catch (error) {
        console.warn('Could not load delivery fee config, using defaults.', error);
    }
}

let requestCache = {};
let requestRetry = {};
const REQUEST_CACHE_TTL = 5000;
const MAX_RETRIES = 3;

async function fetchWithBackoff(url, options = {}, retryCount = 0) {
    const method = String(options.method || 'GET').toUpperCase();
    const cacheKey = `${method}:${url}`;
    const now = Date.now();

    if (method === 'GET' && requestCache[cacheKey] && now - requestCache[cacheKey].time < REQUEST_CACHE_TTL) {
        return Promise.resolve(requestCache[cacheKey].response.clone());
    }
    
    try {
        const response = await fetch(url, options);
        
        if (response.status === 429) {
            if (retryCount < MAX_RETRIES) {
                const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
                return fetchWithBackoff(url, options, retryCount + 1);
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        if (method === 'GET' && response.ok) {
            requestCache[cacheKey] = { response: response.clone(), time: now };
        }
        
        return response;
    } catch (error) {
        console.error('Fetch error:', error);
        throw error;
    }
}

// Normalize relative image URL to absolute
function _normalizeImageUrl(url) {
    try {
        if (!url) return null;
        let u = String(url).trim().replace(/\\/g, '/');
        if (!u) return null;
        if (/^https?:\/\//i.test(u) || u.toLowerCase().startsWith('data:')) return u;
        if (u.startsWith('//')) return window.location.protocol + u;
        if (u.startsWith('/')) return API_BASE.replace(/\/$/, '') + u;
        return API_BASE.replace(/\/$/, '') + '/' + u.replace(/^\/+/, '');
    } catch (e) { return null; }
}

// Load Rider Profile and populate header + Profile tab
async function loadRiderProfile() {
    try {
        const response = await fetchWithBackoff(`${API_BASE}/api/orders/rider/profile`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            }
        });
        const data = await response.json();
        if (data && data.success && data.rider) {
            const r = data.rider;
            const fullName = `${r.first_name || ''} ${r.last_name || ''}`.trim() || (r.first_name || 'Rider');
            const vehicle = r.vehicle_type || '';
            const headerName = document.getElementById('riderName');
            const headerVehicle = document.getElementById('riderVehicle');
            if (headerName) headerName.textContent = fullName;
            if (headerVehicle) headerVehicle.textContent = vehicle;

            // Profile tab
            const nameEl = document.getElementById('profileName');
            const emailEl = document.getElementById('profileEmail');
            const phoneEl = document.getElementById('profilePhone');
            const vehicleEl = document.getElementById('profileVehicle');
            if (nameEl) nameEl.textContent = fullName || '-';
            if (emailEl) emailEl.textContent = r.email || '-';
            if (phoneEl) phoneEl.textContent = r.phone || '-';
            if (vehicleEl) vehicleEl.textContent = vehicle || '-';

            const photoWrap = document.getElementById('profilePhoto');
            const idWrap = document.getElementById('profileIdImage');
            const photoUrl = _normalizeImageUrl(r.image_url);
            const idUrl = _normalizeImageUrl(r.id_card_url);
            if (photoWrap && photoUrl) {
                photoWrap.innerHTML = `<img src="${photoUrl}" alt="Rider Photo" style="width:100%;height:100%;object-fit:cover;border-radius:8px;" onerror="this.parentNode.textContent='No image'">`;
            }
            if (idWrap && idUrl) {
                idWrap.innerHTML = `<img src="${idUrl}" alt="ID Card" style="width:100%;height:100%;object-fit:cover;border-radius:8px;" onerror="this.parentNode.textContent='No image'">`;
            }
        }
    } catch (e) {
        console.error('Error loading rider profile:', e);
    }
}

// Load Rider Wallet and populate Wallet tab
async function loadRiderWallet() {
    try {
        const response = await fetchWithBackoff(`${API_BASE}/api/wallet/balance`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            }
        });
        const data = await response.json();
        if (data && data.success && data.wallet) {
            const bal = parseFloat(data.wallet.balance || 0);
            const b1 = document.getElementById('walletBalanceTile2');
            if (b1) b1.textContent = `PKR ${bal.toFixed(2)}`;
        }
    } catch (e) {
        // Ignore if wallet endpoint is not available for rider
    }
}

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
                currentLat = position.coords.latitude;
                currentLng = position.coords.longitude;
                const location = `${currentLat.toFixed(6)}, ${currentLng.toFixed(6)}`;
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
        async (position) => {
            currentLat = position.coords.latitude;
            currentLng = position.coords.longitude;
            currentLocation = `${currentLat.toFixed(6)}, ${currentLng.toFixed(6)}`;
            updateLocationDisplay();
            await pushCurrentLocation(false);
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

function haversineMeters(lat1, lng1, lat2, lng2) {
    const toRad = (value) => (value * Math.PI) / 180;
    const earthRadius = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadius * c;
}

function getTrackedActiveDeliveryIds() {
    const activeStatuses = new Set(['assigned', 'out_for_delivery', 'picked_up', 'ready_for_pickup']);
    return Object.values(window._riderDeliveries || {})
        .filter((delivery) => {
            const status = String(delivery?.status || '').trim().toLowerCase();
            return delivery?.id && activeStatuses.has(status);
        })
        .map((delivery) => Number(delivery.id))
        .filter((id) => Number.isInteger(id) && id > 0);
}

function shouldPushCurrentLocation(force = false) {
    if (force) return true;
    if (!Number.isFinite(currentLat) || !Number.isFinite(currentLng)) return false;
    const now = Date.now();
    const enoughTimePassed = (now - lastLocationPushAt) >= 10000;
    const enoughMovement =
        lastPushedLat == null ||
        lastPushedLng == null ||
        haversineMeters(lastPushedLat, lastPushedLng, currentLat, currentLng) >= 10;
    return enoughTimePassed && enoughMovement;
}

async function pushCurrentLocation(force = false) {
    if (!currentLocation || !shouldPushCurrentLocation(force) || locationPushInFlight) {
        return;
    }

    locationPushInFlight = true;
    try {
        let deliveryIds = getTrackedActiveDeliveryIds();

        if (deliveryIds.length === 0) {
            const response = await fetchWithBackoff(`${API_BASE}/api/orders/rider/deliveries?status=assigned`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
                },
                cache: 'no-store'
            });
            const data = await response.json();
            if (data.success && Array.isArray(data.deliveries)) {
                data.deliveries.forEach((delivery) => {
                    window._riderDeliveries[delivery.id] = delivery;
                });
                deliveryIds = data.deliveries
                    .map((delivery) => Number(delivery.id))
                    .filter((id) => Number.isInteger(id) && id > 0);
            }
        }

        if (deliveryIds.length === 0) return;

        await Promise.all(deliveryIds.map((deliveryId) => fetchWithBackoff(`${API_BASE}/api/orders/${deliveryId}/rider-location`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify({
                location: currentLocation,
                latitude: currentLat,
                longitude: currentLng
            })
        })));

        lastLocationPushAt = Date.now();
        lastPushedLat = currentLat;
        lastPushedLng = currentLng;
    } catch (error) {
        console.error('Error pushing rider location:', error);
    } finally {
        locationPushInFlight = false;
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
            pushCurrentLocation(true).catch((error) => {
                console.error('Failed to push refreshed location:', error);
            });
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
    await pushCurrentLocation(true);
}

// Switch delivery tab
function switchDeliveryTab(status) {
    const assignedTab = document.getElementById('assignedTab');
    const completedTab = document.getElementById('completedTab');
    const assignedTab2 = document.getElementById('assignedTab2');
    const completedTab2 = document.getElementById('completedTab2');
    const assignedContent = document.getElementById('assigned');
    const completedContent = document.getElementById('completed');
    
    if (status === 'assigned') {
        if (assignedTab) assignedTab.classList.add('active');
        if (completedTab) completedTab.classList.remove('active');
        if (assignedTab2) assignedTab2.classList.add('active');
        if (completedTab2) completedTab2.classList.remove('active');
        if (assignedContent) assignedContent.classList.add('active');
        if (completedContent) completedContent.classList.remove('active');
    } else {
        if (assignedTab) assignedTab.classList.remove('active');
        if (completedTab) completedTab.classList.add('active');
        if (assignedTab2) assignedTab2.classList.remove('active');
        if (completedTab2) completedTab2.classList.add('active');
        if (assignedContent) assignedContent.classList.remove('active');
        if (completedContent) completedContent.classList.add('active');
    }
    
    if (status === 'assigned') {
        displayRiderDeliveries('assigned', 'deliveriesContainer');
    } else {
        displayCompletedDeliveries();
    }
}

let deliveriesLoadingState = {};

async function displayRiderDeliveries(status = 'assigned', containerId = 'deliveriesContainer') {
    const deliveriesContainer = document.getElementById(containerId);
    if (!deliveriesContainer) return;

    const requestKey = `${status}-${containerId}`;
    
    if (deliveriesLoadingState[requestKey]) {
        console.log('Request already in progress for:', requestKey);
        return;
    }
    
    deliveriesLoadingState[requestKey] = true;

    try {
        const token = localStorage.getItem('serveNowToken');
        const url = `${API_BASE}/api/orders/rider/deliveries?status=${status}`;
        console.log('Fetching deliveries from:', url);
        
        const response = await fetchWithBackoff(url, {
            headers: {
                'Authorization': `Bearer ${token}`
            },
            cache: 'no-store'
        });

        console.log('Response status:', response.status);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log('Deliveries data:', data);
        
        if (data.success && data.deliveries) {
            deliveriesContainer.innerHTML = '';

            if (data.deliveries.length === 0) {
                deliveriesContainer.innerHTML = '<p style="padding: 1rem; text-align: center; color: #999;">No deliveries found for this status.</p>';
                return;
            }

            data.deliveries.forEach(delivery => {
                window._riderDeliveries[delivery.id] = delivery;
                const deliveryCard = document.createElement('div');
                deliveryCard.className = 'order-card';
                
                // Calculate items subtotal and delivery fee
                let itemsSubtotal = 0;
                const storeIds = new Set();
                if (delivery.items && delivery.items.length > 0) {
                    delivery.items.forEach(item => {
                        itemsSubtotal += item.price * item.quantity;
                        if (item.store_id) storeIds.add(item.store_id);
                    });
                }
                const numStores = storeIds.size > 0 ? storeIds.size : 1;
                const deliveryFee = calculateDeliveryFee(numStores);
                
                deliveryCard.innerHTML = `
                    <div class="order-header">
                        <h3>Order #${delivery.order_number}</h3>
                        <div class="order-header-actions" style="display:flex;align-items:center;gap:8px;">
                            <button class="btn btn-small" title="Order Info" onclick="openOrderInfo(${delivery.id})"><i class="fa fa-info-circle"></i></button>
                            <span class="order-status status-${delivery.status}">${delivery.status}</span>
                        </div>
                    </div>
                    <div class="order-details">
                        <p><strong>Customer:</strong> ${delivery.first_name} ${delivery.last_name}</p>
                        <p><strong>Store:</strong> ${delivery.store_name}</p>
                        <p style="display:flex;justify-content:space-between;border-top:1px solid #eee;padding-top:8px;margin-top:8px;">
                            <span><strong>Items Subtotal:</strong></span>
                            <span>PKR ${itemsSubtotal.toFixed(2)}</span>
                        </p>
                        <p style="display:flex;justify-content:space-between;">
                            <span><strong>Delivery Fee (${numStores} store${numStores > 1 ? 's' : ''}):</strong></span>
                            <span>PKR ${deliveryFee.toFixed(2)}</span>
                        </p>
                        <p style="display:flex;justify-content:space-between;border-top:2px solid #eee;padding-top:8px;margin-top:8px;font-weight:bold;">
                            <span>Grand Total:</span>
                            <span>PKR ${delivery.total_amount}</span>
                        </p>
                        <p><strong>Delivery Address:</strong> ${delivery.delivery_address}</p>
                        <p><strong>Phone:</strong> ${delivery.phone || 'N/A'}</p>
                        ${delivery.phone ? `
                        <div class="contact-actions" style="margin: 8px 0; display: flex; gap: 8px; flex-wrap: wrap;">
                            <a class="btn btn-small" style="background:#2563eb;color:#fff;" href="tel:${delivery.phone}"><i class="fa fa-phone"></i> Call</a>
                            <a class="btn btn-small" style="background:#f59e0b;color:#fff;" href="sms:${delivery.phone}"><i class="fa fa-sms"></i> SMS</a>
                            <a class="btn btn-small" style="background:#16a34a;color:#fff;" href="https://wa.me/${(delivery.phone || '').replace(/[^0-9]/g, '')}" target="_blank" rel="noopener"><i class="fa fa-whatsapp"></i> WhatsApp</a>
                        </div>
                        ` : ''}
                        <p><strong>Payment Status:</strong> <span class="payment-status">${delivery.payment_status}</span></p>
                        <div class="order-items-summary" style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed #ddd;">
                            <p><strong>Items:</strong></p>
                            <ul style="list-style: none; padding-left: 0;">
                                ${delivery.items && delivery.items.length > 0 ? delivery.items.map(item => `
                                    <li style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                        <span>${item.quantity}x ${item.product_name || 'Unknown Product'} ${item.variant_name ? `(${item.variant_name})` : ''}</span>
                                        <span>PKR ${item.price * item.quantity}</span>
                                    </li>
                                `).join('') : '<li>No items found</li>'}
                            </ul>
                        </div>
                        ${delivery.rider_latitude && delivery.rider_longitude ? `<p><strong>My Location:</strong> ${Number(delivery.rider_latitude).toFixed(6)}, ${Number(delivery.rider_longitude).toFixed(6)}</p>` : (delivery.rider_location ? `<p><strong>My Location:</strong> ${delivery.rider_location}</p>` : '')}
                        ${delivery.estimated_delivery_time ? `<p><strong>Estimated Delivery:</strong> ${new Date(delivery.estimated_delivery_time).toLocaleString()}</p>` : ''}
                    </div>
                    <div class="order-actions">
                        ${delivery.status === 'out_for_delivery' ? `
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
            const errorMsg = data.message || 'Failed to load deliveries';
            console.error('Error from API:', errorMsg);
            deliveriesContainer.innerHTML = `<p style="padding: 1rem; text-align: center; color: #e53e3e;">${errorMsg}</p>`;
        }
    } catch (error) {
        console.error('Error loading deliveries:', error);
        deliveriesContainer.innerHTML = `<p style="padding: 1rem; text-align: center; color: #e53e3e;">Error: ${error.message}</p>`;
    } finally {
        deliveriesLoadingState[requestKey] = false;
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
            body: JSON.stringify({ 
                location: currentLocation,
                latitude: currentLat,
                longitude: currentLng
            })
        });

        const data = await response.json();
        if (data.success) {
            showSuccess('Location Updated', 'Location updated successfully!');
            displayRiderDeliveries('assigned', 'deliveriesContainer');
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
        const response = await fetchWithBackoff(`${API_BASE}/api/orders/${orderId}/deliver`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            }
        });

        const data = await response.json();
        if (data.success) {
            showSuccess('Delivery Completed', 'Delivery marked as completed!');
            displayRiderDeliveries('assigned', 'deliveriesContainer');
        } else {
            showError('Error', 'Failed to mark delivery as completed: ' + data.message);
        }
    } catch (error) {
        console.error('Error marking delivery as completed:', error);
        showError('Delivery Error', 'Failed to mark delivery as completed.');
    }
}

// Update payment status
async function updatePaymentStatus(orderId, status) {
    if (!confirm('Confirm that payment has been received?')) return;

    try {
        const response = await fetchWithBackoff(`${API_BASE}/api/orders/${orderId}/payment-status`, {
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
            displayRiderDeliveries('assigned', 'deliveriesContainer');
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
        const response = await fetchWithBackoff(`${API_BASE}/api/orders/rider/profile`, {
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

// Modal and tabs helpers
function createOrGetOrderInfoModal() {
    let modal = document.getElementById('orderInfoModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'orderInfoModal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 700px;">
            <span class="close" onclick="closeOrderInfoModal()">&times;</span>
            <div id="orderInfoBody" class="modal-body"></div>
        </div>
    `;
    document.body.appendChild(modal);
    return modal;
}
function openOrderInfo(orderId) {
    const delivery = (window._riderDeliveries || {})[orderId];
    if (!delivery) return;
    const modal = createOrGetOrderInfoModal();
    const body = modal.querySelector('#orderInfoBody');
    
    // Calculate subtotal and delivery fee
    let itemsSubtotal = 0;
    const storeIds = new Set();
    const itemsByStore = {};
    
    if (delivery.items && delivery.items.length > 0) {
        delivery.items.forEach(item => {
            itemsSubtotal += item.price * item.quantity;
            if (item.store_id) storeIds.add(item.store_id);
            
            const storeName = item.item_store_name || 'Unknown Store';
            if (!itemsByStore[storeName]) {
                itemsByStore[storeName] = [];
            }
            itemsByStore[storeName].push(item);
        });
    }
    
    const numStores = storeIds.size > 0 ? storeIds.size : 1;
    const deliveryFee = calculateDeliveryFee(numStores);
    
    let itemsHtml = '';
    for (const storeName in itemsByStore) {
        itemsHtml += `<li style="font-weight:bold;color:#2563eb;margin-top:8px;margin-bottom:4px;">${storeName}</li>`;
        itemsByStore[storeName].forEach(item => {
            itemsHtml += `<li style="display:flex;justify-content:space-between;margin-bottom:4px;margin-left:8px;">
                <span>${item.quantity}x ${item.product_name || 'Product'} ${item.variant_name ? '(' + item.variant_name + ')' : ''}</span>
                <span>PKR ${(item.price * item.quantity).toFixed(2)}</span>
            </li>`;
        });
    }
    
    body.innerHTML = `
        <h3 style="margin-top:0;">Order #${delivery.order_number}</h3>
        <p><strong>Status:</strong> ${delivery.status}</p>
        <p><strong>Payment:</strong> ${delivery.payment_status || 'unknown'}</p>
        <p><strong>Customer:</strong> ${delivery.first_name || ''} ${delivery.last_name || ''}</p>
        <p><strong>Phone:</strong> ${delivery.phone || 'N/A'}</p>
        <p><strong>Address:</strong> ${delivery.delivery_address || 'N/A'}</p>
        <div style="margin-top:10px;border-top:1px solid #eee;padding-top:8px;">
            <p><strong>Items</strong></p>
            <ul style="list-style:none;padding-left:0;margin:0;">
                ${itemsHtml || '<li>No items found</li>'}
            </ul>
        </div>
        <div style="margin-top:12px;border-top:2px solid #eee;padding-top:8px;">
            <p style="display:flex;justify-content:space-between;margin-bottom:4px;">
                <span><strong>Items Subtotal:</strong></span>
                <span>PKR ${itemsSubtotal.toFixed(2)}</span>
            </p>
            <p style="display:flex;justify-content:space-between;margin-bottom:4px;">
                <span><strong>Delivery Fee (${numStores} store${numStores > 1 ? 's' : ''}):</strong></span>
                <span>PKR ${deliveryFee.toFixed(2)}</span>
            </p>
            <p style="display:flex;justify-content:space-between;border-top:1px solid #eee;padding-top:8px;font-weight:bold;font-size:16px;">
                <span>Grand Total:</span>
                <span>PKR ${Number(delivery.total_amount || 0).toFixed(2)}</span>
            </p>
        </div>
    `;
    modal.style.display = 'block';
    setTimeout(() => modal.classList.add('show'), 10);
}
function closeOrderInfoModal() {
    const modal = document.getElementById('orderInfoModal');
    if (!modal) return;
    modal.classList.remove('show');
    setTimeout(() => { modal.style.display = 'none'; }, 200);
}

// Tab Switching
function switchTab(tabId) {
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });

    // Deactivate all sidebar links
    document.querySelectorAll('.sidebar-nav a').forEach(link => {
        link.classList.remove('active');
    });

    // Show selected tab content
    const selectedTab = document.getElementById(tabId);
    if (selectedTab) {
        selectedTab.classList.add('active');
    }

    // Activate sidebar link
    const selectedLink = document.getElementById('nav-' + tabId);
    if (selectedLink) {
        selectedLink.classList.add('active');
    }
    
    // Close mobile sidebar if open
    const appSidebar = document.getElementById('appSidebar');
    if (appSidebar && window.innerWidth <= 1024) {
        appSidebar.classList.remove('active');
    }

    // Load data based on tab
    if (tabId === 'assigned') {
        displayRiderDeliveries('assigned', 'deliveriesContainer');
    } else if (tabId === 'completed') {
        displayRiderDeliveries('completed', 'completedDeliveriesContainer');
    }
}

// Logout
function logout() {
    localStorage.removeItem('serveNowToken');
    localStorage.removeItem('serveNowUser');
    window.location.href = 'index.html';
}

// Change Password Modal
function showChangePasswordModal() {
    const modal = document.getElementById('changePasswordModal');
    if (modal) {
        modal.style.display = 'block';
        setTimeout(() => modal.classList.add('show'), 10);
    }
    // Close sidebar on mobile
    const appSidebar = document.getElementById('appSidebar');
    if (appSidebar && window.innerWidth <= 1024) {
        appSidebar.classList.remove('active');
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => { modal.style.display = 'none'; }, 300);
    }
}

async function submitChangePassword() {
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmNewPassword = document.getElementById('confirmNewPassword').value;

    if (newPassword !== confirmNewPassword) {
        showError('Error', 'New passwords do not match');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/auth/change-password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify({ currentPassword, newPassword })
        });

        const data = await response.json();
        if (data.success) {
            showSuccess('Success', 'Password changed successfully');
            closeModal('changePasswordModal');
            document.getElementById('changePasswordForm').reset();
        } else {
            showError('Error', data.message || 'Failed to change password');
        }
    } catch (error) {
        console.error('Error changing password:', error);
        showError('Error', 'An error occurred while changing password');
    }
}

// Load completed deliveries for Completed tab
async function displayCompletedDeliveries() {
    await displayRiderDeliveries('completed', 'completedDeliveriesContainer');
}
// Initialize rider dashboard
document.addEventListener('DOMContentLoaded', function() {
    loadDeliveryFeeConfig();
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
    // Hide dashboard tiles to match mobile tab UX
    try { const tiles = document.getElementById('riderSummaryTiles'); if (tiles) tiles.style.display = 'none'; } catch (e) {}
    // Load profile and wallet
    loadRiderProfile();
    loadRiderWallet();
    // Preload data for tabs
    displayRiderDeliveries('assigned', 'deliveriesContainer');
    displayCompletedDeliveries();
    // Load initial tab
    switchTab('assigned');
    createOrGetOrderInfoModal();

    // Try to get initial location
    getCurrentLocation()
        .then((location) => {
            currentLocation = location;
            updateLocationDisplay();
            pushCurrentLocation(true).catch((error) => {
                console.error('Failed to push initial location:', error);
            });
            console.log('Initial location obtained:', location);
        })
        .catch((error) => {
            console.error('Failed to get initial location:', error);
            const locationElement = document.getElementById('currentLocation');
            if (locationElement) {
                locationElement.textContent = 'Location unavailable - ' + error.message;
                locationElement.style.color = '#e53e3e';
            }
            showError('Location Error', 'Location access failed: ' + error.message + '<br><br>Please enable location permissions and refresh the page.', 10000);
        });

    // Start location tracking (will handle errors internally)
    startLocationTracking();

    // Fallback push in case watchPosition events slow down on some devices/browsers
    setInterval(autoUpdateLocation, 30000);

    // Cleanup on page unload
    window.addEventListener('beforeunload', stopLocationTracking);
});

