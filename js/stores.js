// Global stores variable
let allStores = [];

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

// Load and display all stores
async function displayAllStores(filteredStores = null) {
    const storeGrid = document.getElementById('allStores');
    if (!storeGrid) return;

    let storesToDisplay = filteredStores;
    if (!storesToDisplay) {
        if (allStores.length === 0) {
            try {
                const params = new URLSearchParams(window.location.search);
                const catId = params.get('category_id');
                const catSlug = params.get('category');
                const query = new URLSearchParams();
                if (catId) query.set('category_id', catId);
                else if (catSlug) query.set('category', catSlug);
                const response = await fetch(`${API_BASE}/api/stores${query.toString() ? ('?' + query.toString()) : ''}`);
                const data = await response.json();
                if (data.success) {
                    allStores = data.stores;
                } else {
                    storeGrid.innerHTML = '<p>Unable to load stores at this time.</p>';
                    return;
                }
            } catch (error) {
                console.error('Error loading stores:', error);
                storeGrid.innerHTML = '<p>Unable to load stores at this time.</p>';
                return;
            }
        }
        storesToDisplay = allStores;
    }

    storeGrid.innerHTML = '';

    storesToDisplay.forEach(store => {
        const storeCard = document.createElement('div');
        storeCard.className = 'store-card';
        storeCard.innerHTML = (typeof buildStoreCardHtml === 'function')
            ? buildStoreCardHtml(store)
            : `
                <div class="store-card-header">
                    <h4>${store.name}</h4>
                </div>
                <div class="store-card-body">
                    <p><i class="fas fa-map-marker-alt"></i> ${store.location}</p>
                    <p><i class="fas fa-star"></i> ${store.rating}</p>
                    <p><i class="fas fa-clock"></i> ${store.delivery_time}</p>
                    <a href="store.html?id=${store.id}" class="btn btn-primary">View Store</a>
                </div>
            `;
        storeGrid.appendChild(storeCard);
    });
}

// Filter stores by location
function filterStoresByLocation(searchTerm) {
    if (!searchTerm) {
        displayAllStores();
        return;
    }

    const filteredStores = allStores.filter(store =>
        store.location.toLowerCase().includes(searchTerm.toLowerCase())
    );

    displayAllStores(filteredStores);
}

// Handle location search
function handleLocationSearch(e) {
    e.preventDefault();
    const locationInput = document.getElementById('location');
    const searchTerm = locationInput.value.trim();
    filterStoresByLocation(searchTerm);
}

// Initialize stores page
document.addEventListener('DOMContentLoaded', function() {
    displayAllStores();

    // Location search form
    const locationForm = document.getElementById('locationForm');
    if (locationForm) {
        locationForm.addEventListener('submit', handleLocationSearch);
    }

    // Override the getLocation function for stores page
    const getLocationBtn = document.getElementById('getLocation');
    if (getLocationBtn) {
        getLocationBtn.addEventListener('click', function() {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(function(position) {
                    const latitude = position.coords.latitude;
                    const longitude = position.coords.longitude;
                    console.log(`User location: ${latitude}, ${longitude}`);
                    // In a real app, you'd use reverse geocoding to get location name
                    showSuccess('Location Found', 'Showing nearby stores.');
                    displayAllStores();
                }, function(error) {
                    switch(error.code) {
                        case error.PERMISSION_DENIED:
                            showWarning('Permission Denied', 'You denied the request for Geolocation.');
                            break;
                        case error.POSITION_UNAVAILABLE:
                            showError('Location Unavailable', 'Location information is unavailable.');
                            break;
                        case error.TIMEOUT:
                            showError('Request Timeout', 'The request to get user location timed out.');
                            break;
                        case error.UNKNOWN_ERROR:
                            showError('Error', 'An unknown error occurred.');
                            break;
                    }
                });
            } else {
                showInfo('Geolocation Unavailable', 'Geolocation is not supported by this browser.');
            }
        });
    }
});
