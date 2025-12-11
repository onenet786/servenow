// Admin Dashboard JavaScript
// Use full origin to avoid relative-path edge cases
const API_BASE = window.location.protocol + '//' + window.location.host;
let currentUser = null;
let authToken = null;
let currentOrders = [];
let currentProducts = [];
let currentUsers = [];
let currentStores = [];
let currentCategories = [];
let currentRiders = [];
let editingProductId = null;
let editingUserId = null;
let editingStoreId = null;
let editingCategoryId = null;
let editingRiderId = null;
let currentUnits = [];
let currentSizes = [];
let editingUnitId = null;
let editingSizeId = null;

// Sorting state for each table
let sortState = {
    products: { column: 'id', direction: 'asc' },
    users: { column: 'id', direction: 'asc' },
    stores: { column: 'id', direction: 'asc' },
    categories: { column: 'id', direction: 'asc' },
    riders: { column: 'id', direction: 'asc' },
    orders: { column: 'order_number', direction: 'asc' }
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

    // Load initial dashboard data
    loadDashboardStats();

    // Add event listeners for modal open buttons
    document.getElementById('addUserBtn').addEventListener('click', () => showAddUserModal());
    document.getElementById('addStoreBtn').addEventListener('click', () => showAddStoreModal());
    document.getElementById('addProductBtn').addEventListener('click', () => showAddProductModal());
    const exportBtn = document.getElementById('exportImagesBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportBase64Images);
    }
    // Image fit toggle (preview cover vs fill)
    const imageFitSelect = document.getElementById('imageFitSelect');
    if (imageFitSelect) {
        // initialize from localStorage (default: cover)
        const saved = localStorage.getItem('productImageFit') || 'cover';
        imageFitSelect.value = saved;
        applyImageFitClass(saved);
        imageFitSelect.addEventListener('change', function() {
            const val = this.value === 'fill' ? 'fill' : 'cover';
            localStorage.setItem('productImageFit', val);
            applyImageFitClass(val);
            showSuccess('Image Fit Updated', `Image fit set to ${val}`);
        });
    }
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
    const addUnitBtn = document.getElementById('addUnitBtn');
    if (addUnitBtn) addUnitBtn.addEventListener('click', () => showAddUnitModal());
    const addSizeBtn = document.getElementById('addSizeBtn');
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
    document.getElementById('saveUserBtn').addEventListener('click', saveUser);
    document.getElementById('saveStoreBtn').addEventListener('click', saveStore);
    document.getElementById('saveProductBtn').addEventListener('click', saveProduct);
    const saveUnitBtn = document.getElementById('saveUnitBtn');
    if (saveUnitBtn) saveUnitBtn.addEventListener('click', saveUnit);
    const saveSizeBtn = document.getElementById('saveSizeBtn');
    if (saveSizeBtn) saveSizeBtn.addEventListener('click', saveSize);
    document.getElementById('saveCategoryBtn').addEventListener('click', saveCategory);
    document.getElementById('saveRiderBtn').addEventListener('click', saveRider);
    document.getElementById('saveOrderBtn').addEventListener('click', saveOrder);

    // Database backup buttons
    const createBackupBtn = document.getElementById('createBackupBtn');
    if (createBackupBtn) createBackupBtn.addEventListener('click', createBackup);
    const refreshBackupsBtn = document.getElementById('refreshBackupsBtn');
    if (refreshBackupsBtn) refreshBackupsBtn.addEventListener('click', loadBackups);

    // Add filter event listeners
    const filterDate = document.getElementById('filterDate');
    const filterRider = document.getElementById('filterRider');
    const clearFiltersBtn = document.getElementById('clearFiltersBtn');

    if (filterDate) {
        filterDate.addEventListener('change', filterOrders);
    }
    if (filterRider) {
        filterRider.addEventListener('change', filterOrders);
    }
    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', clearFilters);
    }

    // Add report event listeners
    const generateReportBtn = document.getElementById('generateReportBtn');
    if (generateReportBtn) {
        generateReportBtn.addEventListener('click', generateOrderReport);
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


// Fallback delegated click handlers: ensure Add buttons always work even if
// their direct listeners weren't attached (helps diagnose missing bindings).
document.addEventListener('click', function(e) {
    try {
        const t = e.target;
        if (!t) return;
        // normalize to the button element if an inner icon/text was clicked
        const btn = t.closest ? t.closest('#addUnitBtn') || (t.id === 'addUnitBtn' ? t : null) : (t.id === 'addUnitBtn' ? t : null);
        if (btn) {
            e.preventDefault();
            console.debug('Delegated click: addUnitBtn');
            try { showAddUnitModal(); } catch (err) { console.error('showAddUnitModal error', err); }
            return;
        }

        const btn2 = t.closest ? t.closest('#addSizeBtn') || (t.id === 'addSizeBtn' ? t : null) : (t.id === 'addSizeBtn' ? t : null);
        if (btn2) {
            e.preventDefault();
            console.debug('Delegated click: addSizeBtn');
            try { showAddSizeModal(); } catch (err) { console.error('showAddSizeModal error', err); }
            return;
        }
    } catch (e) { /* ignore delegated handler errors */ }
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

    // Hamburger menu: toggle left-side panel
    const hamburger = document.getElementById('hamburgerMenu');
    if (hamburger) {
        // Toggle class on body to open/close left panel
        hamburger.addEventListener('click', function(e) {
            e.preventDefault();
            const isOpen = document.body.classList.toggle('left-open');
            this.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        });

        // Close left panel when clicking outside the panel on desktop
        document.addEventListener('click', function(e) {
            if (!document.body.classList.contains('left-open')) return;
            const nav = document.getElementById('navMenu');
            const target = e.target;
            if (nav && !nav.contains(target) && !hamburger.contains(target)) {
                document.body.classList.remove('left-open');
                hamburger.setAttribute('aria-expanded', 'false');
            }
        });

        // Close panel on Escape
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && document.body.classList.contains('left-open')) {
                document.body.classList.remove('left-open');
                hamburger.setAttribute('aria-expanded', 'false');
            }
        });
    }
}

