// API Base URL - dynamically determine based on current location
const API_BASE = window.location.protocol + '//' + window.location.host;

// Global fetch wrapper: automatically attach Authorization header when a token exists
(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = function(input, init) {
        try {
            const token = localStorage.getItem('serveNowToken');
            if (!token) return nativeFetch(input, init);

            // If caller passed a Request object, clone it and add the header safely
            if (typeof Request !== 'undefined' && input instanceof Request) {
                const newHeaders = new Headers(input.headers || {});
                if (!newHeaders.has('Authorization')) newHeaders.set('Authorization', `Bearer ${token}`);
                const reqInit = {
                    method: input.method,
                    headers: newHeaders,
                    body: input.body,
                    mode: input.mode,
                    credentials: input.credentials,
                    cache: input.cache,
                    redirect: input.redirect,
                    referrer: input.referrer,
                    referrerPolicy: input.referrerPolicy,
                    integrity: input.integrity,
                    keepalive: input.keepalive,
                    signal: input.signal
                };
                // If an explicit init was also provided, merge it (init takes precedence)
                const mergedInit = Object.assign({}, reqInit, init || {});
                return nativeFetch(new Request(input.url, mergedInit));
            }

            // Otherwise handle (input, init) style
            init = init || {};
            init.headers = init.headers || {};

            if (init.headers instanceof Headers) {
                if (!init.headers.has('Authorization')) init.headers.set('Authorization', `Bearer ${token}`);
            } else if (Array.isArray(init.headers)) {
                const h = new Headers(init.headers);
                if (!h.has('Authorization')) h.set('Authorization', `Bearer ${token}`);
                init.headers = h;
            } else {
                if (!init.headers['Authorization'] && !init.headers['authorization']) {
                    init.headers['Authorization'] = `Bearer ${token}`;
                }
            }
        } catch (e) {
            // ignore errors accessing localStorage or headers
        }
        return nativeFetch(input, init);
    };
})();

// Toggle Mobile Menu
function toggleMobileMenu() {
    const navUl = document.querySelector('nav ul');
    const menuToggle = document.querySelector('.menu-toggle');
    navUl.classList.toggle('active');
    menuToggle.classList.toggle('active');
}

// Toast Notification System
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

// Authentication state
let currentUser = null;
let authToken = localStorage.getItem('serveNowToken');

// Apply saved image-fit preference (so preview matches admin choice)
window.addEventListener('DOMContentLoaded', function() {
    try {
        const fit = localStorage.getItem('productImageFit');
        if (fit) {
            document.body.classList.remove('image-fit-cover', 'image-fit-fill');
            document.body.classList.add(`image-fit-${fit}`);
        }
    } catch (e) {
        console.warn('Could not apply saved image fit:', e);
    }
});

// Load categories on the homepage dynamically (replaces the static 4 cards)
async function loadHomeCategories() {
    const grid = document.querySelector('.category-grid');
    if (!grid) return;

    try {
        const res = await fetch(`${API_BASE}/api/categories`);
        const data = await res.json();
        if (!data.success || !Array.isArray(data.categories)) return;

        // Clear existing (static) cards so we render server-driven categories
        grid.innerHTML = '';

        data.categories.forEach(cat => {
            // only show active categories
            if (!cat.is_active) return;

            const name = cat.name || 'Category';
            // build URL-safe slug
            const slug = String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

            // normalize image URL similar to product handling
            let imageSrc = 'https://via.placeholder.com/300x200/E0E0E0/666666?text=No+Image';
            if (cat.image_url) {
                let url = String(cat.image_url).trim().replace(/\\/g, '/');
                if (/^https?:\/\//i.test(url) || url.toLowerCase().startsWith('data:')) {
                    imageSrc = url;
                } else if (url.startsWith('/')) {
                    imageSrc = API_BASE.replace(/\/$/, '') + url;
                } else {
                    imageSrc = API_BASE.replace(/\/$/, '') + '/' + url.replace(/^\/+/, '');
                }
            }

            const card = document.createElement('div');
            card.className = 'category-card';
            card.innerHTML = `
                <img src="${imageSrc}" alt="${name}">
                <div class="category-card-content">
                    <h4>${name}</h4>
                    <a href="stores.html?category=${encodeURIComponent(slug)}&category_id=${encodeURIComponent(cat.id)}">Shop Now</a>
                </div>
            `;
            grid.appendChild(card);
        });

    } catch (err) {
        // Leave static cards as fallback and log error
        console.error('Error loading home categories:', err);
    }
}

async function loadHeaderWalletBalance() {
    const token = localStorage.getItem('serveNowToken');
    if (!token) return;

    // Look for wallet link in nav
    const navUl = document.querySelector('nav ul');
    if (!navUl) return;

    try {
        const response = await fetch(`${API_BASE}/api/wallet/balance`);
        const data = await response.json();

        if (data.success && data.wallet) {
            const balance = parseFloat(data.wallet.balance);
            
            // Check if balance span already exists
            let balanceSpan = document.getElementById('headerWalletBalance');
            if (!balanceSpan) {
                // Find wallet link
                const walletLink = Array.from(navUl.querySelectorAll('a')).find(a => a.href.includes('wallet.html'));
                if (walletLink) {
                    balanceSpan = document.createElement('span');
                    balanceSpan.id = 'headerWalletBalance';
                    balanceSpan.className = 'header-balance';
                    walletLink.appendChild(balanceSpan);
                }
            }
            
            if (balanceSpan) {
                balanceSpan.textContent = ` (PKR ${balance.toFixed(2)})`;
            }
        }
    } catch (error) {
        console.error('Error loading header wallet balance:', error);
    }
}

