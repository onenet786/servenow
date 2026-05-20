// Cart functionality (cart is global from app.js)

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

function updateCartCount() {
    const cartCount = document.getElementById('cartCount');
    if (cartCount) {
        cartCount.textContent = cart.length;
        if (cart.length > 0) {
            cartCount.style.display = 'inline-block';
        } else {
            cartCount.style.display = 'none';
        }
    }
}

// Calculate delivery fee based on number of unique stores
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

// Display cart items in checkout
async function displayCheckoutItems() {
    const checkoutItems = document.getElementById('checkoutItems');
    const checkoutTotal = document.getElementById('checkoutTotal');

    console.log('Displaying checkout items, cart:', cart);
    if (!checkoutItems) {
        showError('Error', 'Checkout items container not found');
        return;
    }

    checkoutItems.innerHTML = '<p style="text-align: center;">Loading order details...</p>';
    let grandTotal = 0;
    
    // Group items by store
    const storeGroups = {};
    const storeIds = new Set();
    
    cart.forEach(item => {
        const sId = item.storeId || 'unknown';
        if (!storeGroups[sId]) {
            storeGroups[sId] = [];
            if (sId !== 'unknown') storeIds.add(sId);
        }
        storeGroups[sId].push(item);
    });

    // Fetch store names if needed
    const storeNames = {};
    if (storeIds.size > 0) {
        try {
            // Fetch store details in parallel
            const promises = Array.from(storeIds).map(async (id) => {
                try {
                    const res = await fetch(`${API_BASE}/api/stores/${id}`);
                    const data = await res.json();
                    if (data.success && data.store) {
                        storeNames[id] = data.store.name;
                    }
                } catch (e) {
                    console.warn(`Failed to fetch store ${id}`, e);
                }
            });
            await Promise.all(promises);
        } catch (e) {
            console.error('Error fetching store names', e);
        }
    }

    checkoutItems.innerHTML = '';

    // Render groups
    const storeIdsList = Object.keys(storeGroups);
    const isMultiStore = storeIdsList.length > 1;
    const numStores = storeIdsList.length;
    const deliveryFee = calculateDeliveryFee(numStores);
    
    if (isMultiStore) {
         const summaryHeader = document.createElement('div');
         summaryHeader.innerHTML = `<div class="alert alert-info" style="margin-bottom: 15px; padding: 10px; background-color: #e3f2fd; border-radius: 5px; color: #0d47a1;"><strong>Multiple Stores Order:</strong> Your order will be split into separate deliveries. Total delivery charge: PKR ${deliveryFee.toFixed(2)}</div>`;
         checkoutItems.appendChild(summaryHeader);
    }

    storeIdsList.forEach(sId => {
        const items = storeGroups[sId];
        const storeName = storeNames[sId] || (sId === 'unknown' ? 'Unknown Store' : `Store #${sId}`);
        let storeSubtotal = 0;
        
        // Store Header
        const storeHeader = document.createElement('div');
        storeHeader.className = 'store-group-header';
        storeHeader.style.cssText = 'font-weight: bold; margin-top: 15px; margin-bottom: 10px; padding: 8px; background-color: #f5f5f5; border-radius: 4px; border-left: 4px solid var(--primary-color);';
        storeHeader.textContent = storeName;
        checkoutItems.appendChild(storeHeader);

        // Items container
        const itemsContainer = document.createElement('div');
        itemsContainer.style.cssText = 'margin-bottom: 10px;';
        
        items.forEach(item => {
            console.log('Item:', item);
            const itemTotal = typeof getCartItemTotal === 'function'
                ? getCartItemTotal(item)
                : parseFloat(item.price) * item.quantity;
            console.log('Item total:', itemTotal);
            storeSubtotal += itemTotal;
            const offerText = typeof isBxgyCartItem === 'function' && isBxgyCartItem(item)
                ? `<small style="display:block;color:#166534;font-weight:700;margin-top:3px;">${item.offerBadge || 'Bundle Offer'} - Pay ${getCartItemPaidQuantity(item)}, Free ${getCartItemFreeQuantity(item)}</small>`
                : '';
    
            const itemElement = document.createElement('div');
            itemElement.className = 'checkout-item';
            itemElement.style.cssText = 'display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee;';
            itemElement.innerHTML = `
                <span>${item.name} x ${item.quantity}${offerText}</span>
                <span>PKR ${itemTotal.toFixed(2)}</span>
            `;
            itemsContainer.appendChild(itemElement);
        });
        
        checkoutItems.appendChild(itemsContainer);

        // Store subtotal
        const storeSubtotalDiv = document.createElement('div');
        storeSubtotalDiv.style.cssText = 'display: flex; justify-content: space-between; padding: 8px 0; font-weight: 600; margin-bottom: 8px; color: var(--text-dark);';
        storeSubtotalDiv.innerHTML = `
            <span>Subtotal (${storeName}):</span>
            <span>PKR ${storeSubtotal.toFixed(2)}</span>
        `;
        checkoutItems.appendChild(storeSubtotalDiv);

        grandTotal += storeSubtotal;
    });

    // Single delivery fee for entire order
    const deliveryDiv = document.createElement('div');
    deliveryDiv.style.cssText = 'display: flex; justify-content: space-between; padding: 8px 0; color: #666; margin-top: 12px; margin-bottom: 12px; border-top: 1px solid #eee; padding-top: 12px; border-bottom: 2px solid #eee; padding-bottom: 12px;';
    deliveryDiv.innerHTML = `
        <span>Total Delivery Charge (${numStores} store${numStores > 1 ? 's' : ''}):</span>
        <span>PKR ${deliveryFee.toFixed(2)}</span>
    `;
    checkoutItems.appendChild(deliveryDiv);
    grandTotal += deliveryFee;

    console.log('Grand Total:', grandTotal);
    if (checkoutTotal) {
        checkoutTotal.innerHTML = `
            <div style="display: flex; justify-content: space-between; font-size: 18px; font-weight: 700; color: var(--primary-color); padding-top: 12px;">
                <span>Grand Total</span>
                <span>PKR ${grandTotal.toFixed(2)}</span>
            </div>
        `;
    }
}

