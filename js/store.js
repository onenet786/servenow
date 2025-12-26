const productVariantsMap = {};

// Get store ID from URL
function getStoreId() {
    const urlParams = new URLSearchParams(window.location.search);
    return parseInt(urlParams.get('id'));
}

// Get variant label (size + unit)
function getVariantLabel(variant) {
    if (!variant) return '';
    const parts = [];
    if (variant.size_label) parts.push(variant.size_label);
    if (variant.unit_name) parts.push(variant.unit_name);
    return parts.length > 0 ? parts.join(' ') : 'Default';
}

// Display store information
function displayStoreInfo(store) {
    if (!store) {
        document.getElementById('storeInfo').innerHTML = '<h2>Store not found</h2>';
        return;
    }

    document.getElementById('storeTitle').textContent = `${store.name} - ServeNow`;
    
    let logoSrc = 'https://via.placeholder.com/100x100/667eea/ffffff?text=' + encodeURIComponent(store.name.substring(0, 1));
    if (store.image_url) {
        let url = String(store.image_url).trim().replace(/\\/g, '/');
        if (/^https?:\/\//i.test(url) || url.toLowerCase().startsWith('data:')) {
            logoSrc = url;
        } else if (url.startsWith('/')) {
            logoSrc = API_BASE.replace(/\/$/, '') + url;
        } else {
            logoSrc = API_BASE.replace(/\/$/, '') + '/' + url.replace(/^\/+/, '');
        }
    }
    
    document.getElementById('storeInfo').innerHTML = `
        <div class="store-info-content">
            <img src="${logoSrc}" alt="${store.name}" class="store-logo" onerror="this.src='https://via.placeholder.com/100x100/667eea/ffffff?text=S'">
            <div class="store-details">
                <h2>${store.name}</h2>
                <p><i class="fas fa-map-marker-alt"></i> ${store.location || 'Location not available'}</p>
                <p><i class="fas fa-star"></i> ${(parseFloat(store.rating) || 0).toFixed(1)} Rating</p>
                <p><i class="fas fa-clock"></i> ${store.delivery_time || '30-45'} min delivery</p>
            </div>
        </div>
    `;
}

