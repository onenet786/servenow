// Admin Dashboard JavaScript
// Use full origin to avoid relative-path edge cases
// Expose a diagnostics object early so console helpers are always available
window._adminDiag = window._adminDiag || {};
// Prevent duplicate system tray notifications from notifications.js on admin pages.
window.__serveNowDisableSystemNotify = true;

// API_BASE, currentUser, and authToken are provided by app.js (loaded in admin.html)
let currentUserPermissions = new Set();

// Centralized State Management
const AppState = {
    orders: [],
    products: [],
    accounts: [],
    stores: [],
    categories: [],
    riders: [],
    units: [],
    sizes: [],
    globalDeliveryStatus: null,
    livePromotions: null,
    storeOfferCampaigns: [],
    editingOfferCampaignId: null,
    customerFlashMessage: null,
    notificationCustomers: [],
    productStoreTermsById: {},
    productStoreDiscountById: {},
    productExpandedStores: new Set(),
    productItemCatalog: {
        loadedAt: 0,
        products: [],
        byId: {}
    },
    editing: {
        productId: null,
        accountId: null,
        accountOriginal: null,
        storeId: null,
        categoryId: null,
        riderId: null,
        unitId: null,
        sizeId: null
    },
    // Chart references
    charts: {
        status: null,
        revenue: null
    },
    // Sorting state for each table
    sort: {
        products: { column: 'id', direction: 'asc' },
        users: { column: 'id', direction: 'asc' },
        accounts: { column: 'id', direction: 'asc' },
        stores: { column: 'id', direction: 'asc' },
        categories: { column: 'id', direction: 'asc' },
        riders: { column: 'id', direction: 'asc' },
        orders: { column: 'order_number', direction: 'asc' },
        payments: { column: 'id', direction: 'asc' },
        wallets: { column: 'id', direction: 'asc' }
    }
};

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function canResetTerminalOrderToNew() {
    const email = String(currentUser?.email || '').trim().toLowerCase();
    return email === 'admin@servenow.com' || email === 'nazir@servenow.pk';
}

let __scheduledOrdersRefresh = null;

function scheduleOrdersRefresh(delay = 700) {
    if (__scheduledOrdersRefresh) return;
    __scheduledOrdersRefresh = window.setTimeout(() => {
        __scheduledOrdersRefresh = null;
        if (typeof window.loadOrders === 'function') {
            window.loadOrders();
        }
    }, delay);
}

function formatRiderCoordinateLabel(order) {
    const latitude = Number.parseFloat(order?.rider_latitude);
    const longitude = Number.parseFloat(order?.rider_longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return '';
    }
    return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
}

function buildRiderLocationHtml(order) {
    const locationLabel = String(order?.rider_location || '').trim();
    const coordinateLabel = formatRiderCoordinateLabel(order);

    if (locationLabel) {
        return `
            <span class="orders-location-line">${escapeHtml(locationLabel)}</span>
            ${coordinateLabel ? `<span class="orders-cell-meta">${escapeHtml(coordinateLabel)}</span>` : ''}
        `;
    }

    if (coordinateLabel) {
        return `<span class="orders-location-line">${escapeHtml(coordinateLabel)}</span>`;
    }

    return `<span class="orders-location-line">N/A</span>`;
}

function toDateTimeLocalValue(rawValue) {
    if (!rawValue) return '';
    const dt = new Date(rawValue);
    if (Number.isNaN(dt.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function nowDateTimeLocalValue() {
    return toDateTimeLocalValue(new Date());
}

function formatDeliveryWindowText(startRaw, endRaw) {
    if (!startRaw || !endRaw) return '';
    const start = new Date(startRaw);
    const end = new Date(endRaw);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';
    return `${start.toLocaleString()} - ${end.toLocaleString()}`;
}

function buildDeliveryMessageWithWindow(message, startRaw, endRaw) {
    const reason = (message || '').trim();
    const when = formatDeliveryWindowText(startRaw, endRaw);
    if (reason && when) return `${reason} (${when})`;
    if (reason) return reason;
    if (when) return `Delivery update: ${when}`;
    return 'No message set.';
}

function parseCustomerIdsInput(rawValue) {
    return String(rawValue || '')
        .split(',')
        .map(v => parseInt(String(v).trim(), 10))
        .filter(n => Number.isInteger(n) && n > 0);
}

function getSelectedGlobalDeliveryCustomerIds() {
    const sel = document.getElementById('globalDeliveryCustomerSelect');
    if (!sel) return [];
    return Array.from(sel.selectedOptions || [])
        .map(opt => parseInt(String(opt.value || '').trim(), 10))
        .filter(n => Number.isInteger(n) && n > 0);
}

async function loadGlobalDeliveryNotificationCustomers() {
    const sel = document.getElementById('globalDeliveryCustomerSelect');
    if (!sel) return;
    if (AppState.notificationCustomers && AppState.notificationCustomers.length) {
        return;
    }
    try {
        sel.innerHTML = '<option value="">Loading customers...</option>';
        const response = await fetch(`${API_BASE}/api/stores/notification-customers`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            sel.innerHTML = '<option value="">Failed to load customers</option>';
            return;
        }
        const customers = Array.isArray(data.customers) ? data.customers : [];
        AppState.notificationCustomers = customers;
        sel.innerHTML = '';
        customers.forEach((c) => {
            const id = parseInt(String(c.id || '').trim(), 10);
            if (!Number.isInteger(id) || id <= 0) return;
            const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || `Customer ${id}`;
            const email = String(c.email || '').trim();
            const phone = String(c.phone || '').trim();
            const extra = [email, phone].filter(Boolean).join(' | ');
            const label = extra ? `${name} (#${id}) - ${extra}` : `${name} (#${id})`;
            const opt = document.createElement('option');
            opt.value = String(id);
            opt.textContent = label;
            sel.appendChild(opt);
        });
        if (!customers.length) {
            sel.innerHTML = '<option value="">No active customers found</option>';
        }
    } catch (error) {
        console.error('Error loading notification customers:', error);
        sel.innerHTML = '<option value="">Failed to load customers</option>';
    }
}

function populateCustomerSelect(selectId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const customers = Array.isArray(AppState.notificationCustomers) ? AppState.notificationCustomers : [];
    sel.innerHTML = '';
    customers.forEach((c) => {
        const id = parseInt(String(c.id || '').trim(), 10);
        if (!Number.isInteger(id) || id <= 0) return;
        const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || `Customer ${id}`;
        const email = String(c.email || '').trim();
        const phone = String(c.phone || '').trim();
        const extra = [email, phone].filter(Boolean).join(' | ');
        const label = extra ? `${name} (#${id}) - ${extra}` : `${name} (#${id})`;
        const opt = document.createElement('option');
        opt.value = String(id);
        opt.textContent = label;
        sel.appendChild(opt);
    });
    if (!customers.length) {
        sel.innerHTML = '<option value="">No active customers found</option>';
    }
}

function getSelectedCustomerIdsBySelectId(selectId) {
    const sel = document.getElementById(selectId);
    if (!sel) return [];
    return Array.from(sel.selectedOptions || [])
        .map(opt => parseInt(String(opt.value || '').trim(), 10))
        .filter(n => Number.isInteger(n) && n > 0);
}

function setSelectedCustomerIdsBySelectId(selectId, ids) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const wanted = new Set((Array.isArray(ids) ? ids : [])
        .map((v) => parseInt(String(v), 10))
        .filter((v) => Number.isInteger(v) && v > 0)
        .map(String));
    Array.from(sel.options || []).forEach((opt) => {
        opt.selected = wanted.has(String(opt.value || '').trim());
    });
}

async function loadNotificationCustomersIfNeeded() {
    if (AppState.notificationCustomers && AppState.notificationCustomers.length) {
        return;
    }
    const response = await fetch(`${API_BASE}/api/stores/notification-customers`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await response.json();
    if (response.ok && data.success && Array.isArray(data.customers)) {
        AppState.notificationCustomers = data.customers;
    }
}

function updateGlobalDeliveryPushControls() {
    const targetEl = document.getElementById('globalDeliveryNotificationTarget');
    const customerWrap = document.getElementById('globalDeliveryCustomerSelectWrap');
    const sendPushEl = document.getElementById('globalDeliverySendPush');
    const pushTitleWrap = document.getElementById('globalDeliveryPushTitle')?.closest('.form-group');
    const pushMessageWrap = document.getElementById('globalDeliveryPushMessage')?.closest('.form-group');
    const customTarget = (targetEl?.value || 'all') === 'custom';
    const sendPush = !!sendPushEl?.checked;
    if (customerWrap) customerWrap.style.display = customTarget ? '' : 'none';
    if (pushTitleWrap) pushTitleWrap.style.display = sendPush ? '' : 'none';
    if (pushMessageWrap) pushMessageWrap.style.display = sendPush ? '' : 'none';
    if (customTarget) {
        loadGlobalDeliveryNotificationCustomers().then(() => {
            populateCustomerSelect('globalDeliveryCustomerSelect');
        });
    }
}

function updateBroadcastPushControls() {
    const targetEl = document.getElementById('broadcastPushTarget');
    const customerWrap = document.getElementById('broadcastPushCustomerWrap');
    const customTarget = (targetEl?.value || 'all') === 'custom';
    if (customerWrap) customerWrap.style.display = customTarget ? '' : 'none';
    if (customTarget) {
        loadNotificationCustomersIfNeeded().then(() => {
            populateCustomerSelect('broadcastPushCustomerSelect');
        }).catch((e) => console.error('Error loading customers for broadcast push:', e));
    }
}

async function sendAppUpdatePushNotification() {
    const sendBtn = document.getElementById('sendAppUpdatePushBtn');
    const audience = (document.getElementById('appUpdateAudience')?.value || 'all').trim() || 'all';
    const version = (document.getElementById('appUpdateVersion')?.value || '').trim();
    const title = (document.getElementById('appUpdateTitle')?.value || '').trim() || 'App Update Available';
    const message = (document.getElementById('appUpdateMessage')?.value || '').trim();
    const playStoreUrl = (document.getElementById('appUpdatePlayStoreUrl')?.value || '').trim();

    if (!message.length) {
        showWarning('Missing Message', 'Please enter update message.');
        return;
    }

    const payload = {
        audience,
        version,
        title,
        message,
        play_store_url: playStoreUrl
    };

    try {
        if (sendBtn) {
            sendBtn.disabled = true;
            sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
        }
        const response = await fetch(`${API_BASE}/api/stores/app-update-notification`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            showError('Send Failed', data.message || 'Failed to send app update notification');
            return;
        }
        showSuccess('Sent', `App update push sent to ${data.push_notification?.pushed_count || 0} installed app users.`);
        const versionEl = document.getElementById('appUpdateVersion');
        const titleEl = document.getElementById('appUpdateTitle');
        const messageEl = document.getElementById('appUpdateMessage');
        const urlEl = document.getElementById('appUpdatePlayStoreUrl');
        const audienceEl = document.getElementById('appUpdateAudience');
        if (versionEl) versionEl.value = '';
        if (titleEl) titleEl.value = '';
        if (messageEl) messageEl.value = '';
        if (urlEl) urlEl.value = '';
        if (audienceEl) audienceEl.value = 'all';
    } catch (error) {
        console.error('Error sending app update push notification:', error);
        showError('Send Failed', 'Failed to send app update notification');
    } finally {
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.innerHTML = '<i class="fas fa-download"></i> Send App Update Push';
        }
    }
}

async function sendBroadcastPushNotification() {
    const sendBtn = document.getElementById('sendBroadcastPushBtn');
    const title = (document.getElementById('broadcastPushTitle')?.value || '').trim();
    const message = (document.getElementById('broadcastPushMessage')?.value || '').trim();
    const category = (document.getElementById('broadcastPushCategory')?.value || 'general').trim() || 'general';
    const target = (document.getElementById('broadcastPushTarget')?.value || 'all') === 'custom' ? 'custom' : 'all';
    const customerIds = getSelectedCustomerIdsBySelectId('broadcastPushCustomerSelect');

    if (!title.length) {
        showWarning('Missing Title', 'Please enter push title.');
        return;
    }
    if (!message.length) {
        showWarning('Missing Message', 'Please enter push message.');
        return;
    }
    if (target === 'custom' && !customerIds.length) {
        showWarning('Missing Customers', 'Please select at least one customer.');
        return;
    }

    const payload = {
        title,
        message,
        category,
        notification_target: target,
        customer_ids: target === 'custom' ? customerIds : []
    };

    try {
        if (sendBtn) {
            sendBtn.disabled = true;
            sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
        }
        const response = await fetch(`${API_BASE}/api/stores/customer-push-notification`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            showError('Send Failed', data.message || 'Failed to send push notification');
            return;
        }
        showSuccess('Sent', `Push notification sent to ${data.push_notification?.pushed_count || 0} customers.`);
        const titleEl = document.getElementById('broadcastPushTitle');
        const msgEl = document.getElementById('broadcastPushMessage');
        const targetEl = document.getElementById('broadcastPushTarget');
        const selEl = document.getElementById('broadcastPushCustomerSelect');
        if (titleEl) titleEl.value = '';
        if (msgEl) msgEl.value = '';
        if (targetEl) targetEl.value = 'all';
        if (selEl) Array.from(selEl.options || []).forEach((o) => { o.selected = false; });
        updateBroadcastPushControls();
    } catch (error) {
        console.error('Error sending broadcast push notification:', error);
        showError('Send Failed', 'Failed to send push notification');
    } finally {
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Push Notification';
        }
    }
}

function renderGlobalDeliveryPreview() {
    const preview = document.getElementById('globalDeliveryPreview');
    const enabledEl = document.getElementById('globalDeliveryEnabled');
    const titleEl = document.getElementById('globalDeliveryTitle');
    const messageEl = document.getElementById('globalDeliveryMessage');
    const startEl = document.getElementById('globalDeliveryStartAt');
    const endEl = document.getElementById('globalDeliveryEndAt');
    const blockOrderingEl = document.getElementById('globalDeliveryBlockOrdering');
    const stateEl = document.getElementById('globalDeliveryCurrentState');
    if (!preview || !enabledEl || !titleEl || !messageEl || !startEl || !endEl || !blockOrderingEl || !stateEl) return;

    const enabled = !!enabledEl.checked;
    const title = (titleEl.value || '').trim() || 'Delivery Update';
    const message = buildDeliveryMessageWithWindow(messageEl.value, startEl.value, endEl.value);
    const start = startEl.value ? new Date(startEl.value) : null;
    const end = endEl.value ? new Date(endEl.value) : null;
    const now = new Date();
    const inWindow = enabled && start && end && now >= start && now <= end;
    const blockOrdering = !!blockOrderingEl.checked;

    stateEl.className = `global-delivery-state ${inWindow ? 'state-unavailable' : 'state-available'}`;
    stateEl.textContent = inWindow ? 'Delivery Unavailable (Active)' : 'Delivery Available';

    const whenText = start && end ? `${start.toLocaleString()} - ${end.toLocaleString()}` : 'No time window selected';
    preview.innerHTML = `
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(message)}</p>
        <p><small><strong>Window:</strong> ${escapeHtml(whenText)}</small></p>
        <p><small><strong>Status:</strong> ${enabled ? 'Notice Enabled' : 'Notice Disabled'}</small></p>
        <p><small><strong>Ordering:</strong> ${blockOrdering ? 'Blocked during active window' : 'Allowed'}</small></p>
    `;
}

async function loadGlobalDeliveryStatus() {
    const enabledEl = document.getElementById('globalDeliveryEnabled');
    if (!enabledEl) return null;
    try {
        const response = await fetch(`${API_BASE}/api/stores/global-delivery-status`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        if (!data.success || !data.global_delivery_status) {
            return null;
        }
        const s = data.global_delivery_status;
        AppState.globalDeliveryStatus = s;
        document.getElementById('globalDeliveryEnabled').checked = !!s.is_enabled;
        document.getElementById('globalDeliveryTitle').value = s.title || '';
        document.getElementById('globalDeliveryMessage').value = s.status_message || '';
        document.getElementById('globalDeliveryBlockOrdering').checked = !!s.block_ordering;
        document.getElementById('globalDeliveryStartAt').value = toDateTimeLocalValue(s.start_at) || nowDateTimeLocalValue();
        document.getElementById('globalDeliveryEndAt').value = toDateTimeLocalValue(s.end_at) || nowDateTimeLocalValue();
        const targetEl = document.getElementById('globalDeliveryNotificationTarget');
        const customerIdsEl = document.getElementById('globalDeliveryCustomerIds');
        const customerSelectEl = document.getElementById('globalDeliveryCustomerSelect');
        const sendPushEl = document.getElementById('globalDeliverySendPush');
        const pushTitleEl = document.getElementById('globalDeliveryPushTitle');
        const pushMessageEl = document.getElementById('globalDeliveryPushMessage');
        if (targetEl) targetEl.value = 'all';
        if (customerIdsEl) customerIdsEl.value = '';
        if (customerSelectEl) Array.from(customerSelectEl.options || []).forEach((o) => { o.selected = false; });
        if (sendPushEl) sendPushEl.checked = false;
        if (pushTitleEl) pushTitleEl.value = s.title || '';
        if (pushMessageEl) pushMessageEl.value = s.status_message || '';
        updateGlobalDeliveryPushControls();
        renderGlobalDeliveryPreview();
        return s;
    } catch (error) {
        console.error('Error loading global delivery status:', error);
        return null;
    }
}

async function saveGlobalDeliveryStatus() {
    const enabledEl = document.getElementById('globalDeliveryEnabled');
    const titleEl = document.getElementById('globalDeliveryTitle');
    const messageEl = document.getElementById('globalDeliveryMessage');
    const startEl = document.getElementById('globalDeliveryStartAt');
    const endEl = document.getElementById('globalDeliveryEndAt');
    const saveBtn = document.getElementById('saveGlobalDeliveryStatusBtn');
    if (!enabledEl || !titleEl || !messageEl || !startEl || !endEl) return;

    if (!startEl.value) startEl.value = nowDateTimeLocalValue();
    if (!endEl.value) endEl.value = nowDateTimeLocalValue();

    const payload = {
        is_enabled: !!enabledEl.checked,
        block_ordering: !!document.getElementById('globalDeliveryBlockOrdering')?.checked,
        title: titleEl.value.trim(),
        status_message: messageEl.value.trim(),
        start_at: startEl.value || null,
        end_at: endEl.value || null,
        send_push_notification: !!document.getElementById('globalDeliverySendPush')?.checked,
        notification_target: (document.getElementById('globalDeliveryNotificationTarget')?.value || 'all') === 'custom' ? 'custom' : 'all',
        customer_ids: (() => {
            const selected = getSelectedGlobalDeliveryCustomerIds();
            if (selected.length) return selected;
            return parseCustomerIdsInput(document.getElementById('globalDeliveryCustomerIds')?.value || '');
        })(),
        push_title: (document.getElementById('globalDeliveryPushTitle')?.value || '').trim(),
        push_message: (document.getElementById('globalDeliveryPushMessage')?.value || '').trim()
    };

    if (payload.is_enabled && (!payload.start_at || !payload.end_at)) {
        showWarning('Missing Time Window', 'Please set both "from" and "to" time.');
        return;
    }
    if (payload.send_push_notification && payload.notification_target === 'custom' && !payload.customer_ids.length) {
        showWarning('Missing Customers', 'Select custom customer IDs or switch push target to all customers.');
        return;
    }

    try {
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }
        const response = await fetch(`${API_BASE}/api/stores/global-delivery-status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            showError('Save Failed', data.message || 'Failed to save global delivery status');
            return;
        }
        showSuccess('Saved', 'Website live delivery widget updated successfully.');
        await loadGlobalDeliveryStatus();
        try {
            localStorage.setItem('serveNowGlobalDeliveryStatusUpdatedAt', String(Date.now()));
            window.dispatchEvent(new CustomEvent('globalDeliveryStatusSaved'));
        } catch (_) {}
    } catch (error) {
        console.error('Error saving global delivery status:', error);
        showError('Save Failed', 'Failed to save global delivery status');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fas fa-bullhorn"></i> Save Live Widget';
        }
    }
}

function getLivePromoImagesFromForm() {
    const images = [];
    for (let i = 1; i <= 5; i++) {
        const value = (document.getElementById(`livePromoImage${i}`)?.value || '').trim();
        if (!value) continue;
        images.push(value);
    }
    return images.slice(0, 5);
}

function renderLivePromotionPreview() {
    const preview = document.getElementById('livePromoPreview');
    const enabledEl = document.getElementById('livePromoEnabled');
    const titleEl = document.getElementById('livePromoTitle');
    const messageEl = document.getElementById('livePromoMessage');
    const startEl = document.getElementById('livePromoStartAt');
    const endEl = document.getElementById('livePromoEndAt');
    const stateEl = document.getElementById('livePromoCurrentState');
    if (!preview || !enabledEl || !titleEl || !messageEl || !startEl || !endEl || !stateEl) return;

    const enabled = !!enabledEl.checked;
    const title = (titleEl.value || '').trim() || 'Live Promotions';
    const message = (messageEl.value || '').trim() || 'No event message set.';
    const images = getLivePromoImagesFromForm();
    const start = startEl.value ? new Date(startEl.value) : null;
    const end = endEl.value ? new Date(endEl.value) : null;
    const now = new Date();
    const active = !!(enabled && start && end && now >= start && now <= end);
    const whenText = start && end ? `${start.toLocaleString()} - ${end.toLocaleString()}` : 'No time window selected';

    stateEl.className = `global-delivery-state ${active ? 'state-unavailable' : 'state-available'}`;
    stateEl.textContent = active ? 'Active Now' : (enabled ? 'Scheduled' : 'Inactive');

    const thumbs = images.length
        ? `<div class="promo-preview-thumbs">${images.map((src, idx) => `<img src="${escapeHtml(src)}" alt="Widget ${idx + 1}" />`).join('')}</div>`
        : '<p><small>No images selected.</small></p>';

    preview.innerHTML = `
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(message)}</p>
        <p><small><strong>Window:</strong> ${escapeHtml(whenText)}</small></p>
        <p><small><strong>Images:</strong> ${images.length}/5</small></p>
        ${thumbs}
    `;
}

async function loadLivePromotions() {
    const enabledEl = document.getElementById('livePromoEnabled');
    if (!enabledEl) return null;
    try {
        const response = await fetch(`${API_BASE}/api/stores/live-promotions`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        if (!data.success || !data.live_promotions) return null;
        const p = data.live_promotions;
        AppState.livePromotions = p;
        document.getElementById('livePromoEnabled').checked = !!p.is_enabled;
        document.getElementById('livePromoTitle').value = p.title || '';
        document.getElementById('livePromoMessage').value = p.status_message || '';
        document.getElementById('livePromoStartAt').value = toDateTimeLocalValue(p.start_at) || nowDateTimeLocalValue();
        document.getElementById('livePromoEndAt').value = toDateTimeLocalValue(p.end_at) || nowDateTimeLocalValue();
        const images = Array.isArray(p.widget_images) ? p.widget_images : [];
        for (let i = 1; i <= 5; i++) {
            const el = document.getElementById(`livePromoImage${i}`);
            if (el) el.value = images[i - 1] || '';
        }
        renderLivePromotionPreview();
        return p;
    } catch (error) {
        console.error('Error loading live promotions:', error);
        return null;
    }
}

async function uploadLivePromoImage(slotNo) {
    const fileEl = document.getElementById(`livePromoImageFile${slotNo}`);
    const urlEl = document.getElementById(`livePromoImage${slotNo}`);
    const btn = document.getElementById(`uploadLivePromoImageBtn${slotNo}`);
    if (!fileEl || !urlEl || !fileEl.files || !fileEl.files[0]) {
        showWarning('Missing File', 'Please select an image first.');
        return;
    }
    const fd = new FormData();
    fd.append('image', fileEl.files[0]);
    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
        }
        const response = await fetch(`${API_BASE}/api/admin/upload-image`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
            body: fd
        });
        const data = await response.json();
        if (!response.ok || !data.success || !data.image_url) {
            showError('Upload Failed', data.message || 'Failed to upload image');
            return;
        }
        urlEl.value = data.image_url;
        fileEl.value = '';
        renderLivePromotionPreview();
        showSuccess('Uploaded', `Widget ${slotNo} image uploaded`);
    } catch (error) {
        console.error('Error uploading live promo image:', error);
        showError('Upload Failed', 'Failed to upload image');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-upload"></i> Upload';
        }
    }
}

async function saveLivePromotions() {
    const enabledEl = document.getElementById('livePromoEnabled');
    const titleEl = document.getElementById('livePromoTitle');
    const messageEl = document.getElementById('livePromoMessage');
    const startEl = document.getElementById('livePromoStartAt');
    const endEl = document.getElementById('livePromoEndAt');
    const saveBtn = document.getElementById('saveLivePromoStatusBtn');
    if (!enabledEl || !titleEl || !messageEl || !startEl || !endEl) return;

    if (!startEl.value) startEl.value = nowDateTimeLocalValue();
    if (!endEl.value) endEl.value = nowDateTimeLocalValue();
    const payload = {
        is_enabled: !!enabledEl.checked,
        title: titleEl.value.trim(),
        status_message: messageEl.value.trim(),
        start_at: startEl.value || null,
        end_at: endEl.value || null,
        widget_images: getLivePromoImagesFromForm()
    };
    if (payload.is_enabled && (!payload.start_at || !payload.end_at)) {
        showWarning('Missing Time Window', 'Please set both "from" and "to" time.');
        return;
    }
    if (payload.is_enabled && !payload.widget_images.length) {
        showWarning('Missing Widgets', 'Please upload at least one live widget image.');
        return;
    }
    try {
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }
        const response = await fetch(`${API_BASE}/api/stores/live-promotions`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            showError('Save Failed', data.message || 'Failed to save promotions/events');
            return;
        }
        showSuccess('Saved', 'Promotions / events live widgets updated.');
        await loadLivePromotions();
        try {
            localStorage.setItem('serveNowLivePromotionsUpdatedAt', String(Date.now()));
            window.dispatchEvent(new CustomEvent('livePromotionsSaved'));
        } catch (_) {}
    } catch (error) {
        console.error('Error saving live promotions:', error);
        showError('Save Failed', 'Failed to save promotions/events');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fas fa-images"></i> Save Promotions / Events';
        }
    }
}

function bindLivePromotionControls() {
    const saveBtn = document.getElementById('saveLivePromoStatusBtn');
    if (saveBtn && !saveBtn.dataset.boundClick) {
        saveBtn.addEventListener('click', saveLivePromotions);
        saveBtn.dataset.boundClick = '1';
    }

    ['livePromoEnabled', 'livePromoTitle', 'livePromoMessage', 'livePromoStartAt', 'livePromoEndAt']
        .forEach((id) => {
            const el = document.getElementById(id);
            if (el && !el.dataset.boundPreview) {
                el.addEventListener('input', renderLivePromotionPreview);
                el.addEventListener('change', renderLivePromotionPreview);
                el.dataset.boundPreview = '1';
            }
        });

    for (let i = 1; i <= 5; i++) {
        const uploadBtn = document.getElementById(`uploadLivePromoImageBtn${i}`);
        if (uploadBtn && !uploadBtn.dataset.boundClick) {
            uploadBtn.addEventListener('click', () => uploadLivePromoImage(i));
            uploadBtn.dataset.boundClick = '1';
        }
        const clearBtn = document.getElementById(`clearLivePromoImageBtn${i}`);
        if (clearBtn && !clearBtn.dataset.boundClick) {
            clearBtn.addEventListener('click', () => {
                const urlEl = document.getElementById(`livePromoImage${i}`);
                const fileEl = document.getElementById(`livePromoImageFile${i}`);
                if (urlEl) urlEl.value = '';
                if (fileEl) fileEl.value = '';
                renderLivePromotionPreview();
            });
            clearBtn.dataset.boundClick = '1';
        }
        const urlEl = document.getElementById(`livePromoImage${i}`);
        if (urlEl && !urlEl.dataset.boundPreview) {
            urlEl.addEventListener('input', renderLivePromotionPreview);
            urlEl.addEventListener('change', renderLivePromotionPreview);
            urlEl.dataset.boundPreview = '1';
        }
    }
}

function updateCustomerFlashControls() {
    const targetEl = document.getElementById('customerFlashTarget');
    const customerWrap = document.getElementById('customerFlashCustomerWrap');
    const sendPushEl = document.getElementById('customerFlashSendPush');
    const pushTitleWrap = document.getElementById('customerFlashPushTitle')?.closest('.form-group');
    const pushMessageWrap = document.getElementById('customerFlashPushMessage')?.closest('.form-group');
    const customTarget = (targetEl?.value || 'all') === 'custom';
    const sendPush = !!sendPushEl?.checked;
    if (customerWrap) customerWrap.style.display = customTarget ? '' : 'none';
    if (pushTitleWrap) pushTitleWrap.style.display = sendPush ? '' : 'none';
    if (pushMessageWrap) pushMessageWrap.style.display = sendPush ? '' : 'none';
    if (customTarget) {
        loadNotificationCustomersIfNeeded().then(() => {
            populateCustomerSelect('customerFlashCustomerSelect');
            const ids = Array.isArray(AppState.customerFlashMessage?.customer_ids)
                ? AppState.customerFlashMessage.customer_ids
                : [];
            setSelectedCustomerIdsBySelectId('customerFlashCustomerSelect', ids);
        }).catch((e) => console.error('Error loading customer flash recipients:', e));
    }
}

function renderCustomerFlashPreview() {
    const preview = document.getElementById('customerFlashPreview');
    const enabledEl = document.getElementById('customerFlashEnabled');
    const titleEl = document.getElementById('customerFlashTitle');
    const messageEl = document.getElementById('customerFlashMessage');
    const imageEl = document.getElementById('customerFlashImage');
    const startEl = document.getElementById('customerFlashStartAt');
    const endEl = document.getElementById('customerFlashEndAt');
    const targetEl = document.getElementById('customerFlashTarget');
    const stateEl = document.getElementById('customerFlashCurrentState');
    if (!preview || !enabledEl || !titleEl || !messageEl || !startEl || !endEl || !targetEl || !stateEl || !imageEl) return;

    const enabled = !!enabledEl.checked;
    const title = (titleEl.value || '').trim() || 'Flash Message';
    const message = (messageEl.value || '').trim() || 'No message set.';
    const imageUrl = (imageEl.value || '').trim();
    const target = (targetEl.value || 'all') === 'custom' ? 'Selected Customers' : 'All Customers';
    const start = startEl.value ? new Date(startEl.value) : null;
    const end = endEl.value ? new Date(endEl.value) : null;
    const now = new Date();
    const active = !!(enabled && start && end && now >= start && now <= end);
    const whenText = start && end ? `${start.toLocaleString()} - ${end.toLocaleString()}` : 'No time window selected';

    stateEl.className = `global-delivery-state ${active ? 'state-unavailable' : 'state-available'}`;
    stateEl.textContent = active ? 'Active Now' : (enabled ? 'Scheduled' : 'Inactive');
    preview.innerHTML = `
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(message)}</p>
        <p><small><strong>Target:</strong> ${escapeHtml(target)}</small></p>
        <p><small><strong>Window:</strong> ${escapeHtml(whenText)}</small></p>
        ${imageUrl ? `<p><small><strong>Image:</strong> ${escapeHtml(imageUrl)}</small></p>` : '<p><small><strong>Image:</strong> Not set</small></p>'}
    `;
}

async function loadCustomerFlashMessage() {
    const enabledEl = document.getElementById('customerFlashEnabled');
    if (!enabledEl) return null;
    try {
        const response = await fetch(`${API_BASE}/api/stores/customer-flash-message`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        if (!data.success || !data.customer_flash_message) return null;
        const s = data.customer_flash_message;
        AppState.customerFlashMessage = s;
        document.getElementById('customerFlashEnabled').checked = !!s.is_enabled;
        document.getElementById('customerFlashTitle').value = s.title || '';
        document.getElementById('customerFlashMessage').value = s.status_message || '';
        document.getElementById('customerFlashImage').value = s.image_url || '';
        document.getElementById('customerFlashStartAt').value = toDateTimeLocalValue(s.start_at) || nowDateTimeLocalValue();
        document.getElementById('customerFlashEndAt').value = toDateTimeLocalValue(s.end_at) || nowDateTimeLocalValue();
        document.getElementById('customerFlashTarget').value = s.notification_target === 'custom' ? 'custom' : 'all';
        document.getElementById('customerFlashSendPush').checked = false;
        document.getElementById('customerFlashPushTitle').value = s.title || '';
        document.getElementById('customerFlashPushMessage').value = s.status_message || '';
        updateCustomerFlashControls();
        setSelectedCustomerIdsBySelectId('customerFlashCustomerSelect', s.customer_ids || []);
        renderCustomerFlashPreview();
        return s;
    } catch (error) {
        console.error('Error loading customer flash message:', error);
        return null;
    }
}

async function uploadCustomerFlashImage() {
    const fileEl = document.getElementById('customerFlashImageFile');
    const urlEl = document.getElementById('customerFlashImage');
    const btn = document.getElementById('uploadCustomerFlashImageBtn');
    if (!fileEl || !urlEl || !fileEl.files || !fileEl.files[0]) {
        showWarning('Missing File', 'Please select an image first.');
        return;
    }
    const fd = new FormData();
    fd.append('image', fileEl.files[0]);
    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
        }
        const response = await fetch(`${API_BASE}/api/admin/upload-image`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
            body: fd
        });
        const data = await response.json();
        if (!response.ok || !data.success || !data.image_url) {
            showError('Upload Failed', data.message || 'Failed to upload image');
            return;
        }
        urlEl.value = data.image_url;
        fileEl.value = '';
        renderCustomerFlashPreview();
        showSuccess('Uploaded', 'Flash image uploaded');
    } catch (error) {
        console.error('Error uploading customer flash image:', error);
        showError('Upload Failed', 'Failed to upload image');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-upload"></i> Upload';
        }
    }
}

async function saveCustomerFlashMessage() {
    const enabledEl = document.getElementById('customerFlashEnabled');
    const titleEl = document.getElementById('customerFlashTitle');
    const messageEl = document.getElementById('customerFlashMessage');
    const imageEl = document.getElementById('customerFlashImage');
    const startEl = document.getElementById('customerFlashStartAt');
    const endEl = document.getElementById('customerFlashEndAt');
    const targetEl = document.getElementById('customerFlashTarget');
    const saveBtn = document.getElementById('saveCustomerFlashBtn');
    if (!enabledEl || !titleEl || !messageEl || !imageEl || !startEl || !endEl || !targetEl) return;

    if (!startEl.value) startEl.value = nowDateTimeLocalValue();
    if (!endEl.value) {
        const sdt = new Date(startEl.value || nowDateTimeLocalValue());
        if (!Number.isNaN(sdt.getTime())) {
            sdt.setHours(sdt.getHours() + 1);
            endEl.value = toDateTimeLocalValue(sdt);
        } else {
            endEl.value = nowDateTimeLocalValue();
        }
    }

    const payload = {
        is_enabled: !!enabledEl.checked,
        title: titleEl.value.trim(),
        status_message: messageEl.value.trim(),
        image_url: imageEl.value.trim(),
        start_at: null,
        end_at: null,
        notification_target: (targetEl.value || 'all') === 'custom' ? 'custom' : 'all',
        customer_ids: getSelectedCustomerIdsBySelectId('customerFlashCustomerSelect'),
        send_push_notification: !!document.getElementById('customerFlashSendPush')?.checked,
        push_title: (document.getElementById('customerFlashPushTitle')?.value || '').trim(),
        push_message: (document.getElementById('customerFlashPushMessage')?.value || '').trim()
    };
    if (payload.is_enabled) {
        payload.start_at = startEl.value || null;
        payload.end_at = endEl.value || null;
        if (payload.start_at && payload.end_at) {
            const sdt = new Date(payload.start_at);
            const edt = new Date(payload.end_at);
            if (!Number.isNaN(sdt.getTime()) && !Number.isNaN(edt.getTime()) && edt <= sdt) {
                const fixedEnd = new Date(sdt);
                fixedEnd.setHours(fixedEnd.getHours() + 1);
                payload.end_at = toDateTimeLocalValue(fixedEnd);
                endEl.value = payload.end_at;
            }
        }
    }
    if (payload.is_enabled && (!payload.start_at || !payload.end_at)) {
        showWarning('Missing Time Window', 'Please set both "from" and "to" time.');
        return;
    }
    if (payload.notification_target === 'custom' && !payload.customer_ids.length) {
        showWarning('Missing Customers', 'Please select at least one customer for custom target.');
        return;
    }

    try {
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }
        const response = await fetch(`${API_BASE}/api/stores/customer-flash-message`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            showError('Save Failed', data.message || 'Failed to save customer flash message');
            return;
        }
        showSuccess('Saved', 'Customer flash launch message updated.');
        await loadCustomerFlashMessage();
    } catch (error) {
        console.error('Error saving customer flash message:', error);
        showError('Save Failed', 'Failed to save customer flash message');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fas fa-bolt"></i> Save Launch Flash Message';
        }
    }
}

function bindCustomerFlashControls() {
    const saveBtn = document.getElementById('saveCustomerFlashBtn');
    if (saveBtn && !saveBtn.dataset.boundClick) {
        saveBtn.addEventListener('click', saveCustomerFlashMessage);
        saveBtn.dataset.boundClick = '1';
    }
    ['customerFlashEnabled', 'customerFlashTitle', 'customerFlashMessage', 'customerFlashImage', 'customerFlashStartAt', 'customerFlashEndAt']
        .forEach((id) => {
            const el = document.getElementById(id);
            if (el && !el.dataset.boundPreview) {
                el.addEventListener('input', renderCustomerFlashPreview);
                el.addEventListener('change', renderCustomerFlashPreview);
                el.dataset.boundPreview = '1';
            }
        });
    ['customerFlashTarget', 'customerFlashSendPush'].forEach((id) => {
        const el = document.getElementById(id);
        if (el && !el.dataset.boundCtrl) {
            el.addEventListener('change', updateCustomerFlashControls);
            el.dataset.boundCtrl = '1';
        }
    });
    const uploadBtn = document.getElementById('uploadCustomerFlashImageBtn');
    if (uploadBtn && !uploadBtn.dataset.boundClick) {
        uploadBtn.addEventListener('click', uploadCustomerFlashImage);
        uploadBtn.dataset.boundClick = '1';
    }
    const clearBtn = document.getElementById('clearCustomerFlashImageBtn');
    if (clearBtn && !clearBtn.dataset.boundClick) {
        clearBtn.addEventListener('click', () => {
            const imageEl = document.getElementById('customerFlashImage');
            const fileEl = document.getElementById('customerFlashImageFile');
            if (imageEl) imageEl.value = '';
            if (fileEl) fileEl.value = '';
            renderCustomerFlashPreview();
        });
        clearBtn.dataset.boundClick = '1';
    }
}

const PRODUCT_ITEM_CATALOG_TTL_MS = 2 * 60 * 1000;

const ADMIN_THEME_STORAGE_KEY = 'serveNowAdminTheme';
const ADMIN_THEME_DEFAULT = 'default';
const ADMIN_THEME_ALLOWED = new Set(['default', 'ocean', 'emerald', 'sunset', 'mint', 'pearl', 'rose', 'sky']);

function normalizeAdminTheme(themeName) {
    if (typeof themeName !== 'string') return ADMIN_THEME_DEFAULT;
    const value = themeName.trim().toLowerCase();
    return ADMIN_THEME_ALLOWED.has(value) ? value : ADMIN_THEME_DEFAULT;
}

function applyAdminTheme(themeName) {
    const theme = normalizeAdminTheme(themeName);
    if (theme === ADMIN_THEME_DEFAULT) {
        document.body.removeAttribute('data-theme');
    } else {
        document.body.setAttribute('data-theme', theme);
    }
    return theme;
}

function getSavedAdminTheme() {
    return normalizeAdminTheme(localStorage.getItem(ADMIN_THEME_STORAGE_KEY));
}

function saveAdminTheme(themeName) {
    const theme = normalizeAdminTheme(themeName);
    localStorage.setItem(ADMIN_THEME_STORAGE_KEY, theme);
    return theme;
}

function initializeThemeSettings() {
    const themeSelect = document.getElementById('themeSelect');
    const saveThemeBtn = document.getElementById('saveThemeBtn');
    if (!themeSelect || !saveThemeBtn) return;

    const savedTheme = getSavedAdminTheme();
    applyAdminTheme(savedTheme);
    themeSelect.value = savedTheme;

    themeSelect.addEventListener('change', () => {
        applyAdminTheme(themeSelect.value);
    });

    saveThemeBtn.addEventListener('click', () => {
        const saved = saveAdminTheme(themeSelect.value);
        applyAdminTheme(saved);
        if (typeof showSuccess === 'function') {
            showSuccess('Theme Saved', `Theme saved as ${saved}.`, 1800);
        }
    });
}

// Backward compatibility (optional, but good for transition)
// These getters allow existing code to work while we refactor usages
// Note: We cannot easily proxy local 'let' variables, so we will replace usages.


// ===== MODERN TOAST NOTIFICATION SYSTEM =====
function showToast(title, message, type = 'info', duration = 2000) {
    const toastContainer = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };
    
    const iconDiv = document.createElement('div');
    iconDiv.className = 'toast-icon';
    iconDiv.textContent = icons[type] || '•';
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'toast-content';
    
    const titleEl = document.createElement('h4');
    titleEl.className = 'toast-title';
    titleEl.textContent = title;
    
    const messageEl = document.createElement('p');
    messageEl.className = 'toast-message';
    messageEl.textContent = message;
    
    contentDiv.appendChild(titleEl);
    contentDiv.appendChild(messageEl);
    
    const progressDiv = document.createElement('div');
    progressDiv.className = 'toast-progress';
    
    toast.appendChild(iconDiv);
    toast.appendChild(contentDiv);
    toast.appendChild(progressDiv);
    
    toastContainer.appendChild(toast);
    
    // Auto-remove after duration
    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.add('removing');
            setTimeout(() => {
                if (toast.parentElement) {
                    toast.remove();
                }
            }, 300);
        }
    }, duration);
}

// Convenience functions for different toast types
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

function registerAdminRealtimeNotifications() {
    if (!window.ServeNowNotifications || typeof window.ServeNowNotifications.addEventListener !== 'function') {
        return;
    }

    window.__serveNowSystemNotifyDedup = window.__serveNowSystemNotifyDedup || new Map();
    window.__serveNowSystemNotifyHandler = function(title, body) {
        try {
            const safeTitle = String(title || '').trim();
            const safeBody = String(body || '').trim();
            const key = _buildAdminSystemNotifyClaimKey(safeTitle, safeBody, 'shared');
            const now = Date.now();
            const lastShownAt = window.__serveNowSystemNotifyDedup.get(key) || 0;
            if ((now - lastShownAt) < 10000) {
                return true;
            }
            window.__serveNowSystemNotifyDedup.set(key, now);
            const safeTag = `rt-${Math.abs(key.split('').reduce((a, c) => ((a * 31) + c.charCodeAt(0)) | 0, 7))}`;
            showStoreGraceSystemNotification(safeTitle || 'Notification', safeBody, safeTag, null).catch(() => {});
            return true;
        } catch (_e) {
            return false;
        }
    };

    window.ServeNowNotifications.removeEventListener('admin-dashboard');
    window.ServeNowNotifications.addEventListener('admin-dashboard', (data) => {
        const type = String(data.type || data.event || '').toLowerCase();

        if (type === 'connect') {
            showInfo('System', 'Connected to real-time server.');
            return;
        }

        if (type === 'heartbeat') {
            console.debug('Heartbeat received:', data.time);
            window._adminDiag.lastHeartbeat = new Date();
            return;
        }

        if (type === 'connect_error') {
            console.error('Socket connection error:', data.message || data);
            return;
        }

        if (type === 'new_user') {
            const activeTab = document.querySelector('.tab-link.active');
            if (activeTab) {
                const tabId = activeTab.getAttribute('data-tab');
                if (tabId === 'dashboard') {
                    if (typeof loadDashboardStats === 'function') loadDashboardStats();
                    if (typeof loadRecentActivity === 'function') loadRecentActivity();
                } else if (tabId === 'accounts') {
                    if (typeof loadAccounts === 'function') loadAccounts();
                }
            }
            return;
        }

        if (type === 'new_order') {
            const activeTab = document.querySelector('.tab-link.active');
            if (activeTab) {
                const tabId = activeTab.getAttribute('data-tab');
                if (tabId === 'dashboard') {
                    const todayTotalOrders = document.getElementById('todayTotalOrders');
                    if (todayTotalOrders) {
                        todayTotalOrders.textContent = parseInt(todayTotalOrders.textContent) + 1;
                    }
                    const allTotalOrders = document.getElementById('allTotalOrders');
                    if (allTotalOrders) {
                        allTotalOrders.textContent = parseInt(allTotalOrders.textContent) + 1;
                    }
                } else if (tabId === 'orders') {
                    if (typeof window.loadOrders === 'function') window.loadOrders();
                }
            }
            return;
        }

        if (type === 'order_assigned' || type === 'order_status_update' || type === 'payment_status_update') {
            if (typeof window.loadOrders === 'function') window.loadOrders();
            if (type === 'order_status_update' && document.getElementById('todayTotalOrders')) {
                loadDashboardStats();
            }
            return;
        }

        if (type === 'rider_location_update') {
            scheduleOrdersRefresh();
            return;
        }

        if (type === 'order_completed') {
            if (typeof window.loadOrders === 'function') window.loadOrders();
            if (typeof loadDashboardStats === 'function') loadDashboardStats();
        }
    });
}

// ===== REAL-TIME NOTIFICATIONS =====
let socket;
if (false && typeof io !== 'undefined') {
    socket = io();
    
    let __notifyRequested = false;
    const canSystemNotify = () => ('Notification' in window) && Notification.permission === 'granted';
    const ensureNotifyPermission = () => {
        if (!('Notification' in window)) return;
        if (Notification.permission === 'default' && !__notifyRequested) {
            __notifyRequested = true;
            try { Notification.requestPermission(); } catch (_e) {}
        }
    };
    const __systemNotifyDedup = new Map();
    const systemNotify = (title, body) => {
        ensureNotifyPermission();
        if (!canSystemNotify()) return false;
        const key = `${String(title || '').trim()}|${String(body || '').trim()}`;
        const now = Date.now();
        const last = __systemNotifyDedup.get(key) || 0;
        if ((now - last) < 3000) return true;
        __systemNotifyDedup.set(key, now);
        try {
            const safeTag = `rt-${Math.abs(key.split('').reduce((a, c) => ((a * 31) + c.charCodeAt(0)) | 0, 7))}`;
            // Use same robust path as Utilities test tray button.
            showStoreGraceSystemNotification(String(title || 'Notification'), String(body || ''), safeTag, null).catch(() => {});
            return true;
        } catch (_e) {
            return false;
        }
    };
    
    const identifyAdminSocket = () => {
        try {
            if (!socket || !socket.connected) return;
            if (!currentUser || !currentUser.id) return;
            const userType = (currentUser.user_type || 'admin').toString().toLowerCase();
            if (userType !== 'admin' && userType !== 'standard_user') return;
            socket.emit('identify_user', {
                user_id: currentUser.id,
                user_type: userType
            });
            console.debug('[admin] identify_user emitted:', currentUser.id, userType);
        } catch (e) {
            console.warn('[admin] identify_user emit failed:', e);
        }
    };

    socket.on('connect', () => {
        console.log('Connected to notification server. ID:', socket.id);
        ensureNotifyPermission();
        identifyAdminSocket();
        showInfo('System', 'Connected to real-time server.');
    });

    socket.on('heartbeat', (data) => {
        console.debug('Heartbeat received:', data.time);
        window._adminDiag.lastHeartbeat = new Date();
    });

    socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
    });

    socket.on('new_user', (data) => {
        const msg = `${data.first_name} ${data.last_name} (${data.user_type}) joined.`;
        if (!systemNotify('New User', msg)) showInfo('New User', msg, 2000);
        
        const activeTab = document.querySelector('.tab-link.active');
        if (activeTab) {
            const tabId = activeTab.getAttribute('data-tab');
            if (tabId === 'dashboard') {
                if (typeof loadDashboardStats === 'function') loadDashboardStats();
                if (typeof loadRecentActivity === 'function') loadRecentActivity();
            } else if (tabId === 'accounts') {
                if (typeof loadAccounts === 'function') loadAccounts();
            }
        }
    });

    socket.on('new_order', (data) => {
        const msg = `#${data.order_number} • PKR ${data.total_amount}`;
        if (!systemNotify('New Order', msg)) showSuccess('New Order', msg, 2000);
        
        // Update data if on relevant tab
        const activeTab = document.querySelector('.tab-link.active');
        if (activeTab) {
            const tabId = activeTab.getAttribute('data-tab');
            if (tabId === 'dashboard') {
                const todayTotalOrders = document.getElementById('todayTotalOrders');
                if (todayTotalOrders) {
                    todayTotalOrders.textContent = parseInt(todayTotalOrders.textContent) + 1;
                }
                const allTotalOrders = document.getElementById('allTotalOrders');
                if (allTotalOrders) {
                    allTotalOrders.textContent = parseInt(allTotalOrders.textContent) + 1;
                }
            } else if (tabId === 'orders') {
                if (typeof window.loadOrders === 'function') window.loadOrders();
            }
        }
    });

    socket.on('order_assigned', (data) => {
        const msg = `#${data.order_number} → ${data.rider_name}`;
        if (!systemNotify('Order Assigned', msg)) showSuccess('Order Assigned', msg, 2000);
        if (typeof window.loadOrders === 'function') window.loadOrders();
    });

    socket.on('order_status_update', (data) => {
        if (data.status === 'delivered') {
            const msg = `#${data.order_number} delivered`;
            if (!systemNotify('Delivered', msg)) showSuccess('Delivered', msg, 2000);
        }
        if (typeof window.loadOrders === 'function') window.loadOrders();
    });

    socket.on('payment_status_update', (data) => {
        if (data.payment_status === 'paid') {
            const msg = `#${data.order_number} payment received`;
            if (!systemNotify('Payment Received', msg)) showSuccess('Payment Received', msg, 2000);
        }
        if (typeof window.loadOrders === 'function') window.loadOrders();
    });

    socket.on('order_completed', (data) => {
        const msg = `#${data.order_number} delivered & paid`;
        if (!systemNotify('Order Completed', msg)) showSuccess('Order Completed', msg, 2000);
        if (typeof window.loadOrders === 'function') window.loadOrders();
        if (typeof loadDashboardStats === 'function') loadDashboardStats();
    });

    // Expose for post-login initialization.
    window._adminIdentifySocket = identifyAdminSocket;
}

// Initialize admin dashboard
document.addEventListener('DOMContentLoaded', function() {
    registerAdminRealtimeNotifications();
    // Apply saved theme and bind theme controls immediately.
    initializeThemeSettings();

    // Check if user is logged in and is admin
    authToken = localStorage.getItem('serveNowToken');
    // Debug: log token presence to help diagnose 401 issues
    try { console.debug('[admin] serveNowToken present:', !!authToken); } catch (e) { /* ignore */ }
    if (!authToken) {
        window.location.href = 'login.html';
        return;
    }

    // Verify user is admin
    (async () => {
        try {
            const resp = await fetch(`${API_BASE}/api/auth/profile`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });

            if (!resp.ok) {
                console.warn('[admin] profile fetch status:', resp.status, resp.statusText);
                if (resp.status === 401 || resp.status === 403) {
                    localStorage.removeItem('serveNowToken');
                    try { showError('Session Error', 'Please sign in again.'); } catch (e) {}
                    window.location.href = 'login.html';
                    return;
                }
                // other non-OK statuses
                throw new Error(`Profile fetch failed: ${resp.status}`);
            }

            const data = await resp.json();
            if (data && data.success && data.user) {
                if (data.user.user_type === 'admin' || data.user.user_type === 'standard_user') {
                    currentUser = data.user;
                    try { window.ServeNowNotifications?.identifyCurrentUser?.(); } catch (_) {}
                    initializeAdmin();
                } else if (data.user.user_type === 'rider') {
                    window.location.href = 'rider.html';
                } else {
                    localStorage.removeItem('serveNowToken');
                    window.location.href = 'login.html';
                }
            } else {
                localStorage.removeItem('serveNowToken');
                window.location.href = 'login.html';
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            localStorage.removeItem('serveNowToken');
            window.location.href = 'login.html';
        }
    })();
});

function initializeAdmin() {
    // Ensure Units/Sizes tabs and modals exist in the DOM even if the HTML
    // didn't include them (helps when pages are cached or partially rendered).
    try {
        const ensureTab = (id, title, tableHeadHtml) => {
            if (document.getElementById(id)) return;
            const ref = document.getElementById('db-backup') || document.getElementById('riders') || document.getElementById('categories') || document.querySelector('.tab-content');
            const div = document.createElement('div');
            div.id = id;
            div.className = 'tab-content';
            div.innerHTML = `\n                <h2>${title} Management</h2>\n                <button class="btn btn-primary" id="add${title}Btn">Add New ${title}</button>\n                <div class="table-container" style="margin-top:0.75rem;">\n                    <table id="${id}Table">\n                        <thead>\n                            ${tableHeadHtml}\n                        </thead>\n                        <tbody id="${id}TableBody"></tbody>\n                    </table>\n                </div>\n            `;
            if (ref && ref.parentNode) ref.parentNode.insertBefore(div, ref);
            else document.querySelector('section.admin-content')?.appendChild(div);
        };

        ensureTab('units', 'Unit', ` <tr><th>ID</th><th>Name</th><th>Abbreviation</th><th>Multiplier</th><th>Actions</th></tr>`);
        ensureTab('sizes', 'Size', ` <tr><th>ID</th><th>Label</th><th>Description</th><th>Actions</th></tr>`);

        const ensureModal = (id, formId, fieldsHtml, saveBtnId, title) => {
            if (document.getElementById(id)) return;
            const modal = document.createElement('div');
            modal.id = id;
            modal.className = 'modal';
            modal.innerHTML = `\n                <div class="modal-content">\n                    <span class="close" data-modal="${id}">&times;</span>\n                    <h3>${title}</h3>\n                    <form id="${formId}">\n                        ${fieldsHtml}\n                        <div class="modal-footer">\n                            <div class="action-buttons">\n                                <button type="button" class="btn btn-small btn-primary" id="${saveBtnId}"><i class="fas fa-check"></i> Save</button>\n                                <button type="button" class="btn btn-small btn-secondary" data-modal="${id}"><i class="fas fa-ban"></i> Cancel</button>\n                            </div>\n                        </div>\n                    </form>\n                </div>\n            `;
            document.body.appendChild(modal);
        };

        ensureModal('addUnitModal', 'addUnitForm', `\n            <label for="unitName">Name</label>\n            <input id="unitName" name="name" required autocomplete="off" />\n            <label for="unitAbbrev">Abbreviation</label>\n            <input id="unitAbbrev" name="abbreviation" autocomplete="off" />\n            <label for="unitMultiplier">Multiplier</label>\n            <input id="unitMultiplier" name="multiplier" type="number" step="0.0001" value="1.0000" autocomplete="off" />\n        `, 'saveUnitBtn', 'Add / Edit Unit');

        ensureModal('addSizeModal', 'addSizeForm', `\n            <label for="sizeLabel">Label</label>\n            <input id="sizeLabel" name="label" required />\n            <label for="sizeDescription">Description</label>\n            <textarea id="sizeDescription" name="description"></textarea>\n        `, 'saveSizeBtn', 'Add / Edit Size');
    } catch (e) { console.error('Error ensuring units/sizes DOM:', e); }

    // Add event listeners for unit and size buttons after DOM is ensured
    let addUnitBtn = document.getElementById('addUnitBtn');
    if (addUnitBtn) addUnitBtn.addEventListener('click', () => showAddUnitModal());
    
    let addSizeBtn = document.getElementById('addSizeBtn');
    if (addSizeBtn) addSizeBtn.addEventListener('click', () => showAddSizeModal());

    // Logout functionality
    document.getElementById('logoutBtn').addEventListener('click', function(e) {
        e.preventDefault();
        localStorage.removeItem('serveNowToken');
        window.location.href = 'login.html';
    });

    // Prefill utilities username from logged in user profile when available
    const utilUsernameEl = document.getElementById('utilUsername');
    if (utilUsernameEl && !utilUsernameEl.value && currentUser) {
        utilUsernameEl.value = currentUser.email || currentUser.username || '';
    }
    setDefaultBackupFilename();

    // Tab switching
    const tabLinks = document.querySelectorAll('.tab-link');

    tabLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const targetTab = this.dataset.tab;
            const targetSection = this.dataset.statusSection;
            
            // Close any open dropdowns
            document.querySelectorAll('.nav-menu .dropdown.open').forEach(d => {
                d.classList.remove('open');
                const menu = d.querySelector('.dropdown-menu');
                if (menu) {
                    menu.style.position = '';
                    menu.style.left = '';
                    menu.style.top = '';
                    menu.style.zIndex = '';
                    menu.style.maxHeight = '';
                    menu.style.overflow = '';
                }
            });

            if (targetTab === 'store-status' && targetSection) {
                pendingStoreStatusSectionId = targetSection;
            }
            switchTab(targetTab);
        });
    });

    // Handle right-click on dropdown toggles is now handled by native browser menu using href
    
    // Load initial dashboard data
    const initialTab = window.location.hash ? window.location.hash.substring(1) : 'dashboard';
    
    // Apply restrictions immediately
    if (currentUser && currentUser.user_type === 'standard_user') {
        applyRoleRestrictions().then(() => {
             // If initial tab is restricted, it will be handled by applyRoleRestrictions redirection logic
             // But we should try to load the requested tab if valid
             if (initialTab && initialTab !== 'dashboard') {
                 switchTab(initialTab);
             } else {
                 // Check if dashboard is visible (it might have been enabled by menu_orders check)
                 const dashboardLink = document.querySelector('.tab-link[data-tab="dashboard"]');
                 if (dashboardLink && dashboardLink.style.display !== 'none') {
                     switchTab('dashboard');
                 } else {
                     // If default was dashboard but access denied, try orders
                     const ordersLink = document.querySelector('.tab-link[data-tab="orders"]');
                     if (ordersLink && ordersLink.style.display !== 'none') {
                         switchTab('orders');
                     }
                 }
             }
        });
    } else {
        if (initialTab && initialTab !== 'dashboard') {
            switchTab(initialTab);
        } else {
            switchTab('dashboard');
        }
    }

    // Listen for hash changes to switch tabs
    window.addEventListener('hashchange', () => {
        const tab = window.location.hash.substring(1);
        if (currentUser && currentUser.user_type === 'standard_user') {
            // Check if tab is allowed (simple check, robust check is in applyRoleRestrictions)
            const link = document.querySelector(`.tab-link[data-tab="${tab}"]`);
            if (link && link.style.display === 'none') {
                console.warn('Access denied to tab:', tab);
                // Redirect to first visible
                const first = document.querySelector('.tab-link[style="display: block;"]');
                if (first) switchTab(first.dataset.tab);
                return;
            }
        }
        if (tab) switchTab(tab);
    });

    // Add event listeners for modal open buttons
    document.getElementById('addAccountBtn').addEventListener('click', () => showAddAccountModal());
    document.getElementById('addStoreBtn').addEventListener('click', () => showAddStoreModal());
    document.getElementById('addProductBtn').addEventListener('click', () => showAddProductModal());
    const saveGlobalDeliveryStatusBtn = document.getElementById('saveGlobalDeliveryStatusBtn');
    if (saveGlobalDeliveryStatusBtn && !saveGlobalDeliveryStatusBtn.dataset.boundClick) {
        saveGlobalDeliveryStatusBtn.addEventListener('click', saveGlobalDeliveryStatus);
        saveGlobalDeliveryStatusBtn.dataset.boundClick = '1';
    }
    ['globalDeliveryEnabled', 'globalDeliveryBlockOrdering', 'globalDeliveryTitle', 'globalDeliveryMessage', 'globalDeliveryStartAt', 'globalDeliveryEndAt']
        .forEach((id) => {
            const el = document.getElementById(id);
            if (el && !el.dataset.boundPreview) {
                el.addEventListener('input', renderGlobalDeliveryPreview);
                el.addEventListener('change', renderGlobalDeliveryPreview);
                el.dataset.boundPreview = '1';
            }
        });
    ['globalDeliveryNotificationTarget', 'globalDeliverySendPush'].forEach((id) => {
        const el = document.getElementById(id);
        if (el && !el.dataset.boundPushCtrl) {
            el.addEventListener('change', updateGlobalDeliveryPushControls);
            el.dataset.boundPushCtrl = '1';
        }
    });
    const broadcastTargetEl = document.getElementById('broadcastPushTarget');
    if (broadcastTargetEl && !broadcastTargetEl.dataset.boundBroadcastPushCtrl) {
        broadcastTargetEl.addEventListener('change', updateBroadcastPushControls);
        broadcastTargetEl.dataset.boundBroadcastPushCtrl = '1';
    }
    const sendBroadcastPushBtn = document.getElementById('sendBroadcastPushBtn');
    if (sendBroadcastPushBtn && !sendBroadcastPushBtn.dataset.boundClick) {
        sendBroadcastPushBtn.addEventListener('click', sendBroadcastPushNotification);
        sendBroadcastPushBtn.dataset.boundClick = '1';
    }
    const sendAppUpdatePushBtn = document.getElementById('sendAppUpdatePushBtn');
    if (sendAppUpdatePushBtn && !sendAppUpdatePushBtn.dataset.boundClick) {
        sendAppUpdatePushBtn.addEventListener('click', sendAppUpdatePushNotification);
        sendAppUpdatePushBtn.dataset.boundClick = '1';
    }
    const refreshPushStatusBtn = document.getElementById('refreshPushStatusBtn');
    if (refreshPushStatusBtn && !refreshPushStatusBtn.dataset.boundClick) {
        refreshPushStatusBtn.addEventListener('click', loadPushStatus);
        refreshPushStatusBtn.dataset.boundClick = '1';
    }
    loadPushStatus();
    updateGlobalDeliveryPushControls();
    updateBroadcastPushControls();
    bindLivePromotionControls();
    bindStoreOfferCampaignControls();
    bindCustomerFlashControls();
    updateCustomerFlashControls();
    document.getElementById('runDiagnosticsBtn')?.addEventListener('click', () => runAllDiagnostics());
    document.getElementById('runSingleDiagnosticBtn')?.addEventListener('click', () => runSingleDiagnostic());
    // Removed Export Base64 Images and Image Fit controls
    // Apply matching background color for any product-image previews already on the page
    try {
        const imgs = document.querySelectorAll('.product-image img');
        imgs.forEach(img => {
            if (window.applyImageBgFromImage) {
                try {
                    if (img.complete && img.naturalWidth && img.naturalHeight) window.applyImageBgFromImage(img);
                    else img.addEventListener('load', function onL(){ window.applyImageBgFromImage(img); img.removeEventListener('load', onL); });
                } catch (e) { /* ignore */ }
            }
        });
    } catch (e) { /* ignore */ }
    document.getElementById('addCategoryBtn').addEventListener('click', () => showAddCategoryModal());
    document.getElementById('addRiderBtn').addEventListener('click', () => showAddRiderModal());
    
    const addStoreSettlementBtn = document.getElementById('addStoreSettlementBtn');
    if (addStoreSettlementBtn) {
        addStoreSettlementBtn.addEventListener('click', () => createStoreSettlement());
    }
    
    const clearStoreSettlementFiltersBtn = document.getElementById('clearStoreSettlementFiltersBtn');
    if (clearStoreSettlementFiltersBtn) {
        clearStoreSettlementFiltersBtn.addEventListener('click', () => {
            if (typeof window.loadStoreSettlements === 'function') window.loadStoreSettlements();
        });
    }
    // Reuse addUnitBtn from above, just check and create fallback if needed
    console.debug('admin:init addUnitBtn present:', !!addUnitBtn);
    if (!addUnitBtn) {
        // Create a fallback Add Unit button if missing in the DOM
        try {
            const unitsTab = document.getElementById('units');
            if (unitsTab) {
                const btn = document.createElement('button');
                btn.className = 'btn btn-primary';
                btn.id = 'addUnitBtn';
                btn.textContent = 'Add New Unit';
                btn.style.marginBottom = '0.5rem';
                const tableContainer = unitsTab.querySelector('.table-container');
                if (tableContainer) unitsTab.insertBefore(btn, tableContainer);
                else unitsTab.appendChild(btn);
                addUnitBtn = btn;
            }
        } catch (e) { console.error('Error creating fallback addUnitBtn', e); }
    }
    if (addUnitBtn) addUnitBtn.addEventListener('click', () => showAddUnitModal());

    // Reuse addSizeBtn from above, just check and create fallback if needed
    if (!addSizeBtn) {
        // Create a fallback Add Size button if missing in the DOM
        try {
            const sizesTab = document.getElementById('sizes');
            if (sizesTab) {
                const btn2 = document.createElement('button');
                btn2.className = 'btn btn-primary';
                btn2.id = 'addSizeBtn';
                btn2.textContent = 'Add New Size';
                btn2.style.marginBottom = '0.5rem';
                const tableContainer2 = sizesTab.querySelector('.table-container');
                if (tableContainer2) sizesTab.insertBefore(btn2, tableContainer2);
                else sizesTab.appendChild(btn2);
                addSizeBtn = btn2;
            }
        } catch (e) { console.error('Error creating fallback addSizeBtn', e); }
    }
    if (addSizeBtn) addSizeBtn.addEventListener('click', () => showAddSizeModal());

    // Add event listeners for modal close/cancel buttons
    const closeButtons = document.querySelectorAll('.close');
    closeButtons.forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const modalId = this.getAttribute('data-modal');
            if (modalId) {
                hideModal(modalId);
            }
        });
    });

    // Add event listeners for cancel buttons in modals
    const cancelButtons = document.querySelectorAll('button[data-modal]');
    cancelButtons.forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            const modalId = this.getAttribute('data-modal');
            if (modalId) {
                hideModal(modalId);
            }
        });
    });

    // Add event listeners for save buttons
    document.getElementById('saveAccountBtn').addEventListener('click', saveAccount);
    document.getElementById('saveStoreBtn').addEventListener('click', saveStore);
    const storeUnmuteGraceBtn = document.getElementById('storeUnmuteGraceBtn');
    if (storeUnmuteGraceBtn && !storeUnmuteGraceBtn.dataset.boundClick) {
        storeUnmuteGraceBtn.addEventListener('click', handleStoreUnmuteGraceAlert);
        storeUnmuteGraceBtn.dataset.boundClick = '1';
    }
    document.getElementById('saveProductBtn').addEventListener('click', saveProduct);
    const saveSizeBtn = document.getElementById('saveSizeBtn');
    if (saveSizeBtn) saveSizeBtn.addEventListener('click', saveSize);
    const addUnitFormEl = document.getElementById('addUnitForm');
    if (addUnitFormEl && !addUnitFormEl.dataset.boundSubmit) {
        addUnitFormEl.addEventListener('submit', function(e){ e.preventDefault(); try { saveUnit(); } catch (err) { console.error('saveUnit submit error', err); } });
        addUnitFormEl.dataset.boundSubmit = '1';
    }
    document.getElementById('saveCategoryBtn').addEventListener('click', saveCategory);
    document.getElementById('saveRiderBtn').addEventListener('click', saveRider);
    document.getElementById('saveOrderBtn').addEventListener('click', saveOrder);
    const openManualOrderBtn = document.getElementById('openManualOrderBtn');
    if (openManualOrderBtn) openManualOrderBtn.addEventListener('click', () => openManualOrderModal('product'));
    const openParcelOrderBtn = document.getElementById('openParcelOrderBtn');
    if (openParcelOrderBtn) openParcelOrderBtn.addEventListener('click', () => openManualOrderModal('parcel'));
    const manualTypeProductTab = document.getElementById('manualTypeProductTab');
    if (manualTypeProductTab && !manualTypeProductTab.dataset.boundTab) {
        manualTypeProductTab.addEventListener('click', () => {
            const t = document.getElementById('manualOrderType');
            if (t) t.value = 'product';
            updateManualOrderMode();
        });
        manualTypeProductTab.dataset.boundTab = '1';
    }
    const manualTypeParcelTab = document.getElementById('manualTypeParcelTab');
    if (manualTypeParcelTab && !manualTypeParcelTab.dataset.boundTab) {
        manualTypeParcelTab.addEventListener('click', () => {
            const t = document.getElementById('manualOrderType');
            if (t) t.value = 'parcel';
            updateManualOrderMode();
        });
        manualTypeParcelTab.dataset.boundTab = '1';
    }
    const manualOrderApplyDefaultFeeBtn = document.getElementById('manualOrderApplyDefaultFeeBtn');
    if (manualOrderApplyDefaultFeeBtn && !manualOrderApplyDefaultFeeBtn.dataset.boundApplyFee) {
        manualOrderApplyDefaultFeeBtn.addEventListener('click', () => {
            applyCurrentDeliveryCharges();
        });
        manualOrderApplyDefaultFeeBtn.dataset.boundApplyFee = '1';
    }
    const submitManualOrderBtn = document.getElementById('submitManualOrderBtn');
    if (submitManualOrderBtn) submitManualOrderBtn.addEventListener('click', submitManualOrder);
    const manualOrderTypeEl = document.getElementById('manualOrderType');
    if (manualOrderTypeEl && !manualOrderTypeEl.dataset.boundModeToggle) {
        manualOrderTypeEl.addEventListener('change', updateManualOrderMode);
        manualOrderTypeEl.dataset.boundModeToggle = '1';
    }
    const toggleCreateManualCustomerBtn = document.getElementById('toggleCreateManualCustomerBtn');
    if (toggleCreateManualCustomerBtn) toggleCreateManualCustomerBtn.addEventListener('click', toggleManualCreateCustomerPanel);
    const createManualCustomerBtn = document.getElementById('createManualCustomerBtn');
    if (createManualCustomerBtn) createManualCustomerBtn.addEventListener('click', createManualOrderCustomer);
    const toggleCreateManualStoreBtn = document.getElementById('toggleCreateManualStoreBtn');
    if (toggleCreateManualStoreBtn) toggleCreateManualStoreBtn.addEventListener('click', toggleManualCreateStorePanel);
    const createManualStoreBtn = document.getElementById('createManualStoreBtn');
    if (createManualStoreBtn) createManualStoreBtn.addEventListener('click', createManualOrderStore);
    const manualOrderStoreEl = document.getElementById('manualOrderStore');
    if (manualOrderStoreEl && !manualOrderStoreEl.dataset.boundProductsLoad) {
        manualOrderStoreEl.addEventListener('change', () => {
            handleManualOrderStoreChange().catch((e) => console.error('Error on manual order store change:', e));
        });
        manualOrderStoreEl.dataset.boundProductsLoad = '1';
    }
    const manualOrderCustomerEl = document.getElementById('manualOrderCustomer');
    if (manualOrderCustomerEl && !manualOrderCustomerEl.dataset.boundAutofillAddress) {
        manualOrderCustomerEl.addEventListener('change', autofillManualOrderAddressFromCustomer);
        manualOrderCustomerEl.dataset.boundAutofillAddress = '1';
    }
    const manualOrderExistingProductEl = document.getElementById('manualOrderExistingProduct');
    if (manualOrderExistingProductEl && !manualOrderExistingProductEl.dataset.boundResolveProduct) {
        manualOrderExistingProductEl.addEventListener('input', resolveManualOrderProductSelection);
        manualOrderExistingProductEl.addEventListener('change', resolveManualOrderProductSelection);
        manualOrderExistingProductEl.dataset.boundResolveProduct = '1';
    }
    const storePaymentTermEl = document.getElementById('storePaymentTerm');
    const storeGraceDaysEl = document.getElementById('storeGraceDays');
    const storeGraceStartDateEl = document.getElementById('storeGraceStartDate');
    const storeDiscountApplyEl = document.getElementById('storeDiscountApplyAllProducts');
    const storeBankIdEl = document.getElementById('storeBankId');
    const addStoreBankBtn = document.getElementById('addStoreBankBtn');
    if (storePaymentTermEl && !storePaymentTermEl.dataset.boundGraceControls) {
        storePaymentTermEl.addEventListener('change', updateStoreGraceControls);
        storePaymentTermEl.dataset.boundGraceControls = '1';
    }
    if (storeDiscountApplyEl && !storeDiscountApplyEl.dataset.boundDiscountControls) {
        storeDiscountApplyEl.addEventListener('change', updateStoreDiscountControls);
        storeDiscountApplyEl.dataset.boundDiscountControls = '1';
    }
    if (storeGraceDaysEl && !storeGraceDaysEl.dataset.boundGracePreview) {
        storeGraceDaysEl.addEventListener('input', updateStoreGraceDuePreview);
        storeGraceDaysEl.dataset.boundGracePreview = '1';
    }
    if (storeGraceStartDateEl && !storeGraceStartDateEl.dataset.boundGracePreview) {
        storeGraceStartDateEl.addEventListener('change', updateStoreGraceDuePreview);
        storeGraceStartDateEl.dataset.boundGracePreview = '1';
    }
    if (storeBankIdEl && !storeBankIdEl.dataset.boundStoreBankMeta) {
        storeBankIdEl.addEventListener('change', renderStoreBankMeta);
        storeBankIdEl.dataset.boundStoreBankMeta = '1';
    }
    if (addStoreBankBtn && !addStoreBankBtn.dataset.boundAddBank) {
        addStoreBankBtn.addEventListener('click', () => {
            showModal('addBankModal');
        });
        addStoreBankBtn.dataset.boundAddBank = '1';
    }
    if (!window.__storeBankAddedListenerBound) {
        window.addEventListener('servenow:bank-added', async (event) => {
            const selected = event?.detail?.id || document.getElementById('storeBankId')?.value || null;
            await populateStoreBankSelect(selected);
        });
        window.__storeBankAddedListenerBound = true;
    }
    updateStoreGraceControls();
    startStoreGraceAlertsPolling();
    processPendingStoreGraceUrlAction().catch((error) => {
        console.warn('Pending store grace tray action failed:', error);
    });

    // Store priority button
    const savePriorityBtn = document.getElementById('savePriorityBtn');
    const prioritySelect = document.getElementById('prioritySelect');
    if (savePriorityBtn) {
        savePriorityBtn.addEventListener('click', function() {
            const storeId = document.getElementById('setPriorityForm').dataset.storeId;
            const priority = document.getElementById('prioritySelect').value;
            const priorityValue = priority ? parseInt(priority, 10) : null;
            
            fetch(`${API_BASE}/api/stores/${storeId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ priority: priorityValue })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    document.getElementById('setPriorityModal').style.display = 'none';
                    showSuccess('Priority Updated', `Store priority has been updated successfully.`);
                    loadStores();
                } else {
                    showError('Error', data.message || 'Failed to update store priority. Please try again.');
                }
            })
            .catch(error => {
                console.error('Error updating store priority:', error);
                showError('Error', 'Failed to update store priority. Please try again.');
            });
        });
    }
    if (prioritySelect) {
        prioritySelect.addEventListener('change', updatePriorityWarning);
    }

    // Database backup buttons
    const createBackupBtn = document.getElementById('createBackupBtn');
    if (createBackupBtn) createBackupBtn.addEventListener('click', createBackup);
    const refreshBackupsBtn = document.getElementById('refreshBackupsBtn');
    if (refreshBackupsBtn) refreshBackupsBtn.addEventListener('click', loadBackups);
    const testTrayNotificationBtn = document.getElementById('testTrayNotificationBtn');
    if (testTrayNotificationBtn) testTrayNotificationBtn.addEventListener('click', sendTestTrayNotification);
    const saveDeliveryFeeSettingsBtn = document.getElementById('saveDeliveryFeeSettingsBtn');
    if (saveDeliveryFeeSettingsBtn) saveDeliveryFeeSettingsBtn.addEventListener('click', saveDeliveryFeeSettings);
    const reloadDeliveryFeeSettingsBtn = document.getElementById('reloadDeliveryFeeSettingsBtn');
    if (reloadDeliveryFeeSettingsBtn) reloadDeliveryFeeSettingsBtn.addEventListener('click', loadDeliveryFeeSettings);
    const settingsSaveDeliveryFeeSettingsBtn = document.getElementById('settingsSaveDeliveryFeeSettingsBtn');
    if (settingsSaveDeliveryFeeSettingsBtn) settingsSaveDeliveryFeeSettingsBtn.addEventListener('click', saveDeliveryFeeSettingsFromSettingsTab);
    const settingsReloadDeliveryFeeSettingsBtn = document.getElementById('settingsReloadDeliveryFeeSettingsBtn');
    if (settingsReloadDeliveryFeeSettingsBtn) settingsReloadDeliveryFeeSettingsBtn.addEventListener('click', loadDeliveryFeeSettings);
    // Populate danger-zone clear table options with all tables from DB
    if (typeof loadClearableTables === 'function') loadClearableTables();
    if (typeof loadDeliveryFeeSettings === 'function') loadDeliveryFeeSettings();
    const restoreBackupBtn = document.getElementById('restoreBackupBtn');
    function updateRestoreButtonState() {
        const sel = document.querySelector('input[name="selBackup"]:checked');
        if (restoreBackupBtn) restoreBackupBtn.disabled = !sel;
    }
    // initialize and bind to selection changes
    updateRestoreButtonState();
    document.addEventListener('change', (ev) => {
        if (ev.target && ev.target.name === 'selBackup') updateRestoreButtonState();
    });

    if (restoreBackupBtn) {
        restoreBackupBtn.addEventListener('click', function (e) {
            e.preventDefault();
            const selected = document.querySelector('input[name="selBackup"]:checked');
            if (!selected) { showError('Restore', 'Please select a backup to restore'); return; }
            // autofill modal filename and reset modal inputs
            const filenameEl = document.getElementById('restoreFilename');
            if (filenameEl) filenameEl.textContent = selected.value || '(unknown)';
            const restoreInput = document.getElementById('restoreConfirmInput');
            const restoreAck = document.getElementById('restoreAcknowledge');
            const confirmRestoreBtn = document.getElementById('confirmRestoreBtn');
            if (restoreInput) restoreInput.value = '';
            if (restoreAck) restoreAck.checked = false;
            if (confirmRestoreBtn) confirmRestoreBtn.disabled = true;
            showModal('restoreConfirmModal');
        });
    }
    const clearDatabaseBtn = document.getElementById('clearDatabaseBtn');
    if (clearDatabaseBtn) clearDatabaseBtn.addEventListener('click', clearDatabaseWithBackup);
    const clearDatabaseKeepOneBtn = document.getElementById('clearDatabaseKeepOneBtn');
    if (clearDatabaseKeepOneBtn) clearDatabaseKeepOneBtn.addEventListener('click', clearDatabaseKeepOne);

    // Add filter event listeners
    const orderDatePreset = document.getElementById('orderDatePreset');
    const filterStartDate = document.getElementById('filterStartDate');
    const filterEndDate = document.getElementById('filterEndDate');
    const filterRider = document.getElementById('filterRider');
    const filterStore = document.getElementById('filterStore');
    const clearFiltersBtn = document.getElementById('clearFiltersBtn');

    // Make functions globally available for inline onclick attributes
    window.showAddUnitModal = showAddUnitModal;
    window.showAddSizeModal = showAddSizeModal;
    window.saveUnit = saveUnit;
    window.saveSize = saveSize;
    
    // Also export setupStoreSettlementListeners if available
    if (typeof setupStoreSettlementListeners !== 'undefined') {
        window.setupStoreSettlementListeners = setupStoreSettlementListeners;
    }

    if (orderDatePreset) {
        orderDatePreset.addEventListener('change', () => {
            applyOrderDatePreset(orderDatePreset.value, true);
        });
    }
    if (filterStartDate) {
        filterStartDate.addEventListener('change', () => {
            if (orderDatePreset) orderDatePreset.value = 'custom';
            loadOrders();
        });
    }
    if (filterEndDate) {
        filterEndDate.addEventListener('change', () => {
            if (orderDatePreset) orderDatePreset.value = 'custom';
            loadOrders();
        });
    }
    if (filterRider) {
        filterRider.addEventListener('input', filterOrders);
        filterRider.addEventListener('change', filterOrders);
    }
    const filterStatus = document.getElementById('filterStatus');
    if (filterStatus) {
        filterStatus.addEventListener('input', filterOrders);
        filterStatus.addEventListener('change', filterOrders);
    }
    if (filterStore) {
        filterStore.addEventListener('input', filterOrders);
        filterStore.addEventListener('change', filterOrders);
    }
    const filterAssignment = document.getElementById('filterAssignment');
    if (filterAssignment) {
        filterAssignment.addEventListener('input', filterOrders);
        filterAssignment.addEventListener('change', filterOrders);
        if (!filterAssignment.value) filterAssignment.value = 'All Assignments';
    }

    // Wire up restore confirmation modal
    const restoreInput = document.getElementById('restoreConfirmInput');
    const confirmRestoreBtn = document.getElementById('confirmRestoreBtn');
    if (restoreInput && confirmRestoreBtn) {
        const restoreAck = document.getElementById('restoreAcknowledge');
        function updateConfirmState() {
            const ok = String(restoreInput.value || '').trim().toUpperCase() === 'RESTORE';
            const ack = restoreAck ? restoreAck.checked : false;
            confirmRestoreBtn.disabled = !(ok && ack);
        }
        restoreInput.addEventListener('input', updateConfirmState);
        if (restoreAck) restoreAck.addEventListener('change', updateConfirmState);

        confirmRestoreBtn.addEventListener('click', async (ev) => {
            ev.preventDefault();
            // Close modal and perform restore
            hideModal('restoreConfirmModal');
            try {
                // Re-validate selection before proceeding
                const selected = document.querySelector('input[name="selBackup"]:checked');
                if (!selected) { showError('Restore', 'Please select a backup to restore'); return; }
                await restoreSelectedBackup();
            } catch (err) {
                console.error('confirmRestore error:', err);
            }
        });
    }
    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', clearFilters);
    }

    // Accounts filters
    const accountSearch = document.getElementById('accountSearch');
    const accountTypeFilter = document.getElementById('accountTypeFilter');
    const accountStatusFilter = document.getElementById('accountStatusFilter');
    const accountVerifiedFilter = document.getElementById('accountVerifiedFilter');
    const accountClearFiltersBtn = document.getElementById('accountClearFiltersBtn');
    if (accountSearch) accountSearch.addEventListener('input', filterAccounts);
    if (accountTypeFilter) accountTypeFilter.addEventListener('change', filterAccounts);
    if (accountStatusFilter) accountStatusFilter.addEventListener('change', filterAccounts);
    if (accountVerifiedFilter) accountVerifiedFilter.addEventListener('change', filterAccounts);
    if (accountClearFiltersBtn) accountClearFiltersBtn.addEventListener('click', clearAccountFilters);

    // Stores filters
    const storeSearch = document.getElementById('storeSearch');
    const storeStatusFilter = document.getElementById('storeStatusFilter');
    const storeVisibilityFilter = document.getElementById('storeVisibilityFilter');
    const storeClearFiltersBtn = document.getElementById('storeClearFiltersBtn');
    if (storeSearch) storeSearch.addEventListener('input', filterStores);
    if (storeStatusFilter) storeStatusFilter.addEventListener('change', filterStores);
    if (storeVisibilityFilter) storeVisibilityFilter.addEventListener('change', filterStores);
    if (storeClearFiltersBtn) storeClearFiltersBtn.addEventListener('click', clearStoreFilters);

    // Products filters
    const productSearch = document.getElementById('productSearch');
    const productCategoryFilter = document.getElementById('productCategoryFilter');
    const productStoreFilter = document.getElementById('productStoreFilter');
    const productStatusFilter = document.getElementById('productStatusFilter');
    const productClearFiltersBtn = document.getElementById('productClearFiltersBtn');
    if (productSearch) productSearch.addEventListener('input', filterProducts);
    if (productCategoryFilter) {
        productCategoryFilter.addEventListener('input', filterProducts);
        productCategoryFilter.addEventListener('change', filterProducts);
    }
    if (productStoreFilter) {
        productStoreFilter.addEventListener('input', filterProducts);
        productStoreFilter.addEventListener('change', filterProducts);
    }
    if (productStatusFilter) productStatusFilter.addEventListener('change', filterProducts);
    if (productClearFiltersBtn) productClearFiltersBtn.addEventListener('click', clearProductFilters);

    // Upgrade filter selects to typeable filter inputs (Order-store-list style).
    // Keeps original select + events intact by syncing values both ways.
    setTimeout(() => {
        try { enhanceFilterSelectsToTypeable(); } catch (e) { console.warn('enhanceFilterSelectsToTypeable failed', e); }
        try { initializeAdminFilterMenus(); } catch (e) { console.warn('initializeAdminFilterMenus failed', e); }
    }, 0);

    // Categories filters
    const categorySearch = document.getElementById('categorySearch');
    const categoryStatusFilter = document.getElementById('categoryStatusFilter');
    const categoryClearFiltersBtn = document.getElementById('categoryClearFiltersBtn');
    if (categorySearch) categorySearch.addEventListener('input', filterCategories);
    if (categoryStatusFilter) categoryStatusFilter.addEventListener('change', filterCategories);
    if (categoryClearFiltersBtn) categoryClearFiltersBtn.addEventListener('click', clearCategoryFilters);

    // Riders filters
    const riderSearch = document.getElementById('riderSearch');
    const riderAvailabilityFilter = document.getElementById('riderAvailabilityFilter');
    const riderStatusFilter = document.getElementById('riderStatusFilter');
    const riderClearFiltersBtn = document.getElementById('riderClearFiltersBtn');
    if (riderSearch) riderSearch.addEventListener('input', filterRiders);
    if (riderAvailabilityFilter) riderAvailabilityFilter.addEventListener('change', filterRiders);
    if (riderStatusFilter) riderStatusFilter.addEventListener('change', filterRiders);
    if (riderClearFiltersBtn) riderClearFiltersBtn.addEventListener('click', clearRiderFilters);

    try {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const y = now.getFullYear();
        const m = pad(now.getMonth() + 1);
        const d = pad(now.getDate());
        const hh = pad(now.getHours());
        const mm = pad(now.getMinutes());
        const todayDate = `${y}-${m}-${d}`;
        const todayDateTime = `${y}-${m}-${d}T${hh}:${mm}`;
        // Date defaults are now handled in financial.js initializeDateDefaults()
        const ed = document.getElementById('entryDate');
        if (ed && !ed.value) ed.value = todayDateTime;
    } catch (e) {}

    // Add report event listeners
    const generateOrderReportBtn = document.getElementById('generateOrderReportBtn');
    if (generateOrderReportBtn) {
        generateOrderReportBtn.addEventListener('click', generateOrderReport);
    }

    // Fuel management panel toggles and actions
    const openFuelPanelBtn = document.getElementById('openFuelPanelBtn');
    if (openFuelPanelBtn) {
        openFuelPanelBtn.addEventListener('click', async () => {
            // open Riders main tab and show Fuel sub-panel
            openRiderSubtab('fuel');
        });
    }

    // Wire refresh and save buttons for fuel management
    const refreshFuelBtn = document.getElementById('refreshFuelBtn');
    if (refreshFuelBtn) refreshFuelBtn.addEventListener('click', async () => {
        const sel = document.getElementById('fuelRiderSelect');
        if (!sel || !sel.value) {
            showWarning('No Rider Selected', 'Please select a rider to refresh fuel history.');
            return;
        }
        await loadFuelHistory(sel.value);
    });

    const saveFuelBtn = document.getElementById('saveFuelBtn');
    if (saveFuelBtn) saveFuelBtn.addEventListener('click', saveFuelEntry);

    const fuelRiderSelect = document.getElementById('fuelRiderSelect');
    if (fuelRiderSelect) fuelRiderSelect.addEventListener('change', async function() {
        if (this.value) {
            try {
                const data = await loadFuelHistory(this.value);
                if (data && data.success && Array.isArray(data.records) && data.records.length > 0) {
                    // Records are ordered by id DESC (latest first)
                    const latest = data.records[0];
                    const sm = document.getElementById('startMeter');
                    if (sm && latest.end_meter) {
                        sm.value = latest.end_meter;
                        // Trigger input event to update calculations
                        sm.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                } else {
                    const sm = document.getElementById('startMeter');
                    if (sm) sm.value = '';
                }
            } catch (e) {
                console.error('Error auto-populating start meter:', e);
            }
        }
    });

    const activeRiderSelect = document.getElementById('activeRiderSelect');
    if (activeRiderSelect) activeRiderSelect.addEventListener('change', function() {
        if (this.value) loadRiderActiveDeliveries(this.value);
    });

    const completedRiderSelect = document.getElementById('completedRiderSelect');
    if (completedRiderSelect) completedRiderSelect.addEventListener('change', function() {
        if (this.value) loadRiderCompletedDeliveries(this.value);
    });

    const refreshActiveDeliveriesBtn = document.getElementById('refreshActiveDeliveriesBtn');
    if (refreshActiveDeliveriesBtn) refreshActiveDeliveriesBtn.addEventListener('click', function() {
        const sel = document.getElementById('activeRiderSelect');
        if (sel && sel.value) loadRiderActiveDeliveries(sel.value);
    });

    const refreshCompletedDeliveriesBtn = document.getElementById('refreshCompletedDeliveriesBtn');
    if (refreshCompletedDeliveriesBtn) refreshCompletedDeliveriesBtn.addEventListener('click', function() {
        const sel = document.getElementById('completedRiderSelect');
        if (sel && sel.value) loadRiderCompletedDeliveries(sel.value);
    });

    (function attachFuelAutoCalc(){
        const s = document.getElementById('startMeter');
        const e = document.getElementById('endMeter');
        const d = document.getElementById('distance');
        const r = document.getElementById('petrolRate');
        const c = document.getElementById('fuelCost');
        if (d) { try { d.readOnly = true; } catch(_) {} }
        // if (c) { try { c.readOnly = true; } catch(_) {} } // Allow manual override
        if (!s || !e) return;
        const recalc = (showError = true) => {
            const sv = parseFloat(String(s.value || '').replace(/[^\d.]/g, ''));
            const ev = parseFloat(String(e.value || '').replace(/[^\d.]/g, ''));
            if (Number.isFinite(sv) && Number.isFinite(ev)) {
                if (ev <= sv) {
                    if (d) d.value = '';
                    if (c) c.value = '';
                    if (showError) showWarning('Invalid Meter', 'End meter must be greater than start meter');
                    return;
                }
                const dist = ev - sv;
                if (d) d.value = dist.toFixed(2);
                const rate = parseFloat(String(r && r.value || '').replace(/[^\d.]/g, ''));
                // Formula: (Distance / 45) * Rate
                if (Number.isFinite(rate) && c) c.value = Math.round((dist / 45) * rate).toFixed(0);
            } else {
                if (d) d.value = '';
                if (c) c.value = '';
            }
        };
        const recalcCostOnly = () => {
            const rate = parseFloat(String(r && r.value || '').replace(/[^\d.]/g, ''));
            const dist = parseFloat(String(d && d.value || '').replace(/[^\d.]/g, ''));
            // Formula: (Distance / 45) * Rate
            if (Number.isFinite(rate) && Number.isFinite(dist) && c) c.value = Math.round((dist / 45) * rate).toFixed(0);
        };
        s.addEventListener('input', () => recalc(false));
        e.addEventListener('input', () => recalc(false));
        s.addEventListener('change', () => recalc(true));
        e.addEventListener('change', () => recalc(true));
        if (r) r.addEventListener('input', recalcCostOnly);
    })();

    const printReportBtn = document.getElementById('printReportBtn');
    if (printReportBtn) {
        printReportBtn.addEventListener('click', printOrderReport);
    }

    // Load riders for report filter when reports tab is accessed
    if (document.getElementById('reportRiderFilter')) {
        loadReportRiders();
    }

    // Load Units and Sizes lists for admin
    try { loadUnits(); } catch(e) { /* ignore */ }
    try { loadSizes(); } catch(e) { /* ignore */ }

    // Add problems tab event listeners
    const runDiagnosticsBtn = document.getElementById('runDiagnosticsBtn');
    if (runDiagnosticsBtn) runDiagnosticsBtn.addEventListener('click', runAllDiagnostics);

    const runSingleDiagnosticBtn = document.getElementById('runSingleDiagnosticBtn');
    if (runSingleDiagnosticBtn) runSingleDiagnosticBtn.addEventListener('click', runSingleDiagnostic);

    if (typeof initializeFinancialForms === 'function') {
        initializeFinancialForms();
    }

    // Load default tab
    // We check hash to see if we should load specific tab
    const hash = window.location.hash.substring(1);
    if (hash) {
        // Find matching sidebar link
        const link = document.querySelector(`.sidebar a[href="#${hash}"]`);
        if (link) {
            link.click();
        } else {
            // Default to dashboard
            const defaultLink = document.querySelector('.sidebar a[href="#dashboard"]');
            if (defaultLink) defaultLink.click();
        }
    } else {
        const defaultLink = document.querySelector('.sidebar a[href="#dashboard"]');
        if (defaultLink) defaultLink.click();
    }
}

document.addEventListener('click', function(e) {
    try {
        const t = e.target;
        if (!t) return;
        // normalize to the button element if an inner icon/text was clicked
        const btn = t.closest ? t.closest('#addUnitBtn') || (t.id === 'addUnitBtn' ? t : null) : (t.id === 'addUnitBtn' ? t : null);
        if (btn) {
            e.preventDefault();
            try { showAddUnitModal(); } catch (err) { console.error('showAddUnitModal error', err); }
            return;
        }

        const btn2 = t.closest ? t.closest('#addSizeBtn') || (t.id === 'addSizeBtn' ? t : null) : (t.id === 'addSizeBtn' ? t : null);
        if (btn2) {
            e.preventDefault();
            try { showAddSizeModal(); } catch (err) { console.error('showAddSizeModal error', err); }
            return;
        }

        const closeEl = t.closest ? t.closest('.close[data-modal]') : null;
        if (closeEl) {
            e.preventDefault();
            const mid = closeEl.getAttribute('data-modal');
            if (mid) hideModal(mid);
            return;
        }
        const cancelEl = t.closest ? t.closest('button[data-modal]') : (t.getAttribute && t.getAttribute('data-modal') ? t : null);
        if (cancelEl) {
            e.preventDefault();
            const mid = cancelEl.getAttribute('data-modal');
            if (mid) hideModal(mid);
            return;
        }
    } catch (e) { /* ignore delegated handler errors */ }
});

// Keep admin modals open on ESC; user must close using explicit modal controls.
document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const openModal = document.querySelector('.modal.show');
    if (openModal) {
        e.preventDefault();
        e.stopPropagation();
    }
});

// Delegated handlers for Save buttons (in case direct listeners didn't attach)
document.addEventListener('click', function(e) {
    try {
        const t = e.target;
        if (!t) return;
        const saveUnitBtn = t.closest ? t.closest('#saveUnitBtn') || (t.id === 'saveUnitBtn' ? t : null) : (t.id === 'saveUnitBtn' ? t : null);
        if (saveUnitBtn) {
            const formEl = document.getElementById('addUnitForm') || document.querySelector('#addUnitModal form');
            if (formEl && formEl.contains(saveUnitBtn)) return;
            e.preventDefault();
            if (formEl) {
                try { formEl.dispatchEvent(new Event('submit', { cancelable: true })); } catch (err) { try { saveUnit(); } catch (_e) {} }
            } else {
                try { saveUnit(); } catch (err) { console.error('saveUnit error', err); }
            }
            return;
        }

        const saveSizeBtn = t.closest ? t.closest('#saveSizeBtn') || (t.id === 'saveSizeBtn' ? t : null) : (t.id === 'saveSizeBtn' ? t : null);
        if (saveSizeBtn) {
            e.preventDefault();
            try { saveSize(); } catch (err) { console.error('saveSize error', err); }
            return;
        }
    } catch (e) { /* ignore */ }
});

// Rider sub-tab links (inside Riders management): show list or fuel panel
const riderSubtabLinks = document.querySelectorAll('.rider-subtab-link');
riderSubtabLinks.forEach(link => {
    link.addEventListener('click', function(e) {
        e.preventDefault();
        const sub = this.dataset.riderSubtab;
        if (sub) openRiderSubtab(sub);
    });
});

// Dropdown: click-to-open for mobile/landscape
try {
    const dropdownToggles = document.querySelectorAll('.nav-menu .dropdown > .dropdown-toggle');
    dropdownToggles.forEach(t => {
        t.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const li = this.closest('.dropdown');
            if (!li) return;
            const nowOpen = li.classList.toggle('open');
            // Close other dropdowns
            document.querySelectorAll('.nav-menu .dropdown').forEach(d => {
                if (d !== li) d.classList.remove('open');
            });
            const menu = li.querySelector('.dropdown-menu');
            if (menu) {
                if (nowOpen && window.innerWidth > 1024) {
                    const rect = this.getBoundingClientRect();
                    menu.style.position = 'fixed';
                    // Open to the right side
                    menu.style.left = Math.round(rect.right) + 'px';
                    // Align top with the parent item
                    menu.style.top = Math.round(rect.top) + 'px';
                    menu.style.zIndex = '5000';
                    menu.style.maxHeight = 'none';
                    menu.style.overflow = 'visible';
                } else {
                    menu.style.position = '';
                    menu.style.left = '';
                    menu.style.top = '';
                    menu.style.zIndex = '';
                    menu.style.maxHeight = '';
                    menu.style.overflow = '';
                }
            }
        });
    });
    // Close dropdowns when clicking outside nav
    document.addEventListener('click', function(e) {
        const nav = document.getElementById('navMenu');
        if (nav && !nav.contains(e.target)) {
            document.querySelectorAll('.nav-menu .dropdown').forEach(d => {
                d.classList.remove('open');
                const m = d.querySelector('.dropdown-menu');
                if (m) {
                    m.style.position = '';
                    m.style.left = '';
                    m.style.top = '';
                    m.style.zIndex = '';
                    m.style.maxHeight = '';
                    m.style.overflow = '';
                }
            });
        }
    });
    if (!window._dropdownPositionBound) {
        window._dropdownPositionBound = true;
        const reposition = () => {
            const openToggle = document.querySelector('.nav-menu .dropdown.open > .dropdown-toggle');
            if (!openToggle) return;
            const li = openToggle.closest('.dropdown');
            if (!li) return;
            const menu = li.querySelector('.dropdown-menu');
            if (!menu) return;
            if (window.innerWidth <= 1024) {
                menu.style.position = '';
                menu.style.left = '';
                menu.style.top = '';
                menu.style.zIndex = '';
                menu.style.maxHeight = '';
                menu.style.overflow = '';
                return;
            }
            const rect = openToggle.getBoundingClientRect();
            menu.style.position = 'fixed';
            // Open to the right side
            menu.style.left = Math.round(rect.right) + 'px';
            // Align top with the parent item
            menu.style.top = Math.round(rect.top) + 'px';
            menu.style.zIndex = '5000';
            menu.style.maxHeight = 'none';
            menu.style.overflow = 'visible';
        };
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, true);
    }
} catch (e) { /* ignore */ }

// Image Fit removed

// Global helper: apply orientation-based object-fit to any img preview
function applyOrientationFitAdmin(img) {
    try {
        if (!img) return;
        const apply = () => {
            const w = img.naturalWidth || 0;
            const h = img.naturalHeight || 0;
            // Ensure correct fit by toggling class and inline style
            img.classList.remove('fit-contain', 'fit-cover');
            if (h >= w) {
                img.classList.add('fit-contain');
                img.style.objectFit = 'contain';
            } else {
                img.classList.add('fit-cover');
                img.style.objectFit = 'cover';
            }
        };
        if (img.complete && img.naturalWidth && img.naturalHeight) apply();
        else {
            const onLoad = function() { apply(); img.removeEventListener('load', onLoad); };
            img.addEventListener('load', onLoad);
        }
    } catch (e) { console.warn('applyOrientationFitAdmin failed', e); }
}
// Load riders for report filter
function loadReportRiders() {
    fetch(`${API_BASE}/api/riders`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success && data.riders) {
            const riderFilter = document.getElementById('reportRiderFilter');
            riderFilter.innerHTML = '<option value="">All Riders</option>';

            data.riders.forEach(rider => {
                const option = document.createElement('option');
                option.value = rider.id;
                option.textContent = `${rider.first_name} ${rider.last_name}`;
                riderFilter.appendChild(option);
            });
            console.log('Loaded riders for filter:', data.riders.length);
        } else {
            console.error('Failed to load riders:', data);
        }
    })
    .catch(error => {
        console.error('Error loading riders for reports:', error);
        showError('Error', 'Failed to load rider list for filtering');
    });

    attachPhoneFormatHandlers();
}

// Print Order Report Function
function printOrderReport() {
    // Get current report data
    const startDate = document.getElementById('reportStartDate').value;
    const endDate = document.getElementById('reportEndDate').value;
    const totalRevenue = document.getElementById('totalRevenue').textContent;
    const totalOrders = document.getElementById('totalOrdersCount').textContent;
    const avgOrderValue = document.getElementById('avgOrderValue').textContent;
    const completedOrders = document.getElementById('completedOrders').textContent;

    // Get table data
    const tableRows = document.querySelectorAll('#orderReportsTableBody tr');

    // Create print-friendly HTML
    const printContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Order Reports - ServeNow</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    margin: 20px;
                    line-height: 1.6;
                }
                .header {
                    text-align: center;
                    border-bottom: 2px solid #333;
                    padding-bottom: 20px;
                    margin-bottom: 30px;
                }
                .header h1 {
                    color: #333;
                    margin-bottom: 10px;
                }
                .header p {
                    color: #666;
                    font-size: 14px;
                }
                .summary {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 20px;
                    margin-bottom: 30px;
                }
                .summary-card {
                    border: 1px solid #ddd;
                    padding: 20px;
                    border-radius: 8px;
                    text-align: center;
                    background: #f9f9f9;
                }
                .summary-card h3 {
                    margin: 0;
                    font-size: 24px;
                    color: #333;
                }
                .summary-card p {
                    margin: 5px 0 0 0;
                    color: #666;
                    font-size: 14px;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 20px;
                }
                th, td {
                    border: 1px solid #ddd;
                    padding: 12px;
                    text-align: left;
                }
                th {
                    background-color: #f5f5f5;
                    font-weight: bold;
                }
                tr:nth-child(even) {
                    background-color: #f9f9f9;
                }
                .footer {
                    margin-top: 40px;
                    text-align: center;
                    font-size: 12px;
                    color: #666;
                }
                @media print {
                    body { margin: 0; }
                    .summary-card { break-inside: avoid; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>ServeNow - Order Reports</h1>
                <p>Report Period: ${new Date(startDate).toLocaleDateString()} to ${new Date(endDate).toLocaleDateString()}</p>
                <p>Generated on: ${new Date().toLocaleString()}</p>
            </div>

            <div class="summary">
                <div class="summary-card">
                    <h3>${totalRevenue}</h3>
                    <p>Total Revenue</p>
                </div>
                <div class="summary-card">
                    <h3>${totalOrders}</h3>
                    <p>Total Orders</p>
                </div>
                <div class="summary-card">
                    <h3>${avgOrderValue}</h3>
                    <p>Average Order Value</p>
                </div>
                <div class="summary-card">
                    <h3>${completedOrders}</h3>
                    <p>Completed Orders</p>
                </div>
            </div>

            <h2 style="color: #333; border-bottom: 1px solid #ddd; padding-bottom: 10px;">Daily Report Summary</h2>
            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Total Orders</th>
                        <th>Total Revenue</th>
                        <th>Average Order Value</th>
                        <th>Most Popular Store</th>
                    </tr>
                </thead>
                <tbody>
                    ${Array.from(tableRows).map(row => row.outerHTML).join('')}
                </tbody>
            </table>

            <div class="footer">
                <p>This report was generated by ServeNow Admin Panel</p>
            </div>
        </body>
        </html>
    `;

    // Open print dialog
    const printWindow = window.open('', '_blank');
    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.focus();

    // Wait for content to load then print
    printWindow.onload = function() {
        printWindow.print();
        printWindow.close();
    };
}

let pendingStoreStatusSectionId = null;

function switchTab(tabName) {
    const contentTabName = tabName === 'sale-reports' ? 'inventory-report' : tabName;

    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab-link').forEach(link => {
        link.classList.remove('active');
    });

    // Show selected tab (defensive: ensure elements exist)
    const tabEl = document.getElementById(contentTabName);
    const linkEl = document.querySelector(`[data-tab="${tabName}"]`);
    if (!tabEl || !linkEl) {
        console.warn('switchTab: tab or link not found for', tabName);
        return;
    }
    tabEl.classList.add('active');
    linkEl.classList.add('active');

    // Ensure newly opened tabs start at top; otherwise short tabs can appear blank
    const appContent = document.querySelector('.app-content');
    if (appContent) appContent.scrollTop = 0;

    // Update URL hash without jumping
    if (window.location.hash !== '#' + tabName) {
        history.pushState(null, null, '#' + tabName);
    }

    // Load data for the tab
    switch(tabName) {
        case 'dashboard':
            if (typeof loadDashboardStats === 'function') loadDashboardStats();
            break;
        case 'accounts':
            loadAccounts();
            break;
        case 'stores':
            loadStores();
            break;
        case 'store-status':
            loadGlobalDeliveryStatus();
            renderGlobalDeliveryPreview();
            loadLivePromotions();
            renderLivePromotionPreview();
            initializeStoreOfferCampaigns();
            loadCustomerFlashMessage();
            renderCustomerFlashPreview();
            if (pendingStoreStatusSectionId) {
                setTimeout(() => {
                    scrollToStoreStatusSection(pendingStoreStatusSectionId);
                    pendingStoreStatusSectionId = null;
                }, 120);
            }
            break;
        case 'products':
            loadProducts();
            break;
        case 'orders':
            loadOrders();
            break;
        case 'categories':
            loadCategories();
            break;
        case 'units':
            // Load units list when Units tab opened
            Promise.resolve(loadUnits()).catch(err => console.error('Error loading units tab', err));
            // Attach event listener for add unit button when tab is active
            setTimeout(() => {
                const addUnitBtn = document.getElementById('addUnitBtn');
                if (addUnitBtn) {
                    addUnitBtn.addEventListener('click', () => showAddUnitModal());
                }
            }, 100);
            break;
        case 'sizes':
            // Load sizes list when Sizes tab opened
            Promise.resolve(loadSizes()).catch(err => console.error('Error loading sizes tab', err));
            // Attach event listener for add size button when tab is active
            setTimeout(() => {
                const addSizeBtn = document.getElementById('addSizeBtn');
                if (addSizeBtn) {
                    addSizeBtn.addEventListener('click', () => showAddSizeModal());
                }
            }, 100);
            break;
        case 'riders':
            // loadRiders may be synchronous or return a Promise; normalize to Promise
            Promise.resolve(loadRiders()).then(() => {
                // If a caller requested to suppress auto-opening (e.g. openRiderSubtab),
                // skip opening the default subpanel. The flag is cleared here.
                if (window._skipRiderAutoOpen) {
                    window._skipRiderAutoOpen = false;
                    return;
                }
                // show the default Riders sub-panel
                openRiderSubtab('list');
            }).catch(() => {
                // still attempt to show the list panel unless suppressed
                if (window._skipRiderAutoOpen) {
                    window._skipRiderAutoOpen = false;
                    return;
                }
                openRiderSubtab('list');
            });
            break;
        // (rider fuel is now a sub-panel inside the Riders tab)
        case 'payments':
            loadPayments();
            break;
        case 'wallets':
            loadWallets();
            break;
        case 'user-rights':
            if (typeof loadUserRights === 'function') loadUserRights();
            break;
        case 'order-reports':
            // Reports tab doesn't need initial loading, user will generate reports manually
            break;
        case 'inventory-report':
            if (typeof window.setInventoryReportScope === 'function') window.setInventoryReportScope('inventory');
            loadInventoryReport();
            break;
        case 'sale-reports':
            if (typeof window.setInventoryReportScope === 'function') window.setInventoryReportScope('sales');
            loadInventoryReport();
            break;
        case 'rider-reports':
            if (typeof populateReportFilters === 'function') populateReportFilters();
            if (typeof loadRiderReports === 'function') loadRiderReports();
            break;
        case 'store-reports':
            if (typeof populateReportFilters === 'function') populateReportFilters();
            if (typeof loadStoreReports === 'function') loadStoreReports();
            break;
        case 'store-payment-term-reports':
            if (typeof loadStorePaymentTermReport === 'function') loadStorePaymentTermReport();
            break;
        case 'settings':
            if (typeof loadDeliveryFeeSettings === 'function') loadDeliveryFeeSettings();
            break;
        case 'db-backup':
            // Load list of available backups when backup tab is opened
            loadBackups();
            if (typeof loadClearableTables === 'function') loadClearableTables();
            if (typeof loadDeliveryFeeSettings === 'function') loadDeliveryFeeSettings();
            break;
        case 'financial-dashboard':
            if (typeof loadFinancialDashboard === 'function') loadFinancialDashboard();
            break;
        case 'transactions':
            if (typeof loadTransactions === 'function') loadTransactions();
            break;
        case 'payment-vouchers':
            if (typeof window['loadPaymentVouchers'] === 'function') window['loadPaymentVouchers']();
            break;
        case 'bank-payment-vouchers':
            if (typeof window['loadBankPaymentVouchers'] === 'function') window['loadBankPaymentVouchers']();
            break;
        case 'receipt-vouchers':
            if (typeof window['loadReceiptVouchers'] === 'function') window['loadReceiptVouchers']();
            break;
        case 'bank-receipt-vouchers':
            if (typeof window['loadBankReceiptVouchers'] === 'function') window['loadBankReceiptVouchers']();
            break;
        case 'rider-cash':
            if (typeof window['loadRiderCash'] === 'function') window['loadRiderCash']();
            break;
        case 'store-settlements':
            if (typeof window['loadStoreSettlements'] === 'function') window['loadStoreSettlements']();
            break;
        case 'expenses':
            if (typeof window['loadExpenses'] === 'function') window['loadExpenses']();
            break;
        case 'journal-vouchers':
            if (typeof window['loadJournalVouchers'] === 'function') window['loadJournalVouchers']();
            break;
        case 'financial-reports':
            if (typeof window['loadFinancialReports'] === 'function') window['loadFinancialReports']();
            break;
        case 'problems':
            loadProblemsDiagnostics();
            break;
    }

}

// Open a sub-panel inside the Riders tab (either 'list' or 'fuel')
function openRiderSubtab(subtab) {
    // Ensure main Riders tab is active. Set a short-lived flag to prevent
    // switchTab from auto-opening the default subpanel (avoids recursion).
    window._skipRiderAutoOpen = true;
    switchTab('riders');

    // Hide all rider subpanels
    document.querySelectorAll('.rider-subpanel').forEach(el => {
        el.style.display = 'none';
    });

    // Remove active class from subtab links and set on selected
    document.querySelectorAll('.rider-subtab-link').forEach(link => link.classList.remove('active'));
    const link = document.querySelector(`[data-rider-subtab="${subtab}"]`);
    if (link) link.classList.add('active');

    if (subtab === 'fuel') {
        const panel = document.getElementById('rider-fuel-panel');
        if (panel) panel.style.display = 'block';

        // Populate riders select and load history for selection
        loadRidersForFuelSelect().then(selId => {
            const sel = document.getElementById('fuelRiderSelect');
            const idToLoad = sel && sel.value ? sel.value : selId;
            if (idToLoad) loadFuelHistory(idToLoad).catch(()=>{});
        }).catch(err => console.error('Error opening rider fuel subtab', err));
    } else if (subtab === 'active') {
        const panel = document.getElementById('rider-active-panel');
        if (panel) panel.style.display = 'block';

        loadRidersForDeliveriesSelect('activeRiderSelect').then(() => {
            const sel = document.getElementById('activeRiderSelect');
            if (sel && sel.options.length > 1) {
                sel.selectedIndex = 1;
                loadRiderActiveDeliveries(sel.value);
            }
        }).catch(err => console.error('Error opening rider active deliveries subtab', err));
    } else if (subtab === 'completed') {
        const panel = document.getElementById('rider-completed-panel');
        if (panel) panel.style.display = 'block';

        loadRidersForDeliveriesSelect('completedRiderSelect').then(() => {
            const sel = document.getElementById('completedRiderSelect');
            if (sel && sel.options.length > 1) {
                sel.selectedIndex = 1;
                loadRiderCompletedDeliveries(sel.value);
            }
        }).catch(err => console.error('Error opening rider completed deliveries subtab', err));
    } else {
        const panel = document.getElementById('rider-list-panel');
        if (panel) panel.style.display = 'block';
        // ensure riders list is loaded
        loadRiders();
    }
}

// Load riders for deliveries select (Active/Completed tabs)
async function loadRidersForDeliveriesSelect(selectId) {
    try {
        const resp = await fetch(`${API_BASE}/api/riders`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await resp.json();
        if (data.success && data.riders && Array.isArray(data.riders)) {
            const select = document.getElementById(selectId);
            if (select) {
                select.innerHTML = '<option value="">-- Select Rider --</option>';
                data.riders.forEach(rider => {
                    const name = rider.full_name || `${rider.first_name || ''} ${rider.last_name || ''}`.trim() || 'Unknown Rider';
                    const opt = document.createElement('option');
                    opt.value = rider.id;
                    opt.textContent = `${name} (${rider.email})`;
                    select.appendChild(opt);
                });
            }
        }
    } catch (err) {
        console.error('Error loading riders for deliveries select:', err);
    }
}

// Load active deliveries for a rider
async function loadRiderActiveDeliveries(riderId) {
    try {
        const resp = await fetch(`${API_BASE}/api/orders/rider/${riderId}/deliveries?status=assigned&t=${Date.now()}`, {
            headers: { 'Authorization': `Bearer ${authToken}` },
            cache: 'no-store'
        });
        const data = await resp.json();
        if (data.success && data.deliveries) {
            displayRiderActiveDeliveries(data.deliveries);
        } else {
            document.getElementById('activeDeliveriesTableBody').innerHTML = '<tr><td colspan="8" style="text-align:center;">No active deliveries found.</td></tr>';
        }
    } catch (err) {
        console.error('Error loading active deliveries:', err);
        showError('Error', 'Failed to load active deliveries: ' + err.message);
    }
}

// Load completed deliveries for a rider
async function loadRiderCompletedDeliveries(riderId) {
    try {
        const resp = await fetch(`${API_BASE}/api/orders/rider/${riderId}/deliveries?status=completed&t=${Date.now()}`, {
            headers: { 'Authorization': `Bearer ${authToken}` },
            cache: 'no-store'
        });
        const data = await resp.json();
        if (data.success && data.deliveries) {
            displayRiderCompletedDeliveries(data.deliveries);
        } else {
            document.getElementById('completedDeliveriesTableBody').innerHTML = '<tr><td colspan="8" style="text-align:center;">No completed deliveries found.</td></tr>';
        }
    } catch (err) {
        console.error('Error loading completed deliveries:', err);
        showError('Error', 'Failed to load completed deliveries: ' + err.message);
    }
}

// Display active deliveries in table
function displayRiderActiveDeliveries(deliveries) {
    const tbody = document.getElementById('activeDeliveriesTableBody');
    tbody.innerHTML = '';
    
    if (!deliveries || deliveries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">No active deliveries found.</td></tr>';
        return;
    }

    deliveries.forEach(delivery => {
        const customerName = `${delivery.first_name || ''} ${delivery.last_name || ''}`.trim() || 'Unknown';
        const storeName = delivery.store_name || 'Multiple Stores';
        const status = delivery.status || 'Unknown';
        const createdAt = delivery.created_at ? new Date(delivery.created_at).toLocaleString() : 'N/A';
        const itemCount = delivery.items ? delivery.items.length : 0;
        const total = delivery.total_amount || 0;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>#${delivery.id}</td>
            <td>${customerName}</td>
            <td>${storeName}</td>
            <td><span class="status-pending">${status}</span></td>
            <td>${createdAt}</td>
            <td>${itemCount} item${itemCount !== 1 ? 's' : ''}</td>
            <td>Rs. ${Number(total).toFixed(2)}</td>
            <td>
                <button class="btn-small btn-primary" onclick="viewOrderDetails(${delivery.id})" title="View Details">
                    <i class="fas fa-eye"></i>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

// Display completed deliveries in table
function displayRiderCompletedDeliveries(deliveries) {
    const tbody = document.getElementById('completedDeliveriesTableBody');
    tbody.innerHTML = '';
    
    if (!deliveries || deliveries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">No completed deliveries found.</td></tr>';
        return;
    }

    deliveries.forEach(delivery => {
        const customerName = `${delivery.first_name || ''} ${delivery.last_name || ''}`.trim() || 'Unknown';
        const storeName = delivery.store_name || 'Multiple Stores';
        const status = delivery.status || 'delivered';
        const updatedAt = delivery.updated_at ? new Date(delivery.updated_at).toLocaleString() : 'N/A';
        const itemCount = delivery.items ? delivery.items.length : 0;
        const total = delivery.total_amount || 0;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>#${delivery.id}</td>
            <td>${customerName}</td>
            <td>${storeName}</td>
            <td><span class="status-active">${status}</span></td>
            <td>${updatedAt}</td>
            <td>${itemCount} item${itemCount !== 1 ? 's' : ''}</td>
            <td>Rs. ${Number(total).toFixed(2)}</td>
            <td>
                <button class="btn-small btn-primary" onclick="viewOrderDetails(${delivery.id})" title="View Details">
                    <i class="fas fa-eye"></i>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

// ---------------- Database backup client functions ----------------
function humanFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const thresh = 1024;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let u = 0;
    let n = bytes;
    while (n >= thresh && u < units.length - 1) {
        n /= thresh;
        u++;
    }
    return `${n.toFixed(2)} ${units[u]}`;
}

function makeDefaultBackupFilename(date = new Date()) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = date.toLocaleString('en-GB', { month: 'short' });
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `ServeNow-${day}-${month}-${year}-${hours}${minutes}`;
}

function setDefaultBackupFilename() {
    const filenameInput = document.getElementById('backupFilename');
    if (filenameInput && !filenameInput.value.trim()) {
        filenameInput.value = makeDefaultBackupFilename();
    }
}

async function createBackup() {
    const filenameInput = document.getElementById('backupFilename');
    const requestedName = (filenameInput?.value || '').trim();
    if (!requestedName) {
        showError('Backup', 'Please enter a backup file name');
        if (filenameInput) filenameInput.focus();
        return;
    }

    showInfo('Backup', 'Creating database backup...');
    try {
        const resp = await fetch(`${API_BASE}/api/admin/backup-db`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ filename: requestedName })
        });
        const data = await resp.json();
        if (data.success) {
            showSuccess('Backup Created', data.filename || 'Backup created');
            document.getElementById('backupStatus').textContent = `Last: ${data.filename}`;
            await loadBackups();
        } else {
            showError('Backup Failed', data.message || 'Unknown error');
        }
    } catch (err) {
        console.error('createBackup error:', err);
        showError('Backup Error', err.message || err);
    }
}

async function loadBackups() {
    const statusEl = document.getElementById('backupStatus');
    if (statusEl) statusEl.textContent = 'Loading...';
    try {
        const resp = await fetch(`${API_BASE}/api/admin/backup-db/list`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await resp.json();
        if (!data.success) {
            showError('Load Backups', data.message || 'Failed to list backups');
            if (statusEl) statusEl.textContent = '';
            return;
        }
        const body = document.getElementById('backupsTableBody');
        body.innerHTML = '';
        data.backups.forEach(b => {
            const tr = document.createElement('tr');
            const mtime = new Date(b.mtime).toLocaleString();
            tr.innerHTML = `
                <td><input type="radio" name="selBackup" value="${b.filename}" /></td>
                <td>${b.filename}</td>
                <td>${humanFileSize(b.size)}</td>
                <td>${mtime}</td>
                <td>
                    <button class="btn btn-small btn-info" onclick="downloadBackup('${encodeURIComponent(b.filename)}')">Download</button>
                    <button class="btn btn-small btn-warning" onclick="restoreBackup('${b.filename}')">Restore</button>
                </td>
            `;
            body.appendChild(tr);
        });
        if (statusEl) statusEl.textContent = `Found ${data.backups.length} backup(s)`;
    } catch (err) {
        console.error('loadBackups error:', err);
        showError('Load Backups', err.message || err);
        const statusEl2 = document.getElementById('backupStatus');
        if (statusEl2) statusEl2.textContent = '';
    }
}

async function downloadBackup(encodedFilename) {
    const filename = decodeURIComponent(encodedFilename);
    showInfo('Download', `Preparing download for ${filename}...`);
    try {
        const resp = await fetch(`${API_BASE}/api/admin/backup-db/download?file=${encodeURIComponent(filename)}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!resp.ok) {
            const text = await resp.text();
            showError('Download Failed', `Server responded: ${resp.status}`);
            console.error('Download error:', resp.status, text);
            return;
        }

        const blob = await resp.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
        showSuccess('Download Started', filename);
    } catch (err) {
        console.error('downloadBackup error:', err);
        showError('Download Error', err.message || err);
    }
}

async function restoreBackup(filename) {
    const uEl = document.getElementById('utilUsername');
    const pEl = document.getElementById('utilPassword');
    const u = uEl ? String(uEl.value || '') : '';
    const p = pEl ? String(pEl.value || '') : '';
    if (!u || !p) { showError('Restore', 'Enter restore username and restore passphrase in Utilities.'); return; }
    showInfo('Restore', `Restoring from ${filename}...`);
    try {
        const resp = await fetch(`${API_BASE}/api/admin/restore-db`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}`, 'X-Requested-From': 'web-admin' },
            body: JSON.stringify({ filename, username: u, password: p })
        });
        const data = await resp.json();
        if (resp.status === 501) {
            showError('Restore Disabled', data.message || 'Restore is disabled on this server');
            const btn = document.getElementById('restoreBackupBtn'); if (btn) btn.disabled = true;
            return;
        }
        if (resp.status === 423) {
            showError('Restore Locked', data.message || 'Another restore is in progress');
            return;
        }
        if (resp.status === 403) {
            showError('Restore Unauthorized', data.message || 'Invalid confirmation passphrase');
            return;
        }

        if (data.success) {
            showSuccess('Restore Complete', data.message || 'Database restored');
            await loadBackups();
        } else {
            showError('Restore Failed', data.message || 'Unknown error');
        }
    } catch (err) {
        console.error('restoreBackup error:', err);
        showError('Restore Error', err.message || err);
    }
}

async function restoreSelectedBackup() {
    const selected = document.querySelector('input[name="selBackup"]:checked');
    if (!selected) { showError('Restore', 'Please select a backup to restore'); return; }
    await restoreBackup(selected.value);
}

async function clearDatabaseWithBackup() {
    if (!confirm('Clear database and keep only admin user and categories? A backup will be created first.')) return;
    const uEl = document.getElementById('utilUsername');
    const pEl = document.getElementById('utilPassword');
    const u = uEl ? String(uEl.value || '') : '';
    const p = pEl ? String(pEl.value || '') : '';
    if (!u || !p) { showError('Clear Database', 'Enter super admin username and password'); return; }
    showInfo('Clear Database', 'Clearing database...');
    try {
        const resp = await fetch(`${API_BASE}/api/admin/clear-db?backup=1`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ backup: 1, username: u, password: p })
        });
        const ct = resp.headers.get('content-type') || '';
        let data = null;
        if (ct.includes('application/json')) {
            data = await resp.json();
        }
        if (resp.ok && data && data.success) {
            showSuccess('Database Cleared', data.message || 'Cleared successfully');
            await loadBackups();
            loadDashboardStats();
        } else {
            const text = (!data && !resp.ok) ? await resp.text() : '';
            showError('Clear Failed', (data && data.message) || (text ? `HTTP ${resp.status}` : 'Unknown error'));
        }
    } catch (err) {
        console.error('clearDatabaseWithBackup error:', err);
        showError('Clear Error', err.message || err);
    }
}

async function clearDatabaseKeepOne() {
    if (!confirm('Clear database and keep one record in each table (and admin user)? A backup will be created first.')) return;
    const uEl = document.getElementById('utilUsername');
    const pEl = document.getElementById('utilPassword');
    const u = uEl ? String(uEl.value || '') : '';
    const p = pEl ? String(pEl.value || '') : '';
    if (!u || !p) { showError('Clear Database', 'Enter super admin username and password'); return; }
    showInfo('Clear Database (Keep One)', 'Clearing database...');
    try {
        const resp = await fetch(`${API_BASE}/api/admin/clear-db-keep-one?backup=1`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ backup: 1, username: u, password: p })
        });
        const ct = resp.headers.get('content-type') || '';
        let data = null;
        if (ct.includes('application/json')) {
            data = await resp.json();
        }
        if (resp.ok && data && data.success) {
            showSuccess('Database Cleared', data.message || 'Cleared successfully');
            await loadBackups();
            loadDashboardStats();
        } else {
            if (resp.status === 404) {
                const fallback = await fetch(`${API_BASE}/api/admin/clear-db?backup=1`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                    body: JSON.stringify({ backup: 1, username: u, password: p })
                });
                const ct2 = fallback.headers.get('content-type') || '';
                let d2 = null;
                if (ct2.includes('application/json')) d2 = await fallback.json();
                if (fallback.ok && d2 && d2.success) {
                    showSuccess('Database Cleared', 'Keep-one endpoint not found; performed Keep Admin clear');
                    await loadBackups();
                    loadDashboardStats();
                } else {
                    const t2 = (!d2 && !fallback.ok) ? await fallback.text() : '';
                    showError('Clear Failed', (d2 && d2.message) || (t2 ? `HTTP ${fallback.status}` : 'Unknown error'));
                }
            } else {
                const text = (!data && !resp.ok) ? await resp.text() : '';
                showError('Clear Failed', (data && data.message) || (text ? `HTTP ${resp.status}` : 'Unknown error'));
            }
        }
    } catch (err) {
        console.error('clearDatabaseKeepOne error:', err);
        showError('Clear Error', err.message || err);
    }
}
function loadDashboardStats() {
    Promise.all([
        fetch(`${API_BASE}/api/orders`, { headers: { 'Authorization': `Bearer ${authToken}` } })
    ])
    .then(responses => Promise.all(responses.map(r => r.json())))
    .then(([orders]) => {
        const list = orders.orders || [];
        const todayOrders = list.filter(o => isServerDateToday(o.created_at));
        const countStatus = (arr, status) => arr.filter(o => (o.status || '').toLowerCase() === status).length;
        const countPendingLike = (arr) => arr.filter(o => {
            const s = (o.status || '').toLowerCase();
            return s !== 'delivered' && s !== 'cancelled';
        }).length;

        const el = (id) => document.getElementById(id);
        if (el('todayTotalOrders')) el('todayTotalOrders').textContent = todayOrders.length;
        if (el('todayDelivered')) el('todayDelivered').textContent = countStatus(todayOrders, 'delivered');
        if (el('todayPending')) el('todayPending').textContent = countPendingLike(todayOrders);
        if (el('todayCancelled')) el('todayCancelled').textContent = countStatus(todayOrders, 'cancelled');

        if (el('allTotalOrders')) el('allTotalOrders').textContent = list.length;
        if (el('allDelivered')) el('allDelivered').textContent = countStatus(list, 'delivered');
        if (el('allPending')) el('allPending').textContent = countPendingLike(list);
        if (el('allCancelled')) el('allCancelled').textContent = countStatus(list, 'cancelled');

        // Load recent activity
        loadRecentActivity();
    })
    .catch(error => console.error('Error loading dashboard stats:', error));
}

function loadRecentActivity() {
    fetch(`${API_BASE}/api/admin/recent-activity`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            renderActivityList('recentOrdersList', data.recent_orders);
            renderActivityList('recentUsersList', data.recent_users);
            renderActivityList('recentStoresList', data.recent_stores);
        }
    })
    .catch(err => console.error('Error loading recent activity:', err));
}

async function loadPushStatus() {
    const pill = document.getElementById('pushStatusPill');
    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value ?? '-';
    };
    if (pill) {
        pill.textContent = 'Checking…';
        pill.classList.remove('ready', 'error');
    }
    try {
        const response = await fetch(`${API_BASE}/api/stores/push-status`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Failed to load push status');
        }
        const service = data.push_service || {};
        const tokens = Array.isArray(data.tokens) ? data.tokens : [];
        const totalTokens = tokens.reduce((sum, t) => sum + (parseInt(String(t.active_tokens || 0), 10) || 0), 0);
        const lastSeen = tokens.map((t) => t.last_seen).filter(Boolean).sort().slice(-1)[0] || '-';
        setText('pushStatusReady', service.firebase_ready ? 'Yes' : 'No');
        setText('pushStatusSource', service.credential_source || '-');
        setText('pushStatusError', service.init_error || '-');
        setText('pushStatusTokens', String(totalTokens));
        setText('pushStatusLastSeen', lastSeen);
        if (pill) {
            if (service.firebase_ready) {
                pill.textContent = 'Ready';
                pill.classList.add('ready');
            } else {
                pill.textContent = 'Not Ready';
                pill.classList.add('error');
            }
        }
    } catch (error) {
        console.error('Error loading push status:', error);
        setText('pushStatusReady', 'No');
        setText('pushStatusSource', '-');
        setText('pushStatusError', error.message || 'Error');
        setText('pushStatusTokens', '-');
        setText('pushStatusLastSeen', '-');
        if (pill) {
            pill.textContent = 'Error';
            pill.classList.add('error');
        }
    }
}

function renderActivityList(containerId, items) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    if (!items || items.length === 0) {
        container.innerHTML = '<p style="color:#718096;font-size:0.9rem;font-style:italic;">No recent activity</p>';
        return;
    }

    items.forEach(item => {
        const colorKey = String(item.color || '').toLowerCase().trim();
        const allowedColors = new Set(['blue', 'green', 'orange', 'red', 'purple', 'teal']);
        const tone = allowedColors.has(colorKey) ? colorKey : 'blue';
        const div = document.createElement('div');
        div.className = `activity-item activity-item--${tone}`;
        div.innerHTML = `
            <div class="activity-accent"></div>
            <div class="activity-content">
                <div class="title">${item.title}</div>
                <div class="subtitle">${item.subtitle}</div>
                <div class="meta">
                    <span>${new Date(item.timestamp).toLocaleDateString()}</span>
                    <span>${new Date(item.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                </div>
            </div>
        `;
        // Add click listener
        div.onclick = () => showActivityDetails(item);
        container.appendChild(div);
    });
}

function showActivityDetails(item) {
    // Create modal HTML
    const modalId = 'activityDetailsModal';
    let modal = document.getElementById(modalId);
    if (modal) modal.remove(); // Remove existing to recreate

    modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal';
    modal.style.display = 'block'; // Make sure it's visible

    let detailsHtml = '<div class="detail-list" style="display:flex;flex-direction:column;gap:0.5rem;">';
    if (item.details) {
        for (const [key, value] of Object.entries(item.details)) {
            detailsHtml += `
                <div style="display:flex;justify-content:space-between;border-bottom:1px solid #eee;padding-bottom:0.25rem;">
                    <strong style="color:#4a5568;">${key}:</strong>
                    <span style="color:#2d3748;">${value || 'N/A'}</span>
                </div>
            `;
        }
    }
    detailsHtml += '</div>';

    modal.innerHTML = `
        <div class="modal-content" style="max-width:500px;">
            <span class="close" onclick="document.getElementById('${modalId}').remove()">&times;</span>
            <h3 style="margin-top:0;margin-bottom:1rem;color:#1a202c;border-bottom:2px solid #e2e8f0;padding-bottom:0.5rem;">
                ${item.title}
            </h3>
            ${detailsHtml}
            <div class="modal-footer" style="margin-top:1.5rem;text-align:right;">
                <button class="btn btn-primary" onclick="document.getElementById('${modalId}').remove()">Close</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Close on outside click
    modal.onclick = (e) => {
        if (e.target === modal) {
            e.preventDefault();
            e.stopPropagation();
        }
    };
}

function loadAccounts() {
    fetch(`${API_BASE}/api/users`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    })
    .then(response => response.json())
    .then(data => {
        AppState.accounts = data.users || [];
        displayAccounts(AppState.accounts);
        loadAccountStats();
        try { initializeAdminFilterMenus(); } catch (e) { console.warn('initializeAdminFilterMenus accounts error', e); }
        initializeTableSorting('accounts');
    })
    .catch(error => {
        console.error('Error loading accounts:', error);
        showError('Error', 'Failed to load accounts');
    });
}

function loadAccountStats() {
    const total = AppState.accounts.length;
    const active = AppState.accounts.filter(a => a.is_active === true || a.is_active === 1 || a.is_active === '1').length;
    const inactive = AppState.accounts.filter(a => a.is_active !== true && a.is_active !== 1 && a.is_active !== '1').length;
    const verified = AppState.accounts.filter(a => a.is_verified === true || a.is_verified === 1 || a.is_verified === '1').length;

    document.getElementById('totalAccountsCount').textContent = total;
    document.getElementById('activeAccountsCount').textContent = active;
    document.getElementById('inactiveAccountsCount').textContent = inactive;
    document.getElementById('verifiedAccountsCount').textContent = verified;
}

function displayAccounts(accounts) {
    const tbody = document.getElementById('accountsTableBody');
    tbody.innerHTML = '';

    accounts.forEach(account => {
        const row = document.createElement('tr');
        const createdDate = new Date(account.created_at).toLocaleDateString();
        
        const isVerified = account.is_verified === true || account.is_verified === 1 || account.is_verified === '1';
        const isActive = account.is_active === true || account.is_active === 1 || account.is_active === '1';
        
        const verifiedBadge = isVerified ? '<span class="status-active">Verified</span>' : '<span class="status-inactive">Unverified</span>';
        const statusBadge = isActive ? '<span class="status-active">Active</span>' : '<span class="status-inactive">Inactive</span>';

        row.innerHTML = `
            <td>${account.id}</td>
            <td>${account.first_name} ${account.last_name}</td>
            <td>${account.email}</td>
            <td>${account.phone || '-'}</td>
            <td>${account.user_type}</td>
            <td>${statusBadge}</td>
            <td>${verifiedBadge}</td>
            <td>${createdDate}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn-small btn-edit" onclick="editAccount(${account.id})">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button class="btn-small ${isActive ? 'btn-danger' : 'btn-success'}" onclick="toggleAccountStatus(${account.id}, ${isActive})">
                        <i class="fas fa-${isActive ? 'ban' : 'check'}"></i> ${isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button class="btn-small btn-warning" onclick="resetAccountVerification(${account.id}, '${account.email}')">
                        <i class="fas fa-shield-alt"></i> Reset Verify
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function setAccountPhotoPreview(imageUrl = '') {
    const preview = document.getElementById('editAccountImagePreview');
    const hidden = document.getElementById('editAccountImageUrl');
    const normalized = String(imageUrl || '').trim();
    if (hidden) hidden.value = normalized;
    if (!preview) return;
    if (normalized) {
        preview.src = normalized;
        preview.style.display = 'inline-block';
    } else {
        preview.src = '';
        preview.style.display = 'none';
    }
}

function bindAccountPhotoPreview() {
    const input = document.getElementById('editAccountImageFile');
    const preview = document.getElementById('editAccountImagePreview');
    if (!input || !preview) return;
    input.onchange = (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) {
            setAccountPhotoPreview(document.getElementById('editAccountImageUrl')?.value || '');
            return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
            preview.src = ev.target.result;
            preview.style.display = 'inline-block';
        };
        reader.readAsDataURL(file);
    };
}

async function uploadAccountPhotoIfSelected() {
    const input = document.getElementById('editAccountImageFile');
    const file = input?.files?.[0] || null;
    if (!file) {
        return String(document.getElementById('editAccountImageUrl')?.value || '').trim();
    }
    const formData = new FormData();
    formData.append('image', file);
    const response = await fetch(`${API_BASE}/api/admin/upload-image`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` },
        body: formData
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success || !data.image_url) {
        throw new Error(data?.message || 'Failed to upload user photo');
    }
    if (input) input.value = '';
    setAccountPhotoPreview(data.image_url);
    return data.image_url;
}

function showAddAccountModal() {
    document.getElementById('editAccountForm').reset();
    document.getElementById('editAccountId').value = '';
    AppState.editing.accountId = null;
    AppState.editing.accountOriginal = null;
    document.querySelector('#editAccountModal h3').textContent = 'Add New Account';
    const imageInput = document.getElementById('editAccountImageFile');
    if (imageInput) imageInput.value = '';
    setAccountPhotoPreview('');
    bindAccountPhotoPreview();

    // Handle store selection logic for Add Mode
    const storeGroup = document.getElementById('editAccountStoreGroup');
    const storeSelect = document.getElementById('editAccountStore');
    const userTypeSelect = document.getElementById('editAccountType');

    // Reset visibility
    storeGroup.style.display = 'none';
    storeSelect.value = "";

    // Populate store select if empty (preload it)
    if (storeSelect.options.length <= 1) {
        populateStoreDropdown(storeSelect, '');
    }

    // Attach listener for type change
    userTypeSelect.onchange = function() {
        if (this.value === 'store_owner') {
            storeGroup.style.display = 'block';
            if (storeSelect.options.length <= 1) populateStoreDropdown(storeSelect, storeSelect.value || '');
        } else {
            storeGroup.style.display = 'none';
        }
    };
    
    // Check initial state (e.g. if form reset defaulted to store_owner, though unlikely)
    if (userTypeSelect.value === 'store_owner') {
        storeGroup.style.display = 'block';
    }

    showModal('editAccountModal');
}

function editAccount(accountId) {
    const account = AppState.accounts.find(a => a.id === accountId);
    if (!account) {
        showError('Error', 'Account not found');
        return;
    }

    const isActive = account.is_active === true || account.is_active === 1 || account.is_active === '1';
    const isVerified = account.is_verified === true || account.is_verified === 1 || account.is_verified === '1';
    
    AppState.editing.accountId = accountId;
    AppState.editing.accountOriginal = {
        id: account.id,
        firstName: String(account.first_name || '').trim(),
        lastName: String(account.last_name || '').trim(),
        email: String(account.email || '').trim().toLowerCase(),
        phone: String(account.phone || '').trim(),
        idCardNum: String(account.id_card_num || '').trim(),
        imageUrl: String(account.image_url || '').trim(),
        userType: String(account.user_type || 'customer').trim(),
        isActive,
        isVerified,
        address: String(account.address || '').trim(),
        storeId: account.store_id === undefined || account.store_id === null || account.store_id === ''
            ? ''
            : String(account.store_id)
    };
    
    document.getElementById('editAccountId').value = accountId;
    document.getElementById('editAccountFirstName').value = account.first_name || '';
    document.getElementById('editAccountLastName').value = account.last_name || '';
    document.getElementById('editAccountEmail').value = account.email || '';
    document.getElementById('editAccountPhone').value = account.phone || '';
    document.getElementById('editAccountIdCardNum').value = account.id_card_num || '';
    document.getElementById('editAccountType').value = account.user_type || 'customer';
    document.getElementById('editAccountStatus').value = isActive ? '1' : '0';
    document.getElementById('editAccountVerified').value = isVerified ? '1' : '0';
    document.getElementById('editAccountAddress').value = account.address || '';
    document.getElementById('editAccountPassword').value = '';
    const imageInput = document.getElementById('editAccountImageFile');
    if (imageInput) imageInput.value = '';
    setAccountPhotoPreview(account.image_url || '');
    bindAccountPhotoPreview();

    // Handle store selection logic
    const storeGroup = document.getElementById('editAccountStoreGroup');
    const storeSelect = document.getElementById('editAccountStore');
    
    const selectedStoreId = account.store_id ? String(account.store_id) : '';
    populateStoreDropdown(storeSelect, selectedStoreId);

    if (account.user_type === 'store_owner') {
        storeGroup.style.display = 'block';
        // Set selected store if available
        storeSelect.value = selectedStoreId || '';
    } else {
        storeGroup.style.display = 'none';
        storeSelect.value = "";
    }

    // Attach listener for type change
    document.getElementById('editAccountType').onchange = function() {
        if (this.value === 'store_owner') {
            storeGroup.style.display = 'block';
            populateStoreDropdown(storeSelect, storeSelect.value || selectedStoreId || '');
        } else {
            storeGroup.style.display = 'none';
            storeSelect.value = '';
        }
    };

    document.querySelector('#editAccountModal h3').textContent = 'Edit Account';
    showModal('editAccountModal');
}

function populateStoreDropdown(selectElement, selectedStoreId = '') {
    const applyOptions = (stores) => {
        selectElement.innerHTML = '<option value="">Select Store...</option>';
        (stores || []).forEach(store => {
            const option = document.createElement('option');
            option.value = store.id;
            option.textContent = store.name;
            selectElement.appendChild(option);
        });
        if (selectedStoreId !== undefined && selectedStoreId !== null && String(selectedStoreId).trim() !== '') {
            selectElement.value = String(selectedStoreId);
        }
    };

    if (AppState.stores && AppState.stores.length > 0) {
        applyOptions(AppState.stores);
    } else {
        // Fallback fetch if AppState.stores not ready
        fetch(`${API_BASE}/api/stores?admin=1`, {
             headers: { 'Authorization': `Bearer ${authToken}` }
        })
        .then(res => res.json())
        .then(data => {
             if (data.success && data.stores) {
                 AppState.stores = data.stores;
                 applyOptions(data.stores);
             }
        });
    }
}

async function sendTestTrayNotification() {
    try {
        if (!window._adminDiag || typeof window._adminDiag.testTrayNotification !== 'function') {
            showError('Tray Test', 'Notification diagnostics is not initialized yet.');
            return;
        }
        const result = await window._adminDiag.testTrayNotification();
        if (result && result.ok) {
            showSuccess('Tray Test Sent', 'Check your PC system tray / notification center now.');
            return;
        }
        const reason = result?.reason || result?.error || 'Tray notification was not sent.';
        showWarning('Tray Test Failed', String(reason));
    } catch (err) {
        console.error('sendTestTrayNotification error:', err);
        showError('Tray Test Error', err?.message || String(err));
    }
}

async function saveAccount() {
    const accountId = document.getElementById('editAccountId').value;
    const firstName = String(document.getElementById('editAccountFirstName').value || '').trim();
    const lastName = String(document.getElementById('editAccountLastName').value || '').trim();
    const email = String(document.getElementById('editAccountEmail').value || '').trim();
    const phone = String(document.getElementById('editAccountPhone').value || '').trim();
    const idCardNum = String(document.getElementById('editAccountIdCardNum').value || '').trim();
    const userType = document.getElementById('editAccountType').value;
    const isActive = document.getElementById('editAccountStatus').value === '1';
    const isVerified = document.getElementById('editAccountVerified').value === '1';
    const address = String(document.getElementById('editAccountAddress').value || '').trim();
    const password = String(document.getElementById('editAccountPassword').value || '').trim();
    const storeId = String(document.getElementById('editAccountStore').value || '').trim();
    const normalizedEmail = email.toLowerCase();
    const original = accountId ? AppState.editing.accountOriginal : null;

    if (!firstName || !lastName || !email || !userType) {
        showWarning('Validation Error', 'Please fill in all required fields');
        return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showWarning('Validation Error', 'Please enter a valid email address');
        return;
    }
    if (phone && !/^[\d\s\-\+\(\)]{6,}$/.test(phone)) {
        showWarning('Validation Error', 'Phone must contain at least 6 valid phone characters');
        return;
    }
    if (password && password.length < 6) {
        showWarning('Validation Error', 'Password must be at least 6 characters');
        return;
    }
    if (idCardNum.length > 100) {
        showWarning('Validation Error', 'ID Card # must be 100 characters or less');
        return;
    }

    let imageUrl = '';
    try {
        imageUrl = await uploadAccountPhotoIfSelected();
    } catch (error) {
        console.error('Account photo upload failed:', error);
        showError('Upload Failed', error?.message || 'Failed to upload user photo');
        return;
    }

    let payload;

    if (accountId && original) {
        payload = {};

        if (firstName !== original.firstName) payload.firstName = firstName;
        if (lastName !== original.lastName) payload.lastName = lastName;
        if (normalizedEmail !== original.email) payload.email = email;
        if (phone !== original.phone) payload.phone = phone;
        if (idCardNum !== original.idCardNum) payload.id_card_num = idCardNum;
        if (imageUrl !== original.imageUrl) payload.image_url = imageUrl;
        if (address !== original.address) payload.address = address;
        if (userType !== original.userType) payload.user_type = userType;
        if (isActive !== original.isActive) payload.is_active = isActive;
        if (isVerified !== original.isVerified) payload.is_verified = isVerified;

        const originalStoreId = original.storeId || '';
        if (userType === 'store_owner') {
            if (storeId !== originalStoreId) {
                payload.store_id = storeId ? Number(storeId) : '';
            }
        } else if (original.userType === 'store_owner' || originalStoreId) {
            payload.user_type = userType;
        }

        if (password) {
            payload.password = password;
        }

        if (Object.keys(payload).length === 0) {
            showWarning('No Changes', 'There are no changes to save.');
            return;
        }
    } else {
        payload = {
            firstName,
            lastName,
            email,
            user_type: userType,
            is_active: isActive,
            is_verified: isVerified
        };

        if (phone) payload.phone = phone;
        if (idCardNum) payload.id_card_num = idCardNum;
        if (imageUrl) payload.image_url = imageUrl;
        if (address) payload.address = address;
        if (userType === 'store_owner' && storeId) payload.store_id = Number(storeId);
        if (password) {
            payload.password = password;
        }
    }

    const url = accountId ? `${API_BASE}/api/users/${accountId}` : `${API_BASE}/api/users`;
    const method = accountId ? 'PUT' : 'POST';

    const executeSave = async (savePayload) => {
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(savePayload)
        });

        let data = null;
        try {
            data = await response.json();
        } catch (_) {
            let rawText = '';
            try {
                rawText = await response.text();
            } catch (__){ }
            data = {
                success: false,
                message: rawText || `Request failed with status ${response.status}`
            };
        }

        return { response, data };
    };

    try {
        let { response, data } = await executeSave(payload);

        const shouldRetryWithoutOptionalFields =
            !response.ok &&
            response.status === 400 &&
            accountId &&
            userType !== 'store_owner' &&
            (Object.prototype.hasOwnProperty.call(payload, 'address') ||
             Object.prototype.hasOwnProperty.call(payload, 'store_id'));

        if (shouldRetryWithoutOptionalFields) {
            const retryPayload = {
                firstName,
                lastName,
                email,
                user_type: userType,
                is_active: isActive,
                is_verified: isVerified
            };
            if (!original || phone !== original.phone) {
                retryPayload.phone = phone;
            }
            if (password) {
                retryPayload.password = password;
            }
            if (idCardNum) {
                retryPayload.id_card_num = idCardNum;
            }
            if (imageUrl) {
                retryPayload.image_url = imageUrl;
            }

            console.warn('saveAccount retrying without optional fields', {
                accountId,
                originalPayload: payload,
                retryPayload,
                initialResponse: data
            });

            ({ response, data } = await executeSave(retryPayload));
        }

        if (data && data.success) {
            hideModal('editAccountModal');
            loadAccounts();
            const message = accountId ? 'Account updated successfully' : 'Account created successfully';
            showSuccess('Success', message);
            return;
        }

        const errorText = Array.isArray(data?.errors) && data.errors.length
            ? data.errors.map(e => {
                const field = e.path || e.param || e.location || '';
                const message = e.msg || e.message || JSON.stringify(e);
                return field ? `${field}: ${message}` : message;
            }).join(', ')
            : (data?.message || `Failed to save account (HTTP ${response.status})`);

        console.error('saveAccount failed', {
            status: response.status,
            payload,
            response: data
        });
        console.error('saveAccount failed details:', JSON.stringify({
            status: response.status,
            payload,
            response: data
        }, null, 2));
        showError('Account Save Failed', errorText, 8000);
    } catch (error) {
        console.error('Error saving account:', error);
        showError('Error', 'Failed to save account. Please try again.');
    }
}

function toggleAccountStatus(accountId, currentStatus) {
    fetch(`${API_BASE}/api/users/${accountId}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ is_active: !currentStatus })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            loadAccounts();
            const status = !currentStatus ? 'activated' : 'deactivated';
            showSuccess('Success', `Account ${status} successfully`);
        } else {
            showError('Error', 'Failed to update account status');
        }
    })
    .catch(error => {
        console.error('Error updating account status:', error);
        showError('Error', 'Failed to update account status');
    });
}

function resetAccountVerification(accountId) {
    if (!confirm('Are you sure you want to reset the verification status for this account?')) {
        return;
    }

    fetch(`${API_BASE}/api/users/${accountId}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ is_verified: false })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            loadAccounts();
            showSuccess('Success', 'Verification status reset. User will need to re-verify their email.');
        } else {
            showError('Error', 'Failed to reset verification status');
        }
    })
    .catch(error => {
        console.error('Error resetting verification:', error);
        showError('Error', 'Failed to reset verification status');
    });
}

function filterAccounts() {
    const searchText = document.getElementById('accountSearch').value.toLowerCase();
    const typeFilter = document.getElementById('accountTypeFilter').value;
    const statusFilter = document.getElementById('accountStatusFilter').value;
    const verifiedFilter = document.getElementById('accountVerifiedFilter').value;

    const filtered = AppState.accounts.filter(account => {
        const matchesSearch = account.first_name.toLowerCase().includes(searchText) ||
                              account.last_name.toLowerCase().includes(searchText) ||
                              account.email.toLowerCase().includes(searchText);
        
        const isActive = account.is_active === true || account.is_active === 1 || account.is_active === '1';
        const isVerified = account.is_verified === true || account.is_verified === 1 || account.is_verified === '1';
        
        const matchesType = !typeFilter || account.user_type === typeFilter;
        const matchesStatus = !statusFilter || (statusFilter === 'active' ? isActive : !isActive);
        const matchesVerified = !verifiedFilter || (verifiedFilter === 'verified' ? isVerified : !isVerified);

        return matchesSearch && matchesType && matchesStatus && matchesVerified;
    });

    displayAccounts(filtered);
}

function clearAccountFilters() {
    document.getElementById('accountSearch').value = '';
    document.getElementById('accountTypeFilter').value = '';
    document.getElementById('accountStatusFilter').value = '';
    document.getElementById('accountVerifiedFilter').value = '';
    displayAccounts(AppState.accounts);
}

function loadStores() {
    fetch(`${API_BASE}/api/stores?admin=1`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    })
    .then(response => response.json())
    .then(data => {
        AppState.stores = data.stores || [];
        displayStores(AppState.stores);
        try { initializeAdminFilterMenus(); } catch (e) { console.warn('initializeAdminFilterMenus stores error', e); }
        initializeTableSorting('stores');
    })
    .catch(error => console.error('Error loading stores:', error));
}

async function editStoreType() {
    showInfo('Coming Soon', 'Edit store functionality is being implemented.');
}

function deleteStore(storeId) {
    if (!confirm('Are you sure you want to permanently delete this store? This action cannot be undone.')) return;

    fetch(`${API_BASE}/api/stores/${storeId}`, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${authToken}`
        }
    })
    .then(async response => {
        const data = await response.json();
        if (response.ok) {
            showSuccess('Success', 'Store deleted successfully');
            loadStores();
        } else {
            // Handle 409 Conflict (Foreign Key Constraint)
            if (response.status === 409) {
                showError('Cannot Delete', data.message);
            } else {
                showError('Error', data.message || 'Failed to delete store');
            }
        }
    })
    .catch(error => {
        console.error('Error deleting store:', error);
        showError('Error', 'An unexpected error occurred');
    });
}

function showSetPriorityModal(storeId, storeName, currentPriority) {
    document.getElementById('priorityStoreName').textContent = storeName;
    document.getElementById('prioritySelect').value = currentPriority || '';
    document.getElementById('setPriorityForm').dataset.storeId = storeId;
    document.getElementById('setPriorityModal').style.display = 'block';
    updatePriorityWarning();
}

function updatePriorityWarning() {
    const selectedPriority = document.getElementById('prioritySelect').value;
    const warningDiv = document.getElementById('priorityWarning');
    
    if (!selectedPriority) {
        warningDiv.style.display = 'none';
        return;
    }
    
    const storeWithPriority = AppState.stores.find(s => s.priority == selectedPriority);
    if (storeWithPriority) {
        const currentStore = AppState.stores.find(s => s.id == document.getElementById('setPriorityForm').dataset.storeId);
        if (!currentStore || currentStore.priority != selectedPriority) {
            warningDiv.style.display = 'block';
            warningDiv.innerHTML = `<strong>⚠️ Warning:</strong> Priority ${selectedPriority} is already assigned to "${storeWithPriority.name}". Setting this priority will remove it from that store.`;
            return;
        }
    }
    warningDiv.style.display = 'none';
}

// Products Management
function loadProducts() {
    fetch(`${API_BASE}/api/products?admin=true&include_variants=0&include_image_variants=0`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    })
    .then(response => response.json())
    .then(data => {
        console.log('Products API response:', data);
        AppState.products = data.products || [];
        console.log('Current products array:', AppState.products);
        try { populateProductFilters(); } catch (e) { console.warn('populateProductFilters error', e); }
        try { initializeAdminFilterMenus(); } catch (e) { console.warn('initializeAdminFilterMenus products error', e); }
        displayProducts(AppState.products);
        initializeTableSorting('products');
    })
    .catch(error => console.error('Error loading products:', error));
}

function displayProducts(products) {
    const tbody = document.getElementById('productsTableBody');
    tbody.innerHTML = '';

    const groupedProducts = groupProductsByStore(products);
    if (!groupedProducts.length) {
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="8" class="text-center">No products found</td>';
        tbody.appendChild(row);
        return;
    }

    groupedProducts.forEach(group => {
        const isExpanded = AppState.productExpandedStores.has(group.key);
        const storeRow = document.createElement('tr');
        storeRow.className = 'product-store-row';
        storeRow.tabIndex = 0;
        storeRow.setAttribute('role', 'button');
        storeRow.setAttribute('aria-expanded', String(isExpanded));
        storeRow.innerHTML = `
            <td colspan="8">
                <div class="product-store-row-content">
                    <span class="product-store-toggle">
                        <i class="fas fa-chevron-${isExpanded ? 'down' : 'right'}"></i>
                    </span>
                    <span class="product-store-name">${escapeHtml(group.name)}</span>
                </div>
            </td>
        `;
        const toggleStore = () => {
            if (AppState.productExpandedStores.has(group.key)) {
                AppState.productExpandedStores.delete(group.key);
            } else {
                AppState.productExpandedStores.add(group.key);
            }
            displayProducts(products);
        };
        storeRow.addEventListener('click', toggleStore);
        storeRow.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleStore();
            }
        });
        tbody.appendChild(storeRow);

        if (isExpanded) {
            group.products.forEach(product => appendProductRow(tbody, product));
        }
    });
}

function groupProductsByStore(products) {
    const groups = new Map();
    (products || []).forEach(product => {
        const storeId = product.store_id ?? product.storeId ?? '';
        const storeName = String(product.store_name || 'Unknown Store').trim() || 'Unknown Store';
        const key = storeId ? `store-${storeId}` : `store-name-${storeName.toLowerCase()}`;
        if (!groups.has(key)) {
            groups.set(key, { key, name: storeName, products: [] });
        }
        groups.get(key).products.push(product);
    });
    return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function appendProductRow(tbody, product) {
        const productId = product.id || '';
        const productName = product.name || '';
        const productPrice = product.price || 0;
        const categoryName = product.category_name || 'N/A';
        const storeName = product.store_name || '';
        const stockQuantity = product.stock_quantity || 0;
        const isAvailable = product.is_available;

        const row = document.createElement('tr');
        row.className = 'product-child-row';
        row.innerHTML = `
            <td>${productId}</td>
            <td>${escapeHtml(productName)}</td>
            <td>PKR ${productPrice}</td>
            <td>${escapeHtml(categoryName)}</td>
            <td>${escapeHtml(storeName)}</td>
            <td>${stockQuantity}</td>
            <td><span class="status-${isAvailable ? 'active' : 'inactive'}">${isAvailable ? 'Available' : 'Unavailable'}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="btn-small btn-edit" onclick="editProduct(${productId})">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button class="btn-small ${isAvailable ? 'btn-danger' : 'btn-success'}" onclick="toggleProductStatus(${productId}, ${isAvailable})">
                        <i class="fas fa-${isAvailable ? 'ban' : 'check'}"></i> ${isAvailable ? 'Deactivate' : 'Activate'}
                    </button>
                </div>
            </td>
        `;
        const ensureHoverCard = () => {
            let card = document.getElementById('productHoverCard');
            if (!card) {
                card = document.createElement('div');
                card.id = 'productHoverCard';
                card.style.position = 'absolute';
                card.style.zIndex = '10000';
                card.style.display = 'none';
                card.style.minWidth = '260px';
                card.style.maxWidth = '340px';
                card.style.padding = '10px';
                card.style.borderRadius = '10px';
                card.style.boxShadow = '0 8px 24px rgba(0,0,0,0.18)';
                card.style.background = 'linear-gradient(180deg, #fff 0%, #f6f7fb 100%)';
                card.style.border = '1px solid var(--border-color)';
                card.style.pointerEvents = 'none';
                document.body.appendChild(card);
            }
            return card;
        };
        const renderCard = (p) => {
            const statusColor = isAvailable ? '#16a34a' : '#ef4444';
            const statusBg = isAvailable ? 'rgba(22,163,74,0.12)' : 'rgba(239,68,68,0.12)';
            let imgSrc = p.image_url ? String(p.image_url).trim().replace(/\\/g, '/') : '';
            if (imgSrc) {
                if (!(imgSrc.startsWith('http') || imgSrc.startsWith('data:'))) {
                    imgSrc = API_BASE.replace(/\/$/, '') + '/' + imgSrc.replace(/^\/+/, '');
                }
            }
            const avatar = imgSrc ? `<img src="${imgSrc}" alt="${productName}" style="width:56px;height:56px;border-radius:8px;object-fit:cover;border:1px solid var(--border-color);">` : `<div style="width:56px;height:56px;border-radius:8px;background:var(--bg-body);border:1px solid var(--border-color);display:flex;align-items:center;justify-content:center;color:#6b7280;font-weight:700;">${(productName||'P').slice(0,1).toUpperCase()}</div>`;
            const pill = `<span style="padding:4px 8px;border-radius:999px;font-size:12px;font-weight:600;display:inline-block;background:${statusBg};color:${statusColor};">${isAvailable ? 'Available' : 'Unavailable'}</span>`;
            const label = (lbl, val) => `<div style="display:flex;gap:8px;align-items:flex-start;"><div style="width:88px;color:#9ca3af;font-size:12px;">${lbl}</div><div style="flex:1;color:#374151;font-size:13px;word-break:break-word;">${val || '-'}</div></div>`;
            return `
                <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;">
                    ${avatar}
                    <div style="flex:1;min-width:0;">
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                            <div style="font-weight:800;color:#1f2937;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;">${productName}</div>
                            ${pill}
                        </div>
                        <div style="color:#64748b;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;">${categoryName}</div>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;"><span style="color:#111827;font-weight:800;">PKR ${productPrice}</span></div>
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;">
                    ${label('Store', storeName)}
                    ${label('Category', categoryName)}
                    ${label('Stock', p.unit_name ? (String(stockQuantity) + ' ' + p.unit_name) : String(stockQuantity))}
                    ${label('Unit', p.unit_name || '')}
                    ${label('Size', p.size_label || '')}
                </div>
            `;
        };
        const positionCard = (card, evt) => {
            const x = (evt.clientX || 0) + 16 + (window.scrollX || 0);
            const y = (evt.clientY || 0) + 16 + (window.scrollY || 0);
            const ww = window.innerWidth || document.documentElement.clientWidth || 800;
            const wh = window.innerHeight || document.documentElement.clientHeight || 600;
            card.style.display = 'block';
            card.style.left = x + 'px';
            card.style.top = y + 'px';
            const rect = card.getBoundingClientRect();
            if (rect.right > ww) card.style.left = Math.max(8, x - (rect.right - ww) - 24) + 'px';
            if (rect.bottom > wh) card.style.top = Math.max(8, y - (rect.bottom - wh) - 24) + 'px';
        };
        const isOverActions = (evt) => {
            const el = document.elementFromPoint(evt.clientX, evt.clientY);
            return !!(el && (el.closest('.action-buttons') || (el.closest('td') && el.closest('td').querySelector('.action-buttons'))));
        };
        const showCard = (evt) => {
            if (isOverActions(evt)) return;
            const card = ensureHoverCard();
            card.innerHTML = renderCard(product);
            positionCard(card, evt);
        };
        const moveCard = (evt) => {
            if (isOverActions(evt)) {
                const card = document.getElementById('productHoverCard');
                if (card) card.style.display = 'none';
                return;
            }
            const card = document.getElementById('productHoverCard');
            if (card && card.style.display !== 'none') positionCard(card, evt);
        };
        const hideCard = () => {
            const card = document.getElementById('productHoverCard');
            if (card) card.style.display = 'none';
        };
        row.addEventListener('mouseenter', showCard);
        row.addEventListener('mousemove', moveCard);
        row.addEventListener('mouseleave', hideCard);
        tbody.appendChild(row);
}

// Export Base64 Images removed



function toggleProductStatus(productId, currentStatus) {
    fetch(`${API_BASE}/api/products/${productId}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ is_available: !currentStatus })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            loadProducts();
        } else {
            showError('Error', 'Failed to update product status. Please try again.');
        }
    })
    .catch(error => console.error('Error updating product:', error));
}

// Orders Management
function getTodayDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parseServerDateTime(value) {
    if (!value) return null;
    const text = String(value).trim();
    if (!text) return null;
    const normalized = text.includes('T') ? text : text.replace(' ', 'T');
    const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(normalized);
    const parsed = new Date(hasZone ? normalized : `${normalized}Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isServerDateToday(value) {
    const dt = parseServerDateTime(value);
    if (!dt) return false;
    const today = new Date();
    return dt.getFullYear() === today.getFullYear() &&
           dt.getMonth() === today.getMonth() &&
           dt.getDate() === today.getDate();
}

function getOrderBusinessDate(order) {
    const explicitDate = String(order?.order_business_date || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(explicitDate)) return explicitDate;

    const storedDate = String(order?.created_at || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(storedDate)) return storedDate;

    const dt = parseServerDateTime(order?.created_at);
    if (!dt) return '';
    const year = dt.getFullYear();
    const month = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function scrollToStoreStatusSection(sectionId) {
    if (!sectionId) return;
    const section = document.getElementById(sectionId);
    if (!section) return;
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function enhanceFilterSelectsToTypeable() {
    const selects = Array.from(document.querySelectorAll('select[id*="Filter"], select[id*="filter"]'))
        .filter((sel) => sel && !sel.dataset.typeableEnhanced);

    const makeLabel = (opt) => {
        const text = String(opt?.textContent || '').trim();
        return text;
    };

    const syncDatalist = (select, datalist) => {
        const current = new Set();
        datalist.innerHTML = '';
        Array.from(select.options || []).forEach((opt) => {
            const label = makeLabel(opt);
            if (!label || current.has(label)) return;
            current.add(label);
            const o = document.createElement('option');
            o.value = label;
            datalist.appendChild(o);
        });
    };

    selects.forEach((select) => {
        // Skip if this select is inside a non-filter form group and explicitly opted out
        if (select.dataset.noTypeable === '1') return;

        const parent = select.parentElement;
        if (!parent) return;

        const input = document.createElement('input');
        const datalist = document.createElement('datalist');

        const inputId = `${select.id}Typeable`;
        const datalistId = `${select.id}TypeableList`;

        input.type = 'text';
        input.id = inputId;
        input.className = select.className || 'form-control';
        input.dataset.sourceSelectId = select.id;
        input.dataset.filterListId = datalistId;
        input.placeholder = select.getAttribute('data-placeholder') || 'Type to filter...';
        input.autocomplete = 'off';

        datalist.id = datalistId;

        // Initial value from selected option label.
        const selectedOption = select.options[select.selectedIndex];
        input.value = selectedOption ? makeLabel(selectedOption) : '';

        syncDatalist(select, datalist);

        const applyInputToSelect = () => {
            const typed = String(input.value || '').trim().toLowerCase();
            let matchedValue = '';

            if (!typed) {
                // Prefer first option when cleared (typically "All").
                const first = select.options[0];
                matchedValue = first ? first.value : '';
            } else {
                const exact = Array.from(select.options || []).find(
                    (opt) => makeLabel(opt).toLowerCase() === typed
                );
                if (exact) matchedValue = exact.value;
            }

            if (select.value !== matchedValue) {
                select.value = matchedValue;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                select.dispatchEvent(new Event('input', { bubbles: true }));
            }
        };

        input.addEventListener('change', applyInputToSelect);
        input.addEventListener('input', () => {
            // For responsive filtering, keep existing logic updated as user types when exact match exists.
            const typed = String(input.value || '').trim().toLowerCase();
            const exact = Array.from(select.options || []).find(
                (opt) => makeLabel(opt).toLowerCase() === typed
            );
            if (exact && select.value !== exact.value) {
                select.value = exact.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                select.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });

        select.addEventListener('change', () => {
            const opt = select.options[select.selectedIndex];
            input.value = opt ? makeLabel(opt) : '';
        });

        // Keep datalist fresh when options are reloaded dynamically.
        const observer = new MutationObserver(() => {
            syncDatalist(select, datalist);
            const opt = select.options[select.selectedIndex];
            input.value = opt ? makeLabel(opt) : '';
        });
        observer.observe(select, { childList: true, subtree: true, attributes: true });

        // Hide original select but keep it in DOM for existing listeners/business logic.
        select.style.display = 'none';

        // Insert enhanced controls.
        parent.insertBefore(input, select.nextSibling);
        parent.insertBefore(datalist, input.nextSibling);

        select.dataset.typeableEnhanced = '1';
    });
}

function parseOfferCampaignDateTime(value) {
    const v = String(value || '').trim();
    return v ? v : nowDateTimeLocalValue();
}

async function loadOfferCampaignStores() {
    const storeEl = document.getElementById('offerCampaignStoreId');
    if (!storeEl) return;
    try {
        const stores = await ApiServiceLike_getStoresLite();
        storeEl.innerHTML = '';
        stores.forEach((s) => {
            const opt = document.createElement('option');
            opt.value = String(s.id);
            opt.textContent = `${s.name} (#${s.id})`;
            storeEl.appendChild(opt);
        });
        if (!stores.length) {
            storeEl.innerHTML = '<option value="">No stores found</option>';
        }
    } catch (e) {
        console.error('Error loading campaign stores:', e);
        storeEl.innerHTML = '<option value="">Failed to load stores</option>';
    }
}

async function ApiServiceLike_getStoresLite() {
    const response = await fetch(`${API_BASE}/api/stores?admin=1&lite=1`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await response.json();
    if (!response.ok || !data.success) return [];
    return Array.isArray(data.stores) ? data.stores : [];
}

async function loadOfferCampaignProducts(storeId) {
    const productsEl = document.getElementById('offerSelectedProducts');
    if (!productsEl) return;
    const sid = parseInt(String(storeId || ''), 10);
    if (!Number.isInteger(sid) || sid <= 0) {
        productsEl.innerHTML = '';
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/api/products?admin=1&store=${sid}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            productsEl.innerHTML = '<option value="">Failed to load products</option>';
            return;
        }
        const products = Array.isArray(data.products) ? data.products : [];
        productsEl.innerHTML = '';
        products.forEach((p) => {
            const opt = document.createElement('option');
            opt.value = String(p.id);
            opt.textContent = `${p.name} (#${p.id})`;
            productsEl.appendChild(opt);
        });
        if (!products.length) productsEl.innerHTML = '<option value="">No products found</option>';
    } catch (e) {
        console.error('Error loading campaign products:', e);
        productsEl.innerHTML = '<option value="">Failed to load products</option>';
    }
}

function updateOfferCampaignFieldVisibility() {
    const type = (document.getElementById('offerCampaignType')?.value || 'discount').toLowerCase();
    const scope = (document.getElementById('offerCampaignScope')?.value || 'all_products').toLowerCase();
    const showDiscount = type === 'discount';
    const showBxgy = type === 'bxgy';
    const showSelected = scope === 'selected_products';
    const show = (id, visible) => {
        const el = document.getElementById(id);
        if (el) el.style.display = visible ? '' : 'none';
    };
    show('offerDiscountTypeWrap', showDiscount);
    show('offerDiscountValueWrap', showDiscount);
    show('offerBuyQtyWrap', showBxgy);
    show('offerGetQtyWrap', showBxgy);
    show('offerSelectedProductsWrap', showSelected);
}

function resetOfferCampaignForm() {
    AppState.editingOfferCampaignId = null;
    const setVal = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
    };
    setVal('offerCampaignName', '');
    setVal('offerCampaignDescription', '');
    setVal('offerCampaignType', 'discount');
    setVal('offerCampaignScope', 'all_products');
    setVal('offerDiscountType', 'percent');
    setVal('offerDiscountValue', '');
    setVal('offerBuyQty', '1');
    setVal('offerGetQty', '1');
    setVal('offerCampaignStartAt', nowDateTimeLocalValue());
    setVal('offerCampaignEndAt', nowDateTimeLocalValue());
    const enabledEl = document.getElementById('offerCampaignEnabled');
    if (enabledEl) enabledEl.checked = true;
    const sel = document.getElementById('offerSelectedProducts');
    if (sel) Array.from(sel.options || []).forEach((o) => { o.selected = false; });
    updateOfferCampaignFieldVisibility();
}

async function loadStoreOfferCampaigns() {
    const storeId = parseInt(String(document.getElementById('offerCampaignStoreId')?.value || ''), 10);
    const tbody = document.getElementById('offerCampaignsTableBody');
    if (!tbody) return;
    if (!Number.isInteger(storeId) || storeId <= 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:10px;">Select a store first</td></tr>';
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/api/stores/offer-campaigns?store_id=${storeId}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:10px;">Failed to load campaigns</td></tr>';
            return;
        }
        const rows = Array.isArray(data.campaigns) ? data.campaigns : [];
        AppState.storeOfferCampaigns = rows;
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:10px;">No campaigns found</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map((c) => `
            <tr>
                <td>${c.id}</td>
                <td>${escapeHtml(c.name || '')}</td>
                <td>${escapeHtml(c.offer_badge || c.campaign_type || '')}</td>
                <td>${escapeHtml(c.apply_scope || '')}</td>
                <td>${escapeHtml(String(c.start_at || ''))}<br/>${escapeHtml(String(c.end_at || ''))}</td>
                <td><span class="status-${c.is_active_now ? 'active' : (c.is_enabled ? 'pending' : 'inactive')}">${c.is_active_now ? 'Active' : (c.is_enabled ? 'Scheduled' : 'Disabled')}</span></td>
                <td>
                    <button class="btn-small btn-info" onclick="editOfferCampaign(${c.id})">Edit</button>
                    <button class="btn-small btn-danger" onclick="deleteOfferCampaign(${c.id})">Delete</button>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        console.error('Error loading offer campaigns:', e);
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:10px;">Failed to load campaigns</td></tr>';
    }
}

function editOfferCampaign(campaignId) {
    const campaign = (AppState.storeOfferCampaigns || []).find((x) => Number(x.id) === Number(campaignId));
    if (!campaign) return;
    AppState.editingOfferCampaignId = Number(campaign.id);
    const setVal = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value == null ? '' : String(value);
    };
    setVal('offerCampaignName', campaign.name || '');
    setVal('offerCampaignDescription', campaign.description || '');
    setVal('offerCampaignType', campaign.campaign_type || 'discount');
    setVal('offerCampaignScope', campaign.apply_scope || 'all_products');
    setVal('offerDiscountType', campaign.discount_type || 'percent');
    setVal('offerDiscountValue', campaign.discount_value ?? '');
    setVal('offerBuyQty', campaign.buy_qty ?? '1');
    setVal('offerGetQty', campaign.get_qty ?? '1');
    setVal('offerCampaignStartAt', toDateTimeLocalValue(campaign.start_at) || nowDateTimeLocalValue());
    setVal('offerCampaignEndAt', toDateTimeLocalValue(campaign.end_at) || nowDateTimeLocalValue());
    const enabledEl = document.getElementById('offerCampaignEnabled');
    if (enabledEl) enabledEl.checked = !!campaign.is_enabled;

    updateOfferCampaignFieldVisibility();
    const sel = document.getElementById('offerSelectedProducts');
    if (sel) {
        const wanted = new Set((Array.isArray(campaign.product_ids) ? campaign.product_ids : []).map((x) => String(x)));
        Array.from(sel.options || []).forEach((o) => { o.selected = wanted.has(String(o.value || '')); });
    }
}

async function saveOfferCampaign() {
    const storeId = parseInt(String(document.getElementById('offerCampaignStoreId')?.value || ''), 10);
    if (!Number.isInteger(storeId) || storeId <= 0) {
        showWarning('Missing Store', 'Please select a store');
        return;
    }
    const name = String(document.getElementById('offerCampaignName')?.value || '').trim();
    const description = String(document.getElementById('offerCampaignDescription')?.value || '').trim();
    const campaignType = String(document.getElementById('offerCampaignType')?.value || 'discount').toLowerCase();
    const applyScope = String(document.getElementById('offerCampaignScope')?.value || 'all_products').toLowerCase();
    const discountType = String(document.getElementById('offerDiscountType')?.value || 'percent').toLowerCase();
    const discountValue = Number(document.getElementById('offerDiscountValue')?.value || 0);
    const buyQty = parseInt(String(document.getElementById('offerBuyQty')?.value || '0'), 10);
    const getQty = parseInt(String(document.getElementById('offerGetQty')?.value || '0'), 10);
    const isEnabled = !!document.getElementById('offerCampaignEnabled')?.checked;
    const startAt = parseOfferCampaignDateTime(document.getElementById('offerCampaignStartAt')?.value || '');
    const endAt = parseOfferCampaignDateTime(document.getElementById('offerCampaignEndAt')?.value || '');
    const selectedProducts = Array.from(document.getElementById('offerSelectedProducts')?.selectedOptions || [])
        .map((o) => parseInt(String(o.value || ''), 10))
        .filter((x) => Number.isInteger(x) && x > 0);

    if (!name) {
        showWarning('Missing Name', 'Campaign name is required');
        return;
    }
    if (!startAt || !endAt || new Date(startAt) >= new Date(endAt)) {
        showWarning('Invalid Window', 'End time must be after start time');
        return;
    }
    if (campaignType === 'discount' && !(discountValue > 0)) {
        showWarning('Invalid Discount', 'Discount value must be greater than 0');
        return;
    }
    if (campaignType === 'bxgy' && (!(buyQty > 0) || !(getQty > 0))) {
        showWarning('Invalid BxGy', 'Buy/Get quantity must be greater than 0');
        return;
    }
    if (applyScope === 'selected_products' && !selectedProducts.length) {
        showWarning('Missing Products', 'Select at least one product');
        return;
    }

    const payload = {
        store_id: storeId,
        name,
        description,
        campaign_type: campaignType,
        apply_scope: applyScope,
        is_enabled: isEnabled,
        start_at: startAt,
        end_at: endAt,
        product_ids: applyScope === 'selected_products' ? selectedProducts : []
    };
    if (campaignType === 'discount') {
        payload.discount_type = discountType;
        payload.discount_value = discountValue;
    } else {
        payload.buy_qty = buyQty;
        payload.get_qty = getQty;
    }

    const editingId = Number(AppState.editingOfferCampaignId || 0);
    const isEdit = Number.isInteger(editingId) && editingId > 0;
    const url = isEdit ? `${API_BASE}/api/stores/offer-campaigns/${editingId}` : `${API_BASE}/api/stores/offer-campaigns`;
    const method = isEdit ? 'PUT' : 'POST';

    const saveBtn = document.getElementById('saveOfferCampaignBtn');
    try {
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            showError('Save Failed', data.message || 'Failed to save campaign');
            return;
        }
        showSuccess('Saved', isEdit ? 'Campaign updated successfully' : 'Campaign created successfully');
        resetOfferCampaignForm();
        await loadOfferCampaignProducts(storeId);
        await loadStoreOfferCampaigns();
    } catch (e) {
        console.error('Error saving campaign:', e);
        showError('Save Failed', 'Failed to save campaign');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fas fa-tags"></i> Save Offer Campaign';
        }
    }
}

async function deleteOfferCampaign(campaignId) {
    if (!confirm('Delete this campaign?')) return;
    try {
        const response = await fetch(`${API_BASE}/api/stores/offer-campaigns/${campaignId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            showError('Delete Failed', data.message || 'Failed to delete campaign');
            return;
        }
        showSuccess('Deleted', 'Campaign deleted successfully');
        await loadStoreOfferCampaigns();
    } catch (e) {
        console.error('Error deleting campaign:', e);
        showError('Delete Failed', 'Failed to delete campaign');
    }
}
window.editOfferCampaign = editOfferCampaign;
window.deleteOfferCampaign = deleteOfferCampaign;

function bindStoreOfferCampaignControls() {
    const storeEl = document.getElementById('offerCampaignStoreId');
    if (!storeEl) return;
    if (!storeEl.dataset.boundChange) {
        storeEl.addEventListener('change', async () => {
            const sid = parseInt(String(storeEl.value || ''), 10);
            await loadOfferCampaignProducts(sid);
            await loadStoreOfferCampaigns();
        });
        storeEl.dataset.boundChange = '1';
    }
    ['offerCampaignType', 'offerCampaignScope'].forEach((id) => {
        const el = document.getElementById(id);
        if (el && !el.dataset.boundChange) {
            el.addEventListener('change', updateOfferCampaignFieldVisibility);
            el.dataset.boundChange = '1';
        }
    });
    const saveBtn = document.getElementById('saveOfferCampaignBtn');
    if (saveBtn && !saveBtn.dataset.boundClick) {
        saveBtn.addEventListener('click', saveOfferCampaign);
        saveBtn.dataset.boundClick = '1';
    }
    const resetBtn = document.getElementById('resetOfferCampaignBtn');
    if (resetBtn && !resetBtn.dataset.boundClick) {
        resetBtn.addEventListener('click', resetOfferCampaignForm);
        resetBtn.dataset.boundClick = '1';
    }
}

async function initializeStoreOfferCampaigns() {
    const storeEl = document.getElementById('offerCampaignStoreId');
    if (!storeEl) return;
    await loadOfferCampaignStores();
    const sid = parseInt(String(storeEl.value || ''), 10);
    await loadOfferCampaignProducts(sid);
    await loadStoreOfferCampaigns();
    updateOfferCampaignFieldVisibility();
    if (!document.getElementById('offerCampaignStartAt')?.value) {
        document.getElementById('offerCampaignStartAt').value = nowDateTimeLocalValue();
    }
    if (!document.getElementById('offerCampaignEndAt')?.value) {
        document.getElementById('offerCampaignEndAt').value = nowDateTimeLocalValue();
    }
}

function ensureOrderDateFiltersDefault(force = false) {
    const startInput = document.getElementById('filterStartDate');
    const endInput = document.getElementById('filterEndDate');
    if (!startInput || !endInput) return;
    const today = getTodayDateString();
    const preset = document.getElementById('orderDatePreset');
    const presetValue = String(preset?.value || '').toLowerCase();
    const shouldUseToday = force || !presetValue || presetValue === 'today';

    if (preset && (force || !preset.value)) {
        preset.value = 'today';
    }

    if (shouldUseToday) {
        startInput.value = today;
        endInput.value = today;
        return;
    }

    if (!startInput.value) startInput.value = today;
    if (!endInput.value) endInput.value = today;
}

function applyOrderDatePreset(mode, triggerLoad = false) {
    const startInput = document.getElementById('filterStartDate');
    const endInput = document.getElementById('filterEndDate');
    if (!startInput || !endInput) return;

    if (mode === 'today') {
        const today = getTodayDateString();
        startInput.value = today;
        endInput.value = today;
    } else if (mode === 'custom') {
        if (!startInput.value || !endInput.value) {
            const today = getTodayDateString();
            if (!startInput.value) startInput.value = today;
            if (!endInput.value) endInput.value = today;
        }
    }
    if (triggerLoad) loadOrders();
}

function loadOrders() {
    let url = `${API_BASE}/api/orders`;
    // If we wanted to support "My Orders" for standard users in admin panel, we could change this.
    // But currently requirement says standard user should see ALL orders to assign riders.
    // So we keep it as /api/orders which now allows standard_user.

    // Default behavior: on page load/reload show current date records.
    ensureOrderDateFiltersDefault(false);
    const startDate = document.getElementById('filterStartDate')?.value || '';
    const endDate = document.getElementById('filterEndDate')?.value || '';
    const storeFilterRaw = (document.getElementById('filterStore')?.value || '').trim();
    const qs = new URLSearchParams();
    if (startDate) qs.append('startDate', startDate);
    if (endDate) qs.append('endDate', endDate);
    if (storeFilterRaw && /^\d+$/.test(storeFilterRaw)) qs.append('storeId', storeFilterRaw);
    if (qs.toString()) {
        url += `?${qs.toString()}`;
    }

    fetch(url, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    })
    .then(response => {
        if (response.status === 403) {
            console.error('Access denied to fetch orders');
            return { success: false, message: 'Access denied' };
        }
        return response.json();
    })
    .then(data => {
        if (!data.success) {
            console.error('Failed to load orders:', data.message);
            return;
        }
        // Store orders data globally for edit functionality
        AppState.orders = data.orders || [];
        
        // Populate rider filter
        populateRiderFilter();
        populateStoreFilter();
        try { initializeAdminFilterMenus(); } catch (e) { console.warn('initializeAdminFilterMenus orders error', e); }
        
        // Apply client-side rider/status/assignment filters on fetched date range.
        filterOrders();
        
        // Update dashboard tiles
        try {
            const today = getTodayDateString();
            const todayOrders = AppState.orders.filter(o => getOrderBusinessDate(o) === today);
            const countStatus = (arr, status) => arr.filter(o => (o.status || '').toLowerCase() === status).length;
            const countPendingLike = (arr) => arr.filter(o => {
                const s = (o.status || '').toLowerCase();
                return s !== 'delivered' && s !== 'cancelled';
            }).length;
            const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
            set('todayTotalOrders', todayOrders.length);
            set('todayDelivered', countStatus(todayOrders, 'delivered'));
            set('todayPending', countPendingLike(todayOrders));
            set('todayCancelled', countStatus(todayOrders, 'cancelled'));
            set('allTotalOrders', AppState.orders.length);
            set('allDelivered', countStatus(AppState.orders, 'delivered'));
            set('allPending', countPendingLike(AppState.orders));
            set('allCancelled', countStatus(AppState.orders, 'cancelled'));
        } catch (e) { /* ignore */ }
    })
    .catch(error => console.error('Error loading orders:', error));
}

function populateRiderFilter() {
    const filterRider = document.getElementById('filterRider');
    const filterRiderList = document.getElementById('filterRiderList');
    if (!filterRider || !filterRiderList) return;
    const riders = new Set();
    
    AppState.orders.forEach(order => {
        if (order.rider_first_name) {
            riders.add(`${order.rider_first_name} ${order.rider_last_name || ''}`.trim());
        }
    });
    
    const currentValue = filterRider.value;
    filterRiderList.innerHTML = '<option value="All Riders"></option>';

    Array.from(riders).sort().forEach(rider => {
        const option = document.createElement('option');
        option.value = rider;
        filterRiderList.appendChild(option);
    });

    filterRider.value = currentValue;
}

function populateStoreFilter() {
    const filterStore = document.getElementById('filterStore');
    const filterStoreList = document.getElementById('filterStoreList');
    if (!filterStore || !filterStoreList) return;

    const currentValue = filterStore.value;
    const uniqueStores = new Map();

    (AppState.orders || []).forEach(order => {
        const orderStoreId = order?.store_id;
        const orderStoreName = (order?.store_name || '').trim();
        if (orderStoreId && orderStoreName) {
            uniqueStores.set(String(orderStoreId), orderStoreName);
        }

        const rawStatuses = order?.store_statuses;
        if (!rawStatuses) return;
        let parsed = rawStatuses;
        if (typeof rawStatuses === 'string') {
            try { parsed = JSON.parse(rawStatuses); } catch (_) { parsed = []; }
        }
        if (Array.isArray(parsed)) {
            parsed.forEach(s => {
                const sid = s?.store_id;
                const sname = (s?.store_name || '').trim();
                if (sid && sname) {
                    uniqueStores.set(String(sid), sname);
                }
            });
        }
    });

    filterStoreList.innerHTML = '<option value="All Stores"></option>';
    Array.from(uniqueStores.entries())
        .sort((a, b) => a[1].localeCompare(b[1]))
        .forEach(([, name]) => {
            const option = document.createElement('option');
            option.value = name;
            filterStoreList.appendChild(option);
        });

    filterStore.value = currentValue;
}

function getOrderIndicatorColor(status) {
    const normalized = String(status || '').trim().toLowerCase();
    switch (normalized) {
        case 'confirmed':
            return '#3b82f6';
        case 'ready':
        case 'delivered':
        case 'completed':
        case 'approved':
        case 'paid':
            return '#10b981';
        case 'out_for_delivery':
        case 'cancelled':
        case 'rejected':
        case 'failed':
            return '#ef4444';
        case 'pending':
        case 'preparing':
        default:
            return '#f59e0b';
    }
}

function buildOrderCustomerAlertSummary(order) {
    const flags = [];
    if (order?.delivery_address) flags.push('Delivery address');
    if (order?.delivery_time) flags.push('Preferred delivery time');
    if (order?.special_instructions) flags.push('Special instructions');
    return flags.join(' and ');
}

function shouldAnimateOrderIndicator(status) {
    const normalized = String(status || '').trim().toLowerCase();
    return !['delivered', 'completed', 'cancelled'].includes(normalized);
}

async function resetOrderToNew(orderId, orderNumber = '') {
    if (!canResetTerminalOrderToNew()) {
        showError('Access Denied', 'You do not have permission to reset delivered or cancelled orders.');
        return;
    }

    const label = orderNumber ? `order ${orderNumber}` : `order #${orderId}`;
    if (!confirm(`Reset ${label} to new pending state? Rider assignment will be cleared.`)) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/orders/${orderId}/reset-to-new`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            }
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            showError('Reset Failed', data.message || 'Failed to reset order to new.');
            return;
        }
        showSuccess('Order Reset', `${label} is back in the new order queue.`);
        loadOrders();
    } catch (error) {
        console.error('Error resetting order to new:', error);
        showError('Reset Failed', 'Failed to reset order to new.');
    }
}

function parseOrderStoreStatuses(order) {
    const rawStatuses = order?.store_statuses;
    let statuses = [];

    if (rawStatuses) {
        if (typeof rawStatuses === 'string') {
            try {
                statuses = JSON.parse(rawStatuses);
            } catch (_) {
                statuses = [];
            }
        } else if (Array.isArray(rawStatuses)) {
            statuses = rawStatuses;
        }
    }

    const uniqueStores = new Map();
    statuses.forEach((storeStatus) => {
        const storeId = storeStatus?.store_id || storeStatus?.store_name || uniqueStores.size;
        if (!uniqueStores.has(storeId)) uniqueStores.set(storeId, storeStatus);
    });

    return Array.from(uniqueStores.values());
}

function parseOrderStoreItems(order) {
    const rawItems = order?.order_store_details;
    if (!rawItems) return [];
    if (Array.isArray(rawItems)) return rawItems;
    if (typeof rawItems !== 'string') return [];
    try {
        const parsed = JSON.parse(rawItems);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

function formatTinyMoney(value) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) return '0';
    return amount.toLocaleString('en-PK', {
        maximumFractionDigits: amount % 1 === 0 ? 0 : 2
    });
}

function buildOrderStoreDetailsHtml(order) {
    const storeItems = parseOrderStoreItems(order);
    const storeStatuses = parseOrderStoreStatuses(order);
    const fallbackStore = order?.store_name || 'Multiple Stores';
    const makeStoreSummaryHtml = () => `
        <summary class="orders-store-summary">
            <span class="orders-store-summary-title">View Details</span>
        </summary>
    `;

    if (storeItems.length) {
        const stores = new Map();
        storeItems.forEach((item) => {
            const storeId = item?.store_id || item?.store_name || stores.size;
            if (!stores.has(storeId)) {
                stores.set(storeId, {
                    store_name: item?.store_name || `Store #${item?.store_id || '-'}`,
                    status: item?.status || 'pending',
                    total: 0,
                    items: []
                });
            }
            const store = stores.get(storeId);
            const quantity = Number(item?.quantity || 0);
            const price = Number(item?.price || 0);
            const lineTotal = Number(item?.line_total || (quantity * price) || 0);
            store.total += Number.isFinite(lineTotal) ? lineTotal : 0;
            store.items.push({
                product_name: item?.product_name || `Product #${item?.product_id || '-'}`,
                variant_label: item?.variant_label || '',
                quantity,
                price,
                line_total: lineTotal
            });
        });

        const groupedStores = Array.from(stores.values());
        const storeRows = groupedStores.map((store) => {
            const productRows = store.items.map((item) => {
                const label = item.variant_label
                    ? `${item.product_name} (${item.variant_label})`
                    : item.product_name;
                return `
                    <span class="orders-store-product">
                        <span class="orders-store-product-name">${escapeHtml(String(label))}</span>
                        <span>${escapeHtml(String(item.quantity || 0))} x ${formatTinyMoney(item.price)}</span>
                        <span>${formatTinyMoney(item.line_total)}</span>
                    </span>
                `;
            }).join('');
            const status = String(store.status || 'pending');
            return `
                <span class="orders-store-block">
                    <span class="orders-store-line">
                        <span class="orders-store-name">${escapeHtml(String(store.store_name))}</span>
                        <span class="orders-store-amount">Rs ${formatTinyMoney(store.total)}</span>
                    </span>
                    ${productRows}
                    <span class="orders-store-status status-${escapeHtml(status)}">${escapeHtml(status.replace(/_/g, ' '))}</span>
                </span>
            `;
        }).join('');

        return `
            <details class="orders-store-cell">
                ${makeStoreSummaryHtml()}
                <span class="orders-store-page">
                    <span class="orders-store-meta">Order: ${escapeHtml(String(order?.order_number || '-'))}</span>
                    ${storeRows}
                    <span class="orders-store-total">Total Rs ${formatTinyMoney(order?.total_amount)}</span>
                </span>
            </details>
        `;
    }

    if (!storeStatuses.length) {
        return `
            <details class="orders-store-cell">
                ${makeStoreSummaryHtml()}
                <span class="orders-store-page">
                    <span class="orders-store-meta">Order: ${escapeHtml(String(order?.order_number || '-'))}</span>
                    <span class="orders-store-total">Total Rs ${formatTinyMoney(order?.total_amount)}</span>
                </span>
            </details>
        `;
    }

    const storeRows = storeStatuses.map((storeStatus) => {
        const storeName = storeStatus?.store_name || `Store #${storeStatus?.store_id || '-'}`;
        const status = String(storeStatus?.status || 'pending');
        return `
            <span class="orders-store-line">
                <span class="orders-store-name">${escapeHtml(String(storeName))}</span>
                <span class="orders-store-status status-${escapeHtml(status)}">${escapeHtml(status.replace(/_/g, ' '))}</span>
            </span>
        `;
    }).join('');

    return `
        <details class="orders-store-cell">
            ${makeStoreSummaryHtml()}
            <span class="orders-store-page">
                <span class="orders-store-meta">Order: ${escapeHtml(String(order?.order_number || '-'))}</span>
                ${storeRows}
                <span class="orders-store-total">Total Rs ${formatTinyMoney(order?.total_amount)}</span>
            </span>
        </details>
    `;
}

function displayOrders(orders = AppState.orders) {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';

    if (!orders || !Array.isArray(orders)) return;

    const formatOrderDateTime = (value) => {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return { date: '-', time: '' };
        const day = String(date.getDate()).padStart(2, '0');
        const month = date.toLocaleString('en-GB', { month: 'short' });
        const year = date.getFullYear();
        const time = date.toLocaleString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
        return {
            date: `${day}-${month}-${year}`,
            time
        };
    };

    const formatOrderDuration = (startRaw, endRaw) => {
        const start = new Date(startRaw);
        const end = new Date(endRaw);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '-';
        const diffMs = end.getTime() - start.getTime();
        if (diffMs < 0) return '-';
        const totalMinutes = Math.floor(diffMs / 60000);
        const days = Math.floor(totalMinutes / (24 * 60));
        const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
        const mins = totalMinutes % 60;
        const parts = [];
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0 || days > 0) parts.push(`${hours}h`);
        parts.push(`${mins}m`);
        return parts.join(' ');
    };

    orders.forEach(order => {
        const riderName = order.rider_first_name
            ? `${order.rider_first_name} ${order.rider_last_name || ''}`.trim()
            : 'Not Assigned';
        const row = document.createElement('tr');
        const preferredDeliveryTime = order.delivery_time ? escapeHtml(String(order.delivery_time)) : '';
        const deliveryAddress = order.delivery_address ? escapeHtml(String(order.delivery_address)) : '';
        const specialInstructions = order.special_instructions ? escapeHtml(String(order.special_instructions)) : '';
        const riderLocationHtml = buildRiderLocationHtml(order);
        const orderDateTime = formatOrderDateTime(order.created_at);
        const hasCustomerAlert = Boolean(deliveryAddress || preferredDeliveryTime || specialInstructions);
        const indicatorColor = getOrderIndicatorColor(order.status);
        const shouldBlinkCustomerDetails = hasCustomerAlert && shouldAnimateOrderIndicator(order.status);
        const indicatorClass = shouldBlinkCustomerDetails
            ? 'order-note-indicator'
            : 'order-note-indicator is-static';
        const alertSummary = hasCustomerAlert
            ? escapeHtml(buildOrderCustomerAlertSummary(order))
            : '';
        const customerHtml = `
            <div class="orders-customer-cell${shouldBlinkCustomerDetails ? ' is-attention' : ''}" style="--order-indicator-color:${indicatorColor};">
                <span class="orders-customer-name${shouldBlinkCustomerDetails ? ' is-attention' : ''}">
                    ${hasCustomerAlert ? `<span class="${indicatorClass}" style="--order-indicator-color:${indicatorColor};" title="${alertSummary}"></span>` : ''}
                    <span>${order.first_name} ${order.last_name}</span>
                </span>
                ${deliveryAddress ? `<span class="orders-cell-meta${shouldBlinkCustomerDetails ? ' is-attention' : ''}">Address: ${deliveryAddress}</span>` : ''}
                ${preferredDeliveryTime ? `<span class="orders-cell-meta${shouldBlinkCustomerDetails ? ' is-attention' : ''}">Preferred Time: ${preferredDeliveryTime}</span>` : ''}
                ${specialInstructions ? `<span class="orders-cell-meta${shouldBlinkCustomerDetails ? ' is-attention' : ''}">Instructions: ${specialInstructions}</span>` : ''}
            </div>
        `;

        const isDelivered = String(order.status || '').toLowerCase() === 'delivered';
        const isCancelled = String(order.status || '').toLowerCase() === 'cancelled';
        const isLockedOrder = isDelivered || isCancelled;
        const canResetLockedOrder = isLockedOrder && canResetTerminalOrderToNew();
        const deliveredAt = order.delivered_at || order.completed_at || order.updated_at;
        const timeTaken = isDelivered
            ? formatOrderDuration(order.created_at, deliveredAt || order.created_at)
            : 'In Progress';
        const orderNumberHtml = `
            <div class="orders-number-cell">
                <span style="font-weight:700;">${order.order_number}</span>
                <span class="orders-cell-meta">Time Taken: ${timeTaken}</span>
            </div>
        `;
        
        const storeDetailsHtml = buildOrderStoreDetailsHtml(order);

        // Multi-store status tooltip
        let statusHtml = `<span class="status-${order.status}">${order.status.charAt(0).toUpperCase() + order.status.slice(1)}</span>`;
        
        if (order.store_statuses) {
            try {
                // Determine if there are delays or mixed statuses
                let statuses = parseOrderStoreStatuses(order);
                
                if (statuses && Array.isArray(statuses)) {
                    const uniqueStatuses = statuses;

                    const isMixed = uniqueStatuses.length > 1 && new Set(uniqueStatuses.map(s => s.status)).size > 1;
                    const isDelayed = order.status === 'preparing' && uniqueStatuses.some(s => s.status === 'ready'); // One ready, others still preparing

                    if (isMixed || isDelayed) {
                        const tooltipContent = uniqueStatuses.map(s => 
                            `<div><strong>${s.store_name}:</strong> <span class="status-${s.status}">${s.status.toUpperCase()}</span></div>`
                        ).join('');
                        
                        statusHtml += `
                            <div class="store-status-details" style="font-size: 0.8em; margin-top: 4px;">
                                ${isDelayed ? '<span style="color: orange;"><i class="fas fa-exclamation-triangle"></i> Delayed</span>' : ''}
                                <div class="store-status-tooltip">
                                    <i class="fas fa-info-circle" style="color: #666; cursor: pointer;" title="Store Details"></i>
                                    <div class="tooltip-content" style="display: none; position: absolute; background: white; border: 1px solid #ccc; padding: 5px; z-index: 100; box-shadow: 2px 2px 5px rgba(0,0,0,0.2);">
                                        ${tooltipContent}
                                    </div>
                                </div>
                            </div>
                        `;
                    }
                }
            } catch (e) { console.error('Error parsing store statuses', e); }
        }

        row.innerHTML = `
            <td>${orderNumberHtml}</td>
            <td>${customerHtml}</td>
            <td>${storeDetailsHtml}</td>
            <td>PKR ${parseFloat(order.total_amount).toFixed(2)}</td>
            <td>${statusHtml}</td>
            <td>${riderName}</td>
            <td class="orders-location-cell">
                <div class="orders-location-stack">${riderLocationHtml}</div>
            </td>
            <td class="orders-date-cell">
                <div class="orders-date-stack">
                    <span class="orders-date-primary">${orderDateTime.date}</span>
                    <span class="orders-date-secondary">${orderDateTime.time}</span>
                </div>
            </td>
            <td>
                <div class="action-buttons">
                    <button class="btn-small btn-info" onclick="viewOrderDetails(${order.id})" title="View order details" aria-label="View order details">
                        <i class="fas fa-eye"></i> View
                    </button>
                    ${isLockedOrder ? '' : `
                    <button class="btn-small btn-edit" onclick="editOrder(${order.id})" title="Edit order" aria-label="Edit order">
                        <i class="fas fa-edit"></i> Edit
                    </button>`}
                    ${canResetLockedOrder ? `
                    <button class="btn-small btn-warning" onclick="resetOrderToNew(${order.id}, '${escapeHtml(order.order_number)}')" title="Reset order to new" aria-label="Reset order to new">
                        <i class="fas fa-undo"></i> Reset New
                    </button>` : ''}
                </div>
            </td>
        `;
        
        // Add hover effect for tooltip
        const tooltipTrigger = row.querySelector('.fa-info-circle');
        if (tooltipTrigger) {
            const tooltipContent = row.querySelector('.tooltip-content');
            tooltipTrigger.addEventListener('mouseenter', () => tooltipContent.style.display = 'block');
            tooltipTrigger.addEventListener('mouseleave', () => tooltipContent.style.display = 'none');
        }

        tbody.appendChild(row);
    });
}

function filterOrders() {
    const startDateFilter = document.getElementById('filterStartDate').value;
    const endDateFilter = document.getElementById('filterEndDate').value;
    const riderFilter = (document.getElementById('filterRider')?.value || '').trim().toLowerCase();
    const statusInput = (document.getElementById('filterStatus')?.value || '').trim().toLowerCase();
    const storeFilter = (document.getElementById('filterStore')?.value || '').trim().toLowerCase();
    const assignmentInput = (document.getElementById('filterAssignment')?.value || '').trim().toLowerCase();
    const statusMap = {
        'pending': 'pending',
        'confirmed': 'confirmed',
        'preparing': 'preparing',
        'ready': 'ready',
        'out for delivery': 'out_for_delivery',
        'out_for_delivery': 'out_for_delivery',
        'delivered': 'delivered',
        'cancelled': 'cancelled',
        'all statuses': ''
    };
    const assignmentMap = {
        'all assignments': 'all',
        'all': 'all',
        'unassigned': 'unassigned',
        'assigned': 'assigned'
    };
    const statusFilter = statusMap[statusInput] !== undefined ? statusMap[statusInput] : statusInput;
    const assignmentFilter = assignmentMap[assignmentInput] !== undefined ? assignmentMap[assignmentInput] : (assignmentInput || 'all');
    
    let filtered = AppState.orders;
    
    // Filter by date range
    if (startDateFilter || endDateFilter) {
        filtered = filtered.filter(order => {
            const orderDate = getOrderBusinessDate(order);
            
            if (startDateFilter && endDateFilter) {
                return orderDate >= startDateFilter && orderDate <= endDateFilter;
            } else if (startDateFilter) {
                return orderDate >= startDateFilter;
            } else if (endDateFilter) {
                return orderDate <= endDateFilter;
            }
            return true;
        });
    }
    
    // Filter by status
    if (statusFilter) {
        filtered = filtered.filter(order => order.status === statusFilter);
    }
    
    // Filter by rider
    if (riderFilter && riderFilter !== 'all riders') {
        filtered = filtered.filter(order => {
            const riderName = order.rider_first_name
                ? `${order.rider_first_name} ${order.rider_last_name || ''}`.trim()
                : '';
            return riderName.toLowerCase().includes(riderFilter);
        });
    }

    // Filter by store
    if (storeFilter && storeFilter !== 'all stores') {
        filtered = filtered.filter(order => {
            const topStoreName = String(order?.store_name || '').trim().toLowerCase();
            if (topStoreName.includes(storeFilter)) return true;
            if (String(order?.store_id || '') === String(storeFilter)) return true;

            const rawStatuses = order?.store_statuses;
            if (!rawStatuses) return false;
            let parsed = rawStatuses;
            if (typeof rawStatuses === 'string') {
                try { parsed = JSON.parse(rawStatuses); } catch (_) { parsed = []; }
            }
            if (!Array.isArray(parsed)) return false;
            return parsed.some(s =>
                String(s?.store_id || '') === String(storeFilter)
                || String(s?.store_name || '').trim().toLowerCase().includes(storeFilter)
            );
        });
    }

    // Filter by assignment
    if (assignmentFilter === 'unassigned') {
        filtered = filtered.filter(order => !order.rider_id && order.status !== 'delivered' && order.status !== 'cancelled');
    } else if (assignmentFilter === 'assigned') {
        filtered = filtered.filter(order => order.rider_id);
    }
    
    displayOrders(filtered);
}

function clearFilters() {
    const preset = document.getElementById('orderDatePreset');
    if (preset) preset.value = 'today';
    ensureOrderDateFiltersDefault(true);
    document.getElementById('filterRider').value = '';
    const storeFilter = document.getElementById('filterStore');
    if (storeFilter) storeFilter.value = '';
    const statusFilter = document.getElementById('filterStatus');
    if (statusFilter) statusFilter.value = '';
    const assignmentFilter = document.getElementById('filterAssignment');
    if (assignmentFilter) assignmentFilter.value = 'All Assignments';
    loadOrders();
}

const DEFAULT_PARCEL_DELIVERY_FEE = 150;

async function applyCurrentDeliveryCharges(forceParcel = false) {
    const deliveryFeeEl = document.getElementById('manualOrderDeliveryFee');
    if (!deliveryFeeEl) return;
    const isParcel = forceParcel || isManualParcelOrder();
    if (isParcel) {
        deliveryFeeEl.value = Number(DEFAULT_PARCEL_DELIVERY_FEE).toFixed(2);
        return DEFAULT_PARCEL_DELIVERY_FEE;
    }
    const btn = document.getElementById('manualOrderApplyDefaultFeeBtn');
    if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fee...';
    try {
        const res = await fetch(`${API_BASE}/api/orders/delivery-fee-config`);
        const data = await res.json();
        if (data && data.success && Number.isFinite(Number(data.base_fee))) {
            const fee = Number(data.base_fee);
            window._deliveryFeeBase = fee;
            deliveryFeeEl.value = fee.toFixed(2);
            return fee;
        }
    } catch (e) {
        console.warn('Could not fetch delivery-fee-config:', e);
    } finally {
        if (btn) btn.innerHTML = '<i class="fas fa-sync-alt"></i> Apply Current Fee';
    }
    const fallback = Number(window._deliveryFeeBase ?? 70);
    deliveryFeeEl.value = fallback.toFixed(2);
    return fallback;
}

async function openManualOrderModal(initialMode = 'product') {
    const tasks = [
        loadManualOrderCustomers(),
        loadManualOrderStores(),
        loadManualOrderCategories(),
        loadManualOrderRiders()
    ];
    const results = await Promise.allSettled(tasks);
    const hasFailure = results.some((r) => r.status === 'rejected');
    if (hasFailure) {
        console.warn('Some manual order dropdowns failed to load:', results);
    }

    const form = document.getElementById('manualOrderForm');
    if (form) form.reset();
    const createPanel = document.getElementById('manualCreateCustomerPanel');
    if (createPanel) createPanel.style.display = 'none';
    const createStorePanel = document.getElementById('manualCreateStorePanel');
    if (createStorePanel) createStorePanel.style.display = 'none';
    const qtyEl = document.getElementById('manualOrderQty');
    if (qtyEl) qtyEl.value = '1';
    const typeEl = document.getElementById('manualOrderType');
    if (typeEl) typeEl.value = initialMode || 'product';
    const deliveryFeeEl = document.getElementById('manualOrderDeliveryFee');
    if (deliveryFeeEl) deliveryFeeEl.value = '';
    const existingProductInput = document.getElementById('manualOrderExistingProduct');
    if (existingProductInput) existingProductInput.value = '';
    const existingProductId = document.getElementById('manualOrderProductId');
    if (existingProductId) existingProductId.value = '';
    const existingProductList = document.getElementById('manualOrderExistingProductList');
    if (existingProductList) existingProductList.innerHTML = '';
    const saveForFutureEl = document.getElementById('manualOrderSaveForFuture');
    if (saveForFutureEl) saveForFutureEl.checked = initialMode !== 'parcel';
    const visibleStoreEl = document.getElementById('manualStoreVisibleToCustomers');
    if (visibleStoreEl) visibleStoreEl.checked = false;

    const modalTitle = document.querySelector('#manualOrderModal .modal-header h3');
    if (modalTitle) {
        modalTitle.textContent = initialMode === 'parcel'
            ? 'Pick & Drop Parcel Delivery (Customer to Destination)'
            : 'Create Manual Order (Call/No Listing)';
    }

    updateManualOrderMode();
    if (initialMode === 'parcel') {
        applyCurrentDeliveryCharges();
    }

    showModal('manualOrderModal');
}

function isManualParcelOrder() {
    return (document.getElementById('manualOrderType')?.value || 'product') === 'parcel';
}

function updateManualOrderMode() {
    const isParcel = isManualParcelOrder();

    // Toggle tab buttons visual state
    const productTab = document.getElementById('manualTypeProductTab');
    const parcelTab = document.getElementById('manualTypeParcelTab');
    if (productTab && parcelTab) {
        if (isParcel) {
            productTab.style.borderColor = 'transparent';
            productTab.style.background = '#f3f4f6';
            productTab.style.color = '#4b5563';
            productTab.classList.remove('active');

            parcelTab.style.borderColor = '#f59e0b';
            parcelTab.style.background = '#fef3c7';
            parcelTab.style.color = '#92400e';
            parcelTab.classList.add('active');
        } else {
            productTab.style.borderColor = '#2563eb';
            productTab.style.background = '#eff6ff';
            productTab.style.color = '#1e40af';
            productTab.classList.add('active');

            parcelTab.style.borderColor = 'transparent';
            parcelTab.style.background = '#f3f4f6';
            parcelTab.style.color = '#4b5563';
            parcelTab.classList.remove('active');
        }
    }

    const parcelNotice = document.getElementById('manualParcelNotice');
    if (parcelNotice) parcelNotice.style.display = isParcel ? 'block' : 'none';

    document.querySelectorAll('.manual-product-order-field').forEach((el) => {
        el.style.display = isParcel ? 'none' : '';
    });

    const parcelFields = document.getElementById('manualParcelOrderFields');
    if (parcelFields) parcelFields.style.display = isParcel ? '' : 'none';

    const storeLabel = document.getElementById('manualOrderStoreLabel');
    if (storeLabel) storeLabel.textContent = isParcel ? 'Store Reference (Auto-assigned for Parcel)' : 'Store';

    const createStoreBtn = document.getElementById('toggleCreateManualStoreBtn');
    if (createStoreBtn) createStoreBtn.style.display = isParcel ? 'none' : '';
    const createStorePanel = document.getElementById('manualCreateStorePanel');
    if (isParcel && createStorePanel) createStorePanel.style.display = 'none';

    const addressLabel = document.getElementById('manualOrderAddressLabel');
    const addressInput = document.getElementById('manualOrderAddress');
    if (addressLabel) addressLabel.textContent = isParcel ? 'Drop-off / Required Destination Address' : 'Delivery Address';
    if (addressInput) {
        addressInput.placeholder = isParcel ? 'Where to deliver the parcel (Destination Address)' : '';
    }

    const saveWrap = document.getElementById('manualOrderSaveForFutureWrap');
    if (saveWrap) saveWrap.style.display = isParcel ? 'none' : '';

    const saveForFutureEl = document.getElementById('manualOrderSaveForFuture');
    if (saveForFutureEl) saveForFutureEl.checked = !isParcel;

    const qtyEl = document.getElementById('manualOrderQty');
    const unitPriceEl = document.getElementById('manualOrderUnitPrice');
    const costPriceEl = document.getElementById('manualOrderCostPrice');
    const itemNameEl = document.getElementById('manualOrderItemName');
    const productIdEl = document.getElementById('manualOrderProductId');
    const existingProductEl = document.getElementById('manualOrderExistingProduct');
    const storeEl = document.getElementById('manualOrderStore');
    const pickupLocEl = document.getElementById('manualOrderPickupLocation');

    // Manage required attributes dynamically to avoid validation errors on hidden fields
    if (itemNameEl) itemNameEl.required = !isParcel;
    if (unitPriceEl) unitPriceEl.required = !isParcel;
    if (qtyEl) qtyEl.required = !isParcel;
    if (storeEl) storeEl.required = !isParcel;
    if (pickupLocEl) pickupLocEl.required = isParcel;

    if (isParcel) {
        if (qtyEl) qtyEl.value = '1';
        if (unitPriceEl) unitPriceEl.value = '0.00';
        if (costPriceEl) costPriceEl.value = '0.00';
        if (itemNameEl) itemNameEl.value = 'Parcel / Item Delivery';
        if (productIdEl) productIdEl.value = '';
        if (existingProductEl) existingProductEl.value = '';

        // Auto-select parcel store or first available store if none selected
        if (storeEl && (!storeEl.value || storeEl.value === '')) {
            let matchedIdx = -1;
            for (let i = 0; i < storeEl.options.length; i++) {
                const txt = storeEl.options[i].text.toLowerCase();
                if (txt.includes('parcel') || txt.includes('pick')) {
                    matchedIdx = i;
                    break;
                }
            }
            if (matchedIdx > 0) {
                storeEl.selectedIndex = matchedIdx;
            } else if (storeEl.options.length > 1) {
                storeEl.selectedIndex = 1;
            }
        }

        applyCurrentDeliveryCharges(true);
        autofillManualOrderAddressFromCustomer();
    } else {
        if (itemNameEl && itemNameEl.value === 'Parcel / Item Delivery') itemNameEl.value = '';
        if (unitPriceEl && Number(unitPriceEl.value || 0) === 0) unitPriceEl.value = '';
        if (costPriceEl && Number(costPriceEl.value || 0) === 0) costPriceEl.value = '';
        const deliveryFeeEl = document.getElementById('manualOrderDeliveryFee');
        if (deliveryFeeEl && deliveryFeeEl.value === Number(DEFAULT_PARCEL_DELIVERY_FEE).toFixed(2)) {
            deliveryFeeEl.value = '';
        }
    }
}

function toggleManualCreateCustomerPanel() {
    const panel = document.getElementById('manualCreateCustomerPanel');
    if (!panel) return;
    panel.style.display = panel.style.display === 'none' || !panel.style.display ? 'block' : 'none';
}

function generateManualCustomerPassword() {
    const seed = Math.random().toString(36).slice(2, 8);
    return `SN${seed}9!`;
}

function buildAutoCustomerEmail(phoneRaw) {
    const phonePart = String(phoneRaw || '').replace(/\D/g, '').slice(-10) || String(Date.now()).slice(-10);
    return `cust${phonePart}@servenow.pk`;
}

async function createManualOrderCustomer() {
    const firstName = (document.getElementById('manualCustomerFirstName')?.value || '').trim();
    const lastName = (document.getElementById('manualCustomerLastName')?.value || '').trim();
    const phone = (document.getElementById('manualCustomerPhone')?.value || '').trim();
    const emailInput = (document.getElementById('manualCustomerEmail')?.value || '').trim();
    const address = (document.getElementById('manualCustomerAddress')?.value || '').trim();

    if (!firstName || !lastName) {
        showWarning('Missing Data', 'First name and last name are required for customer creation.');
        return;
    }

    const email = emailInput || buildAutoCustomerEmail(phone);
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPhone = phone.trim();
    const existingCustomers = Array.isArray(AppState.notificationCustomers) ? AppState.notificationCustomers : [];
    const duplicateEmail = existingCustomers.find((c) => String(c.email || '').trim().toLowerCase() === normalizedEmail);
    if (duplicateEmail) {
        showWarning('Duplicate Email', `Customer email already exists (${normalizedEmail}).`);
        return;
    }
    if (normalizedPhone) {
        const duplicatePhone = existingCustomers.find((c) => String(c.phone || '').trim() === normalizedPhone);
        if (duplicatePhone) {
            showWarning('Duplicate Phone', `Customer phone already exists (${normalizedPhone}).`);
            return;
        }
    }
    const payload = {
        firstName,
        lastName,
        email,
        password: generateManualCustomerPassword(),
        phone: phone || undefined,
        address: address || undefined,
        user_type: 'customer',
        is_verified: true,
        is_active: true
    };

    const btn = document.getElementById('createManualCustomerBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
    }

    try {
        const response = await fetch(`${API_BASE}/api/users`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok || !data.success || !data.user_id) {
            showError('Create Failed', data.message || 'Failed to create customer');
            return;
        }

        const sel = document.getElementById('manualOrderCustomer');
        if (sel) {
            const opt = document.createElement('option');
            opt.value = String(data.user_id);
            opt.textContent = `${firstName} ${lastName}${phone ? ` (${phone})` : ''}`;
            sel.appendChild(opt);
            sel.value = String(data.user_id);
        }
        const panel = document.getElementById('manualCreateCustomerPanel');
        if (panel) panel.style.display = 'none';
        showSuccess('Customer Created', `Customer created and selected (${email}).`);
        await loadManualOrderCustomers();
        const customerSel = document.getElementById('manualOrderCustomer');
        if (customerSel) customerSel.value = String(data.user_id);
    } catch (error) {
        console.error('Error creating manual customer:', error);
        showError('Create Failed', 'Failed to create customer');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-check"></i> Create & Select Customer';
        }
    }
}

function toggleManualCreateStorePanel() {
    const panel = document.getElementById('manualCreateStorePanel');
    if (!panel) return;
    panel.style.display = panel.style.display === 'none' || !panel.style.display ? 'block' : 'none';
}

async function createManualOrderStore() {
    const name = (document.getElementById('manualStoreName')?.value || '').trim();
    const location = (document.getElementById('manualStoreLocation')?.value || '').trim();
    const phone = (document.getElementById('manualStorePhone')?.value || '').trim();
    const email = (document.getElementById('manualStoreEmail')?.value || '').trim();
    const visibleToCustomers = !!document.getElementById('manualStoreVisibleToCustomers')?.checked;

    if (!name || !location) {
        showWarning('Missing Data', 'Store name and location are required.');
        return;
    }

    const btn = document.getElementById('createManualStoreBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
    }

    try {
        const payload = {
            name,
            location,
            phone: phone || undefined,
            email: email || undefined,
            is_customer_visible: visibleToCustomers
        };

        const response = await fetch(`${API_BASE}/api/stores`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok || !data.success || !data.store?.id) {
            showError('Create Failed', data.message || 'Failed to create store');
            return;
        }

        await loadStores();
        await loadManualOrderStores();
        const storeSel = document.getElementById('manualOrderStore');
        if (storeSel) storeSel.value = String(data.store.id);
        await loadManualOrderProducts();

        const panel = document.getElementById('manualCreateStorePanel');
        if (panel) panel.style.display = 'none';
        showSuccess('Store Created', `Store created and selected.${visibleToCustomers ? '' : ' Hidden from customer listing.'}`);
    } catch (error) {
        console.error('Error creating manual store:', error);
        showError('Create Failed', 'Failed to create store');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-check"></i> Create & Select Store';
        }
    }
}

async function loadManualOrderCustomers() {
    const sel = document.getElementById('manualOrderCustomer');
    if (!sel) return;
    sel.innerHTML = '<option value="">Loading customers...</option>';

    const response = await fetch(`${API_BASE}/api/stores/notification-customers`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
        sel.innerHTML = '<option value="">Failed to load customers</option>';
        return;
    }
    const customers = Array.isArray(data.customers) ? data.customers : [];
    AppState.notificationCustomers = customers;
    AppState.manualOrderCustomersById = {};
    sel.innerHTML = '<option value="">Select customer</option>';
    customers.forEach((c) => {
        const id = Number(c.id);
        if (!Number.isInteger(id) || id <= 0) return;
        AppState.manualOrderCustomersById[id] = c;
        const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || `Customer ${id}`;
        const phone = String(c.phone || '').trim();
        const email = String(c.email || '').trim();
        const suffix = [phone, email].filter(Boolean).join(' | ');
        const opt = document.createElement('option');
        opt.value = String(id);
        opt.textContent = suffix ? `${name} (${suffix})` : name;
        sel.appendChild(opt);
    });
}

async function loadEditOrderCustomers(selectedCustomerId, currentOrder = null) {
    const sel = document.getElementById('editOrderCustomer');
    if (!sel) return;

    sel.innerHTML = '<option value="">Loading customers...</option>';
    try {
        await loadNotificationCustomersIfNeeded();
    } catch (error) {
        console.error('Error loading customers for edit order:', error);
    }

    const customers = Array.isArray(AppState.notificationCustomers) ? AppState.notificationCustomers : [];
    AppState.manualOrderCustomersById = AppState.manualOrderCustomersById || {};
    sel.innerHTML = '<option value="">Select customer</option>';

    customers.forEach((c) => {
        const id = Number(c.id);
        if (!Number.isInteger(id) || id <= 0) return;
        AppState.manualOrderCustomersById[id] = c;
        const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || `Customer ${id}`;
        const phone = String(c.phone || '').trim();
        const email = String(c.email || '').trim();
        const suffix = [phone, email].filter(Boolean).join(' | ');
        const opt = document.createElement('option');
        opt.value = String(id);
        opt.textContent = suffix ? `${name} (${suffix})` : name;
        sel.appendChild(opt);
    });

    const wantedId = Number(selectedCustomerId || 0);
    if (Number.isInteger(wantedId) && wantedId > 0 && !customers.some((c) => Number(c.id) === wantedId)) {
        const fallbackName = `${currentOrder?.first_name || ''} ${currentOrder?.last_name || ''}`.trim() || `Customer ${wantedId}`;
        const fallbackPhone = String(currentOrder?.phone || '').trim();
        const fallbackEmail = String(currentOrder?.email || '').trim();
        const fallbackSuffix = [fallbackPhone, fallbackEmail].filter(Boolean).join(' | ');
        const opt = document.createElement('option');
        opt.value = String(wantedId);
        opt.textContent = fallbackSuffix ? `${fallbackName} (${fallbackSuffix})` : fallbackName;
        sel.appendChild(opt);
    }

    if (wantedId > 0) {
        sel.value = String(wantedId);
    }
}

function autofillEditOrderFieldsFromCustomer(force = false) {
    const customerId = Number(document.getElementById('editOrderCustomer')?.value || 0);
    const addressEl = document.getElementById('editOrderDeliveryAddress');
    const instructionsEl = document.getElementById('editOrderSpecialInstructions');
    if ((!addressEl && !instructionsEl) || !Number.isInteger(customerId) || customerId <= 0) return;
    const customer = (AppState.manualOrderCustomersById || {})[customerId];
    if (!customer) return;

    const customerAddress = String(customer?.address || '').trim() || String(customer?.recent_delivery_address || '').trim();
    const customerInstructions = String(customer?.recent_special_instructions || '').trim();

    if (addressEl && customerAddress && (force || !String(addressEl.value || '').trim())) {
        addressEl.value = customerAddress;
    }
    if (instructionsEl && customerInstructions && (force || !String(instructionsEl.value || '').trim())) {
        instructionsEl.value = customerInstructions;
    }
}

function primeEditOrderCustomerField(order) {
    let customerSelect = document.getElementById('editOrderCustomer');
    if (!customerSelect) return null;
    const selectedCustomerId = Number(order?.user_id || 0);
    const fallbackName = `${order?.first_name || ''} ${order?.last_name || ''}`.trim() || (selectedCustomerId > 0 ? `Customer ${selectedCustomerId}` : 'Select customer');
    const fallbackPhone = String(order?.phone || '').trim();
    const fallbackEmail = String(order?.email || '').trim();
    const fallbackSuffix = [fallbackPhone, fallbackEmail].filter(Boolean).join(' | ');
    const fallbackLabel = fallbackSuffix ? `${fallbackName} (${fallbackSuffix})` : fallbackName;

    const customerClone = customerSelect.cloneNode(true);
    customerClone.innerHTML = '<option value="">Select customer</option>';
    if (selectedCustomerId > 0) {
        const opt = document.createElement('option');
        opt.value = String(selectedCustomerId);
        opt.textContent = fallbackLabel;
        customerClone.appendChild(opt);
        customerClone.value = String(selectedCustomerId);
    }

    customerSelect.parentNode.replaceChild(customerClone, customerSelect);
    customerClone.addEventListener('change', () => {
        autofillEditOrderFieldsFromCustomer(true);
    });
    return customerClone;
}

function bindEditOrderCustomerField(selectedCustomerId) {
    let customerSelect = document.getElementById('editOrderCustomer');
    if (!customerSelect) return null;
    const customerClone = customerSelect.cloneNode(true);
    customerClone.innerHTML = customerSelect.innerHTML;
    if (selectedCustomerId) {
        customerClone.value = String(selectedCustomerId);
    }
    customerSelect.parentNode.replaceChild(customerClone, customerSelect);
    customerClone.addEventListener('change', () => {
        autofillEditOrderFieldsFromCustomer(true);
    });
    return customerClone;
}

async function loadManualOrderStores() {
    const sel = document.getElementById('manualOrderStore');
    if (!sel) return;
    if (!Array.isArray(AppState.stores) || !AppState.stores.length) {
        await loadStores();
    }
    AppState.manualOrderStoresById = {};
    sel.innerHTML = '<option value="">Select store</option>';
    (AppState.stores || [])
        .filter((s) => s && (s.is_active === true || s.is_active === 1 || s.is_active === '1'))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
        .forEach((s) => {
            AppState.manualOrderStoresById[Number(s.id)] = s;
            const opt = document.createElement('option');
            opt.value = String(s.id);
            opt.textContent = `${s.name || 'Store'}${s.phone ? ` (${s.phone})` : ''}`;
            sel.appendChild(opt);
        });
}

function autofillManualOrderAddressFromCustomer() {
    const customerId = Number(document.getElementById('manualOrderCustomer')?.value || 0);
    const addressEl = document.getElementById('manualOrderAddress');
    const pickupEl = document.getElementById('manualOrderPickupLocation');
    if (!Number.isInteger(customerId) || customerId <= 0) return;
    const map = AppState.manualOrderCustomersById || {};
    const customer = map[customerId];
    if (!customer) return;

    const customerAddress = String(customer.address || '').trim();
    const customerName = `${customer.first_name || ''} ${customer.last_name || ''}`.trim();
    const customerPhone = String(customer.phone || '').trim();

    if (isManualParcelOrder()) {
        // In Pick & Drop Parcel mode:
        // Customer is the SENDER. The rider picks up the parcel FROM the customer!
        if (pickupEl) {
            let pickupVal = customerAddress;
            if (customerPhone && pickupVal) {
                pickupVal = `${pickupVal} (Sender: ${customerName || 'Customer'}, Ph: ${customerPhone})`;
            } else if (customerPhone && !pickupVal) {
                pickupVal = `Customer: ${customerName || 'Customer'} (${customerPhone})`;
            }
            if (pickupVal) {
                pickupEl.value = pickupVal;
            }
        }
        // Delivery address is the required drop-off destination.
        // If delivery address previously matched the customer's home address, clear it so admin enters destination.
        if (addressEl && customerAddress && addressEl.value.trim() === customerAddress) {
            addressEl.value = '';
        }
    } else {
        // Standard Product mode: Delivery address is customer's address.
        if (addressEl && customerAddress) {
            addressEl.value = customerAddress;
            return;
        }
        if (addressEl && !addressEl.value.trim()) {
            autofillManualOrderAddressFromStore();
        }
    }
}

function autofillManualOrderAddressFromStore() {
    if (isManualParcelOrder()) return;
    const storeId = Number(document.getElementById('manualOrderStore')?.value || 0);
    const addressEl = document.getElementById('manualOrderAddress');
    if (!addressEl || !Number.isInteger(storeId) || storeId <= 0) return;
    // Do not override existing typed address.
    if (addressEl.value && String(addressEl.value).trim()) return;
    const map = AppState.manualOrderStoresById || {};
    const store = map[storeId];
    const location = String(store?.location || '').trim();
    const address = String(store?.address || '').trim();
    const fallback = address || location;
    if (fallback) addressEl.value = fallback;
}

function autofillManualOrderPickupFromStore() {
    if (!isManualParcelOrder()) return;
    const storeId = Number(document.getElementById('manualOrderStore')?.value || 0);
    const pickupEl = document.getElementById('manualOrderPickupLocation');
    if (!pickupEl || !Number.isInteger(storeId) || storeId <= 0 || pickupEl.value.trim()) return;
    const map = AppState.manualOrderStoresById || {};
    const store = map[storeId];
    const location = String(store?.location || '').trim();
    const address = String(store?.address || '').trim();
    const name = String(store?.name || '').trim();
    const fallback = [name, address || location].filter(Boolean).join(' - ');
    if (fallback) pickupEl.value = fallback;
}

async function handleManualOrderStoreChange() {
    await loadManualOrderProducts();
    autofillManualOrderAddressFromCustomer();
    autofillManualOrderAddressFromStore();
    autofillManualOrderPickupFromStore();
}

async function loadManualOrderCategories() {
    const sel = document.getElementById('manualOrderCategory');
    if (!sel) return;
    if (!Array.isArray(AppState.categories) || !AppState.categories.length) {
        await loadCategories();
    }
    sel.innerHTML = '<option value="">Auto select default category</option>';
    (AppState.categories || [])
        .filter((c) => c && (c.is_active === true || c.is_active === 1 || c.is_active === '1'))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
        .forEach((c) => {
            const opt = document.createElement('option');
            opt.value = String(c.id);
            opt.textContent = c.name || `Category ${c.id}`;
            sel.appendChild(opt);
        });
}

async function loadManualOrderRiders() {
    const sel = document.getElementById('manualOrderRider');
    if (!sel) return;
    sel.innerHTML = '<option value="">Assign later</option>';
    try {
        const response = await fetch(`${API_BASE}/api/orders/available-riders`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        if (!response.ok || !data.success || !Array.isArray(data.riders)) return;
        data.riders.forEach((r) => {
            const id = Number(r.id);
            if (!Number.isInteger(id) || id <= 0) return;
            const opt = document.createElement('option');
            opt.value = String(id);
            opt.textContent = `${r.first_name || ''} ${r.last_name || ''}`.trim() || `Rider ${id}`;
            sel.appendChild(opt);
        });
    } catch (e) {
        console.error('Error loading riders for manual order:', e);
    }
}

function getManualOrderProductLabel(product) {
    const id = Number(product?.id || 0);
    const name = String(product?.name || '').trim() || `Product ${id}`;
    const price = Number(product?.price || 0);
    return `${name} (#${id}) - PKR ${price.toFixed(2)}`;
}

async function loadManualOrderProducts() {
    const storeId = Number(document.getElementById('manualOrderStore')?.value || 0);
    const listEl = document.getElementById('manualOrderExistingProductList');
    const inputEl = document.getElementById('manualOrderExistingProduct');
    const hiddenIdEl = document.getElementById('manualOrderProductId');
    if (!listEl || !inputEl || !hiddenIdEl) return;

    hiddenIdEl.value = '';
    inputEl.value = '';
    listEl.innerHTML = '';
    AppState.manualOrderProductsByLabel = {};

    if (!Number.isInteger(storeId) || storeId <= 0) return;

    const response = await fetch(`${API_BASE}/api/orders/admin/manual-products?store_id=${storeId}`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await response.json();
    if (!response.ok || !data.success || !Array.isArray(data.products)) {
        return;
    }

    data.products.forEach((p) => {
        const label = getManualOrderProductLabel(p);
        AppState.manualOrderProductsByLabel[label] = p;
        const opt = document.createElement('option');
        opt.value = label;
        listEl.appendChild(opt);
    });

    // If store has exactly one product and item field is empty, prefill it.
    if (data.products.length === 1) {
        const only = data.products[0];
        const itemNameEl = document.getElementById('manualOrderItemName');
        const unitPriceEl = document.getElementById('manualOrderUnitPrice');
        const costPriceEl = document.getElementById('manualOrderCostPrice');
        const categoryEl = document.getElementById('manualOrderCategory');
        const hiddenIdEl2 = document.getElementById('manualOrderProductId');
        const inputEl2 = document.getElementById('manualOrderExistingProduct');
        if (hiddenIdEl2) hiddenIdEl2.value = String(only.id || '');
        if (inputEl2) inputEl2.value = getManualOrderProductLabel(only);
        if (itemNameEl && !itemNameEl.value.trim()) itemNameEl.value = String(only.name || '');
        if (unitPriceEl) unitPriceEl.value = Number(only.price || 0).toFixed(2);
        if (costPriceEl && only.cost_price !== undefined && only.cost_price !== null) {
            costPriceEl.value = Number(only.cost_price).toFixed(2);
        }
        if (categoryEl && only.category_id) categoryEl.value = String(only.category_id);
    }
}

function resolveManualOrderProductSelection() {
    const inputEl = document.getElementById('manualOrderExistingProduct');
    const hiddenIdEl = document.getElementById('manualOrderProductId');
    const itemNameEl = document.getElementById('manualOrderItemName');
    const unitPriceEl = document.getElementById('manualOrderUnitPrice');
    const costPriceEl = document.getElementById('manualOrderCostPrice');
    const categoryEl = document.getElementById('manualOrderCategory');
    if (!inputEl || !hiddenIdEl) return;

    const selectedLabel = String(inputEl.value || '').trim();
    const productsByLabel = AppState.manualOrderProductsByLabel || {};
    const picked = productsByLabel[selectedLabel];
    if (!picked) {
        hiddenIdEl.value = '';
        return;
    }

    hiddenIdEl.value = String(picked.id || '');
    if (itemNameEl && !itemNameEl.value.trim()) itemNameEl.value = String(picked.name || '');
    if (unitPriceEl) unitPriceEl.value = Number(picked.price || 0).toFixed(2);
    if (costPriceEl && picked.cost_price !== undefined && picked.cost_price !== null) {
        costPriceEl.value = Number(picked.cost_price).toFixed(2);
    }
    if (categoryEl && picked.category_id) categoryEl.value = String(picked.category_id);
}

async function submitManualOrder() {
    updateManualOrderMode();
    const orderType = isManualParcelOrder() ? 'parcel' : 'product';
    const isParcel = orderType === 'parcel';
    const customerId = Number(document.getElementById('manualOrderCustomer')?.value || 0);
    const riderId = Number(document.getElementById('manualOrderRider')?.value || 0);
    let storeId = Number(document.getElementById('manualOrderStore')?.value || 0);

    // In parcel mode, auto-resolve store if empty
    if (isParcel && (!storeId || storeId <= 0)) {
        const storeSel = document.getElementById('manualOrderStore');
        if (storeSel && storeSel.options.length > 1) {
            storeId = Number(storeSel.options[1].value || 0);
        }
    }

    const selectedProductId = Number(document.getElementById('manualOrderProductId')?.value || 0);
    const categoryIdRaw = document.getElementById('manualOrderCategory')?.value || '';
    const itemName = (document.getElementById('manualOrderItemName')?.value || '').trim();
    const qty = isParcel ? 1 : Number(document.getElementById('manualOrderQty')?.value || 0);
    const unitPrice = isParcel ? 0 : Number(document.getElementById('manualOrderUnitPrice')?.value || 0);
    const costPriceRaw = (document.getElementById('manualOrderCostPrice')?.value || '').trim();
    const costPrice = isParcel ? 0 : (costPriceRaw === '' ? null : Number(costPriceRaw));
    const address = (document.getElementById('manualOrderAddress')?.value || '').trim();
    const paymentMethod = (document.getElementById('manualOrderPaymentMethod')?.value || 'cash').trim() || 'cash';
    const instructions = (document.getElementById('manualOrderInstructions')?.value || '').trim();
    let pickupLocation = (document.getElementById('manualOrderPickupLocation')?.value || '').trim();

    // In parcel mode, if pickup location is empty, fallback to customer address
    if (isParcel && !pickupLocation && customerId > 0) {
        const cust = (AppState.manualOrderCustomersById || {})[customerId];
        if (cust?.address) {
            pickupLocation = String(cust.address).trim();
        }
    }

    const parcelDetails = (document.getElementById('manualOrderParcelDetails')?.value || '').trim();
    const deliveryFeeRaw = (document.getElementById('manualOrderDeliveryFee')?.value || '').trim();
    let manualDeliveryFee = deliveryFeeRaw === '' ? null : Number(deliveryFeeRaw);

    // In parcel mode, if delivery fee is empty or invalid, default to 150
    if (isParcel && (manualDeliveryFee === null || !Number.isFinite(manualDeliveryFee))) {
        manualDeliveryFee = DEFAULT_PARCEL_DELIVERY_FEE;
    }

    const saveForFuture = isParcel ? false : !!document.getElementById('manualOrderSaveForFuture')?.checked;

    if (!customerId || !storeId || (!isParcel && !selectedProductId && !itemName) || !qty || qty < 1 || (!isParcel && (!unitPrice || unitPrice <= 0)) || !address) {
        showWarning(
            'Missing Data',
            isParcel
                ? 'Please select a customer and provide the destination drop-off address.'
                : 'Please fill all required manual order fields (existing product or item name).'
        );
        return;
    }
    if (isParcel && !pickupLocation) {
        showWarning('Missing Data', 'Pickup place/location is required (customer has no saved address).');
        return;
    }
    if (manualDeliveryFee !== null && (!Number.isFinite(manualDeliveryFee) || manualDeliveryFee < 0)) {
        showWarning('Validation Error', 'Delivery charges must be a valid non-negative number.');
        return;
    }
    if (costPrice !== null && (!Number.isFinite(costPrice) || costPrice < 0)) {
        showWarning('Validation Error', 'Cost price must be a valid non-negative number.');
        return;
    }

    const submitBtn = document.getElementById('submitManualOrderBtn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
    }

    try {
        const payload = {
            order_type: isParcel ? 'parcel_delivery' : 'product',
            customer_id: customerId,
            store_id: storeId,
            item_name: isParcel ? (parcelDetails || itemName || 'Parcel / Item Delivery') : itemName,
            product_id: Number.isInteger(selectedProductId) && selectedProductId > 0 ? selectedProductId : undefined,
            quantity: qty,
            unit_price: isParcel ? 0 : unitPrice,
            cost_price: isParcel ? 0 : costPrice,
            delivery_address: address,
            payment_method: paymentMethod,
            special_instructions: instructions || null,
            pickup_location: isParcel ? pickupLocation : undefined,
            parcel_details: isParcel ? parcelDetails : undefined,
            delivery_fee: manualDeliveryFee,
            save_for_future: saveForFuture
        };
        const categoryId = Number(categoryIdRaw);
        if (Number.isInteger(categoryId) && categoryId > 0) {
            payload.category_id = categoryId;
        }

        const createRes = await fetch(`${API_BASE}/api/orders/admin/manual-create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(payload)
        });
        const createData = await createRes.json();
        if (!createRes.ok || !createData.success || !createData.order?.id) {
            showError('Create Failed', createData.message || 'Failed to create manual order');
            return;
        }

        const newOrderId = Number(createData.order.id);
        if (Number.isInteger(riderId) && riderId > 0) {
            await fetch(`${API_BASE}/api/orders/${newOrderId}/assign-rider`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ rider_id: riderId })
            });
        }

        hideModal('manualOrderModal');
        loadOrders();
        showSuccess(
            isParcel ? 'Parcel Order Created' : 'Manual Order Created',
            isParcel
                ? `Pick & Drop parcel order ${createData.order.order_number || `#${newOrderId}`} created successfully. Delivery charges applied.`
                : `Order ${createData.order.order_number || `#${newOrderId}`} created successfully.${saveForFuture ? ' Item saved for future use.' : ''}`
        );
    } catch (error) {
        console.error('Error creating manual order:', error);
        showError('Create Failed', 'Failed to create manual order');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-check"></i> Create Order';
        }
    }
}

function filterStores() {
    try {
        const q = (document.getElementById('storeSearch')?.value || '').trim().toLowerCase();
        const status = document.getElementById('storeStatusFilter')?.value || '';
        const visibility = document.getElementById('storeVisibilityFilter')?.value || '';
        let filtered = AppState.stores || [];
        if (q) {
            filtered = filtered.filter(s => {
                const name = (s.name || '').toLowerCase();
                const loc = (s.location || '').toLowerCase();
                return name.includes(q) || loc.includes(q);
            });
        }
        if (status === 'active') {
            filtered = filtered.filter(s => s.is_active === true || s.is_active === 1 || s.is_active === '1');
        } else if (status === 'inactive') {
            filtered = filtered.filter(s => s.is_active !== true && s.is_active !== 1 && s.is_active !== '1');
        }
        if (visibility === 'visible') {
            filtered = filtered.filter(s => s.is_customer_visible === undefined || s.is_customer_visible === true || s.is_customer_visible === 1 || s.is_customer_visible === '1');
        } else if (visibility === 'hidden') {
            filtered = filtered.filter(s => !(s.is_customer_visible === undefined || s.is_customer_visible === true || s.is_customer_visible === 1 || s.is_customer_visible === '1'));
        }
        displayStores(filtered);
    } catch (e) { console.warn('filterStores error', e); }
}

function clearStoreFilters() {
    const ids = ['storeSearch', 'storeStatusFilter', 'storeVisibilityFilter'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    displayStores(AppState.stores);
}

function populateProductFilters() {
    const catInput = document.getElementById('productCategoryFilter');
    const storeInput = document.getElementById('productStoreFilter');
    const catList = document.getElementById('productCategoryFilterList');
    const storeList = document.getElementById('productStoreFilterList');
    if (!catInput && !storeInput && !catList && !storeList) return;
    const cats = new Set();
    const stores = new Set();
    (AppState.products || []).forEach(p => {
        if (p.category_name) cats.add(String(p.category_name));
        if (p.store_name) stores.add(String(p.store_name));
    });
    if (catInput) {
        const prev = catInput.value;
        if (catList) {
            catList.innerHTML = Array.from(cats)
                .sort()
                .map(c => `<option value="${c}"></option>`)
                .join('');
        }
        catInput.value = prev;
    }
    if (storeInput) {
        const prev2 = storeInput.value;
        if (storeList) {
            storeList.innerHTML = Array.from(stores)
                .sort()
                .map(s => `<option value="${s}"></option>`)
                .join('');
        }
        storeInput.value = prev2;
    }
}

function getUniqueSortedValues(items, selectors) {
    const values = new Set();
    (items || []).forEach((item) => {
        selectors.forEach((selector) => {
            const rawValue = typeof selector === 'function' ? selector(item) : item?.[selector];
            const value = String(rawValue || '').trim();
            if (value) values.add(value);
        });
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
}

function normalizeFilterMenuOptions(options) {
    const seen = new Set();
    return (options || [])
        .map((option) => {
            if (typeof option === 'string') return { label: option, value: option };
            return {
                label: String(option?.label || option?.value || '').trim(),
                value: option?.value ?? option?.label ?? ''
            };
        })
        .filter((option) => {
            if (!option.label || seen.has(option.label)) return false;
            seen.add(option.label);
            return true;
        });
}

function getDatalistOptions(input) {
    const listId = input?.dataset?.filterListId || input?.getAttribute?.('list') || '';
    const datalist = listId ? document.getElementById(listId) : null;
    if (!datalist) return [];
    return Array.from(datalist.options || []).map((option) => ({
        label: String(option.value || option.textContent || '').trim(),
        value: String(option.value || option.textContent || '').trim()
    }));
}

function getSelectOptions(select) {
    if (!select) return [];
    return Array.from(select.options || []).map((option) => ({
        label: String(option.textContent || option.value || '').trim(),
        value: option.value
    }));
}

function bindAdminFilterMenu(input, getOptions, onSelect) {
    if (!input) return;
    if (input.getAttribute('list')) {
        input.dataset.filterListId = input.getAttribute('list');
    }
    input.removeAttribute('list');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('spellcheck', 'false');
    if (input.dataset.adminFilterMenuBound === '1') return;
    const wrapper = input.closest('.search-input-wrapper') || input.parentElement;
    if (!wrapper) return;
    wrapper.classList.add('admin-filter-menu-wrap');

    const menu = document.createElement('div');
    menu.className = 'admin-filter-menu';
    menu.setAttribute('role', 'listbox');
    menu.style.display = 'none';
    wrapper.appendChild(menu);

    const hideMenu = () => {
        menu.style.display = 'none';
    };

    const renderMenu = (showAll = false) => {
        const typed = String(input.value || '').trim().toLowerCase();
        const allOptions = normalizeFilterMenuOptions(getOptions());
        const visibleOptions = showAll || !typed
            ? allOptions
            : allOptions.filter((option) => String(option.label || '').toLowerCase().includes(typed));

        if (!visibleOptions.length) {
            menu.innerHTML = '<div class="admin-filter-menu-empty">No matches</div>';
        } else {
            menu.innerHTML = visibleOptions.map((option) => `
                <button type="button" class="admin-filter-menu-option" data-value="${escapeHtml(option.value)}">
                    ${escapeHtml(option.label)}
                </button>
            `).join('');
        }
        menu.style.display = 'block';
    };

    input.addEventListener('focus', () => renderMenu(true));
    input.addEventListener('click', () => renderMenu(true));
    input.addEventListener('input', () => renderMenu(false));
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') hideMenu();
    });

    menu.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const option = event.target.closest('.admin-filter-menu-option');
        if (!option) return;
        const selected = normalizeFilterMenuOptions(getOptions()).find((item) => String(item.value) === String(option.dataset.value));
        if (!selected) return;
        onSelect(selected);
        hideMenu();
    });

    document.addEventListener('mousedown', (event) => {
        if (!wrapper.contains(event.target)) hideMenu();
    });

    input.dataset.adminFilterMenuBound = '1';
}

function syncTypeableFilterInputs() {
    document.querySelectorAll('.filter-controls input[data-source-select-id]').forEach((input) => {
        const select = document.getElementById(input.dataset.sourceSelectId);
        if (!select) return;
        const selectedOption = select.options[select.selectedIndex];
        input.value = selectedOption ? String(selectedOption.textContent || '').trim() : '';
    });
}

function initializeAdminFilterMenus() {
    document.querySelectorAll('.filter-controls input[list]').forEach((input) => {
        bindAdminFilterMenu(input, () => getDatalistOptions(input), (option) => {
            input.value = option.value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
    });

    document.querySelectorAll('.filter-controls input[data-source-select-id]').forEach((input) => {
        const select = document.getElementById(input.dataset.sourceSelectId);
        bindAdminFilterMenu(input, () => getSelectOptions(select), (option) => {
            input.value = option.label;
            if (select) {
                select.value = option.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                select.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
    });

    const searchConfigs = [
        {
            id: 'accountSearch',
            items: () => AppState.accounts,
            selectors: [
                (account) => `${account.first_name || ''} ${account.last_name || ''}`.trim(),
                'email',
                'phone'
            ]
        },
        {
            id: 'storeSearch',
            items: () => AppState.stores,
            selectors: ['name', 'location', 'owner_name']
        },
        {
            id: 'productSearch',
            items: () => AppState.products,
            selectors: ['name']
        },
        {
            id: 'categorySearch',
            items: () => AppState.categories,
            selectors: ['name', 'description']
        },
        {
            id: 'riderSearch',
            items: () => AppState.riders,
            selectors: [
                (rider) => rider.full_name || `${rider.first_name || ''} ${rider.last_name || ''}`.trim(),
                'email',
                'phone'
            ]
        }
    ];

    searchConfigs.forEach((config) => {
        const input = document.getElementById(config.id);
        bindAdminFilterMenu(input, () => getUniqueSortedValues(config.items(), config.selectors), (option) => {
            input.value = option.value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
    });

    document.querySelectorAll('.filter-controls button[id*="Clear"], .filter-controls button[id*="clear"]').forEach((button) => {
        if (button.dataset.adminFilterClearBound === '1') return;
        button.addEventListener('click', () => {
            setTimeout(() => {
                syncTypeableFilterInputs();
                initializeAdminFilterMenus();
            }, 0);
        });
        button.dataset.adminFilterClearBound = '1';
    });
}

function filterProducts() {
    try {
        const q = (document.getElementById('productSearch')?.value || '').trim().toLowerCase();
        const cat = (document.getElementById('productCategoryFilter')?.value || '').trim().toLowerCase();
        const store = (document.getElementById('productStoreFilter')?.value || '').trim().toLowerCase();
        const status = document.getElementById('productStatusFilter')?.value || '';
        let filtered = AppState.products || [];
        if (q) {
            filtered = filtered.filter(p => (String(p.name || '').toLowerCase().includes(q)));
        }
        if (cat) filtered = filtered.filter(p => String(p.category_name || '').toLowerCase().includes(cat));
        if (store) filtered = filtered.filter(p => String(p.store_name || '').toLowerCase().includes(store));
        if (status) filtered = filtered.filter(p => ((p.is_available ? 'available' : 'unavailable') === status));
        displayProducts(filtered);
    } catch (e) { console.warn('filterProducts error', e); }
}

function clearProductFilters() {
    const ids = ['productSearch', 'productCategoryFilter', 'productStoreFilter', 'productStatusFilter'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.value = '';
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
    });
    const statusInput = document.getElementById('productStatusFilterTypeable');
    if (statusInput) statusInput.value = 'All Status';
    displayProducts(AppState.products);
}

function filterCategories() {
    try {
        const q = (document.getElementById('categorySearch')?.value || '').trim().toLowerCase();
        const status = document.getElementById('categoryStatusFilter')?.value || '';
        let filtered = AppState.categories || [];
        if (q) {
            filtered = filtered.filter(c => {
                const name = (c.name || '').toLowerCase();
                const desc = (c.description || '').toLowerCase();
                return name.includes(q) || desc.includes(q);
            });
        }
        if (status) filtered = filtered.filter(c => (c.is_active ? 'active' : 'inactive') === status);
        displayCategories(filtered);
    } catch (e) { console.warn('filterCategories error', e); }
}

function clearCategoryFilters() {
    const ids = ['categorySearch', 'categoryStatusFilter'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    displayCategories(AppState.categories);
}

function filterRiders() {
    try {
        const q = (document.getElementById('riderSearch')?.value || '').trim().toLowerCase();
        const avail = document.getElementById('riderAvailabilityFilter')?.value || '';
        const status = document.getElementById('riderStatusFilter')?.value || '';
        let filtered = AppState.riders || [];
        if (q) {
            filtered = filtered.filter(r => {
                const name = (r.full_name || [r.first_name || '', r.last_name || ''].filter(Boolean).join(' ')).toLowerCase();
                const email = (r.email || '').toLowerCase();
                const phone = (r.phone || '').toLowerCase();
                return name.includes(q) || email.includes(q) || phone.includes(q);
            });
        }
        if (avail) filtered = filtered.filter(r => ((r.is_available ? 'available' : 'unavailable') === avail));
        if (status) filtered = filtered.filter(r => ((r.is_active ? 'active' : 'inactive') === status));
        displayRiders(filtered);
    } catch (e) { console.warn('filterRiders error', e); }
}

function clearRiderFilters() {
    const ids = ['riderSearch', 'riderAvailabilityFilter', 'riderStatusFilter'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    displayRiders(AppState.riders);
}

function updateOrderStatus(orderId, currentStatus) {
    const newStatus = prompt('Enter new status (pending, confirmed, preparing, ready, out_for_delivery, delivered, cancelled):', currentStatus);
    if (!newStatus) return;

    fetch(`${API_BASE}/api/orders/${orderId}/status`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ status: newStatus })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            loadOrders();
        } else {
            showError('Error', 'Failed to update order status');
        }
    })
    .catch(error => console.error('Error updating order:', error));
}

async function viewOrderDetails(orderId) {
    try {
        const response = await fetch(`${API_BASE}/api/orders/${orderId}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();

        if (!data.success) {
            showError('Error', data.message || 'Failed to load order details');
            return;
        }

        const order = data.order;
        const preferredDeliveryTime = order.delivery_time ? escapeHtml(String(order.delivery_time)) : '';
        const specialInstructions = order.special_instructions ? escapeHtml(String(order.special_instructions)) : '';
        document.getElementById('viewOrderTitle').textContent = `Order Details: ${order.order_number}`;

        let html = `
            <div class="order-info-section">
                <div class="info-group">
                    <h4>Customer Information</h4>
                    <p><strong>Name:</strong> ${order.first_name} ${order.last_name}</p>
                    <p><strong>Email:</strong> ${order.email}</p>
                    <p><strong>Phone:</strong> ${order.phone || 'N/A'}</p>
                    <p><strong>Address:</strong> ${order.delivery_address}</p>
                    ${preferredDeliveryTime ? `<p><strong>Preferred Delivery Time:</strong> ${preferredDeliveryTime}</p>` : ''}
                    ${specialInstructions ? `<p><strong>Special Instructions:</strong> ${specialInstructions}</p>` : ''}
                </div>
                <div class="info-group">
                    <h4>Order Status</h4>
                    <p><strong>Status:</strong> <span class="status-${order.status}">${order.status.toUpperCase()}</span></p>
                    <p><strong>Payment:</strong> ${order.payment_method.toUpperCase()} (${order.payment_status})</p>
                    <p><strong>Date:</strong> ${new Date(order.created_at).toLocaleString()}</p>
                </div>
            </div>
            <hr>
            <h4>Items Store-wise</h4>
        `;

        let computedItemsSubtotal = 0;

        order.store_wise_items.forEach(store => {
            const paymentTerm = store.payment_term ? escapeHtml(String(store.payment_term)) : 'N/A';
            const graceDays = Number.isFinite(Number(store.payment_grace_days)) && Number(store.payment_grace_days) > 0
                ? ` (${Number(store.payment_grace_days)} days grace)`
                : '';
            html += `
                <div class="store-order-block" style="margin-bottom: 20px; border: 1px solid #eee; padding: 15px; border-radius: 8px;">
                    <h5 style="margin-top: 0; color: #2563eb; border-bottom: 2px solid var(--border-color); padding-bottom: 5px;">
                                <i class="fas fa-store"></i> ${store.store_name}
                            </h5>
                    <p style="margin: 0 0 10px; color: #475569;"><strong>Payment Term:</strong> ${paymentTerm}${graceDays}</p>
                    <table class="items-details-table" style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="text-align: left; border-bottom: 1px solid #eee;">
                                <th style="padding: 8px;">Product</th>
                                <th style="padding: 8px;">Variant</th>
                                <th style="padding: 8px;">Qty</th>
                                <th style="padding: 8px;">Price</th>
                                <th style="padding: 8px;">Subtotal</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            store.items.forEach(item => {
                const price = parseFloat(item.price) || 0;
                const subtotal = price * item.quantity;
                computedItemsSubtotal += subtotal;
                html += `
                    <tr style="border-bottom: 1px solid #f9f9f9;">
                        <td style="padding: 8px;">${item.product_name}</td>
                        <td style="padding: 8px;">${item.variant_label || '-'}</td>
                        <td style="padding: 8px;">${item.quantity}</td>
                        <td style="padding: 8px;">PKR ${price.toFixed(2)}</td>
                        <td style="padding: 8px;">PKR ${subtotal.toFixed(2)}</td>
                    </tr>
                `;
            });
            const storeSubtotal = (store.items || []).reduce((sum, item) => {
                const price = parseFloat(item && item.price) || 0;
                const qty = Number(item && item.quantity) || 0;
                return sum + (price * qty);
            }, 0);

            html += `
                        </tbody>
                    </table>
                    <div style="text-align:right;margin-top:8px;font-weight:700;color:#0f172a;">
                        Store Subtotal: PKR ${storeSubtotal.toFixed(2)}
                    </div>
                </div>
            `;
        });

        const deliveryFeeValue = parseFloat(order.delivery_fee) || 0;
        const totalAmountValue = parseFloat(order.total_amount) || 0;
        const displayItemsSubtotal = Number(computedItemsSubtotal || 0);

        html += `
            <div class="order-summary-section" style="text-align: right; margin-top: 20px; padding: 15px; background: #f8fafc; border-radius: 8px;">
                <p><strong>Items Subtotal:</strong> PKR ${displayItemsSubtotal.toFixed(2)}</p>
                <p><strong>Delivery Fee:</strong> PKR ${deliveryFeeValue.toFixed(2)}</p>
                <h3 style="margin: 10px 0 0 0; color: #1e293b;">Total Amount: PKR ${totalAmountValue.toFixed(2)}</h3>
            </div>
        `;

        if (order.rider_id) {
            const riderLocationLine = String(order.rider_location || '').trim() || formatRiderCoordinateLabel(order);
            html += `
                <hr>
                <div class="info-group">
                    <h4>Rider Information</h4>
                    <p><strong>Name:</strong> ${order.rider_first_name} ${order.rider_last_name || ''}</p>
                    <p><strong>Phone:</strong> ${order.rider_phone || 'N/A'}</p>
                    ${riderLocationLine ? `<p><strong>Last Location:</strong> ${escapeHtml(riderLocationLine)}</p>` : ''}
                </div>
            `;
        }

        document.getElementById('orderDetailsContent').innerHTML = html;
        showModal('viewOrderModal');

    } catch (error) {
        console.error('Error viewing order details:', error);
        showError('Error', 'Failed to load order details');
    }
}

function calculateDeliveryCharges(uniqueStoreCount) {
    if (uniqueStoreCount <= 0) return 0;
    const base = Number(window._deliveryFeeBase ?? 70);
    const extra = Number(window._deliveryFeeAdditional ?? 30);
    return base + (uniqueStoreCount - 1) * extra;
}

function computeStoreWiseItemTotals(items) {
    const map = new Map();
    (items || []).forEach((item) => {
        const sid = item && item.store_id ? String(item.store_id) : 'unknown';
        const sname = item && item.store_name ? String(item.store_name) : 'Unknown Store';
        const qty = Number(item && item.quantity) || 0;
        const price = Number(item && item.price) || 0;
        const subtotal = qty * price;
        if (!map.has(sid)) {
            map.set(sid, { store_id: sid, store_name: sname, lines: 0, qty: 0, subtotal: 0 });
        }
        const row = map.get(sid);
        row.lines += 1;
        row.qty += qty;
        row.subtotal += subtotal;
    });
    return Array.from(map.values()).sort((a, b) => b.subtotal - a.subtotal);
}

function renderStoreWiseOrderTotals(containerId, items) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const rows = computeStoreWiseItemTotals(items);
    if (!rows.length) {
        el.innerHTML = '';
        return;
    }
    const inner = rows.map((r) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #e5edf8;">
            <div>
                <strong style="color:#1e293b;">${escapeHtml(r.store_name)}</strong>
                <span style="color:#64748b;font-size:12px;"> (${r.lines} lines, qty ${r.qty})</span>
            </div>
            <div style="font-weight:700;color:#0f172a;">PKR ${Number(r.subtotal || 0).toFixed(2)}</div>
        </div>
    `).join('');
    el.innerHTML = `
        <div style="font-size:0.82rem;color:#475569;margin-bottom:6px;"><strong>Store-wise Item Totals</strong></div>
        <div>${inner}</div>
    `;
}

function debounceOrderEditWork(callback, delay = 80) {
    let timerId = null;
    return (...args) => {
        window.clearTimeout(timerId);
        timerId = window.setTimeout(() => callback(...args), delay);
    };
}

function populateSelectOptions(select, options, placeholder) {
    if (!select) return;
    const fragment = document.createDocumentFragment();
    const first = document.createElement('option');
    first.value = '';
    first.textContent = placeholder;
    fragment.appendChild(first);
    options.forEach((optionData) => {
        const option = document.createElement('option');
        option.value = String(optionData.value ?? '');
        option.textContent = String(optionData.label ?? '');
        Object.entries(optionData.dataset || {}).forEach(([key, value]) => {
            option.dataset[key] = value == null ? '' : String(value);
        });
        if (optionData.selected) option.selected = true;
        fragment.appendChild(option);
    });
    select.replaceChildren(fragment);
}

function _setDeliveryFeeInputs(baseValue, additionalValue) {
    const baseInputIds = ['deliveryBaseFeeInput', 'settingsDeliveryBaseFeeInput'];
    const additionalInputIds = ['deliveryAdditionalFeeInput', 'settingsDeliveryAdditionalFeeInput'];
    baseInputIds.forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.value = String(baseValue);
    });
    additionalInputIds.forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.value = String(additionalValue);
    });
}

async function loadDeliveryFeeSettings() {
    try {
        const response = await fetch(`${API_BASE}/api/admin/delivery-fee-settings`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        if (!data.success) return;

        const base = Number(data.base_fee);
        const additional = Number(data.additional_per_store);
        window._deliveryFeeBase = Number.isFinite(base) ? base : 70;
        window._deliveryFeeAdditional = Number.isFinite(additional) ? additional : 30;
        _setDeliveryFeeInputs(window._deliveryFeeBase, window._deliveryFeeAdditional);
    } catch (error) {
        console.error('loadDeliveryFeeSettings error:', error);
    }
}

async function saveDeliveryFeeSettings(baseInputId = 'deliveryBaseFeeInput', additionalInputId = 'deliveryAdditionalFeeInput') {
    const baseInput = document.getElementById(baseInputId);
    const addInput = document.getElementById(additionalInputId);
    const base_fee = Number.parseFloat(baseInput?.value || '');
    const additional_per_store = Number.parseFloat(addInput?.value || '');

    if (!Number.isFinite(base_fee) || base_fee < 0) {
        showError('Validation', 'Base fee must be a valid non-negative number.');
        return;
    }
    if (!Number.isFinite(additional_per_store) || additional_per_store < 0) {
        showError('Validation', 'Additional per-store fee must be a valid non-negative number.');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/admin/delivery-fee-settings`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ base_fee, additional_per_store })
        });
        const data = await response.json();
        if (!data.success) {
            showError('Delivery Charges', data.message || 'Failed to save delivery charges.');
            return;
        }
        window._deliveryFeeBase = Number(data.base_fee);
        window._deliveryFeeAdditional = Number(data.additional_per_store);
        _setDeliveryFeeInputs(window._deliveryFeeBase, window._deliveryFeeAdditional);
        showSuccess('Delivery Charges', 'Delivery charge settings updated successfully.');
    } catch (error) {
        console.error('saveDeliveryFeeSettings error:', error);
        showError('Delivery Charges', 'Failed to update delivery charge settings.');
    }
}

async function saveDeliveryFeeSettingsFromSettingsTab() {
    return saveDeliveryFeeSettings('settingsDeliveryBaseFeeInput', 'settingsDeliveryAdditionalFeeInput');
}

function updateOrderSummary(items, deliveryFee) {
    let itemsSubtotal = 0;
    if (items && items.length > 0) {
        itemsSubtotal = items.reduce((sum, item) => sum + (Number(item.price) * item.quantity), 0);
    }
    
    const deliveryFeeNum = parseFloat(deliveryFee) || 0;
    const grandTotal = itemsSubtotal + deliveryFeeNum;
    
    const itemsSubtotalEl = document.getElementById('itemsSubtotal');
    const deliveryFeeInput = document.getElementById('orderDeliveryFee');
    const totalAmountInput = document.getElementById('orderTotalAmount');
    
    if (itemsSubtotalEl) {
        itemsSubtotalEl.textContent = `PKR ${itemsSubtotal.toFixed(2)}`;
    }
    if (deliveryFeeInput) {
        deliveryFeeInput.value = deliveryFeeNum.toFixed(2);
    }
    if (totalAmountInput) {
        totalAmountInput.value = grandTotal.toFixed(2);
    }
}

function normalizeOrderEditText(value) {
    return String(value || '').trim();
}

function normalizeOrderEditNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function captureOrderEditSnapshot(order, items) {
    AppState.editing.orderSnapshot = {
        customerId: Number(order?.user_id || 0) || null,
        deliveryAddress: normalizeOrderEditText(order?.delivery_address),
        specialInstructions: normalizeOrderEditText(order?.special_instructions),
        status: normalizeOrderEditText(order?.status).toLowerCase(),
        riderId: Number(order?.rider_id || 0) || null,
        riderLocation: normalizeOrderEditText(order?.rider_location),
        riderLatitude: normalizeOrderEditNumber(order?.rider_latitude),
        riderLongitude: normalizeOrderEditNumber(order?.rider_longitude),
        deliveryFee: Number(order?.delivery_fee || 0),
        items: (Array.isArray(items) ? items : []).map((item) => ({
            id: Number(item.id),
            quantity: Number(item.quantity || 0)
        }))
    };
}

function haveOrderItemsChanged(nextItems, snapshotItems) {
    const previousMap = new Map((Array.isArray(snapshotItems) ? snapshotItems : []).map((item) => [
        String(item.id),
        Number(item.quantity || 0)
    ]));
    if ((Array.isArray(nextItems) ? nextItems.length : 0) !== previousMap.size) {
        return true;
    }
    return (Array.isArray(nextItems) ? nextItems : []).some((item) => {
        const itemId = String(item.id);
        return !previousMap.has(itemId) || previousMap.get(itemId) !== Number(item.quantity || 0);
    });
}

async function editOrder(orderId) {
    try {
        // Permission check
        if (currentUser.user_type !== 'admin' && !currentUserPermissions.has('action_edit_order')) {
            showError('Access Denied', 'You do not have permission to edit orders.');
            return;
        }

        const existingOrder = AppState.orders.find(o => o.id == orderId);
        const existingStatus = String(existingOrder?.status || '').toLowerCase();
        if (existingStatus === 'delivered') {
            showWarning('Delivered Order Locked', 'Delivered orders cannot be edited. You can only view them.');
            return;
        }

        const ridersPromise = fetch(`${API_BASE}/api/orders/available-riders`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        })
            .then((resp) => (resp.ok ? resp.json() : { success: false }))
            .catch(() => ({ success: false }));

        const itemsResponse = await fetch(`${API_BASE}/api/orders/${orderId}/items`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        let itemsData = await itemsResponse.json();

        // Fallback if specific items endpoint fails (e.g. permission issues)
        if (!itemsData.success) {
            console.warn('Failed to fetch items from /items endpoint, trying /orders/:id fallback', itemsData.message);
            const viewResponse = await fetch(`${API_BASE}/api/orders/${orderId}`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            const viewData = await viewResponse.json();
            if (viewData.success && viewData.order) {
                itemsData = {
                    success: true,
                    order: viewData.order,
                    items: viewData.order.items || [],
                    availableStores: [] // Fallback won't have this, but it's optional
                };
            } else {
                 // Propagate the original error if fallback also fails
                 console.error('Fallback fetch also failed');
            }
        }

        // Use fresh order data from API if available, otherwise fallback to AppState.orders
        const freshOrder = itemsData.order || AppState.orders.find(o => o.id === orderId);

        if (!freshOrder) {
            showError('Order Not Found', 'The order could not be found in the system.');
            return;
        }

        if (freshOrder.status === 'delivered') {
            showWarning('Delivered Order Locked', 'Delivered orders cannot be edited. You can only view them.');
            return;
        }

        if (freshOrder.status === 'cancelled') {
            showWarning('Cannot Edit', 'Cancelled orders cannot be edited.');
            return;
        }

        captureOrderEditSnapshot(freshOrder, itemsData.items || []);

        const ridersData = await ridersPromise;
        if (ridersData?.status === 403) {
            console.warn('Access denied to fetch riders');
        }

        primeEditOrderCustomerField(freshOrder);

        const deliveryAddressInput = document.getElementById('editOrderDeliveryAddress');
        if (deliveryAddressInput) {
            deliveryAddressInput.value = freshOrder.delivery_address || '';
        }
        const specialInstructionsInput = document.getElementById('editOrderSpecialInstructions');
        if (specialInstructionsInput) {
            specialInstructionsInput.value = freshOrder.special_instructions || '';
        }

        const riderSelect = document.getElementById('orderRider');
        const riderOptions = [];
        if (ridersData.success) {
            ridersData.riders.forEach(rider => {
                riderOptions.push({
                    value: rider.id,
                    label: `${rider.first_name} ${rider.last_name}`.trim(),
                    selected: freshOrder.rider_id == rider.id
                });
            });
        }
        
        // Also add current rider if not in available list (e.g. busy)
        if (freshOrder.rider_id && ridersData.success && !ridersData.riders.find(r => r.id == freshOrder.rider_id)) {
            riderOptions.push({
                value: freshOrder.rider_id,
                label: `${freshOrder.rider_first_name || ''} ${freshOrder.rider_last_name || ''} (Current)`.trim(),
                selected: true
            });
        }
        populateSelectOptions(riderSelect, riderOptions, 'Select Rider');

        let storeSelect = document.getElementById('orderItemStore');
        if (storeSelect) {
            storeSelect.innerHTML = '<option value="">Keep Current Store</option>';
            if (itemsData.success && itemsData.availableStores) {
                itemsData.availableStores.forEach(store => {
                    storeSelect.innerHTML += `<option value="${store.id}">${store.name}</option>`;
                });
            }
            const storeSelectClone = storeSelect.cloneNode(true);
            storeSelectClone.innerHTML = storeSelect.innerHTML;
            storeSelect.parentNode.replaceChild(storeSelectClone, storeSelect);
            storeSelect = storeSelectClone;
        }

        const itemsContainer = document.getElementById('orderItemsContainer');
        if (!itemsContainer) {
            console.warn('Order items container not found in edit order modal');
            return;
        }

        if (itemsData.success && itemsData.items && itemsData.items.length > 0) {
            const itemMap = new Map(itemsData.items.map(item => [String(item.id), item]));
            const readItemsFromInputs = () => Array.from(document.querySelectorAll('.item-quantity-input')).map(inp => {
                const itemId = String(inp.dataset.itemId || '');
                const originalItem = itemMap.get(itemId);
                if (!originalItem) return null;
                return {
                    ...originalItem,
                    quantity: parseInt(inp.value, 10) || 0
                };
            }).filter(Boolean);

            itemsContainer.innerHTML = `
                <div class="edit-order-items-list">
                    ${itemsData.items.map(item => {
                        const itemId = escapeHtml(String(item.id));
                        const productName = escapeHtml(String(item.product_name || 'Order item'));
                        const variantLabel = item.variant_label ? escapeHtml(String(item.variant_label)) : '';
                        const storeName = item.store_name ? escapeHtml(String(item.store_name)) : '';
                        const price = Number(item.price) || 0;
                        const quantity = Number(item.quantity) || 0;

                        return `
                            <div class="edit-order-item-row">
                                <div class="edit-order-item-main">
                                    <strong>${productName}</strong>
                                    ${variantLabel ? `<span>Variant: ${variantLabel}</span>` : ''}
                                    <span>Price: PKR ${price.toFixed(2)}</span>
                                    ${storeName ? `<span>Store: ${storeName}</span>` : ''}
                                </div>
                                <label class="edit-order-item-qty">
                                    <span>Qty</span>
                                    <input type="number" class="item-quantity-input" data-item-id="${itemId}" value="${quantity}" min="1" />
                                </label>
                                <div class="edit-order-item-total">
                                    <span>Total</span>
                                    <strong>PKR ${(price * quantity).toFixed(2)}</strong>
                                </div>
                                <button type="button" class="btn btn-small btn-danger remove-item-btn" data-item-id="${itemId}">
                                    <i class="fas fa-trash"></i> Remove
                                </button>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
            
            document.querySelectorAll('.remove-item-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    removeOrderItem(orderId, this.dataset.itemId);
                });
            });

            const updateTotalsFromInputs = debounceOrderEditWork(() => {
                const items = readItemsFromInputs();
                const currentDeliveryFee = document.getElementById('orderDeliveryFee')?.value || 0;
                updateOrderSummary(items, currentDeliveryFee);
                renderStoreWiseOrderTotals('orderStoreWiseTotals', items);
            });

            document.querySelectorAll('.item-quantity-input').forEach(input => {
                input.addEventListener('input', updateTotalsFromInputs);
            });

            const deliveryFeeInput = document.getElementById('orderDeliveryFee');
            if (deliveryFeeInput) {
                const deliveryFeeClone = deliveryFeeInput.cloneNode(true);
                deliveryFeeClone.value = deliveryFeeInput.value;
                deliveryFeeInput.parentNode.replaceChild(deliveryFeeClone, deliveryFeeInput);
                deliveryFeeClone.addEventListener('input', updateTotalsFromInputs);
            }

            const orderTotalInput = document.getElementById('orderTotalAmount');
            if (orderTotalInput) {
                const orderTotalClone = orderTotalInput.cloneNode(true);
                orderTotalClone.value = orderTotalInput.value;
                orderTotalInput.parentNode.replaceChild(orderTotalClone, orderTotalInput);
                orderTotalClone.addEventListener('input', function() {
                const totalAmount = parseFloat(this.value) || 0;
                const items = readItemsFromInputs();
                const itemsSubtotal = items.reduce((sum, item) => sum + (Number(item.price) * item.quantity), 0);
                const deliveryFee = Math.max(0, totalAmount - itemsSubtotal);
                
                const deliveryFeeInput = document.getElementById('orderDeliveryFee');
                if (deliveryFeeInput) {
                    deliveryFeeInput.value = deliveryFee.toFixed(2);
                }
                
                const itemsSubtotalEl = document.getElementById('itemsSubtotal');
                if (itemsSubtotalEl) {
                    itemsSubtotalEl.textContent = `PKR ${itemsSubtotal.toFixed(2)}`;
                }
                renderStoreWiseOrderTotals('orderStoreWiseTotals', items);
                });
            }

            const uniqueStores = new Set(itemsData.items.map(item => item.store_id).filter(Boolean));
            const storeCount = uniqueStores.size;
            
            // Calculate items subtotal
            const itemsSubtotal = itemsData.items.reduce((sum, item) => sum + (Number(item.price) * item.quantity), 0);
            
            // Determine the delivery fee to display
            // Priority: 1. Auto-calculate based on stores (Business Rule enforcement)
            // Note: We override stored fee to ensure logic applies when items/stores change
            let deliveryFee = calculateDeliveryCharges(storeCount);
            
            // Log if we are overriding a stored fee
            if (freshOrder && freshOrder.delivery_fee !== undefined && Number(freshOrder.delivery_fee) !== deliveryFee) {
                 console.log(`[Order ${orderId}] Recalculated delivery fee from ${freshOrder.delivery_fee} to ${deliveryFee} based on ${storeCount} stores`);
            }

            /* 
            // Disabled to ensure multi-store logic always applies
            if (freshOrder && freshOrder.delivery_fee !== undefined && freshOrder.delivery_fee !== null) {
                deliveryFee = Number(freshOrder.delivery_fee);
            } else if (freshOrder && freshOrder.total_amount !== undefined && freshOrder.total_amount !== null) {
                deliveryFee = Math.max(0, Number(freshOrder.total_amount) - itemsSubtotal);
            } 
            */
            
            console.log(`[Order ${orderId}] Subtotal: ${itemsSubtotal}, Delivery Fee: ${deliveryFee}, Total: ${itemsSubtotal + deliveryFee}`);
            
            updateOrderSummary(itemsData.items, deliveryFee);
            renderStoreWiseOrderTotals('orderStoreWiseTotals', itemsData.items);
            
            if (freshOrder?.delivery_fee === undefined && freshOrder?.total_amount === undefined) {
                showSuccess('Auto-Calculated', `Delivery fee calculated: ${storeCount} store(s) = PKR ${deliveryFee}`);
            }
        } else {
            itemsContainer.innerHTML = '<p class="edit-order-items-empty">No items found</p>';
            updateOrderSummary([], 0);
            renderStoreWiseOrderTotals('orderStoreWiseTotals', []);
        }
        
        const addItemBtn = document.getElementById('addItemBtn');
        if (addItemBtn) {
            const newAddItemBtn = addItemBtn.cloneNode(true);
            addItemBtn.parentNode.replaceChild(newAddItemBtn, addItemBtn);
            newAddItemBtn.addEventListener('click', function() {
                addOrderItem(orderId);
            });
        }
        
        const productSelect = document.getElementById('addItemProduct');
        const loadProducts = async (selectedStoreId) => {
            if (!productSelect) return;
            const normalizedStoreId = String(selectedStoreId || '').trim();
            if (!normalizedStoreId) {
                populateSelectOptions(productSelect, [], 'Select a store first...');
                return;
            }
            try {
                productSelect.disabled = true;
                populateSelectOptions(productSelect, [], 'Loading products...');
                let query = `${API_BASE}/api/orders/${orderId}/available-products?store_id=${encodeURIComponent(normalizedStoreId)}`;
                const productsRes = await fetch(query, {
                    headers: { 'Authorization': `Bearer ${authToken}` }
                });
                const productsData = await productsRes.json();
                if (productsData.success && productsData.products) {
                    const productOptions = productsData.products.map(product => {
                        const variantLabel = product.variant_label ? String(product.variant_label) : '';
                        const optionLabel = variantLabel
                            ? `${product.name} (${variantLabel}) - PKR ${Number(product.price).toFixed(2)} (${product.store_name})`
                            : `${product.name} - PKR ${Number(product.price).toFixed(2)} (${product.store_name})`;
                        return {
                            value: product.id,
                            label: optionLabel,
                            dataset: {
                                price: product.price,
                                sizeId: product.size_id ?? '',
                                unitId: product.unit_id ?? '',
                                variantLabel
                            }
                        };
                    });
                    populateSelectOptions(productSelect, productOptions, 'Choose product...');
                } else {
                    populateSelectOptions(productSelect, [], productsData.message || 'No products found');
                }
            } catch (error) {
                console.error('Error fetching products for store:', error);
                populateSelectOptions(productSelect, [], 'Failed to load products');
            } finally {
                productSelect.disabled = false;
            }
        };

        if (storeSelect) {
            storeSelect.addEventListener('change', function() {
                loadProducts(this.value);
            });
        }
        if (productSelect) {
            populateSelectOptions(productSelect, [], 'Select a store first...');
        }

        document.getElementById('orderStatus').value = freshOrder.status;
        const originalStatusInput = document.getElementById('originalOrderStatus');
        if (originalStatusInput) originalStatusInput.value = freshOrder.status;
        document.getElementById('riderLocation').value = freshOrder.rider_location || '';
        document.getElementById('riderLatitude').value = freshOrder.rider_latitude || '';
        document.getElementById('riderLongitude').value = freshOrder.rider_longitude || '';

        document.getElementById('editOrderForm').dataset.orderId = orderId;

        showModal('editOrderModal');
        const editCustomerSelect = document.getElementById('editOrderCustomer');
        if (editCustomerSelect) {
            let customersHydrated = false;
            const hydrateCustomersOnce = async () => {
                if (customersHydrated) return;
                customersHydrated = true;
                try {
                    await loadEditOrderCustomers(freshOrder.user_id, freshOrder);
                    const hydratedCustomerSelect = bindEditOrderCustomerField(freshOrder.user_id);
                    if (hydratedCustomerSelect && freshOrder.user_id) {
                        hydratedCustomerSelect.value = String(freshOrder.user_id);
                    }
                } catch (error) {
                    customersHydrated = false;
                    console.error('Failed to hydrate edit-order customers:', error);
                }
            };
            editCustomerSelect.addEventListener('focus', hydrateCustomersOnce, { once: true });
            editCustomerSelect.addEventListener('mousedown', hydrateCustomersOnce, { once: true });
        }
        // Product options are loaded only after a store is selected. Loading all
        // products for multi-store orders can lock up the admin page.
    } catch (error) {
        console.error('Error loading order details:', error);
        showError('Error', 'Failed to load order details. Please try again.');
    }
}

async function saveOrder() {
    const form = document.getElementById('editOrderForm');
    const orderId = form.dataset.orderId;
    const formData = new FormData(form);
    const snapshot = AppState.editing.orderSnapshot || {};

    const status = formData.get('status');
    const customerId = formData.get('customer_id');
    const deliveryAddress = normalizeOrderEditText(formData.get('delivery_address'));
    const specialInstructions = normalizeOrderEditText(formData.get('special_instructions'));
    const originalStatus = formData.get('original_status');
    const riderId = formData.get('rider_id') || null;
    const riderLocation = formData.get('rider_location') || null;
    const riderLatitude = formData.get('rider_latitude') || null;
    const riderLongitude = formData.get('rider_longitude') || null;
    const storeId = formData.get('store_id') || null;

    try {
        console.log(`[saveOrder] Starting optimized save for order ${orderId}`);

        const normalizedCustomerId = Number(customerId || 0) || null;
        const normalizedStatus = normalizeOrderEditText(status).toLowerCase();
        const normalizedStoreId = Number(storeId || 0) || null;
        const normalizedRiderId = Number(riderId || 0) || null;
        const normalizedRiderLocation = normalizeOrderEditText(riderLocation);
        const normalizedRiderLatitude = normalizeOrderEditNumber(riderLatitude);
        const normalizedRiderLongitude = normalizeOrderEditNumber(riderLongitude);
        const normalizedDeliveryFee = Number(document.getElementById('orderDeliveryFee').value || 0);

        const itemQuantityInputs = document.querySelectorAll('.item-quantity-input');
        const items = Array.from(itemQuantityInputs).map(input => ({
            id: parseInt(input.dataset.itemId, 10),
            quantity: parseInt(input.value, 10)
        }));

        const customerChanged =
            normalizedCustomerId !== (snapshot.customerId || null) ||
            deliveryAddress !== (snapshot.deliveryAddress || '') ||
            specialInstructions !== (snapshot.specialInstructions || '');
        const itemsChanged =
            items.length > 0 &&
            (haveOrderItemsChanged(items, snapshot.items) || normalizedStoreId !== null);
        const statusChanged =
            !!normalizedStatus &&
            normalizedStatus !== (snapshot.status || normalizeOrderEditText(originalStatus).toLowerCase());
        const deliveryFeeChanged =
            Math.abs(normalizedDeliveryFee - Number(snapshot.deliveryFee || 0)) > 0.009;
        const riderChanged = normalizedRiderId !== (snapshot.riderId || null);
        const riderLocationChanged =
            normalizedRiderLocation !== (snapshot.riderLocation || '') ||
            normalizedRiderLatitude !== (snapshot.riderLatitude ?? null) ||
            normalizedRiderLongitude !== (snapshot.riderLongitude ?? null);

        if (
            !customerChanged &&
            !itemsChanged &&
            !statusChanged &&
            !deliveryFeeChanged &&
            !riderChanged &&
            !riderLocationChanged
        ) {
            showSuccess('No Changes', 'No order changes detected.');
            hideModal('editOrderModal');
            return;
        }

        if (customerChanged && normalizedCustomerId) {
            const customerRes = await fetch(`${API_BASE}/api/orders/${orderId}/customer`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({
                    customer_id: normalizedCustomerId,
                    delivery_address: deliveryAddress,
                    special_instructions: specialInstructions || null
                })
            });
            const customerJson = await customerRes.json();
            if (!customerRes.ok || !customerJson.success) {
                showError('Error', customerJson.message || 'Failed to update customer');
                return;
            }
        }

        if (itemsChanged) {
            const itemsRes = await fetch(`${API_BASE}/api/orders/${orderId}/items`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ items, store_id: normalizedStoreId })
            });
            const itemsJson = await itemsRes.json();
            if (!itemsRes.ok || !itemsJson.success) {
                showError('Error', itemsJson.message || 'Failed to update order items');
                return;
            }
        }

        if (statusChanged) {
            const statusRes = await fetch(`${API_BASE}/api/orders/${orderId}/status`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ status: normalizedStatus })
            });
            const statusJson = await statusRes.json();
            if (!statusRes.ok || !statusJson.success) {
                showError('Error', statusJson.message || 'Failed to update order status');
                return;
            }
        }

        if (deliveryFeeChanged) {
            const feeRes = await fetch(`${API_BASE}/api/orders/${orderId}/delivery-fee`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ delivery_fee: normalizedDeliveryFee })
            });
            const feeData = await feeRes.json();
            if (!feeRes.ok || !feeData.success) {
                showError('Warning', feeData.message || 'Delivery fee may not have been updated. Please check.');
                return;
            }
        }

        if (riderChanged && normalizedRiderId) {
            const riderRes = await fetch(`${API_BASE}/api/orders/${orderId}/assign-rider`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ rider_id: normalizedRiderId })
            });
            const riderJson = await riderRes.json();
            if (!riderRes.ok || !riderJson.success) {
                showError('Error', riderJson.message || 'Failed to assign rider');
                return;
            }
        }

        if (riderLocationChanged && (normalizedRiderLocation || (normalizedRiderLatitude !== null && normalizedRiderLongitude !== null))) {
            const locationBody = { location: normalizedRiderLocation };
            if (normalizedRiderLatitude !== null && normalizedRiderLongitude !== null) {
                locationBody.latitude = normalizedRiderLatitude;
                locationBody.longitude = normalizedRiderLongitude;
            }

            const locationRes = await fetch(`${API_BASE}/api/orders/${orderId}/rider-location`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify(locationBody)
            });
            const locationJson = await locationRes.json();
            if (!locationRes.ok || !locationJson.success) {
                showError('Error', locationJson.message || 'Failed to update rider location');
                return;
            }
        }

        captureOrderEditSnapshot(
            {
                user_id: normalizedCustomerId,
                delivery_address: deliveryAddress,
                special_instructions: specialInstructions,
                status: normalizedStatus,
                rider_id: normalizedRiderId,
                rider_location: normalizedRiderLocation,
                rider_latitude: normalizedRiderLatitude,
                rider_longitude: normalizedRiderLongitude,
                delivery_fee: normalizedDeliveryFee
            },
            items
        );

        showSuccess('Order Updated', 'Order updated successfully!');
        hideModal('editOrderModal');
        loadOrders();
    } catch (error) {
        console.error('Error updating order:', error);
        showError('Error', 'Failed to update order');
    }
}

async function saveOrderLegacy() {
    const form = document.getElementById('editOrderForm');
    const orderId = form.dataset.orderId;
    const formData = new FormData(form);

    const status = formData.get('status');
    const customerId = formData.get('customer_id');
    const deliveryAddress = String(formData.get('delivery_address') || '').trim();
    const specialInstructions = String(formData.get('special_instructions') || '').trim();
    const originalStatus = formData.get('original_status');
    const riderId = formData.get('rider_id') || null;
    const riderLocation = formData.get('rider_location') || null;
    const riderLatitude = formData.get('rider_latitude') || null;
    const riderLongitude = formData.get('rider_longitude') || null;
    const storeId = formData.get('store_id') || null;

    try {
        const freshOrderResponse = await fetch(`${API_BASE}/api/orders/${orderId}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const freshOrderData = await freshOrderResponse.json();
        const latestStatus = String(freshOrderData?.order?.status || '').toLowerCase();
        if (latestStatus === 'delivered') {
            showWarning('Delivered Order Locked', 'Delivered orders cannot be edited. You can only view them.');
            hideModal('editOrderModal');
            loadOrders();
            return;
        }

        console.log(`[saveOrder] Starting save for order ${orderId}`);

        if (customerId) {
            const customerRes = await fetch(`${API_BASE}/api/orders/${orderId}/customer`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({
                    customer_id: parseInt(customerId, 10),
                    delivery_address: deliveryAddress,
                    special_instructions: specialInstructions || null
                })
            });
            const customerJson = await customerRes.json();
            if (!customerJson.success) {
                showError('Error', customerJson.message || 'Failed to update customer');
                return;
            }
        }
        
        const itemQuantityInputs = document.querySelectorAll('.item-quantity-input');
        let itemsUpdated = false;
        
        if (itemQuantityInputs.length > 0) {
            const items = Array.from(itemQuantityInputs).map(input => ({
                id: parseInt(input.dataset.itemId),
                quantity: parseInt(input.value)
            }));
            console.log(`[saveOrder] Current items:`, items);
            
            const hasChanges = items.some((item, idx) => {
                const original = AppState.orders.find(o => o.id == orderId);
                return true;
            });
            
            if (items.length > 0) {
                const itemsRes = await fetch(`${API_BASE}/api/orders/${orderId}/items`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authToken}`
                    },
                    body: JSON.stringify({ items, store_id: storeId ? parseInt(storeId) : null })
                });
                
                const itemsJson = await itemsRes.json();
                if (!itemsJson.success) {
                    showError('Error', itemsJson.message || 'Failed to update order items');
                    return;
                }
                itemsUpdated = true;
            }
        }

        if (status && (!originalStatus || status !== originalStatus)) {
            await fetch(`${API_BASE}/api/orders/${orderId}/status`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ status })
            });
        }

        const deliveryFeeValue = document.getElementById('orderDeliveryFee').value;
        const feeRes = await fetch(`${API_BASE}/api/orders/${orderId}/delivery-fee`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ delivery_fee: parseFloat(deliveryFeeValue) })
        });
        const feeData = await feeRes.json();
        console.log(`[saveOrder] Delivery fee updated:`, feeData);
        if (feeData.success) {
            console.log(`✓ Delivery fee updated: PKR ${feeData.delivery_fee.toFixed(2)}. Order total: PKR ${feeData.total_amount.toFixed(2)}`);
        } else {
            console.error('✗ Failed to update delivery fee:', feeData);
            showError('Warning', 'Delivery fee may not have been updated. Please check.');
        }

        if (riderId) {
            await fetch(`${API_BASE}/api/orders/${orderId}/assign-rider`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ rider_id: parseInt(riderId) })
            });
        }

        if (riderLocation || (riderLatitude && riderLongitude)) {
            const locationBody = { location: riderLocation };
            if (riderLatitude && riderLongitude) {
                locationBody.latitude = parseFloat(riderLatitude);
                locationBody.longitude = parseFloat(riderLongitude);
            }
            
            await fetch(`${API_BASE}/api/orders/${orderId}/rider-location`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify(locationBody)
            });
        }

        showSuccess('Order Updated', 'Order updated successfully!');
        hideModal('editOrderModal');
        loadOrders();

    } catch (error) {
        console.error('Error updating order:', error);
        showError('Error', 'Failed to update order');
    }
}

async function addOrderItem(orderId) {
    const productSelect = document.getElementById('addItemProduct');
    const quantityInput = document.getElementById('addItemQuantity');
    const storeSelect = document.getElementById('orderItemStore');
    
    const productId = productSelect.value;
    const selectedOption = productSelect.options[productSelect.selectedIndex];
    const quantity = parseInt(quantityInput.value);
    const storeId = storeSelect?.value || null;
    const sizeId = selectedOption?.dataset?.sizeId ? parseInt(selectedOption.dataset.sizeId, 10) : null;
    const unitId = selectedOption?.dataset?.unitId ? parseInt(selectedOption.dataset.unitId, 10) : null;
    const variantLabel = selectedOption?.dataset?.variantLabel ? String(selectedOption.dataset.variantLabel).trim() : null;
    
    if (!productId) {
        showError('Validation Error', 'Please select a product');
        return;
    }
    
    if (!quantity || quantity < 1) {
        showError('Validation Error', 'Quantity must be at least 1');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/orders/${orderId}/items/add`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                product_id: parseInt(productId),
                quantity,
                store_id: storeId ? parseInt(storeId) : null,
                size_id: Number.isInteger(sizeId) ? sizeId : null,
                unit_id: Number.isInteger(unitId) ? unitId : null,
                variant_label: variantLabel || null
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showSuccess('Item Added', 'Product added to order successfully!');
            quantityInput.value = '1';
            productSelect.value = '';
            setTimeout(() => {
                editOrder(orderId);
            }, 500);
        } else {
            showError('Error', data.message || 'Failed to add item to order');
        }
    } catch (error) {
        console.error('Error adding item:', error);
        showError('Error', 'Failed to add item to order');
    }
}

async function removeOrderItem(orderId, itemId) {
    if (!confirm('Are you sure you want to remove this item from the order?')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/orders/${orderId}/items/${itemId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            if (data.empty) {
                showWarning('Empty Order', 'Order has no items left. Please add items or cancel the order.');
            } else {
                showSuccess('Item Removed', 'Item removed from order successfully!');
            }
            setTimeout(() => {
                editOrder(orderId);
            }, 500);
        } else {
            showError('Error', data.message || 'Failed to remove item from order');
        }
    } catch (error) {
        console.error('Error removing item:', error);
        showError('Error', 'Failed to remove item from order');
    }
}

function assignRider(orderId) {
    const riderId = prompt('Enter rider ID to assign:');
    if (!riderId || isNaN(riderId)) return;

    fetch(`${API_BASE}/api/orders/${orderId}/assign-rider`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ rider_id: parseInt(riderId) })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            loadOrders();
            showSuccess('Rider Assigned', 'Rider assigned to order successfully!');
        } else {
            showError('Error', data.message || 'Failed to assign rider');
        }
    })
    .catch(error => {
        console.error('Error assigning rider:', error);
        showError('Error', 'Failed to assign rider');
    });
}

// Categories Management

function toggleCategoryStatus(categoryId, currentStatus) {
    fetch(`${API_BASE}/api/categories/${categoryId}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ is_active: !currentStatus })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            loadCategories();
        } else {
            showError('Error', 'Failed to update category status');
        }
    })
    .catch(error => console.error('Error updating category:', error));
}

// Units Management
async function loadUnits() {
    try {
        const url = `${API_BASE}/api/units?ts=${Date.now()}`;
        const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${authToken}` }, cache: 'no-store' });
        let data;
        try { data = await resp.json(); }
        catch (e) {
            if (resp.status === 304) {
                const resp2 = await fetch(`${API_BASE}/api/units?ts=${Date.now()}`, { headers: { 'Authorization': `Bearer ${authToken}` }, cache: 'reload' });
                data = await resp2.json();
            } else {
                throw e;
            }
        }
        const tbody = document.getElementById('unitsTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (!data.success || !Array.isArray(data.units)) {
            console.warn('No units returned', data);
            return;
        }
        AppState.units = data.units;
        data.units.forEach(u => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${u.id}</td>
                <td>${u.name}</td>
                <td>${u.abbreviation || ''}</td>
                <td>${typeof u.multiplier !== 'undefined' ? parseFloat(u.multiplier).toFixed(4) : ''}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-small btn-edit" onclick="editUnit(${u.id})">
                            <i class="fas fa-edit"></i> Edit
                        </button>
                        <button class="btn-small btn-danger" onclick="deleteUnit(${u.id})">
                            <i class="fas fa-trash"></i> Delete
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(row);
        });
    } catch (err) {
        console.error('Error loading units:', err);
        showError('Error', 'Failed to load units');
    }
}

function showAddUnitModal() {
    AppState.editing.unitId = null;
    const existing = document.getElementById('addUnitModal');
    if (existing) try { existing.remove(); } catch (e) {}
    const m = document.createElement('div');
    m.id = 'addUnitModal';
    m.className = 'modal';
    m.innerHTML = `
        <div class="modal-content">
            <span class="close" data-modal="addUnitModal">&times;</span>
            <h3>Add Unit</h3>
            <form id="addUnitForm" autocomplete="off">
                <div class="form-row">
                    <div class="form-group">
                        <label for="unitName">Unit Name:</label>
                        <input type="text" id="unitName" name="name" required autocomplete="off" />
                    </div>
                    <div class="form-group">
                        <label for="unitAbbrev">Abbreviation:</label>
                        <input type="text" id="unitAbbrev" name="abbreviation" autocomplete="off" />
                    </div>
                </div>
                <div class="form-row-full">
                    <div class="form-group">
                        <label for="unitMultiplier">Multiplier (relative):</label>
                        <input type="number" id="unitMultiplier" name="multiplier" step="0.0001" value="1.0000" autocomplete="off" />
                    </div>
                </div>
                <div class="modal-footer">
                    <div class="action-buttons">
                        <button type="submit" class="btn btn-small btn-primary" id="saveUnitBtn"><i class="fas fa-check"></i> Save Unit</button>
                        <button type="button" class="btn btn-small btn-secondary" data-modal="addUnitModal"><i class="fas fa-ban"></i> Cancel</button>
                    </div>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(m);
    const form = document.getElementById('addUnitForm');
    form.addEventListener('submit', function(e){ e.preventDefault(); saveUnit(); });
    showModal('addUnitModal');
}

function resetUnitForm() {
    const form = document.getElementById('addUnitForm') || document.querySelector('#addUnitModal form');
    if (!form) return;
    try { form.reset(); } catch (e) {}
    const nameInput = form.querySelector('#unitName') || document.getElementById('unitName');
    const abbrInput = form.querySelector('#unitAbbrev') || document.getElementById('unitAbbrev');
    const multInput = form.querySelector('#unitMultiplier') || document.getElementById('unitMultiplier');
    if (nameInput) { nameInput.value = ''; try { nameInput.defaultValue = ''; nameInput.setAttribute('value', ''); } catch (e) {} }
    if (abbrInput) { abbrInput.value = ''; try { abbrInput.defaultValue = ''; abbrInput.setAttribute('value', ''); } catch (e) {} }
    if (multInput) { multInput.value = '1.0000'; try { multInput.defaultValue = '1.0000'; multInput.setAttribute('value', '1.0000'); } catch (e) {} }
    try { setTimeout(function(){ if (nameInput) nameInput.value = ''; if (abbrInput) abbrInput.value = ''; if (multInput) multInput.value = '1.0000'; }, 0); } catch (e) {}
}

async function saveUnit() {
    const form = document.getElementById('addUnitForm') || document.querySelector('#addUnitModal form') || (document.forms && document.forms['addUnitForm']) || null;
    if (!form) {
        const nameEl = document.getElementById('unitName');
        const abbrevEl = document.getElementById('unitAbbrev');
        const multEl = document.getElementById('unitMultiplier');
        const nameVal = nameEl && nameEl.value ? nameEl.value.trim() : '';
        const abbrevVal = abbrevEl && abbrevEl.value ? abbrevEl.value.trim() : null;
        const multVal = multEl && multEl.value ? parseFloat(multEl.value) : 1.0;
        if (!nameVal) { showError('Validation', 'Unit name is required'); return; }
        const payload = { name: nameVal, abbreviation: abbrevVal, multiplier: multVal };
        return await (async function(payloadLocal){
            try {
                console.debug('saveUnit: sending (no-form fallback)', { unitId: AppState.editing.unitId, payload: payloadLocal });
                let resp;
                if (AppState.editing.unitId) {
                    resp = await fetch(`${API_BASE}/api/units/${AppState.editing.unitId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                        body: JSON.stringify(payloadLocal)
                    });
                } else {
                    resp = await fetch(`${API_BASE}/api/units`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                        body: JSON.stringify(payloadLocal)
                    });
                }
                let data;
                try { data = await resp.json(); } catch (e) { const text = await resp.text(); console.error('saveUnit: invalid JSON response', resp.status, text); throw e; }
                console.debug('saveUnit: response', resp.status, data);
                if (resp.ok && data && data.success) {
                    showSuccess('Saved', 'Unit saved successfully');
                    resetUnitForm();
                    hideModal('addUnitModal');
                    AppState.editing.unitId = null;
                    await loadUnits();
                } else {
                    const msg = data && (data.message || (data.errors && JSON.stringify(data.errors))) ? (data.message || JSON.stringify(data.errors)) : `HTTP ${resp.status}`;
                    console.error('saveUnit failed', msg, data);
                    showError('Error', msg || 'Failed to save unit');
                }
            } catch (err) {
                console.error('Error saving unit (exception):', err);
                showError('Error', 'Failed to save unit');
            }
        })(payload);
    }
    try { console.log('saveUnit: click'); } catch (e) {}
    const formData = new FormData(form);
    const payload = {
        name: formData.get('name'),
        abbreviation: formData.get('abbreviation') || null,
        multiplier: formData.get('multiplier') || 1.0
    };
    try {
        console.debug('saveUnit: sending', { unitId: AppState.editing.unitId, payload });
        let resp;
        if (AppState.editing.unitId) {
            resp = await fetch(`${API_BASE}/api/units/${AppState.editing.unitId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                body: JSON.stringify(payload)
            });
        } else {
            resp = await fetch(`${API_BASE}/api/units`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                body: JSON.stringify(payload)
            });
        }

        let data;
        try { data = await resp.json(); } catch (e) { const text = await resp.text(); console.error('saveUnit: invalid JSON response', resp.status, text); throw e; }
        console.debug('saveUnit: response', resp.status, data);
        if (resp.ok && data && data.success) {
            showSuccess('Saved', 'Unit saved successfully');
            resetUnitForm();
            hideModal('addUnitModal');
            AppState.editing.unitId = null;
            await loadUnits();
        } else {
            const msg = data && (data.message || (data.errors && JSON.stringify(data.errors))) ? (data.message || JSON.stringify(data.errors)) : `HTTP ${resp.status}`;
            console.error('saveUnit failed', msg, data);
            showError('Error', msg || 'Failed to save unit');
        }
    } catch (err) {
        console.error('Error saving unit (exception):', err);
        showError('Error', 'Failed to save unit');
    }
}

try { window.saveUnit = saveUnit; } catch (e) {}

async function editUnit(unitId) {
    AppState.editing.unitId = unitId;
    let unit = (AppState.units || []).find(u => String(u.id) === String(unitId));
    if (!unit) {
        try {
            const resp = await fetch(`${API_BASE}/api/units?ts=${Date.now()}`, { headers: { 'Authorization': `Bearer ${authToken}` }, cache: 'no-store' });
            const data = await resp.json();
            if (data && data.success && Array.isArray(data.units)) {
                AppState.units = data.units;
                unit = (AppState.units || []).find(u => String(u.id) === String(unitId));
            }
        } catch (e) {}
    }
    const existing = document.getElementById('addUnitModal');
    if (existing) try { existing.remove(); } catch (e) {}
    const m = document.createElement('div');
    m.id = 'addUnitModal';
    m.className = 'modal';
    const namePrefill = unit && unit.name ? String(unit.name) : '';
    const abbrPrefill = unit && unit.abbreviation ? String(unit.abbreviation) : '';
    const multPrefill = typeof (unit && unit.multiplier) !== 'undefined' ? parseFloat(unit.multiplier).toFixed(4) : '1.0000';
    m.innerHTML = `
        <div class="modal-content">
            <span class="close" data-modal="addUnitModal">&times;</span>
            <h3>Edit Unit</h3>
            <form id="addUnitForm" autocomplete="off">
                <div class="form-row">
                    <div class="form-group">
                        <label for="unitName">Unit Name:</label>
                        <input type="text" id="unitName" name="name" required autocomplete="off" value="${namePrefill}" />
                    </div>
                    <div class="form-group">
                        <label for="unitAbbrev">Abbreviation:</label>
                        <input type="text" id="unitAbbrev" name="abbreviation" autocomplete="off" value="${abbrPrefill}" />
                    </div>
                </div>
                <div class="form-row-full">
                    <div class="form-group">
                        <label for="unitMultiplier">Multiplier (relative):</label>
                        <input type="number" id="unitMultiplier" name="multiplier" step="0.0001" value="${multPrefill}" autocomplete="off" />
                    </div>
                </div>
                <div class="modal-footer">
                    <div class="action-buttons">
                        <button type="submit" class="btn btn-small btn-primary" id="saveUnitBtn"><i class="fas fa-check"></i> Update Unit</button>
                        <button type="button" class="btn btn-small btn-secondary" data-modal="addUnitModal"><i class="fas fa-ban"></i> Cancel</button>
                    </div>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(m);
    const form = document.getElementById('addUnitForm');
    form.addEventListener('submit', function(e){ e.preventDefault(); saveUnit(); });
    showModal('addUnitModal');
}
window.editUnit = editUnit;

async function deleteUnit(unitId) {
    if (!confirm('Delete this unit? This cannot be undone.')) return;
    try {
        const resp = await fetch(`${API_BASE}/api/units/${unitId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await resp.json();
        if (data.success) {
            showSuccess('Deleted', 'Unit deleted');
            await loadUnits();
        } else {
            showError('Error', data.message || 'Failed to delete unit');
        }
    } catch (err) {
        console.error('Error deleting unit:', err);
        showError('Error', 'Failed to delete unit');
    }
}

// Sizes Management
async function loadSizes() {
    try {
        const resp = await fetch(`${API_BASE}/api/sizes`, { headers: { 'Authorization': `Bearer ${authToken}` } });
        const data = await resp.json();
        const tbody = document.getElementById('sizesTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (!data.success || !Array.isArray(data.sizes)) return;
        AppState.sizes = data.sizes;
        data.sizes.forEach(s => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${s.id}</td>
                <td>${s.label}</td>
                <td>${s.description || ''}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-small btn-edit" onclick="editSize(${s.id})">
                            <i class="fas fa-edit"></i> Edit
                        </button>
                        <button class="btn-small btn-danger" onclick="deleteSize(${s.id})">
                            <i class="fas fa-trash"></i> Delete
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(row);
        });
    } catch (err) {
        console.error('Error loading sizes:', err);
        showError('Error', 'Failed to load sizes');
    }
}



async function saveSize() {
    const form = document.getElementById('addSizeForm');
    if (!form) return;
    const formData = new FormData(form);
    const payload = {
        label: formData.get('label'),
        description: formData.get('description') || null
    };
    try {
        console.debug('saveSize: sending', { sizeId: AppState.editing.sizeId, payload });
        let resp;
        if (AppState.editing.sizeId) {
            resp = await fetch(`${API_BASE}/api/sizes/${AppState.editing.sizeId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                body: JSON.stringify(payload)
            });
        } else {
            resp = await fetch(`${API_BASE}/api/sizes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                body: JSON.stringify(payload)
            });
        }

        let data;
        try { data = await resp.json(); } catch (e) { const text = await resp.text(); console.error('saveSize: invalid JSON response', resp.status, text); throw e; }
        console.debug('saveSize: response', resp.status, data);
        if (resp.ok && data && data.success) {
            showSuccess('Saved', 'Size saved successfully');
            hideModal('addSizeModal');
            AppState.editing.sizeId = null;
            await loadSizes();
        } else {
            const msg = data && (data.message || (data.errors && JSON.stringify(data.errors))) ? (data.message || JSON.stringify(data.errors)) : `HTTP ${resp.status}`;
            console.error('saveSize failed', msg, data);
            showError('Error', msg || 'Failed to save size');
        }
    } catch (err) {
        console.error('Error saving size (exception):', err);
        showError('Error', 'Failed to save size');
    }
}

async function editSize(sizeId) {
    AppState.editing.sizeId = sizeId;
    const s = (AppState.sizes || []).find(x => x.id === sizeId);
    if (s) {
        const form = document.getElementById('addSizeForm');
        form.querySelector('#sizeLabel').value = s.label || '';
        form.querySelector('#sizeDescription').value = s.description || '';
        showModal('addSizeModal');
    } else {
        showError('Not Found', 'Size not found');
    }
}

async function deleteSize(sizeId) {
    if (!confirm('Delete this size? This cannot be undone.')) return;
    try {
        const resp = await fetch(`${API_BASE}/api/sizes/${sizeId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await resp.json();
        if (data.success) {
            showSuccess('Deleted', 'Size deleted');
            await loadSizes();
        } else {
            showError('Error', data.message || 'Failed to delete size');
        }
    } catch (err) {
        console.error('Error deleting size:', err);
        showError('Error', 'Failed to delete size');
    }
}

// Modal functions
function showModal(modalId) {
    const el = document.getElementById(modalId);
    if (!el) {
        console.warn('showModal: modal not found', modalId);
        return;
    }
    let content = null;
    // If the modal is nested inside another hidden container, move it to
    // `document.body` so it's not affected by ancestor visibility/display.
    try {
        if (el.parentElement && el.parentElement !== document.body) {
            try { document.body.appendChild(el); } catch (e) { /* ignore DOM move errors */ }
        }
    } catch (e) { /* ignore */ }

    // Ensure modal is visible and on top; apply robust visibility fixes
    try {
        const all = Array.from(document.querySelectorAll('.modal'));
        let maxZ = 9999;
        all.forEach(m => {
            const z = parseInt((m && m.style && m.style.zIndex) ? String(m.style.zIndex) : '0', 10);
            if (Number.isFinite(z) && z > maxZ) maxZ = z;
        });
        const nextZ = maxZ + 2;
        el.classList.add('show');
        el.style.display = 'block';
        el.style.visibility = 'visible';
        el.style.pointerEvents = 'auto';
        el.style.zIndex = nextZ;

        content = el.querySelector('.modal-content');
        if (content) {
            content.style.display = 'block';
            content.style.visibility = 'visible';
            content.style.pointerEvents = 'auto';
            content.style.transform = 'none';
            content.style.opacity = '1';
            // ensure content is in front
            content.style.zIndex = nextZ + 1;
        }
        const overlay = document.querySelector('.nav-overlay');
        if (overlay) {
            overlay.style.pointerEvents = 'none';
            overlay.style.zIndex = '0';
        }
    } catch (e) { /* ignore style errors */ }

    // Focus first focusable element inside modal to ensure keyboard and visibility
    try {
        const first = el.querySelector('input, select, textarea, button, [tabindex]');
        if (first) {
            first.focus();
        } else if (content) {
            content.setAttribute('tabindex', '-1');
            content.focus();
        }
    } catch (e) { /* ignore focus errors */ }

}

function hideModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'none';
    // Reset form
    const form = document.querySelector(`#${modalId} form`);
    if (form) form.reset();
    if (modalId === 'addUnitModal') {
        try { el.remove(); } catch (e) {}
    }
    try {
        const overlay = document.querySelector('.nav-overlay');
        if (overlay) {
            overlay.style.pointerEvents = '';
            overlay.style.zIndex = '';
        }
    } catch (e) { /* ignore */ }
    // Clear any editing state related to this modal to avoid stale IDs
    try {
        if (modalId === 'addUnitModal') AppState.editing.unitId = null;
        if (modalId === 'addSizeModal') AppState.editing.sizeId = null;
        if (modalId === 'addStoreModal') AppState.editing.storeId = null;
        if (modalId === 'addProductModal') {
            AppState.editing.productId = null;
            AppState.editing.productStoreId = null;
        }
        if (modalId === 'editAccountModal') {
            AppState.editing.accountId = null;
            AppState.editing.accountOriginal = null;
        }
        if (modalId === 'addCategoryModal') AppState.editing.categoryId = null;
        if (modalId === 'addRiderModal') AppState.editing.riderId = null;
    } catch (e) { /* ignore */ }
}

async function showAddStoreModal() {
    AppState.editing.storeId = null;
    try {
        await populateStoreCategorySelect();
        await populateStoreBankSelect();
    } catch (error) {
        console.error('Error loading categories:', error);
    }
    const modal = document.getElementById('addStoreModal');
    if (modal) {
        const titleEl = modal.querySelector('.modal-header h3');
        if (titleEl) titleEl.textContent = 'Add New Store';
        const saveBtn = modal.querySelector('#saveStoreBtn');
        if (saveBtn) saveBtn.textContent = 'Save Store';
        const unmuteBtn = modal.querySelector('#storeUnmuteGraceBtn');
        if (unmuteBtn) unmuteBtn.style.display = 'none';
    }
    showModal('addStoreModal');
    try {
        const form = document.getElementById('addStoreForm');
        if (form) {
            if (form.querySelector('#storeGraceDays')) form.querySelector('#storeGraceDays').value = '';
            if (form.querySelector('#storeGraceStartDate')) form.querySelector('#storeGraceStartDate').value = '';
            if (form.querySelector('#storePaymentTerm')) form.querySelector('#storePaymentTerm').value = '';
            if (form.querySelector('#storeBankId')) form.querySelector('#storeBankId').value = '';
            if (form.querySelector('#storeBankAccountTitle')) form.querySelector('#storeBankAccountTitle').value = '';
            if (form.querySelector('#storeBankAccountNumber')) form.querySelector('#storeBankAccountNumber').value = '';
            if (form.querySelector('#storeDiscountApplyAllProducts')) form.querySelector('#storeDiscountApplyAllProducts').checked = false;
            if (form.querySelector('#storeDiscountPercent')) form.querySelector('#storeDiscountPercent').value = '';
        }
        updateStoreGraceControls();
    } catch (e) {}

    const fileInput = document.getElementById('storeImageFile');
    const preview = document.getElementById('storeImagePreview');

    if (fileInput) {
        fileInput.onchange = (e) => {
            const file = e.target.files && e.target.files[0];
            if (file && preview) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    preview.src = ev.target.result;
                    preview.style.display = 'inline-block';
                    applyOrientationFitAdmin(preview);
                };
                reader.readAsDataURL(file);
            }
        };
    }


}

async function saveStore() {
    // Permission check
    if (currentUser.user_type !== 'admin' && !currentUserPermissions.has('action_manage_stores')) {
        showError('Access Denied', 'You do not have permission to manage stores.');
        return;
    }

    const formEl = document.getElementById('addStoreForm');
    const formData = new FormData(formEl);
    const paymentTermRaw = formData.get('payment_term') || null;
    const graceApplicable = isGraceApplicableStoreTerm(paymentTermRaw);
    const discountApplicable = isDiscountPaymentTerm(paymentTermRaw);
    const storeDiscountApply = discountApplicable && !!document.getElementById('storeDiscountApplyAllProducts')?.checked;
    const storeData = {
        name: formData.get('name'),
        description: formData.get('description'),
        location: formData.get('location'),
        // Normalize phone: keep as entered, but trim to reduce validation issues
        phone: (formData.get('phone') || '').trim() || undefined,
        email: formData.get('email'),
        rating: parseFloat(formData.get('rating')) || 0,
        delivery_time: formData.get('delivery_time'),
        opening_time: formData.get('opening_time') || null,
        closing_time: formData.get('closing_time') || null,
        payment_term: paymentTermRaw,
        payment_grace_days: (() => {
            if (!graceApplicable) return null;
            const raw = String(formData.get('payment_grace_days') || '').trim();
            if (!raw.length) return null;
            const n = parseInt(raw, 10);
            return Number.isInteger(n) && n >= 0 ? n : null;
        })(),
        payment_grace_start_date: (() => {
            if (!graceApplicable) return null;
            const raw = String(formData.get('payment_grace_start_date') || '').trim();
            return raw.length ? raw : null;
        })(),
        store_discount_apply_all_products: storeDiscountApply,
        store_discount_percent: (() => {
            if (!storeDiscountApply) return null;
            const raw = String(formData.get('store_discount_percent') || '').trim();
            const n = parseFloat(raw);
            return Number.isFinite(n) && n >= 0 ? n : null;
        })(),
        address: formData.get('address'),
        status: formData.get('status') || 'active',
        category_id: formData.get('category_id') || null,
        bank_id: (() => {
            const raw = String(formData.get('bank_id') || '').trim();
            if (!raw) return null;
            const n = parseInt(raw, 10);
            return Number.isInteger(n) && n > 0 ? n : null;
        })(),
        store_bank_account_title: String(formData.get('store_bank_account_title') || '').trim() || null,
        store_bank_account_number: String(formData.get('store_bank_account_number') || '').trim() || null,
        owner_name: (formData.get('owner_name') || '').trim() || undefined
    };
    if (storeData.store_discount_apply_all_products && (!Number.isFinite(Number(storeData.store_discount_percent)) || Number(storeData.store_discount_percent) < 0)) {
        showError('Invalid Input', 'Please enter a valid Store Discount (%) value.');
        return;
    }

    // If a file was selected, upload it first to server to get back a public URL and variants
    const fileInput = document.getElementById('storeImageFile');
    if (fileInput && fileInput.files && fileInput.files.length > 0) {
        try {
            const fd = new FormData();
            fd.append('image', fileInput.files[0]);
            const upRes = await fetch(`${API_BASE}/api/stores/upload-image`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${authToken}` },
                body: fd
            });
            const upJson = await upRes.json();
            if (upJson.success && upJson.image_url) {
                storeData.image_url = upJson.image_url;
                // include server-computed meta if returned
                if (upJson.image_meta) {
                    storeData.image_bg_r = upJson.image_meta.image_bg_r;
                    storeData.image_bg_g = upJson.image_meta.image_bg_g;
                    storeData.image_bg_b = upJson.image_meta.image_bg_b;
                    storeData.image_overlay_alpha = upJson.image_meta.image_overlay_alpha;
                    storeData.image_contrast = upJson.image_meta.image_contrast;
                }
                if (upJson.variants) {
                    let vfield = formEl.querySelector('input[name="image_variants"]');
                    if (!vfield) {
                        vfield = document.createElement('input');
                        vfield.type = 'hidden';
                        vfield.name = 'image_variants';
                        formEl.appendChild(vfield);
                    }
                    vfield.value = JSON.stringify(upJson.variants);
                }
            } else {
                showWarning('Upload Warning', upJson.message || 'Image upload returned no URL.');
            }
        } catch (err) {
            console.error('Image upload failed', err);
            showWarning('Upload Failed', 'Image upload failed.');
        }
    }

    try {
        if (AppState.editing.storeId) {
            const response = await fetch(`${API_BASE}/api/stores/${AppState.editing.storeId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                body: JSON.stringify(storeData)
            });
            const data = await response.json();
            if (data.success) {
                showSuccess('Store Updated', 'Store updated successfully!');
                hideModal('addStoreModal');
                AppState.editing.storeId = null;
                loadStores();
            } else {
                showError('Error', data.message || 'Failed to update store');
            }
        } else {
            const response = await fetch(`${API_BASE}/api/stores`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                body: JSON.stringify(storeData)
            });
            const data = await response.json();
            if (data.success) {
                showSuccess('Store Created', 'Store created successfully!');
                hideModal('addStoreModal');
                loadStores();
            } else {
                showError('Error', data.message || 'Failed to create store');
            }
        }
    } catch (error) {
        console.error('Error creating/updating store:', error);
        showError('Error', 'Failed to save store');
    }
}

async function editStore(storeId) {
    // Open edit modal and populate
    AppState.editing.storeId = storeId;
    try {
        const resp = await fetch(`${API_BASE}/api/stores/${storeId}?admin=1`, { headers: { 'Authorization': `Bearer ${authToken}` } });
        const data = await resp.json();
        if (!data || !data.success || !data.store) { showError('Error', 'Failed to load store'); return; }
        const s = data.store;
        const selectedCategoryId = (() => {
            const raw = s.category_id ?? s.categoryId ?? s.category?.id ?? null;
            if (raw === null || raw === undefined) return null;
            const n = parseInt(String(raw).trim(), 10);
            return Number.isInteger(n) && n > 0 ? n : null;
        })();
        await populateStoreCategorySelect(selectedCategoryId);
        await populateStoreBankSelect(s.bank_id || null);
        const form = document.getElementById('addStoreForm');
        form.querySelector('#storeName').value = s.name || '';
        form.querySelector('#storeOwner').value = s.owner_name || '';
        form.querySelector('#storeLocation').value = s.location || '';
        // Set preview image if exists
        const preview = document.getElementById('storeImagePreview');
        if (preview) {
            if (s.image_url) {
                preview.src = s.image_url;
                preview.style.display = 'inline-block';
                // try to fit orientation if helper present in scope
                try { applyOrientationFitAdmin(preview); } catch (e) { /* no-op */ }
            } else {
                preview.style.display = 'none';
            }
        }
        form.querySelector('#storePhone').value = s.phone || '';
        form.querySelector('#storeEmail').value = s.email || '';
        form.querySelector('#storeRating').value = s.rating || 0;
        form.querySelector('#storeDeliveryTime').value = s.delivery_time || '';
        if (s.opening_time) form.querySelector('#storeOpeningTime').value = s.opening_time;
        if (s.closing_time) form.querySelector('#storeClosingTime').value = s.closing_time;
        if (form.querySelector('#storePaymentTerm')) form.querySelector('#storePaymentTerm').value = s.payment_term || '';
        if (form.querySelector('#storeBankId')) form.querySelector('#storeBankId').value = s.bank_id ? String(s.bank_id) : '';
        if (form.querySelector('#storeBankAccountTitle')) form.querySelector('#storeBankAccountTitle').value = s.store_bank_account_title || s.bank_info?.account_title || '';
        if (form.querySelector('#storeBankAccountNumber')) form.querySelector('#storeBankAccountNumber').value = s.store_bank_account_number || s.bank_info?.account_number || '';
        if (form.querySelector('#storeDiscountApplyAllProducts')) form.querySelector('#storeDiscountApplyAllProducts').checked = Number(s.store_discount_apply_all_products || 0) === 1;
        if (form.querySelector('#storeDiscountPercent')) form.querySelector('#storeDiscountPercent').value = s.store_discount_percent ?? '';
        if (form.querySelector('#storeGraceDays')) form.querySelector('#storeGraceDays').value = (s.payment_grace_days ?? '').toString();
        if (form.querySelector('#storeGraceStartDate')) form.querySelector('#storeGraceStartDate').value = normalizeDateInputValue(s.payment_grace_start_date);
        if (form.querySelector('#storeCategory') && selectedCategoryId !== null) {
            form.querySelector('#storeCategory').value = String(selectedCategoryId);
        }
        form.querySelector('#storeDescription').value = s.description || '';
        form.querySelector('#storeAddress').value = s.address || '';
        updateStoreGraceControls();
        const modal = document.getElementById('addStoreModal');
        if (modal) {
            const titleEl = modal.querySelector('.modal-header h3');
            if (titleEl) titleEl.textContent = 'Edit Store';
            const saveBtn = modal.querySelector('#saveStoreBtn');
            if (saveBtn) saveBtn.textContent = 'Update Store';
            const unmuteBtn = modal.querySelector('#storeUnmuteGraceBtn');
            if (unmuteBtn) unmuteBtn.style.display = '';
        }
        showModal('addStoreModal');
    } catch (e) {
        console.error('Failed to load store for edit', e);
        showError('Error', 'Failed to load store for edit');
    }
}

async function populateStoreCategorySelect(selectedId = null) {
    const categorySelect = document.getElementById('storeCategory');
    if (!categorySelect) return;
    categorySelect.innerHTML = '<option value="">Select Category (Optional)</option>';
    try {
        const normalizedSelectedId = (() => {
            if (selectedId === null || selectedId === undefined || String(selectedId).trim() === '') return null;
            const n = parseInt(String(selectedId).trim(), 10);
            return Number.isInteger(n) && n > 0 ? n : null;
        })();
        const resp = await fetch(`${API_BASE}/api/categories?includeInactive=true&ts=${Date.now()}`, {
            headers: { 'Authorization': `Bearer ${authToken}` },
            cache: 'no-store'
        });
        const data = await resp.json();
        if (data && data.success && Array.isArray(data.categories)) {
            data.categories.forEach(category => {
                categorySelect.innerHTML += `<option value="${category.id}">${category.name}</option>`;
            });
        }
        if (normalizedSelectedId !== null) {
            categorySelect.value = String(normalizedSelectedId);
        }
    } catch (err) {
        console.error('Error loading categories:', err);
    }
}

function setProductStoreTerms(stores) {
    AppState.productStoreTermsById = {};
    AppState.productStoreDiscountById = {};
    (stores || []).forEach(s => {
        if (s && s.id !== undefined && s.id !== null) {
            AppState.productStoreTermsById[String(s.id)] = s.payment_term || '';
            const enabled = Number(s.store_discount_apply_all_products || 0) === 1;
            const percent = parseFloat(String(s.store_discount_percent ?? '').trim());
            AppState.productStoreDiscountById[String(s.id)] = {
                enabled,
                percent: Number.isFinite(percent) && percent >= 0 ? percent : null
            };
        }
    });
}

function isDiscountPaymentTerm(term) {
    const t = String(term || '').toLowerCase().trim();
    if (!t) return false;
    // Accept canonical values and resilient text variants from DB/manual edits.
    return t.includes('with discount') || t.includes('discount');
}

function isProfitPaymentTerm(term) {
    const t = String(term || '').toLowerCase().trim();
    return t === 'cash only' || t === 'credit';
}

function isCashOnlyPaymentTerm(term) {
    return String(term || '').toLowerCase().trim() === 'cash only';
}

function getStoreDiscountOverride(storeId) {
    const cfg = AppState.productStoreDiscountById[String(storeId || '')] || null;
    if (!cfg || !cfg.enabled) return null;
    const pct = Number(cfg.percent);
    if (!Number.isFinite(pct) || pct < 0) return null;
    return { type: 'percent', value: pct };
}

function isGraceApplicableStoreTerm(term) {
    const t = String(term || '').toLowerCase().trim();
    return !!t && t !== 'cash only' && t !== 'credit';
}

function updateStoreGraceControls() {
    const termEl = document.getElementById('storePaymentTerm');
    const graceDaysGroup = document.getElementById('storeGraceDaysGroup');
    const graceStartGroup = document.getElementById('storeGraceStartDateGroup');
    const graceDaysEl = document.getElementById('storeGraceDays');
    const graceStartEl = document.getElementById('storeGraceStartDate');
    if (!termEl || !graceDaysGroup || !graceStartGroup) return;

    const enabled = isGraceApplicableStoreTerm(termEl.value);
    graceDaysGroup.style.display = enabled ? '' : 'none';
    graceStartGroup.style.display = enabled ? '' : 'none';
    if (!enabled) {
        if (graceDaysEl) graceDaysEl.value = '';
        if (graceStartEl) graceStartEl.value = '';
    }
    updateStoreDiscountControls();
    updateStoreGraceDuePreview();
}

function updateStoreDiscountControls() {
    const termEl = document.getElementById('storePaymentTerm');
    const applyGroup = document.getElementById('storeDiscountApplyGroup');
    const percentGroup = document.getElementById('storeDiscountPercentGroup');
    const applyEl = document.getElementById('storeDiscountApplyAllProducts');
    const percentEl = document.getElementById('storeDiscountPercent');
    if (!termEl || !applyGroup || !percentGroup || !applyEl || !percentEl) return;

    const discountTerm = isDiscountPaymentTerm(termEl.value);
    applyGroup.style.display = discountTerm ? '' : 'none';
    percentGroup.style.display = discountTerm && applyEl.checked ? '' : 'none';
    if (!discountTerm) {
        applyEl.checked = false;
        percentEl.value = '';
    }
}

let storeBankOptions = [];

function renderStoreBankMeta() {
    const bankSelect = document.getElementById('storeBankId');
    const titleEl = document.getElementById('storeBankAccountTitle');
    const numberEl = document.getElementById('storeBankAccountNumber');
    if (!bankSelect || !titleEl || !numberEl) return;
    const selectedId = parseInt(String(bankSelect.value || ''), 10);
    const bank = Number.isInteger(selectedId)
        ? storeBankOptions.find((b) => Number(b.id) === selectedId)
        : null;
    titleEl.value = bank?.account_title || '';
    numberEl.value = bank?.account_number || '';
}

async function populateStoreBankSelect(selectedId = null) {
    const bankSelect = document.getElementById('storeBankId');
    if (!bankSelect) return;
    bankSelect.innerHTML = '<option value="">Select Bank (Optional)</option>';
    try {
        const activeStoreId = parseInt(String(AppState?.editing?.storeId || ''), 10);
        const hasActiveStoreId = Number.isInteger(activeStoreId) && activeStoreId > 0;
        const query = new URLSearchParams();
        if (hasActiveStoreId) {
            query.set('store_id', String(activeStoreId));
            const parsedSelectedId = parseInt(String(selectedId || ''), 10);
            if (Number.isInteger(parsedSelectedId) && parsedSelectedId > 0) {
                query.set('include_bank_id', String(parsedSelectedId));
            }
        }
        const url = `${API_BASE}/api/stores/bank-options${query.toString() ? `?${query.toString()}` : ''}`;
        const resp = await fetch(url, {
            headers: { 'Authorization': `Bearer ${authToken}` },
            cache: 'no-store'
        });
        const data = await resp.json();
        if (data && data.success && Array.isArray(data.banks)) {
            storeBankOptions = data.banks;
            data.banks.forEach((bank) => {
                const opt = document.createElement('option');
                opt.value = String(bank.id);
                opt.textContent = bank.name || `Bank #${bank.id}`;
                bankSelect.appendChild(opt);
            });
        } else {
            storeBankOptions = [];
        }
        if (selectedId !== null && selectedId !== undefined && String(selectedId).trim() !== '') {
            bankSelect.value = String(selectedId);
        }
        renderStoreBankMeta();
    } catch (err) {
        storeBankOptions = [];
        console.error('Error loading bank options:', err);
    }
}

function updateStoreGraceDuePreview() {
    const startEl = document.getElementById('storeGraceStartDate');
    const daysEl = document.getElementById('storeGraceDays');
    const previewEl = document.getElementById('storeGraceDueDatePreview');
    if (!previewEl) return;
    const start = String(startEl?.value || '').trim();
    const days = parseInt(String(daysEl?.value || '').trim(), 10);
    if (!start || !Number.isInteger(days) || days < 0) {
        previewEl.textContent = 'Due Date: -';
        return;
    }
    const dt = new Date(`${start}T00:00:00`);
    if (Number.isNaN(dt.getTime())) {
        previewEl.textContent = 'Due Date: -';
        return;
    }
    dt.setDate(dt.getDate() + days);
    previewEl.textContent = `Due Date: ${dt.toLocaleDateString()}`;
}

function normalizeDateInputValue(rawValue) {
    const value = String(rawValue || '').trim();
    if (!value) return '';
    const direct = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (direct && direct[1]) return direct[1];
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return '';
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

let _storeGraceAlertTimer = null;
let _storeGraceAlertBusy = false;
let _storeGracePermissionRequested = false;
let _storeGraceSwRegistration = null;
const _adminSystemNotifyClaims = new Map();
let _adminSystemNotifyChannel = null;

function _normalizeAdminSystemNotifyText(raw) {
    return String(raw || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function _extractAdminOrderNumber(title, body) {
    const haystack = `${String(title || '')}\n${String(body || '')}`;
    const patterns = [
        /order\s+#?\s*([a-z0-9-]+)/i,
        /#\s*([a-z0-9-]+)/i
    ];
    for (const pattern of patterns) {
        const match = haystack.match(pattern);
        if (match && match[1]) {
            return String(match[1]).trim().toUpperCase();
        }
    }
    return '';
}

function _getAdminSystemNotifyCategory(title, body) {
    const text = `${_normalizeAdminSystemNotifyText(title)} ${_normalizeAdminSystemNotifyText(body)}`.trim();
    if (!text) return 'generic';
    if (text.includes('new order received') || text.includes('new order')) return 'new-order';
    if (text.includes('order assigned') || text.includes('new assignment')) return 'order-assigned';
    if (text.includes('payment received') || text.includes('payment confirmed')) return 'payment-received';
    if (text.includes('order completed') || text.includes('fully completed')) return 'order-completed';
    if (text.includes('order delivered') || text.includes(' delivered')) return 'order-delivered';
    if (text.includes('order update')) return 'order-update';
    return 'generic';
}

function _buildAdminSystemNotifyClaimKey(title, body, storeId) {
    const category = _getAdminSystemNotifyCategory(title, body);
    const orderNumber = _extractAdminOrderNumber(title, body);
    if (orderNumber && category !== 'generic') {
        return `${category}|${orderNumber}`;
    }
    return `${String(title || '').trim()}|${String(body || '').trim()}|${String(storeId || '').trim()}`;
}

try {
    _adminSystemNotifyChannel = new BroadcastChannel('servenow-admin-system-notify');
    _adminSystemNotifyChannel.onmessage = (event) => {
        const key = String(event?.data?.key || '').trim();
        const timestamp = Number(event?.data?.timestamp || 0);
        if (!key || !Number.isFinite(timestamp) || timestamp <= 0) return;
        _adminSystemNotifyClaims.set(key, timestamp);
    };
} catch (_) {
    _adminSystemNotifyChannel = null;
}

function _rememberAdminSystemNotifyClaim(key, timestamp) {
    _adminSystemNotifyClaims.set(key, timestamp);
    try {
        localStorage.setItem(`servenow:admin-system-notify:${key}`, String(timestamp));
    } catch (_) {}
    try {
        _adminSystemNotifyChannel?.postMessage({ key, timestamp });
    } catch (_) {}
}

function _hasRecentAdminSystemNotifyClaim(key, windowMs = 15000) {
    const now = Date.now();
    const memoryTimestamp = Number(_adminSystemNotifyClaims.get(key) || 0);
    if (Number.isFinite(memoryTimestamp) && memoryTimestamp > 0 && (now - memoryTimestamp) < windowMs) {
        return true;
    }
    try {
        const storageTimestamp = Number(localStorage.getItem(`servenow:admin-system-notify:${key}`) || 0);
        if (Number.isFinite(storageTimestamp) && storageTimestamp > 0 && (now - storageTimestamp) < windowMs) {
            _adminSystemNotifyClaims.set(key, storageTimestamp);
            return true;
        }
    } catch (_) {}
    return false;
}

async function ensureAdminNotificationSw() {
    if (!('serviceWorker' in navigator)) return null;
    if (_storeGraceSwRegistration) return _storeGraceSwRegistration;
    try {
        _storeGraceSwRegistration = await navigator.serviceWorker.register('/admin-sw.js');
        if (!_storeGraceSwRegistration.__servenowBoundMessageHandler) {
            navigator.serviceWorker.addEventListener('message', (event) => {
                handleStoreGraceNotificationActionMessage(event?.data).catch((error) => {
                    console.warn('Store grace notification action handling failed:', error);
                });
            });
            _storeGraceSwRegistration.__servenowBoundMessageHandler = '1';
        }
        return _storeGraceSwRegistration;
    } catch (e) {
        console.warn('Admin notification service worker registration failed:', e);
        return null;
    }
}

async function showStoreGraceSystemNotification(title, body, storeId, onClick) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;
    const dedupKey = _buildAdminSystemNotifyClaimKey(title, body, storeId);
    if (_hasRecentAdminSystemNotifyClaim(dedupKey)) {
        return true;
    }
    _rememberAdminSystemNotifyClaim(dedupKey, Date.now());
    const notificationTag = `store-due-${Math.abs(dedupKey.split('').reduce((acc, ch) => ((acc * 31) + ch.charCodeAt(0)) | 0, 17))}`;
    try {
        const reg = await ensureAdminNotificationSw();
        if (reg && typeof reg.showNotification === 'function') {
            await reg.showNotification(title, {
                body,
                requireInteraction: true,
                tag: notificationTag,
                renotify: true,
                actions: [
                    { action: 'mute_1h', title: 'Mute 1 Hour' },
                    { action: 'mute_custom', title: 'Mute...' }
                ],
                data: {
                    store_id: storeId,
                    store_name: String(window.__lastStoreGraceAlert?.storeName || '').trim(),
                    due_date: String(window.__lastStoreGraceAlert?.dueDate || '').trim(),
                    pending_amount: window.__lastStoreGraceAlert?.pending ?? null,
                    days_left: window.__lastStoreGraceAlert?.daysLeft ?? null
                }
            });
            return true;
        }
    } catch (e) {
        console.warn('Service worker notification failed, fallback to Notification API:', e);
    }
    try {
        const notif = new Notification(title, {
            body,
            requireInteraction: true,
            tag: notificationTag,
            renotify: true
        });
        if (typeof onClick === 'function') notif.onclick = onClick;
        return true;
    } catch (e) {
        console.warn('Notification API failed:', e);
    }
    return false;
}

async function handleStoreGraceNotificationActionMessage(message) {
    const type = String(message?.type || '').trim();
    if (type !== 'store-grace-alert-action') return;

    const action = String(message?.action || 'open').trim().toLowerCase();
    const storeId = parseInt(String(message?.store_id || ''), 10);
    const storeName = String(message?.store_name || '').trim() || `Store #${storeId || '?'}`;
    const dueDate = String(message?.due_date || '-').trim() || '-';
    const pending = Number(message?.pending_amount || 0).toFixed(2);
    const daysLeft = Number(message?.days_left);
    const lead =
        Number.isFinite(daysLeft) && daysLeft < 0
            ? `Overdue by ${Math.abs(daysLeft)} day(s)`
            : (Number.isFinite(daysLeft) ? `Due in ${daysLeft} day(s)` : 'Payment due');

    try { window.focus(); } catch (_) {}

    if (!Number.isInteger(storeId) || storeId <= 0) {
        if (action === 'open') {
            showInfo('Store Due Alert', `${storeName}: ${lead} (Due ${dueDate})`);
        }
        return;
    }

    if (action === 'mute_1h') {
        await muteStoreGraceAlert(storeId, 1);
        showInfo('Alert Muted', `${storeName} due alert muted for 1 hour.`);
        return;
    }

    if (action === 'mute_24h') {
        await muteStoreGraceAlert(storeId, 24);
        showInfo('Alert Muted', `${storeName} due alert muted for 24 hours.`);
        return;
    }

    if (action === 'mute_custom') {
        const hours = promptMuteHours(storeName, lead, dueDate, pending);
        if (!hours) return;
        await muteStoreGraceAlert(storeId, hours);
        showInfo('Alert Muted', `${storeName} due alert muted for ${hours} hours.`);
        return;
    }

    const doMute = window.confirm(
        `[Store Due Alert]\n${storeName}\n${lead}\nDue Date: ${dueDate}\nPending: PKR ${pending}\n\nMute this alert for a specific time?`
    );
    if (!doMute) return;
    const hours = promptMuteHours(storeName, lead, dueDate, pending);
    if (!hours) return;
    await muteStoreGraceAlert(storeId, hours);
    showInfo('Alert Muted', `${storeName} due alert muted for ${hours} hours.`);
}

async function processPendingStoreGraceUrlAction() {
    try {
        const params = new URLSearchParams(window.location.search || '');
        const action = String(params.get('notification_action') || '').trim().toLowerCase();
        if (!action) return;

        const payload = {
            type: 'store-grace-alert-action',
            action,
            store_id: parseInt(String(params.get('store_id') || ''), 10),
            store_name: String(params.get('store_name') || '').trim(),
            due_date: String(params.get('due_date') || '').trim(),
            pending_amount: String(params.get('pending_amount') || '').trim(),
            days_left: String(params.get('days_left') || '').trim()
        };

        const cleanUrl = `${window.location.pathname}${window.location.hash || ''}`;
        window.history.replaceState({}, document.title, cleanUrl);
        await handleStoreGraceNotificationActionMessage(payload);
    } catch (error) {
        console.warn('Failed to process pending store grace URL action:', error);
    }
}

window._adminDiag = window._adminDiag || {};
window._adminDiag.getNotificationDebug = function () {
    return {
        secureContext: !!window.isSecureContext,
        hasNotificationApi: 'Notification' in window,
        permission: ('Notification' in window) ? Notification.permission : 'unsupported',
        hasServiceWorker: 'serviceWorker' in navigator,
        origin: window.location.origin
    };
};
window._adminDiag.testTrayNotification = async function () {
    try {
        if (!('Notification' in window)) return { ok: false, reason: 'Notification API unsupported' };
        if (Notification.permission === 'default') {
            try { await Notification.requestPermission(); } catch (_) {}
        }
        if (Notification.permission !== 'granted') {
            return { ok: false, reason: `Permission is ${Notification.permission}` };
        }
        const ok = await showStoreGraceSystemNotification(
            'ServeNow Tray Test',
            'If you see this in system tray, browser notifications are working.',
            0,
            () => { try { window.focus(); } catch (_) {} }
        );
        return { ok, ...window._adminDiag.getNotificationDebug() };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
};

async function muteStoreGraceAlert(storeId, hours = 24) {
    const sid = parseInt(String(storeId || ''), 10);
    if (!Number.isInteger(sid) || sid <= 0) return;
    await fetch(`${API_BASE}/api/stores/${sid}/grace-alert-mute`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ hours })
    });
}

async function unmuteStoreGraceAlert(storeId) {
    const sid = parseInt(String(storeId || ''), 10);
    if (!Number.isInteger(sid) || sid <= 0) return;
    await fetch(`${API_BASE}/api/stores/${sid}/grace-alert-mute`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ hours: 0, unmute: true })
    });
}

function promptMuteHours(storeName, lead, dueDate, pending) {
    const promptText =
        `[Store Due Alert]\n${storeName}\n${lead}\nDue Date: ${dueDate}\nPending: PKR ${pending}\n\n` +
        `Enter mute duration in hours (1 to 720):`;
    const raw = window.prompt(promptText, '24');
    if (raw === null) return null;
    const hours = parseInt(String(raw).trim(), 10);
    if (!Number.isFinite(hours) || hours <= 0) {
        showWarning('Invalid Duration', 'Please enter a valid number of hours.');
        return null;
    }
    return Math.min(24 * 30, Math.max(1, hours));
}

async function handleStoreUnmuteGraceAlert() {
    const sid = parseInt(String(AppState.editing.storeId || ''), 10);
    if (!Number.isInteger(sid) || sid <= 0) {
        showWarning('No Store Selected', 'Open a store in Edit mode to re-enable alerts.');
        return;
    }
    try {
        await unmuteStoreGraceAlert(sid);
        showSuccess('Alerts Re-enabled', 'Due alerts are active again for this store.');
    } catch (e) {
        console.error('Failed to re-enable store grace alerts', e);
        showError('Failed', 'Could not re-enable due alerts.');
    }
}

async function checkStoreGraceAlerts() {
    if (_storeGraceAlertBusy || !authToken) return;
    _storeGraceAlertBusy = true;
    try {
        const resp = await fetch(`${API_BASE}/api/stores/grace-alerts?channel=web`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await resp.json();
        if (!resp.ok || !data.success || !Array.isArray(data.alerts) || !data.alerts.length) return;
        const top = data.alerts[0];
        const storeName = top.store_name || `Store #${top.store_id}`;
        const dueDate = top.due_date || '-';
        const pending = Number(top.pending_amount || 0).toFixed(2);
        const daysLeft = Number(top.days_left);
        const lead =
            Number.isFinite(daysLeft) && daysLeft < 0
                ? `Overdue by ${Math.abs(daysLeft)} day(s)`
                : (Number.isFinite(daysLeft) ? `Due in ${daysLeft} day(s)` : 'Payment due');
        const body = `${storeName}\n${lead}\nDue Date: ${dueDate}\nPending: PKR ${pending}`;
        window.__lastStoreGraceAlert = {
            storeId: top.store_id,
            storeName,
            dueDate,
            pending,
            daysLeft
        };
        let shownBySystemTray = false;
        try {
            if ('Notification' in window) {
                if (Notification.permission === 'default' && !_storeGracePermissionRequested) {
                    _storeGracePermissionRequested = true;
                    try { await Notification.requestPermission(); } catch (_) {}
                }
                if (Notification.permission === 'granted') {
                    shownBySystemTray = await showStoreGraceSystemNotification(
                        'Store Due Alert',
                        body,
                        top.store_id,
                        () => handleStoreGraceNotificationActionMessage({
                            type: 'store-grace-alert-action',
                            action: 'open',
                            store_id: top.store_id,
                            store_name: storeName,
                            due_date: dueDate,
                            pending_amount: pending,
                            days_left: daysLeft
                        })
                    );
                }
            }
        } catch (_) {}
        if (shownBySystemTray) {
            // Keep an in-app visible trace as well, so behavior looks consistent
            // whether browser tray is enabled or blocked by OS/browser policy.
            showInfo('Store Due Alert', `${storeName}: ${lead} (Due ${dueDate})`);
        } else {
            showWarning('Store Due Alert', `${storeName}: ${lead} (Due ${dueDate})`);
        }
    } catch (e) {
        console.warn('Store grace alert check failed', e);
    } finally {
        _storeGraceAlertBusy = false;
    }
}

function startStoreGraceAlertsPolling() {
    if (_storeGraceAlertTimer) {
        clearInterval(_storeGraceAlertTimer);
        _storeGraceAlertTimer = null;
    }
    try {
        if ('Notification' in window && Notification.permission === 'default' && !_storeGracePermissionRequested) {
            _storeGracePermissionRequested = true;
            Notification.requestPermission().catch(() => {});
        }
        if ('Notification' in window && Notification.permission === 'granted') {
            ensureAdminNotificationSw().catch(() => {});
        }
    } catch (_) {}
    checkStoreGraceAlerts();
    _storeGraceAlertTimer = setInterval(checkStoreGraceAlerts, 30 * 60 * 1000);
}

function roundToNearest10(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n / 5) * 5;
}

function isManualCostMode() {
    return !!document.getElementById('productManualCost')?.checked;
}

function isManualVariantCostMode() {
    return !!document.getElementById('productManualVariantCost')?.checked;
}

function updateVariantCostInputsReadonly() {
    const tbody = document.getElementById('productSizePricesBody');
    if (!tbody) return;
    const manual = isManualVariantCostMode();
    const costInputs = Array.from(tbody.querySelectorAll('input[data-role="variant-cost"]'));
    costInputs.forEach((input) => {
        input.readOnly = !manual;
        input.style.backgroundColor = manual ? '#ffffff' : '#f1f5f9';
    });
}

function recalcProductCost() {
    const priceEl = document.getElementById('productPrice');
    const costEl = document.getElementById('productCostPrice');
    const storeEl = document.getElementById('productStore');
    const discountRow = document.getElementById('productDiscountRow');
    const discountTypeEl = document.getElementById('productDiscountType');
    const discountValueEl = document.getElementById('productDiscountValue');
    const profitRow = document.getElementById('productProfitRow');
    const profitTypeEl = document.getElementById('productProfitType');
    const profitValueEl = document.getElementById('productProfitValue');
    if (!priceEl || !costEl || !storeEl) return;

    const term = AppState.productStoreTermsById[String(storeEl.value || '')] || '';
    const enforcedStoreDiscount = getStoreDiscountOverride(storeEl.value || '');
    const hasDiscount = isDiscountPaymentTerm(term);
    const hasProfit = isProfitPaymentTerm(term);
    if (discountRow) discountRow.style.display = hasDiscount ? '' : 'none';
    if (hasDiscount && enforcedStoreDiscount) {
        if (discountTypeEl) {
            discountTypeEl.value = 'percent';
            discountTypeEl.disabled = true;
        }
        if (discountValueEl) {
            discountValueEl.value = String(enforcedStoreDiscount.value);
            discountValueEl.readOnly = true;
            discountValueEl.style.backgroundColor = '#f1f5f9';
        }
    } else {
        if (discountTypeEl) discountTypeEl.disabled = false;
        if (discountValueEl) {
            discountValueEl.readOnly = false;
            discountValueEl.style.backgroundColor = '#ffffff';
        }
    }
    if (profitRow) profitRow.style.display = hasProfit ? '' : 'none';

    const rawPrice = String(priceEl.value || '').trim();
    const price = rawPrice.length ? parseFloat(rawPrice) : NaN;
    if (!Number.isFinite(price) || price < 0) {
        return;
    }

    if (isManualCostMode()) {
        if (costEl) {
            costEl.readOnly = false;
            costEl.style.backgroundColor = '#ffffff';
        }
        return;
    }

    let cost = price;
    if (hasDiscount) {
        if (enforcedStoreDiscount) {
            if (discountTypeEl) {
                discountTypeEl.value = 'percent';
                discountTypeEl.disabled = true;
            }
            if (discountValueEl) {
                discountValueEl.value = String(enforcedStoreDiscount.value);
                discountValueEl.readOnly = true;
                discountValueEl.style.backgroundColor = '#f1f5f9';
            }
        } else {
            if (discountTypeEl) discountTypeEl.disabled = false;
            if (discountValueEl) {
                discountValueEl.readOnly = false;
                discountValueEl.style.backgroundColor = '#ffffff';
            }
        }
        const dtype = String(discountTypeEl?.value || 'amount');
        const rawD = String(discountValueEl?.value || '').trim();
        const dval = rawD.length ? parseFloat(rawD) : NaN;
        if (Number.isFinite(dval) && dval > 0) {
            const disc = dtype === 'percent' ? (price * dval / 100) : dval;
            cost = price - disc;
        }
        if (profitValueEl) profitValueEl.value = '';
    } else if (hasProfit) {
        if (discountTypeEl) discountTypeEl.disabled = false;
        if (discountValueEl) {
            discountValueEl.readOnly = false;
            discountValueEl.style.backgroundColor = '#ffffff';
        }
        const pType = String(profitTypeEl?.value || 'amount').toLowerCase() === 'percent' ? 'percent' : 'amount';
        const rawP = String(profitValueEl?.value || '').trim();
        const pval = rawP.length ? parseFloat(rawP) : NaN;
        if (Number.isFinite(pval) && pval > 0) {
            const profitAmount = pType === 'percent' ? (price * pval / 100) : pval;
            cost = price - profitAmount;
        }
        if (discountValueEl) discountValueEl.value = '';
        if (discountTypeEl) discountTypeEl.value = 'amount';
    } else {
        if (discountTypeEl) discountTypeEl.disabled = false;
        if (discountValueEl) {
            discountValueEl.readOnly = false;
            discountValueEl.style.backgroundColor = '#ffffff';
        }
        if (discountValueEl) discountValueEl.value = '';
        if (discountTypeEl) discountTypeEl.value = 'amount';
        if (profitValueEl) profitValueEl.value = '';
    }

    if (!Number.isFinite(cost) || cost < 0) cost = 0;
    cost = roundToNearest10(cost);
    if (isCashOnlyPaymentTerm(term) && String(profitTypeEl?.value || 'amount').toLowerCase() === 'percent') {
        priceEl.value = String(roundToNearest10(price));
    }
    costEl.readOnly = true;
    costEl.style.backgroundColor = '#f1f5f9';
    costEl.value = (Math.round(cost * 100) / 100).toFixed(2);
    try { recalcVariantCosts(); } catch (e) {}
}

function computeCostForPrice(price) {
    const storeEl = document.getElementById('productStore');
    const discountTypeEl = document.getElementById('productDiscountType');
    const discountValueEl = document.getElementById('productDiscountValue');
    const profitTypeEl = document.getElementById('productProfitType');
    const profitValueEl = document.getElementById('productProfitValue');
    const term = AppState.productStoreTermsById[String(storeEl?.value || '')] || '';
    const hasDiscount = isDiscountPaymentTerm(term);
    const hasProfit = isProfitPaymentTerm(term);

    let cost = Number(price);
    if (!Number.isFinite(cost) || cost < 0) return null;
    if (hasDiscount) {
        const dtype = String(discountTypeEl?.value || 'amount');
        const rawD = String(discountValueEl?.value || '').trim();
        const dval = rawD.length ? parseFloat(rawD) : NaN;
        if (Number.isFinite(dval) && dval > 0) {
            const disc = dtype === 'percent' ? (cost * dval / 100) : dval;
            cost = cost - disc;
        }
    } else if (hasProfit) {
        const pType = String(profitTypeEl?.value || 'amount').toLowerCase() === 'percent' ? 'percent' : 'amount';
        const rawP = String(profitValueEl?.value || '').trim();
        const pval = rawP.length ? parseFloat(rawP) : NaN;
        if (Number.isFinite(pval) && pval > 0) {
            const profitAmount = pType === 'percent' ? (cost * pval / 100) : pval;
            cost = cost - profitAmount;
        }
    }
    if (!Number.isFinite(cost) || cost < 0) cost = 0;
    cost = roundToNearest10(cost);
    return Math.round(cost * 100) / 100;
}

function recalcVariantCosts() {
    if (isManualCostMode() || isManualVariantCostMode()) return;
    const cb = document.getElementById('productHasSizePrices');
    if (!cb || !cb.checked) return;
    const tbody = document.getElementById('productSizePricesBody');
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll('tr'));
    for (const row of rows) {
        const priceEl = row.querySelector('input[data-role="size-price-price"]');
        const costEl = row.querySelector('input[data-role="variant-cost"]');
        if (!costEl) continue;
        const price = priceEl ? parseFloat(String(priceEl.value || '').trim()) : NaN;
        if (!Number.isFinite(price) || price < 0) {
            costEl.value = '';
            continue;
        }
        const computed = computeCostForPrice(price);
        costEl.value = computed === null ? '' : computed.toFixed(2);
    }
}

function bindProductPriceCalc() {
    const formEl = document.getElementById('addProductForm');
    if (!formEl || formEl.dataset.boundPriceCalc) return;
    formEl.dataset.boundPriceCalc = '1';
    ['productStore', 'productPrice', 'productDiscountType', 'productDiscountValue', 'productProfitType', 'productProfitValue', 'productManualCost', 'productManualVariantCost'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('change', recalcProductCost);
        el.addEventListener('input', recalcProductCost);
    });
    const variantManualEl = document.getElementById('productManualVariantCost');
    if (variantManualEl && !variantManualEl.dataset.boundVariantManual) {
        variantManualEl.addEventListener('change', () => {
            updateVariantCostInputsReadonly();
            if (!isManualVariantCostMode()) {
                try { recalcVariantCosts(); } catch (e) {}
            }
        });
        variantManualEl.dataset.boundVariantManual = '1';
    }
}

function getProductMeasureMode() {
    const sizeRadio = document.getElementById('productMeasureModeSize');
    const unitRadio = document.getElementById('productMeasureModeUnit');
    if (sizeRadio && sizeRadio.checked) return 'size';
    if (unitRadio && unitRadio.checked) return 'unit';
    return 'unit';
}

function applyProductMeasureMode(mode) {
    const unitSelect = document.getElementById('productUnit');
    const sizeSelect = document.getElementById('productSize');
    const unitRadio = document.getElementById('productMeasureModeUnit');
    const sizeRadio = document.getElementById('productMeasureModeSize');
    const variantsHeader = document.getElementById('productVariantsMeasureHeader');
    const variantsToggleText = document.getElementById('productVariantsToggleText');
    const variantsSectionTitle = document.getElementById('productVariantsSectionTitle');
    const addVariantBtn = document.getElementById('addSizePriceBtn');
    const useVariants = !!document.getElementById('productHasSizePrices')?.checked;
    const m = String(mode || '').toLowerCase() === 'size' ? 'size' : 'unit';
    if (unitRadio) unitRadio.checked = m === 'unit';
    if (sizeRadio) sizeRadio.checked = m === 'size';

    if (variantsHeader) variantsHeader.textContent = m === 'size' ? 'Size' : 'Unit';
    if (variantsToggleText) variantsToggleText.textContent = m === 'size' ? 'Multiple sizes / prices' : 'Multiple units / prices';
    if (variantsSectionTitle) variantsSectionTitle.textContent = m === 'size' ? 'Size prices:' : 'Unit prices:';
    if (addVariantBtn) addVariantBtn.textContent = m === 'size' ? 'Add Size Price' : 'Add Unit Price';

    if (useVariants) {
        if (unitSelect) { unitSelect.disabled = true; unitSelect.value = ''; }
        if (sizeSelect) { sizeSelect.disabled = true; sizeSelect.value = ''; }
    } else {
        if (unitSelect) unitSelect.disabled = m !== 'unit';
        if (sizeSelect) sizeSelect.disabled = m !== 'size';
        if (m === 'unit' && sizeSelect) sizeSelect.value = '';
        if (m === 'size' && unitSelect) unitSelect.value = '';
    }

    try { refreshProductSizePriceRowOptions(); } catch (e) {}
}

function syncProductMeasureModeFromValues() {
    const unitSelect = document.getElementById('productUnit');
    const sizeSelect = document.getElementById('productSize');
    const hasUnit = !!(unitSelect && String(unitSelect.value || '').trim());
    const hasSize = !!(sizeSelect && String(sizeSelect.value || '').trim());
    if (hasSize) applyProductMeasureMode('size');
    else if (hasUnit) applyProductMeasureMode('unit');
    else {
        const unitRadio = document.getElementById('productMeasureModeUnit');
        const sizeRadio = document.getElementById('productMeasureModeSize');
        if (sizeRadio && sizeRadio.checked) applyProductMeasureMode('size');
        else if (unitRadio && unitRadio.checked) applyProductMeasureMode('unit');
        else applyProductMeasureMode('unit');
    }
}

function bindProductMeasureMode() {
    const formEl = document.getElementById('addProductForm');
    if (!formEl || formEl.dataset.boundMeasureMode) return;
    formEl.dataset.boundMeasureMode = '1';
    const unitRadio = document.getElementById('productMeasureModeUnit');
    const sizeRadio = document.getElementById('productMeasureModeSize');
    if (unitRadio) unitRadio.addEventListener('change', () => { if (unitRadio.checked) applyProductMeasureMode('unit'); });
    if (sizeRadio) sizeRadio.addEventListener('change', () => { if (sizeRadio.checked) applyProductMeasureMode('size'); });
    const unitSelect = document.getElementById('productUnit');
    const sizeSelect = document.getElementById('productSize');
    if (unitSelect) unitSelect.addEventListener('change', () => { if (unitSelect.value) applyProductMeasureMode('unit'); });
    if (sizeSelect) sizeSelect.addEventListener('change', () => { if (sizeSelect.value) applyProductMeasureMode('size'); });
    syncProductMeasureModeFromValues();
}

function collectProductSizePrices() {
    const tbody = document.getElementById('productSizePricesBody');
    const out = [];
    const seen = new Set();
    if (!tbody) return out;
    const manualVariantMode = isManualVariantCostMode();
    const mode = getProductMeasureMode();
    const rows = Array.from(tbody.querySelectorAll('tr'));
    for (const row of rows) {
        const measureEl = row.querySelector('select[data-role="variant-measure"]');
        const priceEl = row.querySelector('input[data-role="size-price-price"]');
        const costEl = row.querySelector('input[data-role="variant-cost"]');
        const measureId = measureEl ? parseInt(String(measureEl.value || ''), 10) : NaN;
        const price = priceEl ? parseFloat(String(priceEl.value || '').trim()) : NaN;
        const cost = costEl ? parseFloat(String(costEl.value || '').trim()) : NaN;
        if (!Number.isInteger(measureId) || measureId <= 0) continue;
        if (!Number.isFinite(price) || price < 0) continue;
        const key = `${mode}:${measureId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const rounded = Math.round(price * 100) / 100;
        const costRounded = Number.isFinite(cost) && cost >= 0 ? (Math.round(cost * 100) / 100) : undefined;
        if (mode === 'size') {
            const payload = { size_id: measureId, price: rounded };
            if (manualVariantMode && costRounded !== undefined) payload.cost_price = costRounded;
            out.push(payload);
        } else {
            const payload = { unit_id: measureId, price: rounded };
            if (manualVariantMode && costRounded !== undefined) payload.cost_price = costRounded;
            out.push(payload);
        }
    }
    return out;
}

function computeMinPrice(variants) {
    let min = null;
    for (const v of variants || []) {
        const p = Number(v && v.price);
        if (!Number.isFinite(p) || p < 0) continue;
        if (min === null || p < min) min = p;
    }
    return min;
}

function syncProductPriceFromSizePrices() {
    const cb = document.getElementById('productHasSizePrices');
    const priceEl = document.getElementById('productPrice');
    if (!cb || !priceEl) return;
    if (!cb.checked) {
        priceEl.readOnly = false;
        return;
    }
    const variants = collectProductSizePrices();
    const min = computeMinPrice(variants);
    if (min !== null) {
        priceEl.value = String(min);
    } else {
        priceEl.value = '';
    }
    priceEl.readOnly = true;
    try { recalcProductCost(); } catch (e) {}
}

function setProductSizePricesEnabled(enabled) {
    const cb = document.getElementById('productHasSizePrices');
    const section = document.getElementById('productSizePricesSection');
    const single = document.getElementById('productSingleMeasureSection');
    const singleSelectors = document.getElementById('productSingleMeasureSelectorsRow');
    const tbody = document.getElementById('productSizePricesBody');
    if (cb) cb.checked = !!enabled;
    if (section) section.style.display = enabled ? '' : 'none';
    if (single) single.style.display = '';
    if (singleSelectors) singleSelectors.style.display = enabled ? 'none' : '';
    if (!enabled && tbody) tbody.innerHTML = '';
    const manualVariantEl = document.getElementById('productManualVariantCost');
    if (!enabled && manualVariantEl) manualVariantEl.checked = false;
    try { applyProductMeasureMode(getProductMeasureMode()); } catch (e) {}
    updateVariantCostInputsReadonly();
    syncProductPriceFromSizePrices();
}

function addProductSizePriceRow(prefill) {
    const tbody = document.getElementById('productSizePricesBody');
    if (!tbody) return;
    const mode = getProductMeasureMode();
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td></td>
        <td></td>
        <td></td>
        <td></td>
    `;
    const measureTd = tr.children[0];
    const priceTd = tr.children[1];
    const costTd = tr.children[2];
    const actionTd = tr.children[3];

    const measureSelect = document.createElement('select');
    measureSelect.setAttribute('data-role', 'variant-measure');
    measureSelect.style.minWidth = '170px';
    measureSelect.style.width = '100%';
    if (mode === 'size') {
        measureSelect.innerHTML = '<option value="">Select Size</option>' + (AppState.sizes || []).map(s => `<option value="${s.id}">${s.label}</option>`).join('');
        if (prefill && prefill.size_id) measureSelect.value = String(prefill.size_id);
    } else {
        measureSelect.innerHTML = '<option value="">Select Unit</option>' + (AppState.units || []).map(u => `<option value="${u.id}">${u.name}${u.abbreviation ? ' ('+u.abbreviation+')' : ''}</option>`).join('');
        if (prefill && prefill.unit_id) measureSelect.value = String(prefill.unit_id);
    }

    const priceInput = document.createElement('input');
    priceInput.type = 'number';
    priceInput.min = '0';
    priceInput.step = '0.01';
    priceInput.setAttribute('data-role', 'size-price-price');
    priceInput.style.width = '130px';
    priceInput.value = (prefill && prefill.price !== undefined && prefill.price !== null) ? String(prefill.price) : '';

    const costInput = document.createElement('input');
    costInput.type = 'number';
    costInput.min = '0';
    costInput.step = '0.01';
    costInput.readOnly = !isManualVariantCostMode();
    costInput.setAttribute('data-role', 'variant-cost');
    costInput.style.width = '130px';
    costInput.style.backgroundColor = isManualVariantCostMode() ? '#ffffff' : '#f1f5f9';
    costInput.value = (prefill && prefill.cost_price !== undefined && prefill.cost_price !== null) ? String(prefill.cost_price) : '';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-small btn-secondary';
    removeBtn.innerHTML = '<i class="fas fa-trash"></i>';
    removeBtn.title = 'Remove row';
    removeBtn.style.padding = '0.2rem 0.45rem';
    removeBtn.style.minWidth = 'auto';
    removeBtn.addEventListener('click', () => {
        tr.remove();
        syncProductPriceFromSizePrices();
    });

    measureSelect.addEventListener('change', syncProductPriceFromSizePrices);
    priceInput.addEventListener('input', syncProductPriceFromSizePrices);

    measureTd.appendChild(measureSelect);
    priceTd.appendChild(priceInput);
    costTd.appendChild(costInput);
    const actions = document.createElement('div');
    actions.className = 'action-buttons';
    actions.appendChild(removeBtn);
    actionTd.appendChild(actions);
    tbody.appendChild(tr);
    updateVariantCostInputsReadonly();
    syncProductPriceFromSizePrices();
}

function refreshProductSizePriceRowOptions() {
    const tbody = document.getElementById('productSizePricesBody');
    if (!tbody) return;
    const mode = getProductMeasureMode();
    const selects = Array.from(tbody.querySelectorAll('select[data-role="variant-measure"]'));
    for (const sel of selects) {
        const selected = String(sel.value || '');
        if (mode === 'size') {
            sel.innerHTML = '<option value="">Select Size</option>' + (AppState.sizes || []).map(s => `<option value="${s.id}">${s.label}</option>`).join('');
        } else {
            sel.innerHTML = '<option value="">Select Unit</option>' + (AppState.units || []).map(u => `<option value="${u.id}">${u.name}${u.abbreviation ? ' ('+u.abbreviation+')' : ''}</option>`).join('');
        }
        if (selected) sel.value = selected;
    }
}

function resetProductSizePricesUI() {
    const cb = document.getElementById('productHasSizePrices');
    const tbody = document.getElementById('productSizePricesBody');
    if (tbody) tbody.innerHTML = '';
    if (cb) cb.checked = true;
    setProductSizePricesEnabled(true);
    if (tbody && !tbody.querySelector('tr')) addProductSizePriceRow({});
}

function bindProductSizePricesUI() {
    const formEl = document.getElementById('addProductForm');
    if (!formEl || formEl.dataset.boundSizePrices) return;
    formEl.dataset.boundSizePrices = '1';
    const cb = document.getElementById('productHasSizePrices');
    const addBtn = document.getElementById('addSizePriceBtn');
    if (cb) {
        cb.addEventListener('change', () => {
            setProductSizePricesEnabled(cb.checked);
            if (cb.checked) {
                const existing = collectProductSizePrices();
                if (!existing.length) addProductSizePriceRow({});
            }
        });
    }
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            if (cb && !cb.checked) setProductSizePricesEnabled(true);
            addProductSizePriceRow({});
        });
    }
}

function _renderProductItemOptions(itemSelect, products, selectedId = '') {
    if (!itemSelect) return;
    itemSelect.innerHTML = '<option value="">None</option>';
    (products || []).forEach(p => {
        const label = p.category_name ? `${p.name} - ${p.category_name}` : p.name;
        itemSelect.innerHTML += `<option value="${p.id}">${label}</option>`;
    });
    if (selectedId !== undefined && selectedId !== null && String(selectedId).trim().length) {
        itemSelect.value = String(selectedId);
    }
}

async function ensureProductItemCatalog(itemSelect, selectedId = '') {
    const loadingHint = document.getElementById('productItemLoadingHint');
    const now = Date.now();
    const cacheFresh = (now - Number(AppState.productItemCatalog.loadedAt || 0)) < PRODUCT_ITEM_CATALOG_TTL_MS
        && Array.isArray(AppState.productItemCatalog.products)
        && AppState.productItemCatalog.products.length > 0;

    if (cacheFresh) {
        if (loadingHint) loadingHint.style.display = 'none';
        _renderProductItemOptions(itemSelect, AppState.productItemCatalog.products, selectedId);
        return AppState.productItemCatalog.byId || {};
    }

    if (itemSelect) {
        itemSelect.disabled = true;
        itemSelect.innerHTML = '<option value="">Loading items...</option>';
    }
    if (loadingHint) {
        loadingHint.textContent = 'Loading items...';
        loadingHint.style.display = 'block';
    }

    try {
        const response = await fetch(
            `${API_BASE}/api/products?admin=1&include_variants=0&include_image_variants=0`,
            { headers: { 'Authorization': `Bearer ${authToken}` } }
        );
        const data = await response.json();
        const products = (data && data.success && Array.isArray(data.products)) ? data.products : [];
        const byId = {};
        products.forEach(p => { byId[p.id] = p; });

        AppState.productItemCatalog = {
            loadedAt: Date.now(),
            products,
            byId
        };

        if (itemSelect) {
            itemSelect.disabled = false;
            _renderProductItemOptions(itemSelect, products, selectedId);
        }
        if (loadingHint) loadingHint.style.display = 'none';
        return byId;
    } catch (e) {
        if (itemSelect) {
            itemSelect.disabled = false;
            itemSelect.innerHTML = '<option value="">None</option>';
        }
        if (loadingHint) {
            loadingHint.textContent = 'Could not load items';
            loadingHint.style.display = 'block';
        }
        throw e;
    }
}

// Product Management Functions
async function showAddProductModal() {
    // Load stores and categories for dropdowns
    try {
        const [storesResponse, categoriesResponse, unitsResp, sizesResp] = await Promise.all([
            fetch(`${API_BASE}/api/stores?lite=1`),
            fetch(`${API_BASE}/api/categories?includeInactive=true&ts=${Date.now()}`, { cache: 'no-store' }),
            fetch(`${API_BASE}/api/units?ts=${Date.now()}`, { headers: { 'Authorization': `Bearer ${authToken}` }, cache: 'no-store' }),
            fetch(`${API_BASE}/api/sizes?ts=${Date.now()}`, { headers: { 'Authorization': `Bearer ${authToken}` }, cache: 'no-store' })
        ]);

        const storesData = await storesResponse.json();
        const categoriesData = await categoriesResponse.json();
        const productsData = { success: false, products: [] };

        // Populate store dropdown
        const storeSelect = document.getElementById('productStore');
        storeSelect.innerHTML = '<option value="">Select Store</option>';
        if (storesData.success) {
            storesData.stores.forEach(store => {
                storeSelect.innerHTML += `<option value="${store.id}">${store.name}</option>`;
            });
        }
        setProductStoreTerms((storesData && storesData.stores) || []);
        bindProductPriceCalc();

        // Populate category dropdown
        const categorySelect = document.getElementById('productCategory');
        categorySelect.innerHTML = '<option value="">Select Category (Optional)</option>';
        if (categoriesData.success) {
            categoriesData.categories.forEach(category => {
                categorySelect.innerHTML += `<option value="${category.id}">${category.name}</option>`;
            });
        }

        const itemSelect = document.getElementById('productItem');
        let applyItemSelection = null;
        if (itemSelect) {
            // build map for quick lookup
            const productsById = {};
            if (productsData && productsData.success && Array.isArray(productsData.products)) {
                itemSelect.innerHTML = '<option value="">None</option>';
                productsData.products.forEach(p => {
                    productsById[p.id] = p;
                    const label = p.category_name ? `${p.name} — ${p.category_name}` : p.name;
                    itemSelect.innerHTML += `<option value="${p.id}">${label}</option>`;
                });
            }
            const nameEl = document.getElementById('productName');
            const descEl = document.getElementById('productDescription');
            const unitSel = document.getElementById('productUnit');
            const sizeSel = document.getElementById('productSize');
            const catSel = document.getElementById('productCategory');
            const priceEl = document.getElementById('productPrice');

            applyItemSelection = (val) => {
                const usingItem = !!val;
                if (nameEl) { nameEl.readOnly = usingItem; nameEl.required = !usingItem; }
                if (descEl) { descEl.readOnly = usingItem; }
                // Keep image fields enabled to allow store-specific overrides even when using catalog item
                // if (imgUrlEl) { imgUrlEl.disabled = usingItem; if (usingItem) imgUrlEl.value = ''; }
                // if (fileEl) { fileEl.disabled = usingItem; if (usingItem) { try { fileEl.value = ''; } catch(e){} } }

                if (usingItem && productsById[val]) {
                    const p = productsById[val];
                    if (nameEl) nameEl.value = p.name || '';
                    if (descEl) descEl.value = p.description || '';
                    if (catSel && p.category_id) catSel.value = p.category_id;
                    if (unitSel && p.unit_id) unitSel.value = p.unit_id;
                    if (sizeSel && p.size_id) sizeSel.value = p.size_id;
                    if (priceEl && p.price !== undefined && p.price !== null) priceEl.value = p.price;
                } else {
                    if (nameEl) nameEl.value = nameEl.value || '';
                    if (descEl) descEl.value = descEl.value || '';
                }
                try { syncProductMeasureModeFromValues(); } catch (e) {}
                try { recalcProductCost(); } catch (e) {}
            };

            itemSelect.onfocus = async () => {
                if (!itemSelect.options || itemSelect.options.length <= 1) {
                    try { Object.assign(productsById, await ensureProductItemCatalog(itemSelect)); } catch (e) {}
                }
                itemSelect.onfocus = null;
            };
            itemSelect.onclick = async () => {
                if (!itemSelect.options || itemSelect.options.length <= 1) {
                    try { Object.assign(productsById, await ensureProductItemCatalog(itemSelect)); } catch (e) {}
                }
                itemSelect.onclick = null;
            };
            itemSelect.onchange = async (e) => {
                const val = String(e.target.value || '');
                if (val && !productsById[val]) {
                    try { Object.assign(productsById, await ensureProductItemCatalog(itemSelect)); } catch (err) {}
                }
                applyItemSelection(val);
            };
            applyItemSelection(itemSelect.value);
        }

        

        bindProductSizePricesUI();
        resetProductSizePricesUI();

        // Populate units and sizes
        // Note: unitsResp and sizesResp are already fetched above
        try {
            // Use results from Promise.all above instead of fetching again
            const unitsJson = await unitsResp.json();
            const sizesJson = await sizesResp.json();
            if (unitsJson && unitsJson.success && Array.isArray(unitsJson.units)) AppState.units = unitsJson.units;
            if (sizesJson && sizesJson.success && Array.isArray(sizesJson.sizes)) AppState.sizes = sizesJson.sizes;
            refreshProductSizePriceRowOptions();

            const unitSelect = document.getElementById('productUnit');
            if (unitSelect) {
                unitSelect.innerHTML = '<option value="">Select Unit (Optional)</option>';
                if (unitsJson && unitsJson.success && Array.isArray(unitsJson.units)) {
                    unitsJson.units.forEach(u => unitSelect.innerHTML += `<option value="${u.id}">${u.name}${u.abbreviation ? ' ('+u.abbreviation+')' : ''}</option>`);
                }
            }

            const sizeSelect = document.getElementById('productSize');
            if (sizeSelect) {
                sizeSelect.innerHTML = '<option value="">Select Size (Optional)</option>';
                if (sizesJson && sizesJson.success && Array.isArray(sizesJson.sizes)) {
                    sizesJson.sizes.forEach(s => sizeSelect.innerHTML += `<option value="${s.id}">${s.label}</option>`);
                }
            }
        } catch (e) {
            console.warn('Failed to load units/sizes for product form', e);
        }

        try {
            bindProductMeasureMode();
            if (typeof applyItemSelection === 'function') {
                const itemSelect2 = document.getElementById('productItem');
                if (itemSelect2) applyItemSelection(itemSelect2.value);
            }
            syncProductMeasureModeFromValues();
        } catch (e) {}

        try {
            const modal = document.getElementById('addProductModal');
            if (modal) {
                const titleEl = modal.querySelector('.modal-header h3');
                if (titleEl) titleEl.textContent = 'Add New Product';
                const saveBtn = modal.querySelector('#saveProductBtn');
                if (saveBtn) saveBtn.textContent = 'Save Product';
            }
        } catch (e) {}
        try {
            const costEl = document.getElementById('productCostPrice');
            const priceEl = document.getElementById('productPrice');
            if (costEl) costEl.value = '';
            if (priceEl) priceEl.value = '';
            const discountTypeEl = document.getElementById('productDiscountType');
            const discountValueEl = document.getElementById('productDiscountValue');
            const profitTypeEl = document.getElementById('productProfitType');
            const profitValueEl = document.getElementById('productProfitValue');
            const manualCostEl = document.getElementById('productManualCost');
            const manualVariantCostEl = document.getElementById('productManualVariantCost');
            if (discountTypeEl) discountTypeEl.value = 'amount';
            if (profitTypeEl) profitTypeEl.value = 'amount';
            if (discountValueEl) discountValueEl.value = '';
            if (profitValueEl) profitValueEl.value = '';
            if (manualCostEl) manualCostEl.checked = false;
            if (manualVariantCostEl) manualVariantCostEl.checked = false;
            recalcProductCost();
            updateVariantCostInputsReadonly();
        } catch (e) {}
        showModal('addProductModal');
        const fileInput = document.getElementById('productImageFile');
        const preview = document.getElementById('productImagePreview');

        if (fileInput) {
            fileInput.onchange = (e) => {
                const file = e.target.files && e.target.files[0];
                if (file && preview) {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        preview.src = ev.target.result;
                        preview.style.display = 'inline-block';
                        applyOrientationFitAdmin(preview);
                    };
                    reader.readAsDataURL(file);
                }
            };
        }

    } catch (error) {
        console.error('Error loading dropdown data:', error);
        showError('Error', 'Failed to load form data');
    }
}

async function saveProduct() {
    // Permission check
    if (currentUser.user_type !== 'admin' && !currentUserPermissions.has('action_manage_products')) {
        showError('Access Denied', 'You do not have permission to manage products.');
        return;
    }

    const formEl = document.getElementById('addProductForm');
    const formData = new FormData(formEl);
    const rawStoreId = formData.get('store_id');
    const rawName = (formData.get('name') || '').trim();
    const rawItemId = formData.get('item_id') || '';
    const fallbackStoreId = parseInt(String(AppState?.editing?.productStoreId || ''), 10);
    const parsedStoreId = parseInt(rawStoreId, 10);
    const storeId = Number.isInteger(parsedStoreId) && parsedStoreId > 0
        ? parsedStoreId
        : (Number.isInteger(fallbackStoreId) && fallbackStoreId > 0 ? fallbackStoreId : NaN);
    const usingTemplate = !!rawItemId;
    const rawPrice = String(formData.get('price') || '').trim();
    const priceVal = rawPrice.length ? parseFloat(rawPrice) : NaN;
    const useSizePrices = !!document.getElementById('productHasSizePrices')?.checked;
    const sizeVariants = useSizePrices ? collectProductSizePrices() : [];
    const minVariantPrice = useSizePrices ? computeMinPrice(sizeVariants) : null;
    const effectivePriceVal = useSizePrices ? minVariantPrice : priceVal;

    if (!Number.isInteger(storeId) || storeId <= 0) {
        showError('Invalid Input', 'Please select a store');
        return;
    }
    if (!usingTemplate && rawName.length < 2) {
        showError('Invalid Input', 'Please enter a product name or choose an existing product');
        return;
    }
    if (useSizePrices && !sizeVariants.length) {
        showError('Invalid Input', 'Please add at least one size price');
        return;
    }
    if (!Number.isFinite(effectivePriceVal) || effectivePriceVal < 0) {
        showError('Invalid Input', 'Please enter a valid price');
        return;
    }
    try {
        const priceEl = document.getElementById('productPrice');
        if (priceEl && useSizePrices) priceEl.value = String(effectivePriceVal);
    } catch (e) {}
    if (!isManualCostMode()) {
        try { recalcProductCost(); } catch (e) {}
    }
    const finalCostVal = parseFloat(String(document.getElementById('productCostPrice')?.value || '').trim());
    if (!Number.isFinite(finalCostVal) || finalCostVal < 0) {
        showError('Invalid Input', 'Unable to calculate a valid cost price');
        return;
    }

    const productData = {
        name: rawName,
        description: formData.get('description'),
        category_id: formData.get('category_id') || null,
        store_id: storeId,
        stock_quantity: parseInt(formData.get('stock_quantity'), 10) || 0,
        unit_id: formData.get('unit_id') || null,
        size_id: formData.get('size_id') || null,
        price: effectivePriceVal
    };
    if (useSizePrices) {
        productData.size_variants = sizeVariants;
        productData.unit_id = null;
        productData.size_id = null;
    } else {
        const modeRaw = String(formData.get('product_measure_mode') || '').trim().toLowerCase();
        if (modeRaw === 'size') productData.unit_id = null;
        else if (modeRaw === 'unit') productData.size_id = null;
        else if (productData.size_id) productData.unit_id = null;
    }
    productData.cost_price = finalCostVal;
    productData.manual_cost_override = isManualCostMode();
    productData.manual_variant_cost_override = useSizePrices ? isManualVariantCostMode() : false;
    const storeTerm = AppState.productStoreTermsById[String(storeId)] || '';
    const enforcedStoreDiscount = getStoreDiscountOverride(storeId);
    const hasDiscountTerm = isDiscountPaymentTerm(storeTerm);
    const hasProfitTerm = isProfitPaymentTerm(storeTerm);
    const discountType = String(formData.get('discount_type') || '').trim();
    const discountValueRaw = String(formData.get('discount_value') || '').trim();
    const profitValueRaw = String(formData.get('profit_value') || '').trim();
    if (hasDiscountTerm) {
        if (enforcedStoreDiscount) {
            productData.discount_type = 'percent';
            productData.discount_value = Number(enforcedStoreDiscount.value);
        } else {
            if (discountType) productData.discount_type = discountType;
            if (discountValueRaw.length) productData.discount_value = parseFloat(discountValueRaw);
        }
    }
    if (hasProfitTerm && profitValueRaw.length) {
        productData.profit_type = String(formData.get('profit_type') || 'amount').trim().toLowerCase() === 'percent' ? 'percent' : 'amount';
        productData.profit_value = parseFloat(profitValueRaw);
    }
    if (isManualCostMode() && Number.isFinite(finalCostVal) && Number.isFinite(effectivePriceVal) && finalCostVal > effectivePriceVal) {
        const proceed = confirm('Cost Price is greater than Sale Price. This can create negative margin in financial reports. Do you want to continue?');
        if (!proceed) return;
    }

    // If a file was selected, upload it first to server to get back a public URL and variants
    const fileInput = document.getElementById('productImageFile');
    if (fileInput && fileInput.files && fileInput.files.length > 0) {
        try {
            const fd = new FormData();
            fd.append('image', fileInput.files[0]);
            const upRes = await fetch(`${API_BASE}/api/products/upload-image`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${authToken}` },
                body: fd
            });
            const upJson = await upRes.json();
            if (upJson.success && upJson.image_url) {
                productData.image_url = upJson.image_url;
                // include server-computed meta if returned so server can persist it with product
                if (upJson.image_meta) {
                    productData.image_bg_r = upJson.image_meta.image_bg_r;
                    productData.image_bg_g = upJson.image_meta.image_bg_g;
                    productData.image_bg_b = upJson.image_meta.image_bg_b;
                    productData.image_overlay_alpha = upJson.image_meta.image_overlay_alpha;
                    productData.image_contrast = upJson.image_meta.image_contrast;
                }
                // store variants in local hidden field if needed (not sent to server currently)
                if (upJson.variants) {
                    // attach variants as JSON string in a hidden form field for inspection
                    let vfield = formEl.querySelector('input[name="image_variants"]');
                    if (!vfield) {
                        vfield = document.createElement('input');
                        vfield.type = 'hidden';
                        vfield.name = 'image_variants';
                        formEl.appendChild(vfield);
                    }
                    vfield.value = JSON.stringify(upJson.variants);
                }
            } else {
                showWarning('Upload Warning', upJson.message || 'Image upload returned no URL.');
            }
        } catch (err) {
            console.error('Image upload failed', err);
            showWarning('Upload Failed', 'Image upload failed.');
        }
    }

    try {
        // If editing an existing product, use PUT
        let method = 'POST';
        let url = `${API_BASE}/api/products`;
        if (AppState.editing.productId) { method = 'PUT'; url = `${API_BASE}/api/products/${AppState.editing.productId}`; }

        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(productData)
        });

        const data = await response.json();

        if (data.success) {
            showSuccess(AppState.editing.productId ? 'Product Updated' : 'Product Created', AppState.editing.productId ? 'Product updated successfully!' : 'Product created successfully!');
            hideModal('addProductModal');
            AppState.editing.productId = null;
            AppState.editing.productStoreId = null;
            loadProducts();
        } else {
            const msg = data.message || (data.errors ? data.errors.map(e => e.msg).join(', ') : 'Failed to create product');
            showError('Error', msg);
        }
    } catch (error) {
        console.error('Error creating product:', error);
        showError('Error', 'Failed to create product');
    }
}

async function editProduct(productId) {
    // Open edit modal and populate fields
    const id = parseInt(productId, 10);
    if (!Number.isInteger(id) || id <= 0) {
        showError('Error', 'Invalid product ID');
        return;
    }
    AppState.editing.productId = id;
    try {
        const resp = await fetch(`${API_BASE}/api/products/${id}?admin=1&include_variants=1&include_image_variants=1`, { headers: { 'Authorization': `Bearer ${authToken}` } });
        const data = await resp.json();
        if (!data.success || !data.product) {
            showError('Error', 'Failed to load product for editing');
            return;
        }
        const p = data.product;
        const persistedManualVariantCost = !!p.manual_variant_cost_override;
        AppState.editing.productStoreId = p.store_id || null;
        const [storesResponse, categoriesResponse, unitsResp, sizesResp] = await Promise.all([
            fetch(`${API_BASE}/api/stores?lite=1`),
            fetch(`${API_BASE}/api/categories?includeInactive=true&ts=${Date.now()}`, { cache: 'no-store' }),
            fetch(`${API_BASE}/api/units?ts=${Date.now()}`, { headers: { 'Authorization': `Bearer ${authToken}` }, cache: 'no-store' }),
            fetch(`${API_BASE}/api/sizes?ts=${Date.now()}`, { headers: { 'Authorization': `Bearer ${authToken}` }, cache: 'no-store' })
        ]);
        const storesData = await storesResponse.json();
        const categoriesData = await categoriesResponse.json();
        const productsData = { success: false, products: [] };
        const unitsJson = await unitsResp.json();
        const sizesJson = await sizesResp.json();
        if (unitsJson && unitsJson.success && Array.isArray(unitsJson.units)) AppState.units = unitsJson.units;
        if (sizesJson && sizesJson.success && Array.isArray(sizesJson.sizes)) AppState.sizes = sizesJson.sizes;
        const form = document.getElementById('addProductForm');
        const storeSelect = document.getElementById('productStore');
        const categorySelect = document.getElementById('productCategory');
        const unitSelect = document.getElementById('productUnit');
        const sizeSelect = document.getElementById('productSize');
        const itemSelect = document.getElementById('productItem');
        bindProductSizePricesUI();
        resetProductSizePricesUI();
        if (storeSelect) {
            storeSelect.innerHTML = '<option value="">Select Store</option>';
            if (storesData && storesData.success && Array.isArray(storesData.stores)) {
                storesData.stores.forEach(store => {
                    storeSelect.innerHTML += `<option value="${store.id}">${store.name}</option>`;
                });
            }
        }
        setProductStoreTerms((storesData && storesData.stores) || []);
        bindProductPriceCalc();
        if (categorySelect) {
            categorySelect.innerHTML = '<option value="">Select Category (Optional)</option>';
            if (categoriesData && categoriesData.success && Array.isArray(categoriesData.categories)) {
                categoriesData.categories.forEach(category => {
                    categorySelect.innerHTML += `<option value="${category.id}">${category.name}</option>`;
                });
            }
        }
        if (unitSelect) {
            unitSelect.innerHTML = '<option value="">Select Unit (Optional)</option>';
            if (unitsJson && unitsJson.success && Array.isArray(unitsJson.units)) {
                unitsJson.units.forEach(u => {
                    unitSelect.innerHTML += `<option value="${u.id}">${u.name}${u.abbreviation ? ' ('+u.abbreviation+')' : ''}</option>`;
                });
            }
        }
        if (sizeSelect) {
            sizeSelect.innerHTML = '<option value="">Select Size (Optional)</option>';
            if (sizesJson && sizesJson.success && Array.isArray(sizesJson.sizes)) {
                sizesJson.sizes.forEach(s => {
                    sizeSelect.innerHTML += `<option value="${s.id}">${s.label}</option>`;
                });
            }
        }
        refreshProductSizePriceRowOptions();
        try { bindProductMeasureMode(); } catch (e) {}
        const productsById = {};
        if (itemSelect) {
            if (productsData && productsData.success && Array.isArray(productsData.products)) {
                itemSelect.innerHTML = '<option value="">None</option>';
                productsData.products.forEach(prod => {
                    productsById[prod.id] = prod;
                    const label = prod.category_name ? `${prod.name} — ${prod.category_name}` : prod.name;
                    itemSelect.innerHTML += `<option value="${prod.id}">${label}</option>`;
                });
            }

            const nameEl = document.getElementById('productName');
            const descEl = document.getElementById('productDescription');
            const unitSel = document.getElementById('productUnit');
            const sizeSel = document.getElementById('productSize');
            const catSel = document.getElementById('productCategory');
            const priceEl = document.getElementById('productPrice');

            const applyItemSelection = (val) => {
                const usingItem = !!val;
                if (nameEl) { nameEl.readOnly = usingItem; nameEl.required = !usingItem; }
                if (descEl) { descEl.readOnly = usingItem; }

                if (usingItem && productsById[val]) {
                    const prod = productsById[val];
                    if (nameEl) nameEl.value = prod.name || '';
                    if (descEl) descEl.value = prod.description || '';
                    if (catSel && prod.category_id) catSel.value = prod.category_id;
                    if (unitSel && prod.unit_id) unitSel.value = prod.unit_id;
                    if (sizeSel && prod.size_id) sizeSel.value = prod.size_id;
                    if (priceEl && prod.price !== undefined && prod.price !== null) priceEl.value = prod.price;
                }
                try { syncProductMeasureModeFromValues(); } catch (e) {}
                try { recalcProductCost(); } catch (e) {}
            };

            itemSelect.onfocus = async () => {
                if (!itemSelect.options || itemSelect.options.length <= 1) {
                    try { Object.assign(productsById, await ensureProductItemCatalog(itemSelect)); } catch (e) {}
                }
                itemSelect.onfocus = null;
            };
            itemSelect.onclick = async () => {
                if (!itemSelect.options || itemSelect.options.length <= 1) {
                    try { Object.assign(productsById, await ensureProductItemCatalog(itemSelect)); } catch (e) {}
                }
                itemSelect.onclick = null;
            };
            itemSelect.onchange = async (e) => {
                const val = String(e.target.value || '');
                if (val && !productsById[val]) {
                    try { Object.assign(productsById, await ensureProductItemCatalog(itemSelect)); } catch (err) {}
                }
                applyItemSelection(val);
            };
            applyItemSelection(itemSelect.value);
        }
        form.querySelector('#productName').value = p.name || '';
        if (form.querySelector('#productCostPrice')) form.querySelector('#productCostPrice').value = (p.cost_price !== undefined && p.cost_price !== null) ? p.cost_price : '';
        const manualCostEl = document.getElementById('productManualCost');
        if (manualCostEl) manualCostEl.checked = false;
        form.querySelector('#productPrice').value = p.price || '';
        form.querySelector('#productDescription').value = p.description || '';
        form.querySelector('#productStock').value = p.stock_quantity || 0;
        if (form.querySelector('#productImagePreview') && p.image_url) {
            const prev = form.querySelector('#productImagePreview'); prev.src = p.image_url; prev.style.display = 'inline-block';
            try { applyOrientationFitAdmin(prev); } catch (e) {}
        }
        if (p.store_id && storeSelect) storeSelect.value = p.store_id;
        if (p.category_id && categorySelect) categorySelect.value = p.category_id;
        if (p.unit_id && unitSelect) unitSelect.value = p.unit_id;
        if (p.size_id && sizeSelect) sizeSelect.value = p.size_id;
        try {
            const hasVariants = !!p.has_variant_pricing;
            const shouldUseVariants = hasVariants;
            if (shouldUseVariants) {
                const hasSizeBasedVariants = (p.size_variants || []).some(v => {
                    const sid = parseInt(String(v && v.size_id !== undefined ? v.size_id : ''), 10);
                    return Number.isInteger(sid) && sid > 0;
                });
                const hasUnitBasedVariants = (p.size_variants || []).some(v => {
                    const uid = parseInt(String(v && v.unit_id !== undefined ? v.unit_id : ''), 10);
                    return Number.isInteger(uid) && uid > 0;
                });

                if (hasSizeBasedVariants && !hasUnitBasedVariants) {
                    applyProductMeasureMode('size');
                } else if (hasUnitBasedVariants && !hasSizeBasedVariants) {
                    applyProductMeasureMode('unit');
                } else if (hasSizeBasedVariants) {
                    applyProductMeasureMode('size');
                }

                setProductSizePricesEnabled(true);
                const manualVariantCostEl = document.getElementById('productManualVariantCost');
                if (manualVariantCostEl) manualVariantCostEl.checked = persistedManualVariantCost;
                const tbody = document.getElementById('productSizePricesBody');
                if (tbody) tbody.innerHTML = '';
                (p.size_variants || []).forEach(v => addProductSizePriceRow({ size_id: v.size_id, unit_id: v.unit_id, price: v.price, cost_price: v.cost_price }));
                updateVariantCostInputsReadonly();
            } else {
                setProductSizePricesEnabled(false);
            }
        } catch (e) {}
        try { syncProductMeasureModeFromValues(); } catch (e) {}
        const storeTerm = AppState.productStoreTermsById[String(p.store_id || '')] || '';
        if (isDiscountPaymentTerm(storeTerm)) {
            const priceNum = parseFloat(String(p.price ?? '').trim());
            const costNum = parseFloat(String(p.cost_price ?? '').trim());
            const discountTypeEl = document.getElementById('productDiscountType');
            const discountValueEl = document.getElementById('productDiscountValue');
            const profitValueEl = document.getElementById('productProfitValue');
            const storedDiscountType = String(p.discount_type || '').trim().toLowerCase();
            const storedDiscountValue = parseFloat(String(p.discount_value ?? '').trim());
            // Prefer persisted discount fields in edit mode.
            if ((storedDiscountType === 'amount' || storedDiscountType === 'percent') && Number.isFinite(storedDiscountValue) && storedDiscountValue >= 0) {
                if (discountTypeEl) discountTypeEl.value = storedDiscountType;
                if (discountValueEl) discountValueEl.value = (Math.round(storedDiscountValue * 100) / 100).toFixed(2);
            } else if (Number.isFinite(priceNum) && Number.isFinite(costNum) && priceNum > 0) {
                // Fallback for old records where discount fields are null.
                const delta = priceNum - costNum;
                if (delta > 0) {
                    if (discountTypeEl) discountTypeEl.value = 'amount';
                    if (discountValueEl) discountValueEl.value = (Math.round(delta * 100) / 100).toFixed(2);
                } else if (discountValueEl) {
                    discountValueEl.value = '';
                }
            } else if (discountValueEl) {
                discountValueEl.value = '';
            }
            if (profitValueEl) profitValueEl.value = '';
        } else if (isProfitPaymentTerm(storeTerm)) {
            const priceNum = parseFloat(String(p.price ?? '').trim());
            const costNum = parseFloat(String(p.cost_price ?? '').trim());
            const discountTypeEl = document.getElementById('productDiscountType');
            const discountValueEl = document.getElementById('productDiscountValue');
            const profitTypeEl = document.getElementById('productProfitType');
            const profitValueEl = document.getElementById('productProfitValue');
            const selectedProfitType = (String(p.profit_type || '').toLowerCase() === 'percent') ? 'percent' : 'amount';
            if (profitTypeEl) profitTypeEl.value = selectedProfitType;
            if (discountTypeEl) discountTypeEl.value = 'amount';
            if (discountValueEl) discountValueEl.value = '';
            if (Number.isFinite(priceNum) && Number.isFinite(costNum)) {
                const profit = Math.max(0, Math.round((priceNum - costNum) * 100) / 100);
                if (profitValueEl) {
                    if (selectedProfitType === 'percent' && priceNum > 0) {
                        const pct = Math.max(0, Math.round((profit / priceNum) * 10000) / 100);
                        profitValueEl.value = pct > 0 ? pct.toFixed(2) : '';
                    } else {
                        profitValueEl.value = profit > 0 ? profit.toFixed(2) : '';
                    }
                }
            } else if (profitValueEl) {
                profitValueEl.value = '';
            }
        } else {
            const profitTypeEl = document.getElementById('productProfitType');
            if (profitTypeEl) profitTypeEl.value = 'amount';
        }
        // Ensure financial rows/fields honor persisted values after term-based UI toggles.
        try {
            const discountTypeEl = document.getElementById('productDiscountType');
            const discountValueEl = document.getElementById('productDiscountValue');
            const profitTypeEl = document.getElementById('productProfitType');
            const profitValueEl = document.getElementById('productProfitValue');
            const enforcedStoreDiscount = getStoreDiscountOverride(p.store_id || '');
            const storedDiscountType = String(p.discount_type || '').trim().toLowerCase();
            const storedDiscountValue = parseFloat(String(p.discount_value ?? '').trim());
            const storedProfitType = String(p.profit_type || '').trim().toLowerCase();
            const storedProfitValue = parseFloat(String(p.profit_value ?? '').trim());
            if (enforcedStoreDiscount) {
                if (discountTypeEl) {
                    discountTypeEl.value = 'percent';
                    discountTypeEl.disabled = true;
                }
                if (discountValueEl) {
                    discountValueEl.value = (Math.round(Number(enforcedStoreDiscount.value) * 100) / 100).toFixed(2);
                    discountValueEl.readOnly = true;
                    discountValueEl.style.backgroundColor = '#f1f5f9';
                }
            } else if ((storedDiscountType === 'amount' || storedDiscountType === 'percent') && Number.isFinite(storedDiscountValue)) {
                if (discountTypeEl) {
                    discountTypeEl.value = storedDiscountType;
                    discountTypeEl.disabled = false;
                }
                if (discountValueEl) {
                    discountValueEl.value = (Math.round(storedDiscountValue * 100) / 100).toFixed(2);
                    discountValueEl.readOnly = false;
                    discountValueEl.style.backgroundColor = '#ffffff';
                }
            }
            if ((storedProfitType === 'amount' || storedProfitType === 'percent') && Number.isFinite(storedProfitValue)) {
                if (profitTypeEl) profitTypeEl.value = storedProfitType;
                if (profitValueEl) profitValueEl.value = (Math.round(storedProfitValue * 100) / 100).toFixed(2);
            }
        } catch (e) {}
        try { recalcProductCost(); } catch (e) {}
        try {
            const manualVariantCostEl = document.getElementById('productManualVariantCost');
            if (manualVariantCostEl) {
                manualVariantCostEl.checked = persistedManualVariantCost;
                updateVariantCostInputsReadonly();
            }
        } catch (e) {}
        if (itemSelect) {
            if (p.item_id) {
                ensureProductItemCatalog(itemSelect, p.item_id)
                    .then((byId) => Object.assign(productsById, byId || {}))
                    .catch(() => {});
                itemSelect.value = p.item_id;
                const useItem = true;
                const nameEl = document.getElementById('productName');
                const descEl = document.getElementById('productDescription');
                if (nameEl) { nameEl.readOnly = useItem; nameEl.required = !useItem; }
                if (descEl) { descEl.readOnly = useItem; }
                const prod = productsById[p.item_id];
                if (prod) {
                    if (categorySelect && prod.category_id) categorySelect.value = prod.category_id;
                    if (unitSelect && prod.unit_id) unitSelect.value = prod.unit_id;
                    if (sizeSelect && prod.size_id) sizeSelect.value = prod.size_id;
                }
                try { syncProductMeasureModeFromValues(); } catch (e) {}
            } else {
                itemSelect.value = '';
            }
        }

        // Show modal
        try {
            const modal = document.getElementById('addProductModal');
            if (modal) {
                const titleEl = modal.querySelector('.modal-header h3');
                if (titleEl) titleEl.textContent = 'Edit Product';
                const saveBtn = modal.querySelector('#saveProductBtn');
                if (saveBtn) saveBtn.textContent = 'Update Product';
            }
        } catch (e) {}
        showModal('addProductModal');
        // Enforce persisted checkbox state once modal is visible.
        try {
            setTimeout(() => {
                const manualVariantCostEl = document.getElementById('productManualVariantCost');
                if (manualVariantCostEl) {
                    manualVariantCostEl.checked = persistedManualVariantCost;
                    updateVariantCostInputsReadonly();
                }
            }, 0);
        } catch (e) {}
    } catch (e) {
        console.error('Failed to load product for edit', e);
        showError('Error', 'Failed to load product for editing');
    }
}

function showAddCategoryModal() {
    showModal('addCategoryModal');
    try {
        const fileInput = document.getElementById('categoryImageFile');
        const preview = document.getElementById('categoryImagePreview');
        if (fileInput) {
            fileInput.onchange = (e) => {
                const file = e.target.files && e.target.files[0];
                if (file && preview) {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        preview.src = ev.target.result;
                        preview.style.display = 'inline-block';
                    };
                    reader.readAsDataURL(file);
                }
            };
        }
    } catch (e) {}
}

async function saveCategory() {
    const formData = new FormData(document.getElementById('addCategoryForm'));
    const name = String(formData.get('name') || '').trim();
    const description = String(formData.get('description') || '').trim();
    if (name.length < 2) {
        showError('Validation Error', 'Category name must be at least 2 characters');
        return;
    }
    const categoryData = { name, description };
    const catFileInput = document.getElementById('categoryImageFile');
    if (catFileInput && catFileInput.files && catFileInput.files.length > 0) {
        try {
            const fd = new FormData();
            fd.append('image', catFileInput.files[0]);
            const upRes = await fetch(`${API_BASE}/api/categories/upload-image`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${authToken}` },
                body: fd
            });
            const upJson = await upRes.json();
            if (upJson.success && upJson.image_url) {
                categoryData.image_url = upJson.image_url;
            }
        } catch (e) {}
    }

    try {
        if (AppState.editing.categoryId) {
            const response = await fetch(`${API_BASE}/api/categories/${AppState.editing.categoryId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                body: JSON.stringify(categoryData)
            });
            const data = await response.json();
            if (data.success) {
                showSuccess('Category Updated', 'Category updated successfully!');
                hideModal('addCategoryModal');
                AppState.editing.categoryId = null;
                loadCategories();
            } else {
                showError('Error', data.message || 'Failed to update category');
            }
        } else {
            const response = await fetch(`${API_BASE}/api/categories`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                body: JSON.stringify(categoryData)
            });
            const data = await response.json();
            if (data.success) {
                showSuccess('Category Created', 'Category created successfully!');
                hideModal('addCategoryModal');
                loadCategories();
            } else {
                showError('Error', data.message || 'Failed to create category');
            }
        }
    } catch (error) {
        console.error('Error creating/updating category:', error);
        showError('Error', 'Failed to save category');
    }
}

async function editCategory(categoryId) {
    AppState.editing.categoryId = categoryId;
    try {
        let c = (AppState.categories || []).find(x => String(x.id) === String(categoryId));
        if (!c) {
            const resp = await fetch(`${API_BASE}/api/categories?includeInactive=true&ts=${Date.now()}`, { cache: 'no-store' });
            const data = await resp.json();
            if (!data.success) { showError('Error', 'Failed to load categories'); return; }
            AppState.categories = data.categories || [];
            c = (AppState.categories || []).find(x => String(x.id) === String(categoryId));
            if (!c) { showError('Error', 'Category not found'); return; }
        }
        showAddCategoryModal();
        setTimeout(function(){
            const form = document.getElementById('addCategoryForm');
            if (!form) return;
            const nameInput = document.getElementById('categoryName');
            const descInput = document.getElementById('categoryDescription');
            if (nameInput) nameInput.value = c.name || '';
            if (descInput) descInput.value = c.description || '';
            const preview = document.getElementById('categoryImagePreview');
            if (preview) {
                if (c.image_url) {
                    preview.src = c.image_url;
                    preview.style.display = 'inline-block';
                } else {
                    preview.style.display = 'none';
                }
            }
            const modal = document.getElementById('addCategoryModal');
            if (modal) {
                const titleEl = modal.querySelector('.modal-header h3');
                if (titleEl) titleEl.textContent = 'Edit Category';
                const saveBtn = modal.querySelector('#saveCategoryBtn');
                if (saveBtn) saveBtn.textContent = 'Update Category';
            }
        }, 100);
    } catch (e) {
        console.error('Failed to load category for edit', e);
        showError('Error', 'Failed to load category for edit');
    }
}

try { window.editCategory = editCategory; } catch (e) {}


// Riders Management Functions
// --- Rider Fuel History Client Functions ---
async function loadRidersForFuelSelect() {
    try {
        const r = await fetch(`${API_BASE}/api/riders`, { headers: { 'Authorization': `Bearer ${authToken}` } });
        const data = await r.json();
        const sel = document.getElementById('fuelRiderSelect');
        if (!sel) return null;
        sel.innerHTML = '<option value="">-- Select Rider --</option>';
        if (data && data.success && Array.isArray(data.riders)) {
            data.riders.forEach(r => {
                const opt = document.createElement('option');
                opt.value = r.id;
                opt.textContent = `${r.first_name} ${r.last_name}`;
                sel.appendChild(opt);
            });
            // Auto-select first rider if none selected
            if (!sel.value && data.riders.length > 0) {
                sel.value = data.riders[0].id;
            }
            return sel.value || null;
        }
        return null;
    } catch (err) {
        console.error('Error loading riders for fuel select:', err);
        showError('Error', 'Failed to load rider list');
        return null;
    }
}

async function loadFuelHistory(riderId) {
    const tbody = document.getElementById('fuelHistoryTableBody');
    if (!tbody) return;
    if (!riderId) {
        tbody.innerHTML = '<tr><td colspan="10">Select a rider to view fuel history.</td></tr>';
        return;
    }

    tbody.innerHTML = '<tr><td colspan="10">Loading...</td></tr>';

    try {
        const r = await fetch(`${API_BASE}/api/riders/${riderId}/fuel-history`, { headers: { 'Authorization': `Bearer ${authToken}` } });
        const data = await r.json();
        tbody.innerHTML = '';
        if (data.success && Array.isArray(data.records)) {
            if (data.records.length === 0) {
                tbody.innerHTML = '<tr><td colspan="10">No fuel history records found.</td></tr>';
                return data;
            }

            data.records.forEach(rec => {
                const tr = document.createElement('tr');
                const date = rec.entry_date ? new Date(rec.entry_date).toLocaleDateString() : '';
                const recorded = rec.created_at ? new Date(rec.created_at).toLocaleString() : '';
                const start = rec.start_meter || '';
                const end = rec.end_meter || '';
                const distance = (rec.distance !== null && rec.distance !== undefined && rec.distance !== '') ? parseFloat(rec.distance).toFixed(2) : '';
                const pr = (rec.petrol_rate !== null && rec.petrol_rate !== undefined) ? parseFloat(rec.petrol_rate).toFixed(2) : '';
                const cost = (rec.fuel_cost !== null && rec.fuel_cost !== undefined && rec.fuel_cost !== '') ? parseFloat(rec.fuel_cost).toFixed(2) : '';

                tr.innerHTML = `
                    <td>${rec.id}</td>
                    <td>${date}</td>
                    <td>${recorded}</td>
                    <td>${start}</td>
                    <td>${end}</td>
                    <td>${distance}</td>
                    <td>${pr}</td>
                    <td>${cost}</td>
                    <td>${rec.notes || ''}</td>
                    <td><button class="btn btn-small btn-danger" onclick="deleteFuelEntry(${rec.id}, ${riderId})">Delete</button></td>
                `;
                tbody.appendChild(tr);
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="10">Failed to load fuel history.</td></tr>';
            showError('Error', (data && data.message) ? data.message : 'Failed to load fuel history');
        }
        return data;
    } catch (err) {
        console.error('Error loading fuel history:', err);
        tbody.innerHTML = '<tr><td colspan="10">Error loading fuel history.</td></tr>';
        showError('Error', 'Error loading fuel history');
        throw err;
    }
}

async function saveFuelEntry() {
    const sel = document.getElementById('fuelRiderSelect');
    if (!sel || !sel.value) {
        showWarning('Select Rider', 'Please select a rider before saving an entry.');
        return;
    }
    const riderId = sel.value;
    // Coerce numeric fields to numbers (or null) to match server validation
    const entryDateVal = document.getElementById('entryDate').value || null;
    const startMeterRaw = document.getElementById('startMeter').value || null;
    const endMeterRaw = document.getElementById('endMeter').value || null;
    const distanceRaw = document.getElementById('distance').value || null;
    const petrolRateRaw = document.getElementById('petrolRate').value;
    const costRaw = document.getElementById('fuelCost') ? document.getElementById('fuelCost').value : null;

    const startMeter = (startMeterRaw !== undefined && startMeterRaw !== null && startMeterRaw !== '') ? String(startMeterRaw) : null;
    const endMeter = (endMeterRaw !== undefined && endMeterRaw !== null && endMeterRaw !== '') ? String(endMeterRaw) : null;
    const distance = (distanceRaw !== undefined && distanceRaw !== null && distanceRaw !== '') ? parseFloat(distanceRaw) : null;
    const petrolRate = (petrolRateRaw !== undefined && petrolRateRaw !== null && petrolRateRaw !== '') ? parseFloat(petrolRateRaw) : null;
    const fuelCost = (costRaw !== undefined && costRaw !== null && costRaw !== '') ? parseFloat(costRaw) : null;

    // Validation: Ensure enough data is present for cost calculation
    if (fuelCost === null) {
        if (petrolRate === null) {
            showWarning('Missing Information', 'Please enter Petrol Rate so the system can calculate Fuel Cost.');
            return;
        }
        if (distance === null) {
            showWarning('Missing Information', 'Please enter Start/End Meter or Distance so the system can calculate Fuel Cost.');
            return;
        }
    }

    const payload = {
        entryDate: entryDateVal,
        startMeter: startMeter,
        endMeter: endMeter,
        distance: distance,
        petrolRate: petrolRate,
        fuelCost: fuelCost,
        notes: document.getElementById('fuelNotes').value || null
    };

    try {
        const resp = await fetch(`${API_BASE}/api/riders/${riderId}/fuel-history`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify(payload)
        });
        if (!resp.ok) {
            const errBody = await resp.json().catch(()=>({ message: 'Unknown error' }));
            showError('Save Failed', errBody.message || 'Failed to save entry');
            return;
        }
        const data = await resp.json();
        if (data && data.success) {
            showSuccess('Saved', 'Fuel history entry saved');
            // clear form
            document.getElementById('entryDate').value = '';
            document.getElementById('startMeter').value = '';
            document.getElementById('endMeter').value = '';
            document.getElementById('distance').value = '';
            document.getElementById('petrolRate').value = '';
            if (document.getElementById('fuelCost')) document.getElementById('fuelCost').value = '';
            document.getElementById('fuelNotes').value = '';
            loadFuelHistory(riderId);
        } else {
            showError('Save Failed', (data && data.message) ? data.message : 'Failed to save entry');
        }
    } catch (err) {
        console.error('Error saving fuel entry:', err);
        showError('Error', 'Failed to save fuel entry');
    }
}

function deleteFuelEntry(entryId, riderId) {
    if (!confirm('Delete this fuel history entry? This action cannot be undone.')) return;
    fetch(`${API_BASE}/api/riders/fuel-history/${entryId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            showSuccess('Deleted', 'Fuel entry deleted');
            if (riderId) loadFuelHistory(riderId);
        } else showError('Delete Failed', data.message || 'Failed to delete entry');
    })
    .catch(err => {
        console.error('Error deleting fuel entry:', err);
        showError('Error', 'Failed to delete fuel entry');
    });
}



function showAddSizeModal() {
    AppState.editing.sizeId = null;
    const form = document.getElementById('addSizeForm');
    if (form) form.reset();
    showModal('addSizeModal');
}

function formatPhoneValue(raw) {
    const digits = String(raw || '').replace(/[^\d]/g, '');
    let local = digits.replace(/^92/, '');
    if (local.length > 10) local = local.slice(0, 10);
    return '+92' + local;
}

function attachPhoneFormatterTo(input) {
    if (!input) return;
    const ensurePrefix = () => {
        if (!input.value || !String(input.value).startsWith('+92')) {
            input.value = formatPhoneValue(input.value);
        }
    };
    input.addEventListener('focus', ensurePrefix);
    input.addEventListener('keydown', function(e) {
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
}

function attachPhoneFormatHandlers() {
    ['userPhone', 'storePhone', 'riderPhone'].forEach(id => {
        const el = document.getElementById(id);
        if (el) attachPhoneFormatterTo(el);
    });
}

async function populateVehicleTypeSelect(selectEl, currentValue) {
    if (!selectEl) return;
    selectEl.innerHTML = '<option value="">Select Vehicle Type</option>';
    let types = [];
    try {
        const resp = await fetch(`${API_BASE}/api/riders/types/vehicle`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await resp.json();
        if (data && data.success && Array.isArray(data.vehicleTypes)) {
            types = data.vehicleTypes;
        }
    } catch (_) {}
    if (!types || types.length === 0) {
        types = ['Motorcycle', 'Bicycle', 'Scooter', 'Car', 'Van'];
    }
    if (currentValue && !types.includes(currentValue)) {
        types = [currentValue, ...types];
    }
    types.forEach(type => {
        const opt = document.createElement('option');
        opt.value = type;
        opt.textContent = type;
        selectEl.appendChild(opt);
    });
    if (currentValue) selectEl.value = currentValue;
}

async function showAddRiderModal() {
    AppState.editing.riderId = null;
    const vehicleTypeSelect = document.getElementById('riderVehicleType');
    await populateVehicleTypeSelect(vehicleTypeSelect, null);
    const modal = document.getElementById('addRiderModal');
    if (modal) {
        const titleEl = modal.querySelector('.modal-header h3');
        if (titleEl) titleEl.textContent = 'Add New Rider';
        const saveBtn = modal.querySelector('#saveRiderBtn');
        if (saveBtn) saveBtn.textContent = 'Save Rider';
    }
    try {
        const imgInput = document.getElementById('riderImageFile');
        const imgPrev = document.getElementById('riderImagePreview');
        if (imgInput) imgInput.value = '';
        if (imgPrev) { imgPrev.src = ''; imgPrev.style.display = 'none'; }
        const idInput = document.getElementById('riderIdCardFile');
        const idPrev = document.getElementById('riderIdCardPreview');
        if (idInput) idInput.value = '';
        if (idPrev) { idPrev.src = ''; idPrev.style.display = 'none'; }
    } catch (e) {}
    try {
        const imgInput = document.getElementById('riderImageFile');
        const imgPrev = document.getElementById('riderImagePreview');
        if (imgInput && imgPrev) {
            imgInput.onchange = (e) => {
                const f = e.target.files && e.target.files[0];
                if (f) {
                    const r = new FileReader();
                    r.onload = (ev) => { imgPrev.src = ev.target.result; imgPrev.style.display = 'inline-block'; };
                    r.readAsDataURL(f);
                } else { imgPrev.style.display = 'none'; }
            };
        }
        const idInput = document.getElementById('riderIdCardFile');
        const idPrev = document.getElementById('riderIdCardPreview');
        if (idInput && idPrev) {
            idInput.onchange = (e) => {
                const f = e.target.files && e.target.files[0];
                if (f) {
                    const r = new FileReader();
                    r.onload = (ev) => { idPrev.src = ev.target.result; idPrev.style.display = 'inline-block'; };
                    r.readAsDataURL(f);
                } else { idPrev.style.display = 'none'; }
            };
        }
        const cnic = document.getElementById('riderIdCardNum');
        if (cnic) {
            cnic.addEventListener('input', function() {
                const digits = String(this.value).replace(/\D/g, '').slice(0, 13);
                let out = '';
                if (digits.length > 0) out += digits.slice(0, 5);
                if (digits.length > 5) out += '-' + digits.slice(5, 12);
                if (digits.length > 12) out += '-' + digits.slice(12);
                this.value = out;
            });
        }
    } catch (e) {}
    showModal('addRiderModal');
}

async function saveRider() {
    const formData = new FormData(document.getElementById('addRiderForm'));
    const fullName = String(formData.get('fullName') || '').trim();
    const riderData = {
        fullName,
        email: formData.get('email'),
        phone: formData.get('phone'),
        password: formData.get('password'),
        vehicleType: formData.get('vehicleType'),
        licenseNumber: formData.get('licenseNumber'),
        fatherName: String(formData.get('fatherName') || '').trim() || null,
        idCardNum: String(formData.get('idCardNum') || '').trim() || null
    };

    const idPattern = /^\d{5}-\d{7}-\d$/;
    if (riderData.idCardNum && !idPattern.test(riderData.idCardNum)) {
        showError('Invalid ID Card', 'Use format xxxxx-xxxxxxx-x');
        return;
    }

    try {
        const uploadImage = async (file) => {
            const fd = new FormData();
            fd.append('image', file);
            const tryUpload = async (url) => {
                const resp = await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${authToken}` }, body: fd });
                if (!resp.ok) return null;
                const ct = resp.headers.get('content-type') || '';
                if (!ct.includes('application/json')) return null;
                const j = await resp.json();
                return (j && j.success && j.image_url) ? j.image_url : null;
            };
            // Use product/store style endpoints, then fallback to categories
            const p1 = await tryUpload(`${API_BASE}/api/products/upload-image`);
            if (p1) return p1;
            const p2 = await tryUpload(`${API_BASE}/api/stores/upload-image`);
            if (p2) return p2;
            const p3 = await tryUpload(`${API_BASE}/api/categories/upload-image`);
            return p3;
        };
        const imgFile = document.getElementById('riderImageFile')?.files?.[0] || null;
        if (imgFile) {
            const url = await uploadImage(imgFile);
            if (url) riderData.image_url = url;
        }
        const idFile = document.getElementById('riderIdCardFile')?.files?.[0] || null;
        if (idFile) {
            const idUrl = await uploadImage(idFile);
            if (idUrl) riderData.id_card_url = idUrl;
        }
    } catch (e) { console.warn('Rider uploads failed', e); }

    try {
        if (AppState.editing.riderId) {
            const response = await fetch(`${API_BASE}/api/riders/${AppState.editing.riderId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                body: JSON.stringify(riderData)
            });
            const data = await response.json();
            if (data.success) {
                showSuccess('Rider Updated', 'Rider updated successfully!');
                try {
                    const imgInput = document.getElementById('riderImageFile');
                    const imgPrev = document.getElementById('riderImagePreview');
                    if (imgInput) imgInput.value = '';
                    if (imgPrev) { imgPrev.src = ''; imgPrev.style.display = 'none'; }
                    const idInput = document.getElementById('riderIdCardFile');
                    const idPrev = document.getElementById('riderIdCardPreview');
                    if (idInput) idInput.value = '';
                    if (idPrev) { idPrev.src = ''; idPrev.style.display = 'none'; }
                } catch (e) {}
                hideModal('addRiderModal');
                AppState.editing.riderId = null;
                loadRiders();
            } else {
                showError('Error', data.message || 'Failed to update rider');
            }
        } else {
            const response = await fetch(`${API_BASE}/api/riders`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify(riderData)
            });

            const data = await response.json();

            if (data.success) {
                showSuccess('Rider Created', 'Rider created successfully!');
                try {
                    const imgInput = document.getElementById('riderImageFile');
                    const imgPrev = document.getElementById('riderImagePreview');
                    if (imgInput) imgInput.value = '';
                    if (imgPrev) { imgPrev.src = ''; imgPrev.style.display = 'none'; }
                    const idInput = document.getElementById('riderIdCardFile');
                    const idPrev = document.getElementById('riderIdCardPreview');
                    if (idInput) idInput.value = '';
                    if (idPrev) { idPrev.src = ''; idPrev.style.display = 'none'; }
                } catch (e) {}
                hideModal('addRiderModal');
                loadRiders();
            } else {
                showError('Error', data.message || 'Failed to create rider');
            }
        }
    } catch (error) {
        console.error('Error creating rider:', error);
        showError('Error', 'Failed to create rider');
    }
}

async function editRider(riderId) {
    AppState.editing.riderId = riderId;
    try {
        const resp = await fetch(`${API_BASE}/api/riders/${riderId}`, { headers: { 'Authorization': `Bearer ${authToken}` } });
        const data = await resp.json();
        if (!data || !data.success || !data.rider) { showError('Error', 'Failed to load rider'); return; }
        const r = data.rider;
        const vehicleTypeSelect = document.getElementById('riderVehicleType');
        await populateVehicleTypeSelect(vehicleTypeSelect, r.vehicle_type || null);
        const form = document.getElementById('addRiderForm');
        const full = (r.full_name) ? r.full_name : [r.first_name || '', r.last_name || ''].filter(Boolean).join(' ');
        if (form.querySelector('#riderFullName')) form.querySelector('#riderFullName').value = full;
        if (form.querySelector('#riderFatherName')) form.querySelector('#riderFatherName').value = r.father_name || '';
        form.querySelector('#riderEmail').value = r.email || '';
        form.querySelector('#riderPhone').value = r.phone || '';
        form.querySelector('#riderLicenseNumber').value = r.license_number || '';
        if (form.querySelector('#riderIdCardNum')) form.querySelector('#riderIdCardNum').value = r.id_card_num || '';
        try {
            const imgPrev = document.getElementById('riderImagePreview');
            if (imgPrev) {
                if (r.image_url) { imgPrev.src = r.image_url; imgPrev.style.display = 'inline-block'; }
                else { imgPrev.src = ''; imgPrev.style.display = 'none'; }
            }
            const idPrev = document.getElementById('riderIdCardPreview');
            if (idPrev) {
                if (r.id_card_url) { idPrev.src = r.id_card_url; idPrev.style.display = 'inline-block'; }
                else { idPrev.src = ''; idPrev.style.display = 'none'; }
            }
        } catch (e) {}
        const modal = document.getElementById('addRiderModal');
        if (modal) {
            const titleEl = modal.querySelector('.modal-header h3');
            if (titleEl) titleEl.textContent = 'Edit Rider';
            const saveBtn = modal.querySelector('#saveRiderBtn');
            if (saveBtn) saveBtn.textContent = 'Update Rider';
        }
        showModal('addRiderModal');
    } catch (e) {
        console.error('Failed to load rider for edit', e);
        showError('Error', 'Failed to load rider for edit');
    }
}

function toggleRiderStatus(riderId, currentStatus) {
    fetch(`${API_BASE}/api/riders/${riderId}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ isActive: !currentStatus })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            loadRiders();
        } else {
            showError('Error', 'Failed to update rider status');
        }
    })
    .catch(error => console.error('Error updating rider:', error));
}

// Order Reports Functions
function generateOrderReport() {
    const startDate = document.getElementById('reportStartDate').value;
    const endDate = document.getElementById('reportEndDate').value;

    if (!startDate || !endDate) {
        showWarning('Date Required', 'Please select both start and end dates for the report.');
        return;
    }

    if (new Date(startDate) > new Date(endDate)) {
        showError('Invalid Date Range', 'Start date cannot be after end date.');
        return;
    }

    loadOrderReports(startDate, endDate);
}

function loadOrderReports(startDate, endDate) {
    console.log('Generating report for date range:', startDate, 'to', endDate);

    // Get rider filter value from DOM
    const riderFilter = document.getElementById('reportRiderFilter').value;

    // For now, we'll use the existing orders endpoint and filter client-side
    // In a production app, you'd want a dedicated reports endpoint
    fetch(`${API_BASE}/api/orders`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
    })
    .then(data => {
        console.log('API Response:', data);

        if (data.success && Array.isArray(data.orders)) {
            console.log(`Found ${data.orders.length} total orders in database`);

            // Filter orders by date range and rider
            const filteredOrders = data.orders.filter(order => {
                try {
                    // Handle different date formats that might come from database
                    let orderDate;

                    if (order.created_at) {
                        // If it's already a valid date string or timestamp
                        orderDate = new Date(order.created_at);

                        // Check if the date is valid
                        if (isNaN(orderDate.getTime())) {
                            console.warn('Invalid date for order:', order.id, order.created_at);
                            return false;
                        }

                        const dateStr = orderDate.toISOString().split('T')[0];
                        const inDateRange = dateStr >= startDate && dateStr <= endDate;

                        // Filter by rider if selected
                        let matchesRider = true;
                        if (riderFilter) {
                            // Compare rider IDs as strings to handle type mismatches
                            matchesRider = String(order.rider_id) === String(riderFilter);
                            console.log(`Order ${order.id} rider check: order.rider_id=${order.rider_id} (${typeof order.rider_id}) vs filter=${riderFilter} (${typeof riderFilter}) = ${matchesRider}`);
                        }

                        const matches = inDateRange && matchesRider;

                        console.log(`Order ${order.id}: ${dateStr} in range [${startDate}, ${endDate}] = ${inDateRange}, rider match = ${matchesRider}, final = ${matches}`);
                        return matches;
                    } else {
                        console.warn('Order missing created_at:', order.id);
                        return false;
                    }
                } catch (error) {
                    console.error('Error processing order date:', order.id, error);
                    return false;
                }
            });

            console.log(`Filtered to ${filteredOrders.length} orders in date range`);

            if (filteredOrders.length === 0) {
                showWarning('No Orders Found', `No orders found in the selected date range (${startDate} to ${endDate}). ${riderFilter ? 'For the selected rider. ' : ''}Try expanding your date range or selecting a broader period. You can also try selecting "All Riders" if filtering by rider.`);
                return;
            }

            // Calculate report statistics
            const reportData = calculateReportStats(filteredOrders);

            // Update UI with report data
            displayOrderReport(reportData, filteredOrders);

            showSuccess('Report Generated', `Successfully generated report with ${filteredOrders.length} orders.`);
        } else {
            console.error('Invalid API response:', data);
            showError('Data Error', 'Received invalid data from server. Please check the console for details.');
        }
    })
    .catch(error => {
        console.error('Error loading order reports:', error);
        showError('Network Error', `Failed to load report data: ${error.message}`);
    });
}

function calculateReportStats(orders) {
    const stats = {
        totalRevenue: 0,
        totalOrders: orders.length,
        completedOrders: 0,
        statusCounts: {}
    };

    orders.forEach(order => {
        stats.totalRevenue += parseFloat(order.total_amount) || 0;

        if (order.status === 'delivered') {
            stats.completedOrders++;
        }

        // Count orders by status
        stats.statusCounts[order.status] = (stats.statusCounts[order.status] || 0) + 1;
    });

    stats.avgOrderValue = stats.totalOrders > 0 ? stats.totalRevenue / stats.totalOrders : 0;

    return stats;
}

function displayOrderReport(stats, orders) {
    // Update summary cards
    document.getElementById('totalRevenue').textContent = `PKR ${stats.totalRevenue.toLocaleString()}`;
    document.getElementById('totalOrdersCount').textContent = stats.totalOrders;
    document.getElementById('avgOrderValue').textContent = `PKR ${stats.avgOrderValue.toFixed(2)}`;
    document.getElementById('completedOrders').textContent = stats.completedOrders;

    // Show print button after report is generated
    document.getElementById('printReportBtn').style.display = 'inline-block';

    // Group orders by date for detailed table
    const ordersByDate = {};
    orders.forEach(order => {
        const date = new Date(order.created_at).toLocaleDateString();
        if (!ordersByDate[date]) {
            ordersByDate[date] = [];
        }
        ordersByDate[date].push(order);
    });

    // Create detailed report table
    const tbody = document.getElementById('orderReportsTableBody');
    if (tbody) {
        tbody.innerHTML = '';

        Object.keys(ordersByDate).sort().forEach(date => {
            const dayOrders = ordersByDate[date];
            const dayRevenue = dayOrders.reduce((sum, order) => sum + parseFloat(order.total_amount), 0);
            const avgOrderValue = dayRevenue / dayOrders.length;

            // Find most popular store for the day
            const storeCounts = {};
            dayOrders.forEach(order => {
                storeCounts[order.store_name] = (storeCounts[order.store_name] || 0) + 1;
            });
            const mostPopularStore = Object.keys(storeCounts).reduce((a, b) =>
                storeCounts[a] > storeCounts[b] ? a : b, 'N/A');

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${date}</td>
                <td>${dayOrders.length}</td>
                <td>PKR ${dayRevenue.toLocaleString()}</td>
                <td>PKR ${avgOrderValue.toFixed(2)}</td>
                <td>${mostPopularStore}</td>
            `;
            tbody.appendChild(row);
        });
    }
}

function createStatusChart(statusCounts) {
    const ctx = document.getElementById('statusChart').getContext('2d');

    // Destroy existing chart if it exists
    if (AppState.charts.status) {
        AppState.charts.status.destroy();
    }

    AppState.charts.status = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: Object.keys(statusCounts),
            datasets: [{
                data: Object.values(statusCounts),
                backgroundColor: [
                    '#FF6384', // pending
                    '#36A2EB', // confirmed
                    '#FFCE56', // preparing
                    '#4BC0C0', // ready
                    '#9966FF', // delivered
                    '#FF9F40'  // cancelled
                ],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom',
                },
                title: {
                    display: true,
                    text: 'Order Status Distribution'
                }
            }
        }
    });
}

function createRevenueChart(orders) {
    const ctx = document.getElementById('revenueChart').getContext('2d');

    // Destroy existing chart if it exists
    if (AppState.charts.revenue) {
        AppState.charts.revenue.destroy();
    }

    // Group revenue by date for the last 30 days
    const revenueByDate = {};
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    orders.forEach(order => {
        const orderDate = new Date(order.created_at);
        if (orderDate >= thirtyDaysAgo) {
            const dateKey = orderDate.toISOString().split('T')[0];
            revenueByDate[dateKey] = (revenueByDate[dateKey] || 0) + parseFloat(order.total_amount);
        }
    });

    // Create labels and data for the last 30 days
    const labels = [];
    const data = [];
    for (let i = 29; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateKey = date.toISOString().split('T')[0];
        labels.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        data.push(revenueByDate[dateKey] || 0);
    }

    AppState.charts.revenue = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Revenue (PKR)',
                data: data,
                borderColor: '#667eea',
                backgroundColor: 'rgba(102, 126, 234, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    display: false
                },
                title: {
                    display: true,
                    text: 'Revenue Trend (Last 30 Days)'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return 'PKR ' + value.toLocaleString();
                        }
                    }
                }
            }
        }
    });
}

// ===== TABLE SORTING FUNCTIONALITY =====

// Initialize table sorting for a specific table
function initializeTableSorting(tableType) {
    const table = document.getElementById(`${tableType}Table`);
    if (!table) return;

    const headers = table.querySelectorAll('th');
    headers.forEach((header, index) => {
        const column = getColumnName(tableType, index);
        if (column !== null) {
            // Only make sortable columns clickable
            header.style.cursor = 'pointer';
            header.addEventListener('click', () => sortTable(tableType, column));
        } else {
            // Actions column - not sortable
            header.style.cursor = 'default';
        }
        updateSortIndicator(header, column, tableType);
    });
}

// Get column name based on table type and column index
function getColumnName(tableType, columnIndex) {
    const columnMappings = {
        products: ['id', 'name', 'price', 'category_name', 'store_name', 'stock_quantity', 'is_available', 'actions'],
        users: ['id', 'first_name', 'email', 'user_type', 'is_active', 'actions'],
        stores: ['id', 'name', 'location', 'owner_name', 'rating', 'is_active', 'actions'],
        categories: ['id', 'name', 'description', 'is_active', 'actions'],
        riders: ['id', 'first_name', 'email', 'phone', 'vehicle_type', 'license_number', 'is_available', 'is_active', 'actions'],
        orders: ['order_number', 'first_name', 'store_name', 'total_amount', 'status', 'rider_first_name', 'rider_location', 'created_at', 'actions']
    };

    const column = columnMappings[tableType]?.[columnIndex];
    // Return null for actions column since it can't be sorted
    return column === 'actions' ? null : column || 'id';
}

// Sort table by column
function sortTable(tableType, column) {
    // Toggle sort direction
    if (AppState.sort[tableType].column === column) {
        AppState.sort[tableType].direction = AppState.sort[tableType].direction === 'asc' ? 'desc' : 'asc';
    } else {
        AppState.sort[tableType].column = column;
        AppState.sort[tableType].direction = 'asc';
    }

    // Get the data array for this table
    let data = [];
    switch(tableType) {
        case 'products':
            data = AppState.products;
            break;
        case 'stores':
            data = AppState.stores;
            break;
        case 'categories':
            data = AppState.categories;
            break;
        case 'riders':
            data = AppState.riders;
            break;
        case 'orders':
            data = AppState.orders;
            break;
    }

    // Sort the data
    data.sort((a, b) => {
        let aVal = getNestedValue(a, column);
        let bVal = getNestedValue(b, column);

        // Handle different data types
        if (typeof aVal === 'string' && typeof bVal === 'string') {
            aVal = aVal.toLowerCase();
            bVal = bVal.toLowerCase();
        } else if (typeof aVal === 'number' && typeof bVal === 'number') {
            // Numbers are fine as is
        } else if (aVal instanceof Date && bVal instanceof Date) {
            // Dates are fine as is
        } else {
            // Convert to strings for comparison
            aVal = String(aVal || '').toLowerCase();
            bVal = String(bVal || '').toLowerCase();
        }

        if (aVal < bVal) return AppState.sort[tableType].direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return AppState.sort[tableType].direction === 'asc' ? 1 : -1;
        return 0;
    });

    // Update the display
    switch(tableType) {
        case 'products':
            displayProducts(data);
            break;
        case 'stores':
            displayStores(data);
            break;
        case 'categories':
            displayCategories(data);
            break;
        case 'riders':
            displayRiders(data);
            break;
        case 'orders':
            displayOrders(data);
            break;
    }

    // Update sort indicators
    updateAllSortIndicators(tableType);
}

// Get nested object value by dot notation
function getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
}

// Update sort indicators for all headers in a table
function updateAllSortIndicators(tableType) {
    const table = document.getElementById(`${tableType}Table`);
    if (!table) return;

    const headers = table.querySelectorAll('th');
    headers.forEach((header, index) => {
        const column = getColumnName(tableType, index);
        updateSortIndicator(header, column, tableType);
    });
}

// Update sort indicator for a specific header
function updateSortIndicator(header, column, tableType) {
    // Remove existing sort indicators
    header.classList.remove('sort-asc', 'sort-desc', 'sortable');

    // Add sortable class
    header.classList.add('sortable');

    // Add sort direction class if this column is currently sorted
    if (AppState.sort[tableType].column === column) {
        header.classList.add(AppState.sort[tableType].direction === 'asc' ? 'sort-asc' : 'sort-desc');
    }
}

// Update other load functions to store data and initialize sorting
function loadStores() {
    return fetch(`${API_BASE}/api/stores?admin=1`)
    .then(response => response.json())
    .then(data => {
        AppState.stores = data.stores || [];
        displayStores(AppState.stores);
        try { initializeAdminFilterMenus(); } catch (e) { console.warn('initializeAdminFilterMenus stores error', e); }
        initializeTableSorting('stores');
        attachStoreFilterListeners();
        loadGlobalDeliveryStatus();
        return AppState.stores;
    })
    .catch(error => {
        console.error('Error loading stores:', error);
        throw error;
    });
}

function attachStoreFilterListeners() {
    const searchInput = document.getElementById('storeSearch');
    const statusFilter = document.getElementById('storeStatusFilter');
    const clearBtn = document.getElementById('storeClearFiltersBtn');

    if (searchInput && !searchInput.dataset.boundStoreFilter) {
        searchInput.addEventListener('input', filterStores);
        searchInput.dataset.boundStoreFilter = '1';
    }
    if (statusFilter && !statusFilter.dataset.boundStoreFilter) {
        statusFilter.addEventListener('change', filterStores);
        statusFilter.dataset.boundStoreFilter = '1';
    }
    if (clearBtn && !clearBtn.dataset.boundStoreFilter) {
        clearBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            if (statusFilter) statusFilter.value = '';
            filterStores();
        });
        clearBtn.dataset.boundStoreFilter = '1';
    }
}

function filterStores() {
    const searchTerm = document.getElementById('storeSearch')?.value.toLowerCase();
    const status = document.getElementById('storeStatusFilter')?.value;

    let filtered = AppState.stores;

    if (searchTerm) {
        filtered = filtered.filter(store => 
            (store.name && store.name.toLowerCase().includes(searchTerm)) ||
            (store.location && store.location.toLowerCase().includes(searchTerm)) ||
            (store.owner_name && store.owner_name.toLowerCase().includes(searchTerm))
        );
    }

    if (status) {
        filtered = filtered.filter(store => {
            const isActive = store.is_active === true || store.is_active === 1 || store.is_active === '1';
            if (status === 'active') return isActive;
            if (status === 'inactive') return !isActive;
            return true;
        });
    }

    displayStores(filtered);
}

function displayStores(stores) {
    const tbody = document.getElementById('storesTableBody');
    tbody.innerHTML = '';

    const totalCount = stores.length;
    const activeCount = stores.filter(s => s.is_active === true || s.is_active === 1 || s.is_active === '1').length;
    const inactiveCount = totalCount - activeCount;

    document.getElementById('totalStoresCount').textContent = totalCount;
    document.getElementById('activeStoresCount').textContent = activeCount;
    document.getElementById('inactiveStoresCount').textContent = inactiveCount;

    stores.forEach(store => {
        const ownerDisplay = store.owner_name || '-';
        const priorityDisplay = store.priority ? `<span class="priority-badge priority-${store.priority}">P${store.priority}</span>` : '-';
        const active = store.is_active === true || store.is_active === 1 || store.is_active === '1';
        const customerVisible = store.is_customer_visible === undefined
            ? true
            : (store.is_customer_visible === true || store.is_customer_visible === 1 || store.is_customer_visible === '1');
        const customerVisibilityBadge = customerVisible
            ? `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;background:rgba(22,163,74,0.12);color:#166534;font-size:12px;font-weight:700;"><i class="fas fa-eye"></i> Visible</span>`
            : `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;background:rgba(107,114,128,0.16);color:#374151;font-size:12px;font-weight:700;"><i class="fas fa-eye-slash"></i> Hidden</span>`;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${store.id}</td>
            <td>${store.name}</td>
            <td>${store.location}</td>
            <td>${ownerDisplay}</td>
            <td>${store.rating} ⭐</td>
            <td>${priorityDisplay}</td>
            <td>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <span class="status-${active ? 'active' : 'inactive'}">${active ? 'Active' : 'Inactive'}</span>
                    ${customerVisibilityBadge}
                </div>
            </td>
            <td>
                <div class="action-buttons">
                    <button class="btn-small btn-edit" onclick="editStore(${store.id})">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button class="btn-small btn-info" onclick="showSetPriorityModal(${store.id}, '${store.name}', ${store.priority || 'null'})">
                        <i class="fas fa-star"></i> Priority
                    </button>
                    <button class="btn-small btn-danger" onclick="deleteStore(${store.id})">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>
            </td>
        `;
        const ensureHoverCard = () => {
            let card = document.getElementById('storeHoverCard');
            if (!card) {
                card = document.createElement('div');
                card.id = 'storeHoverCard';
                card.style.position = 'absolute';
                card.style.zIndex = '10000';
                card.style.display = 'none';
                card.style.minWidth = '260px';
                card.style.maxWidth = '320px';
                card.style.padding = '10px';
                card.style.borderRadius = '10px';
                card.style.boxShadow = '0 8px 24px rgba(0,0,0,0.18)';
                card.style.background = 'linear-gradient(180deg, #fff 0%, #f6f7fb 100%)';
                card.style.border = '1px solid #e5e7eb';
                card.style.pointerEvents = 'none';
                document.body.appendChild(card);
            }
            return card;
        };
        const renderCard = (s) => {
            const statusPillColor = s.is_active ? '#16a34a' : '#ef4444';
            const statusPillBg = s.is_active ? 'rgba(22,163,74,0.12)' : 'rgba(239,68,68,0.12)';
            const imgSrc = s.image_url ? String(s.image_url).trim().replace(/\\/g, '/') : '';
            const safeImg = imgSrc ? (imgSrc.startsWith('http') || imgSrc.startsWith('data:') ? imgSrc : (API_BASE.replace(/\/$/, '') + '/' + imgSrc.replace(/^\/+/, ''))) : '';
            const owner = s.owner_name || '-';
            const phone = s.phone || '';
            const email = s.email || '';
            const delivery = s.delivery_time || '';
            const address = s.address || '';
            const loc = s.location || '';
            const ratingBadge = `<div style="display:flex;align-items:center;gap:6px;"><span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:#ffd166;color:#4b5563;font-weight:700;">${typeof s.rating !== 'undefined' ? s.rating : 0}</span><span style="color:#64748b;font-size:13px;">Rating</span></div>`;
            const avatar = safeImg ? `<img src="${safeImg}" alt="${s.name}" style="width:56px;height:56px;border-radius:8px;object-fit:cover;border:1px solid #e5e7eb;">` : `<div style="width:56px;height:56px;border-radius:8px;background:#e5e7eb;border:1px solid #d1d5db;display:flex;align-items:center;justify-content:center;color:#6b7280;font-weight:700;">${(s.name||'S').slice(0,1).toUpperCase()}</div>`;
            const pill = `<span style="padding:4px 8px;border-radius:999px;font-size:12px;font-weight:600;display:inline-block;background:${statusPillBg};color:${statusPillColor};">${s.is_active ? 'Active' : 'Inactive'}</span>`;
            const label = (lbl, val) => `<div style="display:flex;gap:8px;align-items:flex-start;"><div style="width:88px;color:#9ca3af;font-size:12px;">${lbl}</div><div style="flex:1;color:#374151;font-size:13px;word-break:break-word;">${val || '-'}</div></div>`;
            return `
                <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;">
                    ${avatar}
                    <div style="flex:1;min-width:0;">
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                            <div style="font-weight:800;color:#1f2937;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;">${s.name || 'Store'}</div>
                            ${pill}
                        </div>
                        <div style="color:#64748b;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;">${loc || ''}</div>
                    </div>
                    ${ratingBadge}
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;">
                    ${label('Owner', owner)}
                    ${label('Phone', phone)}
                    ${label('Email', email)}
                    ${label('Delivery', delivery)}
                    ${label('Address', address)}
                </div>
            `;
        };
        const positionCard = (card, evt) => {
            const x = (evt.clientX || 0) + 16 + (window.scrollX || 0);
            const y = (evt.clientY || 0) + 16 + (window.scrollY || 0);
            const ww = window.innerWidth || document.documentElement.clientWidth || 800;
            const wh = window.innerHeight || document.documentElement.clientHeight || 600;
            card.style.display = 'block';
            card.style.left = x + 'px';
            card.style.top = y + 'px';
            const rect = card.getBoundingClientRect();
            if (rect.right > ww) card.style.left = Math.max(8, x - (rect.right - ww) - 24) + 'px';
            if (rect.bottom > wh) card.style.top = Math.max(8, y - (rect.bottom - wh) - 24) + 'px';
        };
        const isOverActions = (evt) => {
            const el = document.elementFromPoint(evt.clientX, evt.clientY);
            return !!(el && (el.closest('.action-buttons') || (el.closest('td') && el.closest('td').querySelector('.action-buttons'))));
        };
        const showCard = (evt) => {
            if (isOverActions(evt)) return;
            const card = ensureHoverCard();
            card.innerHTML = renderCard(store);
            positionCard(card, evt);
        };
        const moveCard = (evt) => {
            if (isOverActions(evt)) {
                const card = document.getElementById('storeHoverCard');
                if (card) card.style.display = 'none';
                return;
            }
            const card = document.getElementById('storeHoverCard');
            if (card && card.style.display !== 'none') positionCard(card, evt);
        };
        const hideCard = () => {
            const card = document.getElementById('storeHoverCard');
            if (card) card.style.display = 'none';
        };
        row.addEventListener('mouseenter', showCard);
        row.addEventListener('mousemove', moveCard);
        row.addEventListener('mouseleave', hideCard);
        tbody.appendChild(row);
    });
}

function loadCategories() {
    fetch(`${API_BASE}/api/categories?includeInactive=true&ts=${Date.now()}`, { cache: 'no-store' })
    .then(response => response.json())
    .then(data => {
        AppState.categories = data.categories || [];
        displayCategories(AppState.categories);
        try { initializeAdminFilterMenus(); } catch (e) { console.warn('initializeAdminFilterMenus categories error', e); }
        initializeTableSorting('categories');
    })
    .catch(error => console.error('Error loading categories:', error));
}

function displayCategories(categories) {
    const tbody = document.getElementById('categoriesTableBody');
    tbody.innerHTML = '';

    categories.forEach(category => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${category.id}</td>
            <td>${category.name}</td>
            <td>${category.description || ''}</td>
            <td><span class="status-${category.is_active ? 'active' : 'inactive'}">${category.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="btn-small btn-edit" onclick="editCategory(${category.id})">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button class="btn-small ${category.is_active ? 'btn-danger' : 'btn-success'}" onclick="toggleCategoryStatus(${category.id}, ${category.is_active})">
                        <i class="fas fa-${category.is_active ? 'ban' : 'check'}"></i> ${category.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function loadRiders() {
    return fetch(`${API_BASE}/api/riders`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    })
    .then(response => response.json())
    .then(data => {
        AppState.riders = data.riders || [];
        displayRiders(AppState.riders);
        try { initializeAdminFilterMenus(); } catch (e) { console.warn('initializeAdminFilterMenus riders error', e); }
        initializeTableSorting('riders');
        return AppState.riders;
    })
    .catch(error => {
        console.error('Error loading riders:', error);
        throw error;
    });
}

function displayRiders(riders) {
    const tbody = document.getElementById('ridersTableBody');
    tbody.innerHTML = '';

    riders.forEach(rider => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${rider.id}</td>
            <td>${rider.full_name || [rider.first_name || '', rider.last_name || ''].filter(Boolean).join(' ')}</td>
            <td>${rider.email}</td>
            <td>${rider.phone}</td>
            <td>${rider.vehicle_type}</td>
            <td>${rider.license_number}</td>
            <td><span class="status-${rider.is_available ? 'active' : 'inactive'}">${rider.is_available ? 'Available' : 'Unavailable'}</span></td>
            <td><span class="status-${rider.is_active ? 'active' : 'inactive'}">${rider.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="btn-small btn-edit" onclick="editRider(${rider.id})">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button class="btn-small ${rider.is_active ? 'btn-danger' : 'btn-success'}" onclick="toggleRiderStatus(${rider.id}, ${rider.is_active})">
                        <i class="fas fa-${rider.is_active ? 'ban' : 'check'}"></i> ${rider.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button class="btn-small btn-info" onclick="openFuelForRider(${rider.id})">
                        <i class="fas fa-gas-pump"></i> Fuel
                    </button>
                </div>
            </td>
        `;
        const ensureHoverCard = () => {
            let card = document.getElementById('riderHoverCard');
            if (!card) {
                card = document.createElement('div');
                card.id = 'riderHoverCard';
                card.style.position = 'absolute';
                card.style.zIndex = '10000';
                card.style.display = 'none';
                card.style.minWidth = '260px';
                card.style.maxWidth = '340px';
                card.style.padding = '10px';
                card.style.borderRadius = '10px';
                card.style.boxShadow = '0 8px 24px rgba(0,0,0,0.18)';
                card.style.background = 'linear-gradient(180deg, #fff 0%, #f6f7fb 100%)';
                document.body.appendChild(card);
            }
            return card;
        };
        const renderCard = (r) => {
            const name = r.full_name || [r.first_name || '', r.last_name || ''].filter(Boolean).join(' ') || 'Rider';
            const statusColor = r.is_available ? '#166534' : '#991b1b';
            const statusBg = r.is_available ? 'rgba(22,163,74,0.12)' : 'rgba(239,68,68,0.12)';
            let imgSrc = r.image_url ? String(r.image_url).trim().replace(/\\/g, '/') : '';
            if (imgSrc) {
                if (!(imgSrc.startsWith('http') || imgSrc.startsWith('data:'))) {
                    imgSrc = API_BASE.replace(/\/$/, '') + '/' + imgSrc.replace(/^\/+/, '');
                }
            }
            const avatar = imgSrc ? `<img src="${imgSrc}" alt="${name}" style="width:56px;height:56px;border-radius:8px;object-fit:cover;border:1px solid #e5e7eb;">` : `<div style="width:56px;height:56px;border-radius:8px;background:#e5e7eb;border:1px solid #d1d5db;display:flex;align-items:center;justify-content:center;color:#6b7280;font-weight:700;">${(name||'R').slice(0,1).toUpperCase()}</div>`;
            const pill = `<span style="padding:4px 8px;border-radius:999px;font-size:12px;font-weight:600;display:inline-block;background:${statusBg};color:${statusColor};">${r.is_available ? 'Available' : 'Unavailable'}</span>`;
            const label = (lbl, val) => `<div style="display:flex;gap:8px;align-items:flex-start;"><div style="width:88px;color:#9ca3af;font-size:12px;">${lbl}</div><div style="flex:1;color:#374151;font-size:13px;word-break:break-word;">${val || '-'}</div></div>`;
            const idImg = r.id_card_url ? `<img src="${(r.id_card_url.startsWith('http')||r.id_card_url.startsWith('data:'))?r.id_card_url:(API_BASE.replace(/\/$/,'')+'/'+r.id_card_url.replace(/^\/+/,''))}" alt="ID" style="width:56px;height:56px;border-radius:8px;object-fit:cover;border:1px solid #e5e7eb;">` : '';
            return `
                <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;">
                    ${avatar}
                    <div style="flex:1;min-width:0;">
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                            <div style="font-weight:800;color:#1f2937;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;">${name}</div>
                            ${pill}
                        </div>
                        <div style="color:#64748b;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;">${r.vehicle_type || ''}</div>
                    </div>
                    ${idImg}
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;">
                    ${label('Email', r.email || '')}
                    ${label('Phone', r.phone || '')}
                    ${label('License', r.license_number || '')}
                    ${label('Father', r.father_name || '')}
                    ${label('ID Card', r.id_card_num || '')}
                    ${label('Active', r.is_active ? 'Yes' : 'No')}
                </div>
            `;
        };
        const positionCard = (card, evt) => {
            const x = (evt.clientX || 0) + 16 + (window.scrollX || 0);
            const y = (evt.clientY || 0) + 16 + (window.scrollY || 0);
            const ww = window.innerWidth || document.documentElement.clientWidth || 800;
            const wh = window.innerHeight || document.documentElement.clientHeight || 600;
            card.style.display = 'block';
            card.style.left = x + 'px';
            card.style.top = y + 'px';
            const rect = card.getBoundingClientRect();
            if (rect.right > ww) card.style.left = Math.max(8, x - (rect.right - ww) - 24) + 'px';
            if (rect.bottom > wh) card.style.top = Math.max(8, y - (rect.bottom - wh) - 24) + 'px';
        };
        const isOverActions = (evt) => {
            const el = document.elementFromPoint(evt.clientX, evt.clientY);
            return !!(el && (el.closest('.action-buttons') || (el.closest('td') && el.closest('td').querySelector('.action-buttons'))));
        };
        const showCard = (evt) => {
            if (isOverActions(evt)) return;
            const card = ensureHoverCard();
            card.innerHTML = renderCard(rider);
            positionCard(card, evt);
        };
        const moveCard = (evt) => {
            if (isOverActions(evt)) {
                const card = document.getElementById('riderHoverCard');
                if (card) card.style.display = 'none';
                return;
            }
            const card = document.getElementById('riderHoverCard');
            if (card && card.style.display !== 'none') positionCard(card, evt);
        };
        const hideCard = () => {
            const card = document.getElementById('riderHoverCard');
            if (card) card.style.display = 'none';
        };
        row.addEventListener('mouseenter', showCard);
        row.addEventListener('mousemove', moveCard);
        row.addEventListener('mouseleave', hideCard);
        tbody.appendChild(row);
    });
}

// Open fuel panel for specific rider and load history
async function openFuelForRider(riderId) {
    const container = document.getElementById('rider-fuel-panel');
    if (!container) return;
    // open Riders tab and show the fuel sub-panel
    try {
        openRiderSubtab('fuel');
        await loadRidersForFuelSelect();
        const sel = document.getElementById('fuelRiderSelect');
        if (sel) {
            sel.value = String(riderId);
            await loadFuelHistory(sel.value);
        }
        // scroll into view
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
        console.error('openFuelForRider error:', e);
        showError('Error', 'Failed to open fuel panel');
    }
}

// Debug helper: highlight first column & print computed styles when ?debugTable=1 is present
function runDebugTableHighlight() {
    try {
        const table = document.querySelector('#ridersTable');
        if (!table) return console.log('Debug: No #ridersTable found');

        // highlight first column visually
        document.querySelectorAll('#ridersTable th:first-child, #ridersTable td:first-child').forEach(e=>{
            e.style.outline = '3px dashed red';
            e.style.background = 'rgba(255,0,0,0.03)';
        });

    } catch (err) {
        console.error('runDebugTableHighlight error:', err);
    }
}

// ===== PAYMENTS MANAGEMENT =====
async function loadPayments() {
    try {
        const response = await fetch(`${API_BASE}/api/admin/payments/stats`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const statsData = await response.json();
        if (statsData.success) {
            const stats = statsData.stats;
            document.getElementById('paymentsTotalRevenue').textContent = `PKR ${stats.total?.total_amount?.toFixed(2) || '0.00'}`;
            document.getElementById('paymentsSuccessCount').textContent = stats.successful?.total || 0;
            document.getElementById('paymentsPendingCount').textContent = stats.pending?.total || 0;
            document.getElementById('paymentsFailedCount').textContent = stats.failed?.total || 0;
            document.getElementById('paymentsTodayCount').textContent = stats.today?.count || 0;
            document.getElementById('paymentsTodayAmount').textContent = `PKR ${stats.today?.total?.toFixed(2) || '0.00'}`;
        }

        const listResponse = await fetch(`${API_BASE}/api/admin/payments?limit=200`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const listData = await listResponse.json();
        
        if (listData.success && listData.payments) {
            currentPayments = listData.payments;
            displayPayments(currentPayments);
            initializeTableSorting('payments');
        } else {
            currentPayments = [];
            displayPayments([]);
        }

        attachPaymentFilterListeners();
    } catch (error) {
        console.error('Load payments error:', error);
        showError('Payments', 'Failed to load payments');
    }
}

function displayPayments(payments) {
    const tbody = document.getElementById('paymentsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!payments || payments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">No payments found</td></tr>';
        return;
    }

    payments.forEach(payment => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${payment.id}</td>
            <td>#${payment.order_id}</td>
            <td>${payment.first_name} ${payment.last_name}</td>
            <td>PKR ${parseFloat(payment.amount).toFixed(2)}</td>
            <td><span class="badge badge-${payment.payment_method}">${payment.payment_method}</span></td>
            <td>${payment.gateway || 'N/A'}</td>
            <td><span class="badge badge-${payment.status}">${payment.status}</span></td>
            <td>${new Date(payment.created_at).toLocaleDateString()}</td>
            <td><button class="btn btn-small btn-info" onclick="viewPaymentDetails(${payment.id})">View</button></td>
        `;
        tbody.appendChild(row);
    });
}

function filterPayments() {
    const status = document.getElementById('paymentStatusFilter')?.value;
    const method = document.getElementById('paymentMethodFilter')?.value;
    const startDate = document.getElementById('paymentStartDate')?.value;
    const endDate = document.getElementById('paymentEndDate')?.value;

    let filtered = currentPayments;

    if (status) {
        filtered = filtered.filter(p => p.status === status);
    }
    if (method) {
        filtered = filtered.filter(p => p.payment_method === method);
    }
    if (startDate) {
        filtered = filtered.filter(p => new Date(p.created_at) >= new Date(startDate));
    }
    if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filtered = filtered.filter(p => new Date(p.created_at) <= end);
    }

    displayPayments(filtered);
}

function attachPaymentFilterListeners() {
    const filters = ['paymentStatusFilter', 'paymentMethodFilter', 'paymentStartDate', 'paymentEndDate'];
    filters.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', filterPayments);
    });

    document.getElementById('paymentClearFiltersBtn')?.addEventListener('click', () => {
        filters.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        displayPayments(currentPayments);
    });
}

async function viewPaymentDetails(paymentId) {
    try {
        const response = await fetch(`${API_BASE}/api/admin/payments/${paymentId}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        
        if (data.success) {
            const payment = data.payment;
            showInfo('Payment Details', `ID: ${payment.id}<br>Order: #${payment.order_id}<br>Customer: ${payment.first_name} ${payment.last_name}<br>Amount: PKR ${payment.amount}<br>Method: ${payment.payment_method}<br>Status: ${payment.status}<br>Date: ${new Date(payment.created_at).toLocaleString()}`, 6000);
        }
    } catch (error) {
        console.error('View payment details error:', error);
        showError('Payment Details', 'Failed to load payment details');
    }
}

// ===== WALLETS MANAGEMENT =====
async function loadWallets() {
    try {
        const response = await fetch(`${API_BASE}/api/admin/wallets/stats`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const statsData = await response.json();
        if (statsData.success) {
            const stats = statsData.stats;
            document.getElementById('walletsTotalBalance').textContent = `PKR ${stats.total_balance?.toFixed(2) || '0.00'}`;
            document.getElementById('walletsActiveCount').textContent = stats.active_wallets || 0;
            document.getElementById('walletsAutoRechargeCount').textContent = stats.with_auto_recharge || 0;
            document.getElementById('walletsTotalTransactions').textContent = stats.transactions?.total_transactions || 0;
            document.getElementById('walletsTotalCredited').textContent = `PKR ${stats.transactions?.total_credited?.toFixed(2) || '0.00'}`;
            document.getElementById('walletsTotalSpent').textContent = `PKR ${stats.transactions?.total_spent?.toFixed(2) || '0.00'}`;
        }

        const listResponse = await fetch(`${API_BASE}/api/admin/wallets?limit=200`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const listData = await listResponse.json();
        
        if (listData.success && listData.wallets) {
            currentWallets = listData.wallets;
            displayWallets(currentWallets);
            initializeTableSorting('wallets');
        } else {
            currentWallets = [];
            displayWallets([]);
        }

        attachWalletFilterListeners();
    } catch (error) {
        console.error('Load wallets error:', error);
        showError('Wallets', 'Failed to load wallets');
    }
}

function displayWallets(wallets) {
    const tbody = document.getElementById('walletsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!wallets || wallets.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">No wallets found</td></tr>';
        return;
    }

    wallets.forEach(wallet => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${wallet.id}</td>
            <td>${wallet.first_name} ${wallet.last_name}</td>
            <td>PKR ${parseFloat(wallet.balance).toFixed(2)}</td>
            <td>PKR ${parseFloat(wallet.total_credited).toFixed(2)}</td>
            <td>PKR ${parseFloat(wallet.total_spent).toFixed(2)}</td>
            <td>${wallet.auto_recharge_enabled ? '<span class="badge badge-success">Yes</span>' : '<span class="badge badge-danger">No</span>'}</td>
            <td>${new Date(wallet.updated_at).toLocaleDateString()}</td>
            <td>
                <button class="btn btn-small btn-info" onclick="viewWalletDetails(${wallet.id})">View</button>
                <button class="btn btn-small btn-warning" onclick="adjustWalletBalance(${wallet.id})">Adjust</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function filterWallets() {
    const minBal = parseFloat(document.getElementById('walletBalanceMin')?.value) || 0;
    const maxBal = parseFloat(document.getElementById('walletBalanceMax')?.value);

    let filtered = currentWallets;

    if (minBal > 0) {
        filtered = filtered.filter(w => parseFloat(w.balance) >= minBal);
    }
    if (!isNaN(maxBal)) {
        filtered = filtered.filter(w => parseFloat(w.balance) <= maxBal);
    }

    displayWallets(filtered);
}

function attachWalletFilterListeners() {
    const filters = ['walletBalanceMin', 'walletBalanceMax'];
    filters.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', filterWallets);
    });

    document.getElementById('walletClearFiltersBtn')?.addEventListener('click', () => {
        filters.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        displayWallets(currentWallets);
    });
}

async function viewWalletDetails(walletId) {
    try {
        const response = await fetch(`${API_BASE}/api/admin/wallets/${walletId}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        
        if (data.success) {
            const wallet = data.wallet;
            const txList = data.recent_transactions.slice(0, 5).map(tx => `  • ${tx.type.toUpperCase()}: PKR ${tx.amount} - ${tx.description}`).join('<br>');
            showInfo('Wallet Details', `ID: ${wallet.id}<br>User: ${wallet.first_name} ${wallet.last_name}<br>Balance: PKR ${wallet.balance}<br>Total Credited: PKR ${wallet.total_credited}<br>Total Spent: PKR ${wallet.total_spent}<br><br><b>Recent Transactions:</b><br>${txList || 'No transactions'}`, 8000);
        }
    } catch (error) {
        console.error('View wallet details error:', error);
        showError('Wallet Details', 'Failed to load wallet details');
    }
}

async function adjustWalletBalance(walletId) {
    const amount = prompt('Enter amount to adjust (positive for credit, negative for debit):');
    if (amount === null || amount === '') return;
    
    const reason = prompt('Enter reason for adjustment:');
    if (reason === null || reason === '') return;

    try {
        const response = await fetch(`${API_BASE}/api/admin/wallets/${walletId}/adjust`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ amount: parseFloat(amount), reason })
        });
        const data = await response.json();

        if (data.success) {
            showSuccess('Wallet Adjusted', `New balance: PKR ${data.new_balance}`);
            loadWallets();
        } else {
            showError('Adjustment Failed', data.message);
        }
    } catch (error) {
        console.error('Adjust wallet error:', error);
        showError('Adjustment Error', 'Failed to adjust wallet balance');
    }
}

// Auto-run when requested via URL param
document.addEventListener('DOMContentLoaded', function(){
    try {
        if (window.location && window.location.search && window.location.search.indexOf('debugTable=1') !== -1) {
            // give the page a moment to render tables
            setTimeout(runDebugTableHighlight, 600);
        }
    } catch (e) { /* ignore */ }
});

// ===== PROBLEMS & DIAGNOSTICS =====
async function loadProblemsDiagnostics() {
    const tbody = document.getElementById('diagnosticsTableBody');
    const checksRun = document.getElementById('problemsChecksRun');
    
    if (!tbody) return;
    
    // Auto-run if never run before (stats are empty)
    if (checksRun && checksRun.textContent.trim() === '-') {
        await runAllDiagnostics();
    } else if (tbody.innerHTML.trim() === '' || tbody.innerHTML.includes('loading')) {
        // Fallback message if for some reason stats are set but table is empty
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Click "Run All Diagnostics" to scan for issues.</td></tr>';
    }
}

async function runAllDiagnostics() {
    await runDiagnostics('all');
}

async function runSingleDiagnostic() {
    const type = document.getElementById('diagnosticType').value;
    await runDiagnostics(type);
}

async function runDiagnostics(type) {
    const runBtn = document.getElementById('runDiagnosticsBtn');
    const singleBtn = document.getElementById('runSingleDiagnosticBtn');
    const tbody = document.getElementById('diagnosticsTableBody');
    
    if (runBtn) runBtn.disabled = true;
    if (singleBtn) singleBtn.disabled = true;
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;"><i class="fas fa-spinner fa-spin"></i> Running diagnostics...</td></tr>';
    
    try {
        const response = await fetch(`${API_BASE}/api/admin/diagnostics?type=${type}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        
        if (data.success) {
            displayDiagnostics(data.results);
            showSuccess('Diagnostics Complete', `Finished running ${data.results.length} checks.`);
        } else {
            showError('Diagnostics Failed', data.message || 'Unknown error');
            if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: red;">Failed to load diagnostics.</td></tr>';
        }
    } catch (error) {
        console.error('Run diagnostics error:', error);
        showError('Diagnostics Error', 'Failed to connect to server');
        if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: red;">Error connecting to diagnostic service.</td></tr>';
    } finally {
        if (runBtn) runBtn.disabled = false;
        if (singleBtn) singleBtn.disabled = false;
    }
}

// ===== DATABASE UTILITIES =====
async function clearTransactionalData() {
    const tableSelect = document.getElementById('clearTableSelect');
    const table = tableSelect ? tableSelect.value : 'all';
    const pEl = document.getElementById('utilPassword');
    const password = pEl ? String(pEl.value || '') : '';
    
    let confirmMsg = 'Are you sure you want to clear ALL transactional data? This includes orders, payments, and history. Wallets will be reset to 0.';
    if (table === 'all_except_user_store') {
        confirmMsg = 'Are you sure you want to clear ALL tables except user/store related tables? This action cannot be undone.';
    } else if (table === 'all_except_core_keep') {
        confirmMsg = 'Are you sure you want to clear ALL tables except core operational tables (banks, categories, items, orders, order_items, products, product_size_prices, riders, sizes, stores, units, users, user_permissions)?';
    } else if (table === 'all_tables') {
        confirmMsg = 'Are you sure you want to clear ALL tables in the database? This is extremely destructive and cannot be undone.';
    } else if (table !== 'all') {
        confirmMsg = `Are you sure you want to clear table '${table}'? This action cannot be undone.`;
    }
    
    if (!confirm(confirmMsg)) return;
    
    // Double confirmation for safety
    const verification = prompt(`Type "CLEAR" to confirm deletion of ${table === 'all' ? 'ALL DATA' : table}:`);
    if (verification !== 'CLEAR') {
        showInfo('Cancelled', 'Deletion cancelled.');
        return;
    }
    if (!password) {
        showError('Clear Data', 'Enter super admin passphrase in Utilities (same as restore).');
        return;
    }
    
    try {
        const btn = document.getElementById('clearDataBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Clearing...';
        }
        
        const response = await fetch(`${API_BASE}/api/admin/clear-transactional-data`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ table, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showSuccess('Data Cleared', data.message);
            // Refresh dashboard stats if visible
            loadDashboardStats();
        } else {
            showError('Failed', data.message);
        }
    } catch (error) {
        console.error('Clear data error:', error);
        showError('Error', 'Failed to clear data');
    } finally {
        const btn = document.getElementById('clearDataBtn');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-trash-alt"></i> Clear Data';
        }
    }
}

async function loadClearableTables() {
    const tableSelect = document.getElementById('clearTableSelect');
    if (!tableSelect) return;

    const staticOptions = [
        { value: 'all', label: 'ALL Transactional Data (Orders, Payments, History)' },
        { value: 'all_except_user_store', label: 'ALL Tables EXCEPT User/Store Related' },
        { value: 'all_except_core_keep', label: 'Clear All EXCEPT Core Operational Tables' },
        { value: 'all_tables', label: 'ALL Tables (Dangerous)' }
    ];

    try {
        const response = await fetch(`${API_BASE}/api/admin/clearable-tables`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        if (!data.success || !Array.isArray(data.tables)) return;

        const current = tableSelect.value;
        tableSelect.innerHTML = '';

        staticOptions.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            tableSelect.appendChild(option);
        });

        const divider = document.createElement('option');
        divider.disabled = true;
        divider.textContent = '────────────';
        tableSelect.appendChild(divider);

        data.tables.forEach(t => {
            const option = document.createElement('option');
            option.value = t.name;
            option.textContent = t.protected
                ? `${t.name} (User/Store related)`
                : t.name;
            tableSelect.appendChild(option);
        });

        const hasCurrent = Array.from(tableSelect.options).some(o => o.value === current);
        tableSelect.value = hasCurrent ? current : 'all';
    } catch (error) {
        console.error('Failed to load clearable tables:', error);
    }
}

async function shrinkDatabase() {
    const confirmMsg = 'Optimize and shrink database now? This may take some time and can temporarily slow queries.';
    if (!confirm(confirmMsg)) return;

    const verification = prompt('Type "SHRINK" to confirm database optimization:');
    if (verification !== 'SHRINK') {
        showInfo('Cancelled', 'Database shrink cancelled.');
        return;
    }

    const btn = document.getElementById('shrinkDbBtn');
    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Shrinking...';
        }

        const response = await fetch(`${API_BASE}/api/admin/shrink-database`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });
        const data = await response.json();
        if (data.success) {
            showSuccess('Database Shrink Complete', data.message || 'Database optimized successfully.');
        } else {
            showError('Database Shrink', data.message || 'Shrink completed with errors.');
        }
    } catch (error) {
        console.error('shrinkDatabase error:', error);
        showError('Database Shrink', 'Failed to shrink database');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-compress-alt"></i> Shrink Database';
        }
    }
}

function displayDiagnostics(results) {
    const tbody = document.getElementById('diagnosticsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    let totalChecks = results.length;
    let totalIssues = 0;
    
    results.forEach(res => {
        totalIssues += res.issuesFound || 0;
        
        const row = document.createElement('tr');
        const statusClass = res.status.toLowerCase() === 'success' ? 'status-active' : (res.status.toLowerCase() === 'warning' ? 'status-pending' : 'status-inactive');
        
        row.innerHTML = `
            <td><strong>${res.type}</strong></td>
            <td><span class="${statusClass}">${res.status}</span></td>
            <td>${res.issuesFound || 0}</td>
            <td>${new Date(res.lastRun).toLocaleString()}</td>
            <td><small>${res.details || '-'}</small></td>
        `;
        tbody.appendChild(row);
    });
    
    // Update stats
    document.getElementById('problemsChecksRun').textContent = totalChecks;
    document.getElementById('problemsIssuesFound').textContent = totalIssues;
    document.getElementById('problemsLastRun').textContent = new Date().toLocaleTimeString();
}

async function applyRoleRestrictions() {
    if (!currentUser || currentUser.user_type !== 'standard_user') return;

    try {
        const response = await fetch(`${API_BASE}/api/permissions/my-permissions`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        
        if (data.success && data.permissions) {
            currentUserPermissions = new Set(data.permissions);
            const perms = currentUserPermissions;
            
            const tabRules = [
                { perms: ['menu_dashboard'], tabs: ['dashboard'] },
                { perms: ['menu_orders'], tabs: ['orders'] },
                { perms: ['menu_products'], tabs: ['products'] },
                { perms: ['menu_stores'], tabs: ['stores'] },
                { perms: ['menu_store_status', 'menu_stores'], tabs: ['store-status'] },
                { perms: ['menu_users'], tabs: ['accounts'] },
                { perms: ['menu_riders'], tabs: ['riders'] },
                { perms: ['menu_user_rights'], tabs: ['user-rights'] },
                { perms: ['menu_payments'], tabs: ['payments'] },
                { perms: ['menu_wallets', 'menu_payments'], tabs: ['wallets'] },

                { perms: ['menu_report_orders', 'menu_reports'], tabs: ['order-reports'] },
                { perms: ['menu_report_inventory', 'menu_reports'], tabs: ['inventory-report'] },
                { perms: ['menu_report_sales', 'menu_reports'], tabs: ['sale-reports'] },
                { perms: ['menu_report_riders', 'menu_reports'], tabs: ['rider-reports'] },
                { perms: ['menu_report_stores', 'menu_reports'], tabs: ['store-reports'] },
                { perms: ['menu_report_store_payment_terms', 'menu_reports'], tabs: ['store-payment-term-reports'] },
                { perms: ['menu_report_financial', 'menu_reports'], tabs: ['financial-reports'] },
                { perms: ['menu_financial_dashboard', 'menu_reports'], tabs: ['financial-dashboard'] },

                { perms: ['menu_categories', 'menu_settings'], tabs: ['categories'] },
                { perms: ['menu_units', 'menu_settings'], tabs: ['units'] },
                { perms: ['menu_sizes', 'menu_settings'], tabs: ['sizes'] },

                { perms: ['menu_financial_cpv', 'menu_financial'], tabs: ['payment-vouchers'] },
                { perms: ['menu_financial_settlements', 'menu_financial'], tabs: ['store-settlements'] },
                { perms: ['menu_financial_expenses', 'menu_financial'], tabs: ['expenses'] },
                { perms: ['menu_financial_crv', 'menu_financial'], tabs: ['receipt-vouchers'] },
                { perms: ['menu_financial_rider_cash', 'menu_financial'], tabs: ['rider-cash'] },
                { perms: ['menu_financial_bpv', 'menu_financial'], tabs: ['bank-payment-vouchers'] },
                { perms: ['menu_financial_brv', 'menu_financial'], tabs: ['bank-receipt-vouchers'] },
                { perms: ['menu_financial_jnv', 'menu_financial'], tabs: ['journal-vouchers'] },

                { perms: ['menu_settings_general', 'menu_settings'], tabs: ['settings'] },
                { perms: ['menu_settings_backup', 'menu_settings_database', 'menu_settings'], tabs: ['db-backup'] },
                { perms: ['menu_settings_problems', 'menu_settings'], tabs: ['problems'] }
            ];

            // Hide everything first (default deny)
            const allTabs = document.querySelectorAll('.tab-link');
            allTabs.forEach(link => {
                link.style.display = 'none';
                if (link.closest('li')) link.closest('li').style.display = 'none';
            });
            
            const showTab = (tabId) => {
                const links = document.querySelectorAll(`.tab-link[data-tab="${tabId}"]`);
                links.forEach(link => {
                    link.style.display = 'block';
                    if (link.closest('li')) link.closest('li').style.display = 'block';
                });
                const link = document.querySelector(`.tab-link[data-tab="${tabId}"]`);
                if (link) {
                    const dropdown = link.closest('.dropdown');
                    if (dropdown) dropdown.style.display = 'block';
                }
            };

            const hasAnyPerm = (keys) => keys.some((k) => perms.has(k));

            // Special handling for dashboard: show if user has orders permission too
            if (!perms.has('menu_dashboard') && perms.has('menu_orders')) {
                showTab('dashboard');
            }

            tabRules.forEach((rule) => {
                if (hasAnyPerm(rule.perms)) {
                    rule.tabs.forEach(showTab);
                }
            });
            
            // Special handling for Financial Reports tab:
            // If the user has ANY individual report permission (starting with report_), show the main 'financial-reports' tab
            let hasAnyReportPerm = false;
            for (let p of perms) {
                if (p.startsWith('report_')) {
                    hasAnyReportPerm = true;
                    break;
                }
            }

            if (hasAnyReportPerm) {
                // Show financial-reports tab
                const links = document.querySelectorAll(`.tab-link[data-tab="financial-reports"]`);
                links.forEach(link => {
                    link.style.display = 'block';
                    if (link.closest('li')) link.closest('li').style.display = 'block';
                });
                // Ensure parent dropdown is visible if applicable
                const link = document.querySelector(`.tab-link[data-tab="financial-reports"]`);
                if (link) {
                    const dropdown = link.closest('.dropdown');
                    if (dropdown) dropdown.style.display = 'block';
                }
            }

            // Handle Actions
            if (!perms.has('action_edit_order')) {
                // Hide edit buttons in orders
                const style = document.createElement('style');
                style.innerHTML = `#ordersTable .btn-edit { display: none !important; }`;
                document.head.appendChild(style);
            }
            
            // Manage Categories
            if (!perms.has('action_manage_categories')) {
                const btn = document.getElementById('addCategoryBtn');
                if (btn) btn.style.display = 'none';
                
                const style = document.createElement('style');
                style.innerHTML = `#categoriesTable .btn-edit, #categoriesTable .btn-delete { display: none !important; }`;
                document.head.appendChild(style);
            }

            // Manage Units
            if (!perms.has('action_manage_units')) {
                const btn = document.getElementById('addUnitBtn');
                if (btn) btn.style.display = 'none';
                
                const style = document.createElement('style');
                style.innerHTML = `#unitsTable .btn-edit, #unitsTable .btn-delete { display: none !important; }`;
                document.head.appendChild(style);
            }

            // Manage Sizes
            if (!perms.has('action_manage_sizes')) {
                const btn = document.getElementById('addSizeBtn');
                if (btn) btn.style.display = 'none';
                
                const style = document.createElement('style');
                style.innerHTML = `#sizesTable .btn-edit, #sizesTable .btn-delete { display: none !important; }`;
                document.head.appendChild(style);
            }

            const reportSelectIds = ['reportTypeFilter', 'financialReportType'];
            const permMap = {
                'daily_summary': 'report_daily_summary',
                'weekly_summary': 'report_weekly_summary',
                'monthly_summary': 'report_monthly_summary',
                'store_settlement': 'report_store_settlement',
                'store_financials': 'report_store_financials',
                'store_payable_reconciliation': 'report_store_payable_reconciliation',
                'unsettled_amounts_report': 'report_unsettled_amounts',
                'cash_discrepancy_report': 'report_cash_discrepancy',
                'store_order_settlement_report': 'report_store_order_settlement',
                'periodic_sales_report': 'report_periodic_sales',
                'periodic_credit_cash_report': 'report_periodic_credit_cash',
                'periodic_comprehensive_summary_report': 'report_periodic_comprehensive_summary',
                'periodic_store_payments_balance_report': 'report_periodic_store_payments_balance',
                'rider_cash_report': 'report_rider_cash',
                'rider_fuel_report': 'report_rider_fuel',
                'rider_orders_report': 'report_rider_orders',
                'rider_payments_report': 'report_rider_payments',
                'rider_receivings_report': 'report_rider_receivings',
                'rider_petrol_report': 'report_rider_petrol',
                'rider_daily_mileage_report': 'report_rider_daily_mileage',
                'rider_daily_activity_report': 'report_rider_daily_activity',
                'rider_day_closing_report': 'report_rider_day_closing',
                'order_profit_report': 'report_order_profit',
                'general_voucher': 'report_general_voucher',
                'expense_report': 'report_expense',
                'custom': 'report_custom',
                'comprehensive_report': 'report_comprehensive_cash',
                'transaction_summary': 'report_transactions_summary',
                'delivery_charges_breakdown': 'report_delivery_charges',
                'order_wise_sale_summary': 'report_order_summary'
            };

            reportSelectIds.forEach((selectId) => {
                const reportTypeSelect = document.getElementById(selectId);
                if (!reportTypeSelect) return;
                const reportOptions = reportTypeSelect.querySelectorAll('option');
                reportOptions.forEach(opt => {
                    if (!opt.value) return;
                    const requiredPerm = permMap[opt.value];
                    if (requiredPerm && !perms.has(requiredPerm)) {
                        opt.disabled = true;
                        opt.hidden = true;
                        opt.style.display = 'none';
                    }
                });
            });
        }
    } catch (e) {
        console.error('Error applying permissions:', e);
    }
}

// --- User Rights Management ---

const RIGHTS_STATE = {
    groups: [],
    users: [],
    selectedGroupId: ''
};

const AVAILABLE_PERMISSIONS = [
    { key: 'menu_dashboard', label: 'Dashboard', group: 'Menus - Core' },
    { key: 'menu_orders', label: 'Orders', group: 'Menus - Core' },
    { key: 'menu_products', label: 'Products', group: 'Menus - Core' },
    { key: 'menu_stores', label: 'Stores', group: 'Menus - Core' },
    { key: 'menu_store_status', label: 'Store Status', group: 'Menus - Core' },
    { key: 'menu_payments', label: 'Payments', group: 'Menus - Core' },
    { key: 'menu_wallets', label: 'Wallets', group: 'Menus - Core' },

    { key: 'menu_users', label: 'Users', group: 'Menus - Accounts' },
    { key: 'menu_riders', label: 'Riders', group: 'Menus - Accounts' },
    { key: 'menu_user_rights', label: 'User Rights', group: 'Menus - Accounts' },

    { key: 'menu_report_orders', label: 'Order Reports', group: 'Menus - Reports' },
    { key: 'menu_report_inventory', label: 'Inventory Report', group: 'Menus - Reports' },
    { key: 'menu_report_sales', label: 'Sale Reports', group: 'Menus - Reports' },
    { key: 'menu_report_riders', label: 'Rider Reports', group: 'Menus - Reports' },
    { key: 'menu_report_stores', label: 'Store Reports', group: 'Menus - Reports' },
    { key: 'menu_report_store_payment_terms', label: 'Store Payment Term Report', group: 'Menus - Reports' },
    { key: 'menu_report_financial', label: 'Financial Reports', group: 'Menus - Reports' },
    { key: 'menu_financial_dashboard', label: 'Financial Dashboard', group: 'Menus - Reports' },

    { key: 'menu_categories', label: 'Categories', group: 'Menus - Catalog' },
    { key: 'menu_units', label: 'Units', group: 'Menus - Catalog' },
    { key: 'menu_sizes', label: 'Sizes', group: 'Menus - Catalog' },

    { key: 'menu_financial_cpv', label: 'CPV (Cash Payment Voucher)', group: 'Menus - Financial' },
    { key: 'menu_financial_settlements', label: 'Store Settlements', group: 'Menus - Financial' },
    { key: 'menu_financial_expenses', label: 'Expenses', group: 'Menus - Financial' },
    { key: 'menu_financial_crv', label: 'CRV (Cash Receive Voucher)', group: 'Menus - Financial' },
    { key: 'menu_financial_rider_cash', label: 'Rider Cash', group: 'Menus - Financial' },
    { key: 'menu_financial_bpv', label: 'BPV (Bank Payment Voucher)', group: 'Menus - Financial' },
    { key: 'menu_financial_brv', label: 'BRV (Bank Receive Voucher)', group: 'Menus - Financial' },
    { key: 'menu_financial_jnv', label: 'JNV (Journal Voucher)', group: 'Menus - Financial' },

    { key: 'menu_settings_general', label: 'Settings', group: 'Menus - System' },
    { key: 'menu_settings_backup', label: 'Utilities / DB Backup', group: 'Menus - System' },
    { key: 'menu_settings_problems', label: 'Problems & Diagnostics', group: 'Menus - System' },
    { key: 'menu_settings_database', label: 'Database Tools (Restricted)', group: 'Menus - System' },

    { key: 'action_edit_order', label: 'Edit Order / Assign Rider', group: 'Actions' },
    { key: 'action_manage_products', label: 'Add/Edit Products', group: 'Actions' },
    { key: 'action_manage_stores', label: 'Add/Edit Stores', group: 'Actions' },
    { key: 'action_manage_categories', label: 'Add/Edit Categories', group: 'Actions' },
    { key: 'action_manage_units', label: 'Add/Edit Units', group: 'Actions' },
    { key: 'action_manage_sizes', label: 'Add/Edit Sizes', group: 'Actions' },

    { key: 'report_sales', label: 'Sales Reports API', group: 'Reports - Operational' },
    { key: 'report_inventory', label: 'Inventory Reports API', group: 'Reports - Operational' },
    { key: 'report_rider_performance', label: 'Rider Performance Reports', group: 'Reports - Operational' },

    { key: 'report_daily_summary', label: 'Daily Summary', group: 'Reports - Financial Types' },
    { key: 'report_weekly_summary', label: 'Weekly Summary', group: 'Reports - Financial Types' },
    { key: 'report_monthly_summary', label: 'Monthly Summary', group: 'Reports - Financial Types' },
    { key: 'report_store_settlement', label: 'Store Settlement', group: 'Reports - Financial Types' },
    { key: 'report_store_financials', label: 'Store Financials', group: 'Reports - Financial Types' },
    { key: 'report_store_payable_reconciliation', label: 'Store Payable Reconciliation', group: 'Reports - Financial Types' },
    { key: 'report_unsettled_amounts', label: 'Unsettled Amounts', group: 'Reports - Financial Types' },
    { key: 'report_cash_discrepancy', label: 'Cash Discrepancy', group: 'Reports - Financial Types' },
    { key: 'report_store_order_settlement', label: 'Store Order Settlement', group: 'Reports - Financial Types' },
    { key: 'report_periodic_sales', label: 'Periodic Sales', group: 'Reports - Financial Types' },
    { key: 'report_periodic_credit_cash', label: 'Periodic Credit Cash', group: 'Reports - Financial Types' },
    { key: 'report_periodic_comprehensive_summary', label: 'Periodic Comprehensive Summary', group: 'Reports - Financial Types' },
    { key: 'report_periodic_store_payments_balance', label: 'Periodic Store Payments & Balance', group: 'Reports - Financial Types' },
    { key: 'report_rider_cash', label: 'Rider Cash Report', group: 'Reports - Financial Types' },
    { key: 'report_rider_fuel', label: 'Rider Fuel Report', group: 'Reports - Financial Types' },
    { key: 'report_rider_orders', label: 'Rider Orders Report', group: 'Reports - Financial Types' },
    { key: 'report_rider_payments', label: 'Rider Payments Report', group: 'Reports - Financial Types' },
    { key: 'report_rider_receivings', label: 'Rider Receivings Report', group: 'Reports - Financial Types' },
    { key: 'report_rider_petrol', label: 'Rider Petrol Report', group: 'Reports - Financial Types' },
    { key: 'report_rider_daily_mileage', label: 'Rider Daily Mileage Report', group: 'Reports - Financial Types' },
    { key: 'report_rider_daily_activity', label: 'Rider Daily Activity Report', group: 'Reports - Financial Types' },
    { key: 'report_rider_day_closing', label: 'Rider Day Closing Report', group: 'Reports - Financial Types' },
    { key: 'report_order_profit', label: 'Order Profit Report', group: 'Reports - Financial Types' },
    { key: 'report_general_voucher', label: 'General Voucher (JNV)', group: 'Reports - Financial Types' },
    { key: 'report_expense', label: 'Expense Report', group: 'Reports - Financial Types' },
    { key: 'report_custom', label: 'Custom Report', group: 'Reports - Financial Types' },

    { key: 'menu_reports', label: 'All Reports (Legacy)', group: 'Legacy' },
    { key: 'menu_financial', label: 'All Financial Vouchers (Legacy)', group: 'Legacy' },
    { key: 'menu_settings', label: 'All Settings & Catalog (Legacy)', group: 'Legacy' }
];

function renderPermissionsGrid() {
    const grid = document.getElementById('permissionsGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const groups = new Map();
    AVAILABLE_PERMISSIONS.forEach((perm) => {
        if (!groups.has(perm.group)) groups.set(perm.group, []);
        groups.get(perm.group).push(perm);
    });

    groups.forEach((perms, groupName) => {
        const groupDiv = document.createElement('div');
        groupDiv.innerHTML = `<h4 style="border-bottom: 1px solid #eee; padding-bottom: 5px; margin-bottom: 10px; color: #2c3e50;">${groupName}</h4>`;
        perms.forEach((perm) => {
            const label = document.createElement('label');
            label.style.display = 'flex';
            label.style.alignItems = 'center';
            label.style.marginBottom = '8px';
            label.style.cursor = 'pointer';
            label.innerHTML = `
                <input type="checkbox" name="permissions" value="${perm.key}" style="margin-right: 10px; width: 18px; height: 18px;">
                <span>${perm.label}</span>
            `;
            groupDiv.appendChild(label);
        });
        grid.appendChild(groupDiv);
    });
}

function applyPermissionsToGrid(permissions) {
    document.querySelectorAll('#permissionsGrid input[type="checkbox"]').forEach(cb => cb.checked = false);
    (permissions || []).forEach((key) => {
        const cb = document.querySelector(`#permissionsGrid input[value="${key}"]`);
        if (cb) cb.checked = true;
    });
}

function getSelectedPermissionsFromGrid() {
    return Array.from(document.querySelectorAll('#permissionsGrid input[name="permissions"]:checked')).map(cb => cb.value);
}

function updateGroupSelects() {
    const groupSelect = document.getElementById('rightsGroupSelect');
    const userGroupSelect = document.getElementById('rightsUserGroupSelect');
    if (!groupSelect || !userGroupSelect) return;

    const selectedGroupId = RIGHTS_STATE.selectedGroupId;
    groupSelect.innerHTML = '<option value="">Select a group...</option>';
    userGroupSelect.innerHTML = '<option value="">No Group</option>';

    RIGHTS_STATE.groups.forEach((g) => {
        const opt = document.createElement('option');
        opt.value = String(g.id);
        opt.textContent = g.name;
        groupSelect.appendChild(opt);

        const opt2 = document.createElement('option');
        opt2.value = String(g.id);
        opt2.textContent = g.name;
        userGroupSelect.appendChild(opt2);
    });

    if (selectedGroupId && RIGHTS_STATE.groups.some((g) => String(g.id) === String(selectedGroupId))) {
        groupSelect.value = String(selectedGroupId);
    }
}

function updateUserSelect() {
    const select = document.getElementById('rightsUserSelect');
    if (!select) return;
    select.innerHTML = '<option value="">Select a user...</option>';
    RIGHTS_STATE.users.forEach((u) => {
        const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || `User #${u.id}`;
        const email = u.email ? ` (${u.email})` : '';
        const groupTag = u.group_name ? ` - ${u.group_name}` : '';
        const opt = document.createElement('option');
        opt.value = String(u.id);
        opt.textContent = `${name}${email}${groupTag}`;
        select.appendChild(opt);
    });
}

function renderGroupMeta(group) {
    const meta = document.getElementById('rightsGroupMeta');
    if (!meta) return;
    if (!group) {
        meta.textContent = 'Select a group to view details.';
        return;
    }
    const members = group.member_count ?? 0;
    const permissions = group.permissions_count ?? 0;
    meta.textContent = `Members: ${members} | Permissions: ${permissions}`;
}

function renderGroupMembers(groupId) {
    const wrap = document.getElementById('rightsGroupMembers');
    if (!wrap) return;
    if (!groupId) {
        wrap.textContent = '';
        return;
    }
    const members = RIGHTS_STATE.users.filter((u) => String(u.group_id || '') === String(groupId));
    if (!members.length) {
        wrap.textContent = 'No members assigned to this group.';
        return;
    }
    const labels = members.map((u) => {
        const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || `User #${u.id}`;
        const email = u.email ? ` (${u.email})` : '';
        return `${name}${email}`;
    });
    wrap.innerHTML = `<strong>Members (${members.length}):</strong> ${escapeHtml(labels.join(', '))}`;
}

function renderGroupUsersSummary() {
    const wrap = document.getElementById('rightsGroupUsersSummary');
    if (!wrap) return;

    const groups = RIGHTS_STATE.groups || [];
    const users = RIGHTS_STATE.users || [];

    if (!groups.length && !users.length) {
        wrap.textContent = 'No groups or users loaded yet.';
        return;
    }

    const usersByGroup = new Map();
    const ungrouped = [];

    users.forEach((u) => {
        if (!u.group_id) {
            ungrouped.push(u);
            return;
        }
        const gid = String(u.group_id);
        if (!usersByGroup.has(gid)) usersByGroup.set(gid, []);
        usersByGroup.get(gid).push(u);
    });

    const cards = [];
    groups.forEach((g) => {
        const gid = String(g.id);
        const members = usersByGroup.get(gid) || [];
        const names = members.map((u) => {
            const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || `User #${u.id}`;
            const email = u.email ? ` (${u.email})` : '';
            return `${name}${email}`;
        });
        const list = names.length ? escapeHtml(names.join(', ')) : '<em>No users assigned</em>';
        cards.push(`
            <div style="padding: 0.75rem 0.85rem; border: 1px solid #eee; border-radius: 8px; background: #fafafa;">
              <div style="font-weight: 700; color: #2c3e50; margin-bottom: 0.35rem;">
                ${escapeHtml(g.name || 'Unnamed Group')} <span style="color: #888; font-weight: 500;">(${members.length})</span>
              </div>
              <div style="font-size: 0.9rem; color: #555;">${list}</div>
            </div>
        `);
    });

    if (ungrouped.length) {
        const names = ungrouped.map((u) => {
            const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || `User #${u.id}`;
            const email = u.email ? ` (${u.email})` : '';
            return `${name}${email}`;
        });
        cards.push(`
            <div style="padding: 0.75rem 0.85rem; border: 1px dashed #e5e5e5; border-radius: 8px; background: #fff;">
              <div style="font-weight: 700; color: #2c3e50; margin-bottom: 0.35rem;">
                No Group <span style="color: #888; font-weight: 500;">(${ungrouped.length})</span>
              </div>
              <div style="font-size: 0.9rem; color: #555;">${escapeHtml(names.join(', '))}</div>
            </div>
        `);
    }

    wrap.innerHTML = cards.join('');
}

async function loadRightsGroups() {
    try {
        const response = await fetch(`${API_BASE}/api/permissions/groups`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        if (data.success) {
            RIGHTS_STATE.groups = Array.isArray(data.groups) ? data.groups : [];
        } else {
            RIGHTS_STATE.groups = [];
        }
        updateGroupSelects();
        renderGroupUsersSummary();
    } catch (e) {
        console.error('Error loading groups for rights:', e);
        RIGHTS_STATE.groups = [];
        updateGroupSelects();
        renderGroupUsersSummary();
    }
}

async function loadRightsUsers() {
    try {
        const response = await fetch(`${API_BASE}/api/permissions/users`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        if (data.success) {
            RIGHTS_STATE.users = Array.isArray(data.users) ? data.users : [];
        } else {
            RIGHTS_STATE.users = [];
        }
        updateUserSelect();
        renderGroupUsersSummary();
    } catch (e) {
        console.error('Error loading users for rights:', e);
        RIGHTS_STATE.users = [];
        updateUserSelect();
        renderGroupUsersSummary();
    }
}

async function setSelectedGroup(groupId) {
    RIGHTS_STATE.selectedGroupId = groupId || '';
    const group = RIGHTS_STATE.groups.find((g) => String(g.id) === String(groupId));
    const nameInput = document.getElementById('rightsGroupNameInput');
    const descInput = document.getElementById('rightsGroupDescInput');
    if (nameInput) nameInput.value = group ? group.name || '' : '';
    if (descInput) descInput.value = group ? group.description || '' : '';
    renderGroupMeta(group);
    renderGroupMembers(groupId);

    if (!groupId) {
        applyPermissionsToGrid([]);
        return;
    }

    try {
        const permRes = await fetch(`${API_BASE}/api/permissions/group/${groupId}/permissions`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const permData = await permRes.json();
        if (permData.success) {
            applyPermissionsToGrid(permData.permissions || []);
        } else {
            applyPermissionsToGrid([]);
        }
    } catch (e) {
        console.error('Error fetching group permissions:', e);
        applyPermissionsToGrid([]);
    }
}

function bindRightsHandlers() {
    const groupSelect = document.getElementById('rightsGroupSelect');
    if (groupSelect) {
        groupSelect.onchange = () => {
            const groupId = groupSelect.value;
            setSelectedGroup(groupId);
        };
    }

    const userSelect = document.getElementById('rightsUserSelect');
    const userGroupSelect = document.getElementById('rightsUserGroupSelect');
    if (userSelect && userGroupSelect) {
        userSelect.onchange = () => {
            const userId = userSelect.value;
            const user = RIGHTS_STATE.users.find((u) => String(u.id) === String(userId));
            userGroupSelect.value = user?.group_id ? String(user.group_id) : '';
        };
    }

    const selectAllBtn = document.getElementById('selectAllRightsBtn');
    if (selectAllBtn) {
        selectAllBtn.onclick = () => {
            document.querySelectorAll('#permissionsGrid input[type="checkbox"]').forEach(cb => cb.checked = true);
        };
    }

    const deselectAllBtn = document.getElementById('deselectAllRightsBtn');
    if (deselectAllBtn) {
        deselectAllBtn.onclick = () => {
            document.querySelectorAll('#permissionsGrid input[type="checkbox"]').forEach(cb => cb.checked = false);
        };
    }

    const createBtn = document.getElementById('createRightsGroupBtn');
    if (createBtn) {
        createBtn.onclick = async () => {
            const name = (document.getElementById('rightsGroupNameInput')?.value || '').trim();
            const description = (document.getElementById('rightsGroupDescInput')?.value || '').trim();
            if (!name) {
                showWarning('Missing Name', 'Please enter a group name.');
                return;
            }
            try {
                const response = await fetch(`${API_BASE}/api/permissions/groups`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authToken}`
                    },
                    body: JSON.stringify({ name, description })
                });
                const data = await response.json();
                if (!data.success) {
                    showError('Create Failed', data.message || 'Failed to create group');
                    return;
                }
                showSuccess('Group Created', 'Group created successfully.');
                RIGHTS_STATE.selectedGroupId = String(data.group_id || '');
                await loadRightsGroups();
                if (RIGHTS_STATE.selectedGroupId) {
                    const select = document.getElementById('rightsGroupSelect');
                    if (select) select.value = RIGHTS_STATE.selectedGroupId;
                    await setSelectedGroup(RIGHTS_STATE.selectedGroupId);
                }
            } catch (err) {
                console.error('Error creating group:', err);
                showError('Create Failed', 'Failed to create group');
            }
        };
    }

    const updateBtn = document.getElementById('updateRightsGroupBtn');
    if (updateBtn) {
        updateBtn.onclick = async () => {
            const groupId = RIGHTS_STATE.selectedGroupId;
            if (!groupId) {
                showWarning('Select Group', 'Please select a group to update.');
                return;
            }
            const name = (document.getElementById('rightsGroupNameInput')?.value || '').trim();
            const description = (document.getElementById('rightsGroupDescInput')?.value || '').trim();
            if (!name) {
                showWarning('Missing Name', 'Please enter a group name.');
                return;
            }
            try {
                const response = await fetch(`${API_BASE}/api/permissions/groups/${groupId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authToken}`
                    },
                    body: JSON.stringify({ name, description })
                });
                const data = await response.json();
                if (!data.success) {
                    showError('Update Failed', data.message || 'Failed to update group');
                    return;
                }
                showSuccess('Group Updated', 'Group details updated.');
                await loadRightsGroups();
                await setSelectedGroup(groupId);
            } catch (err) {
                console.error('Error updating group:', err);
                showError('Update Failed', 'Failed to update group');
            }
        };
    }

    const deleteBtn = document.getElementById('deleteRightsGroupBtn');
    if (deleteBtn) {
        deleteBtn.onclick = async () => {
            const groupId = RIGHTS_STATE.selectedGroupId;
            if (!groupId) {
                showWarning('Select Group', 'Please select a group to delete.');
                return;
            }
            if (!confirm('Delete this group? Assigned users will lose their rights.')) return;
            try {
                const response = await fetch(`${API_BASE}/api/permissions/groups/${groupId}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${authToken}` }
                });
                const data = await response.json();
                if (!data.success) {
                    showError('Delete Failed', data.message || 'Failed to delete group');
                    return;
                }
                showSuccess('Group Deleted', 'Group removed successfully.');
                RIGHTS_STATE.selectedGroupId = '';
                await loadRightsGroups();
                await loadRightsUsers();
                applyPermissionsToGrid([]);
                renderGroupMeta(null);
                renderGroupMembers('');
            } catch (err) {
                console.error('Error deleting group:', err);
                showError('Delete Failed', 'Failed to delete group');
            }
        };
    }

    const assignBtn = document.getElementById('assignUserToGroupBtn');
    if (assignBtn) {
        assignBtn.onclick = async () => {
            const userId = document.getElementById('rightsUserSelect')?.value;
            const groupId = document.getElementById('rightsUserGroupSelect')?.value || null;
            if (!userId) {
                showWarning('Select User', 'Please choose a user to assign.');
                return;
            }
            try {
                const response = await fetch(`${API_BASE}/api/permissions/user/${userId}/group`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authToken}`
                    },
                    body: JSON.stringify({ group_id: groupId ? Number(groupId) : null })
                });
                const data = await response.json();
                if (!data.success) {
                    showError('Assign Failed', data.message || 'Failed to assign group');
                    return;
                }
                showSuccess('Assigned', 'User group updated successfully.');
                await loadRightsUsers();
                await loadRightsGroups();
                if (RIGHTS_STATE.selectedGroupId) {
                    await setSelectedGroup(RIGHTS_STATE.selectedGroupId);
                } else {
                    renderGroupMembers('');
                }
            } catch (err) {
                console.error('Error assigning group:', err);
                showError('Assign Failed', 'Failed to assign group');
            }
        };
    }

    const form = document.getElementById('groupRightsForm');
    if (form) {
        form.onsubmit = async (e) => {
            e.preventDefault();
            const groupId = RIGHTS_STATE.selectedGroupId;
            if (!groupId) {
                showWarning('Select Group', 'Please select a group to save rights.');
                return;
            }
            const selected = getSelectedPermissionsFromGrid();
            try {
                const response = await fetch(`${API_BASE}/api/permissions/group/${groupId}/permissions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authToken}`
                    },
                    body: JSON.stringify({ permissions: selected })
                });
                const data = await response.json();
                if (data.success) {
                    showSuccess('Saved', 'Group rights updated successfully');
                    await loadRightsGroups();
                    await setSelectedGroup(groupId);
                } else {
                    showError('Error', data.message || 'Failed to save');
                }
            } catch (err) {
                console.error('Error saving group permissions:', err);
                showError('Error', 'Failed to save permissions');
            }
        };
    }
}

async function loadUserRights() {
    renderPermissionsGrid();
    await Promise.all([loadRightsGroups(), loadRightsUsers()]);
    bindRightsHandlers();
    if (RIGHTS_STATE.selectedGroupId) {
        await setSelectedGroup(RIGHTS_STATE.selectedGroupId);
    }
}