// Trigger home categories load on DOM ready (safe to call on any page)
window.addEventListener('DOMContentLoaded', function() {
    try { loadHomeCategories(); } catch(e) { /* ignore */ }
    try { loadHeaderWalletBalance(); } catch(e) { /* ignore */ }
});

// Cart functionality
var cart = JSON.parse(localStorage.getItem('serveNowCart')) || [];

function updateCartCount() {
    const cartCount = document.getElementById('cartCount');
    if (cartCount) {
        cartCount.textContent = cart.length;
    }
}

async function fetchProductStock(productId) {
    try {
        const resp = await fetch(`${API_BASE}/api/products/${encodeURIComponent(productId)}`);
        const data = await resp.json();
        if (data && data.success && data.product) {
            const sq = parseInt(data.product.stock_quantity, 10);
            return Number.isFinite(sq) ? Math.max(0, sq) : null;
        }
    } catch (e) { /* ignore */ }
    return null;
}

async function addToCart(productId, productName, price, stockQty, unitName, unitId, imageSrc, storeId, variantData, quantityToAdd = 1) {
    const qToAdd = parseFloat(quantityToAdd) || 1;

    const existingItem = cart.find(item => item.id === productId);
    let maxQty = Number.isFinite(parseFloat(stockQty)) ? Math.max(0, parseInt(stockQty, 10)) : null;
    if (maxQty === null) {
        maxQty = await fetchProductStock(productId);
    }
    if (existingItem) {
        if (imageSrc) existingItem.image = imageSrc;
        if (maxQty !== null) existingItem.maxQty = maxQty;
        if (storeId && !existingItem.storeId) existingItem.storeId = storeId;
        
        const next = (existingItem.quantity || 0) + qToAdd;
        if (maxQty !== null && next > maxQty) {
            showWarning('Limited Stock', `Only ${maxQty} available for ${productName}.`);
            existingItem.quantity = maxQty;
        } else {
            existingItem.quantity = next;
        }
    } else {
        if (maxQty !== null && maxQty <= 0) {
            showWarning('Out of Stock', `${productName} is currently unavailable.`);
            localStorage.setItem('serveNowCart', JSON.stringify(cart));
            updateCartCount();
            return;
        }
        
        let initialQty = qToAdd;
        if (maxQty !== null && initialQty > maxQty) {
            showWarning('Limited Stock', `Only ${maxQty} available for ${productName}.`);
            initialQty = maxQty;
        }

        const item = {
            id: productId,
            name: productName,
            price: price,
            storeId: storeId,
            quantity: initialQty,
            unitName: unitName || null,
            unitId: unitId || null,
            image: imageSrc || null
        };
        
        if (variantData) {
            item.sizeId = variantData.size_id;
            item.sizeLabel = variantData.size_label;
            item.variantLabel = variantData.variant_label;
        }
        
        if (maxQty !== null) item.maxQty = maxQty;
        cart.push(item);
    }
    localStorage.setItem('serveNowCart', JSON.stringify(cart));
    updateCartCount();
    showSuccess('Added to Cart', 'Item added to cart successfully!');
}

function removeFromCart(productId) {
    cart = cart.filter(item => item.id !== productId);
    localStorage.setItem('serveNowCart', JSON.stringify(cart));
    updateCartCount();
    displayCart();
}

function isFractionalUnit(name, id) {
    if (id) {
        const uid = parseInt(id, 10);
        if (uid === 1 || uid === 32) return true;
    }
    const n = String(name || '').toLowerCase().trim().replace(/\./g, '');
    if (!n) return false;
    const singular = n.replace(/s$/, '');
    if (singular === 'kilogram' || singular === 'kiligram' || singular === 'kg') return true;
    if (singular === 'liter' || singular === 'litre' || singular === 'ltr' || singular === 'l') return true;
    if (singular.includes('kilo')) return true;
    if (singular.includes('lit')) return true;
    return false;
}

function qtyStepForUnit(name, id) {
    return isFractionalUnit(name, id) ? 0.25 : 1;
}

function setCartItemQuantity(productId, quantity) {
    const item = cart.find(i => i.id === productId);
    const isFrac = item ? isFractionalUnit(item.unitName, item.unitId) : false;
    const qRaw = isFrac ? parseFloat(quantity) : parseInt(quantity, 10);
    const base = Number.isFinite(qRaw) ? qRaw : 1;
    const minQ = qtyStepForUnit(item?.unitName, item?.unitId);
    const q = Math.max(minQ, base);
    if (item) {
        let finalQ = q;
        if (Number.isFinite(item.maxQty)) {
            if (q > item.maxQty) {
                finalQ = item.maxQty;
                showWarning('Limited Stock', `Only ${item.maxQty} available for ${item.name}.`);
            }
        }
        item.quantity = finalQ;
        localStorage.setItem('serveNowCart', JSON.stringify(cart));
        updateCartCount();
        displayCart();
    }
}

async function ensureItemMaxQty(productId) {
    const item = cart.find(i => i.id === productId);
    if (!item) return null;
    if (Number.isFinite(item.maxQty)) return item.maxQty;
    const maxQty = await fetchProductStock(productId);
    if (maxQty !== null) {
        item.maxQty = maxQty;
        localStorage.setItem('serveNowCart', JSON.stringify(cart));
    }
    return item.maxQty || null;
}