// Handle payment method selection
async function handlePaymentMethodChange() {
    const paymentMethod = document.getElementById('paymentMethod');
    const cardDetails = document.getElementById('cardDetails');
    const walletBalanceInfo = document.getElementById('walletBalanceInfo');

    if (paymentMethod.value === 'card') {
        cardDetails.style.display = 'block';
        if (walletBalanceInfo) walletBalanceInfo.style.display = 'none';
        // Make card fields required
        document.getElementById('cardNumber').required = true;
        document.getElementById('expiryDate').required = true;
        document.getElementById('cvv').required = true;
    } else if (paymentMethod.value === 'wallet') {
        cardDetails.style.display = 'none';
        // Remove required from card fields
        document.getElementById('cardNumber').required = false;
        document.getElementById('expiryDate').required = false;
        document.getElementById('cvv').required = false;
        
        // Fetch and show wallet balance
        await showWalletBalance();
    } else {
        cardDetails.style.display = 'none';
        if (walletBalanceInfo) walletBalanceInfo.style.display = 'none';
        // Remove required from card fields
        document.getElementById('cardNumber').required = false;
        document.getElementById('expiryDate').required = false;
        document.getElementById('cvv').required = false;
    }
}

async function showWalletBalance() {
    const authToken = localStorage.getItem('serveNowToken');
    if (!authToken) return;

    let walletBalanceInfo = document.getElementById('walletBalanceInfo');
    if (!walletBalanceInfo) {
        walletBalanceInfo = document.createElement('div');
        walletBalanceInfo.id = 'walletBalanceInfo';
        walletBalanceInfo.className = 'wallet-balance-info';
        document.getElementById('paymentMethod').parentNode.appendChild(walletBalanceInfo);
    }

    walletBalanceInfo.style.display = 'block';
    walletBalanceInfo.innerHTML = 'Loading balance...';

    try {
        const response = await fetch(`${API_BASE}/api/wallet/balance`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();

        if (data.success && data.wallet) {
            const balance = parseFloat(data.wallet.balance);
            const total = calculateTotal();
            const isInsufficient = balance < total;
            
            walletBalanceInfo.innerHTML = `
                <div class="balance-container ${isInsufficient ? 'insufficient' : 'sufficient'}">
                    <span>Your Balance: <strong>PKR ${balance.toFixed(2)}</strong></span>
                    ${isInsufficient ? '<br><span class="error-text">Insufficient balance. <a href="wallet.html">Top up here</a></span>' : ''}
                </div>
            `;
        } else {
            walletBalanceInfo.innerHTML = 'Failed to load wallet balance';
        }
    } catch (error) {
        console.error('Error fetching wallet balance:', error);
        walletBalanceInfo.innerHTML = 'Error loading wallet balance';
    }
}

function calculateTotal() {
    let total = 0;
    const storeIds = new Set();
    
    cart.forEach(item => {
        total += typeof getCartItemTotal === 'function'
            ? getCartItemTotal(item)
            : parseFloat(item.price) * item.quantity;
        if (item.storeId && item.storeId !== 'unknown') {
            storeIds.add(item.storeId);
        }
    });
    
    const numStores = storeIds.size > 0 ? storeIds.size : 1;
    const deliveryFee = calculateDeliveryFee(numStores);
    
    return total + deliveryFee;
}

function setCheckoutBlockedState(blocked, message) {
    const form = document.getElementById('checkoutForm');
    if (!form) return;
    const submitBtn = form.querySelector('button[type="submit"]');
    let banner = document.getElementById('checkoutDeliveryBlockMessage');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'checkoutDeliveryBlockMessage';
        banner.style.cssText = 'display:none; margin: 0 0 1rem 0; padding: 0.75rem; border-radius: 8px; background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; font-weight: 600;';
        form.insertBefore(banner, form.firstChild);
    }
    if (blocked) {
        banner.textContent = message || 'Delivery is temporarily unavailable in this period.';
        banner.style.display = 'block';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Ordering Disabled for This Period';
        }
    } else {
        banner.style.display = 'none';
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Place Order';
        }
    }
}

