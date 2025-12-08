// API Base URL
const API_BASE = window.location.protocol + '//' + window.location.host;

// Get store ID from URL
function getStoreId() {
    const urlParams = new URLSearchParams(window.location.search);
    return parseInt(urlParams.get('id'));
}

// Display store information
function displayStoreInfo(storeId) {
    const store = stores.find(s => s.id === storeId);
    if (!store) {
        document.getElementById('storeInfo').innerHTML = '<h2>Store not found</h2>';
        return;
    }

    document.getElementById('storeTitle').textContent = `${store.name} - ServeNow`;
    document.getElementById('storeInfo').innerHTML = `
        <h2>${store.name}</h2>
        <div class="store-details">
            <p><strong>Location:</strong> ${store.location}</p>
            <p><strong>Rating:</strong> ${store.rating} ⭐</p>
            <p><strong>Delivery Time:</strong> ${store.deliveryTime}</p>
        </div>
    `;
}

// Display products for the store
function displayStoreProducts(storeId) {
    const storeProducts = [];

    // Get all products that belong to this store
    Object.keys(products).forEach(category => {
        products[category].forEach(product => {
            if (product.storeId === storeId) {
                storeProducts.push(product);
            }
        });
    });

    const productGrid = document.getElementById('storeProducts');
    productGrid.innerHTML = '';

    if (storeProducts.length === 0) {
        productGrid.innerHTML = '<p>No products available from this store.</p>';
        return;
    }

    storeProducts.forEach(product => {
        const productCard = document.createElement('div');
        productCard.className = 'product-card';

        // Normalize image path and build <img> with optional srcset
        let imageSrc = 'https://via.placeholder.com/200x150/E0E0E0/666666?text=No+Image';
        let variants = null;
        if (product.image) {
            // Normalize backslashes and trim
            let url = String(product.image).trim().replace(/\\/g, '/');
            if (/^https?:\/\//i.test(url) || url.toLowerCase().startsWith('data:')) {
                imageSrc = url;
            } else if (url.startsWith('/')) {
                imageSrc = API_BASE.replace(/\/$/, '') + url;
            } else {
                imageSrc = API_BASE.replace(/\/$/, '') + '/' + url.replace(/^\/+/, '');
            }
            // if server provided variants mapping, use it
            variants = product.image_variants || product.variants || null;
        }

        productCard.innerHTML = `
            <div class="product-image">
                ${buildImgTagForStore(imageSrc, variants, product.name, product.id)}
            </div>
            <div class="product-card-content">
                <h4>${product.name}</h4>
                <p class="price">PKR ${product.price.toFixed(2)}</p>
                <button class="add-to-cart" onclick="addToCart(${product.id}, '${product.name}', ${product.price})">Add to Cart</button>
            </div>
        `;
        productGrid.appendChild(productCard);
    });
}

// Initialize store page
document.addEventListener('DOMContentLoaded', function() {
    const storeId = getStoreId();
    if (storeId) {
        displayStoreInfo(storeId);
        displayStoreProducts(storeId);
    } else {
        document.getElementById('storeInfo').innerHTML = '<h2>Invalid store ID</h2>';
    }
});