// Apply image fit mode by toggling a class on <body>
function applyImageFitClass(mode) {
    document.body.classList.remove('image-fit-cover', 'image-fit-fill');
    if (mode === 'fill') document.body.classList.add('image-fit-fill');
    else document.body.classList.add('image-fit-cover');
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

    // Close modal when clicking outside of it
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('modal')) {
            hideModal(e.target.id);
        }
    });
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
    const tableRows = document.querySelectorAll('#reportsTableBody tr');

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

    // Load data for the tab
    switch(tabName) {
        case 'users':
            loadUsers();
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
            break;
        case 'sizes':
            // Load sizes list when Sizes tab opened
            Promise.resolve(loadSizes()).catch(err => console.error('Error loading sizes tab', err));
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
        case 'order-reports':
            // Reports tab doesn't need initial loading, user will generate reports manually
            break;
        case 'db-backup':
            // Load list of available backups when backup tab is opened
            loadBackups();
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
    } else {
        const panel = document.getElementById('rider-list-panel');
        if (panel) panel.style.display = 'block';
        // ensure riders list is loaded
        loadRiders();
    }
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
                <td>${b.filename}</td>
                <td>${humanFileSize(b.size)}</td>
                <td>${mtime}</td>
                <td>
                    <button class="btn btn-small" onclick="downloadBackup('${encodeURIComponent(b.filename)}')">Download</button>
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


function loadDashboardStats() {
    // Load stats for dashboard
    Promise.all([
        fetch(`${API_BASE}/api/users`, { headers: { 'Authorization': `Bearer ${authToken}` } }),
        fetch(`${API_BASE}/api/stores`),
        fetch(`${API_BASE}/api/products?admin=true`, { headers: { 'Authorization': `Bearer ${authToken}` } }),
        fetch(`${API_BASE}/api/orders`, { headers: { 'Authorization': `Bearer ${authToken}` } })
    ])
    .then(responses => Promise.all(responses.map(r => r.json())))
    .then(([users, stores, products, orders]) => {
        document.getElementById('totalUsers').textContent = users.users.length;
        document.getElementById('totalStores').textContent = stores.stores.length;
        document.getElementById('totalProducts').textContent = products.products.length;
        document.getElementById('totalOrders').textContent = orders.orders.length;
    })
    .catch(error => console.error('Error loading dashboard stats:', error));
}

function loadUsers() {
    fetch(`${API_BASE}/api/users`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    })
    .then(response => response.json())
    .then(data => {
        currentUsers = data.users || [];
        displayUsers(currentUsers);
        initializeTableSorting('users');
    })
    .catch(error => console.error('Error loading users:', error));
}