async function incrementQty(productId) {
    const item = cart.find(i => i.id === productId);
    const max = await ensureItemMaxQty(productId);
    const step = qtyStepForUnit(item?.unitName, item?.unitId);
    const next = item ? (item.quantity + step) : step;
    if (item && Number.isFinite(max) && next > max) {
        showWarning('Limited Stock', `Only ${max} available for ${item.name}.`);
        return;
    }
    setCartItemQuantity(productId, next);
}

function decrementQty(productId) {
    const item = cart.find(i => i.id === productId);
    const step = qtyStepForUnit(item?.unitName, item?.unitId);
    const minQ = step;
    const next = item ? Math.max(minQ, item.quantity - step) : minQ;
    setCartItemQuantity(productId, next);
}

async function changeQty(productId, value) {
    const item = cart.find(i => i.id === productId);
    const max = await ensureItemMaxQty(productId);
    const isFrac = item ? isFractionalUnit(item.unitName, item.unitId) : false;
    const qRaw = isFrac ? parseFloat(value) : parseInt(value, 10);
    const base = Number.isFinite(qRaw) ? qRaw : 1;
    const minQ = qtyStepForUnit(item?.unitName, item?.unitId);
    let q = Math.max(minQ, base);
    if (item && Number.isFinite(max) && q > max) {
        q = max;
        showWarning('Limited Stock', `Only ${max} available for ${item.name}.`);
    }
    setCartItemQuantity(productId, q);
}

function displayCart() {
    const cartContainer = document.getElementById('cartItems');
    const cartTotal = document.getElementById('cartTotal');

    if (!cartContainer) return;

    cartContainer.innerHTML = '';
    let total = 0;

    cart.forEach(item => {
        const itemTotal = item.price * item.quantity;
        total += itemTotal;
        const step = qtyStepForUnit(item.unitName, item.unitId);
        const isFrac = isFractionalUnit(item.unitName, item.unitId);

        const imgSrc = item.image || "https://via.placeholder.com/150?text=No+Image";

        const itemElement = document.createElement('div');
        itemElement.className = 'cart-item serving-card';
        const variantLabel = item.variantLabel ? `<p class="variant-label" style="font-size: 0.85em; color: #666; margin: 4px 0 0 0;">${item.variantLabel}</p>` : '';
        itemElement.innerHTML = `
            <div class="serving-dish">
                <div class="dish-shadow"></div>
                <img src="${imgSrc}" alt="${item.name}" class="dish-image">
            </div>
            <div class="serving-content">
                <div class="serving-header">
                    <h4>${item.name}</h4>
                    <button class="serving-remove" onclick="removeFromCart(${item.id})" title="Remove Item">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                ${variantLabel}
                <div class="serving-details">
                    <div class="cart-qty">
                        <button class="qty-btn" onclick="decrementQty(${item.id})">−</button>
                        <input type="range" class="qty-slider" min="${step}" max="${Number.isFinite(item.maxQty) ? item.maxQty : 20}" step="${step}" value="${item.quantity}" oninput="changeQty(${item.id}, this.value)">
                        ${isFrac ? `<input type="text" class="qty-value-input" value="${item.quantity}" oninput="changeQty(${item.id}, this.value)" inputmode="decimal">` : `<span class="qty-value">${item.quantity}</span>`}
                        <button class="qty-btn" onclick="incrementQty(${item.id})">+</button>
                    </div>
                    <span class="serving-price">PKR ${itemTotal.toFixed(2)}</span>
                </div>
            </div>
        `;
        cartContainer.appendChild(itemElement);
    });

    if (cartTotal) {
        cartTotal.textContent = `Total: PKR ${total.toFixed(2)}`;
    }
}

// Location-based functionality
function getUserLocation() {
    if (!navigator.geolocation) {
        showInfo('Geolocation Unavailable', 'Geolocation is not supported by this browser.');
        return;
    }

    // Show loading state
    const locationBtn = document.getElementById('getLocation');
    if (locationBtn) {
        locationBtn.textContent = 'Getting location...';
        locationBtn.disabled = true;
    }

    navigator.geolocation.getCurrentPosition(
        showPosition,
        showLocationError,
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 300000 // 5 minutes
        }
    );
}

function showPosition(position) {
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;

    console.log(`User location: ${latitude}, ${longitude}`);

    // Reset button state
    const locationBtn = document.getElementById('getLocation');
    if (locationBtn) {
        locationBtn.textContent = 'Stores Found!';
        locationBtn.disabled = false;
        setTimeout(() => {
            locationBtn.textContent = 'Find Stores Near Me';
        }, 2000);
    }

    // In a real app, you would send this to your backend to find nearby stores
    // For now, we'll just show all stores with a success message
    displayNearbyStores();
}

function showLocationError(error) {
    // Reset button state
    const locationBtn = document.getElementById('getLocation');
    if (locationBtn) {
        locationBtn.textContent = 'Find Stores Near Me';
        locationBtn.disabled = false;
    }

    let errorMessage = "Location access failed: ";
    switch(error.code) {
        case error.PERMISSION_DENIED:
            errorMessage += "Please enable location permissions in your browser settings.";
            break;
        case error.POSITION_UNAVAILABLE:
            errorMessage += "Location information is unavailable.";
            break;
        case error.TIMEOUT:
            errorMessage += "Location request timed out. Please try again.";
            break;
        case error.UNKNOWN_ERROR:
            errorMessage += "An unknown error occurred.";
            break;
    }
    showError('Error', errorMessage);
}

