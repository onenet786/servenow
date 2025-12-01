// Admin Dashboard JavaScript
let currentUser = null;
let authToken = null;

// Initialize admin dashboard
document.addEventListener('DOMContentLoaded', function() {
    // Check if user is logged in and is admin
    authToken = localStorage.getItem('serveNowToken');
    if (!authToken) {
        window.location.href = 'login.html';
        return;
    }

    // Verify user is admin
    fetch(`${API_BASE}/api/auth/profile`, {
        headers: {
            'Authorization': `Bearer ${authToken}`
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success && data.user.user_type === 'admin') {
            currentUser = data.user;
            initializeAdmin();
        } else {
            localStorage.removeItem('serveNowToken');
            window.location.href = 'login.html';
        }
    })
    .catch(error => {
        console.error('Auth check failed:', error);
        localStorage.removeItem('serveNowToken');
        window.location.href = 'login.html';
    });
});

function initializeAdmin() {
    // Tab switching
    const tabLinks = document.querySelectorAll('.tab-link');
    tabLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            switchTab(this.dataset.tab);
        });
    });

    // Logout functionality
    document.getElementById('logoutBtn').addEventListener('click', function(e) {
        e.preventDefault();
        localStorage.removeItem('serveNowToken');
        window.location.href = 'login.html';
    });

    // Load initial dashboard data
    loadDashboardStats();

    // Add event listeners for buttons
    document.getElementById('addUserBtn').addEventListener('click', () => showAddUserModal());
    document.getElementById('addStoreBtn').addEventListener('click', () => showAddStoreModal());
    document.getElementById('addProductBtn').addEventListener('click', () => showAddProductModal());
    document.getElementById('addCategoryBtn').addEventListener('click', () => showAddCategoryModal());
}

function switchTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab-link').forEach(link => {
        link.classList.remove('active');
    });

    // Show selected tab
    document.getElementById(tabName).classList.add('active');
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

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
    }
}