async function editUser(userId) {
    // Get current user data first
    fetch(`${API_BASE}/api/users`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    })
    .then(response => response.json())
    .then(data => {
        const user = data.users.find(u => u.id === userId);
        if (!user) {
            showError('User Not Found', 'The user could not be found in the system.');
            return;
        }

        const newType = prompt('Enter new user type (customer, store_owner, admin):', user.user_type);
        if (!newType || !['customer', 'store_owner', 'admin'].includes(newType)) {
            showWarning('Invalid User Type', 'Please select: customer, store_owner, or admin');
            return;
        }

        fetch(`${API_BASE}/api/users/${userId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ user_type: newType })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                loadUsers();
                showSuccess('User Updated', 'User information updated successfully!');
            } else {
                showError('Update Failed', data.message || 'Failed to update user');
            }
        })
        .catch(error => {
            console.error('Error updating user:', error);
            showError('Error', 'Failed to update user. Please try again.');
        });
    })
    .catch(error => {
        console.error('Error fetching user:', error);
        showError('Error', 'Failed to fetch user data. Please try again.');
    });
}

function toggleUserStatus(userId, currentStatus) {
    fetch(`${API_BASE}/api/users/${userId}`, {
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
            loadUsers();
        } else {
            showError('Error', 'Failed to update user status. Please try again.');
        }
    })
    .catch(error => console.error('Error updating user:', error));
}

function loadStores() {
    fetch(`${API_BASE}/api/stores`)
    .then(response => response.json())
    .then(data => {
        currentStores = data.stores || [];
        displayStores(currentStores);
        initializeTableSorting('stores');
    })
    .catch(error => console.error('Error loading stores:', error));
}

async function editStore(storeId) {
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
        tbody.appendChild(row);
    });
}

// Export base64 images to uploads via server endpoint
function exportBase64Images() {
    if (!confirm('Export all base64 product images to server /uploads and update product records?')) return;
    const statusEl = document.getElementById('exportImagesStatus');
    const btn = document.getElementById('exportImagesBtn');
    if (statusEl) statusEl.textContent = 'Exporting...';
    if (btn) btn.disabled = true;

    fetch(`${API_BASE}/api/products/export-base64-images`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
        }
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            const converted = data.converted || 0;
            showSuccess('Export Complete', `${converted} images converted and updated.`);
            if (statusEl) statusEl.textContent = `Converted: ${converted}`;
            // Refresh product list to show updated image paths
            loadProducts();
        } else {
            showError('Export Failed', data.message || 'Export failed');
            if (statusEl) statusEl.textContent = 'Export failed';
        }
        if (btn) btn.disabled = false;
    })
    .catch(err => {
        console.error('Export error:', err);
        showError('Error', 'Failed to export images. See console for details.');
        if (statusEl) statusEl.textContent = 'Error';
        if (btn) btn.disabled = false;
    });
}

async function editProduct(productId) {
    showInfo('Coming Soon', 'Edit product functionality is being implemented.');
}

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
    })
    .catch(error => console.error('Error loading orders:', error));
}

function populateRiderFilter() {
    const filterRider = document.getElementById('filterRider');
    const riders = new Set();
    
    currentOrders.forEach(order => {
        if (order.rider_first_name && order.rider_last_name) {
            riders.add(`${order.rider_first_name} ${order.rider_last_name}`);
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

function displayOrders(orders) {
    const tbody = document.getElementById('ordersTableBody');
    tbody.innerHTML = '';

    orders.forEach(order => {
        const riderName = order.rider_first_name && order.rider_last_name
            ? `${order.rider_first_name} ${order.rider_last_name}`
            : 'Not Assigned';
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${order.order_number}</td>
            <td>${order.first_name} ${order.last_name}</td>
            <td>${order.store_name}</td>
            <td>PKR ${order.total_amount}</td>
            <td><span class="status-${order.status}">${order.status.charAt(0).toUpperCase() + order.status.slice(1)}</span></td>
            <td>${riderName}</td>
            <td>${order.rider_location || 'N/A'}</td>
            <td>${new Date(order.created_at).toLocaleDateString()}</td>
            <td>
                <button class="btn btn-small btn-edit" onclick="editOrder(${order.id})">Edit Order</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function filterOrders() {
    const dateFilter = document.getElementById('filterDate').value;
    const riderFilter = document.getElementById('filterRider').value;
    
    let filtered = currentOrders;
    
    // Filter by date
    if (dateFilter) {
        filtered = filtered.filter(order => {
            const orderDate = new Date(order.created_at).toLocaleDateString('en-CA');
            return orderDate === dateFilter;
        });
    }
    
    // Filter by rider
    if (riderFilter) {
        filtered = filtered.filter(order => {
            const riderName = order.rider_first_name && order.rider_last_name
                ? `${order.rider_first_name} ${order.rider_last_name}`
                : '';
            return riderName === riderFilter;
        });
    }
    
    displayOrders(filtered);
}

function clearFilters() {
    document.getElementById('filterDate').value = '';
    document.getElementById('filterRider').value = '';
    displayOrders(currentOrders);
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

async function editOrder(orderId) {
    try {
        // Find order from current orders data
        const order = currentOrders.find(o => o.id === orderId);
        if (!order) {
            showError('Order Not Found', 'The order could not be found in the system.');
            return;
        }

        // Fetch available riders
        const ridersResponse = await fetch(`${API_BASE}/api/orders/available-riders`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const ridersData = await ridersResponse.json();

        // Populate rider dropdown
        const riderSelect = document.getElementById('orderRider');
        riderSelect.innerHTML = '<option value="">Select Rider</option>';
        if (ridersData.success) {
            ridersData.riders.forEach(rider => {
                const selected = order.rider_id == rider.id ? 'selected' : '';
                riderSelect.innerHTML += `<option value="${rider.id}" ${selected}>${rider.first_name} ${rider.last_name}</option>`;
            });
        }

        // Populate form with current values
        document.getElementById('orderStatus').value = order.status;
        document.getElementById('riderLocation').value = order.rider_location || '';

        // Store order ID for saving
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

    try {
        // Update status if changed
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

        // Assign rider if selected
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

        // Update rider location if provided
        if (riderLocation) {
            await fetch(`${API_BASE}/api/orders/${orderId}/rider-location`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ location: riderLocation })
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
function loadCategories() {
    fetch(`${API_BASE}/api/categories`)
    .then(response => response.json())
    .then(data => {
        const tbody = document.getElementById('categoriesTableBody');
        tbody.innerHTML = '';

        data.categories.forEach(category => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${category.id}</td>
                <td>${category.name}</td>
                <td>${category.description || ''}</td>
                <td><span class="status-${category.is_active ? 'active' : 'inactive'}">${category.is_active ? 'Active' : 'Inactive'}</span></td>
                <td>
                    <button class="btn btn-small btn-edit" onclick="editCategory(${category.id})">Edit</button>
                    <button class="btn btn-small btn-secondary" onclick="toggleCategoryStatus(${category.id}, ${category.is_active})">
                        ${category.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
    })
    .catch(error => console.error('Error loading categories:', error));
}

function editCategory(categoryId) {
    showInfo('Coming Soon', 'Edit category functionality will be implemented soon');
}

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
        const resp = await fetch(`${API_BASE}/api/units`, { headers: { 'Authorization': `Bearer ${authToken}` } });
        const data = await resp.json();
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
                    <button class="btn btn-small btn-edit" onclick="editUnit(${u.id})">Edit</button>
                    <button class="btn btn-small btn-secondary" onclick="deleteUnit(${u.id})">Delete</button>
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
    const form = document.getElementById('addUnitForm');
    if (form) form.reset();
    showModal('addUnitModal');
}

async function saveUnit() {
    const form = document.getElementById('addUnitForm');
    if (!form) return;
    const formData = new FormData(form);
    const payload = {
        name: formData.get('name'),
        abbreviation: formData.get('abbreviation') || null,
        multiplier: formData.get('multiplier') || 1.0
    };
    try {
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
        const data = await resp.json();
        if (data.success) {
            showSuccess('Saved', 'Unit saved successfully');
            hideModal('addUnitModal');
            editingUnitId = null;
            await loadUnits();
        } else {
            showError('Error', data.message || 'Failed to save unit');
        }
    } catch (err) {
        console.error('Error saving unit:', err);
        showError('Error', 'Failed to save unit');
    }
}

async function editUnit(unitId) {
    editingUnitId = unitId;
    // try find in currentUnits
    const unit = (currentUnits || []).find(u => u.id === unitId);
    if (!unit) {
        // fallback: fetch single unit from API if available
        try {
            const resp = await fetch(`${API_BASE}/api/units`, { headers: { 'Authorization': `Bearer ${authToken}` } });
            const data = await resp.json();
            if (data.success) {
                currentUnits = data.units || [];
            }
        } catch (e) { /* ignore */ }
    }
    const u = (currentUnits || []).find(x => x.id === unitId);
    if (u) {
        const form = document.getElementById('addUnitForm');
        form.querySelector('#unitName').value = u.name || '';
        form.querySelector('#unitAbbrev').value = u.abbreviation || '';
        form.querySelector('#unitMultiplier').value = typeof u.multiplier !== 'undefined' ? parseFloat(u.multiplier).toFixed(4) : '1.0000';
        showModal('addUnitModal');
    } else {
        showError('Not Found', 'Unit not found');
    }
}

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
                    <button class="btn btn-small btn-edit" onclick="editSize(${s.id})">Edit</button>
                    <button class="btn btn-small btn-secondary" onclick="deleteSize(${s.id})">Delete</button>
                </td>
            `;
            tbody.appendChild(row);
        });
    } catch (err) {
        console.error('Error loading sizes:', err);
        showError('Error', 'Failed to load sizes');
    }
}

