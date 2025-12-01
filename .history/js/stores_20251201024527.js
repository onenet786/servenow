// Global stores variable
const API_BASE = 'http://192.168.55.245:3001';
let allStores = [];

// Load and display all stores
async function displayAllStores(filteredStores = null) {
    const storeGrid = document.getElementById('allStores');
    if (!storeGrid) return;

    let storesToDisplay = filteredStores;
    if (!storesToDisplay) {
        if (allStores.length === 0) {
            try {
                const response = await fetch(`${API_BASE}/api/stores`);
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
        storeCard.innerHTML = `
            <h4>${store.name}</h4>
            <p>Location: ${store.location}</p>
            <p>Rating: ${store.rating} ⭐</p>
            <p>Delivery: ${store.delivery_time}</p>
            <a href="store.html?id=${store.id}" class="btn btn-primary">View Store</a>
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
                    alert("Location found! Showing nearby stores.");
                    displayAllStores();
                }, function(error) {
                    switch(error.code) {
                        case error.PERMISSION_DENIED:
                            alert("User denied the request for Geolocation.");
                            break;
                        case error.POSITION_UNAVAILABLE:
                            alert("Location information is unavailable.");
                            break;
                        case error.TIMEOUT:
                            alert("The request to get user location timed out.");
                            break;
                        case error.UNKNOWN_ERROR:
                            alert("An unknown error occurred.");
                            break;
                    }
                });
            } else {
                alert("Geolocation is not supported by this browser.");
            }
        });
    }
});