async function refreshCheckoutOrderingGuard() {
    try {
        if (typeof loadGlobalDeliveryWidget === 'function') {
            await loadGlobalDeliveryWidget(true);
        }
        const guard = (typeof getOrderingGuardState === 'function')
            ? getOrderingGuardState()
            : { blocked: false, message: '' };
        setCheckoutBlockedState(!!guard.blocked, guard.message);
        return guard;
    } catch (error) {
        console.error('Failed to refresh ordering guard:', error);
        setCheckoutBlockedState(false, '');
        return { blocked: false, message: '' };
    }
}

// Handle checkout form submission
async function handleCheckoutSubmit(e) {
    e.preventDefault();

    const guardState = await refreshCheckoutOrderingGuard();
    if (guardState.blocked) {
        showWarning('Delivery Unavailable', guardState.message);
        return;
    }

    if (cart.length === 0) {
        showWarning('Empty Cart', 'Your cart is empty. Please add items before checkout.');
        return;
    }

    const formData = new FormData(e.target);
    // Get store_id from cart items (assuming all items are from same store due to add-to-cart check)
    // Fallback to 1 for legacy items or testing
    const storeId = (cart.length > 0 && cart[0].storeId) ? cart[0].storeId : 1;
    
    const orderData = {
        store_id: storeId,
        items: cart.map(item => ({
            product_id: item.id,
            quantity: item.quantity,
            size_id: item.sizeId || null,
            unit_id: item.unitId || null,
            variant_label: item.variantLabel || null
        })),
        delivery_address: formData.get('deliveryAddress'),
        delivery_time: formData.get('deliveryTime'),
        payment_method: formData.get('paymentMethod'),
        special_instructions: '' // Not implemented in form
    };

    if (orderData.payment_method === 'wallet') {
        try {
            const response = await fetch(`${API_BASE}/api/wallet/balance`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}` }
            });
            const data = await response.json();
            if (data.success && data.wallet) {
                const total = calculateTotal();
                const balance = parseFloat(data.wallet.balance);
                if (balance < total) {
                    const needed = (total - balance).toFixed(2);
                    showError('Insufficient Balance', `Your wallet balance is insufficient. Need PKR ${needed} more.`);
                    return;
                }
            }
        } catch (error) {
            console.error('Error checking balance during submit:', error);
            showError('Balance Check Failed', 'Could not verify wallet balance. Please try again.');
            return;
        }
    }

    try {
        const response = await fetch(`${API_BASE}/api/orders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('serveNowToken')}`
            },
            body: JSON.stringify(orderData)
        });

        const data = await response.json();
        if (data.success) {
            let msg = 'Order placed successfully!';
            if (data.orders && data.orders.length > 1) {
                msg = `Orders placed successfully! (${data.orders.length} separate orders created for different stores)`;
            } else if (data.order) {
                msg = 'Order placed successfully! Order number: ' + data.order.order_number;
            }
            showSuccess('Order Placed', msg);

            // Clear cart and redirect
            localStorage.removeItem('serveNowCart');
            cart = [];
            updateCartCount();

            // Redirect to order confirmation page or my orders
            if (data.orders && data.orders.length > 1) {
                // If multiple orders, go to order history to see them all
                // Or we could pass the first one to confirmation, but my-orders is better
                 setTimeout(() => {
                    window.location.href = 'my-orders.html';
                 }, 1500);
            } else if (data.order && data.order.order_number) {
                window.location.href = 'order-confirmation.html?order_number=' + encodeURIComponent(data.order.order_number);
            } else {
                window.location.href = 'order-confirmation.html';
            }
        } else {
            showError('Order Failed', 'Failed to place order: ' + data.message);
        }
    } catch (error) {
        console.error('Order placement error:', error);
        showError('Error', 'Failed to place order. Please try again.');
    }
}

// Pre-fill user information if logged in
async function prefillUserInfo() {
    let userData = localStorage.getItem('serveNowUser');
    if (!userData) {
        // For testing, set a test user
        const testUser = {
            first_name: 'Test',
            last_name: 'User',
            phone: '+1234567890',
            address: '123 Test Street, Test City'
        };
        localStorage.setItem('serveNowUser', JSON.stringify(testUser));
        userData = JSON.stringify(testUser);
        console.log('Using test user data');
    }

    try {
        const user = JSON.parse(userData);
        document.getElementById('fullName').value = `${user.first_name} ${user.last_name}`;
        document.getElementById('phone').value = user.phone || '';
        document.getElementById('deliveryAddress').value = user.address || '';
        console.log('Form prefilled');
    } catch (error) {
        console.error('Error parsing user data:', error);
    }

    const authToken = localStorage.getItem('serveNowToken');
    if (!authToken) {
        console.log('No auth token, using localStorage data');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/auth/me`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        console.log('Response status:', response.status);
        const data = await response.json();
        console.log('User data from API:', data);
        if (data.success) {
            const user = data.user;
            document.getElementById('fullName').value = `${user.first_name} ${user.last_name}`;
            document.getElementById('phone').value = user.phone || '';
            document.getElementById('deliveryAddress').value = user.address || '';
            console.log('Form updated from API');
        } else {
            console.log('Failed to get user data from API:', data.message);
        }
    } catch (error) {
        console.error('Error fetching user info from API:', error);
    }
}

// Initialize checkout page
document.addEventListener('DOMContentLoaded', function() {
    console.log('Cart length:', cart.length);
    loadDeliveryFeeConfig().finally(() => displayCheckoutItems());
    prefillUserInfo();

    // Payment method change handler
    const paymentMethod = document.getElementById('paymentMethod');
    if (paymentMethod) {
        paymentMethod.addEventListener('change', handlePaymentMethodChange);
    }

    // Checkout form submission
    const checkoutForm = document.getElementById('checkoutForm');
    if (checkoutForm) {
        checkoutForm.addEventListener('submit', handleCheckoutSubmit);
    }

    refreshCheckoutOrderingGuard();
    window.addEventListener('globalDeliveryStatusUpdated', () => {
        refreshCheckoutOrderingGuard();
    });
    setInterval(() => {
        refreshCheckoutOrderingGuard();
    }, 30000);

    // Note: Not redirecting if cart is empty for debugging
    // if (cart.length === 0) {
    //     console.log('Cart is empty, redirecting');
    //     alert('Your cart is empty. Redirecting to home page.');
    //     window.location.href = 'index.html';
    // }
});
