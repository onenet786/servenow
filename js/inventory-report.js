function loadInventoryReport() {
    const apiBase = window.API_BASE || `${window.location.protocol}//${window.location.host}`;
    const token = localStorage.getItem('serveNowToken');
    
    fetch(`${apiBase}/api/admin/inventory-report`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            displayInventoryReport(data);
        } else {
            showError('Inventory Report', data.message || 'Failed to load inventory report');
        }
    })
    .catch(err => {
        console.error('Error loading inventory report:', err);
        showError('Inventory Report', 'Error loading inventory report');
    });
}

function loadStoreSalesReport() {
    const apiBase = window.API_BASE || `${window.location.protocol}//${window.location.host}`;
    const token = localStorage.getItem('serveNowToken');
    
    fetch(`${apiBase}/api/admin/store-sales-report`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            displayStoreSalesReport(data);
        } else {
            showError('Store Sales Report', data.message || 'Failed to load store sales report');
        }
    })
    .catch(err => {
        console.error('Error loading store sales report:', err);
        showError('Store Sales Report', 'Error loading store sales report');
    });
}

function displayInventoryReport(data) {
    const summary = data.summary;
    
    document.getElementById('inventoryTotalStoresCount').textContent = summary.total_stores;
    document.getElementById('inventoryTotalCategoriesCount').textContent = summary.total_categories;
    document.getElementById('inventoryTotalProductsCount').textContent = summary.total_products;
    document.getElementById('inventoryTotalStockCount').textContent = summary.total_stock.toLocaleString();
    document.getElementById('inventoryTotalValue').textContent = `PKR ${summary.total_inventory_value.toFixed(2)}`;
    
    const activeStores = data.store_wise.filter(s => s.is_active === true || s.is_active === 1 || s.is_active === '1').length;
    const inactiveStores = data.store_wise.length - activeStores;
    document.getElementById('inventoryActiveStoresCount').textContent = activeStores;
    document.getElementById('inventoryInactiveStoresCount').textContent = inactiveStores;
    
    displayStoreWiseInventory(data.store_wise);
    displayCategoryWiseInventory(data.category_wise);
    displayStoreCategoryBreakdown(data.store_category_breakdown);
}

function displayStoreWiseInventory(stores) {
    const tbody = document.getElementById('storeInventoryBody');
    tbody.innerHTML = '';
    
    stores.forEach(store => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${store.store_name}</td>
            <td>${store.total_products}</td>
            <td>${store.total_stock.toLocaleString()}</td>
            <td>PKR ${store.total_inventory_value.toFixed(2)}</td>
        `;
        tbody.appendChild(row);
    });
}

function displayCategoryWiseInventory(categories) {
    const tbody = document.getElementById('categoryInventoryBody');
    tbody.innerHTML = '';
    
    categories.forEach(category => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${category.category_name}</td>
            <td>${category.total_products}</td>
            <td>${category.total_stock.toLocaleString()}</td>
            <td>PKR ${category.total_inventory_value.toFixed(2)}</td>
        `;
        tbody.appendChild(row);
    });
}

function displayStoreCategoryBreakdown(breakdown) {
    const tbody = document.getElementById('storeCategoryBreakdownBody');
    tbody.innerHTML = '';
    
    breakdown.forEach(item => {
        if (item.product_count > 0 || item.stock_quantity > 0) {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${item.store_name}</td>
                <td>${item.category_name || '-'}</td>
                <td>${item.product_count}</td>
                <td>${item.stock_quantity.toLocaleString()}</td>
                <td>PKR ${item.inventory_value.toFixed(2)}</td>
            `;
            tbody.appendChild(row);
        }
    });
}

function displayStoreSalesReport(data) {
    const tbody = document.getElementById('storeSalesBody');
    tbody.innerHTML = '';
    
    data.store_sales.forEach(store => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${store.store_name}</td>
            <td>${store.total_orders}</td>
            <td>PKR ${store.total_sales.toFixed(2)}</td>
            <td>PKR ${store.average_order_value.toFixed(2)}</td>
            <td>${store.unique_customers}</td>
        `;
        tbody.appendChild(row);
    });
}

function switchInventoryReport(reportType) {
    document.getElementById('storeReportSection').style.display = 'none';
    document.getElementById('categoryReportSection').style.display = 'none';
    document.getElementById('breakdownReportSection').style.display = 'none';
    document.getElementById('salesReportSection').style.display = 'none';
    
    switch (reportType) {
        case 'store':
            document.getElementById('storeReportSection').style.display = 'block';
            break;
        case 'category':
            document.getElementById('categoryReportSection').style.display = 'block';
            break;
        case 'breakdown':
            document.getElementById('breakdownReportSection').style.display = 'block';
            break;
        case 'sales':
            document.getElementById('salesReportSection').style.display = 'block';
            loadStoreSalesReport();
            break;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const tabLinks = document.querySelectorAll('.tab-link');
    tabLinks.forEach(link => {
        if (link.getAttribute('data-tab') === 'inventory-report') {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                setTimeout(() => {
                    loadInventoryReport();
                }, 100);
            });
        }
    });
    
    const reportSelect = document.getElementById('inventoryReportSelect');
    if (reportSelect) {
        reportSelect.addEventListener('change', (e) => {
            switchInventoryReport(e.target.value);
        });
    }
});