function showAddSizeModal() {
    editingSizeId = null;
    const form = document.getElementById('addSizeForm');
    if (form) form.reset();
    showModal('addSizeModal');
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
        const data = await resp.json();
        if (data.success) {
            showSuccess('Saved', 'Size saved successfully');
            hideModal('addSizeModal');
            editingSizeId = null;
            await loadSizes();
        } else {
            showError('Error', data.message || 'Failed to save size');
        }
    } catch (err) {
        console.error('Error saving size:', err);
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
    // Hide any other open modals first so only one modal is visible at a time
    document.querySelectorAll('.modal').forEach(m => {
        try { m.style.display = 'none'; } catch (e) { /* ignore */ }
    });
    const el = document.getElementById(modalId);
    if (!el) {
        console.warn('showModal: modal not found', modalId);
        return;
    }
    // Ensure modal is visible and on top
    el.style.display = 'block';
    try { el.style.zIndex = 9999; } catch (e) { /* ignore */ }

    // Focus first focusable element inside modal to ensure keyboard and visibility
    try {
        const first = el.querySelector('input, select, textarea, button, [tabindex]');
        if (first) {
            first.focus();
        } else {
            const content = el.querySelector('.modal-content');
            if (content) { content.setAttribute('tabindex', '-1'); content.focus(); }
        }
    } catch (e) { /* ignore focus errors */ }

    console.debug('showModal: opened', modalId);
}

function hideModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'none';
    // Reset form
    const form = document.querySelector(`#${modalId} form`);
    if (form) form.reset();
    // Clear any editing state related to this modal to avoid stale IDs
    try {
        if (modalId === 'addUserModal') editingUserId = null;
        if (modalId === 'addUnitModal') editingUnitId = null;
        if (modalId === 'addSizeModal') editingSizeId = null;
        if (modalId === 'addStoreModal') editingStoreId = null;
        if (modalId === 'addProductModal') editingProductId = null;
        if (modalId === 'addCategoryModal') editingCategoryId = null;
        if (modalId === 'addRiderModal') editingRiderId = null;
    } catch (e) { /* ignore */ }
}

// User Management Functions
function showAddUserModal() {
    showModal('addUserModal');
}

async function saveUser() {
    const formData = new FormData(document.getElementById('addUserForm'));
    const userData = {
        firstName: formData.get('firstName'),
        lastName: formData.get('lastName'),
        email: formData.get('email'),
        phone: formData.get('phone'),
        password: formData.get('password'),
        address: formData.get('address'),
        userType: formData.get('userType'),
        is_active: formData.get('is_active') !== null ? (formData.get('is_active') === '1' ? true : false) : true
    };
    try {
        if (editingUserId) {
            // Update existing user (send editable fields)
            const payload = {
                firstName: userData.firstName,
                lastName: userData.lastName,
                email: userData.email,
                phone: userData.phone,
                address: userData.address,
                user_type: userData.userType,
                is_active: userData.is_active
            };
            // include password only if provided
            if (userData.password) payload.password = userData.password;

            const response = await fetch(`${API_BASE}/api/users/${editingUserId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            if (data.success) {
                showSuccess('User Updated', 'User updated successfully!');
                hideModal('addUserModal');
                editingUserId = null;
                loadUsers();
            } else {
                showError('Error', data.message || 'Failed to update user');
            }
        } else {
            const response = await fetch(`${API_BASE}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
                body: JSON.stringify(userData)
            });
            const data = await response.json();
            if (data.success) {
                showSuccess('User Created', 'User created successfully!');
                hideModal('addUserModal');
                loadUsers();
            } else {
                showError('Error', data.message || 'Failed to create user');
            }
        }
    } catch (error) {
        console.error('Error saving user:', error);
        showError('Error', 'Failed to save user');
    }
}