function normalizePublicImageUrl(rawUrl, fallbackUrl) {
    try {
        if (!rawUrl) return fallbackUrl;
        let url = String(rawUrl).trim().replace(/\\/g, '/');
        if (!url) return fallbackUrl;
        if (/^https?:\/\//i.test(url) || url.toLowerCase().startsWith('data:')) return url;
        if (url.startsWith('//')) return window.location.protocol + url;
        if (url.startsWith('/')) return API_BASE.replace(/\/$/, '') + url;
        return API_BASE.replace(/\/$/, '') + '/' + url.replace(/^\/+/, '');
    } catch (e) {
        return fallbackUrl;
    }
}

function formatStoreRatingValue(rating) {
    const n = parseFloat(rating);
    if (Number.isFinite(n)) return n.toFixed(1);
    return 'N/A';
}

function buildStoreCardHtml(store) {
    const fallbackImg = 'https://via.placeholder.com/96x96/E0E0E0/666666?text=Store';
    const imageSrc = normalizePublicImageUrl(store && store.image_url, fallbackImg);
    const safeAlt = String((store && store.name) || 'Store').replace(/"/g, '&quot;');
    const locationText = (store && store.location) ? store.location : '—';
    const ratingText = formatStoreRatingValue(store && store.rating);
    const deliveryText = (store && store.delivery_time) ? store.delivery_time : '—';
    const id = store && store.id ? store.id : '';

    return `
        <div class="store-card-header">
            <div class="store-card-header-inner">
                <img class="store-card-logo" src="${imageSrc}" alt="${safeAlt}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${fallbackImg}'">
                <h4>${(store && store.name) ? store.name : 'Store'}</h4>
            </div>
        </div>
        <div class="store-card-body">
            <p><i class="fas fa-map-marker-alt"></i> ${locationText}</p>
            <p class="store-rating"><i class="fas fa-star"></i> ${ratingText}</p>
            <p><i class="fas fa-clock"></i> ${deliveryText}</p>
            <a href="store.html?id=${id}" class="btn btn-primary">View Store</a>
        </div>
    `;
}

function displayNearbyStores() {
    const allStoresSection = document.getElementById('allStoresSection');
    if (allStoresSection) {
        allStoresSection.scrollIntoView({ behavior: 'smooth' });
    }
    displayAllStoresHorizontal();
}

    // Display all stores in horizontal scroll (bottom section)
async function displayAllStoresHorizontal() {
    const storeContainer = document.getElementById('allStoresHorizontal');
    if (!storeContainer) return;

    try {
        const response = await fetch(`${API_BASE}/api/stores`);
        const data = await response.json();

        if (data.success) {
            storeContainer.innerHTML = '';
            
            // Show ALL stores (no slice)
            data.stores.forEach(store => {
                const storeCard = document.createElement('div');
                storeCard.className = 'store-card';
                storeCard.innerHTML = buildStoreCardHtml(store);
                storeContainer.appendChild(storeCard);
            });

            // Initialize scroll controls
            initScrollControls(storeContainer);
        }
    } catch (error) {
        console.error('Error loading stores:', error);
        storeContainer.innerHTML = '<p>Unable to load stores at this time.</p>';
    }
}

function initScrollControls(container) {
    const leftBtn = document.getElementById('scrollLeftBtn');
    const rightBtn = document.getElementById('scrollRightBtn');
    
    if (!leftBtn || !rightBtn) return;

    const scrollAmount = 350; // Width of card + gap approx

    leftBtn.addEventListener('click', () => {
        container.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
    });

    rightBtn.addEventListener('click', () => {
        container.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    });

    // Handle button visibility based on scroll position
    const updateButtons = () => {
        const isAtStart = container.scrollLeft <= 0;
        const isAtEnd = container.scrollLeft + container.clientWidth >= container.scrollWidth - 1; // -1 for rounding tolerance

        leftBtn.style.display = isAtStart ? 'none' : 'block';
        rightBtn.style.display = isAtEnd ? 'none' : 'block';
    };

    container.addEventListener('scroll', updateButtons);
    // Initial check
    setTimeout(updateButtons, 100); // Wait for layout
    window.addEventListener('resize', updateButtons);
}

// Perform search and display results in the replacement section
async function handleStoreSearch(filters = {}) {
    const searchResultsSection = document.getElementById('searchResultsSection');
    const categoriesSection = document.getElementById('categoriesSection');
    const allStoresSection = document.getElementById('allStoresSection');
    const searchResultsGrid = document.getElementById('searchResultsGrid');
    
    // If no filters active, show categories and featured stores, hide search results
    if (!filters.search && !filters.category) {
        if (categoriesSection) categoriesSection.classList.remove('hidden');
        if (allStoresSection) allStoresSection.style.display = 'block';
        if (searchResultsSection) searchResultsSection.classList.add('hidden');
        return;
    }

    // Filters active: Hide categories and featured stores, show search results
    if (categoriesSection) categoriesSection.classList.add('hidden');
    if (allStoresSection) allStoresSection.style.display = 'none';
    if (searchResultsSection) searchResultsSection.classList.remove('hidden');

    if (!searchResultsGrid) return;
    searchResultsGrid.innerHTML = '<p>Loading...</p>';

    try {
        let url = `${API_BASE}/api/stores`;
        const params = new URLSearchParams();
        
        if (filters.category) {
            params.append('category', filters.category);
        }
        if (filters.search) {
            params.append('search', filters.search);
        }
        
        const queryString = params.toString();
        if (queryString) {
            url += `?${queryString}`;
        }

        const response = await fetch(url);
        const data = await response.json();

        if (data.success) {
            searchResultsGrid.innerHTML = '';
            let stores = data.stores;

            if (stores.length === 0) {
                searchResultsGrid.innerHTML = '<p>No stores found matching your criteria.</p>';
                return;
            }

            stores.forEach(store => {
                const storeCard = document.createElement('div');
                storeCard.className = 'store-card';
                storeCard.innerHTML = buildStoreCardHtml(store);
                searchResultsGrid.appendChild(storeCard);
            });
        }
    } catch (error) {
        console.error('Error searching stores:', error);
        searchResultsGrid.innerHTML = '<p>Error searching stores.</p>';
    }
}

// Load products by category
async function loadProducts(category) {
    const productGrid = document.getElementById('productGrid');
    const categoryTitle = document.getElementById('categoryTitle');
    if (!productGrid) return;

    // Update the page title
    if (categoryTitle) {
        const formattedCategory = category.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        categoryTitle.textContent = formattedCategory;
    }

    try {
        const response = await fetch(`${API_BASE}/api/products?category=${category}`);
        const data = await response.json();

        if (data.success) {
            productGrid.innerHTML = '';

            data.products.forEach(product => {
                const productCard = document.createElement('div');
                productCard.className = 'product-card';

                // Normalize image URL: if it's a relative path, prefix with API_BASE
                let imageSrc = 'https://via.placeholder.com/200x150/E0E0E0/666666?text=No+Image';
                if (product.image_url) {
                    // Normalize backslashes and trim
                    let url = String(product.image_url).trim().replace(/\\/g, '/');
                    if (/^https?:\/\//i.test(url) || url.toLowerCase().startsWith('data:')) {
                        // absolute URL or data URI — use as-is
                        imageSrc = url;
                    } else if (url.startsWith('/')) {
                        // root-relative — make absolute using API_BASE to avoid host/path mismatch
                        imageSrc = API_BASE.replace(/\/$/, '') + url;
                    } else {
                        // relative path (no leading slash) — prefix with API_BASE
                        imageSrc = API_BASE.replace(/\/$/, '') + '/' + url.replace(/^\/+/, '');
                    }
                }

                productCard.innerHTML = `
                    <div class="product-image">
                                ${buildImgTag(imageSrc, product.image_variants || null, product.name, product.id, {
                                    image_bg_r: product.image_bg_r,
                                    image_bg_g: product.image_bg_g,
                                    image_bg_b: product.image_bg_b,
                                    image_overlay_alpha: product.image_overlay_alpha,
                                    image_contrast: product.image_contrast
                                })}
                    </div>
                    <div class="product-card-content">
                        <h4>${product.name}</h4>
                        <p class="price">PKR ${product.price}</p>
                        <button class="add-to-cart" onclick="addToCart(${product.id}, '${product.name}', ${product.price}, ${Number.isFinite(parseInt(product.stock_quantity)) ? parseInt(product.stock_quantity,10) : 'undefined'}, '${String(product.unit_name || '').replace(/'/g, "\\'")}', ${product.unit_id}, '${imageSrc.replace(/'/g, "\\'")}', ${product.store_id || 'null'})">Add to Cart</button>
                    </div>
                `;
                productGrid.appendChild(productCard);
                // Ensure cached images get orientation fit applied immediately
                productCard.querySelectorAll('img').forEach(img => {
                    try {
                        if (img.complete && img.naturalWidth && img.naturalHeight) {
                            if (img.dataset && (img.dataset.bgR || img.dataset.bgR === '0')) window.applyImageBgFromMeta(img);
                            else applyOrientationFit(img);
                        }
                    } catch (e) { /* ignore */ }
                });
            });
        }
    } catch (error) {
        console.error('Error loading products:', error);
        productGrid.innerHTML = '<p>Unable to load products at this time.</p>';
    }
}

// Build img tag string with optional srcset using variants mapping
function buildImgTag(src, variants, alt, pid, meta) {
    const safeAlt = (alt || '').replace(/"/g, '&quot;');
    const fallback = "https://via.placeholder.com/200x150/E0E0E0/666666?text=No+Image";
    if (variants && typeof variants === 'object') {
        // build srcset entries sorted by width
        const entries = Object.keys(variants).map(k => `${variants[k]} ${k}w`).join(', ');
        // choose smallest variant as src if available, else src
        const widths = Object.keys(variants).map(n=>parseInt(n,10)).sort((a,b)=>a-b);
        const smallest = widths.length ? variants[widths[0]] : src;
        // include data-* attributes when meta is provided so client can apply colors without canvas
        const dataAttrs = meta ? `data-bg-r="${meta.image_bg_r || ''}" data-bg-g="${meta.image_bg_g || ''}" data-bg-b="${meta.image_bg_b || ''}" data-overlay-alpha="${meta.image_overlay_alpha || ''}" data-contrast="${meta.image_contrast || ''}"` : '';
        return `<img src="${smallest || src || fallback}" srcset="${entries}" sizes="(max-width: 600px) 50vw, (max-width: 1200px) 33vw, 25vw" alt="${safeAlt}" ${dataAttrs} loading="lazy" decoding="async" onload="(function(i){ if(i.dataset && (i.dataset.bgR || i.dataset.bgR==='0')){ window.applyImageBgFromMeta(i); } else { applyOrientationFit(i); } })(this)" onerror="this.onerror=null;this.src='${fallback}'; console.warn('Product image failed to load:', '${pid}', this.src)">`;
    }
    const dataAttrs = meta ? `data-bg-r="${meta.image_bg_r || ''}" data-bg-g="${meta.image_bg_g || ''}" data-bg-b="${meta.image_bg_b || ''}" data-overlay-alpha="${meta.image_overlay_alpha || ''}" data-contrast="${meta.image_contrast || ''}"` : '';
    return `<img src="${src || fallback}" alt="${safeAlt}" ${dataAttrs} loading="lazy" decoding="async" onload="(function(i){ if(i.dataset && (i.dataset.bgR || i.dataset.bgR==='0')){ window.applyImageBgFromMeta(i); } else { applyOrientationFit(i); } })(this)" onerror="this.onerror=null;this.src='${fallback}'; console.warn('Product image failed to load:', '${pid}', this.src)">`;
}

// Apply orientation-aware fit: portrait -> contain, landscape -> cover
function applyOrientationFit(img) {
    try {
        if (!img) return;
        const apply = () => {
            try {
                const w = img.naturalWidth || 0;
                const h = img.naturalHeight || 0;
                img.classList.remove('fit-contain', 'fit-cover');
                if (h >= w) {
                    img.classList.add('fit-contain');
                } else {
                    img.classList.add('fit-cover');
                }
                // Also set the parent `.product-image` background to a matching color
                if (window.applyImageBgFromImage) {
                    try { window.applyImageBgFromImage(img); } catch(e) { /* ignore */ }
                }
            } catch (e) { console.warn('applyOrientationFit inner error', e); }
        };

        if (img.complete && img.naturalWidth && img.naturalHeight) {
            apply();
        } else {
            const onLoad = function() { apply(); img.removeEventListener('load', onLoad); };
            img.addEventListener('load', onLoad);
        }
    } catch (e) {
        console.warn('applyOrientationFit failed', e);
    }
}

// Compute an average/dominant-ish background color from an image and apply it
// to the parent `.product-image` element. Best-effort: if the image is cross-origin
// and taints the canvas this will silently fail and leave the default background.
window.applyImageBgFromImage = function(img) {
    try {
        if (!img) return;
        const container = img.closest && img.closest('.product-image');
        if (!container) return;

        const computeAndSet = () => {
            try {
                const w = Math.min(40, Math.max(1, img.naturalWidth || 1));
                const h = Math.min(40, Math.max(1, img.naturalHeight || 1));
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                const data = ctx.getImageData(0, 0, w, h).data;
                let r = 0, g = 0, b = 0, count = 0;
                for (let i = 0; i < data.length; i += 4) {
                    const alpha = data[i + 3];
                    if (alpha === 0) continue;
                    r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
                }
                if (!count) return;
                r = Math.round(r / count);
                g = Math.round(g / count);
                b = Math.round(b / count);
                // Slightly desaturate and set CSS variables so CSS overlay can use them.
                container.style.transition = 'background-color 450ms ease';
                container.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
                // Set CSS vars for overlay use (r,g,b) and compute a helpful overlay alpha
                container.style.setProperty('--product-bg-r', String(r));
                container.style.setProperty('--product-bg-g', String(g));
                container.style.setProperty('--product-bg-b', String(b));
                // Compute luminance to choose overlay strength (0..1)
                const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
                let alpha = 0.20; // default for darker images
                if (lum > 0.75) alpha = 0.55; // very light images -> stronger overlay
                else if (lum > 0.6) alpha = 0.45;
                else if (lum > 0.45) alpha = 0.32;
                else alpha = 0.20;
                container.style.setProperty('--product-overlay-alpha', String(alpha));
                // Also expose a contrast color variable for potential label use
                container.style.setProperty('--product-contrast', (lum > 0.5) ? '#111' : '#fff');
            } catch (e) {
                // likely CORS/tainted canvas; ignore and keep default background
            }
        };

        if (img.complete && img.naturalWidth && img.naturalHeight) {
            setTimeout(computeAndSet, 20);
        } else {
            const onLoad = function() { computeAndSet(); img.removeEventListener('load', onLoad); };
            img.addEventListener('load', onLoad);
        }
    } catch (e) {
        // swallow errors to avoid breaking UI
    }
};

// Apply image meta supplied by server (data attributes or metadata object)
window.applyImageBgFromMeta = function(img) {
    try {
        if (!img) return;
        const container = img.closest && img.closest('.product-image');
        if (!container) return;
        const ds = img.dataset || {};
        const r = ds.bgR || ds.imageBgR || null;
        const g = ds.bgG || ds.imageBgG || null;
        const b = ds.bgB || ds.imageBgB || null;
        const alpha = ds.overlayAlpha || ds.imageOverlayAlpha || null;
        const contrast = ds.contrast || ds.imageContrast || null;
        if (r && g && b) {
            container.style.transition = 'background-color 450ms ease';
            container.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
            if (alpha !== null && alpha !== undefined) container.style.setProperty('--product-overlay-alpha', String(alpha));
            if (contrast) container.style.setProperty('--product-contrast', contrast);
            // Also expose the rgb vars for advanced CSS usage
            container.style.setProperty('--product-bg-r', String(r));
            container.style.setProperty('--product-bg-g', String(g));
            container.style.setProperty('--product-bg-b', String(b));
        }
    } catch (e) { /* ignore */ }
};

// Authentication functions
async function handleLogin(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    const loginData = {
        email: formData.get('email'),
        password: formData.get('password')
    };

    try {
        const response = await fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(loginData)
        });

        const data = await response.json();

        if (data.success) {
            localStorage.setItem('serveNowToken', data.token);
            localStorage.setItem('serveNowUser', JSON.stringify(data.user));
            currentUser = data.user;
            showSuccess('Login Successful', 'Logged in successfully!');

            // Redirect based on user type
            if (data.user.user_type === 'admin') {
                window.location.href = 'admin.html';
            } else if (data.user.user_type === 'rider') {
                window.location.href = 'rider.html';
            } else {
                window.location.href = 'index.html';
            }
        } else {
            showError('Login Failed', data.message || 'Login failed. Please try again.');
        }
    } catch (error) {
        console.error('Login error:', error);
        showError('Error', 'Login failed. Please try again.');
    }
}

async function handleRegister(e) {
    e.preventDefault();

    const formData = new FormData(e.target);
    const registerData = {
        firstName: formData.get('firstName'),
        lastName: formData.get('lastName'),
        email: formData.get('email'),
        phone: formData.get('phone'),
        address: formData.get('address'),
        password: formData.get('password'),
        userType: formData.get('userType') || 'customer'
    };

    // Validate password confirmation
    if (registerData.password !== formData.get('confirmPassword')) {
        showWarning('Invalid Password', 'Passwords do not match');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/auth/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(registerData)
        });

        const data = await response.json();

        if (data.success) {
            localStorage.setItem('serveNowToken', data.token);
            localStorage.setItem('serveNowUser', JSON.stringify(data.user));
            currentUser = data.user;
            showSuccess('Registration Successful', 'Registration successful!');

            // Redirect based on user type
            if (data.user.user_type === 'admin') {
                window.location.href = 'admin.html';
            } else {
                window.location.href = 'index.html';
            }
        } else {
            showError('Registration Failed', data.message || 'Registration failed. Please try again.');
        }
    } catch (error) {
        console.error('Registration error:', error);
        showError('Error', 'Registration failed. Please try again.');
    }
}