function loadDashboardStats() {
    // Load stats for dashboard
    Promise.all([
        fetch('/api/users', { headers: { 'Authorization': `Bearer ${authToken}` } }),
        fetch('/api/stores'),
        fetch('/api/products'),
        fetch('/api/orders', { headers: { 'Authorization': `Bearer ${authToken}` } })
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

// Users Management
function loadUsers() {
    fetch('/api/users', {
        headers: { 'Authorization': `Bearer ${authToken}` }
    })
    .then(response => response.json())
    .then(data => {
        const tbody = document.getElementById('usersTableBody');
        tbody.innerHTML = '';

        data.users.forEach(user => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${user.id}</td>
                <td>${user.first_name} ${user.last_name}</td>
                <td>${user.email}</td>
                <td>${user.user_type}</td>
                <td><span class="status-${user.is_active ? 'active' : 'inactive'}">${user.is_active ? 'Active' : 'Inactive'}</span></td>
                <td>
                    <button class="btn btn-small" onclick="editUser(${user.id})">Edit</button>
                    <button class="btn btn-small btn-secondary" onclick="toggleUserStatus(${user.id}, ${user.is_active})">
                        ${user.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
    })
    .catch(error => console.error('Error loading users:', error));
}

function editUser(userId) {
    // Get current user data first
    fetch('/api/users', {
        headers: { 'Authorization': `Bearer ${authToken}` }
    })
    .then(response => response.json())
    .then(data => {
        const user = data.users.find(u => u.id === userId);
        if (!user) {
            alert('User not found');
            return;
        }

        const newType = prompt('Enter new user type (customer, store_owner, admin):', user.user_type);
        if (!newType || !['customer', 'store_owner', 'admin'].includes(newType)) {
            alert('Invalid user type. Please enter: customer, store_owner, or admin');
            return;
        }

        fetch(`/api/users/${userId}`, {
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
                alert('User updated successfully!');
            } else {
                alert(data.message || 'Failed to update user');
            }
        })
        .catch(error => {
            console.error('Error updating user:', error);
            alert('Error updating user');
        });
    })
    .catch(error => {
        console.error('Error fetching user:', error);
        alert('Error fetching user data');
    });
}

function toggleUserStatus(userId, currentStatus) {
    fetch(`/api/users/${userId}`, {
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
            alert('Error updating user status');
        }
    })
    .catch(error => console.error('Error updating user:', error));
}

// Stores Management
function loadStores() {
    fetch('/api/stores')
    .then(response => response.json())
    .then(data => {
        const tbody = document.getElementById('storesTableBody');
        tbody.innerHTML = '';

        data.stores.forEach(store => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${store.id}</td>
                <td>${store.name}</td>
                <td>${store.location}</td>
                <td>${store.owner_name || 'Admin'}</td>
                <td>${store.rating} ⭐</td>
                <td><span class="status-${store.is_active ? 'active' : 'inactive'}">${store.is_active ? 'Active' : 'Inactive'}</span></td>
                <td>
                    <button class="btn btn-small" onclick="editStore(${store.id})">Edit</button>
                    <button class="btn btn-small btn-secondary" onclick="toggleStoreStatus(${store.id}, ${store.is_active})">
                        ${store.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
    })
    .catch(error => console.error('Error loading stores:', error));
}

function editStore(storeId) {
    alert('Edit store functionality to be implemented');
}

function toggleStoreStatus(storeId, currentStatus) {
    fetch(`/api/stores/${storeId}`, {
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
            alert('Error updating store status');
        }
    })
    .catch(error => console.error('Error updating store:', error));
}

// Products Management
function loadProducts() {
    fetch('/api/products')
    .then(response => response.json())
    .then(data => {
        const tbody = document.getElementById('productsTableBody');
        tbody.innerHTML = '';

        data.products.forEach(product => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${product.id}</td>
                <td>${product.name}</td>
                <td>$${product.price}</td>
                <td>${product.category_name}</td>
                <td>${product.store_name}</td>
                <td>${product.stock_quantity}</td>
                <td><span class="status-${product.is_available ? 'active' : 'inactive'}">${product.is_available ? 'Available' : 'Unavailable'}</span></td>
                <td>
                    <button class="btn btn-small" onclick="editProduct(${product.id})">Edit</button>
                    <button class="btn btn-small btn-secondary" onclick="toggleProductStatus(${product.id}, ${product.is_available})">
                        ${product.is_available ? 'Deactivate' : 'Activate'}
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
    })
    .catch(error => console.error('Error loading products:', error));
}

function editProduct(productId) {
    alert('Edit product functionality to be implemented');
}

function toggleProductStatus(productId, currentStatus) {
    fetch(`/api/products/${productId}`, {
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
            alert('Error updating product status');
        }
    })
    .catch(error => console.error('Error updating product:', error));
}

// Orders Management
function loadOrders() {
    fetch('/api/orders', {
        headers: { 'Authorization': `Bearer ${authToken}` }
    })
    .then(response => response.json())
    .then(data => {
        const tbody = document.getElementById('ordersTableBody');
        tbody.innerHTML = '';

        data.orders.forEach(order => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${order.order_number}</td>
                <td>${order.first_name} ${order.last_name}</td>
                <td>${order.store_name}</td>
                <td>$${order.total_amount}</td>
                <td><span class="status-${order.status}">${order.status.charAt(0).toUpperCase() + order.status.slice(1)}</span></td>
                <td>${new Date(order.created_at).toLocaleDateString()}</td>
                <td>
                    <button class="btn btn-small" onclick="updateOrderStatus(${order.id}, '${order.status}')">Update Status</button>
                </td>
            `;
            tbody.appendChild(row);
        });
    })
    .catch(error => console.error('Error loading orders:', error));
}

function updateOrderStatus(orderId, currentStatus) {
    const newStatus = prompt('Enter new status (pending, confirmed, preparing, ready, delivered, cancelled):', currentStatus);
    if (!newStatus) return;

    fetch(`/api/orders/${orderId}/status`, {
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
            alert('Error updating order status');
        }
    })
    .catch(error => console.error('Error updating order:', error));
}

// Categories Management
function loadCategories() {
    fetch('/api/categories')
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
                    <button class="btn btn-small" onclick="editCategory(${category.id})">Edit</button>
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
    alert('Edit category functionality to be implemented');
}

function toggleCategoryStatus(categoryId, currentStatus) {
    fetch(`/api/categories/${categoryId}`, {
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
            alert('Error updating category status');
        }
    })
    .catch(error => console.error('Error updating category:', error));
}

// Modal functions
function showModal(modalId) {
    document.getElementById(modalId).style.display = 'block';
}

function hideModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
    // Reset form
    const form = document.querySelector(`#${modalId} form`);
    if (form) form.reset();
}

// Modal event listeners
document.addEventListener('DOMContentLoaded', function() {
    // Close modal when clicking X or outside
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('close') || e.target.classList.contains('modal')) {
            const modalId = e.target.dataset.modal || e.target.id;
            hideModal(modalId);
        }
    });

    // Add button event listeners
    document.getElementById('addUserBtn').addEventListener('click', () => showModal('addUserModal'));
    document.getElementById('addStoreBtn').addEventListener('click', () => showAddStoreModal());
    document.getElementById('addProductBtn').addEventListener('click', () => showAddProductModal());
    document.getElementById('addCategoryBtn').addEventListener('click', () => showAddCategoryModal());

    // Save button event listeners
    document.getElementById('saveUserBtn').addEventListener('click', saveUser);
    document.getElementById('saveStoreBtn').addEventListener('click', saveStore);
    document.getElementById('saveProductBtn').addEventListener('click', saveProduct);
    document.getElementById('saveCategoryBtn').addEventListener('click', saveCategory);
});

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
        userType: formData.get('userType')
    };

    try {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(userData)
        });

        const data = await response.json();

        if (data.success) {
            alert('User created successfully!');
            hideModal('addUserModal');
            loadUsers();
        } else {
            alert(data.message || 'Failed to create user');
        }
    } catch (error) {
        console.error('Error creating user:', error);
        alert('Error creating user');
    }
}