async function editUser(userId) {
    // Open addUser modal in edit mode
    editingUserId = userId;
    try {
        const resp = await fetch(`${API_BASE}/api/users`, { headers: { 'Authorization': `Bearer ${authToken}` } });
        const data = await resp.json();
        if (!data.success) { showError('Error', 'Failed to load user data'); return; }
        const user = data.users.find(u => u.id === userId);
        if (!user) { showError('User Not Found', 'The selected user could not be found'); return; }

        const form = document.getElementById('addUserForm');
        form.querySelector('#userFirstName').value = user.first_name || '';
        form.querySelector('#userLastName').value = user.last_name || '';
        form.querySelector('#userEmail').value = user.email || '';
        form.querySelector('#userPhone').value = user.phone || '';
        form.querySelector('#userAddress').value = user.address || '';
        form.querySelector('#userType').value = user.user_type || 'customer';
        const statusSel = form.querySelector('#userStatus');
        if (statusSel) statusSel.value = user.is_active ? '1' : '0';

        showModal('addUserModal');
    } catch (e) {
        console.error('Error loading user for edit', e);
        showError('Error', 'Failed to load user for edit');
    }
}

async function showAddStoreModal() {
    // Load categories for dropdown
    try {
        const categoriesResponse = await fetch(`${API_BASE}/api/categories`);
        const categoriesData = await categoriesResponse.json();

        // Populate category dropdown
        const categorySelect = document.getElementById('storeCategory');
        categorySelect.innerHTML = '<option value="">Select Category (Optional)</option>';
        if (categoriesData.success) {
            categoriesData.categories.forEach(category => {
                categorySelect.innerHTML += `<option value="${category.id}">${category.name}</option>`;
            });
        }

        showModal('addStoreModal');
    } catch (error) {
        console.error('Error loading categories:', error);
        showModal('addStoreModal');
    }
}

async function saveStore() {
    const formData = new FormData(document.getElementById('addStoreForm'));
    const storeData = {
        name: formData.get('name'),
        owner: formData.get('owner'),
        description: formData.get('description'),
        location: formData.get('location'),
        phone: formData.get('phone'),
        email: formData.get('email'),
        image_url: formData.get('image_url'),
        rating: parseFloat(formData.get('rating')) || 0,
        delivery_time: formData.get('delivery_time'),
        opening_time: formData.get('opening_time') || null,
        closing_time: formData.get('closing_time') || null,
        address: formData.get('address'),
        status: formData.get('status') || 'active',
        category_id: formData.get('category_id') || null
    };

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
        const form = document.getElementById('addStoreForm');
        form.querySelector('#storeName').value = s.name || '';
        form.querySelector('#storeOwner').value = s.owner_id || '';
        form.querySelector('#storeLocation').value = s.location || '';
        form.querySelector('#storeImage').value = s.image_url || '';
        form.querySelector('#storePhone').value = s.phone || '';
        form.querySelector('#storeEmail').value = s.email || '';
        form.querySelector('#storeRating').value = s.rating || 0;
        form.querySelector('#storeDeliveryTime').value = s.delivery_time || '';
        if (s.opening_time) form.querySelector('#storeOpeningTime').value = s.opening_time;
        if (s.closing_time) form.querySelector('#storeClosingTime').value = s.closing_time;
        form.querySelector('#storeDescription').value = s.description || '';
        form.querySelector('#storeAddress').value = s.address || '';
        // category dropdown may be populated; attempt to set value
        const catSel = form.querySelector('#storeCategory'); if (catSel && s.category_id) catSel.value = s.category_id;
        showModal('addStoreModal');
    } catch (e) {
        console.error('Failed to load store for edit', e);
        showError('Error', 'Failed to load store for edit');
    }
}

