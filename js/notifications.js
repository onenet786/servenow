(function() {
    // Prevent duplicate initialization when the script is loaded multiple times
    if (window.__serveNowNotificationsInitialized) {
        console.warn('[Notifications] Already initialized — skipping duplicate init.');
        return;
    }
    window.__serveNowNotificationsInitialized = true;
    if (typeof io === 'undefined') {
        console.warn('Socket.IO client not loaded. Real-time notifications unavailable.');
        return;
    }

    // Ensure API_BASE is properly set
    const socketUrl = API_BASE || window.location.origin;
    const socket = io(socketUrl, {
        auth: { token: localStorage.getItem('serveNowToken') || '' },
        autoConnect: Boolean(localStorage.getItem('serveNowToken')),
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5
    });
    const eventListeners = new Map();

    // Notification bell management
    const notificationsStore = [];
    const MAX_NOTIFICATIONS = 20;
    let notifyPermissionRequested = false;
    const systemNotifyDedup = new Map();
    const recentSocketEvents = new Map();

    function pruneOldEntries(store, maxAgeMs) {
        const now = Date.now();
        for (const [key, timestamp] of Array.from(store.entries())) {
            if ((now - timestamp) > maxAgeMs) {
                store.delete(key);
            }
        }
    }

    function buildSocketEventKey(eventName, data) {
        if (!data || typeof data !== 'object') return '';
        const fields = [
            data.event_id,
            data.notification_id,
            data.id,
            data.order_id,
            data.order_number,
            data.user_id,
            data.rider_id,
            data.store_id,
            data.status,
            data.payment_status,
            data.type,
            data.title,
            data.message
        ]
            .map((value) => String(value || '').trim())
            .filter(Boolean);
        if (!fields.length) return '';
        return [eventName, ...fields.slice(0, 8)].join('|');
    }

    function shouldProcessSocketEvent(eventName, data, windowMs = 10000) {
        if (
            eventName === 'heartbeat' ||
            eventName === 'connect' ||
            eventName === 'reconnect' ||
            eventName === 'connect_error' ||
            eventName === 'rider_location_update'
        ) {
            return true;
        }
        const key = buildSocketEventKey(eventName, data);
        if (!key) return true;
        pruneOldEntries(recentSocketEvents, windowMs * 2);
        const now = Date.now();
        const lastSeenAt = recentSocketEvents.get(key) || 0;
        if ((now - lastSeenAt) < windowMs) {
            console.debug('[Notifications] Duplicate socket event suppressed:', key);
            return false;
        }
        recentSocketEvents.set(key, now);
        return true;
    }

    function addEventListener(owner, listener) {
        if (!owner || typeof listener !== 'function') return;
        eventListeners.set(owner, listener);
    }

    function removeEventListener(owner) {
        if (!owner) return;
        eventListeners.delete(owner);
    }

    function emitEvent(eventName, data) {
        if (eventListeners.size === 0) return;
        const payload = (data && typeof data === 'object') ? { ...data } : { value: data };
        const event = {
            ...payload,
            event: eventName,
            socket_event: eventName,
            data: { ...payload }
        };
        if (!event.type) {
            event.type = eventName;
        }
        for (const listener of Array.from(eventListeners.values())) {
            try {
                listener({ ...event });
            } catch (error) {
                console.warn('[Notifications] Event listener failed for', eventName, error);
            }
        }
    }

    function canSystemNotify() {
        return 'Notification' in window && Notification.permission === 'granted';
    }

    function ensureNotifyPermission() {
        if (!('Notification' in window)) return;
        if (Notification.permission === 'default' && !notifyPermissionRequested) {
            notifyPermissionRequested = true;
            try { Notification.requestPermission(); } catch (_) {}
        }
    }

    function systemNotify(title, body) {
        const key = `${String(title || '').trim()}|${String(body || '').trim()}`;
        const now = Date.now();
        const last = systemNotifyDedup.get(key) || 0;
        if ((now - last) < 10000) return true;
        if (typeof window.__serveNowSystemNotifyHandler === 'function') {
            try {
                const handled = window.__serveNowSystemNotifyHandler(title, body, { socket });
                if (handled && typeof handled.then === 'function') {
                    systemNotifyDedup.set(key, now);
                    handled.catch(() => {});
                    return true;
                }
                if (handled) {
                    systemNotifyDedup.set(key, now);
                    return true;
                }
            } catch (_) {}
        }
        if (window.__serveNowDisableSystemNotify) return false;
        ensureNotifyPermission();
        if (!canSystemNotify()) return false;
        systemNotifyDedup.set(key, now);
        try {
            new Notification(title, { body });
            return true;
        } catch (_) {
            return false;
        }
    }

    function emitUserIdentification() {
        const user = getCurrentUser();
        const token = localStorage.getItem('serveNowToken') || '';
        socket.auth = { token };
        if (user && token && !socket.connected) {
            socket.connect();
            return;
        }
        if (user && socket.connected) {
            socket.emit('identify_user');
            console.log(`[Socket] Identified as user ${user.id} (${user.user_type})`, 'Socket ID:', socket.id);
        }
    }

    function isAdminLikeUser(user) {
        if (!user) return false;
        return user.user_type === 'admin' || user.user_type === 'standard_user';
    }

    socket.on('connect', () => {
        console.log('[Socket] Connected to server. Socket ID:', socket.id);
        emitUserIdentification();
        ensureNotifyPermission();
        emitEvent('connect', { socket_id: socket.id });
    });

    socket.on('reconnect', () => {
        console.log('[Socket] Reconnected to server. Socket ID:', socket.id);
        emitUserIdentification();
        ensureNotifyPermission();
        emitEvent('reconnect', { socket_id: socket.id });
    });

    socket.on('connect_error', (error) => {
        emitEvent('connect_error', {
            message: error && error.message ? error.message : String(error || '')
        });
    });

    socket.on('heartbeat', (data) => {
        emitEvent('heartbeat', data);
    });

    function playNotificationSound() {
        try {
            // Mixkit notification sound
            const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
            audio.play().catch(e => console.log('Audio play failed:', e));
        } catch (e) {
            console.error('Error playing sound:', e);
        }
    }

    function getCurrentUser() {
        try {
            const userData = localStorage.getItem('serveNowUser');
            return userData ? JSON.parse(userData) : null;
        } catch (e) {
            return null;
        }
    }

    // Notification Bell UI Management
    function initNotificationBell() {
        const bellBtn = document.getElementById('notificationBellBtn');
        const dropdown = document.getElementById('notificationDropdown');
        const clearBtn = document.getElementById('clearNotificationsBtn');

        if (!bellBtn || !dropdown) return;

        // Toggle dropdown
        bellBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('active');
            bellBtn.classList.toggle('active');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.notification-bell-container')) {
                dropdown.classList.remove('active');
                bellBtn.classList.remove('active');
            }
        });

        // Clear notifications
        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.preventDefault();
                notificationsStore.length = 0;
                renderNotifications();
            });
        }

        // Close dropdown when selecting a notification
        dropdown.addEventListener('click', (e) => {
            if (e.target.closest('.notification-item')) {
                dropdown.classList.remove('active');
                bellBtn.classList.remove('active');
            }
        });
    }

    function addNotification(title, message, type = 'info', icon = 'fa-info-circle') {
        const notification = {
            id: Date.now(),
            title,
            message,
            type,
            icon,
            timestamp: new Date(),
            unread: true
        };

        // Suppress rapid duplicate notifications: ignore if same title+message
        // was added very recently (within DUPLICATE_WINDOW_MS)
        const DUPLICATE_WINDOW_MS = 5000; // 5 seconds
        const now = Date.now();
        const foundRecent = notificationsStore.some(n => {
            try {
                const nTime = n.timestamp instanceof Date ? n.timestamp.getTime() : new Date(n.timestamp).getTime();
                return n.title === title && n.message === message && (now - nTime) < DUPLICATE_WINDOW_MS;
            } catch (e) {
                return false;
            }
        });

        if (foundRecent) return; // ignore duplicate

        notificationsStore.unshift(notification);

        // Keep only last 20 notifications
        if (notificationsStore.length > MAX_NOTIFICATIONS) {
            notificationsStore.pop();
        }

        renderNotifications();
        updateBadge();
        playNotificationSound();
    }

    function renderNotifications() {
        const list = document.getElementById('notificationList');
        if (!list) return;

        if (notificationsStore.length === 0) {
            list.innerHTML = `
                <div class="notification-empty">
                    <i class="fas fa-bell-slash"></i>
                    <p>No notifications</p>
                </div>
            `;
            return;
        }

        list.innerHTML = notificationsStore.map((notif) => {
            const timeAgo = getTimeAgo(notif.timestamp);
            return `
                <div class="notification-item ${notif.unread ? 'unread' : ''}">
                    <i class="fas ${notif.icon} notification-icon"></i>
                    <div class="notification-content">
                        <div class="notification-title">${escapeHtml(notif.title)}</div>
                        <div class="notification-message">${escapeHtml(notif.message)}</div>
                        <div class="notification-time">${timeAgo}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function updateBadge() {
        const unreadCount = notificationsStore.filter(n => n.unread).length;
        const badge = document.getElementById('notificationBadge');
        
        if (badge) {
            if (unreadCount > 0) {
                badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }
    }

    function getTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);
        
        if (seconds < 60) return 'Just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        return `${Math.floor(seconds / 86400)}d ago`;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }



    // Remove any existing handlers to prevent duplicates
    socket.off('new_order');
    socket.off('rider_notification');
    socket.off('user_notification');
    socket.off('notification');
    socket.off('order_status_update');
    socket.off('payment_status_update');
    socket.off('order_completed');
    socket.off('rider_location_update');

    // Admin Notifications: New Order
    socket.on('new_order', (data) => {
        if (!shouldProcessSocketEvent('new_order', data)) return;
        emitEvent('new_order', data);
        const user = getCurrentUser();
        if (isAdminLikeUser(user)) {
            addNotification(
                'New Order Received',
                `Order ${data.order_number} - PKR ${data.total_amount}`,
                'success',
                'fa-shopping-bag'
            );
            if (!systemNotify('New Order Received', `Order ${data.order_number} • PKR ${data.total_amount}`)) {
                if (typeof showToast === 'function') showToast('New Order Received', `Order ${data.order_number} - PKR ${data.total_amount}`, 'success', 2000);
            }
            
            // Refresh admin dashboards if present
            if (typeof loadOrders === 'function') loadOrders();
            if (typeof loadDashboardStats === 'function') loadDashboardStats();
        }
    });

    // Rider Notifications
    socket.on('rider_notification', (data) => {
        if (!shouldProcessSocketEvent('rider_notification', data)) return;
        emitEvent('rider_notification', data);
        const user = getCurrentUser();
        if (user && user.user_type === 'rider' && user.id == data.rider_id) {
            addNotification(
                'New Assignment',
                data.message,
                'info',
                'fa-tasks'
            );
            if (!systemNotify('New Assignment', data.message)) {
                if (typeof showToast === 'function') showToast('New Assignment', data.message, 'info', 2000);
            }
            
            // Refresh rider dashboard if function exists
            if (typeof switchTab === 'function') {
                switchTab('assigned');
            } else if (typeof displayRiderDeliveries === 'function') {
                displayRiderDeliveries();
            }
            if (typeof loadRiderWallet === 'function') loadRiderWallet();
        }
    });

    // User Notifications
    socket.on('user_notification', (data) => {
        if (!shouldProcessSocketEvent('user_notification', data)) return;
        emitEvent('user_notification', data);
        const user = getCurrentUser();
        if (user && (user.id == data.user_id || isAdminLikeUser(user))) {
            if (!data || data.type === 'refresh_orders' || !data.message) {
                if (typeof displayOrders === 'function') displayOrders();
                if (typeof loadOrders === 'function') loadOrders();
                return;
            }
            addNotification(
                'Order Update',
                data.message,
                'info',
                'fa-box'
            );
            if (!systemNotify('Order Update', data.message)) {
                if (typeof showToast === 'function') showToast('Order Update', data.message, 'info', 2000);
            }
            
            // Refresh orders if function exists (e.g. on orders.html)
            if (typeof displayOrders === 'function') displayOrders();
        }
    });

    // Generic Notification events (server may emit for picked_up/ready)
    socket.on('notification', (data) => {
        if (!shouldProcessSocketEvent('notification', data)) return;
        emitEvent('notification', data);
        const user = getCurrentUser();
        if (!user) return;
        const title = data.title || 'Notification';
        const message = data.message || '';
        if (!message) return;
        const icon = data.icon || 'fa-bell';
        addNotification(title, message, 'info', icon);
        if (!systemNotify(title, message)) {
            if (typeof showToast === 'function') showToast(title, message, 'info', 2000);
        }
        if (typeof displayOrders === 'function') displayOrders();
        if (typeof loadOrders === 'function') loadOrders();
    });

    // Order Status Updates (Generic)
    socket.on('order_status_update', (data) => {
        if (!shouldProcessSocketEvent('order_status_update', data)) return;
        emitEvent('order_status_update', data);
        const user = getCurrentUser();
        if (user && (user.id == data.user_id || isAdminLikeUser(user))) {
            // Add to bell notifications
            let icon = 'fa-clock';
            if (data.status === 'delivered') icon = 'fa-check-circle';
            if (data.status === 'confirmed') icon = 'fa-check';
            
            addNotification(
                `Order ${data.status.charAt(0).toUpperCase() + data.status.slice(1)}`,
                `Order ${data.order_number}`,
                'info',
                icon
            );

            // Refresh data for both User and Admin
            if (typeof displayOrders === 'function') displayOrders();
            if (typeof loadOrders === 'function') loadOrders();
            
            if (isAdminLikeUser(user) && data.status === 'delivered') {
                if (!systemNotify('Order Delivered', `Order ${data.order_number} delivered`)) {
                    if (typeof showToast === 'function') showToast('Order Delivered', `Order ${data.order_number} delivered`, 'info', 2000);
                }
            }
        }
    });

    socket.on('rider_location_update', (data) => {
        emitEvent('rider_location_update', data);
    });

    // Payment Status Updates
    socket.on('payment_status_update', (data) => {
        if (!shouldProcessSocketEvent('payment_status_update', data)) return;
        emitEvent('payment_status_update', data);
        const user = getCurrentUser();
        if (user && (user.id == data.user_id || isAdminLikeUser(user))) {
            addNotification(
                'Payment ' + (data.payment_status === 'paid' ? 'Received' : 'Update'),
                `Order ${data.order_number}`,
                data.payment_status === 'paid' ? 'success' : 'info',
                data.payment_status === 'paid' ? 'fa-check-circle' : 'fa-money-bill'
            );

            if (typeof displayOrders === 'function') displayOrders();
            if (typeof loadOrders === 'function') loadOrders();
            
            if (isAdminLikeUser(user) && data.payment_status === 'paid') {
                if (!systemNotify('Payment Received', `Order ${data.order_number} payment confirmed`)) {
                    if (typeof showToast === 'function') showToast('Payment Received', `Order ${data.order_number} payment confirmed`, 'success', 2000);
                }
            }
        }
    });

    // Order Completed
    socket.on('order_completed', (data) => {
        if (!shouldProcessSocketEvent('order_completed', data)) return;
        emitEvent('order_completed', data);
        const user = getCurrentUser();
        if (user && user.id == data.user_id) {
            addNotification(
                'Order Completed',
                data.message || 'Your order has been delivered. Thank you!',
                'success',
                'fa-check-circle'
            );
            if (!systemNotify('Order Completed', data.message || 'Thanks for ordering with ServeNow.')) {
                if (typeof showToast === 'function') showToast('Order Completed', data.message || 'Thanks for ordering with ServeNow.', 'success', 2000);
            }
            if (typeof displayOrders === 'function') displayOrders();
        }
        
        if (isAdminLikeUser(user)) {
            addNotification(
                'Order Fully Completed',
                `Order ${data.order_number}`,
                'success',
                'fa-check-double'
            );
            if (!systemNotify('Order Fully Completed', `Order ${data.order_number} delivered and paid`)) {
                if (typeof showToast === 'function') showToast('Order Fully Completed', `Order ${data.order_number} delivered and paid`, 'success', 2000);
            }
            if (typeof loadOrders === 'function') loadOrders();
        }
    });

    // Initialize notification bell when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initNotificationBell);
    } else {
        initNotificationBell();
    }

    window.ServeNowNotifications = Object.assign(
        window.ServeNowNotifications || {},
        {
            addEventListener,
            removeEventListener,
            identifyCurrentUser: emitUserIdentification,
            getCurrentUser,
            getSocket: () => socket,
            isConnected: () => !!socket.connected,
            addNotification
        }
    );

})();