// Form validation
function validateForm(formId) {
    const form = document.getElementById(formId);
    if (!form) return false;

    const inputs = form.querySelectorAll('input[required], select[required], textarea[required]');
    let isValid = true;

    inputs.forEach(input => {
        if (!input.value.trim()) {
            input.style.borderColor = 'red';
            isValid = false;
        } else {
            input.style.borderColor = '#ddd';
        }
    });

    return isValid;
}

function logout() {
    localStorage.clear();
    window.location.href = 'login.html';
}

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    // Mobile menu toggle (available on pages with menuToggle/navMenu)
    try {
        const menuToggle = document.getElementById('menuToggle');
        const navMenu = document.getElementById('navMenu');
        if (menuToggle && navMenu) {
            menuToggle.addEventListener('click', function(e) {
                e.stopPropagation();
                navMenu.classList.toggle('active');
                menuToggle.classList.toggle('active');
                navMenu.style.transform = '';
                navMenu.style.opacity = '';
                navMenu.style.visibility = '';
                navMenu.style.display = '';
            });
            const navLinks = navMenu.querySelectorAll('a');
            navLinks.forEach(link => {
                link.addEventListener('click', function() {
                    navMenu.classList.remove('active');
                    menuToggle.classList.remove('active');
                    navMenu.style.transform = '';
                    navMenu.style.opacity = '';
                    navMenu.style.visibility = '';
                    navMenu.style.display = '';
                });
            });
            document.addEventListener('click', function(event) {
                if (!navMenu.contains(event.target) && !menuToggle.contains(event.target)) {
                    navMenu.classList.remove('active');
                    menuToggle.classList.remove('active');
                    navMenu.style.transform = '';
                    navMenu.style.opacity = '';
                    navMenu.style.visibility = '';
                    navMenu.style.display = '';
                }
            });
        }
    } catch (e) { /* ignore toggle wiring errors */ }
    // Redirect to login if not authenticated
    const currentPage = window.location.pathname;
    const isLoginPage = currentPage.includes('login.html');
    const isRegisterPage = currentPage.includes('register.html');

    const token = localStorage.getItem('serveNowToken');
    const path = (currentPage || '').toLowerCase();
    const publicPages = ['index.html','stores.html','store.html','products.html','cart.html','login.html','register.html'];
    const isPublic = publicPages.some(p => path.endsWith(p));
    if (!token && !isPublic) {
        window.location.href = 'login.html';
        return;
    }

    // Hide Home/Stores/Cart navigation on login page
    if (isLoginPage) {
        const navUl = document.querySelector('nav ul');
        if (navUl) {
            // Keep only non-navigation items (like login/register links if they exist)
            const listItems = navUl.querySelectorAll('li');
            listItems.forEach(item => {
                const link = item.querySelector('a');
                if (link) {
                    const href = link.getAttribute('href');
                    // Hide Home, Stores, Cart links
                    if (href && (href.includes('index.html') || href.includes('stores.html') || href.includes('cart.html'))) {
                        item.style.display = 'none';
                    }
                }
            });
        }
    }
    // Update nav if logged in - only for customers
    else if (token) {
        const userData = localStorage.getItem('serveNowUser');
        if (userData) {
            try {
                const user = JSON.parse(userData);
                // Only update navigation for customers, not for riders or admins
                if (user.user_type === 'customer') {
                    const navUl = document.querySelector('nav ul');
                    if (navUl) {
                        navUl.innerHTML = `
                            <li><a href="index.html"><i class="fas fa-home"></i> Home</a></li>
                            <li><a href="stores.html"><i class="fas fa-store"></i> Stores</a></li>
                            <li><a href="orders.html"><i class="fas fa-box"></i> Orders</a></li>
                            <li><a href="cart.html"><i class="fas fa-shopping-cart"></i> Cart <span id="cartCount">0</span></a></li>
                            <li><a href="wallet.html"><i class="fas fa-wallet"></i> Wallet</a></li>
                            <li>Welcome ${user.first_name}</li>
                            <li><a href="#" onclick="logout()"><i class="fas fa-sign-out-alt"></i> Logout</a></li>
                        `;
                    }
                }
            } catch (error) {
                console.error('Error parsing user data:', error);
            }
        }
    }

    updateCartCount();

    // Get location button
    const getLocationBtn = document.getElementById('getLocation');
    if (getLocationBtn) {
        getLocationBtn.addEventListener('click', getUserLocation);
    }

    const formatPhoneValue = (raw) => {
        const digits = String(raw || '').replace(/[^\d]/g, '');
        let local = digits.replace(/^92/, '');
        if (local.length > 10) local = local.slice(0, 10);
        return '+92' + local;
    };
    const attachPhoneFormatterTo = (input) => {
        if (!input) return;
        const ensurePrefix = () => {
            if (!input.value || !String(input.value).startsWith('+92')) {
                input.value = formatPhoneValue(input.value);
            }
        };
        input.addEventListener('focus', ensurePrefix);
        input.addEventListener('keydown', function(e) {
            const v = String(input.value || '');
            if ((e.key === 'Backspace' || e.key === 'Delete') && input.selectionStart <= 3) {
                e.preventDefault();
                input.setSelectionRange(3, 3);
            }
        });
        input.addEventListener('input', function() {
            const start = input.selectionStart;
            input.value = formatPhoneValue(input.value);
            const pos = Math.max(3, start);
            input.setSelectionRange(pos, pos);
        });
        input.addEventListener('blur', ensurePrefix);
        ensurePrefix();
    };
    window.attachPhoneFormatterTo = attachPhoneFormatterTo;
    const phoneInputs = Array.from(document.querySelectorAll('input[type="tel"][name="phone"], #phone, #userPhone, #storePhone, #riderPhone'));
    phoneInputs.forEach(attachPhoneFormatterTo);

    // Load products if on products page
    const urlParams = new URLSearchParams(window.location.search);
    const category = urlParams.get('category');
    if (category) {
        loadProducts(category);
    }

    // Display cart if on cart page
    if (document.getElementById('cartItems')) {
        displayCart();
    }

    // Display featured stores on homepage (Bottom Section, Horizontal Scroll)
    if (document.getElementById('allStoresHorizontal')) {
        displayAllStoresHorizontal();

        // Populate Store Category Filter
        const storeCategoryFilter = document.getElementById('storeCategoryFilter');
        if (storeCategoryFilter) {
            fetch(`${API_BASE}/api/categories`)
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        data.categories.forEach(cat => {
                            const opt = document.createElement('option');
                            opt.value = cat.slug;
                            opt.textContent = cat.name;
                            storeCategoryFilter.appendChild(opt);
                        });
                    }
                })
                .catch(e => console.error('Error loading filter categories:', e));
        }

        // Filter Event Listeners
        const storeSearch = document.getElementById('storeSearch');
        const clearStoreFiltersBtn = document.getElementById('clearStoreFiltersBtn');

        const applyStoreFilters = () => {
            const search = storeSearch ? storeSearch.value : '';
            const category = storeCategoryFilter ? storeCategoryFilter.value : '';
            // Use the new handleStoreSearch function
            handleStoreSearch({ search, category });
        };

        if (storeSearch) {
            storeSearch.addEventListener('input', applyStoreFilters);
        }
        if (storeCategoryFilter) {
            storeCategoryFilter.addEventListener('change', applyStoreFilters);
        }
        if (clearStoreFiltersBtn) {
            clearStoreFiltersBtn.addEventListener('click', () => {
                if (storeSearch) storeSearch.value = '';
                if (storeCategoryFilter) storeCategoryFilter.value = '';
                applyStoreFilters();
            });
        }
    }

    // Form submission
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');

    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    if (registerForm) {
        registerForm.addEventListener('submit', handleRegister);
    }

    // Other forms
    const otherForms = document.querySelectorAll('form:not(#loginForm):not(#registerForm)');
    otherForms.forEach(form => {
        form.addEventListener('submit', function(e) {
            if (!validateForm(form.id)) {
                e.preventDefault();
                showWarning('Incomplete Form', 'Please fill in all required fields.');
            }
        });
    });
});