// Product Management Functions
async function showAddProductModal() {
    // Load stores and categories for dropdowns
    try {
        const [storesResponse, categoriesResponse] = await Promise.all([
            fetch(`${API_BASE}/api/stores`),
            fetch(`${API_BASE}/api/categories`)
        ]);

        const storesData = await storesResponse.json();
        const categoriesData = await categoriesResponse.json();

        // Populate store dropdown
        const storeSelect = document.getElementById('productStore');
        storeSelect.innerHTML = '<option value="">Select Store</option>';
        if (storesData.success) {
            storesData.stores.forEach(store => {
                storeSelect.innerHTML += `<option value="${store.id}">${store.name}</option>`;
            });
        }

        // Populate category dropdown
        const categorySelect = document.getElementById('productCategory');
        categorySelect.innerHTML = '<option value="">Select Category (Optional)</option>';
        if (categoriesData.success) {
            categoriesData.categories.forEach(category => {
                categorySelect.innerHTML += `<option value="${category.id}">${category.name}</option>`;
            });
        }

        // Populate units and sizes
        try {
            const [unitsResp, sizesResp] = await Promise.all([
                fetch(`${API_BASE}/api/units`),
                fetch(`${API_BASE}/api/sizes`)
            ]);
            const unitsJson = await unitsResp.json();
            const sizesJson = await sizesResp.json();

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

        showModal('addProductModal');
        // Setup image URL/file preview and paste helper (replace handlers to avoid duplicates)
        const pasteBtn = document.getElementById('pasteImageUrlBtn');
        const urlInput = document.getElementById('productImage');
        const fileInput = document.getElementById('productImageFile');
        const preview = document.getElementById('productImagePreview');

        if (pasteBtn) {
            pasteBtn.onclick = () => {
                const url = prompt('Paste image URL (http(s)://)');
                if (url) {
                    if (urlInput) urlInput.value = url;
                    if (preview) { preview.src = url; preview.style.display = 'inline-block'; applyOrientationFitAdmin(preview); }
                }
            };
        }

        if (urlInput) {
            urlInput.oninput = () => {
                if (urlInput.value) {
                    if (preview) { preview.src = urlInput.value; preview.style.display = 'inline-block'; applyOrientationFitAdmin(preview); }
                } else if (preview) {
                    preview.style.display = 'none';
                }
            };
        }

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
        
        // Admin preview orientation helper
        function applyOrientationFitAdmin(img) {
            try {
                if (!img) return;
                const apply = () => {
                    const w = img.naturalWidth || 0;
                    const h = img.naturalHeight || 0;
                    img.classList.remove('fit-contain', 'fit-cover');
                    if (h >= w) img.classList.add('fit-contain'); else img.classList.add('fit-cover');
                };
                if (img.complete && img.naturalWidth && img.naturalHeight) apply();
                else {
                    const onLoad = function() { apply(); img.removeEventListener('load', onLoad); };
                    img.addEventListener('load', onLoad);
                }
            } catch (e) { console.warn('applyOrientationFitAdmin failed', e); }
        }
    } catch (error) {
        console.error('Error loading dropdown data:', error);
        showError('Error', 'Failed to load form data');
    }
}

async function saveProduct() {
    const formEl = document.getElementById('addProductForm');
    const formData = new FormData(formEl);
    const productData = {
        name: formData.get('name'),
        description: formData.get('description'),
        price: parseFloat(formData.get('price')),
        image_url: formData.get('image_url'),
        category_id: formData.get('category_id') || null,
        store_id: parseInt(formData.get('store_id')),
        stock_quantity: parseInt(formData.get('stock_quantity')) || 0,
        unit_id: formData.get('unit_id') || null,
        size_id: formData.get('size_id') || null
    };

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
                showWarning('Upload Warning', upJson.message || 'Image upload returned no URL. Using provided URL instead.');
            }
        } catch (err) {
            console.error('Image upload failed', err);
            showWarning('Upload Failed', 'Image upload failed. Using provided image URL if any.');
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
            showError('Error', data.message || 'Failed to create product');
        }
    } catch (error) {
        console.error('Error creating product:', error);
        showError('Error', 'Failed to create product');
    }
}

async function editProduct(productId) {
    // Open edit modal and populate fields
    editingProductId = productId;
    try {
        const resp = await fetch(`${API_BASE}/api/products/${productId}?admin=1`, { headers: { 'Authorization': `Bearer ${authToken}` } });
        const data = await resp.json();
        if (!data.success || !data.product) {
            showError('Error', 'Failed to load product for editing');
            return;
        }
        const p = data.product;
        // populate form
        const form = document.getElementById('addProductForm');
        form.querySelector('#productName').value = p.name || '';
        form.querySelector('#productPrice').value = p.price || '';
        form.querySelector('#productDescription').value = p.description || '';
        form.querySelector('#productStock').value = p.stock_quantity || 0;
        if (form.querySelector('#productImage')) form.querySelector('#productImage').value = p.image_url || '';
        if (form.querySelector('#productImagePreview') && p.image_url) {
            const prev = form.querySelector('#productImagePreview'); prev.src = p.image_url; prev.style.display = 'inline-block';
        }
        // set selects (store/category/unit/size)
        if (p.store_id) form.querySelector('#productStore').value = p.store_id;
        if (p.category_id) form.querySelector('#productCategory').value = p.category_id;
        if (p.unit_id && form.querySelector('#productUnit')) form.querySelector('#productUnit').value = p.unit_id;
        if (p.size_id && form.querySelector('#productSize')) form.querySelector('#productSize').value = p.size_id;

        // Show modal
        showModal('addProductModal');
    } catch (e) {
        console.error('Failed to load product for edit', e);
        showError('Error', 'Failed to load product for editing');
    }
}

// Category Management Functions
function showAddCategoryModal() {
    showModal('addCategoryModal');
}

async function saveCategory() {
    const formData = new FormData(document.getElementById('addCategoryForm'));
    const categoryData = {
        name: formData.get('name'),
        description: formData.get('description'),
        image_url: formData.get('image_url')
    };

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
        const resp = await fetch(`${API_BASE}/api/categories`);
        const data = await resp.json();
        if (!data.success) { showError('Error', 'Failed to load categories'); return; }
        const c = data.categories.find(x => x.id === categoryId);
        if (!c) { showError('Error', 'Category not found'); return; }
        const form = document.getElementById('addCategoryForm');
        form.querySelector('#categoryName').value = c.name || '';
        form.querySelector('#categoryImage').value = c.image_url || '';
        form.querySelector('#categoryDescription').value = c.description || '';
        showModal('addCategoryModal');
    } catch (e) {
        console.error('Failed to load category for edit', e);
        showError('Error', 'Failed to load category for edit');
    }
}

