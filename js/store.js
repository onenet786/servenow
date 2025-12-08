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
                    ${buildImgTagForStore(imageSrc, variants, product.name, product.id, {
                        image_bg_r: product.image_bg_r,
                        image_bg_g: product.image_bg_g,
                        image_bg_b: product.image_bg_b,
                        image_overlay_alpha: product.image_overlay_alpha,
                        image_contrast: product.image_contrast
                    })}
                </div>
            <div class="product-card-content">
                <h4>${product.name}</h4>
                <p class="price">PKR ${product.price.toFixed(2)}</p>
                <button class="add-to-cart" onclick="addToCart(${product.id}, '${product.name}', ${product.price})">Add to Cart</button>
            </div>
        `;
        productGrid.appendChild(productCard);
        // Apply orientation fit or server-provided meta for cached images in this card
        productCard.querySelectorAll('img').forEach(img => {
            try {
                if (img.complete && img.naturalWidth && img.naturalHeight) {
                    if (img.dataset && (img.dataset.bgR || img.dataset.bgR === '0')) window.applyImageBgFromMeta(img);
                    else applyOrientationFitStore(img);
                }
            } catch (e) { /* ignore */ }
        });
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

// Helper to build img tag with srcset for store page
function buildImgTagForStore(src, variants, alt, pid, meta) {
    const safeAlt = (alt || '').replace(/"/g, '&quot;');
    const fallback = "https://via.placeholder.com/200x150/E0E0E0/666666?text=No+Image";
    if (variants && typeof variants === 'object') {
        const entries = Object.keys(variants).map(k => `${variants[k]} ${k}w`).join(', ');
        const widths = Object.keys(variants).map(n=>parseInt(n,10)).sort((a,b)=>a-b);
        const smallest = widths.length ? variants[widths[0]] : src;
        const dataAttrs = meta ? `data-bg-r="${meta.image_bg_r || ''}" data-bg-g="${meta.image_bg_g || ''}" data-bg-b="${meta.image_bg_b || ''}" data-overlay-alpha="${meta.image_overlay_alpha || ''}" data-contrast="${meta.image_contrast || ''}"` : '';
        return `<img src="${smallest || src || fallback}" srcset="${entries}" sizes="(max-width: 600px) 50vw, (max-width: 1200px) 33vw, 25vw" alt="${safeAlt}" ${dataAttrs} loading="lazy" decoding="async" onload="(function(i){ if(i.dataset && (i.dataset.bgR || i.dataset.bgR==='0')){ window.applyImageBgFromMeta(i); } else { applyOrientationFitStore(i); } })(this)" onerror="this.onerror=null;this.src='${fallback}'; console.warn('Store product image failed to load:', '${pid}', this.src)">`;
    }
    const dataAttrs = meta ? `data-bg-r="${meta.image_bg_r || ''}" data-bg-g="${meta.image_bg_g || ''}" data-bg-b="${meta.image_bg_b || ''}" data-overlay-alpha="${meta.image_overlay_alpha || ''}" data-contrast="${meta.image_contrast || ''}"` : '';
    return `<img src="${src || fallback}" alt="${safeAlt}" ${dataAttrs} loading="lazy" decoding="async" onload="(function(i){ if(i.dataset && (i.dataset.bgR || i.dataset.bgR==='0')){ window.applyImageBgFromMeta(i); } else { applyOrientationFitStore(i); } })(this)" onerror="this.onerror=null;this.src='${fallback}'; console.warn('Store product image failed to load:', '${pid}', this.src)">`;
}

// Orientation-aware fit for store page images
function applyOrientationFitStore(img) {
    try {
        if (!img) return;
        const apply = () => {
            const w = img.naturalWidth || 0;
            const h = img.naturalHeight || 0;
            img.classList.remove('fit-contain', 'fit-cover');
            if (h >= w) img.classList.add('fit-contain'); else img.classList.add('fit-cover');
            // apply matching background if helper available
            if (window.applyImageBgFromImage) {
                try { window.applyImageBgFromImage(img); } catch(e) { /* ignore */ }
            }
        };
        if (img.complete && img.naturalWidth && img.naturalHeight) apply();
        else {
            const onLoad = function() { apply(); img.removeEventListener('load', onLoad); };
            img.addEventListener('load', onLoad);
        }
    } catch (e) { console.warn('applyOrientationFitStore failed', e); }
}
