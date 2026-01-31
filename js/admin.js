// Admin Dashboard JavaScript
// Use full origin to avoid relative-path edge cases
// Expose a diagnostics object early so console helpers are always available
window._adminDiag = window._adminDiag || {};

// API_BASE, currentUser, and authToken are provided by app.js (loaded in admin.html)
let currentOrders = [];
let currentProducts = [];
let currentAccounts = [];
let currentStores = [];
let currentCategories = [];
let currentRiders = [];
let editingProductId = null;
let editingAccountId = null;
let editingStoreId = null;
let editingCategoryId = null;
let editingRiderId = null;
let currentUnits = [];
let currentSizes = [];
let editingUnitId = null;
let editingSizeId = null;
let productStoreTermsById = {};

// Chart references
window['statusChart'] = null;
window['revenueChart'] = null;

// Sorting state for each table
let sortState = {
    products: { column: 'id', direction: 'asc' },
    users: { column: 'id', direction: 'asc' },
    accounts: { column: 'id', direction: 'asc' },
    stores: { column: 'id', direction: 'asc' },
    categories: { column: 'id', direction: 'asc' },
    riders: { column: 'id', direction: 'asc' },
    orders: { column: 'order_number', direction: 'asc' },
    payments: { column: 'id', direction: 'asc' },
    wallets: { column: 'id', direction: 'asc' }
};

// ===== MODERN TOAST NOTIFICATION SYSTEM =====
function showToast(title, message, type = 'info', duration = 3000) {
    const toastContainer = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };
    
    toast.innerHTML = `
        <div class="toast-icon">${icons[type] || '•'}</div>
        <div class="toast-content">
            <h4 class="toast-title">${title}</h4>
            <p class="toast-message">${message}</p>
        </div>
        <button class="toast-close" onclick="this.closest('.toast').remove()">✕</button>
        <div class="toast-progress"></div>
    `;
    
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

// ===== REAL-TIME NOTIFICATIONS =====
let socket;
if (typeof io !== 'undefined') {
    socket = io();
    
    socket.on('connect', () => {
        console.log('Connected to notification server. ID:', socket.id);
        showInfo('System', 'Connected to real-time notification server.');
    });

    socket.on('heartbeat', (data) => {
        console.debug('Heartbeat received:', data.time);
        window._adminDiag.lastHeartbeat = new Date();
    });

    socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
    });

    socket.on('new_user', (data) => {
        showInfo('New User Registered', `${data.first_name} ${data.last_name} (${data.user_type}) has joined.`);
        
        // Update data if on relevant tab
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
        showInfo('New Order Placed', `Order #${data.order_number} received. Total: $${data.total_amount}`);
        
        // Update data if on relevant tab
        const activeTab = document.querySelector('.tab-link.active');
        if (activeTab) {
            const tabId = activeTab.getAttribute('data-tab');
            if (tabId === 'dashboard') {
                if (typeof loadDashboardStats === 'function') loadDashboardStats();
                if (typeof loadRecentActivity === 'function') loadRecentActivity();
            } else if (tabId === 'orders') {
                if (typeof window.loadOrders === 'function') window.loadOrders();
            }
        }
    });

    socket.on('order_assigned', (data) => {
        showSuccess('Order Assigned', `Order #${data.order_number} assigned to ${data.rider_name}.`);
        if (typeof window.loadOrders === 'function') window.loadOrders();
        if (typeof loadDashboardStats === 'function') loadDashboardStats();
    });

    socket.on('order_status_update', (data) => {
        showInfo('Order Status Updated', `Order #${data.order_number} is now ${data.status}.`);
        if (typeof window.loadOrders === 'function') window.loadOrders();
        if (typeof loadDashboardStats === 'function') loadDashboardStats();
    });

    socket.on('payment_status_update', (data) => {
        showInfo('Payment Status Updated', `Order #${data.order_number} payment is now ${data.payment_status}.`);
        if (typeof window.loadOrders === 'function') window.loadOrders();
        if (typeof loadDashboardStats === 'function') loadDashboardStats();
    });

    socket.on('order_completed', (data) => {
        showSuccess('Order Completed', `Order #${data.order_number} has been delivered and paid.`);
        if (typeof window.loadOrders === 'function') window.loadOrders();
        if (typeof loadDashboardStats === 'function') loadDashboardStats();
    });
}

// Initialize admin dashboard
document.addEventListener('DOMContentLoaded', function() {
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
                if (data.user.user_type === 'admin') {
                    currentUser = data.user;
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
    document.getElementById('addUnitBtn').addEventListener('click', () => showAddUnitModal());
    document.getElementById('addSizeBtn').addEventListener('click', () => showAddSizeModal());

    // Logout functionality
    document.getElementById('logoutBtn').addEventListener('click', function(e) {
        e.preventDefault();
        localStorage.removeItem('serveNowToken');
        window.location.href = 'login.html';
    });

    // Tab switching
    const tabLinks = document.querySelectorAll('.tab-link');

    tabLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            switchTab(this.dataset.tab);
        });
    });

    // Handle right-click on dropdown toggles is now handled by native browser menu using href
    
    // Load initial dashboard data
    const initialTab = window.location.hash ? window.location.hash.substring(1) : 'dashboard';
    if (initialTab && initialTab !== 'dashboard') {
        switchTab(initialTab);
    } else {
        loadDashboardStats();
    }

    // Listen for hash changes to switch tabs
    window.addEventListener('hashchange', () => {
        const tab = window.location.hash.substring(1);
        if (tab) switchTab(tab);
    });

    // Add event listeners for modal open buttons
    document.getElementById('addAccountBtn').addEventListener('click', () => showAddAccountModal());
    document.getElementById('addStoreBtn').addEventListener('click', () => showAddStoreModal());
    document.getElementById('addProductBtn').addEventListener('click', () => showAddProductModal());
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
    let addUnitBtn = document.getElementById('addUnitBtn');
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

    let addSizeBtn = document.getElementById('addSizeBtn');
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
    const filterStartDate = document.getElementById('filterStartDate');
    const filterEndDate = document.getElementById('filterEndDate');
    const filterRider = document.getElementById('filterRider');
    const clearFiltersBtn = document.getElementById('clearFiltersBtn');

    if (filterStartDate) {
        filterStartDate.addEventListener('change', filterOrders);
    }
    if (filterEndDate) {
        filterEndDate.addEventListener('change', filterOrders);
    }
    if (filterRider) {
        filterRider.addEventListener('change', filterOrders);
    }
    const filterStatus = document.getElementById('filterStatus');
    if (filterStatus) {
        filterStatus.addEventListener('change', filterOrders);
    }
    const filterAssignment = document.getElementById('filterAssignment');
    if (filterAssignment) {
        filterAssignment.addEventListener('change', filterOrders);
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
    const storeClearFiltersBtn = document.getElementById('storeClearFiltersBtn');
    if (storeSearch) storeSearch.addEventListener('input', filterStores);
    if (storeStatusFilter) storeStatusFilter.addEventListener('change', filterStores);
    if (storeClearFiltersBtn) storeClearFiltersBtn.addEventListener('click', clearStoreFilters);

    // Products filters
    const productSearch = document.getElementById('productSearch');
    const productCategoryFilter = document.getElementById('productCategoryFilter');
    const productStoreFilter = document.getElementById('productStoreFilter');
    const productStatusFilter = document.getElementById('productStatusFilter');
    const productClearFiltersBtn = document.getElementById('productClearFiltersBtn');
    if (productSearch) productSearch.addEventListener('input', filterProducts);
    if (productCategoryFilter) productCategoryFilter.addEventListener('change', filterProducts);
    if (productStoreFilter) productStoreFilter.addEventListener('change', filterProducts);
    if (productStatusFilter) productStatusFilter.addEventListener('change', filterProducts);
    if (productClearFiltersBtn) productClearFiltersBtn.addEventListener('click', clearProductFilters);

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
        const fsd = document.getElementById('filterStartDate');
        if (fsd && !fsd.value) fsd.value = todayDate;
        const fed = document.getElementById('filterEndDate');
        if (fed && !fed.value) fed.value = todayDate;
        const rsd = document.getElementById('reportStartDate');
        if (rsd && !rsd.value) rsd.value = todayDate;
        const red = document.getElementById('reportEndDate');
        if (red && !red.value) red.value = todayDate;
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
    if (fuelRiderSelect) fuelRiderSelect.addEventListener('change', function() {
        if (this.value) loadFuelHistory(this.value);
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
        if (c) { try { c.readOnly = true; } catch(_) {} }
        if (!s || !e) return;
        const recalc = () => {
            const sv = parseFloat(String(s.value || '').replace(/[^\d.]/g, ''));
            const ev = parseFloat(String(e.value || '').replace(/[^\d.]/g, ''));
            if (Number.isFinite(sv) && Number.isFinite(ev)) {
                if (ev <= sv) {
                    if (d) d.value = '';
                    if (c) c.value = '';
                    showWarning('Invalid Meter', 'End meter must be greater than start meter');
                    return;
                }
                const dist = ev - sv;
                if (d) d.value = dist.toFixed(2);
                const rate = parseFloat(String(r && r.value || '').replace(/[^\d.]/g, ''));
                if (Number.isFinite(rate) && c) c.value = (rate * dist).toFixed(2);
            } else {
                if (d) d.value = '';
                if (c) c.value = '';
            }
        };
        const recalcCostOnly = () => {
            const rate = parseFloat(String(r && r.value || '').replace(/[^\d.]/g, ''));
            const dist = parseFloat(String(d && d.value || '').replace(/[^\d.]/g, ''));
            if (Number.isFinite(rate) && Number.isFinite(dist) && c) c.value = (rate * dist).toFixed(2);
        };
        s.addEventListener('input', recalc);
        e.addEventListener('input', recalc);
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
                if (nowOpen) {
                    const rect = this.getBoundingClientRect();
                    menu.style.position = 'fixed';
                    menu.style.left = Math.round(rect.left) + 'px';
                    menu.style.top = Math.round(rect.bottom) + 'px';
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
            const rect = openToggle.getBoundingClientRect();
            menu.style.position = 'fixed';
            menu.style.left = Math.round(rect.left) + 'px';
            menu.style.top = Math.round(rect.bottom) + 'px';
            menu.style.zIndex = '5000';
            menu.style.maxHeight = 'none';
            menu.style.overflow = 'visible';
        };
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, true);
    }
} catch (e) { /* ignore */ }

}

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

function switchTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab-link').forEach(link => {
        link.classList.remove('active');
    });

    // Show selected tab (defensive: ensure elements exist)
    const tabEl = document.getElementById(tabName);
    const linkEl = document.querySelector(`[data-tab="${tabName}"]`);
    if (!tabEl || !linkEl) {
        console.warn('switchTab: tab or link not found for', tabName);
        return;
    }
    tabEl.classList.add('active');
    linkEl.classList.add('active');

    // Update URL hash without jumping
    if (window.location.hash !== '#' + tabName) {
        history.pushState(null, null, '#' + tabName);
    }

    // Load data for the tab
    switch(tabName) {
        case 'accounts':
            loadAccounts();
            break;
        case 'stores':
            loadStores();
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
        case 'order-reports':
            // Reports tab doesn't need initial loading, user will generate reports manually
            break;
        case 'inventory-report':
            loadInventoryReport();
            break;
        case 'db-backup':
            // Load list of available backups when backup tab is opened
            loadBackups();
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
        case 'receipt-vouchers':
            if (typeof window['loadReceiptVouchers'] === 'function') window['loadReceiptVouchers']();
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

async function createBackup() {
    showInfo('Backup', 'Creating database backup...');
    try {
        const resp = await fetch(`${API_BASE}/api/admin/backup-db`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
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
                    <button class="btn btn-small" onclick="downloadBackup('${encodeURIComponent(b.filename)}')">Download</button>
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
    if (!u || !p) { showError('Restore', 'Enter super admin username and password'); return; }
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
        const today = new Date();
        const isSameDay = (d) => {
            try {
                const dt = new Date(d);
                return dt.getFullYear() === today.getFullYear() &&
                       dt.getMonth() === today.getMonth() &&
                       dt.getDate() === today.getDate();
            } catch (_) { return false; }
        };
        const todayOrders = list.filter(o => isSameDay(o.created_at));
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

function renderActivityList(containerId, items) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    if (!items || items.length === 0) {
        container.innerHTML = '<p style="color:#718096;font-size:0.9rem;font-style:italic;">No recent activity</p>';
        return;
    }

    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'activity-item';
        div.innerHTML = `
            <div class="title">${item.title}</div>
            <div class="subtitle">${item.subtitle}</div>
            <div class="meta">
                <span>${new Date(item.timestamp).toLocaleDateString()}</span>
                <span>${new Date(item.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
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
        if (e.target === modal) modal.remove();
    };
}

function loadAccounts() {
    fetch(`${API_BASE}/api/users`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    })
    .then(response => response.json())
    .then(data => {
        currentAccounts = data.users || [];
        displayAccounts(currentAccounts);
        loadAccountStats();
        initializeTableSorting('accounts');
    })
    .catch(error => {
        console.error('Error loading accounts:', error);
        showError('Error', 'Failed to load accounts');
    });
}

function loadAccountStats() {
    const total = currentAccounts.length;
    const active = currentAccounts.filter(a => a.is_active === true || a.is_active === 1 || a.is_active === '1').length;
    const inactive = currentAccounts.filter(a => a.is_active !== true && a.is_active !== 1 && a.is_active !== '1').length;
    const verified = currentAccounts.filter(a => a.is_verified === true || a.is_verified === 1 || a.is_verified === '1').length;

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
                    <button class="btn-small btn-secondary" onclick="toggleAccountStatus(${account.id}, ${isActive})">
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

function showAddAccountModal() {
    document.getElementById('editAccountForm').reset();
    document.getElementById('editAccountId').value = '';
    document.querySelector('#editAccountModal h3').textContent = 'Add New Account';
    showModal('editAccountModal');
}

function editAccount(accountId) {
    const account = currentAccounts.find(a => a.id === accountId);
    if (!account) {
        showError('Error', 'Account not found');
        return;
    }

    editingAccountId = accountId;
    const isActive = account.is_active === true || account.is_active === 1 || account.is_active === '1';
    const isVerified = account.is_verified === true || account.is_verified === 1 || account.is_verified === '1';
    
    document.getElementById('editAccountId').value = accountId;
    document.getElementById('editAccountFirstName').value = account.first_name || '';
    document.getElementById('editAccountLastName').value = account.last_name || '';
    document.getElementById('editAccountEmail').value = account.email || '';
    document.getElementById('editAccountPhone').value = account.phone || '';
    document.getElementById('editAccountType').value = account.user_type || 'customer';
    document.getElementById('editAccountStatus').value = isActive ? '1' : '0';
    document.getElementById('editAccountVerified').value = isVerified ? '1' : '0';
    document.getElementById('editAccountAddress').value = account.address || '';
    document.getElementById('editAccountPassword').value = '';
    document.querySelector('#editAccountModal h3').textContent = 'Edit Account';
    showModal('editAccountModal');
}

function saveAccount() {
    const accountId = document.getElementById('editAccountId').value;
    const firstName = document.getElementById('editAccountFirstName').value;
    const lastName = document.getElementById('editAccountLastName').value;
    const email = document.getElementById('editAccountEmail').value;
    const phone = document.getElementById('editAccountPhone').value;
    const userType = document.getElementById('editAccountType').value;
    const isActive = document.getElementById('editAccountStatus').value === '1';
    const isVerified = document.getElementById('editAccountVerified').value === '1';
    const address = document.getElementById('editAccountAddress').value;
    const password = document.getElementById('editAccountPassword').value;

    if (!firstName || !lastName || !email || !userType) {
        showWarning('Validation Error', 'Please fill in all required fields');
        return;
    }

    const payload = {
        firstName,
        lastName,
        email,
        phone,
        user_type: userType,
        is_active: isActive,
        is_verified: isVerified,
        address
    };

    if (password) {
        payload.password = password;
    }

    const url = accountId ? `${API_BASE}/api/users/${accountId}` : `${API_BASE}/api/users`;
    const method = accountId ? 'PUT' : 'POST';

    fetch(url, {
        method: method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(payload)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            hideModal('editAccountModal');
            loadAccounts();
            const message = accountId ? 'Account updated successfully' : 'Account created successfully';
            showSuccess('Success', message);
        } else {
            showError('Error', data.message || 'Failed to save account');
        }
    })
    .catch(error => {
        console.error('Error saving account:', error);
        showError('Error', 'Failed to save account. Please try again.');
    });
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

    const filtered = currentAccounts.filter(account => {
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
    displayAccounts(currentAccounts);
}

function loadStores() {
    fetch(`${API_BASE}/api/stores?admin=1`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    })
    .then(response => response.json())
    .then(data => {
        currentStores = data.stores || [];
        displayStores(currentStores);
        initializeTableSorting('stores');
    })
    .catch(error => console.error('Error loading stores:', error));
}

async function editStoreType() {
    showInfo('Coming Soon', 'Edit store functionality is being implemented.');
}

function toggleStoreStatus(storeId, currentStatus) {
    fetch(`${API_BASE}/api/stores/${storeId}`, {
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
            loadStores();
        } else {
            showError('Error', 'Failed to update store status. Please try again.');
        }
    })
    .catch(error => console.error('Error updating store:', error));
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
    
    const storeWithPriority = currentStores.find(s => s.priority == selectedPriority);
    if (storeWithPriority) {
        const currentStore = currentStores.find(s => s.id == document.getElementById('setPriorityForm').dataset.storeId);
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
    fetch(`${API_BASE}/api/products?admin=true`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    })
    .then(response => response.json())
    .then(data => {
        console.log('Products API response:', data);
        currentProducts = data.products || [];
        console.log('Current products array:', currentProducts);
        try { populateProductFilters(); } catch (e) { console.warn('populateProductFilters error', e); }
        displayProducts(currentProducts);
        initializeTableSorting('products');
    })
    .catch(error => console.error('Error loading products:', error));
}

function displayProducts(products) {
    const tbody = document.getElementById('productsTableBody');
    tbody.innerHTML = '';

    products.forEach(product => {
        const productId = product.id || '';
        const productName = product.name || '';
        const productPrice = product.price || 0;
        const categoryName = product.category_name || 'N/A';
        const storeName = product.store_name || '';
        const stockQuantity = product.stock_quantity || 0;
        const isAvailable = product.is_available;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${productId}</td>
            <td>${productName}</td>
            <td>PKR ${productPrice}</td>
            <td>${categoryName}</td>
            <td>${storeName}</td>
            <td>${stockQuantity}</td>
            <td><span class="status-${isAvailable ? 'active' : 'inactive'}">${isAvailable ? 'Available' : 'Unavailable'}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="btn-small btn-edit" onclick="editProduct(${productId})">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button class="btn-small btn-secondary" onclick="toggleProductStatus(${productId}, ${isAvailable})">
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
    });
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
function loadOrders() {
    fetch(`${API_BASE}/api/orders`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    })
    .then(response => response.json())
    .then(data => {
        // Store orders data globally for edit functionality
        currentOrders = data.orders || [];
        
        // Populate rider filter
        populateRiderFilter();
        
        // Display orders
        displayOrders(currentOrders);
        
        // Update dashboard tiles
        try {
            const today = new Date();
            const isSameDay = (d) => {
                const dt = new Date(d);
                return dt.getFullYear() === today.getFullYear() &&
                       dt.getMonth() === today.getMonth() &&
                       dt.getDate() === today.getDate();
            };
            const todayOrders = currentOrders.filter(o => isSameDay(o.created_at));
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
            set('allTotalOrders', currentOrders.length);
            set('allDelivered', countStatus(currentOrders, 'delivered'));
            set('allPending', countPendingLike(currentOrders));
            set('allCancelled', countStatus(currentOrders, 'cancelled'));
        } catch (e) { /* ignore */ }
    })
    .catch(error => console.error('Error loading orders:', error));
}

function populateRiderFilter() {
    const filterRider = document.getElementById('filterRider');
    const riders = new Set();
    
    currentOrders.forEach(order => {
        if (order.rider_first_name) {
            riders.add(`${order.rider_first_name} ${order.rider_last_name || ''}`.trim());
        }
    });
    
    // Keep "All Riders" option and add unique riders
    const currentValue = filterRider.value;
    filterRider.innerHTML = '<option value="">All Riders</option>';
    
    Array.from(riders).sort().forEach(rider => {
        const option = document.createElement('option');
        option.value = rider;
        option.textContent = rider;
        filterRider.appendChild(option);
    });
    
    filterRider.value = currentValue;
}

function displayOrders(orders = currentOrders) {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';

    if (!orders || !Array.isArray(orders)) return;

    orders.forEach(order => {
        const riderName = order.rider_first_name
            ? `${order.rider_first_name} ${order.rider_last_name || ''}`.trim()
            : 'Not Assigned';
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${order.order_number}</td>
            <td>${order.first_name} ${order.last_name}</td>
            <td>${order.store_name}</td>
            <td>PKR ${parseFloat(order.total_amount).toFixed(2)}</td>
            <td><span class="status-${order.status}">${order.status.charAt(0).toUpperCase() + order.status.slice(1)}</span></td>
            <td>${riderName}</td>
            <td>${order.rider_latitude && order.rider_longitude ? 
                `${Number(order.rider_latitude).toFixed(4)}, ${Number(order.rider_longitude).toFixed(4)}` : 
                (order.rider_location || 'N/A')}</td>
            <td>${new Date(order.created_at).toLocaleDateString()}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn-small btn-info" onclick="viewOrderDetails(${order.id})">
                        <i class="fas fa-eye"></i> View
                    </button>
                    <button class="btn-small btn-edit" onclick="editOrder(${order.id})">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function filterOrders() {
    const startDateFilter = document.getElementById('filterStartDate').value;
    const endDateFilter = document.getElementById('filterEndDate').value;
    const riderFilter = document.getElementById('filterRider').value;
    const statusFilter = document.getElementById('filterStatus') ? document.getElementById('filterStatus').value : '';
    const assignmentFilter = document.getElementById('filterAssignment') ? document.getElementById('filterAssignment').value : 'all';
    
    let filtered = currentOrders;
    
    // Filter by date range
    if (startDateFilter || endDateFilter) {
        filtered = filtered.filter(order => {
            const orderDate = new Date(order.created_at).toLocaleDateString('en-CA');
            
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
    if (riderFilter) {
        filtered = filtered.filter(order => {
            const riderName = order.rider_first_name
                ? `${order.rider_first_name} ${order.rider_last_name || ''}`.trim()
                : '';
            return riderName === riderFilter;
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
    document.getElementById('filterStartDate').value = '';
    document.getElementById('filterEndDate').value = '';
    document.getElementById('filterRider').value = '';
    const statusFilter = document.getElementById('filterStatus');
    if (statusFilter) statusFilter.value = '';
    const assignmentFilter = document.getElementById('filterAssignment');
    if (assignmentFilter) assignmentFilter.value = 'all';
    displayOrders(currentOrders);
}

function filterStores() {
    try {
        const q = (document.getElementById('storeSearch')?.value || '').trim().toLowerCase();
        const status = document.getElementById('storeStatusFilter')?.value || '';
        let filtered = currentStores || [];
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
        displayStores(filtered);
    } catch (e) { console.warn('filterStores error', e); }
}

function clearStoreFilters() {
    const ids = ['storeSearch', 'storeStatusFilter'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    displayStores(currentStores);
}

function populateProductFilters() {
    const catSel = document.getElementById('productCategoryFilter');
    const storeSel = document.getElementById('productStoreFilter');
    if (!catSel && !storeSel) return;
    const cats = new Set();
    const stores = new Set();
    (currentProducts || []).forEach(p => {
        if (p.category_name) cats.add(String(p.category_name));
        if (p.store_name) stores.add(String(p.store_name));
    });
    if (catSel) {
        const prev = catSel.value;
        catSel.innerHTML = '<option value="">All</option>' + Array.from(cats).sort().map(c => `<option value="${c}">${c}</option>`).join('');
        catSel.value = prev;
    }
    if (storeSel) {
        const prev2 = storeSel.value;
        storeSel.innerHTML = '<option value="">All</option>' + Array.from(stores).sort().map(s => `<option value="${s}">${s}</option>`).join('');
        storeSel.value = prev2;
    }
}

function filterProducts() {
    try {
        const q = (document.getElementById('productSearch')?.value || '').trim().toLowerCase();
        const cat = document.getElementById('productCategoryFilter')?.value || '';
        const store = document.getElementById('productStoreFilter')?.value || '';
        const status = document.getElementById('productStatusFilter')?.value || '';
        let filtered = currentProducts || [];
        if (q) {
            filtered = filtered.filter(p => (String(p.name || '').toLowerCase().includes(q)));
        }
        if (cat) filtered = filtered.filter(p => String(p.category_name || '') === cat);
        if (store) filtered = filtered.filter(p => String(p.store_name || '') === store);
        if (status) filtered = filtered.filter(p => ((p.is_available ? 'available' : 'unavailable') === status));
        displayProducts(filtered);
    } catch (e) { console.warn('filterProducts error', e); }
}

function clearProductFilters() {
    const ids = ['productSearch', 'productCategoryFilter', 'productStoreFilter', 'productStatusFilter'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    displayProducts(currentProducts);
}

function filterCategories() {
    try {
        const q = (document.getElementById('categorySearch')?.value || '').trim().toLowerCase();
        const status = document.getElementById('categoryStatusFilter')?.value || '';
        let filtered = currentCategories || [];
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
    displayCategories(currentCategories);
}

function filterRiders() {
    try {
        const q = (document.getElementById('riderSearch')?.value || '').trim().toLowerCase();
        const avail = document.getElementById('riderAvailabilityFilter')?.value || '';
        const status = document.getElementById('riderStatusFilter')?.value || '';
        let filtered = currentRiders || [];
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
    displayRiders(currentRiders);
}

function updateOrderStatus(orderId, currentStatus) {
    const newStatus = prompt('Enter new status (pending, confirmed, preparing, ready, delivered, cancelled):', currentStatus);
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
        document.getElementById('viewOrderTitle').textContent = `Order Details: ${order.order_number}`;

        let html = `
            <div class="order-info-section">
                <div class="info-group">
                    <h4>Customer Information</h4>
                    <p><strong>Name:</strong> ${order.first_name} ${order.last_name}</p>
                    <p><strong>Email:</strong> ${order.email}</p>
                    <p><strong>Phone:</strong> ${order.phone || 'N/A'}</p>
                    <p><strong>Address:</strong> ${order.delivery_address}</p>
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

        order.store_wise_items.forEach(store => {
            html += `
                <div class="store-order-block" style="margin-bottom: 20px; border: 1px solid #eee; padding: 15px; border-radius: 8px;">
                    <h5 style="margin-top: 0; color: #2563eb; border-bottom: 2px solid var(--border-color); padding-bottom: 5px;">
                                <i class="fas fa-store"></i> ${store.store_name}
                            </h5>
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

            html += `
                        </tbody>
                    </table>
                </div>
            `;
        });

        html += `
            <div class="order-summary-section" style="text-align: right; margin-top: 20px; padding: 15px; background: #f8fafc; border-radius: 8px;">
                <p><strong>Items Subtotal:</strong> PKR ${(parseFloat(order.total_amount) - parseFloat(order.delivery_fee)).toFixed(2)}</p>
                <p><strong>Delivery Fee:</strong> PKR ${parseFloat(order.delivery_fee).toFixed(2)}</p>
                <h3 style="margin: 10px 0 0 0; color: #1e293b;">Total Amount: PKR ${parseFloat(order.total_amount).toFixed(2)}</h3>
            </div>
        `;

        if (order.rider_id) {
            html += `
                <hr>
                <div class="info-group">
                    <h4>Rider Information</h4>
                    <p><strong>Name:</strong> ${order.rider_first_name} ${order.rider_last_name || ''}</p>
                    <p><strong>Phone:</strong> ${order.rider_phone || 'N/A'}</p>
                    ${order.rider_location ? `<p><strong>Last Location:</strong> ${order.rider_location}</p>` : ''}
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
    if (uniqueStoreCount === 1) {
        return 70;
    } else if (uniqueStoreCount === 2) {
        return 100;
    } else if (uniqueStoreCount >= 3) {
        return 130 + (uniqueStoreCount - 3) * 30;
    } else {
        return 70;
    }
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

async function editOrder(orderId) {
    try {
        const itemsResponse = await fetch(`${API_BASE}/api/orders/${orderId}/items`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const itemsData = await itemsResponse.json();

        // Use fresh order data from API if available, otherwise fallback to currentOrders
        const freshOrder = itemsData.order || currentOrders.find(o => o.id === orderId);

        if (!freshOrder) {
            showError('Order Not Found', 'The order could not be found in the system.');
            return;
        }

        if (freshOrder.status === 'delivered' || freshOrder.status === 'cancelled') {
            showWarning('Cannot Edit', `Cannot edit items for ${freshOrder.status} orders. You can only change status and rider details.`);
        }

        const ridersResponse = await fetch(`${API_BASE}/api/orders/available-riders`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const ridersData = await ridersResponse.json();

        const riderSelect = document.getElementById('orderRider');
        riderSelect.innerHTML = '<option value="">Select Rider</option>';
        if (ridersData.success) {
            ridersData.riders.forEach(rider => {
                const selected = freshOrder.rider_id == rider.id ? 'selected' : '';
                riderSelect.innerHTML += `<option value="${rider.id}" ${selected}>${rider.first_name} ${rider.last_name}</option>`;
            });
        }

        const storeSelect = document.getElementById('orderItemStore');
        storeSelect.innerHTML = '<option value="">Keep Current Store</option>';
        if (itemsData.success && itemsData.availableStores) {
            itemsData.availableStores.forEach(store => {
                storeSelect.innerHTML += `<option value="${store.id}">${store.name}</option>`;
            });
        }

        const itemsContainer = document.getElementById('orderItemsContainer');
        if (itemsData.success && itemsData.items && itemsData.items.length > 0) {
            itemsContainer.innerHTML = itemsData.items.map(item => `
                <div style="display: grid; grid-template-columns: 1fr 80px 100px 80px; gap: 1rem; align-items: center; padding: 0.75rem; border-bottom: 1px solid #e2e8f0; background: #fff;">
                    <div>
                        <strong>${item.product_name}</strong>
                        <p style="font-size: 0.875rem; color: #718096; margin: 0.25rem 0 0 0;">Price: PKR ${Number(item.price).toFixed(2)}</p>
                        ${item.store_name ? `<p style="font-size: 0.875rem; color: #718096; margin: 0.25rem 0 0 0;">Store: ${item.store_name}</p>` : ''}
                    </div>
                    <div style="text-align: center;">
                        <input type="number" class="item-quantity-input" data-item-id="${item.id}" value="${item.quantity}" min="1" style="width: 100%; padding: 0.5rem; border: 1px solid #e2e8f0; border-radius: 4px; text-align: center;" />
                    </div>
                    <div style="text-align: right;">
                        <strong>PKR ${(Number(item.price) * item.quantity).toFixed(2)}</strong>
                    </div>
                    <div style="text-align: right;">
                        <button type="button" class="btn btn-small btn-danger remove-item-btn" data-item-id="${item.id}" style="padding: 0.4rem 0.6rem;">
                            <i class="fas fa-trash"></i> Remove
                        </button>
                    </div>
                </div>
            `).join('');
            
            document.querySelectorAll('.remove-item-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    removeOrderItem(orderId, this.dataset.itemId);
                });
            });

            document.querySelectorAll('.item-quantity-input').forEach(input => {
                input.addEventListener('input', function() {
                    const items = Array.from(document.querySelectorAll('.item-quantity-input')).map(inp => {
                        const itemId = inp.dataset.itemId;
                        const originalItem = itemsData.items.find(i => i.id == itemId);
                        return {
                            ...originalItem,
                            quantity: parseInt(inp.value) || 0
                        };
                    });
                    const currentDeliveryFee = document.getElementById('orderDeliveryFee').value;
                    updateOrderSummary(items, currentDeliveryFee);
                });
            });

            document.getElementById('orderDeliveryFee').addEventListener('input', function() {
                const items = Array.from(document.querySelectorAll('.item-quantity-input')).map(inp => {
                    const itemId = inp.dataset.itemId;
                    const originalItem = itemsData.items.find(i => i.id == itemId);
                    return {
                        ...originalItem,
                        quantity: parseInt(inp.value) || 0
                    };
                });
                updateOrderSummary(items, this.value);
            });

            document.getElementById('orderTotalAmount').addEventListener('input', function() {
                const totalAmount = parseFloat(this.value) || 0;
                const items = Array.from(document.querySelectorAll('.item-quantity-input')).map(inp => {
                    const itemId = inp.dataset.itemId;
                    const originalItem = itemsData.items.find(i => i.id == itemId);
                    return {
                        ...originalItem,
                        quantity: parseInt(inp.value) || 0
                    };
                });
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
            });

            const uniqueStores = new Set(itemsData.items.map(item => item.store_id).filter(Boolean));
            const storeCount = uniqueStores.size;
            
            // Calculate items subtotal
            const itemsSubtotal = itemsData.items.reduce((sum, item) => sum + (Number(item.price) * item.quantity), 0);
            
            // Determine the delivery fee to display
            // Priority: 1. Use stored delivery_fee, 2. Implied from total_amount, 3. Auto-calculate
            let deliveryFee = calculateDeliveryCharges(storeCount);
            if (freshOrder && freshOrder.delivery_fee !== undefined && freshOrder.delivery_fee !== null) {
                deliveryFee = Number(freshOrder.delivery_fee);
            } else if (freshOrder && freshOrder.total_amount !== undefined && freshOrder.total_amount !== null) {
                deliveryFee = Math.max(0, Number(freshOrder.total_amount) - itemsSubtotal);
            }
            
            console.log(`[Order ${orderId}] Subtotal: ${itemsSubtotal}, Delivery Fee: ${deliveryFee}, Total: ${itemsSubtotal + deliveryFee}`);
            
            updateOrderSummary(itemsData.items, deliveryFee);
            
            if (freshOrder?.delivery_fee === undefined && freshOrder?.total_amount === undefined) {
                showSuccess('Auto-Calculated', `Delivery fee calculated: ${storeCount} store(s) = PKR ${deliveryFee}`);
            }
        } else {
            itemsContainer.innerHTML = '<p style="color: #718096; text-align: center; margin: 1rem 0;">No items found</p>';
            updateOrderSummary([], 0);
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
        if (productSelect && itemsData.success) {
            const productsRes = await fetch(`${API_BASE}/api/orders/${orderId}/available-products`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            const productsData = await productsRes.json();
            
            if (productsData.success && productsData.products) {
                productSelect.innerHTML = '<option value="">Choose product...</option>';
                productsData.products.forEach(product => {
                    productSelect.innerHTML += `<option value="${product.id}" data-price="${product.price}">${product.name} - PKR ${Number(product.price).toFixed(2)} (${product.store_name})</option>`;
                });
            }
        }

        const storeSelectDropdown = document.getElementById('orderItemStore');
        if (storeSelectDropdown) {
            storeSelectDropdown.addEventListener('change', async function() {
                const selectedStoreId = this.value;
                if (!productSelect) return;
                
                try {
                    let query = `${API_BASE}/api/orders/${orderId}/available-products`;
                    if (selectedStoreId) {
                        query += `?store_id=${selectedStoreId}`;
                    }
                    
                    const productsRes = await fetch(query, {
                        headers: { 'Authorization': `Bearer ${authToken}` }
                    });
                    const productsData = await productsRes.json();
                    
                    if (productsData.success && productsData.products) {
                        productSelect.innerHTML = '<option value="">Choose product...</option>';
                        productsData.products.forEach(product => {
                            productSelect.innerHTML += `<option value="${product.id}" data-price="${product.price}">${product.name} - PKR ${Number(product.price).toFixed(2)} (${product.store_name})</option>`;
                        });
                    }
                } catch (error) {
                    console.error('Error fetching products for store:', error);
                }
            });
        }
        
        document.getElementById('orderStatus').value = freshOrder.status;
        document.getElementById('riderLocation').value = freshOrder.rider_location || '';
        document.getElementById('riderLatitude').value = freshOrder.rider_latitude || '';
        document.getElementById('riderLongitude').value = freshOrder.rider_longitude || '';

        document.getElementById('editOrderForm').dataset.orderId = orderId;

        showModal('editOrderModal');
    } catch (error) {
        console.error('Error loading order details:', error);
        showError('Error', 'Failed to load order details. Please try again.');
    }
}

async function saveOrder() {
    const form = document.getElementById('editOrderForm');
    const orderId = form.dataset.orderId;
    const formData = new FormData(form);

    const status = formData.get('status');
    const riderId = formData.get('rider_id') || null;
    const riderLocation = formData.get('rider_location') || null;
    const riderLatitude = formData.get('rider_latitude') || null;
    const riderLongitude = formData.get('rider_longitude') || null;
    const storeId = formData.get('store_id') || null;

    try {
        console.log(`[saveOrder] Starting save for order ${orderId}`);
        
        const itemQuantityInputs = document.querySelectorAll('.item-quantity-input');
        let itemsUpdated = false;
        
        if (itemQuantityInputs.length > 0) {
            const items = Array.from(itemQuantityInputs).map(input => ({
                id: parseInt(input.dataset.itemId),
                quantity: parseInt(input.value)
            }));
            console.log(`[saveOrder] Current items:`, items);
            
            const hasChanges = items.some((item, idx) => {
                const original = currentOrders.find(o => o.id == orderId);
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

        if (status) {
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
    const quantity = parseInt(quantityInput.value);
    const storeId = storeSelect?.value || null;
    
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
            body: JSON.stringify({ product_id: parseInt(productId), quantity, store_id: storeId ? parseInt(storeId) : null })
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
        currentUnits = data.units;
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
                        <button class="btn-small btn-secondary" onclick="deleteUnit(${u.id})">
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
    editingUnitId = null;
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
                console.debug('saveUnit: sending (no-form fallback)', { editingUnitId, payload: payloadLocal });
                let resp;
                if (editingUnitId) {
                    resp = await fetch(`${API_BASE}/api/units/${editingUnitId}`, {
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
                    editingUnitId = null;
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
        console.debug('saveUnit: sending', { editingUnitId, payload });
        let resp;
        if (editingUnitId) {
            resp = await fetch(`${API_BASE}/api/units/${editingUnitId}`, {
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
            editingUnitId = null;
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
    editingUnitId = unitId;
    let unit = (currentUnits || []).find(u => String(u.id) === String(unitId));
    if (!unit) {
        try {
            const resp = await fetch(`${API_BASE}/api/units?ts=${Date.now()}`, { headers: { 'Authorization': `Bearer ${authToken}` }, cache: 'no-store' });
            const data = await resp.json();
            if (data && data.success && Array.isArray(data.units)) {
                currentUnits = data.units;
                unit = (currentUnits || []).find(u => String(u.id) === String(unitId));
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
        currentSizes = data.sizes;
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
                        <button class="btn-small btn-secondary" onclick="deleteSize(${s.id})">
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
        console.debug('saveSize: sending', { editingSizeId, payload });
        let resp;
        if (editingSizeId) {
            resp = await fetch(`${API_BASE}/api/sizes/${editingSizeId}`, {
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
            editingSizeId = null;
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
    editingSizeId = sizeId;
    const s = (currentSizes || []).find(x => x.id === sizeId);
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
        if (modalId === 'addUnitModal') editingUnitId = null;
        if (modalId === 'addSizeModal') editingSizeId = null;
        if (modalId === 'addStoreModal') editingStoreId = null;
        if (modalId === 'addProductModal') editingProductId = null;
        if (modalId === 'addCategoryModal') editingCategoryId = null;
        if (modalId === 'addRiderModal') editingRiderId = null;
    } catch (e) { /* ignore */ }
}

async function showAddStoreModal() {
    try {
        await populateStoreCategorySelect();
    } catch (error) {
        console.error('Error loading categories:', error);
    }
    const modal = document.getElementById('addStoreModal');
    if (modal) {
        const titleEl = modal.querySelector('.modal-header h3');
        if (titleEl) titleEl.textContent = 'Add New Store';
        const saveBtn = modal.querySelector('#saveStoreBtn');
        if (saveBtn) saveBtn.textContent = 'Save Store';
    }
    showModal('addStoreModal');

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
    const formEl = document.getElementById('addStoreForm');
    const formData = new FormData(formEl);
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
        payment_term: formData.get('payment_term') || null,
        address: formData.get('address'),
        status: formData.get('status') || 'active',
        category_id: formData.get('category_id') || null,
        owner_name: (formData.get('owner_name') || '').trim() || undefined
    };

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
        if (editingStoreId) {
            const response = await fetch(`${API_BASE}/api/stores/${editingStoreId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                body: JSON.stringify(storeData)
            });
            const data = await response.json();
            if (data.success) {
                showSuccess('Store Updated', 'Store updated successfully!');
                hideModal('addStoreModal');
                editingStoreId = null;
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
    editingStoreId = storeId;
    try {
        const resp = await fetch(`${API_BASE}/api/stores/${storeId}`, { headers: { 'Authorization': `Bearer ${authToken}` } });
        const data = await resp.json();
        if (!data || !data.success || !data.store) { showError('Error', 'Failed to load store'); return; }
        const s = data.store;
        await populateStoreCategorySelect(s.category_id || null);
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
        form.querySelector('#storeDescription').value = s.description || '';
        form.querySelector('#storeAddress').value = s.address || '';
        const modal = document.getElementById('addStoreModal');
        if (modal) {
            const titleEl = modal.querySelector('.modal-header h3');
            if (titleEl) titleEl.textContent = 'Edit Store';
            const saveBtn = modal.querySelector('#saveStoreBtn');
            if (saveBtn) saveBtn.textContent = 'Update Store';
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
        const resp = await fetch(`${API_BASE}/api/categories?includeInactive=true`);
        const data = await resp.json();
        if (data && data.success && Array.isArray(data.categories)) {
            data.categories.forEach(category => {
                categorySelect.innerHTML += `<option value="${category.id}">${category.name}</option>`;
            });
        }
        if (selectedId) {
            categorySelect.value = String(selectedId);
        }
    } catch (err) {
        console.error('Error loading categories:', err);
    }
}

function setProductStoreTerms(stores) {
    productStoreTermsById = {};
    (stores || []).forEach(s => {
        if (s && s.id !== undefined && s.id !== null) {
            productStoreTermsById[String(s.id)] = s.payment_term || '';
        }
    });
}

function isDiscountPaymentTerm(term) {
    const t = String(term || '').toLowerCase().trim();
    return t === 'cash only' || t === 'credit';
}

function recalcProductCost() {
    const priceEl = document.getElementById('productPrice');
    const costEl = document.getElementById('productCostPrice');
    const storeEl = document.getElementById('productStore');
    const discountRow = document.getElementById('productDiscountRow');
    const discountTypeEl = document.getElementById('productDiscountType');
    const discountValueEl = document.getElementById('productDiscountValue');
    if (!priceEl || !costEl || !storeEl) return;

    const term = productStoreTermsById[String(storeEl.value || '')] || '';
    const hasDiscount = isDiscountPaymentTerm(term);
    if (discountRow) discountRow.style.display = hasDiscount ? '' : 'none';

    const rawPrice = String(priceEl.value || '').trim();
    const price = rawPrice.length ? parseFloat(rawPrice) : NaN;
    if (!Number.isFinite(price) || price < 0) {
        return;
    }

    let cost = price;
    if (hasDiscount) {
        const dtype = String(discountTypeEl?.value || 'amount');
        const rawD = String(discountValueEl?.value || '').trim();
        const dval = rawD.length ? parseFloat(rawD) : NaN;
        if (Number.isFinite(dval) && dval > 0) {
            const disc = dtype === 'percent' ? (price * dval / 100) : dval;
            cost = price - disc;
        }
    } else {
        if (discountValueEl) discountValueEl.value = '';
        if (discountTypeEl) discountTypeEl.value = 'amount';
    }

    if (!Number.isFinite(cost) || cost < 0) cost = 0;
    costEl.readOnly = true;
    costEl.value = (Math.round(cost * 100) / 100).toFixed(2);
    try { recalcVariantCosts(); } catch (e) {}
}

function computeCostForPrice(price) {
    const storeEl = document.getElementById('productStore');
    const discountTypeEl = document.getElementById('productDiscountType');
    const discountValueEl = document.getElementById('productDiscountValue');
    const term = productStoreTermsById[String(storeEl?.value || '')] || '';
    const hasDiscount = isDiscountPaymentTerm(term);

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
    }
    if (!Number.isFinite(cost) || cost < 0) cost = 0;
    return Math.round(cost * 100) / 100;
}

function recalcVariantCosts() {
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
    ['productStore', 'productPrice', 'productDiscountType', 'productDiscountValue'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('change', recalcProductCost);
        el.addEventListener('input', recalcProductCost);
    });
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
        if (mode === 'size') out.push({ size_id: measureId, price: rounded, cost_price: costRounded });
        else out.push({ unit_id: measureId, price: rounded, cost_price: costRounded });
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
    try { applyProductMeasureMode(getProductMeasureMode()); } catch (e) {}
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
    measureSelect.style.minWidth = '260px';
    if (mode === 'size') {
        measureSelect.innerHTML = '<option value="">Select Size</option>' + (currentSizes || []).map(s => `<option value="${s.id}">${s.label}</option>`).join('');
        if (prefill && prefill.size_id) measureSelect.value = String(prefill.size_id);
    } else {
        measureSelect.innerHTML = '<option value="">Select Unit</option>' + (currentUnits || []).map(u => `<option value="${u.id}">${u.name}${u.abbreviation ? ' ('+u.abbreviation+')' : ''}</option>`).join('');
        if (prefill && prefill.unit_id) measureSelect.value = String(prefill.unit_id);
    }

    const priceInput = document.createElement('input');
    priceInput.type = 'number';
    priceInput.min = '0';
    priceInput.step = '0.01';
    priceInput.setAttribute('data-role', 'size-price-price');
    priceInput.style.width = '160px';
    priceInput.value = (prefill && prefill.price !== undefined && prefill.price !== null) ? String(prefill.price) : '';

    const costInput = document.createElement('input');
    costInput.type = 'number';
    costInput.min = '0';
    costInput.step = '0.01';
    costInput.readOnly = true;
    costInput.setAttribute('data-role', 'variant-cost');
    costInput.style.width = '160px';
    costInput.value = (prefill && prefill.cost_price !== undefined && prefill.cost_price !== null) ? String(prefill.cost_price) : '';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-small btn-secondary';
    removeBtn.textContent = 'Remove';
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
            sel.innerHTML = '<option value="">Select Size</option>' + (currentSizes || []).map(s => `<option value="${s.id}">${s.label}</option>`).join('');
        } else {
            sel.innerHTML = '<option value="">Select Unit</option>' + (currentUnits || []).map(u => `<option value="${u.id}">${u.name}${u.abbreviation ? ' ('+u.abbreviation+')' : ''}</option>`).join('');
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

// Product Management Functions
async function showAddProductModal() {
    // Load stores and categories for dropdowns
    try {
        const [storesResponse, categoriesResponse, productsResponse] = await Promise.all([
            fetch(`${API_BASE}/api/stores`),
            fetch(`${API_BASE}/api/categories`),
            fetch(`${API_BASE}/api/products?admin=1`, { headers: { 'Authorization': `Bearer ${authToken}` } })
        ]);

        const storesData = await storesResponse.json();
        const categoriesData = await categoriesResponse.json();
        const productsData = await productsResponse.json();

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

            itemSelect.addEventListener('change', (e) => applyItemSelection(e.target.value));
            applyItemSelection(itemSelect.value);
        }

        

        bindProductSizePricesUI();
        resetProductSizePricesUI();

        // Populate units and sizes
        try {
            const [unitsResp, sizesResp] = await Promise.all([
                fetch(`${API_BASE}/api/units?ts=${Date.now()}`, { cache: 'no-store' }),
                fetch(`${API_BASE}/api/sizes?ts=${Date.now()}`, { cache: 'no-store' })
            ]);
            const unitsJson = await unitsResp.json();
            const sizesJson = await sizesResp.json();
            if (unitsJson && unitsJson.success && Array.isArray(unitsJson.units)) currentUnits = unitsJson.units;
            if (sizesJson && sizesJson.success && Array.isArray(sizesJson.sizes)) currentSizes = sizesJson.sizes;
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
            if (discountTypeEl) discountTypeEl.value = 'amount';
            if (discountValueEl) discountValueEl.value = '';
            recalcProductCost();
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
    const formEl = document.getElementById('addProductForm');
    const formData = new FormData(formEl);
    const rawStoreId = formData.get('store_id');
    const rawName = (formData.get('name') || '').trim();
    const rawItemId = formData.get('item_id') || '';
    const storeId = parseInt(rawStoreId, 10);
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
    try { recalcProductCost(); } catch (e) {}
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
    const discountType = String(formData.get('discount_type') || '').trim();
    const discountValueRaw = String(formData.get('discount_value') || '').trim();
    if (discountType) productData.discount_type = discountType;
    if (discountValueRaw.length) productData.discount_value = parseFloat(discountValueRaw);

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
        if (editingProductId) { method = 'PUT'; url = `${API_BASE}/api/products/${editingProductId}`; }

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
            showSuccess(editingProductId ? 'Product Updated' : 'Product Created', editingProductId ? 'Product updated successfully!' : 'Product created successfully!');
            hideModal('addProductModal');
            editingProductId = null;
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
    editingProductId = id;
    try {
        const resp = await fetch(`${API_BASE}/api/products/${id}?admin=1`, { headers: { 'Authorization': `Bearer ${authToken}` } });
        const data = await resp.json();
        if (!data.success || !data.product) {
            showError('Error', 'Failed to load product for editing');
            return;
        }
        const p = data.product;
        const [storesResponse, categoriesResponse, productsResponse, unitsResp, sizesResp] = await Promise.all([
            fetch(`${API_BASE}/api/stores`),
            fetch(`${API_BASE}/api/categories`),
            fetch(`${API_BASE}/api/products?admin=1`, { headers: { 'Authorization': `Bearer ${authToken}` } }),
            fetch(`${API_BASE}/api/units?ts=${Date.now()}`, { headers: { 'Authorization': `Bearer ${authToken}` }, cache: 'no-store' }),
            fetch(`${API_BASE}/api/sizes?ts=${Date.now()}`, { headers: { 'Authorization': `Bearer ${authToken}` }, cache: 'no-store' })
        ]);
        const storesData = await storesResponse.json();
        const categoriesData = await categoriesResponse.json();
        const productsData = await productsResponse.json();
        const unitsJson = await unitsResp.json();
        const sizesJson = await sizesResp.json();
        if (unitsJson && unitsJson.success && Array.isArray(unitsJson.units)) currentUnits = unitsJson.units;
        if (sizesJson && sizesJson.success && Array.isArray(sizesJson.sizes)) currentSizes = sizesJson.sizes;
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

            itemSelect.onchange = (e) => applyItemSelection(e.target.value);
            applyItemSelection(itemSelect.value);
        }
        form.querySelector('#productName').value = p.name || '';
        if (form.querySelector('#productCostPrice')) form.querySelector('#productCostPrice').value = (p.cost_price !== undefined && p.cost_price !== null) ? p.cost_price : '';
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
            const hasVariants = Array.isArray(p.size_variants) && p.size_variants.length > 0;
            const shouldUseVariants = hasVariants && (!p.size_id || p.size_variants.length > 1);
            if (shouldUseVariants) {
                setProductSizePricesEnabled(true);
                const tbody = document.getElementById('productSizePricesBody');
                if (tbody) tbody.innerHTML = '';
                (p.size_variants || []).forEach(v => addProductSizePriceRow({ size_id: v.size_id, unit_id: v.unit_id, price: v.price }));
            } else {
                setProductSizePricesEnabled(false);
            }
        } catch (e) {}
        try { syncProductMeasureModeFromValues(); } catch (e) {}
        if (isDiscountPaymentTerm(productStoreTermsById[String(p.store_id || '')] || '')) {
            const priceNum = parseFloat(String(p.price ?? '').trim());
            const costNum = parseFloat(String(p.cost_price ?? '').trim());
            const discountTypeEl = document.getElementById('productDiscountType');
            const discountValueEl = document.getElementById('productDiscountValue');
            if (Number.isFinite(priceNum) && Number.isFinite(costNum) && priceNum > 0) {
                const delta = priceNum - costNum;
                if (delta > 0) {
                    if (discountTypeEl) discountTypeEl.value = 'amount';
                    if (discountValueEl) discountValueEl.value = (Math.round(delta * 100) / 100).toFixed(2);
                }
            }
        }
        try { recalcProductCost(); } catch (e) {}
        if (itemSelect) {
            if (p.item_id) {
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
        if (editingCategoryId) {
            const response = await fetch(`${API_BASE}/api/categories/${editingCategoryId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                body: JSON.stringify(categoryData)
            });
            const data = await response.json();
            if (data.success) {
                showSuccess('Category Updated', 'Category updated successfully!');
                hideModal('addCategoryModal');
                editingCategoryId = null;
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
    editingCategoryId = categoryId;
    try {
        let c = (currentCategories || []).find(x => String(x.id) === String(categoryId));
        if (!c) {
            const resp = await fetch(`${API_BASE}/api/categories?ts=${Date.now()}`, { cache: 'no-store' });
            const data = await resp.json();
            if (!data.success) { showError('Error', 'Failed to load categories'); return; }
            currentCategories = data.categories || [];
            c = (currentCategories || []).find(x => String(x.id) === String(categoryId));
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
    editingSizeId = null;
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
    editingRiderId = null;
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
        if (editingRiderId) {
            const response = await fetch(`${API_BASE}/api/riders/${editingRiderId}`, {
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
                editingRiderId = null;
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
    editingRiderId = riderId;
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
    if (window['statusChart']) {
        window['statusChart'].destroy();
    }

    window['statusChart'] = new Chart(ctx, {
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
    if (window['revenueChart']) {
        window['revenueChart'].destroy();
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

    window['revenueChart'] = new Chart(ctx, {
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
    if (sortState[tableType].column === column) {
        sortState[tableType].direction = sortState[tableType].direction === 'asc' ? 'desc' : 'asc';
    } else {
        sortState[tableType].column = column;
        sortState[tableType].direction = 'asc';
    }

    // Get the data array for this table
    let data = [];
    switch(tableType) {
        case 'products':
            data = currentProducts;
            break;
        case 'stores':
            data = currentStores;
            break;
        case 'categories':
            data = currentCategories;
            break;
        case 'riders':
            data = currentRiders;
            break;
        case 'orders':
            data = currentOrders;
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

        if (aVal < bVal) return sortState[tableType].direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortState[tableType].direction === 'asc' ? 1 : -1;
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
    if (sortState[tableType].column === column) {
        header.classList.add(sortState[tableType].direction === 'asc' ? 'sort-asc' : 'sort-desc');
    }
}

// Update other load functions to store data and initialize sorting
function loadStores() {
    fetch(`${API_BASE}/api/stores?admin=1`)
    .then(response => response.json())
    .then(data => {
        currentStores = data.stores || [];
        displayStores(currentStores);
        initializeTableSorting('stores');
        attachStoreFilterListeners();
    })
    .catch(error => console.error('Error loading stores:', error));
}

function attachStoreFilterListeners() {
    const searchInput = document.getElementById('storeSearch');
    const statusFilter = document.getElementById('storeStatusFilter');
    const clearBtn = document.getElementById('storeClearFiltersBtn');

    if (searchInput) {
        searchInput.addEventListener('input', filterStores);
    }
    if (statusFilter) {
        statusFilter.addEventListener('change', filterStores);
    }
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            if (statusFilter) statusFilter.value = '';
            filterStores();
        });
    }
}

function filterStores() {
    const searchTerm = document.getElementById('storeSearch')?.value.toLowerCase();
    const status = document.getElementById('storeStatusFilter')?.value;

    let filtered = currentStores;

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
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${store.id}</td>
            <td>${store.name}</td>
            <td>${store.location}</td>
            <td>${ownerDisplay}</td>
            <td>${store.rating} ⭐</td>
            <td>${priorityDisplay}</td>
            <td><span class="status-${store.is_active ? 'active' : 'inactive'}">${store.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="btn-small btn-edit" onclick="editStore(${store.id})">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button class="btn-small btn-info" onclick="showSetPriorityModal(${store.id}, '${store.name}', ${store.priority || 'null'})">
                        <i class="fas fa-star"></i> Priority
                    </button>
                    <button class="btn-small btn-secondary" onclick="toggleStoreStatus(${store.id}, ${store.is_active})">
                        <i class="fas fa-${store.is_active ? 'ban' : 'check'}"></i> ${store.is_active ? 'Deactivate' : 'Activate'}
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
    fetch(`${API_BASE}/api/categories?ts=${Date.now()}`, { cache: 'no-store' })
    .then(response => response.json())
    .then(data => {
        currentCategories = data.categories || [];
        displayCategories(currentCategories);
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
                    <button class="btn-small btn-secondary" onclick="toggleCategoryStatus(${category.id}, ${category.is_active})">
                        <i class="fas fa-${category.is_active ? 'ban' : 'check'}"></i> ${category.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function loadRiders() {
    fetch(`${API_BASE}/api/riders`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    })
    .then(response => response.json())
    .then(data => {
        currentRiders = data.riders || [];
        displayRiders(currentRiders);
        initializeTableSorting('riders');
    })
    .catch(error => console.error('Error loading riders:', error));
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
                    <button class="btn-small btn-secondary" onclick="toggleRiderStatus(${rider.id}, ${rider.is_active})">
                        <i class="fas fa-${rider.is_active ? 'ban' : 'check'}"></i> ${rider.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button class="btn-small btn-secondary" onclick="openFuelForRider(${rider.id})">Fuel</button>
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
    if (!tbody) return;
    
    // Initial UI state
    if (tbody.innerHTML.trim() === '' || tbody.innerHTML.includes('loading')) {
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