function editCategory(categoryId) {
    const newName = prompt('Enter new category name:');
    if (!newName) return;

    fetch(`${API_BASE}/api/categories/${categoryId}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ name: newName })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            loadCategories();
            showSuccess('Category Updated', 'Category updated successfully!');
        } else {
            showError('Error', 'Failed to update category');
        }
    })
    .catch(error => {
        console.error('Error updating category:', error);
        showError('Error', 'Failed to update category');
    });
}

// Riders Management Functions
function loadRiders() {
    fetch(`${API_BASE}/api/riders`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    })
    .then(response => response.json())
    .then(data => {
        const tbody = document.getElementById('ridersTableBody');
        tbody.innerHTML = '';

        data.riders.forEach(rider => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${rider.id}</td>
                <td>${rider.first_name} ${rider.last_name}</td>
                <td>${rider.email}</td>
                <td>${rider.phone}</td>
                <td>${rider.vehicle_type}</td>
                <td>${rider.license_number}</td>
                <td><span class="status-${rider.is_available ? 'active' : 'inactive'}">${rider.is_available ? 'Available' : 'Unavailable'}</span></td>
                <td><span class="status-${rider.is_active ? 'active' : 'inactive'}">${rider.is_active ? 'Active' : 'Inactive'}</span></td>
                <td>
                    <button class="btn btn-small btn-edit" onclick="editRider(${rider.id})">Edit</button>
                    <button class="btn btn-small btn-secondary" onclick="toggleRiderStatus(${rider.id}, ${rider.is_active})">
                        ${rider.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
    })
    .catch(error => console.error('Error loading riders:', error));
}

// --- Rider Fuel History Client Functions ---
function loadRidersForFuelSelect() {
    return fetch(`${API_BASE}/api/riders`, { headers: { 'Authorization': `Bearer ${authToken}` } })
    .then(r => r.json())
    .then(data => {
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
    })
    .catch(err => { console.error('Error loading riders for fuel select:', err); showError('Error', 'Failed to load rider list'); return null; });
}

function loadFuelHistory(riderId) {
    const tbody = document.getElementById('fuelHistoryTableBody');
    if (!tbody) return Promise.resolve();
    if (!riderId) {
        tbody.innerHTML = '<tr><td colspan="10">Select a rider to view fuel history.</td></tr>';
        return Promise.resolve();
    }

    tbody.innerHTML = '<tr><td colspan="10">Loading...</td></tr>';

    return fetch(`${API_BASE}/api/riders/${riderId}/fuel-history`, { headers: { 'Authorization': `Bearer ${authToken}` } })
    .then(r => r.json())
    .then(data => {
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
    })
    .catch(err => {
        console.error('Error loading fuel history:', err);
        tbody.innerHTML = '<tr><td colspan="10">Error loading fuel history.</td></tr>';
        showError('Error', 'Error loading fuel history');
        return Promise.reject(err);
    });
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

async function showAddRiderModal() {
    // Load vehicle types for dropdown
    try {
        const vehicleTypesResponse = await fetch(`${API_BASE}/api/riders/types/vehicle`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const vehicleTypesData = await vehicleTypesResponse.json();

        // Populate vehicle type dropdown
        const vehicleTypeSelect = document.getElementById('riderVehicleType');
        vehicleTypeSelect.innerHTML = '<option value="">Select Vehicle Type</option>';
        if (vehicleTypesData.success) {
            vehicleTypesData.vehicleTypes.forEach(type => {
                vehicleTypeSelect.innerHTML += `<option value="${type}">${type}</option>`;
            });
        }

        showModal('addRiderModal');
    } catch (error) {
        console.error('Error loading vehicle types:', error);
        showModal('addRiderModal');
    }
}

async function saveRider() {
    const formData = new FormData(document.getElementById('addRiderForm'));
    const riderData = {
        firstName: formData.get('firstName'),
        lastName: formData.get('lastName'),
        email: formData.get('email'),
        phone: formData.get('phone'),
        password: formData.get('password'),
        vehicleType: formData.get('vehicleType'),
        licenseNumber: formData.get('licenseNumber')
    };

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
        const form = document.getElementById('addRiderForm');
        form.querySelector('#riderFirstName').value = r.first_name || '';
        form.querySelector('#riderLastName').value = r.last_name || '';
        form.querySelector('#riderEmail').value = r.email || '';
        form.querySelector('#riderPhone').value = r.phone || '';
        form.querySelector('#riderVehicleType').value = r.vehicle_type || '';
        form.querySelector('#riderLicenseNumber').value = r.license_number || '';
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
    const tbody = document.getElementById('reportsTableBody');
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

function createStatusChart(statusCounts) {
    const ctx = document.getElementById('statusChart').getContext('2d');

    // Destroy existing chart if it exists
    if (window.statusChart) {
        window.statusChart.destroy();
    }

    window.statusChart = new Chart(ctx, {
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
    if (window.revenueChart) {
        window.revenueChart.destroy();
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

    window.revenueChart = new Chart(ctx, {
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
        case 'users':
            data = currentUsers;
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
        case 'users':
            displayUsers(data);
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
function loadUsers() {
    fetch(`${API_BASE}/api/users`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    })
    .then(response => response.json())
    .then(data => {
        currentUsers = data.users || [];
        displayUsers(currentUsers);
        initializeTableSorting('users');
    })
    .catch(error => console.error('Error loading users:', error));
}

function displayUsers(users) {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '';

    users.forEach(user => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${user.id}</td>
            <td>${user.first_name} ${user.last_name}</td>
            <td>${user.email}</td>
            <td>${user.user_type}</td>
            <td><span class="status-${user.is_active ? 'active' : 'inactive'}">${user.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
                <button class="btn btn-small btn-edit" onclick="editUser(${user.id})">Edit</button>
                <button class="btn btn-small btn-secondary" onclick="toggleUserStatus(${user.id}, ${user.is_active})">
                    ${user.is_active ? 'Deactivate' : 'Activate'}
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function loadStores() {
    fetch(`${API_BASE}/api/stores`)
    .then(response => response.json())
    .then(data => {
        currentStores = data.stores || [];
        displayStores(currentStores);
        initializeTableSorting('stores');
    })
    .catch(error => console.error('Error loading stores:', error));
}

function displayStores(stores) {
    const tbody = document.getElementById('storesTableBody');
    tbody.innerHTML = '';

    stores.forEach(store => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${store.id}</td>
            <td>${store.name}</td>
            <td>${store.location}</td>
            <td>${store.owner_name || 'Admin'}</td>
            <td>${store.rating} ⭐</td>
            <td><span class="status-${store.is_active ? 'active' : 'inactive'}">${store.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
                <button class="btn btn-small btn-edit" onclick="editStore(${store.id})">Edit</button>
                <button class="btn btn-small btn-secondary" onclick="toggleStoreStatus(${store.id}, ${store.is_active})">
                    ${store.is_active ? 'Deactivate' : 'Activate'}
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function loadCategories() {
    fetch(`${API_BASE}/api/categories`)
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
                <button class="btn btn-small btn-edit" onclick="editCategory(${category.id})">Edit</button>
                <button class="btn btn-small btn-secondary" onclick="toggleCategoryStatus(${category.id}, ${category.is_active})">
                    ${category.is_active ? 'Deactivate' : 'Activate'}
                </button>
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
            <td>${rider.first_name} ${rider.last_name}</td>
            <td>${rider.email}</td>
            <td>${rider.phone}</td>
            <td>${rider.vehicle_type}</td>
            <td>${rider.license_number}</td>
            <td><span class="status-${rider.is_available ? 'active' : 'inactive'}">${rider.is_available ? 'Available' : 'Unavailable'}</span></td>
            <td><span class="status-${rider.is_active ? 'active' : 'inactive'}">${rider.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>
                <button class="btn btn-small btn-edit" onclick="editRider(${rider.id})">Edit</button>
                <button class="btn btn-small btn-secondary" onclick="toggleRiderStatus(${rider.id}, ${rider.is_active})">
                    ${rider.is_active ? 'Deactivate' : 'Activate'}
                </button>
                <button class="btn btn-small btn-secondary" onclick="openFuelForRider(${rider.id})">Fuel</button>
            </td>
        `;
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

        const thead = table.querySelector('thead');
        const tbody = table.querySelector('tbody');
        const firstTr = tbody ? tbody.querySelector('tr') : null;
        const th = table.querySelector('thead th:first-child');
        const td = table.querySelector('tbody tr td:first-child');

        function pick(el){
            if(!el) return null;
            const cs = getComputedStyle(el);
            return {
                tag: el.tagName,
                id: el.id || null,
                class: el.className || null,
                inlineStyle: el.style && el.style.cssText ? el.style.cssText : null,
                display: cs.display,
                position: cs.position,
                left: cs.left,
                transform: cs.transform,
                marginLeft: cs.marginLeft,
                paddingLeft: cs.paddingLeft,
                width: cs.width,
                minWidth: cs.minWidth,
                maxWidth: cs.maxWidth,
                boxSizing: cs.boxSizing,
                whiteSpace: cs.whiteSpace,
                overflow: cs.overflow
            };
        }

        console.log('DEBUG: Table element:', pick(table));
        console.log('DEBUG: Thead element:', pick(thead));
        console.log('DEBUG: Tbody element:', pick(tbody));
        console.log('DEBUG: First TR (tbody):', pick(firstTr));
        console.log('DEBUG: First TH:', pick(th));
        console.log('DEBUG: First TD:', pick(td));

        console.log('DEBUG: Bounding rects:');
        console.log('Table rect:', table.getBoundingClientRect());
        if(thead) console.log('Thead rect:', thead.getBoundingClientRect());
        if(tbody) console.log('Tbody rect:', tbody.getBoundingClientRect());
        if(th) console.log('TH rect:', th.getBoundingClientRect());
        if(td) console.log('TD rect:', td.getBoundingClientRect());

        console.log('DEBUG: Children of first TR (index,text,left,width):');
        if(firstTr){
            Array.from(firstTr.children).forEach((c,i)=>{
                console.log(i, c.tagName, c.textContent.trim().slice(0,40), c.getBoundingClientRect().left, getComputedStyle(c).width);
            });
        }

        console.log('DEBUG: Any colgroup present?', !!table.querySelector('colgroup'), 'colgroup:', table.querySelector('colgroup') ? table.querySelector('colgroup').outerHTML : null);

        if(thead && tbody){
            const dx = (tbody.getBoundingClientRect().left - thead.getBoundingClientRect().left);
            console.log('DEBUG: tbody left - thead left =', dx);
        }

        // highlight first column visually
        document.querySelectorAll('#ridersTable th:first-child, #ridersTable td:first-child').forEach(e=>{
            e.style.outline = '3px dashed red';
            e.style.background = 'rgba(255,0,0,0.03)';
        });

        // log ancestor chain to detect unexpected offsets
        let el = table;
        console.log('DEBUG: Ancestor chain (tag, id, classes, inline style, left/margin/padding/transform):');
        while(el && el.tagName){
            const cs = getComputedStyle(el);
            console.log(el.tagName, el.id || '', el.className || '', 'inlineStyle=', el.style && el.style.cssText ? el.style.cssText : '', 'left=', cs.left, 'marginLeft=', cs.marginLeft, 'paddingLeft=', cs.paddingLeft, 'transform=', cs.transform);
            el = el.parentElement;
        }

    } catch (err) {
        console.error('runDebugTableHighlight error:', err);
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
