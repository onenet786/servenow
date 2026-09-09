let currentInventoryData = null;
let currentStoreSalesRows = [];
let currentManualSalesRows = [];
let currentStoreProductSalesRows = [];
let currentCombinedProductSalesRows = [];
let currentSalesWithDeliveryRows = [];
let currentSalesByPaymentRows = [];
let currentCustomerDetailsRows = [];
let currentCustomerOrderSummaryRows = [];
let currentCustomerSummaryRows = [];
let currentCustomerDetailsFilterLoaded = false;
let currentInventoryReportScope = "inventory";
let expandedStoreSalesStoreId = null;

const inventoryReportOptions = {
    inventory: [
        { value: "store", label: "Store-wise Inventory" },
        { value: "category", label: "Category-wise Inventory" },
        { value: "breakdown", label: "Store-wise Category Breakdown" },
        { value: "product-detail", label: "Product Cost/Sale Detail" },
    ],
    sales: [
        { value: "sales", label: "Store Sale-wise" },
        { value: "manual-sales", label: "Manual Order Product Sales" },
        { value: "store-product-sales", label: "Store Product Sales" },
        { value: "combined-product-sales", label: "Combined Product Sales" },
        { value: "sales-with-delivery", label: "Sales With Delivery Charges" },
        { value: "sales-by-payment", label: "Cash/Credit Sales With Delivery" },
        { value: "sales-by-payment-simple", label: "Cash/Credit Sales With Delivery (By Type)" },
        { value: "customer-details", label: "Customer Details by Store/Product" },
    ],
};

function inventoryMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "N/A";
    return `PKR ${n.toFixed(2)}`;
}

function inventoryNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString() : "0";
}

function inventoryDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString();
}

function inventoryEscapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function inventoryTitleCase(value) {
    return String(value || "")
        .split("_")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function inventoryPlainText(value) {
    const div = document.createElement("div");
    div.innerHTML = String(value ?? "");
    return div.textContent || div.innerText || "";
}

function openInventoryModal(modalId) {
    if (typeof showModal === "function") {
        showModal(modalId);
        return;
    }
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add("show");
}

function closeInventoryModal(modalId) {
    if (typeof hideModal === "function") {
        hideModal(modalId);
        return;
    }
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove("show");
}

function getInventoryReportOptionsForScope(scope) {
    return scope === "sales"
        ? inventoryReportOptions.sales
        : inventoryReportOptions.inventory;
}

function applyInventoryReportScope() {
    const reportSelect = document.getElementById("inventoryReportSelect");
    if (!reportSelect) return;

    const heading = document.getElementById("inventoryReportHeading");
    if (heading) {
        heading.textContent = currentInventoryReportScope === "sales" ? "Sale Reports" : "Inventory Report";
    }

    const summaryCards = document.getElementById("inventorySummaryCards");
    if (summaryCards) {
        summaryCards.style.display = currentInventoryReportScope === "sales" ? "none" : "";
    }

    const options = getInventoryReportOptionsForScope(currentInventoryReportScope);
    const currentValue = reportSelect.value;
    reportSelect.innerHTML = options
        .map((option) => `<option value="${option.value}">${option.label}</option>`)
        .join("");

    const hasCurrent = options.some((option) => option.value === currentValue);
    reportSelect.value = hasCurrent
        ? currentValue
        : (currentInventoryReportScope === "sales" ? "combined-product-sales" : "store");
}

function setInventoryReportScope(scope) {
    currentInventoryReportScope = scope === "sales" ? "sales" : "inventory";
    applyInventoryReportScope();
}

window.setInventoryReportScope = setInventoryReportScope;

function inventoryMonetaryType(value) {
    const t = String(value || "").trim().toLowerCase();
    if (t === "manual") return "Manual";
    if (t === "percent" || t === "%") return "Percent (%)";
    if (t === "amount" || t === "fixed" || t === "fixed_amount" || t === "pkr") return "Fixed Amount (PKR)";
    return "-";
}

function inventoryMonetaryValue(type, value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    const t = String(type || "").trim().toLowerCase();
    if (t === "manual") return inventoryMoney(n);
    if (n <= 0) return "-";
    if (t === "percent") return `${n.toFixed(2)}%`;
    if (t === "amount" || t === "fixed" || t === "fixed_amount" || t === "pkr" || !t) return inventoryMoney(n);
    return inventoryMoney(n);
}

function inventoryFinancialRule(mode) {
    const m = String(mode || "").trim().toLowerCase();
    if (m === "profit") return "Profit";
    if (m === "discount") return "Discount";
    return "-";
}

function resolveManualDeliveryFee(item) {
    const fee = Number(item?.delivery_fee);
    if (Number.isFinite(fee) && fee > 0) return fee;
    const orderTotal = Number(item?.order_total);
    const gross = Number(item?.gross_sales);
    const discount = Number(item?.total_discount);
    if (!Number.isFinite(orderTotal) || !Number.isFinite(gross)) return 0;
    const net = gross - (Number.isFinite(discount) ? discount : 0);
    const derived = orderTotal - net;
    return derived > 0 ? derived : 0;
}

function calculateUniqueOrderTotal(rows) {
    const seenOrderIds = new Set();
    return (rows || []).reduce((sum, item) => {
        const orderKey = String(item.order_id || item.order_number || "");
        if (!orderKey || seenOrderIds.has(orderKey)) return sum;
        seenOrderIds.add(orderKey);
        return sum + (Number(item.order_total || 0) || 0);
    }, 0);
}

function calculateUniqueDeliveryFee(rows, resolver) {
    const seenOrderIds = new Set();
    return (rows || []).reduce((sum, item) => {
        const orderKey = String(item.order_id || item.order_number || "");
        if (!orderKey || seenOrderIds.has(orderKey)) return sum;
        seenOrderIds.add(orderKey);
        const resolved = resolver ? resolver(item) : Number(item.delivery_fee || 0) || 0;
        return sum + (Number(resolved) || 0);
    }, 0);
}

function getSelectedInventoryStoreId() {
    const el = document.getElementById("inventoryStoreFilter");
    if (!el || !el.value) return null;
    const parsed = Number.parseInt(el.value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getSelectedInventoryCustomerId() {
    const el = document.getElementById("inventoryCustomerFilter");
    if (!el || !el.value) return null;
    const parsed = Number.parseInt(el.value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getSelectedInventoryCustomerName() {
    const el = document.getElementById("inventoryCustomerFilter");
    if (!el || !el.value) return "All Customers";
    return el.options[el.selectedIndex]?.textContent || `Customer #${el.value}`;
}

function getSelectedCustomerDetailsReportMode() {
    const el = document.getElementById("inventoryCustomerReportMode");
    const mode = String(el?.value || "detail").trim().toLowerCase();
    if (mode === "summary") return "order-summary";
    if (["detail", "order-summary", "customer-summary"].includes(mode)) return mode;
    return "detail";
}

function getSelectedInventoryDateRange() {
    const startDate = (document.getElementById("inventoryStartDate")?.value || "").trim();
    const endDate = (document.getElementById("inventoryEndDate")?.value || "").trim();
    return {
        startDate,
        endDate,
    };
}

function buildInventorySalesQuery() {
    const params = new URLSearchParams();
    const storeId = getSelectedInventoryStoreId();
    const activeType = (document.getElementById("inventoryReportSelect") || {}).value || "store";
    const customerId = activeType === "customer-details" ? getSelectedInventoryCustomerId() : null;
    const customerReportMode = activeType === "customer-details" ? getSelectedCustomerDetailsReportMode() : "";
    const { startDate, endDate } = getSelectedInventoryDateRange();

    if (storeId) params.set("store_id", String(storeId));
    if (customerId) params.set("customer_id", String(customerId));
    if (customerReportMode) params.set("view", customerReportMode);
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);

    const query = params.toString();
    return query ? `?${query}` : "";
}

function inventoryTodayDateValue() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
}

function ensureInventoryDateDefaults() {
    const today = inventoryTodayDateValue();
    const startDateEl = document.getElementById("inventoryStartDate");
    const endDateEl = document.getElementById("inventoryEndDate");
    if (startDateEl && !startDateEl.value) startDateEl.value = today;
    if (endDateEl && !endDateEl.value) endDateEl.value = today;
}

function loadInventoryReport() {
    const apiBase = window.API_BASE || `${window.location.protocol}//${window.location.host}`;
    const token = localStorage.getItem("serveNowToken");
    const storeId = getSelectedInventoryStoreId();
    const query = storeId ? `?store_id=${encodeURIComponent(storeId)}` : "";

    fetch(`${apiBase}/api/admin/inventory-report${query}`, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${token}`,
        },
    })
        .then((response) => response.json())
        .then((data) => {
            if (data.success) {
                currentInventoryData = data;
                displayInventoryReport(data);
            } else {
                showError("Inventory Report", data.message || "Failed to load inventory report");
            }
        })
        .catch((err) => {
            console.error("Error loading inventory report:", err);
            showError("Inventory Report", "Error loading inventory report");
        });
}

function loadStoreSalesReport() {
    const apiBase = window.API_BASE || `${window.location.protocol}//${window.location.host}`;
    const token = localStorage.getItem("serveNowToken");
    const query = buildInventorySalesQuery();

    fetch(`${apiBase}/api/admin/store-sales-report${query}`, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${token}`,
        },
    })
        .then((response) => response.json())
        .then((data) => {
            if (data.success) {
                displayStoreSalesReport(data);
            } else {
                showError("Store Sales Report", data.message || "Failed to load store sales report");
            }
        })
        .catch((err) => {
            console.error("Error loading store sales report:", err);
            showError("Store Sales Report", "Error loading store sales report");
        });
}

function loadManualOrderSalesReport() {
    const apiBase = window.API_BASE || `${window.location.protocol}//${window.location.host}`;
    const token = localStorage.getItem("serveNowToken");
    const query = buildInventorySalesQuery();

    fetch(`${apiBase}/api/admin/manual-order-sales-report${query}`, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${token}`,
        },
    })
        .then((response) => response.json())
        .then((data) => {
            if (data.success) {
                displayManualOrderSalesReport(data);
            } else {
                showError("Manual Order Product Sales Report", data.message || "Failed to load manual order product sales report");
            }
        })
        .catch((err) => {
            console.error("Error loading manual order product sales report:", err);
            showError("Manual Order Product Sales Report", "Error loading manual order product sales report");
        });
}

function loadStoreProductSalesReport() {
    const apiBase = window.API_BASE || `${window.location.protocol}//${window.location.host}`;
    const token = localStorage.getItem("serveNowToken");
    const query = buildInventorySalesQuery();

    fetch(`${apiBase}/api/admin/store-product-sales-report${query}`, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${token}`,
        },
    })
        .then((response) => response.json())
        .then((data) => {
            if (data.success) {
                displayStoreProductSalesReport(data);
            } else {
                showError("Store Product Sales Report", data.message || "Failed to load store product sales report");
            }
        })
        .catch((err) => {
            console.error("Error loading store product sales report:", err);
            showError("Store Product Sales Report", "Error loading store product sales report");
        });
}

function loadCombinedProductSalesReport() {
    const apiBase = window.API_BASE || `${window.location.protocol}//${window.location.host}`;
    const token = localStorage.getItem("serveNowToken");
    const query = buildInventorySalesQuery();

    fetch(`${apiBase}/api/admin/combined-product-sales-report${query}`, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${token}`,
        },
    })
        .then((response) => response.json())
        .then((data) => {
            if (data.success) {
                displayCombinedProductSalesReport(data);
            } else {
                showError("Combined Product Sales Report", data.message || "Failed to load combined product sales report");
            }
        })
        .catch((err) => {
            console.error("Error loading combined product sales report:", err);
            showError("Combined Product Sales Report", "Error loading combined product sales report");
        });
}

function loadSalesWithDeliveryReport() {
    const apiBase = window.API_BASE || `${window.location.protocol}//${window.location.host}`;
    const token = localStorage.getItem("serveNowToken");
    const query = buildInventorySalesQuery();

    fetch(`${apiBase}/api/admin/sales-with-delivery-report${query}`, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${token}`,
        },
    })
        .then((response) => response.json())
        .then((data) => {
            if (data.success) {
                displaySalesWithDeliveryReport(data);
            } else {
                showError("Sales With Delivery Charges Report", data.message || "Failed to load sales with delivery charges report");
            }
        })
        .catch((err) => {
            console.error("Error loading sales with delivery charges report:", err);
            showError("Sales With Delivery Charges Report", "Error loading sales with delivery charges report");
        });
}

function loadSalesByPaymentReport() {
    const apiBase = window.API_BASE || `${window.location.protocol}//${window.location.host}`;
    const token = localStorage.getItem("serveNowToken");
    const query = buildInventorySalesQuery();

    fetch(`${apiBase}/api/admin/sales-by-payment-report${query}`, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${token}`,
        },
    })
        .then((response) => response.json())
        .then((data) => {
            if (data.success) {
                displaySalesByPaymentReport(data);
            } else {
                showError("Cash/Credit Sales With Delivery Report", data.message || "Failed to load cash/credit sales report");
            }
        })
        .catch((err) => {
            console.error("Error loading cash/credit sales report:", err);
            showError("Cash/Credit Sales With Delivery Report", "Error loading cash/credit sales report");
        });
}

function loadSalesByPaymentSimpleReport() {
    const apiBase = window.API_BASE || `${window.location.protocol}//${window.location.host}`;
    const token = localStorage.getItem("serveNowToken");
    const query = buildInventorySalesQuery();

    fetch(`${apiBase}/api/admin/sales-by-payment-report${query}`, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${token}`,
        },
    })
        .then((response) => response.json())
        .then((data) => {
            if (data.success) {
                displaySalesByPaymentSimpleReport(data);
            } else {
                showError("Cash/Credit Sales With Delivery Report (By Type)", data.message || "Failed to load cash/credit sales report");
            }
        })
        .catch((err) => {
            console.error("Error loading cash/credit sales report:", err);
            showError("Cash/Credit Sales With Delivery Report (By Type)", "Error loading cash/credit sales report");
        });
}

function loadCustomerDetailsReport() {
    const apiBase = window.API_BASE || `${window.location.protocol}//${window.location.host}`;
    const token = localStorage.getItem("serveNowToken");
    const query = buildInventorySalesQuery();

    fetch(`${apiBase}/api/admin/customer-details-sales-report${query}`, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${token}`,
        },
    })
        .then((response) => response.json())
        .then((data) => {
            if (data.success) {
                displayCustomerDetailsReport(data);
            } else {
                showError("Customer Details Report", data.message || "Failed to load customer details report");
            }
        })
        .catch((err) => {
            console.error("Error loading customer details report:", err);
            showError("Customer Details Report", "Failed to load customer details report");
        });
}

async function loadCustomerDetailsCustomerFilter() {
    const select = document.getElementById("inventoryCustomerFilter");
    if (!select || currentCustomerDetailsFilterLoaded) return;

    const apiBase = window.API_BASE || `${window.location.protocol}//${window.location.host}`;
    const token = localStorage.getItem("serveNowToken");
    select.innerHTML = `<option value="">Loading customers...</option>`;

    try {
        const response = await fetch(`${apiBase}/api/admin/customer-details-sales-report/customers`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            select.innerHTML = `<option value="">All Customers</option>`;
            showError("Customer Details Report", data.message || "Failed to load customer filter");
            return;
        }

        const customers = Array.isArray(data.customers) ? data.customers : [];
        select.innerHTML = `<option value="">All Customers</option>`;
        customers.forEach((customer) => {
            if (!customer.id) return;
            const opt = document.createElement("option");
            opt.value = String(customer.id);
            const extra = [customer.email, customer.phone].filter(Boolean).join(" | ");
            opt.textContent = extra ? `${customer.name} - ${extra}` : customer.name;
            select.appendChild(opt);
        });
        currentCustomerDetailsFilterLoaded = true;
    } catch (err) {
        console.error("Error loading customer details filter:", err);
        select.innerHTML = `<option value="">All Customers</option>`;
        showError("Customer Details Report", "Failed to load customer filter");
    }
}

function populateInventoryStoreFilter(stores, selectedStoreId) {
    const select = document.getElementById("inventoryStoreFilter");
    if (!select) return;
    const prev = select.value;
    select.innerHTML = `<option value="">All Stores</option>`;
    (stores || []).forEach((store) => {
        const opt = document.createElement("option");
        opt.value = String(store.id);
        opt.textContent = `${store.name}${store.is_active ? "" : " (Inactive)"}`;
        select.appendChild(opt);
    });
    if (selectedStoreId) {
        select.value = String(selectedStoreId);
    } else if (prev && Array.from(select.options).some((o) => o.value === prev)) {
        select.value = prev;
    }
}

function displayInventoryReport(data) {
    const summary = data.summary || {};

    document.getElementById("inventoryTotalStoresCount").textContent = inventoryNumber(summary.total_stores || 0);
    document.getElementById("inventoryTotalCategoriesCount").textContent = inventoryNumber(summary.total_categories || 0);
    document.getElementById("inventoryTotalProductsCount").textContent = inventoryNumber(summary.total_products || 0);
    document.getElementById("inventoryTotalStockCount").textContent = inventoryNumber(summary.total_stock || 0);
    document.getElementById("inventoryTotalValue").textContent = inventoryMoney(summary.total_inventory_value || 0);

    const activeStores = (data.store_wise || []).filter((s) => s.is_active === true || s.is_active === 1 || s.is_active === "1").length;
    const inactiveStores = (data.store_wise || []).length - activeStores;
    document.getElementById("inventoryActiveStoresCount").textContent = inventoryNumber(activeStores);
    document.getElementById("inventoryInactiveStoresCount").textContent = inventoryNumber(inactiveStores);

    populateInventoryStoreFilter(data.stores || [], data.selected_store_id);
    displayStoreWiseInventory(data.store_wise || []);
    displayCategoryWiseInventory(data.category_wise || []);
    displayStoreCategoryBreakdown(data.store_category_breakdown || []);
    displayProductDetailInventory(data.products || []);
}

function displayStoreWiseInventory(stores) {
    const tbody = document.getElementById("storeInventoryBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    (stores || []).forEach((store) => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${store.store_name}</td>
            <td>${inventoryNumber(store.total_products)}</td>
            <td>${inventoryNumber(store.total_stock)}</td>
            <td>${inventoryMoney(store.total_inventory_value)}</td>
        `;
        tbody.appendChild(row);
    });
}

function displayCategoryWiseInventory(categories) {
    const tbody = document.getElementById("categoryInventoryBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    (categories || []).forEach((category) => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${category.category_name}</td>
            <td>${inventoryNumber(category.total_products)}</td>
            <td>${inventoryNumber(category.total_stock)}</td>
            <td>${inventoryMoney(category.total_inventory_value)}</td>
        `;
        tbody.appendChild(row);
    });
}

function displayStoreCategoryBreakdown(breakdown) {
    const tbody = document.getElementById("storeCategoryBreakdownBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    (breakdown || []).forEach((item) => {
        if ((item.product_count || 0) <= 0 && (item.stock_quantity || 0) <= 0) return;
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${item.store_name}</td>
            <td>${item.category_name || "-"}</td>
            <td>${inventoryNumber(item.product_count)}</td>
            <td>${inventoryNumber(item.stock_quantity)}</td>
            <td>${inventoryMoney(item.inventory_value)}</td>
        `;
        tbody.appendChild(row);
    });
}

function displayProductDetailInventory(products) {
    const tbody = document.getElementById("productDetailInventoryBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    (products || []).forEach((p) => {
        const statusBadge = p.is_available
            ? '<span class="status-active">Active</span>'
            : '<span class="status-inactive">Inactive</span>';
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${p.store_name}</td>
            <td>${p.category_name}</td>
            <td>${p.product_name}</td>
            <td>${p.variant_label || "-"}</td>
            <td>${inventoryNumber(p.stock_quantity)}</td>
            <td>${inventoryMoney(p.cost_price)}</td>
            <td>${inventoryMoney(p.sale_price)}</td>
            <td>${inventoryFinancialRule(p.financial_mode)}</td>
            <td>${inventoryMonetaryType(p.financial_type)}</td>
            <td>${inventoryMonetaryValue(p.financial_type, p.financial_value)}</td>
            <td>${statusBadge}</td>
        `;
        tbody.appendChild(row);
    });
}

const storeSaleTypeOrder = ["cash", "cash_discount", "credit", "credit_discount"];

function normalizeStoreSaleType(value) {
    const text = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (text.includes("credit") && text.includes("discount")) return "credit_discount";
    if (text.includes("credit")) return "credit";
    if (text.includes("discount")) return "cash_discount";
    return "cash";
}

function storeSaleTypeLabel(value) {
    const key = normalizeStoreSaleType(value);
    return {
        cash: "Cash",
        cash_discount: "Cash With Discount",
        credit: "Credit",
        credit_discount: "Credit With Discount",
    }[key] || "Cash";
}

function storeSaleTypeClass(value) {
    return `sale-type-${normalizeStoreSaleType(value).replace(/_/g, "-")}`;
}

function storeSaleTypeMetric(store, typeKey) {
    const orderField = `${typeKey}_orders`;
    const salesField = `${typeKey}_sales`;
    return {
        orders: Number(store[orderField] || 0) || 0,
        sales: Number(store[salesField] || 0) || 0,
    };
}

function renderStoreSaleTypeCell(store, typeKey) {
    const metric = storeSaleTypeMetric(store, typeKey);
    if (!metric.orders && !metric.sales) return "-";
    return `${inventoryNumber(metric.orders)} / ${inventoryMoney(metric.sales)}`;
}

function createStoreSaleTotals() {
    const totals = {
        totalOrders: 0,
        rawTotalOrders: 0,
        totalSales: 0,
        totalDiscount: 0,
        totalProfit: 0,
        delivery: 0,
        rawDelivery: 0,
        totalWithDelivery: 0,
        orderDeliveryMap: new Map(),
        uniqueCustomers: 0,
        rawUniqueCustomers: 0,
        orderIds: new Set(),
        customerKeys: new Set(),
        cash: { orders: 0, rawOrders: 0, sales: 0, orderIds: new Set() },
        cash_discount: { orders: 0, rawOrders: 0, sales: 0, orderIds: new Set() },
        credit: { orders: 0, rawOrders: 0, sales: 0, orderIds: new Set() },
        credit_discount: { orders: 0, rawOrders: 0, sales: 0, orderIds: new Set() },
    };
    return totals;
}

function addStoreSaleTotals(totals, store) {
    const rawOrders = Number(store.total_orders || 0) || 0;
    const rawCustomers = Number(store.unique_customers || 0) || 0;
    totals.rawTotalOrders += rawOrders;
    totals.rawUniqueCustomers += rawCustomers;
    totals.totalSales += Number(store.total_sales_net || 0) || 0;
    totals.totalDiscount += Number(store.total_discount || 0) || 0;
    totals.totalProfit += Number(store.estimated_profit || 0) || 0;

    const storeOrders = store.orders || [];
    const storeDelivery = typeof store.delivery_charges === "number"
        ? store.delivery_charges
        : (typeof store.delivery_fee === "number"
            ? store.delivery_fee
            : (storeOrders.length > 0
                ? storeOrders.reduce((sum, o) => sum + (Number(o.delivery_fee || 0) || 0), 0)
                : 0));
    totals.rawDelivery += storeDelivery;

    if (storeOrders.length > 0) {
        storeOrders.forEach((order) => {
            const orderId = order.order_id || order.order_number;
            if (orderId) {
                totals.orderIds.add(orderId);
                if (!totals.orderDeliveryMap.has(orderId)) {
                    totals.orderDeliveryMap.set(orderId, Number(order.delivery_fee || 0) || 0);
                }
            }
            const custKey = (order.customer_phone || order.customer_name || "").trim();
            if (custKey) totals.customerKeys.add(custKey);
        });
        totals.totalOrders = totals.orderIds.size;
        totals.uniqueCustomers = totals.customerKeys.size;
        let dedupedDelivery = 0;
        for (const fee of totals.orderDeliveryMap.values()) {
            dedupedDelivery += fee;
        }
        totals.delivery = dedupedDelivery;
    } else {
        totals.totalOrders = totals.orderIds.size > 0 ? totals.orderIds.size : totals.rawTotalOrders;
        totals.uniqueCustomers = totals.customerKeys.size > 0 ? totals.customerKeys.size : totals.rawUniqueCustomers;
        totals.delivery = totals.orderDeliveryMap.size > 0 ? totals.delivery : totals.rawDelivery;
    }
    totals.totalWithDelivery = totals.totalSales + totals.delivery;

    const storeType = normalizeStoreSaleType(store.store_payment_type || store.store_payment_term);
    storeSaleTypeOrder.forEach((key) => {
        const metric = storeSaleTypeMetric(store, key);
        totals[key].sales += metric.sales;
        totals[key].rawOrders += metric.orders;

        if (storeType === key && storeOrders.length > 0) {
            storeOrders.forEach((order) => {
                const orderId = order.order_id || order.order_number;
                if (orderId) totals[key].orderIds.add(orderId);
            });
            totals[key].orders = totals[key].orderIds.size;
        } else {
            totals[key].orders = totals[key].orderIds.size > 0 ? totals[key].orderIds.size : totals[key].rawOrders;
        }
    });
}

function renderStoreSaleTotalsRow(label, totals, className) {
    const average = totals.totalOrders > 0 ? totals.totalSales / totals.totalOrders : 0;
    const typeCells = storeSaleTypeOrder.map((key) => {
        const metric = totals[key];
        return `<td>${metric.orders || metric.sales ? `${inventoryNumber(metric.orders)} / ${inventoryMoney(metric.sales)}` : "-"}</td>`;
    }).join("");
    return `
        <tr class="${className}">
            <td>${inventoryEscapeHtml(label)}</td>
            <td>${inventoryNumber(totals.totalOrders)}</td>
            <td>${inventoryMoney(totals.totalSales)}</td>
            <td>${inventoryMoney(totals.totalDiscount)}</td>
            <td>${inventoryMoney(totals.totalProfit)}</td>
            <td>${inventoryMoney(totals.delivery)}</td>
            <td>${inventoryMoney(totals.totalWithDelivery)}</td>
            ${typeCells}
            <td>${inventoryMoney(average)}</td>
            <td>${inventoryNumber(totals.uniqueCustomers)}</td>
        </tr>
    `;
}

let currentStoreSalesSummary = null;

function displayStoreSalesReport(data) {
    const tbody = document.getElementById("storeSalesBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    currentStoreSalesRows = (data && data.store_sales) || [];
    if (data && data.summary) {
        currentStoreSalesSummary = data.summary;
    }
    if (
        expandedStoreSalesStoreId &&
        !currentStoreSalesRows.some((store) => Number(store.store_id) === Number(expandedStoreSalesStoreId))
    ) {
        expandedStoreSalesStoreId = null;
    }

    if (!currentStoreSalesRows.length) {
        const row = document.createElement("tr");
        row.innerHTML = `<td colspan="13" style="text-align:center;">No store sales found for the selected date range.</td>`;
        tbody.appendChild(row);
        return;
    }

    const groups = storeSaleTypeOrder.reduce((acc, key) => {
        acc[key] = [];
        return acc;
    }, {});
    currentStoreSalesRows.forEach((store) => {
        const key = normalizeStoreSaleType(store.store_payment_type || store.store_payment_term);
        groups[key].push(store);
    });

    const grandTotals = createStoreSaleTotals();
    storeSaleTypeOrder.forEach((typeKey) => {
        const stores = groups[typeKey] || [];
        if (!stores.length) return;

        const headingRow = document.createElement("tr");
        headingRow.className = `aginv-report-group-row ${storeSaleTypeClass(typeKey)}`;
        headingRow.innerHTML = `<td colspan="13">${storeSaleTypeLabel(typeKey)} Stores</td>`;
        tbody.appendChild(headingRow);

        const groupTotals = createStoreSaleTotals();
        stores.forEach((store) => {
            addStoreSaleTotals(groupTotals, store);
            addStoreSaleTotals(grandTotals, store);

            const storeOrders = store.orders || [];
            const storeDelivery = typeof store.delivery_charges === "number"
                ? store.delivery_charges
                : (typeof store.delivery_fee === "number"
                    ? store.delivery_fee
                    : (storeOrders.length > 0
                        ? storeOrders.reduce((sum, o) => sum + (Number(o.delivery_fee || 0) || 0), 0)
                        : 0));
            const storeTotalWithDelivery = typeof store.total_with_delivery === "number"
                ? store.total_with_delivery
                : (Number(store.total_sales_net || 0) + storeDelivery);

            const row = document.createElement("tr");
            const storeId = Number(store.store_id);
            const isExpanded = expandedStoreSalesStoreId === storeId;
            row.className = `store-sales-summary-row ${storeSaleTypeClass(store.store_payment_type || store.store_payment_term)}`;
            row.style.cursor = "pointer";
            row.title = "Click to show order details";
            row.innerHTML = `
                <td>
                    <span style="display:inline-flex; align-items:center; gap:0.4rem;">
                        <i class="fas ${isExpanded ? "fa-chevron-down" : "fa-chevron-right"}" aria-hidden="true"></i>
                        ${inventoryEscapeHtml(store.store_name)}
                    </span>
                </td>
                <td>${inventoryNumber(store.total_orders)}</td>
                <td>${inventoryMoney(store.total_sales_net)}</td>
                <td>${inventoryMoney(store.total_discount)}</td>
                <td>${inventoryMoney(store.estimated_profit)}</td>
                <td>${inventoryMoney(storeDelivery)}</td>
                <td>${inventoryMoney(storeTotalWithDelivery)}</td>
                <td>${renderStoreSaleTypeCell(store, "cash")}</td>
                <td>${renderStoreSaleTypeCell(store, "cash_discount")}</td>
                <td>${renderStoreSaleTypeCell(store, "credit")}</td>
                <td>${renderStoreSaleTypeCell(store, "credit_discount")}</td>
                <td>${inventoryMoney(store.average_order_value)}</td>
                <td>${inventoryNumber(store.unique_customers)}</td>
            `;
            row.addEventListener("click", () => {
                expandedStoreSalesStoreId = isExpanded ? null : storeId;
                displayStoreSalesReport({ store_sales: currentStoreSalesRows, summary: currentStoreSalesSummary });
            });
            tbody.appendChild(row);

            if (isExpanded) {
                const detailRow = document.createElement("tr");
                detailRow.className = "store-sales-detail-row";
                detailRow.innerHTML = `
                    <td colspan="13" style="background:#f8fafc; padding:0;">
                        ${renderStoreSalesOrdersDetail(store)}
                    </td>
                `;
                tbody.appendChild(detailRow);
            }
        });

        tbody.insertAdjacentHTML("beforeend", renderStoreSaleTotalsRow(`${storeSaleTypeLabel(typeKey)} Total`, groupTotals, "aginv-report-subtotal-row"));
    });

    if (currentStoreSalesSummary) {
        if (typeof currentStoreSalesSummary.total_orders === "number" && currentStoreSalesSummary.total_orders >= 0) {
            grandTotals.totalOrders = currentStoreSalesSummary.total_orders;
        }
        if (typeof currentStoreSalesSummary.unique_customers === "number" && currentStoreSalesSummary.unique_customers >= 0) {
            grandTotals.uniqueCustomers = currentStoreSalesSummary.unique_customers;
        }
        if (typeof currentStoreSalesSummary.total_delivery_charges === "number" && currentStoreSalesSummary.total_delivery_charges >= 0) {
            grandTotals.delivery = currentStoreSalesSummary.total_delivery_charges;
            grandTotals.totalWithDelivery = grandTotals.totalSales + grandTotals.delivery;
        }
    }

    tbody.insertAdjacentHTML("beforeend", renderStoreSaleTotalsRow("Grand Total", grandTotals, "aginv-report-grand-row"));
}

function renderStoreSalesOrdersDetail(store) {
    const orders = store.orders || [];
    if (!orders.length) {
        return `<div style="padding:1rem; color:#64748b;">No order details found for this store in the selected date range.</div>`;
    }

    const totals = orders.reduce((acc, order) => {
        const key = normalizeStoreSaleType(order.sale_type || order.store_payment_term);
        acc[key].orders += 1;
        acc[key].sales += Number(order.net_sales || 0) || 0;
        acc[key].discount += Number(order.total_discount || 0) || 0;
        acc[key].profit += Number(order.estimated_profit || 0) || 0;
        acc[key].delivery += Number(order.delivery_fee || 0) || 0;
        acc[key].total += Number(order.order_total || 0) || 0;
        return acc;
    }, {
        cash: { orders: 0, sales: 0, discount: 0, profit: 0, delivery: 0, total: 0 },
        cash_discount: { orders: 0, sales: 0, discount: 0, profit: 0, delivery: 0, total: 0 },
        credit: { orders: 0, sales: 0, discount: 0, profit: 0, delivery: 0, total: 0 },
        credit_discount: { orders: 0, sales: 0, discount: 0, profit: 0, delivery: 0, total: 0 },
    });

    const orderRows = orders.map((order) => `
        <tr>
            <td>${inventoryEscapeHtml(order.order_number || "-")}</td>
            <td>${inventoryDateTime(order.sold_at)}</td>
            <td>${storeSaleTypeLabel(order.sale_type || order.store_payment_term)}</td>
            <td>${inventoryTitleCase(order.order_status || "-")}</td>
            <td>${inventoryTitleCase(order.payment_method || "-")} / ${inventoryTitleCase(order.payment_status || "-")}</td>
            <td>${inventoryEscapeHtml(order.customer_name || "-")}${order.customer_phone ? `<br><small>${inventoryEscapeHtml(order.customer_phone)}</small>` : ""}</td>
            <td>${inventoryNumber(order.total_quantity)}</td>
            <td>${inventoryMoney(order.total_cost)}</td>
            <td>${inventoryMoney(order.gross_sales)}</td>
            <td>${inventoryMoney(order.total_discount)}</td>
            <td>${inventoryMoney(order.net_sales)}</td>
            <td>${inventoryMoney(order.estimated_profit)}</td>
            <td>${inventoryMoney(order.delivery_fee)}</td>
            <td>${inventoryMoney(order.order_total)}</td>
        </tr>
    `).join("");

    const totalDetailDelivery = Object.values(totals).reduce((sum, t) => sum + (t.delivery || 0), 0);

    return `
        <div style="padding:1rem;">
            <div style="display:flex; flex-wrap:wrap; gap:0.75rem; margin-bottom:0.75rem;">
                ${storeSaleTypeOrder.map((key) => `
                <div class="store-sale-detail-card ${storeSaleTypeClass(key)}">
                    <strong>${storeSaleTypeLabel(key)}:</strong> ${inventoryNumber(totals[key].orders)} orders, ${inventoryMoney(totals[key].sales)}
                </div>
                `).join("")}
                <div class="store-sale-detail-card" style="background:#f1f5f9; border-color:#cbd5e1; color:#1e293b;">
                    <strong>Total Delivery:</strong> ${inventoryMoney(totalDetailDelivery)}
                </div>
            </div>
            <div class="table-container store-sales-detail-scroll" style="margin:0; box-shadow:none; border:1px solid #e2e8f0;">
                <table>
                    <thead>
                        <tr>
                            <th>Order Number</th>
                            <th>Date/Time</th>
                            <th>Sale Type</th>
                            <th>Status</th>
                            <th>Payment</th>
                            <th>Customer</th>
                            <th>Qty</th>
                            <th>Cost</th>
                            <th>Gross Sale</th>
                            <th>Discount</th>
                            <th>Net Sale</th>
                            <th>Profit</th>
                            <th>Delivery Charges</th>
                            <th>Order Total</th>
                        </tr>
                    </thead>
                    <tbody>${orderRows}</tbody>
                </table>
            </div>
        </div>
    `;
}

function displayManualOrderSalesReport(data) {
    const tbody = document.getElementById("manualSalesBody");
    const footer = document.getElementById("manualSalesFooter");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (footer) footer.innerHTML = "";

    const rows = data.manual_product_sales || [];
    currentManualSalesRows = rows;
    if (!rows.length) {
        const row = document.createElement("tr");
        row.innerHTML = `<td colspan="14" style="text-align:center;">No manual-order product sales found for the selected scope.</td>`;
        tbody.appendChild(row);
        return;
    }

    rows.forEach((item) => {
        const row = document.createElement("tr");
        row.dataset.orderItemId = String(item.order_item_id || "");
        row.style.cursor = "pointer";
        row.title = "Double-click to edit sale price and cost price";
        row.innerHTML = `
            <td>${item.store_name}</td>
            <td>${item.category_name || "-"}</td>
            <td>${item.product_name}</td>
            <td>${item.order_number || item.order_numbers || "-"}</td>
            <td>${inventoryTitleCase(item.order_status || "-")}</td>
            <td>${inventoryMoney(item.cost_price ?? item.average_cost_price)}</td>
            <td>${inventoryMoney(item.sale_price ?? item.average_sale_price)}</td>
            <td>${inventoryNumber(item.total_quantity)}</td>
            <td>${inventoryMoney(item.total_cost)}</td>
            <td>${inventoryMoney(item.gross_sales)}</td>
            <td>${inventoryMoney(item.net_sales)}</td>
            <td>${inventoryMoney(item.estimated_profit)}</td>
            <td>${inventoryMoney(resolveManualDeliveryFee(item))}</td>
            <td>${inventoryMoney(item.order_total)}</td>
        `;
        row.addEventListener("dblclick", () => {
            openManualSalesEditModal(item.order_item_id);
        });
        tbody.appendChild(row);
    });

    if (footer) {
        const seenOrderIds = new Set();
        const totals = rows.reduce((acc, item) => {
            acc.costPrice += Number(item.cost_price ?? item.average_cost_price ?? 0) || 0;
            acc.salePrice += Number(item.sale_price ?? item.average_sale_price ?? 0) || 0;
            acc.qty += Number(item.total_quantity || 0) || 0;
            acc.totalCost += Number(item.total_cost || 0) || 0;
            acc.grossSales += Number(item.gross_sales || 0) || 0;
            acc.netSales += Number(item.net_sales || 0) || 0;
            acc.profit += Number(item.estimated_profit || 0) || 0;
            const orderKey = String(item.order_id || item.order_number || "");
            if (orderKey && !seenOrderIds.has(orderKey)) {
                seenOrderIds.add(orderKey);
                acc.orderTotal += Number(item.order_total || 0) || 0;
                acc.deliveryFee += resolveManualDeliveryFee(item);
            }
            return acc;
        }, {
            costPrice: 0,
            salePrice: 0,
            qty: 0,
            totalCost: 0,
            grossSales: 0,
            netSales: 0,
            profit: 0,
            deliveryFee: 0,
            orderTotal: 0,
        });

        footer.innerHTML = `
            <tr style="background:#f8fafc; font-weight:700; border-top:2px solid #cbd5e1;">
                <td colspan="5">Totals</td>
                <td>${inventoryMoney(totals.costPrice)}</td>
                <td>${inventoryMoney(totals.salePrice)}</td>
                <td>${inventoryNumber(totals.qty)}</td>
                <td>${inventoryMoney(totals.totalCost)}</td>
                <td>${inventoryMoney(totals.grossSales)}</td>
                <td>${inventoryMoney(totals.netSales)}</td>
                <td>${inventoryMoney(totals.profit)}</td>
                <td>${inventoryMoney(totals.deliveryFee)}</td>
                <td>${inventoryMoney(totals.orderTotal)}</td>
            </tr>
        `;
    }
}

function displayStoreProductSalesReport(data) {
    const tbody = document.getElementById("storeProductSalesBody");
    const footer = document.getElementById("storeProductSalesFooter");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (footer) footer.innerHTML = "";

    const rows = data.store_product_sales || [];
    currentStoreProductSalesRows = rows;
    if (!rows.length) {
        const row = document.createElement("tr");
        row.innerHTML = `<td colspan="14" style="text-align:center;">No store product sales found for the selected scope.</td>`;
        tbody.appendChild(row);
        return;
    }

    rows.forEach((item) => {
        const row = document.createElement("tr");
        row.dataset.orderItemId = String(item.order_item_id || "");
        row.style.cursor = "pointer";
        row.title = "Double-click to edit sale price and cost price";
        row.innerHTML = `
            <td>${item.store_name}</td>
            <td>${item.category_name || "-"}</td>
            <td>${item.product_name}</td>
            <td>${item.order_number || item.order_numbers || "-"}</td>
            <td>${inventoryTitleCase(item.order_status || "-")}</td>
            <td>${inventoryMoney(item.cost_price ?? item.average_cost_price)}</td>
            <td>${inventoryMoney(item.sale_price ?? item.average_sale_price)}</td>
            <td>${inventoryNumber(item.total_quantity)}</td>
            <td>${inventoryMoney(item.total_cost)}</td>
            <td>${inventoryMoney(item.gross_sales)}</td>
            <td>${inventoryMoney(item.net_sales)}</td>
            <td>${inventoryMoney(item.estimated_profit)}</td>
            <td>${inventoryMoney(item.delivery_fee ?? 0)}</td>
            <td>${inventoryMoney(item.order_total)}</td>
        `;
        row.addEventListener("dblclick", () => {
            openStoreProductSalesEditModal(item.order_item_id);
        });
        tbody.appendChild(row);
    });

    if (footer) {
        const seenOrderIds = new Set();
        const totals = rows.reduce((acc, item) => {
            acc.costPrice += Number(item.cost_price ?? item.average_cost_price ?? 0) || 0;
            acc.salePrice += Number(item.sale_price ?? item.average_sale_price ?? 0) || 0;
            acc.qty += Number(item.total_quantity || 0) || 0;
            acc.totalCost += Number(item.total_cost || 0) || 0;
            acc.grossSales += Number(item.gross_sales || 0) || 0;
            acc.netSales += Number(item.net_sales || 0) || 0;
            acc.profit += Number(item.estimated_profit || 0) || 0;
            const orderKey = String(item.order_id || item.order_number || "");
            if (orderKey && !seenOrderIds.has(orderKey)) {
                seenOrderIds.add(orderKey);
                acc.orderTotal += Number(item.order_total || 0) || 0;
                acc.deliveryFee += Number(item.delivery_fee || 0) || 0;
            }
            return acc;
        }, {
            costPrice: 0,
            salePrice: 0,
            qty: 0,
            totalCost: 0,
            grossSales: 0,
            netSales: 0,
            profit: 0,
            deliveryFee: 0,
            orderTotal: 0,
        });

        footer.innerHTML = `
            <tr style="background:#f8fafc; font-weight:700; border-top:2px solid #cbd5e1;">
                <td colspan="5">Totals</td>
                <td>${inventoryMoney(totals.costPrice)}</td>
                <td>${inventoryMoney(totals.salePrice)}</td>
                <td>${inventoryNumber(totals.qty)}</td>
                <td>${inventoryMoney(totals.totalCost)}</td>
                <td>${inventoryMoney(totals.grossSales)}</td>
                <td>${inventoryMoney(totals.netSales)}</td>
                <td>${inventoryMoney(totals.profit)}</td>
                <td>${inventoryMoney(totals.deliveryFee)}</td>
                <td>${inventoryMoney(totals.orderTotal)}</td>
            </tr>
        `;
    }
}

function displayCombinedProductSalesReport(data) {
    const tbody = document.getElementById("combinedProductSalesBody");
    const footer = document.getElementById("combinedProductSalesFooter");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (footer) footer.innerHTML = "";

    const rows = data.combined_product_sales || [];
    currentCombinedProductSalesRows = rows;
    if (!rows.length) {
        const row = document.createElement("tr");
        row.innerHTML = `<td colspan="15" style="text-align:center;">No product sales found for the selected scope.</td>`;
        tbody.appendChild(row);
        return;
    }

    rows.forEach((item) => {
        const row = document.createElement("tr");
        row.dataset.orderItemId = String(item.order_item_id || "");
        row.style.cursor = "pointer";
        row.title = "Double-click to edit sale price and cost price";
        row.innerHTML = `
            <td>${inventoryTitleCase(item.sale_type || "-")}</td>
            <td>${item.store_name}</td>
            <td>${item.category_name || "-"}</td>
            <td>${item.product_name}</td>
            <td>${item.order_number || item.order_numbers || "-"}</td>
            <td>${inventoryTitleCase(item.order_status || "-")}</td>
            <td>${inventoryMoney(item.cost_price ?? item.average_cost_price)}</td>
            <td>${inventoryMoney(item.sale_price ?? item.average_sale_price)}</td>
            <td>${inventoryNumber(item.total_quantity)}</td>
            <td>${inventoryMoney(item.total_cost)}</td>
            <td>${inventoryMoney(item.gross_sales)}</td>
            <td>${inventoryMoney(item.net_sales)}</td>
            <td>${inventoryMoney(item.estimated_profit)}</td>
            <td>${inventoryMoney(item.delivery_fee ?? 0)}</td>
            <td>${inventoryMoney(item.order_total)}</td>
        `;
        row.addEventListener("dblclick", () => {
            openCombinedProductSalesEditModal(item.order_item_id);
        });
        tbody.appendChild(row);
    });

    if (footer) {
        const seenOrderIds = new Set();
        const totals = rows.reduce((acc, item) => {
            acc.costPrice += Number(item.cost_price ?? item.average_cost_price ?? 0) || 0;
            acc.salePrice += Number(item.sale_price ?? item.average_sale_price ?? 0) || 0;
            acc.qty += Number(item.total_quantity || 0) || 0;
            acc.totalCost += Number(item.total_cost || 0) || 0;
            acc.grossSales += Number(item.gross_sales || 0) || 0;
            acc.netSales += Number(item.net_sales || 0) || 0;
            acc.profit += Number(item.estimated_profit || 0) || 0;
            const orderKey = String(item.order_id || item.order_number || "");
            if (orderKey && !seenOrderIds.has(orderKey)) {
                seenOrderIds.add(orderKey);
                acc.orderTotal += Number(item.order_total || 0) || 0;
                acc.deliveryFee += Number(item.delivery_fee || 0) || 0;
            }
            return acc;
        }, {
            costPrice: 0,
            salePrice: 0,
            qty: 0,
            totalCost: 0,
            grossSales: 0,
            netSales: 0,
            profit: 0,
            deliveryFee: 0,
            orderTotal: 0,
        });

        footer.innerHTML = `
            <tr style="background:#f8fafc; font-weight:700; border-top:2px solid #cbd5e1;">
                <td colspan="6">Totals</td>
                <td>${inventoryMoney(totals.costPrice)}</td>
                <td>${inventoryMoney(totals.salePrice)}</td>
                <td>${inventoryNumber(totals.qty)}</td>
                <td>${inventoryMoney(totals.totalCost)}</td>
                <td>${inventoryMoney(totals.grossSales)}</td>
                <td>${inventoryMoney(totals.netSales)}</td>
                <td>${inventoryMoney(totals.profit)}</td>
                <td>${inventoryMoney(totals.deliveryFee)}</td>
                <td>${inventoryMoney(totals.orderTotal)}</td>
            </tr>
        `;
    }
}

function displaySalesWithDeliveryReport(data) {
    const tbody = document.getElementById("salesWithDeliveryBody");
    const footer = document.getElementById("salesWithDeliveryFooter");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (footer) footer.innerHTML = "";

    const rows = data.sales_with_delivery || [];
    currentSalesWithDeliveryRows = rows;
    if (!rows.length) {
        const row = document.createElement("tr");
        row.innerHTML = `<td colspan="12" style="text-align:center;">No sales found for the selected scope.</td>`;
        tbody.appendChild(row);
        return;
    }

    rows.forEach((item) => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${inventoryTitleCase(item.sale_type || "-")}</td>
            <td>${item.store_names || item.store_name || "-"}</td>
            <td>${item.order_number || "-"}</td>
            <td>${inventoryTitleCase(item.order_status || "-")}</td>
            <td>${inventoryNumber(item.total_quantity)}</td>
            <td>${inventoryMoney(item.total_cost)}</td>
            <td>${inventoryMoney(item.gross_sales)}</td>
            <td>${inventoryMoney(item.net_sales)}</td>
            <td>${inventoryMoney(item.delivery_fee)}</td>
            <td>${inventoryMoney(item.total_with_delivery)}</td>
            <td>${inventoryMoney(item.estimated_profit)}</td>
            <td>${inventoryMoney(item.order_total)}</td>
        `;
        tbody.appendChild(row);
    });

    const totals = rows.reduce((acc, item) => {
        acc.qty += Number(item.total_quantity || 0) || 0;
        acc.totalCost += Number(item.total_cost || 0) || 0;
        acc.grossSales += Number(item.gross_sales || 0) || 0;
        acc.netSales += Number(item.net_sales || 0) || 0;
        acc.delivery += Number(item.delivery_fee || 0) || 0;
        acc.totalWithDelivery += Number(item.total_with_delivery || 0) || 0;
        acc.profit += Number(item.estimated_profit || 0) || 0;
        acc.orderTotal += Number(item.order_total || 0) || 0;
        return acc;
    }, {
        qty: 0,
        totalCost: 0,
        grossSales: 0,
        netSales: 0,
        delivery: 0,
        totalWithDelivery: 0,
        profit: 0,
        orderTotal: 0,
    });

    if (footer) {
        footer.innerHTML = `
            <tr style="background:#f8fafc; font-weight:700; border-top:2px solid #cbd5e1;">
                <td colspan="4">Totals</td>
                <td>${inventoryNumber(totals.qty)}</td>
                <td>${inventoryMoney(totals.totalCost)}</td>
                <td>${inventoryMoney(totals.grossSales)}</td>
                <td>${inventoryMoney(totals.netSales)}</td>
                <td>${inventoryMoney(totals.delivery)}</td>
                <td>${inventoryMoney(totals.totalWithDelivery)}</td>
                <td>${inventoryMoney(totals.profit)}</td>
                <td>${inventoryMoney(totals.orderTotal)}</td>
            </tr>
        `;
    }
}

function displaySalesByPaymentReport(data) {
    const tbody = document.getElementById("salesByPaymentBody");
    const footer = document.getElementById("salesByPaymentFooter");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (footer) footer.innerHTML = "";

    const rows = data.sales_by_payment || [];
    currentSalesByPaymentRows = rows;
    const columnCount = 10;
    if (!rows.length) {
        const row = document.createElement("tr");
        row.innerHTML = `<td colspan="${columnCount}" style="text-align:center;">No sales found for the selected scope.</td>`;
        tbody.appendChild(row);
        return;
    }

    const totalsByType = rows.reduce((acc, item) => {
        const typeKey = String(item.sale_type || item.payment_method || "other").toLowerCase();
        const storeKey = String(item.store_names || item.store_name || "-").trim() || "-";
        if (!acc[typeKey]) {
            acc[typeKey] = {
                totalCost: 0,
                netSales: 0,
                profit: 0,
                delivery: 0,
                totalWithDelivery: 0,
                orderTotal: 0,
                stores: {},
            };
        }
        const typeGroup = acc[typeKey];
        if (!typeGroup.stores[storeKey]) {
            typeGroup.stores[storeKey] = {
                totalCost: 0,
                netSales: 0,
                profit: 0,
                delivery: 0,
                totalWithDelivery: 0,
                orderTotal: 0,
                rows: [],
            };
        }
        const storeGroup = typeGroup.stores[storeKey];
        storeGroup.rows.push(item);
        storeGroup.totalCost += Number(item.total_cost || 0) || 0;
        storeGroup.netSales += Number(item.net_sales || 0) || 0;
        storeGroup.profit += Number(item.estimated_profit || 0) || 0;
        storeGroup.delivery += Number(item.delivery_fee || 0) || 0;
        storeGroup.totalWithDelivery += Number(item.total_with_delivery || 0) || 0;
        storeGroup.orderTotal += Number(item.order_total || 0) || 0;

        typeGroup.totalCost += Number(item.total_cost || 0) || 0;
        typeGroup.netSales += Number(item.net_sales || 0) || 0;
        typeGroup.profit += Number(item.estimated_profit || 0) || 0;
        typeGroup.delivery += Number(item.delivery_fee || 0) || 0;
        typeGroup.totalWithDelivery += Number(item.total_with_delivery || 0) || 0;
        typeGroup.orderTotal += Number(item.order_total || 0) || 0;
        return acc;
    }, {});

    const order = ["credit", "cash"].filter((k) => totalsByType[k]);
    const otherKeys = Object.keys(totalsByType).filter((k) => !order.includes(k));
    const groupedKeys = [...order, ...otherKeys];

    groupedKeys.forEach((key) => {
        const typeGroup = totalsByType[key];
        if (!typeGroup) return;
        const headingRow = document.createElement("tr");
        headingRow.className = "aginv-report-group-row";
        headingRow.innerHTML = `
            <td colspan="${columnCount}">${inventoryTitleCase(key)} Sale</td>
        `;
        tbody.appendChild(headingRow);

        const storeKeys = Object.keys(typeGroup.stores || {}).sort((a, b) => a.localeCompare(b));
        storeKeys.forEach((storeKey) => {
            const storeGroup = typeGroup.stores[storeKey];
            if (!storeGroup) return;
            const storeRow = document.createElement("tr");
            storeRow.className = "aginv-report-subgroup-row";
            storeRow.innerHTML = `
                <td colspan="${columnCount}">Store: ${storeKey}</td>
            `;
            tbody.appendChild(storeRow);

            storeGroup.rows.forEach((item) => {
                const row = document.createElement("tr");
                row.innerHTML = `
                    <td>${item.order_number || "-"}</td>
                    <td>${inventoryTitleCase(item.order_type || "-")}</td>
                    <td>${storeKey}</td>
                    <td>${inventoryTitleCase(item.store_payment_term || "-")}</td>
                    <td>${inventoryMoney(item.total_cost)}</td>
                    <td>${inventoryMoney(item.net_sales)}</td>
                    <td>${inventoryMoney(item.estimated_profit)}</td>
                    <td>${inventoryMoney(item.delivery_fee)}</td>
                    <td>${inventoryMoney(item.total_with_delivery)}</td>
                    <td>${inventoryMoney(item.order_total)}</td>
                `;
                tbody.appendChild(row);
            });

            const storeTotalsRow = document.createElement("tr");
            storeTotalsRow.className = "aginv-report-subtotal-row";
            storeTotalsRow.innerHTML = `
                <td>Store Totals</td>
                <td></td>
                <td></td>
                <td></td>
                <td>${inventoryMoney(storeGroup.totalCost)}</td>
                <td>${inventoryMoney(storeGroup.netSales)}</td>
                <td>${inventoryMoney(storeGroup.profit)}</td>
                <td>${inventoryMoney(storeGroup.delivery)}</td>
                <td>${inventoryMoney(storeGroup.totalWithDelivery)}</td>
                <td>${inventoryMoney(storeGroup.orderTotal)}</td>
            `;
            tbody.appendChild(storeTotalsRow);
        });

        const totalsRow = document.createElement("tr");
        totalsRow.className = "aginv-report-total-row";
        totalsRow.innerHTML = `
            <td>${inventoryTitleCase(key)} Totals</td>
            <td></td>
            <td></td>
            <td></td>
            <td>${inventoryMoney(typeGroup.totalCost)}</td>
            <td>${inventoryMoney(typeGroup.netSales)}</td>
            <td>${inventoryMoney(typeGroup.profit)}</td>
            <td>${inventoryMoney(typeGroup.delivery)}</td>
            <td>${inventoryMoney(typeGroup.totalWithDelivery)}</td>
            <td>${inventoryMoney(typeGroup.orderTotal)}</td>
        `;
        tbody.appendChild(totalsRow);
    });

    const grandTotals = Object.values(totalsByType).reduce((acc, t) => {
        acc.totalCost += t.totalCost;
        acc.netSales += t.netSales;
        acc.profit += t.profit;
        acc.delivery += t.delivery;
        acc.totalWithDelivery += t.totalWithDelivery;
        acc.orderTotal += t.orderTotal;
        return acc;
    }, {
        totalCost: 0,
        netSales: 0,
        profit: 0,
        delivery: 0,
        totalWithDelivery: 0,
        orderTotal: 0,
    });

    if (footer) {
        footer.innerHTML = `
            <tr class="aginv-report-grand-row">
                <td>Grand Totals</td>
                <td></td>
                <td></td>
                <td></td>
                <td>${inventoryMoney(grandTotals.totalCost)}</td>
                <td>${inventoryMoney(grandTotals.netSales)}</td>
                <td>${inventoryMoney(grandTotals.profit)}</td>
                <td>${inventoryMoney(grandTotals.delivery)}</td>
                <td>${inventoryMoney(grandTotals.totalWithDelivery)}</td>
                <td>${inventoryMoney(grandTotals.orderTotal)}</td>
            </tr>
        `;
    }
}

function displaySalesByPaymentSimpleReport(data) {
    const tbody = document.getElementById("salesByPaymentSimpleBody");
    const footer = document.getElementById("salesByPaymentSimpleFooter");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (footer) footer.innerHTML = "";

    const rows = data.sales_by_payment || [];
    currentSalesByPaymentRows = rows;
    const columnCount = 10;
    if (!rows.length) {
        const row = document.createElement("tr");
        row.innerHTML = `<td colspan="${columnCount}" style="text-align:center;">No sales found for the selected scope.</td>`;
        tbody.appendChild(row);
        return;
    }

    const totalsByType = rows.reduce((acc, item) => {
        const key = String(item.sale_type || item.payment_method || "other").toLowerCase();
        if (!acc[key]) {
            acc[key] = {
                totalCost: 0,
                netSales: 0,
                profit: 0,
                delivery: 0,
                totalWithDelivery: 0,
                orderTotal: 0,
                rows: [],
            };
        }
        acc[key].rows.push(item);
        acc[key].totalCost += Number(item.total_cost || 0) || 0;
        acc[key].netSales += Number(item.net_sales || 0) || 0;
        acc[key].profit += Number(item.estimated_profit || 0) || 0;
        acc[key].delivery += Number(item.delivery_fee || 0) || 0;
        acc[key].totalWithDelivery += Number(item.total_with_delivery || 0) || 0;
        acc[key].orderTotal += Number(item.order_total || 0) || 0;
        return acc;
    }, {});

    const order = ["credit", "cash"].filter((k) => totalsByType[k]);
    const otherKeys = Object.keys(totalsByType).filter((k) => !order.includes(k));
    const groupedKeys = [...order, ...otherKeys];

    groupedKeys.forEach((key) => {
        const group = totalsByType[key];
        if (!group) return;
        const headingRow = document.createElement("tr");
        headingRow.className = "aginv-report-group-row";
        headingRow.innerHTML = `
            <td colspan="${columnCount}">${inventoryTitleCase(key)} Sale</td>
        `;
        tbody.appendChild(headingRow);

        group.rows.forEach((item) => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${item.order_number || "-"}</td>
                <td>${inventoryTitleCase(item.order_type || "-")}</td>
                <td>${item.store_names || item.store_name || "-"}</td>
                <td>${inventoryTitleCase(item.store_payment_term || "-")}</td>
                <td>${inventoryMoney(item.total_cost)}</td>
                <td>${inventoryMoney(item.net_sales)}</td>
                <td>${inventoryMoney(item.estimated_profit)}</td>
                <td>${inventoryMoney(item.delivery_fee)}</td>
                <td>${inventoryMoney(item.total_with_delivery)}</td>
                <td>${inventoryMoney(item.order_total)}</td>
            `;
            tbody.appendChild(row);
        });

        const totalsRow = document.createElement("tr");
        totalsRow.className = "aginv-report-total-row";
        totalsRow.innerHTML = `
            <td>${inventoryTitleCase(key)} Totals</td>
            <td></td>
            <td></td>
            <td></td>
            <td>${inventoryMoney(group.totalCost)}</td>
            <td>${inventoryMoney(group.netSales)}</td>
            <td>${inventoryMoney(group.profit)}</td>
            <td>${inventoryMoney(group.delivery)}</td>
            <td>${inventoryMoney(group.totalWithDelivery)}</td>
            <td>${inventoryMoney(group.orderTotal)}</td>
        `;
        tbody.appendChild(totalsRow);
    });

    const grandTotals = Object.values(totalsByType).reduce((acc, t) => {
        acc.totalCost += t.totalCost;
        acc.netSales += t.netSales;
        acc.profit += t.profit;
        acc.delivery += t.delivery;
        acc.totalWithDelivery += t.totalWithDelivery;
        acc.orderTotal += t.orderTotal;
        return acc;
    }, {
        totalCost: 0,
        netSales: 0,
        profit: 0,
        delivery: 0,
        totalWithDelivery: 0,
        orderTotal: 0,
    });

    if (footer) {
        footer.innerHTML = `
            <tr class="aginv-report-grand-row">
                <td>Grand Totals</td>
                <td></td>
                <td></td>
                <td></td>
                <td>${inventoryMoney(grandTotals.totalCost)}</td>
                <td>${inventoryMoney(grandTotals.netSales)}</td>
                <td>${inventoryMoney(grandTotals.profit)}</td>
                <td>${inventoryMoney(grandTotals.delivery)}</td>
                <td>${inventoryMoney(grandTotals.totalWithDelivery)}</td>
                <td>${inventoryMoney(grandTotals.orderTotal)}</td>
            </tr>
        `;
    }
}

function displayCustomerDetailsReport(data) {
    const thead = document.getElementById("customerDetailsReportHead");
    const tbody = document.getElementById("customerDetailsReportBody");
    const footer = document.getElementById("customerDetailsReportFooter");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (footer) footer.innerHTML = "";

    const reportView = data.report_view || getSelectedCustomerDetailsReportMode();
    if (thead) {
        thead.innerHTML = reportView === "customer-summary"
            ? `
                <tr>
                  <th>Customer</th>
                  <th>Contact No</th>
                  <th>Address</th>
                  <th>Total Orders</th>
                  <th>Delivered</th>
                  <th>Cancelled</th>
                  <th>Active</th>
                  <th>Qty</th>
                  <th>Items Subtotal</th>
                  <th>Delivery Fee</th>
                  <th>Total Amount</th>
                  <th>Delivered Amount</th>
                  <th>Cancelled Amount</th>
                  <th>Active Amount</th>
                  <th>Last Order</th>
                </tr>
            `
            : reportView === "order-summary"
            ? `
                <tr>
                  <th>Order Date</th>
                  <th>Order Number</th>
                  <th>Customer</th>
                  <th>Contact No</th>
                  <th>Address</th>
                  <th>Stores</th>
                  <th>Products</th>
                  <th>Qty</th>
                  <th>Items Subtotal</th>
                  <th>Delivery Fee</th>
                  <th>Order Total</th>
                  <th>Status</th>
                </tr>
            `
            : `
                <tr>
                  <th>Order Date</th>
                  <th>Order Number</th>
                  <th>Store</th>
                  <th>Product</th>
                  <th>Customer</th>
                  <th>Contact No</th>
                  <th>Address</th>
                  <th>Qty</th>
                  <th>Sale Price</th>
                  <th>Line Total</th>
                  <th>Status</th>
                </tr>
            `;
    }

    if (reportView === "customer-summary") {
        const rows = data.customer_summary || [];
        currentCustomerSummaryRows = rows;
        currentCustomerOrderSummaryRows = [];
        currentCustomerDetailsRows = [];
        const columnCount = 15;
        if (!rows.length) {
            const row = document.createElement("tr");
            row.innerHTML = `<td colspan="${columnCount}" style="text-align:center;">No customer summary found for the selected scope.</td>`;
            tbody.appendChild(row);
            return;
        }

        rows.forEach((item) => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>
                    <strong>${inventoryEscapeHtml(item.customer_name || "-")}</strong>
                    ${item.customer_email ? `<br><small>${inventoryEscapeHtml(item.customer_email)}</small>` : ""}
                </td>
                <td>${inventoryEscapeHtml(item.contact_no || "-")}</td>
                <td>${inventoryEscapeHtml(item.customer_address || "-")}</td>
                <td>${inventoryNumber(item.total_orders)}</td>
                <td>${inventoryNumber(item.delivered_orders)}</td>
                <td>${inventoryNumber(item.cancelled_orders)}</td>
                <td>${inventoryNumber(item.active_orders)}</td>
                <td>${inventoryNumber(item.total_quantity)}</td>
                <td>${inventoryMoney(item.items_subtotal)}</td>
                <td>${inventoryMoney(item.delivery_fee)}</td>
                <td>${inventoryMoney(item.total_order_amount)}</td>
                <td>${inventoryMoney(item.delivered_amount)}</td>
                <td>${inventoryMoney(item.cancelled_amount)}</td>
                <td>${inventoryMoney(item.active_amount)}</td>
                <td>${inventoryDateTime(item.last_order_date)}</td>
            `;
            tbody.appendChild(row);
        });

        const totals = rows.reduce((acc, item) => {
            acc.totalOrders += Number(item.total_orders || 0) || 0;
            acc.deliveredOrders += Number(item.delivered_orders || 0) || 0;
            acc.cancelledOrders += Number(item.cancelled_orders || 0) || 0;
            acc.activeOrders += Number(item.active_orders || 0) || 0;
            acc.qty += Number(item.total_quantity || 0) || 0;
            acc.itemsSubtotal += Number(item.items_subtotal || 0) || 0;
            acc.deliveryFee += Number(item.delivery_fee || 0) || 0;
            acc.totalAmount += Number(item.total_order_amount || 0) || 0;
            acc.deliveredAmount += Number(item.delivered_amount || 0) || 0;
            acc.cancelledAmount += Number(item.cancelled_amount || 0) || 0;
            acc.activeAmount += Number(item.active_amount || 0) || 0;
            return acc;
        }, {
            totalOrders: 0,
            deliveredOrders: 0,
            cancelledOrders: 0,
            activeOrders: 0,
            qty: 0,
            itemsSubtotal: 0,
            deliveryFee: 0,
            totalAmount: 0,
            deliveredAmount: 0,
            cancelledAmount: 0,
            activeAmount: 0,
        });

        if (footer) {
            footer.innerHTML = `
                <tr class="aginv-report-grand-row">
                    <td>Totals</td>
                    <td></td>
                    <td>${inventoryNumber(rows.length)} customers</td>
                    <td>${inventoryNumber(totals.totalOrders)}</td>
                    <td>${inventoryNumber(totals.deliveredOrders)}</td>
                    <td>${inventoryNumber(totals.cancelledOrders)}</td>
                    <td>${inventoryNumber(totals.activeOrders)}</td>
                    <td>${inventoryNumber(totals.qty)}</td>
                    <td>${inventoryMoney(totals.itemsSubtotal)}</td>
                    <td>${inventoryMoney(totals.deliveryFee)}</td>
                    <td>${inventoryMoney(totals.totalAmount)}</td>
                    <td>${inventoryMoney(totals.deliveredAmount)}</td>
                    <td>${inventoryMoney(totals.cancelledAmount)}</td>
                    <td>${inventoryMoney(totals.activeAmount)}</td>
                    <td></td>
                </tr>
            `;
        }
        return;
    }

    if (reportView === "order-summary") {
        const rows = data.customer_order_summary || [];
        currentCustomerOrderSummaryRows = rows;
        currentCustomerSummaryRows = [];
        currentCustomerDetailsRows = [];
        const columnCount = 12;
        if (!rows.length) {
            const row = document.createElement("tr");
            row.innerHTML = `<td colspan="${columnCount}" style="text-align:center;">No customer orders found for the selected scope.</td>`;
            tbody.appendChild(row);
            return;
        }

        rows.forEach((item) => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${inventoryDateTime(item.order_date)}</td>
                <td>${inventoryEscapeHtml(item.order_number || "-")}</td>
                <td>
                    <strong>${inventoryEscapeHtml(item.customer_name || "-")}</strong>
                    ${item.customer_email ? `<br><small>${inventoryEscapeHtml(item.customer_email)}</small>` : ""}
                </td>
                <td>${inventoryEscapeHtml(item.contact_no || "-")}</td>
                <td>${inventoryEscapeHtml(item.customer_address || "-")}</td>
                <td>${inventoryEscapeHtml(item.store_names || "-")}</td>
                <td>${inventoryEscapeHtml(item.products_summary || "-")}</td>
                <td>${inventoryNumber(item.total_quantity)}</td>
                <td>${inventoryMoney(item.items_subtotal)}</td>
                <td>${inventoryMoney(item.delivery_fee)}</td>
                <td>${inventoryMoney(item.order_total)}</td>
                <td>${inventoryTitleCase(item.order_status || "-")}</td>
            `;
            tbody.appendChild(row);
        });

        const uniqueCustomers = new Set();
        const totals = rows.reduce((acc, item) => {
            acc.qty += Number(item.total_quantity || 0) || 0;
            acc.itemsSubtotal += Number(item.items_subtotal || 0) || 0;
            acc.deliveryFee += Number(item.delivery_fee || 0) || 0;
            acc.orderTotal += Number(item.order_total || 0) || 0;
            if (item.customer_id) uniqueCustomers.add(String(item.customer_id));
            return acc;
        }, { qty: 0, itemsSubtotal: 0, deliveryFee: 0, orderTotal: 0 });

        if (footer) {
            footer.innerHTML = `
                <tr class="aginv-report-grand-row">
                    <td colspan="2">Totals</td>
                    <td>${inventoryNumber(uniqueCustomers.size)} unique customers</td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td>${inventoryNumber(rows.length)} orders</td>
                    <td>${inventoryNumber(totals.qty)}</td>
                    <td>${inventoryMoney(totals.itemsSubtotal)}</td>
                    <td>${inventoryMoney(totals.deliveryFee)}</td>
                    <td>${inventoryMoney(totals.orderTotal)}</td>
                    <td></td>
                </tr>
            `;
        }
        return;
    }

    const rows = data.customer_details || [];
    currentCustomerDetailsRows = rows;
    currentCustomerOrderSummaryRows = [];
    currentCustomerSummaryRows = [];
    const columnCount = 11;
    if (!rows.length) {
        const row = document.createElement("tr");
        row.innerHTML = `<td colspan="${columnCount}" style="text-align:center;">No customer sales found for the selected scope.</td>`;
        tbody.appendChild(row);
        return;
    }

    rows.forEach((item) => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${inventoryDateTime(item.order_date)}</td>
            <td>${inventoryEscapeHtml(item.order_number || "-")}</td>
            <td>${inventoryEscapeHtml(item.store_name || "-")}</td>
            <td>${inventoryEscapeHtml(item.product_name || "-")}</td>
            <td>
                <strong>${inventoryEscapeHtml(item.customer_name || "-")}</strong>
                ${item.customer_email ? `<br><small>${inventoryEscapeHtml(item.customer_email)}</small>` : ""}
            </td>
            <td>${inventoryEscapeHtml(item.contact_no || "-")}</td>
            <td>${inventoryEscapeHtml(item.customer_address || "-")}</td>
            <td>${inventoryNumber(item.quantity)}</td>
            <td>${inventoryMoney(item.sale_price)}</td>
            <td>${inventoryMoney(item.line_total)}</td>
            <td>${inventoryTitleCase(item.order_status || "-")}</td>
        `;
        tbody.appendChild(row);
    });

    const uniqueCustomers = new Set();
    const totals = rows.reduce((acc, item) => {
        acc.qty += Number(item.quantity || 0) || 0;
        acc.sales += Number(item.line_total || 0) || 0;
        if (item.customer_id) uniqueCustomers.add(String(item.customer_id));
        return acc;
    }, { qty: 0, sales: 0 });

    if (footer) {
        footer.innerHTML = `
            <tr class="aginv-report-grand-row">
                <td colspan="4">Totals</td>
                <td>${inventoryNumber(uniqueCustomers.size)} unique customers</td>
                <td></td>
                <td></td>
                <td>${inventoryNumber(totals.qty)}</td>
                <td></td>
                <td>${inventoryMoney(totals.sales)}</td>
                <td></td>
            </tr>
        `;
    }
}

function fillSalesEditModal(row, options) {
    const setValue = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value ?? "";
    };
    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value ?? "";
    };

    setValue("manualSalesEditMode", options.mode || "manual");
    setValue("manualSalesEditOrderItemId", row.order_item_id);
    setValue("manualSalesEditOrderNumber", row.order_number || row.order_numbers || "");
    setValue("manualSalesEditStatus", inventoryTitleCase(row.order_status || ""));
    setValue("manualSalesEditStore", row.store_name || "");
    setValue("manualSalesEditProduct", row.product_name || "");
    setValue("manualSalesEditQty", row.total_quantity || 0);
    setValue("manualSalesEditSoldAt", inventoryDateTime(row.last_sold_at));
    setValue("manualSalesEditCostPrice", Number(row.cost_price ?? row.average_cost_price ?? 0).toFixed(2));
    setValue("manualSalesEditSalePrice", Number(row.sale_price ?? row.average_sale_price ?? 0).toFixed(2));
    setText("manualSalesEditModalTitle", options.title || "Edit Pricing");
    setText(
        "manualSalesEditHelpText",
        options.helpText || "Saving updates only this order line and recalculates the order total."
    );
}

function openManualSalesEditModal(orderItemId) {
    const row = currentManualSalesRows.find((item) => Number(item.order_item_id) === Number(orderItemId));
    if (!row) {
        showError("Manual Order Product Sales Report", "Could not find the selected order line.");
        return;
    }

    fillSalesEditModal(row, {
        mode: "manual",
        title: "Edit Manual Order Pricing",
        helpText: "Saving updates only this manual-order line and recalculates the order total.",
    });
    openInventoryModal("manualSalesEditModal");
}

function openStoreProductSalesEditModal(orderItemId) {
    const row = currentStoreProductSalesRows.find((item) => Number(item.order_item_id) === Number(orderItemId));
    if (!row) {
        showError("Store Product Sales Report", "Could not find the selected order line.");
        return;
    }

    fillSalesEditModal(row, {
        mode: "store",
        title: "Edit Store Sale Pricing",
        helpText: "Saving updates only this store-sale line and recalculates the order total.",
    });
    openInventoryModal("manualSalesEditModal");
}

function openCombinedProductSalesEditModal(orderItemId) {
    const row = currentCombinedProductSalesRows.find((item) => Number(item.order_item_id) === Number(orderItemId));
    if (!row) {
        showError("Combined Product Sales Report", "Could not find the selected order line.");
        return;
    }

    const isManual = String(row.sale_type || "").trim().toLowerCase() === "manual";
    fillSalesEditModal(row, {
        mode: isManual ? "manual" : "store",
        title: isManual ? "Edit Manual Order Pricing" : "Edit Store Sale Pricing",
        helpText: isManual
            ? "Saving updates only this manual-order line and recalculates the order total."
            : "Saving updates only this store-sale line and recalculates the order total.",
    });
    openInventoryModal("manualSalesEditModal");
}

async function saveManualSalesEdit() {
    const apiBase = window.API_BASE || `${window.location.protocol}//${window.location.host}`;
    const token = localStorage.getItem("serveNowToken");
    const mode = String(document.getElementById("manualSalesEditMode")?.value || "manual").trim().toLowerCase();
    const orderItemId = Number(document.getElementById("manualSalesEditOrderItemId")?.value || 0);
    const costPrice = Number(document.getElementById("manualSalesEditCostPrice")?.value || 0);
    const salePrice = Number(document.getElementById("manualSalesEditSalePrice")?.value || 0);
    const reportTitle = mode === "store" ? "Store Product Sales Report" : "Manual Order Product Sales Report";
    const endpoint = mode === "store"
        ? `${apiBase}/api/admin/store-product-sales-report/${orderItemId}`
        : `${apiBase}/api/admin/manual-order-sales-report/${orderItemId}`;

    if (!Number.isInteger(orderItemId) || orderItemId <= 0) {
        showError(reportTitle, "Invalid order line selected.");
        return;
    }
    if (!Number.isFinite(costPrice) || costPrice < 0) {
        showWarning(reportTitle, "Cost price must be a non-negative number.");
        return;
    }
    if (!Number.isFinite(salePrice) || salePrice <= 0) {
        showWarning(reportTitle, "Sale price must be greater than zero.");
        return;
    }

    try {
        const response = await fetch(endpoint, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                cost_price: costPrice,
                sale_price: salePrice,
            }),
        });
        const data = await response.json();

        if (!data.success) {
            showError(reportTitle, data.message || "Failed to update pricing.");
            return;
        }

        closeInventoryModal("manualSalesEditModal");
        showSuccess(reportTitle, data.message || "Pricing updated successfully.");
        loadSelectedInventoryReport();
    } catch (err) {
        console.error("Error updating sales pricing:", err);
        showError(reportTitle, "Failed to update pricing.");
    }
}

function switchInventoryReport(reportType) {
    const sections = [
        "storeReportSection",
        "categoryReportSection",
        "breakdownReportSection",
        "salesReportSection",
        "manualSalesReportSection",
        "storeProductSalesReportSection",
        "combinedProductSalesReportSection",
        "salesWithDeliveryReportSection",
        "salesByPaymentReportSection",
        "salesByPaymentSimpleReportSection",
        "customerDetailsReportSection",
        "productDetailReportSection",
    ];
    sections.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
    });

    const customerFilterGroup = document.getElementById("inventoryCustomerFilterGroup");
    if (customerFilterGroup) {
        customerFilterGroup.style.display = reportType === "customer-details" ? "" : "none";
    }
    const customerReportModeGroup = document.getElementById("inventoryCustomerReportModeGroup");
    if (customerReportModeGroup) {
        customerReportModeGroup.style.display = reportType === "customer-details" ? "" : "none";
    }

    switch (reportType) {
        case "store":
            document.getElementById("storeReportSection").style.display = "block";
            break;
        case "category":
            document.getElementById("categoryReportSection").style.display = "block";
            break;
        case "breakdown":
            document.getElementById("breakdownReportSection").style.display = "block";
            break;
        case "sales":
            document.getElementById("salesReportSection").style.display = "block";
            loadStoreSalesReport();
            break;
        case "manual-sales":
            document.getElementById("manualSalesReportSection").style.display = "block";
            loadManualOrderSalesReport();
            break;
        case "store-product-sales":
            document.getElementById("storeProductSalesReportSection").style.display = "block";
            loadStoreProductSalesReport();
            break;
        case "combined-product-sales":
            document.getElementById("combinedProductSalesReportSection").style.display = "block";
            loadCombinedProductSalesReport();
            break;
        case "sales-with-delivery":
            document.getElementById("salesWithDeliveryReportSection").style.display = "block";
            loadSalesWithDeliveryReport();
            break;
        case "sales-by-payment":
            document.getElementById("salesByPaymentReportSection").style.display = "block";
            loadSalesByPaymentReport();
            break;
        case "sales-by-payment-simple":
            document.getElementById("salesByPaymentSimpleReportSection").style.display = "block";
            loadSalesByPaymentSimpleReport();
            break;
        case "customer-details":
            document.getElementById("customerDetailsReportSection").style.display = "block";
            loadCustomerDetailsCustomerFilter().finally(() => loadCustomerDetailsReport());
            break;
        case "product-detail":
            document.getElementById("productDetailReportSection").style.display = "block";
            break;
        default:
            document.getElementById("storeReportSection").style.display = "block";
            break;
    }
}

function loadSelectedInventoryReport() {
    const activeType = (document.getElementById("inventoryReportSelect") || {}).value || "store";
    switchInventoryReport(activeType);
}

function exportInventoryReportPdf() {
    if (!window.jspdf || !window.jspdf.jsPDF) {
        showError("Inventory Report", "PDF library not loaded");
        return;
    }
    if (!currentInventoryData && currentInventoryReportScope !== "sales") {
        showWarning("Inventory Report", "Load inventory report first");
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF("l", "mm", "a4");
    const now = new Date();
    const activeType = (document.getElementById("inventoryReportSelect") || {}).value || "store";
    const reportNameMap = {
        store: "Inventory Report",
        category: "Category-wise Inventory Report",
        breakdown: "Store-wise Category Breakdown Report",
        "product-detail": "Product Cost/Sale Detail Report",
        sales: "Store Sale-wise Report",
        "manual-sales": "Manual Order Product Sales Report",
        "store-product-sales": "Store Product Sales Report",
        "combined-product-sales": "Combined Product Sales Report",
        "sales-with-delivery": "Sales With Delivery Charges Report",
        "sales-by-payment": "Cash/Credit Sales With Delivery Report",
        "sales-by-payment-simple": "Cash/Credit Sales With Delivery Report (By Type)",
        "customer-details": "Customer Details by Store/Product Report",
    };
    const reportName = reportNameMap[activeType] || "Inventory Report";
    const selectedStoreId = getSelectedInventoryStoreId();
    const selectedStoreName = selectedStoreId
        ? ((currentInventoryData?.stores || []).find((s) => Number(s.id) === Number(selectedStoreId)) || {}).name || `Store #${selectedStoreId}`
        : "All Stores";
    const selectedCustomerName = activeType === "customer-details" ? getSelectedInventoryCustomerName() : "";
    const selectedCustomerReportMode = activeType === "customer-details"
        ? ({
            "order-summary": "Customer Order Summary",
            "customer-summary": "Selected Customer Period Summary",
            detail: "Product Detail",
        }[getSelectedCustomerDetailsReportMode()] || "Product Detail")
        : "";
    const { startDate, endDate } = getSelectedInventoryDateRange();

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("ServeNow", 14, 14);
    doc.setFontSize(14);
    doc.text(reportName, 14, 22);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Store Scope: ${selectedStoreName}`, 14, 28);
    doc.text(`Generated: ${now.toLocaleString()}`, 14, 33);
    doc.text(`Date Range: ${startDate || "-"} to ${endDate || "-"}`, 14, 38);
    if (selectedCustomerName) {
        doc.text(`Customer Scope: ${selectedCustomerName}`, 14, 43);
    }
    if (selectedCustomerReportMode) {
        doc.text(`Report View: ${selectedCustomerReportMode}`, 14, selectedCustomerName ? 48 : 43);
    }

    let startY = selectedCustomerReportMode ? (selectedCustomerName ? 56 : 51) : (selectedCustomerName ? 51 : 46);
    if (currentInventoryReportScope !== "sales") {
        const summary = currentInventoryData.summary || {};
        doc.setFont("helvetica", "bold");
        doc.text("Summary", 14, startY);
        doc.setFont("helvetica", "normal");
        doc.text(
            `Stores: ${inventoryNumber(summary.total_stores)} | Categories: ${inventoryNumber(summary.total_categories)} | Products: ${inventoryNumber(summary.total_products)} | Stock: ${inventoryNumber(summary.total_stock)} | Inventory Value: ${inventoryMoney(summary.total_inventory_value)}`,
            14,
            startY + 6
        );
        startY += 12;
    }

    let tableHead = [];
    let tableBody = [];

    if (activeType === "category") {
        tableHead = [["Category", "Products", "Stock", "Inventory Value"]];
        tableBody = (currentInventoryData.category_wise || []).map((r) => [
            r.category_name,
            inventoryNumber(r.total_products),
            inventoryNumber(r.total_stock),
            inventoryMoney(r.total_inventory_value),
        ]);
    } else if (activeType === "breakdown") {
        tableHead = [["Store", "Category", "Products", "Stock", "Value"]];
        tableBody = (currentInventoryData.store_category_breakdown || [])
            .filter((r) => (r.product_count || 0) > 0 || (r.stock_quantity || 0) > 0)
            .map((r) => [
                r.store_name,
                r.category_name || "-",
                inventoryNumber(r.product_count),
                inventoryNumber(r.stock_quantity),
                inventoryMoney(r.inventory_value),
            ]);
    } else if (activeType === "product-detail") {
        tableHead = [["Store", "Category", "Product", "Variant", "Stock", "Cost", "Sale", "Rule", "Type", "Value", "Status"]];
        tableBody = (currentInventoryData.products || []).map((r) => [
            r.store_name,
            r.category_name,
            r.product_name,
            r.variant_label || "-",
            inventoryNumber(r.stock_quantity),
            inventoryMoney(r.cost_price),
            inventoryMoney(r.sale_price),
            inventoryFinancialRule(r.financial_mode),
            inventoryMonetaryType(r.financial_type),
            inventoryMonetaryValue(r.financial_type, r.financial_value),
            r.is_available ? "Active" : "Inactive",
        ]);
    } else if (activeType === "sales") {
        tableHead = [["Store", "Orders", "Net Sales", "Discount", "Profit", "Delivery Charges", "Total With Delivery", "Cash", "Cash Discount", "Credit", "Credit Discount", "Avg Order", "Customers"]];
        const rows = currentStoreSalesRows || [];
        const groups = storeSaleTypeOrder.reduce((acc, key) => {
            acc[key] = [];
            return acc;
        }, {});
        rows.forEach((r) => {
            groups[normalizeStoreSaleType(r.store_payment_type || r.store_payment_term)].push(r);
        });
        const grandTotals = createStoreSaleTotals();
        const totalArray = (label, totals) => {
            const avg = totals.totalOrders > 0 ? totals.totalSales / totals.totalOrders : 0;
            return [
                label,
                inventoryNumber(totals.totalOrders),
                inventoryMoney(totals.totalSales),
                inventoryMoney(totals.totalDiscount),
                inventoryMoney(totals.totalProfit),
                inventoryMoney(totals.delivery),
                inventoryMoney(totals.totalWithDelivery),
                `${inventoryNumber(totals.cash.orders)} / ${inventoryMoney(totals.cash.sales)}`,
                `${inventoryNumber(totals.cash_discount.orders)} / ${inventoryMoney(totals.cash_discount.sales)}`,
                `${inventoryNumber(totals.credit.orders)} / ${inventoryMoney(totals.credit.sales)}`,
                `${inventoryNumber(totals.credit_discount.orders)} / ${inventoryMoney(totals.credit_discount.sales)}`,
                inventoryMoney(avg),
                inventoryNumber(totals.uniqueCustomers),
            ];
        };
        storeSaleTypeOrder.forEach((typeKey) => {
            const groupRows = groups[typeKey] || [];
            if (!groupRows.length) return;
            tableBody.push([`${storeSaleTypeLabel(typeKey)} Stores`, "", "", "", "", "", "", "", "", "", "", "", ""]);
            const groupTotals = createStoreSaleTotals();
            groupRows.forEach((r) => {
                addStoreSaleTotals(groupTotals, r);
                addStoreSaleTotals(grandTotals, r);
                const storeOrders = r.orders || [];
                const delivery = typeof r.delivery_charges === "number"
                    ? r.delivery_charges
                    : (typeof r.delivery_fee === "number"
                        ? r.delivery_fee
                        : storeOrders.reduce((sum, o) => sum + (Number(o.delivery_fee || 0) || 0), 0));
                const totalWithDelivery = typeof r.total_with_delivery === "number"
                    ? r.total_with_delivery
                    : (Number(r.total_sales_net || 0) + delivery);
                tableBody.push([
                    r.store_name,
                    inventoryNumber(r.total_orders),
                    inventoryMoney(r.total_sales_net),
                    inventoryMoney(r.total_discount),
                    inventoryMoney(r.estimated_profit),
                    inventoryMoney(delivery),
                    inventoryMoney(totalWithDelivery),
                    renderStoreSaleTypeCell(r, "cash"),
                    renderStoreSaleTypeCell(r, "cash_discount"),
                    renderStoreSaleTypeCell(r, "credit"),
                    renderStoreSaleTypeCell(r, "credit_discount"),
                    inventoryMoney(r.average_order_value),
                    inventoryNumber(r.unique_customers),
                ]);
            });
            tableBody.push(totalArray(`${storeSaleTypeLabel(typeKey)} Total`, groupTotals));
        });
        if (currentStoreSalesSummary) {
            if (typeof currentStoreSalesSummary.total_orders === "number" && currentStoreSalesSummary.total_orders >= 0) {
                grandTotals.totalOrders = currentStoreSalesSummary.total_orders;
            }
            if (typeof currentStoreSalesSummary.unique_customers === "number" && currentStoreSalesSummary.unique_customers >= 0) {
                grandTotals.uniqueCustomers = currentStoreSalesSummary.unique_customers;
            }
            if (typeof currentStoreSalesSummary.total_delivery_charges === "number" && currentStoreSalesSummary.total_delivery_charges >= 0) {
                grandTotals.delivery = currentStoreSalesSummary.total_delivery_charges;
                grandTotals.totalWithDelivery = grandTotals.totalSales + grandTotals.delivery;
            }
        }
        tableBody.push(totalArray("Grand Total", grandTotals));
    } else if (activeType === "manual-sales") {
        tableHead = [["Store", "Category", "Product", "Order Number", "Status", "Cost Price", "Sale Price", "Qty Sold", "Cost x Qty", "Gross Sales", "Net Sales", "Profit", "Delivery Fee", "Order Total"]];
        const rows = currentManualSalesRows || [];
        tableBody = rows.map((r) => [
            r.store_name,
            r.category_name || "-",
            r.product_name,
            r.order_number || r.order_numbers || "-",
            inventoryTitleCase(r.order_status || "-"),
            inventoryMoney(r.cost_price ?? r.average_cost_price),
            inventoryMoney(r.sale_price ?? r.average_sale_price),
            inventoryNumber(r.total_quantity),
            inventoryMoney(r.total_cost),
            inventoryMoney(r.gross_sales),
            inventoryMoney(r.net_sales),
            inventoryMoney(r.estimated_profit),
            inventoryMoney(r.delivery_fee ?? 0),
            inventoryMoney(r.order_total),
        ]);
        const totals = rows.reduce((acc, r) => {
            acc.costPrice += Number(r.cost_price ?? r.average_cost_price ?? 0) || 0;
            acc.salePrice += Number(r.sale_price ?? r.average_sale_price ?? 0) || 0;
            acc.qty += Number(r.total_quantity || 0) || 0;
            acc.totalCost += Number(r.total_cost || 0) || 0;
            acc.grossSales += Number(r.gross_sales || 0) || 0;
            acc.netSales += Number(r.net_sales || 0) || 0;
            acc.profit += Number(r.estimated_profit || 0) || 0;
            return acc;
        }, { costPrice: 0, salePrice: 0, qty: 0, totalCost: 0, grossSales: 0, netSales: 0, profit: 0 });
        tableBody.push([
            "Totals",
            "",
            "",
            "",
            "",
            inventoryMoney(totals.costPrice),
            inventoryMoney(totals.salePrice),
            inventoryNumber(totals.qty),
            inventoryMoney(totals.totalCost),
            inventoryMoney(totals.grossSales),
            inventoryMoney(totals.netSales),
            inventoryMoney(totals.profit),
            inventoryMoney(calculateUniqueDeliveryFee(rows, resolveManualDeliveryFee)),
            inventoryMoney(calculateUniqueOrderTotal(rows)),
        ]);
    } else if (activeType === "store-product-sales") {
        tableHead = [["Store", "Category", "Product", "Order Number", "Status", "Cost Price", "Sale Price", "Qty Sold", "Cost x Qty", "Gross Sales", "Net Sales", "Profit", "Delivery Fee", "Order Total"]];
        const rows = currentStoreProductSalesRows || [];
        tableBody = rows.map((r) => [
            r.store_name,
            r.category_name || "-",
            r.product_name,
            r.order_number || r.order_numbers || "-",
            inventoryTitleCase(r.order_status || "-"),
            inventoryMoney(r.cost_price ?? r.average_cost_price),
            inventoryMoney(r.sale_price ?? r.average_sale_price),
            inventoryNumber(r.total_quantity),
            inventoryMoney(r.total_cost),
            inventoryMoney(r.gross_sales),
            inventoryMoney(r.net_sales),
            inventoryMoney(r.estimated_profit),
            inventoryMoney(r.delivery_fee ?? 0),
            inventoryMoney(r.order_total),
        ]);
        const totals = rows.reduce((acc, r) => {
            acc.costPrice += Number(r.cost_price ?? r.average_cost_price ?? 0) || 0;
            acc.salePrice += Number(r.sale_price ?? r.average_sale_price ?? 0) || 0;
            acc.qty += Number(r.total_quantity || 0) || 0;
            acc.totalCost += Number(r.total_cost || 0) || 0;
            acc.grossSales += Number(r.gross_sales || 0) || 0;
            acc.netSales += Number(r.net_sales || 0) || 0;
            acc.profit += Number(r.estimated_profit || 0) || 0;
            return acc;
        }, { costPrice: 0, salePrice: 0, qty: 0, totalCost: 0, grossSales: 0, netSales: 0, profit: 0 });
        tableBody.push([
            "Totals",
            "",
            "",
            "",
            "",
            inventoryMoney(totals.costPrice),
            inventoryMoney(totals.salePrice),
            inventoryNumber(totals.qty),
            inventoryMoney(totals.totalCost),
            inventoryMoney(totals.grossSales),
            inventoryMoney(totals.netSales),
            inventoryMoney(totals.profit),
            inventoryMoney(calculateUniqueDeliveryFee(rows)),
            inventoryMoney(calculateUniqueOrderTotal(rows)),
        ]);
    } else if (activeType === "combined-product-sales") {
        tableHead = [["Sale Type", "Store", "Category", "Product", "Order Number", "Status", "Cost Price", "Sale Price", "Qty Sold", "Cost x Qty", "Gross Sales", "Net Sales", "Profit", "Delivery Fee", "Order Total"]];
        const rows = currentCombinedProductSalesRows || [];
        tableBody = rows.map((r) => [
            inventoryTitleCase(r.sale_type || "-"),
            r.store_name,
            r.category_name || "-",
            r.product_name,
            r.order_number || r.order_numbers || "-",
            inventoryTitleCase(r.order_status || "-"),
            inventoryMoney(r.cost_price ?? r.average_cost_price),
            inventoryMoney(r.sale_price ?? r.average_sale_price),
            inventoryNumber(r.total_quantity),
            inventoryMoney(r.total_cost),
            inventoryMoney(r.gross_sales),
            inventoryMoney(r.net_sales),
            inventoryMoney(r.estimated_profit),
            inventoryMoney(r.delivery_fee ?? 0),
            inventoryMoney(r.order_total),
        ]);
        const totals = rows.reduce((acc, r) => {
            acc.costPrice += Number(r.cost_price ?? r.average_cost_price ?? 0) || 0;
            acc.salePrice += Number(r.sale_price ?? r.average_sale_price ?? 0) || 0;
            acc.qty += Number(r.total_quantity || 0) || 0;
            acc.totalCost += Number(r.total_cost || 0) || 0;
            acc.grossSales += Number(r.gross_sales || 0) || 0;
            acc.netSales += Number(r.net_sales || 0) || 0;
            acc.profit += Number(r.estimated_profit || 0) || 0;
            return acc;
        }, { costPrice: 0, salePrice: 0, qty: 0, totalCost: 0, grossSales: 0, netSales: 0, profit: 0 });
        tableBody.push([
            "Totals",
            "",
            "",
            "",
            "",
            "",
            inventoryMoney(totals.costPrice),
            inventoryMoney(totals.salePrice),
            inventoryNumber(totals.qty),
            inventoryMoney(totals.totalCost),
            inventoryMoney(totals.grossSales),
            inventoryMoney(totals.netSales),
            inventoryMoney(totals.profit),
            inventoryMoney(calculateUniqueDeliveryFee(rows)),
            inventoryMoney(calculateUniqueOrderTotal(rows)),
        ]);
    } else if (activeType === "sales-with-delivery") {
        tableHead = [["Sale Type", "Store", "Order Number", "Status", "Qty Sold", "Cost x Qty", "Gross Sales", "Net Sales", "Delivery Charges", "Total With Delivery", "Profit", "Order Total"]];
        const rows = currentSalesWithDeliveryRows || [];
        tableBody = rows.map((r) => [
            inventoryTitleCase(r.sale_type || "-"),
            r.store_names || r.store_name || "-",
            r.order_number || "-",
            inventoryTitleCase(r.order_status || "-"),
            inventoryNumber(r.total_quantity),
            inventoryMoney(r.total_cost),
            inventoryMoney(r.gross_sales),
            inventoryMoney(r.net_sales),
            inventoryMoney(r.delivery_fee),
            inventoryMoney(r.total_with_delivery),
            inventoryMoney(r.estimated_profit),
            inventoryMoney(r.order_total),
        ]);
        const totals = rows.reduce((acc, r) => {
            acc.qty += Number(r.total_quantity || 0) || 0;
            acc.totalCost += Number(r.total_cost || 0) || 0;
            acc.grossSales += Number(r.gross_sales || 0) || 0;
            acc.netSales += Number(r.net_sales || 0) || 0;
            acc.delivery += Number(r.delivery_fee || 0) || 0;
            acc.totalWithDelivery += Number(r.total_with_delivery || 0) || 0;
            acc.profit += Number(r.estimated_profit || 0) || 0;
            acc.orderTotal += Number(r.order_total || 0) || 0;
            return acc;
        }, { qty: 0, totalCost: 0, grossSales: 0, netSales: 0, delivery: 0, totalWithDelivery: 0, profit: 0, orderTotal: 0 });
        tableBody.push([
            "Totals",
            "",
            "",
            "",
            inventoryNumber(totals.qty),
            inventoryMoney(totals.totalCost),
            inventoryMoney(totals.grossSales),
            inventoryMoney(totals.netSales),
            inventoryMoney(totals.delivery),
            inventoryMoney(totals.totalWithDelivery),
            inventoryMoney(totals.profit),
            inventoryMoney(totals.orderTotal),
        ]);
    } else if (activeType === "sales-by-payment-simple") {
        tableHead = [["Order Number", "Order Type", "Store", "Store Payment Term", "Cost Price", "Sale Price", "Profit", "Delivery Charges", "Total With Delivery", "Order Total"]];
        const rows = currentSalesByPaymentRows || [];
        tableBody = [];
        const totalsByType = rows.reduce((acc, r) => {
            const key = String(r.sale_type || r.payment_method || "other").toLowerCase();
            if (!acc[key]) {
                acc[key] = {
                    totalCost: 0,
                    netSales: 0,
                    profit: 0,
                    delivery: 0,
                    totalWithDelivery: 0,
                    orderTotal: 0,
                    rows: [],
                };
            }
            acc[key].rows.push(r);
            acc[key].totalCost += Number(r.total_cost || 0) || 0;
            acc[key].netSales += Number(r.net_sales || 0) || 0;
            acc[key].profit += Number(r.estimated_profit || 0) || 0;
            acc[key].delivery += Number(r.delivery_fee || 0) || 0;
            acc[key].totalWithDelivery += Number(r.total_with_delivery || 0) || 0;
            acc[key].orderTotal += Number(r.order_total || 0) || 0;
            return acc;
        }, {});
        const grandTotals = Object.values(totalsByType).reduce((acc, t) => {
            acc.totalCost += t.totalCost;
            acc.netSales += t.netSales;
            acc.profit += t.profit;
            acc.delivery += t.delivery;
            acc.totalWithDelivery += t.totalWithDelivery;
            acc.orderTotal += t.orderTotal;
            return acc;
        }, {
            totalCost: 0,
            netSales: 0,
            profit: 0,
            delivery: 0,
            totalWithDelivery: 0,
            orderTotal: 0,
        });
        const order = ["credit", "cash"].filter((k) => totalsByType[k]);
        const otherKeys = Object.keys(totalsByType).filter((k) => !order.includes(k));
        [...order, ...otherKeys].forEach((key) => {
            const group = totalsByType[key];
            tableBody.push([
                `${inventoryTitleCase(key)} Sale`,
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
            ]);
            (group.rows || []).forEach((r) => {
                tableBody.push([
                    r.order_number || "-",
                    inventoryTitleCase(r.order_type || "-"),
                    r.store_names || r.store_name || "-",
                    inventoryTitleCase(r.store_payment_term || "-"),
                    inventoryMoney(r.total_cost),
                    inventoryMoney(r.net_sales),
                    inventoryMoney(r.estimated_profit),
                    inventoryMoney(r.delivery_fee),
                    inventoryMoney(r.total_with_delivery),
                    inventoryMoney(r.order_total),
                ]);
            });
            tableBody.push([
                `${inventoryTitleCase(key)} Totals`,
                "",
                "",
                "",
                inventoryMoney(group.totalCost),
                inventoryMoney(group.netSales),
                inventoryMoney(group.profit),
                inventoryMoney(group.delivery),
                inventoryMoney(group.totalWithDelivery),
                inventoryMoney(group.orderTotal),
            ]);
        });
        tableBody.push([
            "Grand Totals",
            "",
            "",
            "",
            inventoryMoney(grandTotals.totalCost),
            inventoryMoney(grandTotals.netSales),
            inventoryMoney(grandTotals.profit),
            inventoryMoney(grandTotals.delivery),
            inventoryMoney(grandTotals.totalWithDelivery),
            inventoryMoney(grandTotals.orderTotal),
        ]);
    } else if (activeType === "sales-by-payment") {
        tableHead = [["Order Number", "Order Type", "Store", "Store Payment Term", "Cost Price", "Sale Price", "Profit", "Delivery Charges", "Total With Delivery", "Order Total"]];
        const rows = currentSalesByPaymentRows || [];
        tableBody = [];
        const totalsByType = rows.reduce((acc, r) => {
            const typeKey = String(r.sale_type || r.payment_method || "other").toLowerCase();
            const storeKey = String(r.store_names || r.store_name || "-").trim() || "-";
            if (!acc[typeKey]) {
                acc[typeKey] = {
                    totalCost: 0,
                    netSales: 0,
                    profit: 0,
                    delivery: 0,
                    totalWithDelivery: 0,
                    orderTotal: 0,
                    stores: {},
                };
            }
            const typeGroup = acc[typeKey];
            if (!typeGroup.stores[storeKey]) {
                typeGroup.stores[storeKey] = {
                    totalCost: 0,
                    netSales: 0,
                    profit: 0,
                    delivery: 0,
                    totalWithDelivery: 0,
                    orderTotal: 0,
                    rows: [],
                };
            }
            const storeGroup = typeGroup.stores[storeKey];
            storeGroup.rows.push(r);
            storeGroup.totalCost += Number(r.total_cost || 0) || 0;
            storeGroup.netSales += Number(r.net_sales || 0) || 0;
            storeGroup.profit += Number(r.estimated_profit || 0) || 0;
            storeGroup.delivery += Number(r.delivery_fee || 0) || 0;
            storeGroup.totalWithDelivery += Number(r.total_with_delivery || 0) || 0;
            storeGroup.orderTotal += Number(r.order_total || 0) || 0;

            typeGroup.totalCost += Number(r.total_cost || 0) || 0;
            typeGroup.netSales += Number(r.net_sales || 0) || 0;
            typeGroup.profit += Number(r.estimated_profit || 0) || 0;
            typeGroup.delivery += Number(r.delivery_fee || 0) || 0;
            typeGroup.totalWithDelivery += Number(r.total_with_delivery || 0) || 0;
            typeGroup.orderTotal += Number(r.order_total || 0) || 0;
            return acc;
        }, {});
        const grandTotals = Object.values(totalsByType).reduce((acc, t) => {
            acc.totalCost += t.totalCost;
            acc.netSales += t.netSales;
            acc.profit += t.profit;
            acc.delivery += t.delivery;
            acc.totalWithDelivery += t.totalWithDelivery;
            acc.orderTotal += t.orderTotal;
            return acc;
        }, {
            totalCost: 0,
            netSales: 0,
            profit: 0,
            delivery: 0,
            totalWithDelivery: 0,
            orderTotal: 0,
        });
        const order = ["credit", "cash"].filter((k) => totalsByType[k]);
        const otherKeys = Object.keys(totalsByType).filter((k) => !order.includes(k));
        [...order, ...otherKeys].forEach((key) => {
            const group = totalsByType[key];
            tableBody.push([
                `${inventoryTitleCase(key)} Sale`,
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                "",
            ]);
            const storeKeys = Object.keys(group.stores || {}).sort((a, b) => a.localeCompare(b));
            storeKeys.forEach((storeKey) => {
                const storeGroup = group.stores[storeKey];
                tableBody.push([
                    `Store: ${storeKey}`,
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                ]);
                (storeGroup.rows || []).forEach((r) => {
                    tableBody.push([
                        r.order_number || "-",
                        inventoryTitleCase(r.order_type || "-"),
                        storeKey,
                        inventoryTitleCase(r.store_payment_term || "-"),
                        inventoryMoney(r.total_cost),
                        inventoryMoney(r.net_sales),
                        inventoryMoney(r.estimated_profit),
                        inventoryMoney(r.delivery_fee),
                        inventoryMoney(r.total_with_delivery),
                        inventoryMoney(r.order_total),
                    ]);
                });
                tableBody.push([
                    "Store Totals",
                    "",
                    "",
                    "",
                    inventoryMoney(storeGroup.totalCost),
                    inventoryMoney(storeGroup.netSales),
                    inventoryMoney(storeGroup.profit),
                    inventoryMoney(storeGroup.delivery),
                    inventoryMoney(storeGroup.totalWithDelivery),
                    inventoryMoney(storeGroup.orderTotal),
                ]);
            });
            tableBody.push([
                `${inventoryTitleCase(key)} Totals`,
                "",
                "",
                "",
                "",
                inventoryMoney(group.totalCost),
                inventoryMoney(group.netSales),
                inventoryMoney(group.profit),
                inventoryMoney(group.delivery),
                inventoryMoney(group.totalWithDelivery),
                inventoryMoney(group.orderTotal),
            ]);
        });
        tableBody.push([
            "Grand Totals",
            "",
            "",
            "",
            "",
            inventoryMoney(grandTotals.totalCost),
            inventoryMoney(grandTotals.netSales),
            inventoryMoney(grandTotals.profit),
            inventoryMoney(grandTotals.delivery),
            inventoryMoney(grandTotals.totalWithDelivery),
            inventoryMoney(grandTotals.orderTotal),
        ]);
    } else if (activeType === "customer-details") {
        if (getSelectedCustomerDetailsReportMode() === "customer-summary") {
            tableHead = [["Customer", "Contact No", "Address", "Total Orders", "Delivered", "Cancelled", "Active", "Qty", "Items Subtotal", "Delivery Fee", "Total Amount", "Delivered Amount", "Cancelled Amount", "Active Amount", "Last Order"]];
            const rows = currentCustomerSummaryRows || [];
            tableBody = rows.map((r) => [
                [r.customer_name, r.customer_email].filter(Boolean).join(" | ") || "-",
                r.contact_no || "-",
                r.customer_address || "-",
                inventoryNumber(r.total_orders),
                inventoryNumber(r.delivered_orders),
                inventoryNumber(r.cancelled_orders),
                inventoryNumber(r.active_orders),
                inventoryNumber(r.total_quantity),
                inventoryMoney(r.items_subtotal),
                inventoryMoney(r.delivery_fee),
                inventoryMoney(r.total_order_amount),
                inventoryMoney(r.delivered_amount),
                inventoryMoney(r.cancelled_amount),
                inventoryMoney(r.active_amount),
                inventoryDateTime(r.last_order_date),
            ]);
            const totals = rows.reduce((acc, r) => {
                acc.totalOrders += Number(r.total_orders || 0) || 0;
                acc.deliveredOrders += Number(r.delivered_orders || 0) || 0;
                acc.cancelledOrders += Number(r.cancelled_orders || 0) || 0;
                acc.activeOrders += Number(r.active_orders || 0) || 0;
                acc.qty += Number(r.total_quantity || 0) || 0;
                acc.itemsSubtotal += Number(r.items_subtotal || 0) || 0;
                acc.deliveryFee += Number(r.delivery_fee || 0) || 0;
                acc.totalAmount += Number(r.total_order_amount || 0) || 0;
                acc.deliveredAmount += Number(r.delivered_amount || 0) || 0;
                acc.cancelledAmount += Number(r.cancelled_amount || 0) || 0;
                acc.activeAmount += Number(r.active_amount || 0) || 0;
                return acc;
            }, {
                totalOrders: 0,
                deliveredOrders: 0,
                cancelledOrders: 0,
                activeOrders: 0,
                qty: 0,
                itemsSubtotal: 0,
                deliveryFee: 0,
                totalAmount: 0,
                deliveredAmount: 0,
                cancelledAmount: 0,
                activeAmount: 0,
            });
            tableBody.push([
                "Totals",
                "",
                `${inventoryNumber(rows.length)} customers`,
                inventoryNumber(totals.totalOrders),
                inventoryNumber(totals.deliveredOrders),
                inventoryNumber(totals.cancelledOrders),
                inventoryNumber(totals.activeOrders),
                inventoryNumber(totals.qty),
                inventoryMoney(totals.itemsSubtotal),
                inventoryMoney(totals.deliveryFee),
                inventoryMoney(totals.totalAmount),
                inventoryMoney(totals.deliveredAmount),
                inventoryMoney(totals.cancelledAmount),
                inventoryMoney(totals.activeAmount),
                "",
            ]);
        } else if (getSelectedCustomerDetailsReportMode() === "order-summary") {
            tableHead = [["Order Date", "Order Number", "Customer", "Contact No", "Address", "Stores", "Products", "Qty", "Items Subtotal", "Delivery Fee", "Order Total", "Status"]];
            const rows = currentCustomerOrderSummaryRows || [];
            tableBody = rows.map((r) => [
                inventoryDateTime(r.order_date),
                r.order_number || "-",
                [r.customer_name, r.customer_email].filter(Boolean).join(" | ") || "-",
                r.contact_no || "-",
                r.customer_address || "-",
                r.store_names || "-",
                r.products_summary || "-",
                inventoryNumber(r.total_quantity),
                inventoryMoney(r.items_subtotal),
                inventoryMoney(r.delivery_fee),
                inventoryMoney(r.order_total),
                inventoryTitleCase(r.order_status || "-"),
            ]);
            const uniqueCustomers = new Set();
            const totals = rows.reduce((acc, r) => {
                acc.qty += Number(r.total_quantity || 0) || 0;
                acc.itemsSubtotal += Number(r.items_subtotal || 0) || 0;
                acc.deliveryFee += Number(r.delivery_fee || 0) || 0;
                acc.orderTotal += Number(r.order_total || 0) || 0;
                if (r.customer_id) uniqueCustomers.add(String(r.customer_id));
                return acc;
            }, { qty: 0, itemsSubtotal: 0, deliveryFee: 0, orderTotal: 0 });
            tableBody.push([
                "Totals",
                "",
                `${inventoryNumber(uniqueCustomers.size)} unique customers`,
                "",
                "",
                "",
                `${inventoryNumber(rows.length)} orders`,
                inventoryNumber(totals.qty),
                inventoryMoney(totals.itemsSubtotal),
                inventoryMoney(totals.deliveryFee),
                inventoryMoney(totals.orderTotal),
                "",
            ]);
        } else {
            tableHead = [["Order Date", "Order Number", "Store", "Product", "Customer", "Contact No", "Address", "Qty", "Sale Price", "Line Total", "Status"]];
            const rows = currentCustomerDetailsRows || [];
            tableBody = rows.map((r) => [
                inventoryDateTime(r.order_date),
                r.order_number || "-",
                r.store_name || "-",
                r.product_name || "-",
                [r.customer_name, r.customer_email].filter(Boolean).join(" | ") || "-",
                r.contact_no || "-",
                r.customer_address || "-",
                inventoryNumber(r.quantity),
                inventoryMoney(r.sale_price),
                inventoryMoney(r.line_total),
                inventoryTitleCase(r.order_status || "-"),
            ]);
            const uniqueCustomers = new Set();
            const totals = rows.reduce((acc, r) => {
                acc.qty += Number(r.quantity || 0) || 0;
                acc.sales += Number(r.line_total || 0) || 0;
                if (r.customer_id) uniqueCustomers.add(String(r.customer_id));
                return acc;
            }, { qty: 0, sales: 0 });
            tableBody.push([
                "Totals",
                "",
                "",
                "",
                `${inventoryNumber(uniqueCustomers.size)} unique customers`,
                "",
                "",
                inventoryNumber(totals.qty),
                "",
                inventoryMoney(totals.sales),
                "",
            ]);
        }
    } else {
        tableHead = [["Store", "Products", "Stock", "Inventory Value"]];
        tableBody = (currentInventoryData.store_wise || []).map((r) => [
            r.store_name,
            inventoryNumber(r.total_products),
            inventoryNumber(r.total_stock),
            inventoryMoney(r.total_inventory_value),
        ]);
    }

    doc.autoTable({
        startY,
        head: tableHead,
        body: tableBody,
        styles: { fontSize: 9, cellPadding: 2.5, valign: "middle" },
        headStyles: { fillColor: [26, 79, 129], textColor: [255, 255, 255], fontStyle: "bold" },
        alternateRowStyles: { fillColor: [245, 248, 252] },
        margin: { left: 10, right: 10 },
        didDrawPage: () => {
            const pageCount = doc.getNumberOfPages();
            const page = doc.internal.getCurrentPageInfo().pageNumber;
            doc.setFontSize(8);
            doc.text(`Page ${page} of ${pageCount}`, 280, 205, { align: "right" });
        },
    });

    const fileDate = now.toISOString().slice(0, 10);
    const scope = selectedStoreId ? `store_${selectedStoreId}` : "all_stores";
    const safeReportName = reportName.replace(/[^a-z0-9]+/gi, "_");
    doc.save(`${safeReportName}_${scope}_${fileDate}.pdf`);
}

function exportInventoryReportExcel() {
    const activeType = (document.getElementById("inventoryReportSelect") || {}).value || "store";
    const tableIdMap = {
        store: "storeInventoryTable",
        category: "categoryInventoryTable",
        breakdown: "storeCategoryBreakdownTable",
        "product-detail": "productDetailInventoryTable",
        sales: "storeSalesTable",
        "manual-sales": "manualSalesTable",
        "store-product-sales": "storeProductSalesTable",
        "combined-product-sales": "combinedProductSalesTable",
        "sales-with-delivery": "salesWithDeliveryTable",
        "sales-by-payment": "salesByPaymentTable",
        "sales-by-payment-simple": "salesByPaymentSimpleTable",
        "customer-details": "customerDetailsReportTable",
    };
    const reportNameMap = {
        store: "Inventory Report",
        category: "Category-wise Inventory Report",
        breakdown: "Store-wise Category Breakdown Report",
        "product-detail": "Product Cost Sale Detail Report",
        sales: "Store Sale-wise Report",
        "manual-sales": "Manual Order Product Sales Report",
        "store-product-sales": "Store Product Sales Report",
        "combined-product-sales": "Combined Product Sales Report",
        "sales-with-delivery": "Sales With Delivery Charges Report",
        "sales-by-payment": "Cash Credit Sales With Delivery Report",
        "sales-by-payment-simple": "Cash Credit Sales With Delivery Report By Type",
        "customer-details": "Customer Details by Store Product Report",
    };

    const table = document.getElementById(tableIdMap[activeType]);
    if (!table) {
        showWarning("Export Excel", "No report table found to export.");
        return;
    }

    const clone = table.cloneNode(true);
    clone.querySelectorAll("script, button").forEach((el) => el.remove());
    clone.querySelectorAll("td, th").forEach((cell) => {
        cell.textContent = inventoryPlainText(cell.innerHTML).replace(/\s+/g, " ").trim();
    });

    const now = new Date();
    const selectedStoreId = getSelectedInventoryStoreId();
    const selectedStoreName = selectedStoreId
        ? ((currentInventoryData?.stores || []).find((s) => Number(s.id) === Number(selectedStoreId)) || {}).name || `Store #${selectedStoreId}`
        : "All Stores";
    const selectedCustomerName = activeType === "customer-details" ? getSelectedInventoryCustomerName() : "";
    const selectedCustomerReportMode = activeType === "customer-details"
        ? ({
            "order-summary": "Customer Order Summary",
            "customer-summary": "Selected Customer Period Summary",
            detail: "Product Detail",
        }[getSelectedCustomerDetailsReportMode()] || "Product Detail")
        : "";
    const { startDate, endDate } = getSelectedInventoryDateRange();
    const reportName = reportNameMap[activeType] || "ServeNow Report";
    const workbook = `
        <html>
          <head>
            <meta charset="UTF-8">
            <style>
              table { border-collapse: collapse; font-family: Arial, sans-serif; font-size: 12px; }
              th { background: #1a4f81; color: #fff; font-weight: bold; }
              th, td { border: 1px solid #b8c4d0; padding: 6px; vertical-align: top; }
              tfoot td { font-weight: bold; background: #eef4f8; }
            </style>
          </head>
          <body>
            <h2>ServeNow</h2>
            <h3>${inventoryEscapeHtml(reportName)}</h3>
            <p><strong>Store Scope:</strong> ${inventoryEscapeHtml(selectedStoreName)}</p>
            ${selectedCustomerName ? `<p><strong>Customer Scope:</strong> ${inventoryEscapeHtml(selectedCustomerName)}</p>` : ""}
            ${selectedCustomerReportMode ? `<p><strong>Report View:</strong> ${inventoryEscapeHtml(selectedCustomerReportMode)}</p>` : ""}
            <p><strong>Date Range:</strong> ${inventoryEscapeHtml(startDate || "-")} to ${inventoryEscapeHtml(endDate || "-")}</p>
            <p><strong>Generated:</strong> ${inventoryEscapeHtml(now.toLocaleString())}</p>
            ${clone.outerHTML}
          </body>
        </html>
    `;
    const blob = new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const fileDate = now.toISOString().slice(0, 10);
    const scope = selectedStoreId ? `store_${selectedStoreId}` : "all_stores";
    const safeReportName = reportName.replace(/[^a-z0-9]+/gi, "_");
    link.href = url;
    link.download = `${safeReportName}_${scope}_${fileDate}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

document.addEventListener("DOMContentLoaded", () => {
    const initialScope = window.location.hash === "#sale-reports" ? "sales" : "inventory";
    setInventoryReportScope(initialScope);
    ensureInventoryDateDefaults();

    const tabLinks = document.querySelectorAll(".tab-link");
    tabLinks.forEach((link) => {
        if (link.getAttribute("data-tab") === "inventory-report") {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                setTimeout(() => {
                    loadInventoryReport();
                }, 100);
            });
        }
    });

    const reportSelect = document.getElementById("inventoryReportSelect");
    if (reportSelect) {
        reportSelect.addEventListener("change", (e) => {
            switchInventoryReport(e.target.value);
        });
    }

    const applyBtn = document.getElementById("inventoryApplyFilterBtn");
    if (applyBtn) applyBtn.addEventListener("click", loadSelectedInventoryReport);

    const clearBtn = document.getElementById("inventoryClearFilterBtn");
    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            const storeFilter = document.getElementById("inventoryStoreFilter");
            if (storeFilter) storeFilter.value = "";
            const customerFilter = document.getElementById("inventoryCustomerFilter");
            if (customerFilter) customerFilter.value = "";
            const customerReportMode = document.getElementById("inventoryCustomerReportMode");
            if (customerReportMode) customerReportMode.value = "detail";
            const startDateEl = document.getElementById("inventoryStartDate");
            const endDateEl = document.getElementById("inventoryEndDate");
            const today = inventoryTodayDateValue();
            if (startDateEl) startDateEl.value = today;
            if (endDateEl) endDateEl.value = today;
            loadSelectedInventoryReport();
        });
    }

    const pdfBtn = document.getElementById("inventoryExportPdfBtn");
    if (pdfBtn) pdfBtn.addEventListener("click", exportInventoryReportPdf);

    const excelBtn = document.getElementById("inventoryExportExcelBtn");
    if (excelBtn) excelBtn.addEventListener("click", exportInventoryReportExcel);

    const customerReportMode = document.getElementById("inventoryCustomerReportMode");
    if (customerReportMode) {
        customerReportMode.addEventListener("change", () => {
            const activeType = (document.getElementById("inventoryReportSelect") || {}).value || "";
            if (activeType === "customer-details") loadCustomerDetailsReport();
        });
    }

    const saveManualSalesEditBtn = document.getElementById("saveManualSalesEditBtn");
    if (saveManualSalesEditBtn) {
        saveManualSalesEditBtn.addEventListener("click", saveManualSalesEdit);
    }

    const manualSalesEditForm = document.getElementById("manualSalesEditForm");
    if (manualSalesEditForm) {
        manualSalesEditForm.addEventListener("submit", (event) => {
            event.preventDefault();
            saveManualSalesEdit();
        });
    }
});
