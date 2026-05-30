let currentInventoryData = null;
let currentStoreSalesRows = [];
let currentManualSalesRows = [];
let currentStoreProductSalesRows = [];
let currentCombinedProductSalesRows = [];
let currentSalesWithDeliveryRows = [];
let currentSalesByPaymentRows = [];
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
    const { startDate, endDate } = getSelectedInventoryDateRange();

    if (storeId) params.set("store_id", String(storeId));
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
    return {
        totalOrders: 0,
        totalSales: 0,
        totalDiscount: 0,
        totalProfit: 0,
        uniqueCustomers: 0,
        cash: { orders: 0, sales: 0 },
        cash_discount: { orders: 0, sales: 0 },
        credit: { orders: 0, sales: 0 },
        credit_discount: { orders: 0, sales: 0 },
    };
}

function addStoreSaleTotals(totals, store) {
    totals.totalOrders += Number(store.total_orders || 0) || 0;
    totals.totalSales += Number(store.total_sales_net || 0) || 0;
    totals.totalDiscount += Number(store.total_discount || 0) || 0;
    totals.totalProfit += Number(store.estimated_profit || 0) || 0;
    totals.uniqueCustomers += Number(store.unique_customers || 0) || 0;
    storeSaleTypeOrder.forEach((key) => {
        const metric = storeSaleTypeMetric(store, key);
        totals[key].orders += metric.orders;
        totals[key].sales += metric.sales;
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
            ${typeCells}
            <td>${inventoryMoney(average)}</td>
            <td>${inventoryNumber(totals.uniqueCustomers)}</td>
        </tr>
    `;
}

function displayStoreSalesReport(data) {
    const tbody = document.getElementById("storeSalesBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    currentStoreSalesRows = data.store_sales || [];
    if (
        expandedStoreSalesStoreId &&
        !currentStoreSalesRows.some((store) => Number(store.store_id) === Number(expandedStoreSalesStoreId))
    ) {
        expandedStoreSalesStoreId = null;
    }

    if (!currentStoreSalesRows.length) {
        const row = document.createElement("tr");
        row.innerHTML = `<td colspan="11" style="text-align:center;">No store sales found for the selected date range.</td>`;
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
        headingRow.innerHTML = `<td colspan="11">${storeSaleTypeLabel(typeKey)} Stores</td>`;
        tbody.appendChild(headingRow);

        const groupTotals = createStoreSaleTotals();
        stores.forEach((store) => {
            addStoreSaleTotals(groupTotals, store);
            addStoreSaleTotals(grandTotals, store);

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
                <td>${renderStoreSaleTypeCell(store, "cash")}</td>
                <td>${renderStoreSaleTypeCell(store, "cash_discount")}</td>
                <td>${renderStoreSaleTypeCell(store, "credit")}</td>
                <td>${renderStoreSaleTypeCell(store, "credit_discount")}</td>
                <td>${inventoryMoney(store.average_order_value)}</td>
                <td>${inventoryNumber(store.unique_customers)}</td>
            `;
            row.addEventListener("click", () => {
                expandedStoreSalesStoreId = isExpanded ? null : storeId;
                displayStoreSalesReport({ store_sales: currentStoreSalesRows });
            });
            tbody.appendChild(row);

            if (isExpanded) {
                const detailRow = document.createElement("tr");
                detailRow.className = "store-sales-detail-row";
                detailRow.innerHTML = `
                    <td colspan="11" style="background:#f8fafc; padding:0;">
                        ${renderStoreSalesOrdersDetail(store)}
                    </td>
                `;
                tbody.appendChild(detailRow);
            }
        });

        tbody.insertAdjacentHTML("beforeend", renderStoreSaleTotalsRow(`${storeSaleTypeLabel(typeKey)} Total`, groupTotals, "aginv-report-subtotal-row"));
    });

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

    return `
        <div style="padding:1rem;">
            <div style="display:flex; flex-wrap:wrap; gap:0.75rem; margin-bottom:0.75rem;">
                ${storeSaleTypeOrder.map((key) => `
                <div class="store-sale-detail-card ${storeSaleTypeClass(key)}">
                    <strong>${storeSaleTypeLabel(key)}:</strong> ${inventoryNumber(totals[key].orders)} orders, ${inventoryMoney(totals[key].sales)}
                </div>
                `).join("")}
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
                            <th>Delivery</th>
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
        "productDetailReportSection",
    ];
    sections.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
    });

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
    };
    const reportName = reportNameMap[activeType] || "Inventory Report";
    const selectedStoreId = getSelectedInventoryStoreId();
    const selectedStoreName = selectedStoreId
        ? ((currentInventoryData?.stores || []).find((s) => Number(s.id) === Number(selectedStoreId)) || {}).name || `Store #${selectedStoreId}`
        : "All Stores";
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

    let startY = 46;
    if (currentInventoryReportScope !== "sales") {
        const summary = currentInventoryData.summary || {};
        doc.setFont("helvetica", "bold");
        doc.text("Summary", 14, 46);
        doc.setFont("helvetica", "normal");
        doc.text(
            `Stores: ${inventoryNumber(summary.total_stores)} | Categories: ${inventoryNumber(summary.total_categories)} | Products: ${inventoryNumber(summary.total_products)} | Stock: ${inventoryNumber(summary.total_stock)} | Inventory Value: ${inventoryMoney(summary.total_inventory_value)}`,
            14,
            52
        );
        startY = 58;
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
        tableHead = [["Store", "Orders", "Net Sales", "Discount", "Profit", "Cash", "Cash Discount", "Credit", "Credit Discount", "Avg Order", "Customers"]];
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
            tableBody.push([`${storeSaleTypeLabel(typeKey)} Stores`, "", "", "", "", "", "", "", "", "", ""]);
            const groupTotals = createStoreSaleTotals();
            groupRows.forEach((r) => {
                addStoreSaleTotals(groupTotals, r);
                addStoreSaleTotals(grandTotals, r);
                tableBody.push([
                    r.store_name,
                    inventoryNumber(r.total_orders),
                    inventoryMoney(r.total_sales_net),
                    inventoryMoney(r.total_discount),
                    inventoryMoney(r.estimated_profit),
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