function editUser(userId) {
    // Get current user data first
    fetch('/api/users', {
        headers: { 'Authorization': `Bearer ${authToken}` }
    })
    .then(response => response.json())
    .then(data => {
        const user = data.users.find(u => u.id === userId);
        if (!user) {
            alert('User not found');
            return;
        }

        const newType = prompt('Enter new user type (customer, store_owner, admin):', user.user_type);
        if (!newType || !['customer', 'store_owner', 'admin'].includes(newType)) return;

        fetch(`/api/users/${userId}`, {
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
                alert('User updated successfully!');
            } else {
                alert('Failed to update user');
            }
        })
        .catch(error => {
            console.error('Error updating user:', error);
            alert('Error updating user');
        });
    })
    .catch(error => {
        console.error('Error fetching user:', error);
        alert('Error fetching user data');
    });
}

// Store Management Functions
async function showAddStoreModal() {
    showModal('addStoreModal');
}

async function saveStore() {
    const formData = new FormData(document.getElementById('addStoreForm'));
    const storeData = {
        name: formData.get('name'),
        description: formData.get('description'),
        location: formData.get('location'),
        phone: formData.get('phone'),
        email: formData.get('email'),
        rating: parseFloat(formData.get('rating')) || 0,
        delivery_time: formData.get('delivery_time'),
        address: formData.get('address')
    };

    try {
        const response = await fetch('/api/stores', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(storeData)
        });

        const data = await response.json();

        if (data.success) {
            alert('Store created successfully!');
            hideModal('addStoreModal');
            loadStores();
        } else {
            alert(data.message || 'Failed to create store');
        }
    } catch (error) {
        console.error('Error creating store:', error);
        alert('Error creating store');
    }
}

function editStore(storeId) {
    // Simple edit functionality - could be expanded with a full modal
    const newName = prompt('Enter new store name:');
    if (!newName) return;

    fetch(`/api/stores/${storeId}`, {
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
            loadStores();
            alert('Store updated successfully!');
        } else {
            alert('Failed to update store');
        }
    })
    .catch(error => {
        console.error('Error updating store:', error);
        alert('Error updating store');
    });
}

// Product Management Functions
async function showAddProductModal() {
    // Load stores and categories for dropdowns
    try {
        const [storesResponse, categoriesResponse] = await Promise.all([
            fetch('/api/stores'),
            fetch('/api/categories')
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

        showModal('addProductModal');
    } catch (error) {
        console.error('Error loading dropdown data:', error);
        alert('Error loading form data');
    }
}

async function saveProduct() {
    const formData = new FormData(document.getElementById('addProductForm'));
    const productData = {
        name: formData.get('name'),
        description: formData.get('description'),
        price: parseFloat(formData.get('price')),
        image_url: formData.get('image_url'),
        category_id: formData.get('category_id') || null,
        store_id: parseInt(formData.get('store_id')),
        stock_quantity: parseInt(formData.get('stock_quantity')) || 0
    };

    try {
        const response = await fetch('/api/products', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(productData)
        });

        const data = await response.json();

        if (data.success) {
            alert('Product created successfully!');
            hideModal('addProductModal');
            loadProducts();
        } else {
            alert(data.message || 'Failed to create product');
        }
    } catch (error) {
        console.error('Error creating product:', error);
        alert('Error creating product');
    }
}

function editProduct(productId) {
    // Simple edit functionality - could be expanded
    const newPrice = prompt('Enter new price:');
    if (!newPrice || isNaN(newPrice)) return;

    fetch(`/api/products/${productId}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ price: parseFloat(newPrice) })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            loadProducts();
            alert('Product updated successfully!');
        } else {
            alert('Failed to update product');
        }
    })
    .catch(error => {
        console.error('Error updating product:', error);
        alert('Error updating product');
    });
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
        const response = await fetch('/api/categories', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(categoryData)
        });

        const data = await response.json();

        if (data.success) {
            alert('Category created successfully!');
            hideModal('addCategoryModal');
            loadCategories();
        } else {
            alert(data.message || 'Failed to create category');
        }
    } catch (error) {
        console.error('Error creating category:', error);
        alert('Error creating category');
    }
}

function editCategory(categoryId) {
    const newName = prompt('Enter new category name:');
    if (!newName) return;

    fetch(`/api/categories/${categoryId}`, {
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
            alert('Category updated successfully!');
        } else {
            alert('Failed to update category');
        }
    })
    .catch(error => {
        console.error('Error updating category:', error);
        alert('Error updating category');
    });
}