// Display products for the store
function displayStoreProducts(storeProducts) {
    const productGrid = document.getElementById('storeProducts');
    productGrid.innerHTML = '';
    const currentStoreId = getStoreId();

    if (!storeProducts || storeProducts.length === 0) {
        productGrid.innerHTML = '<p>No products available from this store.</p>';
        return;
    }

    storeProducts.forEach(product => {
        const productCard = document.createElement('div');
        productCard.className = 'product-card';

        let imageSrc = 'https://via.placeholder.com/200x150/E0E0E0/666666?text=No+Image';
        let variants = null;
        const rawImage = product.image_url || product.image;
        
        if (rawImage) {
            let url = String(rawImage).trim().replace(/\\/g, '/');
            if (/^https?:\/\//i.test(url) || url.toLowerCase().startsWith('data:')) {
                imageSrc = url;
            } else if (url.startsWith('/')) {
                imageSrc = API_BASE.replace(/\/$/, '') + url;
            } else {
                imageSrc = API_BASE.replace(/\/$/, '') + '/' + url.replace(/^\/+/, '');
            }
            variants = product.image_variants || product.variants || null;
        }

        const sizeVariants = product.size_variants || [];
        productVariantsMap[product.id] = sizeVariants;
        
        const defaultVariant = sizeVariants.length > 0 ? sizeVariants[0] : null;
        const displayPrice = defaultVariant ? defaultVariant.price : product.price;
        const displayVariantLabel = getVariantLabel(defaultVariant);
        const uniqueId = `product-${product.id}-variant`;

        let variantsHtml = '';
        if (sizeVariants.length > 1) {
            variantsHtml = `
                <div class="variant-selector">
                    <label class="variant-selector-label">Select variant:</label>
                    <div class="variant-options">
                        ${sizeVariants.map((variant, idx) => `
                            <label class="variant-option">
                                <input type="radio" name="${uniqueId}" value="${idx}" ${idx === 0 ? 'checked' : ''} 
                                    onchange="updateProductPrice(${product.id}, this.value)">
                                <span>${getVariantLabel(variant)}</span>
                            </label>
                        `).join('')}
                    </div>
                    <p class="variant-price" id="price-${product.id}">PKR ${displayPrice.toFixed(2)}</p>
                </div>
            `;
        } else if (sizeVariants.length === 1) {
            variantsHtml = `<p class="variant-label">${displayVariantLabel}</p><p class="price" id="price-${product.id}">PKR ${displayPrice.toFixed(2)}</p>`;
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
                <div class="product-info-left">
                    <h4>${product.name}</h4>
                    ${variantsHtml ? variantsHtml : `<p class="price" id="price-${product.id}">PKR ${displayPrice.toFixed(2)}</p>`}
                </div>
                <div class="product-controls-right">
                    <button class="add-to-cart" id="add-btn-${product.id}" onclick="addProductToCart(${product.id}, '${product.name.replace(/'/g, "\\'")}', ${currentStoreId}, '${imageSrc.replace(/'/g, "\\'")}')">
                        <i class="fas fa-plus"></i> Add
                    </button>
                </div>
            </div>
        `;
        productGrid.appendChild(productCard);
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

// Fetch store details and products from API
async function loadStoreDetails(storeId) {
    try {
        const response = await fetch(`${API_BASE}/api/stores/${storeId}`);
        const data = await response.json();

        if (data.success) {
            displayStoreInfo(data.store);
            displayStoreProducts(data.products);
        } else {
            document.getElementById('storeInfo').innerHTML = '<h2>Store not found</h2>';
        }
    } catch (error) {
        console.error('Error loading store:', error);
        document.getElementById('storeInfo').innerHTML = '<h2>Error loading store details</h2>';
    }
}

// Initialize store page
document.addEventListener('DOMContentLoaded', function() {
    const storeId = getStoreId();
    if (storeId) {
        loadStoreDetails(storeId);
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

// Update product price when variant changes
function updateProductPrice(productId, variantIndex) {
    const variants = productVariantsMap[productId];
    if (!variants || !variants[variantIndex]) return;
    
    const variant = variants[variantIndex];
    const priceElement = document.getElementById(`price-${productId}`);
    if (priceElement) {
        priceElement.textContent = `PKR ${variant.price.toFixed(2)}`;
    }
}

// Add product to cart with variant info
function addProductToCart(productId, productName, storeId, imageSrc) {
    const variants = productVariantsMap[productId] || [];
    const selectedVariantIndex = getSelectedVariantIndex(productId);
    const selectedVariant = variants.length > 0 ? variants[selectedVariantIndex || 0] : null;
    
    const cartItem = {
        id: productId,
        name: productName,
        price: selectedVariant ? selectedVariant.price : 0,
        quantity: 1,
        unit_id: selectedVariant ? selectedVariant.unit_id : null,
        unit_name: selectedVariant ? selectedVariant.unit_name : null,
        size_id: selectedVariant ? selectedVariant.size_id : null,
        size_label: selectedVariant ? selectedVariant.size_label : null,
        variant_label: selectedVariant ? getVariantLabel(selectedVariant) : null,
        image_url: imageSrc,
        storeId: storeId
    };
    
    addToCart(productId, productName, cartItem.price, 1, 
              cartItem.unit_name || '', cartItem.unit_id, imageSrc, storeId, cartItem);
}

// Get selected variant index for product
function getSelectedVariantIndex(productId) {
    const variants = productVariantsMap[productId] || [];
    if (variants.length <= 1) return 0;
    
    const uniqueId = `product-${productId}-variant`;
    const radioButton = document.querySelector(`input[name="${uniqueId}"]:checked`);
    if (radioButton) {
        return parseInt(radioButton.value);
    }
    return 0;
}
