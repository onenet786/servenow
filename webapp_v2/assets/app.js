const API_BASE = `${window.location.protocol}//${window.location.host}`;
const AUTH_TOKEN_KEY = "serveNowToken";
const AUTH_USER_KEY = "serveNowUser";
const CART_KEY = "serveNowCart";

const CUSTOMER_ROUTES = new Set(["home", "stores", "cart", "orders", "wallet", "profile"]);
const RIDER_ROUTES = new Set(["rider-dashboard", "rider-financial"]);
const STORE_OWNER_ROUTES = new Set(["store-dashboard", "store-financial"]);
const ADMIN_ROUTES = new Set([
  "admin-dashboard",
  "admin-orders",
  "admin-stores",
  "admin-users",
  "admin-products",
  "admin-riders",
  "admin-catalog",
  "admin-permissions",
  "admin-payments",
  "admin-wallets",
  "admin-financial",
]);

const state = {
  currentRoute: "home",
  stores: [],
  featuredStores: [],
  currentStore: null,
  cart: loadCart(),
  authToken: localStorage.getItem(AUTH_TOKEN_KEY) || "",
  user: parseJson(localStorage.getItem(AUTH_USER_KEY)),
  deliveryConfig: { base_fee: 70, additional_per_store: 30 },
  search: "",
  orderFilter: "all",
  orders: [],
  support: null,
  wallet: null,
  walletTransactions: [],
  walletAutoRecharge: null,
  sentTransfers: [],
  receivedTransfers: [],
  stripe: null,
  stripeElements: null,
  stripeCard: null,
  rider: {
    profile: null,
    wallet: null,
    stats: null,
    assignedDeliveries: [],
    completedDeliveries: [],
    financial: null,
    locationLabel: "",
  },
  storeOwner: {
    stats: null,
    orders: [],
    financial: null,
    statusMessage: null,
    banks: [],
    campaigns: [],
  },
  admin: {
    visitorStats: null,
    recentActivity: null,
    orders: [],
    stores: [],
    users: [],
    products: [],
    riders: [],
    categories: [],
    units: [],
    sizes: [],
    permissionGroups: [],
    permissionUsers: [],
    availableRiders: [],
    paymentsStats: null,
    payments: [],
    walletsStats: null,
    wallets: [],
    financialDashboard: null,
    financialReports: [],
  },
};

const els = {
  sidebar: document.getElementById("sidebar"),
  menuToggle: document.getElementById("menuToggle"),
  globalSearch: document.getElementById("globalSearch"),
  featuredStores: document.getElementById("featuredStores"),
  storesGrid: document.getElementById("storesGrid"),
  storeSearchInput: document.getElementById("storeSearchInput"),
  clearSearchBtn: document.getElementById("clearSearchBtn"),
  storeDetailTitle: document.getElementById("storeDetailTitle"),
  storeDetailContent: document.getElementById("storeDetailContent"),
  cartItemsPanel: document.getElementById("cartItemsPanel"),
  cartSummaryPanel: document.getElementById("cartSummaryPanel"),
  ordersPanel: document.getElementById("ordersPanel"),
  supportPanel: document.getElementById("supportPanel"),
  walletPanel: document.getElementById("walletPanel"),
  profilePanel: document.getElementById("profilePanel"),
  riderDashboardPanel: document.getElementById("riderDashboardPanel"),
  riderFinancialPanel: document.getElementById("riderFinancialPanel"),
  storeDashboardPanel: document.getElementById("storeDashboardPanel"),
  storeFinancialPanel: document.getElementById("storeFinancialPanel"),
  adminStatsPanel: document.getElementById("adminStatsPanel"),
  adminRecentPanel: document.getElementById("adminRecentPanel"),
  adminOrdersPanel: document.getElementById("adminOrdersPanel"),
  adminStoresPanel: document.getElementById("adminStoresPanel"),
  adminUsersPanel: document.getElementById("adminUsersPanel"),
  adminProductsPanel: document.getElementById("adminProductsPanel"),
  adminRidersPanel: document.getElementById("adminRidersPanel"),
  adminCatalogPanel: document.getElementById("adminCatalogPanel"),
  adminPermissionsPanel: document.getElementById("adminPermissionsPanel"),
  adminPaymentsPanel: document.getElementById("adminPaymentsPanel"),
  adminWalletsPanel: document.getElementById("adminWalletsPanel"),
  adminFinancialPanel: document.getElementById("adminFinancialPanel"),
  statusBanner: document.getElementById("statusBanner"),
  authActionBtn: document.getElementById("authActionBtn"),
  guestLoginBtn: document.getElementById("guestLoginBtn"),
  authModal: document.getElementById("authModal"),
  authModalTitle: document.getElementById("authModalTitle"),
  closeAuthModalBtn: document.getElementById("closeAuthModalBtn"),
  loginForm: document.getElementById("loginForm"),
  registerForm: document.getElementById("registerForm"),
  sidebarCartCount: document.getElementById("sidebarCartCount"),
  heroCartCount: document.getElementById("heroCartCount"),
  heroStoreCount: document.getElementById("heroStoreCount"),
  heroAuthState: document.getElementById("heroAuthState"),
  backToStoresBtn: document.getElementById("backToStoresBtn"),
  riderNav: document.getElementById("riderNav"),
  riderNavLabel: document.getElementById("riderNavLabel"),
  storeOwnerNav: document.getElementById("storeOwnerNav"),
  storeOwnerNavLabel: document.getElementById("storeOwnerNavLabel"),
  adminNav: document.getElementById("adminNav"),
  adminNavLabel: document.getElementById("adminNavLabel"),
};

document.addEventListener("click", handleClick);
document.addEventListener("submit", handleSubmit);
document.addEventListener("change", handleChange);
window.addEventListener("hashchange", syncRouteFromHash);

els.menuToggle.addEventListener("click", () => {
  els.sidebar.classList.toggle("open");
});

els.globalSearch.addEventListener("input", (event) => {
  state.search = event.target.value.trim();
  if (els.storeSearchInput) {
    els.storeSearchInput.value = state.search;
  }
  renderStores();
});

els.storeSearchInput?.addEventListener("input", (event) => {
  state.search = event.target.value.trim();
  els.globalSearch.value = state.search;
  renderStores();
});

els.clearSearchBtn?.addEventListener("click", () => {
  state.search = "";
  els.globalSearch.value = "";
  els.storeSearchInput.value = "";
  renderStores();
});

els.authActionBtn?.addEventListener("click", () => {
  if (state.user) {
    navigate(defaultWorkspaceRoute());
    return;
  }
  window.location.href = "/next/login";
});

els.guestLoginBtn?.addEventListener("click", handleGuestLogin);
els.backToStoresBtn?.addEventListener("click", () => navigate("stores"));
els.closeAuthModalBtn?.addEventListener("click", () => els.authModal.close());

document.querySelectorAll("[data-auth-tab]").forEach((button) => {
  button.addEventListener("click", () => setAuthTab(button.dataset.authTab));
});

document.querySelectorAll("[data-route-jump]").forEach((button) => {
  button.addEventListener("click", () => navigate(button.dataset.routeJump));
});

bootstrap();

async function bootstrap() {
  syncRouteFromHash();
  updateHeader();
  renderCart();
  renderOrders();
  renderWallet();
  renderProfile();
  renderRiderViews();
  renderStoreOwnerViews();
  renderAdminViews();
  await Promise.allSettled([loadStores(), loadDeliveryFeeConfig()]);
  if (state.authToken) {
    await loadAuthenticatedData();
  }
}

function handleClick(event) {
  const routeButton = event.target.closest("[data-route]");
  if (routeButton) {
    navigate(routeButton.dataset.route);
    return;
  }

  const storeButton = event.target.closest("[data-store-id]");
  if (storeButton) {
    const storeId = Number(storeButton.dataset.storeId);
    if (Number.isInteger(storeId) && storeId > 0) {
      openStore(storeId);
    }
    return;
  }

  const addButton = event.target.closest("[data-add-product]");
  if (addButton) {
    addProductFromButton(addButton);
    return;
  }

  const qtyButton = event.target.closest("[data-cart-action]");
  if (qtyButton) {
    mutateCartItem(qtyButton.dataset.cartKey, qtyButton.dataset.cartAction);
    return;
  }

  const filterButton = event.target.closest("[data-order-filter]");
  if (filterButton) {
    state.orderFilter = filterButton.dataset.orderFilter;
    document.querySelectorAll("[data-order-filter]").forEach((button) => {
      button.classList.toggle("active", button.dataset.orderFilter === state.orderFilter);
    });
    renderOrders();
    return;
  }

  const logoutButton = event.target.closest("[data-logout]");
  if (logoutButton) {
    logout();
    return;
  }

  const transferActionButton = event.target.closest("[data-transfer-action]");
  if (transferActionButton) {
    handleTransferAction(
      transferActionButton.dataset.transferAction,
      Number(transferActionButton.dataset.transferId)
    );
    return;
  }

  const transferTabButton = event.target.closest("[data-transfer-tab]");
  if (transferTabButton) {
    const target = transferTabButton.dataset.transferTab;
    document.querySelectorAll("[data-transfer-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.transferTab === target);
    });
    document.querySelectorAll("[data-transfer-panel]").forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.transferPanel !== target);
    });
    return;
  }

  const riderActionButton = event.target.closest("[data-rider-action]");
  if (riderActionButton) {
    handleRiderAction(
      riderActionButton.dataset.riderAction,
      Number(riderActionButton.dataset.orderId)
    );
    return;
  }

  const storeOwnerActionButton = event.target.closest("[data-store-action]");
  if (storeOwnerActionButton) {
    handleStoreOwnerAction(
      storeOwnerActionButton.dataset.storeAction,
      Number(storeOwnerActionButton.dataset.orderId)
    );
    return;
  }

  const adminActionButton = event.target.closest("[data-admin-action]");
  if (adminActionButton) {
    handleAdminAction(
      adminActionButton.dataset.adminAction,
      Number(adminActionButton.dataset.orderId || adminActionButton.dataset.walletId || adminActionButton.dataset.id || 0)
    );
  }
}

async function handleSubmit(event) {
  if (event.target === els.loginForm) {
    event.preventDefault();
    await handleLogin(event.target);
    return;
  }

  if (event.target === els.registerForm) {
    event.preventDefault();
    await handleRegister(event.target);
    return;
  }

  if (event.target.matches("#checkoutForm")) {
    event.preventDefault();
    await handleCheckout(event.target);
    return;
  }

  if (event.target.matches("#topupForm")) {
    event.preventDefault();
    await handleWalletTopup(event.target);
    return;
  }

  if (event.target.matches("#transferForm")) {
    event.preventDefault();
    await handleTransferSubmit(event.target);
    return;
  }

  if (event.target.matches("#autoRechargeForm")) {
    event.preventDefault();
    await handleAutoRechargeSubmit(event.target);
    return;
  }

  if (event.target.matches("#passwordForm")) {
    event.preventDefault();
    await handlePasswordChange(event.target);
    return;
  }

  if (event.target.matches("#storeStatusForm")) {
    event.preventDefault();
    await handleStoreStatusSubmit(event.target);
  }
}

function handleChange(event) {
  if (event.target.matches("#autoRechargeEnabled")) {
    const enabled = event.target.checked;
    document.querySelectorAll("[data-auto-recharge-field]").forEach((field) => {
      field.disabled = !enabled;
    });
  }
}

function navigate(route) {
  window.location.hash = route === "home" ? "#home" : `#${route}`;
}

function syncRouteFromHash() {
  const raw = (window.location.hash || "#home").replace(/^#/, "");
  const [route, id] = raw.split("/");
  if (route === "store" && id) {
    state.currentRoute = "store";
    showView("storeDetailView");
    openStore(Number(id), true);
    return;
  }

  const allowed = new Set([...CUSTOMER_ROUTES, ...RIDER_ROUTES, ...STORE_OWNER_ROUTES, ...ADMIN_ROUTES]);
  state.currentRoute = allowed.has(route) ? route : "home";
  const viewMap = {
    home: "homeView",
    stores: "storesView",
    cart: "cartView",
    orders: "ordersView",
    wallet: "walletView",
    profile: "profileView",
    "rider-dashboard": "riderDashboardView",
    "rider-financial": "riderFinancialView",
    "store-dashboard": "storeDashboardView",
    "store-financial": "storeFinancialView",
    "admin-dashboard": "adminDashboardView",
    "admin-orders": "adminOrdersView",
    "admin-stores": "adminStoresView",
    "admin-users": "adminUsersView",
    "admin-products": "adminProductsView",
    "admin-riders": "adminRidersView",
    "admin-catalog": "adminCatalogView",
    "admin-permissions": "adminPermissionsView",
    "admin-payments": "adminPaymentsView",
    "admin-wallets": "adminWalletsView",
    "admin-financial": "adminFinancialView",
  };

  const needsAdmin = ADMIN_ROUTES.has(state.currentRoute);
  const needsRider = RIDER_ROUTES.has(state.currentRoute);
  const needsStoreOwner = STORE_OWNER_ROUTES.has(state.currentRoute);

  if (needsAdmin && !isAdminLike()) {
    state.currentRoute = state.user ? defaultWorkspaceRoute() : "home";
  }
  if (needsRider && !isRider()) {
    state.currentRoute = state.user ? defaultWorkspaceRoute() : "home";
  }
  if (needsStoreOwner && !isStoreOwner()) {
    state.currentRoute = state.user ? defaultWorkspaceRoute() : "home";
  }

  showView(viewMap[state.currentRoute] || "homeView");
}

function showView(viewId) {
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("active", section.id === viewId);
  });

  document.querySelectorAll(".nav-link").forEach((button) => {
    const route = button.dataset.route;
    const active = (route === "stores" && viewId === "storeDetailView") || `${camelViewId(route)}` === viewId;
    button.classList.toggle("active", active);
  });

  if (viewId === "walletView" && state.user && !isGuest()) {
    mountStripeCardElement();
  }
}

function camelViewId(route) {
  const map = {
    home: "homeView",
    stores: "storesView",
    cart: "cartView",
    orders: "ordersView",
    wallet: "walletView",
    profile: "profileView",
    "rider-dashboard": "riderDashboardView",
    "rider-financial": "riderFinancialView",
    "store-dashboard": "storeDashboardView",
    "store-financial": "storeFinancialView",
    "admin-dashboard": "adminDashboardView",
    "admin-orders": "adminOrdersView",
    "admin-stores": "adminStoresView",
    "admin-users": "adminUsersView",
    "admin-products": "adminProductsView",
    "admin-riders": "adminRidersView",
    "admin-catalog": "adminCatalogView",
    "admin-permissions": "adminPermissionsView",
    "admin-payments": "adminPaymentsView",
    "admin-wallets": "adminWalletsView",
    "admin-financial": "adminFinancialView",
  };
  return map[route] || "homeView";
}

async function loadStores() {
  try {
    const data = await publicJson("/api/stores");
    state.stores = Array.isArray(data.stores) ? data.stores : [];
    state.featuredStores = state.stores.slice(0, 6);
    els.heroStoreCount.textContent = String(state.stores.length);
    renderFeaturedStores();
    renderStores();
  } catch (error) {
    showStatus(error.message || "Unable to load stores right now.", "error");
  }
}

async function loadAuthenticatedData() {
  await loadProfile();
  if (!state.user || isGuest()) {
    renderOrders();
    renderWallet();
    renderProfile();
    renderRiderViews();
    renderStoreOwnerViews();
    renderAdminViews();
    return;
  }

  const tasks = [];
  if (isCustomerLike()) {
    tasks.push(loadOrders(), loadSupport(), loadWalletData());
  }
  if (isRider()) {
    tasks.push(loadRiderData());
  }
  if (isStoreOwner()) {
    tasks.push(loadStoreOwnerData());
  }
  if (isAdminLike()) {
    tasks.push(loadAdminData());
  }

  await Promise.allSettled(tasks);
}

async function loadProfile() {
  try {
    const data = await apiJson("/api/auth/me");
    if (data.user) {
      state.user = data.user;
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
      renderProfile();
      updateHeader();
    }
  } catch (_) {
    logout(false);
  }
}

async function loadOrders() {
  try {
    const data = await apiJson("/api/orders/my-orders?status=all");
    state.orders = Array.isArray(data.orders) ? data.orders : [];
    renderOrders();
  } catch (error) {
    showStatus(error.message || "Failed to load orders.", "error");
  }
}

async function loadSupport() {
  try {
    const data = await apiJson("/api/orders/customer-support-contact");
    state.support = data.support || null;
    renderOrders();
  } catch (_) {
    state.support = null;
    renderOrders();
  }
}

async function loadWalletData() {
  try {
    const [balanceData, txData, autoData, sentData, receivedData] = await Promise.all([
      apiJson("/api/wallet/balance"),
      apiJson("/api/wallet/transactions?limit=12&offset=0"),
      apiJson("/api/wallet/auto-recharge"),
      apiJson("/api/wallet/transfers/sent?limit=8&offset=0"),
      apiJson("/api/wallet/transfers/received?limit=8&offset=0"),
    ]);

    state.wallet = balanceData.wallet || null;
    state.walletTransactions = Array.isArray(txData.transactions) ? txData.transactions : [];
    state.walletAutoRecharge = autoData.success === false ? null : autoData;
    state.sentTransfers = Array.isArray(sentData.transfers) ? sentData.transfers : [];
    state.receivedTransfers = Array.isArray(receivedData.transfers) ? receivedData.transfers : [];
    initStripe(balanceData.stripePublicKey || "");
    renderWallet();
  } catch (error) {
    showStatus(error.message || "Failed to load wallet data.", "error");
  }
}

async function loadRiderData() {
  try {
    const [profileData, walletData, statsData, assignedData, completedData, financialData] =
      await Promise.all([
        apiJson("/api/orders/rider/profile"),
        apiJson("/api/wallet/balance"),
        apiJson("/api/orders/rider/wallet-stats?period=daily"),
        apiJson("/api/orders/rider/deliveries?status=assigned"),
        apiJson("/api/orders/rider/deliveries?status=completed"),
        apiJson("/api/orders/rider/financial-history"),
      ]);

    state.rider.profile = profileData.rider || null;
    state.rider.wallet = walletData.wallet || null;
    state.rider.stats = statsData.stats || null;
    state.rider.assignedDeliveries = Array.isArray(assignedData.deliveries) ? assignedData.deliveries : [];
    state.rider.completedDeliveries = Array.isArray(completedData.deliveries) ? completedData.deliveries : [];
    state.rider.financial = financialData || null;
  } catch (error) {
    showStatus(error.message || "Failed to load rider workspace.", "error");
  }

  renderRiderViews();
}

async function loadStoreOwnerData() {
  try {
    const [dashboardData, financialData, statusData, banksData, campaignData] = await Promise.all([
      apiJson("/api/orders/store-dashboard?status=all"),
      apiJson("/api/orders/store-owner/financial-history"),
      apiJson("/api/stores/status-message"),
      apiJson("/api/stores/bank-options"),
      apiJson("/api/stores/offer-campaigns"),
    ]);

    state.storeOwner.stats = dashboardData.stats || null;
    state.storeOwner.orders = Array.isArray(dashboardData.orders) ? dashboardData.orders : [];
    state.storeOwner.financial = financialData || null;
    state.storeOwner.statusMessage = statusData || null;
    state.storeOwner.banks = Array.isArray(banksData.banks) ? banksData.banks : [];
    state.storeOwner.campaigns = Array.isArray(campaignData.campaigns) ? campaignData.campaigns : [];
  } catch (error) {
    showStatus(error.message || "Failed to load store-owner workspace.", "error");
  }

  renderStoreOwnerViews();
}

async function loadAdminData() {
  const loaders = await Promise.allSettled([
    apiJson("/api/admin/recent-activity"),
    apiJson("/api/orders"),
    apiJson("/api/stores?admin=1"),
    apiJson("/api/users"),
    apiJson("/api/products?admin=true&include_variants=0&include_image_variants=0"),
    apiJson("/api/riders"),
    apiJson("/api/categories?includeInactive=true"),
    apiJson("/api/units"),
    apiJson("/api/sizes"),
    apiJson("/api/permissions/groups"),
    apiJson("/api/permissions/users"),
    apiJson("/api/orders/available-riders"),
    apiJson("/api/admin/payments/stats"),
    apiJson("/api/admin/payments?limit=50"),
    apiJson("/api/admin/wallets/stats"),
    apiJson("/api/admin/wallets?limit=50"),
    apiJson("/api/financial/dashboard?period=all"),
    apiJson("/api/financial/reports"),
    isAdmin() ? apiJson("/api/admin/visitor-stats") : Promise.resolve(null),
  ]);

  const valueOrNull = (index) => loaders[index].status === "fulfilled" ? loaders[index].value : null;

  const recent = valueOrNull(0);
  const orders = valueOrNull(1);
  const stores = valueOrNull(2);
  const users = valueOrNull(3);
  const products = valueOrNull(4);
  const riders = valueOrNull(5);
  const categories = valueOrNull(6);
  const units = valueOrNull(7);
  const sizes = valueOrNull(8);
  const permissionGroups = valueOrNull(9);
  const permissionUsers = valueOrNull(10);
  const availableRiders = valueOrNull(11);
  const paymentsStats = valueOrNull(12);
  const payments = valueOrNull(13);
  const walletsStats = valueOrNull(14);
  const wallets = valueOrNull(15);
  const financialDashboard = valueOrNull(16);
  const financialReports = valueOrNull(17);
  const visitorStats = valueOrNull(18);

  state.admin.recentActivity = recent || null;
  state.admin.orders = Array.isArray(orders?.orders) ? orders.orders : [];
  state.admin.stores = Array.isArray(stores?.stores) ? stores.stores : [];
  state.admin.users = Array.isArray(users?.users) ? users.users : [];
  state.admin.products = Array.isArray(products?.products) ? products.products : [];
  state.admin.riders = Array.isArray(riders?.riders) ? riders.riders : [];
  state.admin.categories = Array.isArray(categories?.categories) ? categories.categories : [];
  state.admin.units = Array.isArray(units?.units) ? units.units : [];
  state.admin.sizes = Array.isArray(sizes?.sizes) ? sizes.sizes : [];
  state.admin.permissionGroups = Array.isArray(permissionGroups?.groups) ? permissionGroups.groups : [];
  state.admin.permissionUsers = Array.isArray(permissionUsers?.users) ? permissionUsers.users : [];
  state.admin.availableRiders = Array.isArray(availableRiders?.riders) ? availableRiders.riders : [];
  state.admin.paymentsStats = paymentsStats?.stats || null;
  state.admin.payments = Array.isArray(payments?.payments) ? payments.payments : [];
  state.admin.walletsStats = walletsStats?.stats || null;
  state.admin.wallets = Array.isArray(wallets?.wallets) ? wallets.wallets : [];
  state.admin.financialDashboard = financialDashboard?.dashboard || financialDashboard?.stats || financialDashboard || null;
  state.admin.financialReports = Array.isArray(financialReports?.reports) ? financialReports.reports : [];
  state.admin.visitorStats = visitorStats || null;

  renderAdminViews();
}

async function loadDeliveryFeeConfig() {
  try {
    const data = await publicJson("/api/orders/delivery-fee-config");
    state.deliveryConfig = {
      base_fee: Number(data.base_fee) || 70,
      additional_per_store: Number(data.additional_per_store) || 30,
    };
  } catch (_) {
    // Defaults stay in place.
  }
}

async function openStore(storeId, keepHash = false) {
  if (!Number.isInteger(storeId) || storeId <= 0) {
    return;
  }

  if (!keepHash) {
    window.location.hash = `#store/${storeId}`;
  }

  showView("storeDetailView");
  els.storeDetailTitle.textContent = "Loading store...";
  els.storeDetailContent.innerHTML = `<div class="panel">Loading store details...</div>`;

  try {
    const data = await publicJson(`/api/stores/${storeId}`);
    state.currentStore = data;
    renderStoreDetail(data.store, Array.isArray(data.products) ? data.products : []);
  } catch (error) {
    els.storeDetailContent.innerHTML = `<div class="panel">Unable to load store details.</div>`;
    showStatus(error.message || "Unable to load store details.", "error");
  }
}

function renderFeaturedStores() {
  els.featuredStores.innerHTML = state.featuredStores.length
    ? state.featuredStores.map((store) => storeCardTemplate(store)).join("")
    : emptyState("No stores available yet.");
}

function renderStores() {
  const search = state.search.toLowerCase();
  const filtered = state.stores.filter((store) => {
    if (!search) return true;
    return [store.name, store.location, store.description]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(search));
  });

  els.storesGrid.innerHTML = filtered.length
    ? filtered.map((store) => storeCardTemplate(store)).join("")
    : emptyState("No stores matched your search.");
}

function renderStoreDetail(store, products) {
  els.storeDetailTitle.textContent = store?.name || "Store";

  const image = normalizeImage(store?.image_url || store?.cover_image);
  const storeInfo = `
    <article class="store-hero panel">
      <div class="store-hero-image">
        <img src="${image}" alt="${escapeHtml(store?.name || "Store")}" />
      </div>
      <div class="stack">
        <div>
          <p class="eyebrow">Store overview</p>
          <h3>${escapeHtml(store?.name || "Store")}</h3>
        </div>
        <div class="store-meta">
          <span class="pill ${store?.is_open ? "" : "warning"}">${store?.is_open ? "Open now" : "Closed"}</span>
          <span>${escapeHtml(store?.location || "Location unavailable")}</span>
          <span>Rating ${(Number(store?.rating) || 0).toFixed(1)}</span>
          <span>${escapeHtml(store?.delivery_time || "30-45 min")}</span>
        </div>
        <p>${escapeHtml(store?.description || "Browse the live product catalog for this store.")}</p>
      </div>
    </article>
  `;

  const productCards = products.length
    ? products.map((product) => productCardTemplate(product, store.id, store.name)).join("")
    : emptyState("This store has no products available right now.");

  els.storeDetailContent.innerHTML = `
    ${storeInfo}
    <section class="stack">
      <div class="section-head">
        <div>
          <p class="eyebrow">Catalog</p>
          <h3>Available products</h3>
        </div>
      </div>
      <div class="card-grid">${productCards}</div>
    </section>
  `;
}

function renderCart() {
  updateCartBadges();

  if (!state.cart.length) {
    els.cartItemsPanel.innerHTML = emptyState("Your cart is empty.");
    els.cartSummaryPanel.innerHTML = `
      <h4>Order summary</h4>
      <p>Add items from a store to start checkout.</p>
    `;
    return;
  }

  const itemsHtml = state.cart.map((item) => {
    const total = Number(item.price) * Number(item.quantity);
    return `
      <article class="cart-item">
        <div class="cart-row">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <div class="store-meta">
              <span>${escapeHtml(item.storeName || `Store #${item.storeId}`)}</span>
              ${item.variantLabel ? `<span>${escapeHtml(item.variantLabel)}</span>` : ""}
            </div>
          </div>
          <strong>PKR ${total.toFixed(2)}</strong>
        </div>
        <div class="cart-row">
          <div class="qty-row">
            <button type="button" data-cart-action="decrease" data-cart-key="${escapeAttribute(item.key)}">-</button>
            <span>${Number(item.quantity)}</span>
            <button type="button" data-cart-action="increase" data-cart-key="${escapeAttribute(item.key)}">+</button>
          </div>
          <button class="ghost-button button-small" type="button" data-cart-action="remove" data-cart-key="${escapeAttribute(item.key)}">
            Remove
          </button>
        </div>
      </article>
    `;
  }).join("");

  const summary = calculateCartSummary();
  els.cartItemsPanel.innerHTML = itemsHtml;
  els.cartSummaryPanel.innerHTML = `
    <h4>Checkout</h4>
    <div class="stack">
      <div class="summary-row"><span>Subtotal</span><strong>PKR ${summary.subtotal.toFixed(2)}</strong></div>
      <div class="summary-row"><span>Delivery</span><strong>PKR ${summary.delivery.toFixed(2)}</strong></div>
      <div class="summary-row"><span>Total</span><strong>PKR ${summary.total.toFixed(2)}</strong></div>
    </div>
    <form class="checkout-form" id="checkoutForm">
      <label>
        <span>Delivery address</span>
        <textarea name="deliveryAddress" required>${escapeHtml(state.user?.address || "")}</textarea>
      </label>
      <label>
        <span>Delivery time</span>
        <input type="text" name="deliveryTime" placeholder="As soon as possible" />
      </label>
      <label>
        <span>Payment method</span>
        <select name="paymentMethod">
          <option value="cash">Cash</option>
          <option value="wallet">Wallet</option>
        </select>
      </label>
      <button class="primary-button" type="submit">Place order</button>
    </form>
  `;
}

function renderOrders() {
  if (!state.user) {
    els.supportPanel.innerHTML = "";
    els.ordersPanel.innerHTML = loginPrompt("Login to review and track your orders.");
    return;
  }

  if (isGuest()) {
    els.supportPanel.innerHTML = "";
    els.ordersPanel.innerHTML = guestPrompt("Guest accounts can browse but must register before placing and tracking real orders.");
    return;
  }

  if (state.support) {
    els.supportPanel.innerHTML = `
      <div class="cart-row">
        <div>
          <h4>Support contact</h4>
          <p>Use these live support details from the backend when an order needs help.</p>
        </div>
        <div class="align-end">
          <strong>${escapeHtml(state.support.phone || state.support.email || "Available")}</strong>
        </div>
      </div>
    `;
  } else {
    els.supportPanel.innerHTML = "";
  }

  const filtered = state.orders.filter((order) => {
    if (state.orderFilter === "all") return true;
    if (state.orderFilter === "completed") return String(order.status).toLowerCase() === "delivered";
    return String(order.status).toLowerCase() !== "delivered";
  });

  els.ordersPanel.innerHTML = filtered.length
    ? filtered.map((order) => orderCardTemplate(order)).join("")
    : emptyState("No orders found for this filter.");
}

function renderWallet() {
  if (!state.user) {
    els.walletPanel.innerHTML = loginPrompt("Login to manage your wallet, transactions, and transfers.");
    return;
  }

  if (isGuest()) {
    els.walletPanel.innerHTML = guestPrompt("Wallet features are available for registered accounts.");
    return;
  }

  const wallet = state.wallet;
  if (!wallet) {
    els.walletPanel.innerHTML = `<div class="panel">Loading wallet data...</div>`;
    return;
  }

  const transactionsHtml = state.walletTransactions.length
    ? state.walletTransactions.map((tx) => `
        <div class="list-row">
          <div>
            <strong>${escapeHtml(tx.description || tx.type || "Transaction")}</strong>
            <small>${formatDateTime(tx.created_at)}</small>
          </div>
          <strong>${String(tx.type).toLowerCase() === "debit" ? "-" : "+"}PKR ${(Number(tx.amount) || 0).toFixed(2)}</strong>
        </div>
      `).join("")
    : emptyInline("No wallet transactions found.");

  const sentTransfersHtml = state.sentTransfers.length
    ? state.sentTransfers.map((transfer) => transferRowTemplate(transfer, "sent")).join("")
    : emptyInline("No sent transfers.");
  const receivedTransfersHtml = state.receivedTransfers.length
    ? state.receivedTransfers.map((transfer) => transferRowTemplate(transfer, "received")).join("")
    : emptyInline("No received transfers.");
  const autoEnabled = !!(state.walletAutoRecharge && state.walletAutoRecharge.enabled);

  els.walletPanel.innerHTML = `
    <section class="summary-grid">
      <article class="summary-card"><small>Balance</small><strong>PKR ${(Number(wallet.balance) || 0).toFixed(2)}</strong></article>
      <article class="summary-card"><small>Total Credited</small><strong>PKR ${(Number(wallet.total_credited) || 0).toFixed(2)}</strong></article>
      <article class="summary-card"><small>Total Spent</small><strong>PKR ${(Number(wallet.total_spent) || 0).toFixed(2)}</strong></article>
      <article class="summary-card"><small>Last Credit</small><strong>${wallet.last_credited_at ? formatDateTime(wallet.last_credited_at) : "-"}</strong></article>
    </section>

    <div class="dashboard-grid">
      <section class="panel">
        <h4>Top up wallet</h4>
        <form class="checkout-form" id="topupForm">
          <label>
            <span>Amount</span>
            <input type="number" min="1" step="0.01" name="amount" required />
          </label>
          <label>
            <span>Payment method</span>
            <select name="paymentMethod">
              <option value="card">Card</option>
              <option value="paypal">PayPal</option>
            </select>
          </label>
          <div class="card-host" id="walletCardElement"></div>
          <button class="primary-button" type="submit">Top up</button>
        </form>
      </section>

      <section class="panel">
        <h4>Auto recharge</h4>
        <form class="checkout-form" id="autoRechargeForm">
          <label class="checkbox-row">
            <input id="autoRechargeEnabled" type="checkbox" name="enabled" ${autoEnabled ? "checked" : ""} />
            <span>Enable auto recharge</span>
          </label>
          <label>
            <span>Recharge amount</span>
            <input data-auto-recharge-field type="number" min="1" step="0.01" name="amount" value="${escapeAttribute(state.walletAutoRecharge?.amount ?? "")}" ${autoEnabled ? "" : "disabled"} />
          </label>
          <label>
            <span>Threshold</span>
            <input data-auto-recharge-field type="number" min="0" step="0.01" name="threshold" value="${escapeAttribute(state.walletAutoRecharge?.threshold ?? "")}" ${autoEnabled ? "" : "disabled"} />
          </label>
          <button class="primary-button" type="submit">Save settings</button>
        </form>
      </section>
    </div>

    <div class="dashboard-grid">
      <section class="panel">
        <h4>Send transfer</h4>
        <form class="checkout-form" id="transferForm">
          <label>
            <span>Recipient user ID</span>
            <input type="number" name="recipientId" min="1" required />
          </label>
          <label>
            <span>Amount</span>
            <input type="number" min="1" step="0.01" name="amount" required />
          </label>
          <label>
            <span>Description</span>
            <input type="text" name="description" placeholder="Optional note" />
          </label>
          <button class="primary-button" type="submit">Create transfer</button>
        </form>
      </section>

      <section class="panel">
        <div class="section-head section-head--compact">
          <h4>Transfers</h4>
          <div class="segmented">
            <button class="segmented-btn active" data-transfer-tab="sent" type="button">Sent</button>
            <button class="segmented-btn" data-transfer-tab="received" type="button">Received</button>
          </div>
        </div>
        <div class="list-stack" data-transfer-panel="sent">${sentTransfersHtml}</div>
        <div class="list-stack hidden" data-transfer-panel="received">${receivedTransfersHtml}</div>
      </section>
    </div>

    <section class="panel">
      <h4>Recent transactions</h4>
      <div class="list-stack">${transactionsHtml}</div>
    </section>
  `;

  mountStripeCardElement();
}

function renderProfile() {
  if (!state.user) {
    els.profilePanel.innerHTML = loginPrompt("Login to manage your profile and password.");
    return;
  }

  const displayName = `${state.user.first_name || ""} ${state.user.last_name || ""}`.trim() || "User";
  const workspaceButtons = [];
  if (isAdminLike()) workspaceButtons.push(`<button class="ghost-button" type="button" data-route="admin-dashboard">Open Admin Workspace</button>`);
  if (isRider()) workspaceButtons.push(`<button class="ghost-button" type="button" data-route="rider-dashboard">Open Rider Workspace</button>`);
  if (isStoreOwner()) workspaceButtons.push(`<button class="ghost-button" type="button" data-route="store-dashboard">Open Store Workspace</button>`);

  els.profilePanel.innerHTML = `
    <section class="panel">
      <h4>${escapeHtml(displayName)}</h4>
      <div class="stack">
        <div class="summary-row"><span>Email</span><strong>${escapeHtml(state.user.email || "-")}</strong></div>
        <div class="summary-row"><span>Phone</span><strong>${escapeHtml(state.user.phone || "-")}</strong></div>
        <div class="summary-row"><span>Role</span><strong>${escapeHtml(state.user.user_type || "-")}</strong></div>
        <div class="summary-row"><span>Address</span><strong>${escapeHtml(state.user.address || "-")}</strong></div>
      </div>
      ${isGuest() ? "<p>Guest sessions can browse, but registered accounts are needed for full platform actions.</p>" : ""}
      <div class="inline-actions">${workspaceButtons.join("")}</div>
    </section>

    <section class="panel">
      <h4>Security</h4>
      <form class="checkout-form" id="passwordForm">
        <label>
          <span>Current password</span>
          <input type="password" name="currentPassword" required />
        </label>
        <label>
          <span>New password</span>
          <input type="password" name="newPassword" minlength="6" required />
        </label>
        <label>
          <span>Confirm new password</span>
          <input type="password" name="confirmNewPassword" minlength="6" required />
        </label>
        <button class="primary-button" type="submit">Update password</button>
      </form>
      <button class="ghost-button" type="button" data-logout="1">Logout</button>
    </section>
  `;
}

function renderRiderViews() {
  if (!isRider()) {
    const content = state.user
      ? guestPrompt("This workspace is available only for rider accounts.")
      : loginPrompt("Login with a rider account to open the rider workspace.");
    els.riderDashboardPanel.innerHTML = content;
    els.riderFinancialPanel.innerHTML = content;
    return;
  }

  renderRiderDashboard();
  renderRiderFinancial();
}

function renderRiderDashboard() {
  const rider = state.rider.profile;
  const assigned = state.rider.assignedDeliveries || [];
  const completed = state.rider.completedDeliveries || [];
  const stats = state.rider.stats || {};
  const wallet = state.rider.wallet || {};

  const assignedHtml = assigned.length
    ? assigned.map((delivery) => riderDeliveryCardTemplate(delivery, true)).join("")
    : emptyState("No active deliveries assigned right now.");
  const completedHtml = completed.length
    ? completed.slice(0, 6).map((delivery) => riderDeliveryCardTemplate(delivery, false)).join("")
    : emptyState("No completed deliveries yet.");

  els.riderDashboardPanel.innerHTML = `
    <section class="summary-grid">
      <article class="summary-card"><small>Assigned</small><strong>${assigned.length}</strong></article>
      <article class="summary-card"><small>Completed</small><strong>${completed.length}</strong></article>
      <article class="summary-card"><small>Wallet Balance</small><strong>PKR ${(Number(wallet.balance) || 0).toFixed(2)}</strong></article>
      <article class="summary-card"><small>Daily Delivery Fees</small><strong>PKR ${(Number(stats.total_delivery_fees) || 0).toFixed(2)}</strong></article>
    </section>

    <section class="panel">
      <div class="cart-row">
        <div>
          <h4>${escapeHtml(`${rider?.first_name || ""} ${rider?.last_name || ""}`.trim() || "Rider profile")}</h4>
          <div class="store-meta">
            <span>${escapeHtml(rider?.email || "-")}</span>
            <span>${escapeHtml(rider?.phone || "-")}</span>
            <span>${escapeHtml(rider?.vehicle_type || "Vehicle not set")}</span>
          </div>
        </div>
        <button class="primary-button" type="button" data-rider-action="push-location">Update my location</button>
      </div>
      ${state.rider.locationLabel ? `<p>Last location update: ${escapeHtml(state.rider.locationLabel)}</p>` : "<p>Use the location button to push your live position to active deliveries.</p>"}
    </section>

    <section class="panel">
      <h4>Assigned deliveries</h4>
      <div class="stack">${assignedHtml}</div>
    </section>

    <section class="panel">
      <h4>Recently completed</h4>
      <div class="stack">${completedHtml}</div>
    </section>
  `;
}

function renderRiderFinancial() {
  const financial = state.rider.financial || {};
  const summary = financial.summary || {};
  const daily = financial.daily_summary || {};
  const movements = Array.isArray(financial.movements) ? financial.movements : [];
  const movementHtml = movements.length
    ? movements.slice(0, 20).map((entry) => `
        <div class="list-row">
          <div>
            <strong>${escapeHtml(entry.movement_type || entry.description || "Movement")}</strong>
            <small>${escapeHtml(entry.description || "-")} | ${formatDateTime(entry.movement_date)}</small>
          </div>
          <strong>PKR ${(Number(entry.amount) || 0).toFixed(2)}</strong>
        </div>
      `).join("")
    : emptyInline("No rider cash movements found.");

  els.riderFinancialPanel.innerHTML = `
    <section class="summary-grid">
      <article class="summary-card"><small>Wallet Balance</small><strong>PKR ${(Number(summary.wallet_balance) || 0).toFixed(2)}</strong></article>
      <article class="summary-card"><small>Cash Collection</small><strong>PKR ${(Number(daily.cash_collection) || 0).toFixed(2)}</strong></article>
      <article class="summary-card"><small>Fuel Payment</small><strong>PKR ${(Number(daily.fuel_payment) || 0).toFixed(2)}</strong></article>
      <article class="summary-card"><small>Delivery Fee Earned</small><strong>PKR ${(Number(daily.delivery_fee_earned) || 0).toFixed(2)}</strong></article>
    </section>

    <section class="panel">
      <h4>Recent financial movements</h4>
      <div class="list-stack">${movementHtml}</div>
    </section>
  `;
}

function renderStoreOwnerViews() {
  if (!isStoreOwner()) {
    const content = state.user
      ? guestPrompt("This workspace is available only for store-owner accounts.")
      : loginPrompt("Login with a store-owner account to open the store workspace.");
    els.storeDashboardPanel.innerHTML = content;
    els.storeFinancialPanel.innerHTML = content;
    return;
  }

  renderStoreOwnerDashboard();
  renderStoreOwnerFinancial();
}

function renderStoreOwnerDashboard() {
  const stats = state.storeOwner.stats || {};
  const orders = state.storeOwner.orders || [];
  const statusInfo = state.storeOwner.statusMessage || {};

  const ordersHtml = orders.length
    ? orders.slice(0, 20).map((order) => storeOwnerOrderCardTemplate(order)).join("")
    : emptyState("No store-owner orders found.");

  els.storeDashboardPanel.innerHTML = `
    <section class="summary-grid">
      <article class="summary-card"><small>Store</small><strong>${escapeHtml(stats.store_name || "Store")}</strong></article>
      <article class="summary-card"><small>Total Orders</small><strong>${escapeHtml(String(stats.total_orders ?? 0))}</strong></article>
      <article class="summary-card"><small>Delivered Sales</small><strong>PKR ${(Number(stats.total_amount) || 0).toFixed(2)}</strong></article>
      <article class="summary-card"><small>Pending Settlement</small><strong>PKR ${(Number(stats.received_balance) || 0).toFixed(2)}</strong></article>
    </section>

    <div class="dashboard-grid">
      <section class="panel">
        <h4>Store status message</h4>
        <form class="checkout-form" id="storeStatusForm">
          <label class="checkbox-row">
            <input type="checkbox" name="is_closed" ${statusInfo.is_closed ? "checked" : ""} />
            <span>Mark store as temporarily closed</span>
          </label>
          <label>
            <span>Status message</span>
            <textarea name="status_message" placeholder="Add a public message for customers">${escapeHtml(statusInfo.status_message || "")}</textarea>
          </label>
          <button class="primary-button" type="submit">Save store status</button>
        </form>
      </section>

      <section class="panel">
        <h4>Operational snapshot</h4>
        <div class="stack">
          <div class="summary-row"><span>Owner</span><strong>${escapeHtml(stats.owner_name || "-")}</strong></div>
          <div class="summary-row"><span>Email</span><strong>${escapeHtml(stats.owner_email || "-")}</strong></div>
          <div class="summary-row"><span>Phone</span><strong>${escapeHtml(stats.owner_phone || "-")}</strong></div>
          <div class="summary-row"><span>Payment Term</span><strong>${escapeHtml(stats.payment_term || "-")}</strong></div>
        </div>
      </section>
    </div>

    <section class="panel">
      <h4>Store orders</h4>
      <div class="stack">${ordersHtml}</div>
    </section>
  `;
}

function renderStoreOwnerFinancial() {
  const financial = state.storeOwner.financial || {};
  const summary = financial.summary || {};
  const entries = Array.isArray(financial.entries) ? financial.entries : [];
  const banks = state.storeOwner.banks || [];
  const campaigns = state.storeOwner.campaigns || [];

  const entryHtml = entries.length
    ? entries.slice(0, 20).map((entry) => `
        <div class="list-row">
          <div>
            <strong>${escapeHtml(entry.store_name || "Store")} | ${escapeHtml(entry.order_number || `Order #${entry.order_id}`)}</strong>
            <small>${escapeHtml(entry.order_status || "-")} | ${escapeHtml(entry.payment_method || "-")} | ${formatDateTime(entry.order_date)}</small>
          </div>
          <div class="stack stack-tight align-end">
            <strong>Gross PKR ${(Number(entry.gross_store_amount) || 0).toFixed(2)}</strong>
            <small>Rider store payment PKR ${(Number(entry.rider_store_payment) || 0).toFixed(2)}</small>
          </div>
        </div>
      `).join("")
    : emptyInline("No financial entries loaded.");

  const bankHtml = banks.length
    ? banks.map((bank) => `
        <article class="feature-card">
          <strong>${escapeHtml(bank.name || "Bank")}</strong>
          <div class="detail-list">
            <span>A/C ${escapeHtml(bank.account_number || "-")}</span>
            <span>${escapeHtml(bank.branch_name || "-")}</span>
            <span>${escapeHtml(bank.account_title || "-")}</span>
          </div>
        </article>
      `).join("")
    : emptyInline("No bank options found.");

  const campaignHtml = campaigns.length
    ? campaigns.map((campaign) => `
        <article class="feature-card">
          <div class="cart-row">
            <strong>${escapeHtml(campaign.name || "Campaign")}</strong>
            <span class="pill ${campaign.is_active_now ? "" : "warning"}">${campaign.is_active_now ? "Active now" : "Scheduled"}</span>
          </div>
          <div class="detail-list">
            <span>${escapeHtml(campaign.campaign_type || "-")}</span>
            <span>${escapeHtml(campaign.apply_scope || "-")}</span>
            <span>${campaign.discount_value ? `Value ${escapeHtml(String(campaign.discount_value))}` : ""}</span>
          </div>
          <small>${escapeHtml(campaign.description || "No description")}</small>
        </article>
      `).join("")
    : emptyInline("No offer campaigns found.");

  els.storeFinancialPanel.innerHTML = `
    <section class="summary-grid">
      <article class="summary-card"><small>Total Orders</small><strong>${escapeHtml(String(summary.total_orders ?? 0))}</strong></article>
      <article class="summary-card"><small>Gross Store Amount</small><strong>PKR ${(Number(summary.gross_store_amount) || 0).toFixed(2)}</strong></article>
      <article class="summary-card"><small>Rider Store Payment</small><strong>PKR ${(Number(summary.rider_store_payment) || 0).toFixed(2)}</strong></article>
      <article class="summary-card"><small>Campaigns</small><strong>${campaigns.length}</strong></article>
    </section>

    <div class="dashboard-grid">
      <section class="panel">
        <h4>Bank options</h4>
        <div class="stack">${bankHtml}</div>
      </section>

      <section class="panel">
        <h4>Offer campaigns</h4>
        <div class="stack">${campaignHtml}</div>
      </section>
    </div>

    <section class="panel">
      <h4>Financial history</h4>
      <div class="list-stack">${entryHtml}</div>
    </section>
  `;
}

function renderAdminViews() {
  if (!isAdminLike()) {
    const content = state.user
      ? guestPrompt("Admin workspace is available only for admin or staff accounts.")
      : loginPrompt("Login with an admin account to open the admin workspace.");
    els.adminStatsPanel.innerHTML = "";
    els.adminRecentPanel.innerHTML = content;
    els.adminOrdersPanel.innerHTML = content;
    els.adminStoresPanel.innerHTML = content;
    els.adminUsersPanel.innerHTML = content;
    els.adminProductsPanel.innerHTML = content;
    els.adminRidersPanel.innerHTML = content;
    els.adminCatalogPanel.innerHTML = content;
    els.adminPermissionsPanel.innerHTML = content;
    els.adminPaymentsPanel.innerHTML = content;
    els.adminWalletsPanel.innerHTML = content;
    els.adminFinancialPanel.innerHTML = content;
    return;
  }

  renderAdminDashboard();
  renderAdminOrders();
  renderAdminStores();
  renderAdminUsers();
  renderAdminProducts();
  renderAdminRiders();
  renderAdminCatalog();
  renderAdminPermissions();
  renderAdminPayments();
  renderAdminWallets();
  renderAdminFinancial();
}

function renderAdminDashboard() {
  const recent = state.admin.recentActivity || {};
  const statsCards = [
    { label: "Today Logins", value: state.admin.visitorStats?.today_logins ?? "-" },
    { label: "Unique Visitors", value: state.admin.visitorStats?.today_unique_visitors ?? "-" },
    { label: "Orders Loaded", value: state.admin.orders.length },
    { label: "Wallets Loaded", value: state.admin.wallets.length },
  ];

  els.adminStatsPanel.innerHTML = statsCards.map((card) => `
    <article class="summary-card">
      <small>${escapeHtml(card.label)}</small>
      <strong>${escapeHtml(String(card.value))}</strong>
    </article>
  `).join("");

  const groups = [
    ...(recent.recent_orders || []),
    ...(recent.recent_users || []),
    ...(recent.recent_stores || []),
  ];

  els.adminRecentPanel.innerHTML = `
    <h4>Recent activity</h4>
    <div class="admin-list">
      ${groups.length ? groups.map((entry) => `
        <article class="admin-row">
          <div class="admin-row-top">
            <div>
              <strong>${escapeHtml(entry.title || "Activity")}</strong>
              <div class="admin-row-meta">
                <span>${escapeHtml(entry.subtitle || "")}</span>
                <span>${formatDateTime(entry.timestamp)}</span>
              </div>
            </div>
            <span class="pill">${escapeHtml(entry.type || "event")}</span>
          </div>
        </article>
      `).join("") : emptyState("No recent activity loaded.")}
    </div>
  `;
}

function renderAdminOrders() {
  const ridersById = new Map((state.admin.availableRiders || []).map((rider) => [Number(rider.id), rider]));
  const orders = Array.isArray(state.admin.orders) ? state.admin.orders.slice(0, 30) : [];
  els.adminOrdersPanel.innerHTML = orders.length
    ? orders.map((order) => `
      <article class="admin-row">
        <div class="admin-row-top">
          <div>
            <strong>${escapeHtml(order.order_number || `Order #${order.id}`)}</strong>
            <div class="admin-row-meta">
              <span>${escapeHtml(order.store_name || "Store")}</span>
              <span>${escapeHtml(order.status || "pending")}</span>
              <span>${escapeHtml(order.payment_status || "pending")}</span>
              <span>${formatDateTime(order.created_at)}</span>
            </div>
          </div>
          <strong>PKR ${(Number(order.total_amount) || 0).toFixed(2)}</strong>
        </div>
        <div class="inline-actions">
          <button class="ghost-button button-small" type="button" data-admin-action="update-status" data-order-id="${order.id}">Update status</button>
          <button class="ghost-button button-small" type="button" data-admin-action="assign-rider" data-order-id="${order.id}">
            ${ridersById.has(Number(order.rider_id)) ? "Reassign rider" : "Assign rider"}
          </button>
        </div>
      </article>
    `).join("")
    : emptyState("No admin orders loaded.");
}

function renderAdminStores() {
  const stores = Array.isArray(state.admin.stores) ? state.admin.stores.slice(0, 30) : [];
  els.adminStoresPanel.innerHTML = stores.length
    ? stores.map((store) => `
      <article class="admin-row">
        <div class="admin-row-top">
          <div>
            <strong>${escapeHtml(store.name || "Store")}</strong>
            <div class="admin-row-meta">
              <span>${escapeHtml(store.location || "No location")}</span>
              <span>${store.is_active ? "Active" : "Inactive"}</span>
              <span>${store.is_open ? "Open" : "Closed"}</span>
            </div>
          </div>
          <span class="pill">${escapeHtml(store.payment_term || "No payment term")}</span>
        </div>
      </article>
    `).join("")
    : emptyState("No stores loaded.");
}

function renderAdminUsers() {
  const users = Array.isArray(state.admin.users) ? state.admin.users.slice(0, 30) : [];
  els.adminUsersPanel.innerHTML = users.length
    ? users.map((user) => `
      <article class="admin-row">
        <div class="admin-row-top">
          <div>
            <strong>${escapeHtml(`${user.first_name || ""} ${user.last_name || ""}`.trim() || `User #${user.id}`)}</strong>
            <div class="admin-row-meta">
              <span>${escapeHtml(user.email || "-")}</span>
              <span>${escapeHtml(user.user_type || "-")}</span>
              <span>${user.is_active ? "Active" : "Inactive"}</span>
            </div>
          </div>
          <span class="pill">${user.is_verified ? "Verified" : "Unverified"}</span>
        </div>
      </article>
    `).join("")
    : emptyState("No users loaded or permission denied.");
}

function renderAdminProducts() {
  const products = Array.isArray(state.admin.products) ? state.admin.products.slice(0, 30) : [];
  els.adminProductsPanel.innerHTML = products.length
    ? products.map((product) => `
      <article class="admin-row">
        <div class="admin-row-top">
          <div>
            <strong>${escapeHtml(product.name || "Product")}</strong>
            <div class="admin-row-meta">
              <span>${escapeHtml(product.store_name || "No store")}</span>
              <span>${escapeHtml(product.category_name || "No category")}</span>
              <span>Stock ${Number(product.stock_quantity) || 0}</span>
            </div>
          </div>
          <strong>PKR ${(Number(product.price) || 0).toFixed(2)}</strong>
        </div>
      </article>
    `).join("")
    : emptyState("No products loaded.");
}

function renderAdminRiders() {
  const riders = Array.isArray(state.admin.riders) ? state.admin.riders.slice(0, 40) : [];
  els.adminRidersPanel.innerHTML = riders.length
    ? riders.map((rider) => `
      <article class="admin-row">
        <div class="admin-row-top">
          <div>
            <strong>${escapeHtml(`${rider.first_name || ""} ${rider.last_name || ""}`.trim() || `Rider #${rider.id}`)}</strong>
            <div class="admin-row-meta">
              <span>${escapeHtml(rider.email || "-")}</span>
              <span>${escapeHtml(rider.phone || "-")}</span>
              <span>${escapeHtml(rider.vehicle_type || "Vehicle not set")}</span>
            </div>
          </div>
          <span class="pill ${rider.is_active ? "" : "warning"}">${rider.is_active ? "Active" : "Inactive"}</span>
        </div>
      </article>
    `).join("")
    : emptyState("No riders loaded.");
}

function renderAdminCatalog() {
  const categories = Array.isArray(state.admin.categories) ? state.admin.categories.slice(0, 15) : [];
  const units = Array.isArray(state.admin.units) ? state.admin.units.slice(0, 15) : [];
  const sizes = Array.isArray(state.admin.sizes) ? state.admin.sizes.slice(0, 15) : [];

  const categoryHtml = categories.length
    ? categories.map((category) => `
        <article class="admin-row">
          <div class="admin-row-top">
            <div>
              <strong>${escapeHtml(category.name || "Category")}</strong>
              <div class="admin-row-meta">
                <span>${escapeHtml(category.description || "No description")}</span>
              </div>
            </div>
            <span class="pill ${category.is_active ? "" : "warning"}">${category.is_active ? "Active" : "Inactive"}</span>
          </div>
          <div class="inline-actions">
            <button class="ghost-button button-small" type="button" data-admin-action="edit-category" data-id="${category.id}">Edit</button>
            <button class="ghost-button button-small" type="button" data-admin-action="delete-category" data-id="${category.id}">Delete</button>
          </div>
        </article>
      `).join("")
    : emptyInline("No categories loaded.");

  const unitsHtml = units.length
    ? units.map((unit) => `
        <article class="admin-row">
          <div class="admin-row-top">
            <div>
              <strong>${escapeHtml(unit.name || "Unit")}</strong>
              <div class="admin-row-meta">
                <span>${escapeHtml(unit.abbreviation || "-")}</span>
                <span>Multiplier ${escapeHtml(String(unit.multiplier ?? 1))}</span>
              </div>
            </div>
          </div>
          <div class="inline-actions">
            <button class="ghost-button button-small" type="button" data-admin-action="edit-unit" data-id="${unit.id}">Edit</button>
            <button class="ghost-button button-small" type="button" data-admin-action="delete-unit" data-id="${unit.id}">Delete</button>
          </div>
        </article>
      `).join("")
    : emptyInline("No units loaded.");

  const sizesHtml = sizes.length
    ? sizes.map((size) => `
        <article class="admin-row">
          <div class="admin-row-top">
            <div>
              <strong>${escapeHtml(size.label || "Size")}</strong>
              <div class="admin-row-meta">
                <span>${escapeHtml(size.description || "No description")}</span>
              </div>
            </div>
          </div>
          <div class="inline-actions">
            <button class="ghost-button button-small" type="button" data-admin-action="edit-size" data-id="${size.id}">Edit</button>
            <button class="ghost-button button-small" type="button" data-admin-action="delete-size" data-id="${size.id}">Delete</button>
          </div>
        </article>
      `).join("")
    : emptyInline("No sizes loaded.");

  els.adminCatalogPanel.innerHTML = `
    <section class="panel">
      <div class="cart-row">
        <h4>Categories</h4>
        <button class="primary-button button-small" type="button" data-admin-action="create-category">Add category</button>
      </div>
      <div class="admin-list">${categoryHtml}</div>
    </section>
    <section class="panel">
      <div class="cart-row">
        <h4>Units</h4>
        <button class="primary-button button-small" type="button" data-admin-action="create-unit">Add unit</button>
      </div>
      <div class="admin-list">${unitsHtml}</div>
    </section>
    <section class="panel">
      <div class="cart-row">
        <h4>Sizes</h4>
        <button class="primary-button button-small" type="button" data-admin-action="create-size">Add size</button>
      </div>
      <div class="admin-list">${sizesHtml}</div>
    </section>
  `;
}

function renderAdminPermissions() {
  const groups = Array.isArray(state.admin.permissionGroups) ? state.admin.permissionGroups : [];
  const users = Array.isArray(state.admin.permissionUsers) ? state.admin.permissionUsers.slice(0, 30) : [];

  const groupHtml = groups.length
    ? groups.map((group) => `
        <article class="admin-row">
          <div class="admin-row-top">
            <div>
              <strong>${escapeHtml(group.name || "Group")}</strong>
              <div class="admin-row-meta">
                <span>${escapeHtml(group.description || "No description")}</span>
                <span>${escapeHtml(String(group.permissions_count ?? 0))} permissions</span>
                <span>${escapeHtml(String(group.member_count ?? 0))} members</span>
              </div>
            </div>
          </div>
          <div class="inline-actions">
            <button class="ghost-button button-small" type="button" data-admin-action="edit-group" data-id="${group.id}">Edit</button>
            <button class="ghost-button button-small" type="button" data-admin-action="delete-group" data-id="${group.id}">Delete</button>
          </div>
        </article>
      `).join("")
    : emptyInline("No permission groups loaded.");

  const userHtml = users.length
    ? users.map((user) => `
        <article class="admin-row">
          <div class="admin-row-top">
            <div>
              <strong>${escapeHtml(`${user.first_name || ""} ${user.last_name || ""}`.trim() || `User #${user.id}`)}</strong>
              <div class="admin-row-meta">
                <span>${escapeHtml(user.email || "-")}</span>
                <span>${escapeHtml(user.group_name || "No group assigned")}</span>
              </div>
            </div>
          </div>
          <div class="inline-actions">
            <button class="ghost-button button-small" type="button" data-admin-action="assign-user-group" data-id="${user.id}">Assign group</button>
          </div>
        </article>
      `).join("")
    : emptyInline("No permission-managed users loaded.");

  els.adminPermissionsPanel.innerHTML = `
    <section class="panel">
      <div class="cart-row">
        <h4>Permission groups</h4>
        <button class="primary-button button-small" type="button" data-admin-action="create-group">Add group</button>
      </div>
      <div class="admin-list">${groupHtml}</div>
    </section>
    <section class="panel">
      <h4>Assign groups to users</h4>
      <div class="admin-list">${userHtml}</div>
    </section>
  `;
}

function renderAdminPayments() {
  const stats = state.admin.paymentsStats;
  const payments = state.admin.payments || [];
  const statsHtml = stats ? `
    <section class="summary-grid">
      <article class="summary-card"><small>Total Payments</small><strong>${escapeHtml(String(stats.total?.total ?? 0))}</strong></article>
      <article class="summary-card"><small>Successful Amount</small><strong>PKR ${(Number(stats.successful?.total_amount) || 0).toFixed(2)}</strong></article>
      <article class="summary-card"><small>Pending</small><strong>${escapeHtml(String(stats.pending?.total ?? 0))}</strong></article>
      <article class="summary-card"><small>Today</small><strong>PKR ${(Number(stats.today?.total) || 0).toFixed(2)}</strong></article>
    </section>
  ` : "";

  const listHtml = payments.length
    ? payments.map((payment) => `
        <article class="admin-row">
          <div class="admin-row-top">
            <div>
              <strong>Payment #${escapeHtml(String(payment.id))}</strong>
              <div class="admin-row-meta">
                <span>${escapeHtml(payment.payment_method || "-")}</span>
                <span>${escapeHtml(payment.status || "-")}</span>
                <span>${escapeHtml(payment.email || "-")}</span>
              </div>
            </div>
            <strong>PKR ${(Number(payment.amount) || 0).toFixed(2)}</strong>
          </div>
        </article>
      `).join("")
    : emptyState("No payments loaded or permission denied.");

  els.adminPaymentsPanel.innerHTML = `${statsHtml}<section class="panel"><h4>Recent payments</h4><div class="admin-list">${listHtml}</div></section>`;
}

function renderAdminWallets() {
  const stats = state.admin.walletsStats;
  const wallets = state.admin.wallets || [];
  const statsHtml = stats ? `
    <section class="summary-grid">
      <article class="summary-card"><small>Total Wallets</small><strong>${escapeHtml(String(stats.total_wallets ?? 0))}</strong></article>
      <article class="summary-card"><small>Total Balance</small><strong>PKR ${(Number(stats.total_balance) || 0).toFixed(2)}</strong></article>
      <article class="summary-card"><small>Active Wallets</small><strong>${escapeHtml(String(stats.active_wallets ?? 0))}</strong></article>
      <article class="summary-card"><small>Auto Recharge</small><strong>${escapeHtml(String(stats.with_auto_recharge ?? 0))}</strong></article>
    </section>
  ` : "";

  const listHtml = wallets.length
    ? wallets.map((wallet) => `
        <article class="admin-row">
          <div class="admin-row-top">
            <div>
              <strong>${escapeHtml(`${wallet.first_name || ""} ${wallet.last_name || ""}`.trim() || `Wallet #${wallet.id}`)}</strong>
              <div class="admin-row-meta">
                <span>${escapeHtml(wallet.email || "-")}</span>
                <span>Wallet ID ${escapeHtml(String(wallet.id))}</span>
              </div>
            </div>
            <strong>PKR ${(Number(wallet.balance) || 0).toFixed(2)}</strong>
          </div>
          ${isAdmin() ? `<div class="inline-actions"><button class="ghost-button button-small" type="button" data-admin-action="adjust-wallet" data-wallet-id="${wallet.id}">Adjust wallet</button></div>` : ""}
        </article>
      `).join("")
    : emptyState("No wallets loaded or permission denied.");

  els.adminWalletsPanel.innerHTML = `${statsHtml}<section class="panel"><h4>Wallet accounts</h4><div class="admin-list">${listHtml}</div></section>`;
}

function renderAdminFinancial() {
  const dashboard = state.admin.financialDashboard || {};
  const reports = Array.isArray(state.admin.financialReports) ? state.admin.financialReports.slice(0, 25) : [];

  const reportHtml = reports.length
    ? reports.map((report) => `
        <article class="admin-row">
          <div class="admin-row-top">
            <div>
              <strong>${escapeHtml(report.report_name || report.report_type || "Report")}</strong>
              <div class="admin-row-meta">
                <span>${escapeHtml(report.report_type || "-")}</span>
                <span>${report.generated_by_name ? escapeHtml(report.generated_by_name) : "System"}</span>
                <span>${formatDateTime(report.created_at)}</span>
              </div>
            </div>
            <span class="pill">${escapeHtml(report.status || "ready")}</span>
          </div>
        </article>
      `).join("")
    : emptyState("No financial reports loaded.");

  els.adminFinancialPanel.innerHTML = `
    <section class="summary-grid">
      <article class="summary-card"><small>Income</small><strong>PKR ${(Number(dashboard.income) || 0).toFixed(2)}</strong></article>
      <article class="summary-card"><small>Expense</small><strong>PKR ${(Number(dashboard.expense) || 0).toFixed(2)}</strong></article>
      <article class="summary-card"><small>Cash In Hand</small><strong>PKR ${(Number(dashboard.cashInHand) || 0).toFixed(2)}</strong></article>
      <article class="summary-card"><small>Store Balances</small><strong>PKR ${(Number(dashboard.totalStoreBalances || dashboard.storeBalances) || 0).toFixed(2)}</strong></article>
    </section>
    <section class="panel">
      <h4>Generated reports</h4>
      <div class="admin-list">${reportHtml}</div>
    </section>
  `;
}

async function handleLogin(form) {
  const formData = new FormData(form);
  const payload = {
    email: formData.get("email"),
    password: formData.get("password"),
  };

  try {
    const data = await postJson("/api/auth/login", payload);
    persistSession(data.token, data.user);
    form.reset();
    els.authModal.close();
    showStatus("Login successful.", "success");
    await loadAuthenticatedData();
    navigate(defaultWorkspaceRoute());
  } catch (error) {
    showStatus(error.message || "Login failed.", "error");
  }
}

async function handleRegister(form) {
  const formData = new FormData(form);
  const payload = {
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    address: formData.get("address"),
    password: formData.get("password"),
    userType: "customer",
  };

  try {
    const data = await postJson("/api/auth/register", payload);
    if (data.token && data.user) {
      persistSession(data.token, data.user);
      await loadAuthenticatedData();
    }

    form.reset();
    els.authModal.close();
    showStatus(
      data.requires_verification
        ? "Account created. Email verification may still be required."
        : "Registration successful.",
      "success"
    );
    navigate(defaultWorkspaceRoute());
  } catch (error) {
    showStatus(error.message || "Registration failed.", "error");
  }
}

async function handleGuestLogin() {
  try {
    const data = await fetchJson("/api/auth/guest-login", { method: "POST" });
    persistSession(data.token, data.user);
    showStatus("Guest session started.", "success");
    renderOrders();
    renderWallet();
    renderProfile();
    navigate("profile");
  } catch (error) {
    showStatus(error.message || "Guest login failed.", "error");
  }
}

async function handleCheckout(form) {
  if (!state.user || !state.authToken) {
    window.location.href = "/next/login";
    showStatus("Please login first to place an order.", "error");
    return;
  }

  if (isGuest()) {
    showStatus("Guest accounts must register before placing orders.", "error");
    navigate("profile");
    return;
  }

  if (!state.cart.length) {
    showStatus("Your cart is empty.", "error");
    return;
  }

  const formData = new FormData(form);
  const payload = {
    store_id: state.cart[0].storeId,
    items: state.cart.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
      size_id: item.sizeId,
      unit_id: item.unitId,
      variant_label: item.variantLabel || null,
    })),
    delivery_address: formData.get("deliveryAddress"),
    delivery_time: formData.get("deliveryTime"),
    payment_method: formData.get("paymentMethod"),
    special_instructions: "",
  };

  try {
    await postJson("/api/orders", payload);
    state.cart = [];
    persistCart();
    renderCart();
    await loadOrders();
    showStatus("Order placed successfully.", "success");
    navigate("orders");
  } catch (error) {
    showStatus(error.message || "Order failed.", "error");
  }
}

async function handleWalletTopup(form) {
  if (!state.user || isGuest()) {
    showStatus("Registered login is required for wallet top ups.", "error");
    return;
  }

  const formData = new FormData(form);
  const paymentMethod = String(formData.get("paymentMethod") || "card");
  const amount = Number(formData.get("amount") || 0);

  if (!Number.isFinite(amount) || amount <= 0) {
    showStatus("Enter a valid top up amount.", "error");
    return;
  }

  try {
    if (paymentMethod === "paypal") {
      showStatus("PayPal support is not ready in this alternative app yet.", "warning");
      return;
    }

    if (!state.stripe || !state.stripeCard) {
      throw new Error("Card payments are not available right now.");
    }

    const result = await state.stripe.createPaymentMethod({
      type: "card",
      card: state.stripeCard,
      billing_details: {
        name: `${state.user.first_name || ""} ${state.user.last_name || ""}`.trim() || "ServeNow User",
      },
    });

    if (result.error) {
      throw new Error(result.error.message || "Card validation failed.");
    }

    const cardToken = result.paymentMethod?.id || null;
    if (!cardToken) {
      throw new Error("Card token could not be created.");
    }

    await postJson("/api/wallet/topup", {
      amount,
      paymentMethod: "card",
      cardToken,
    });

    form.reset();
    state.stripeCard.clear();
    await loadWalletData();
    showStatus(`Wallet topped up by PKR ${amount.toFixed(2)}.`, "success");
  } catch (error) {
    showStatus(error.message || "Wallet top up failed.", "error");
  }
}

async function handleTransferSubmit(form) {
  if (!state.user || isGuest()) {
    showStatus("Registered login is required for transfers.", "error");
    return;
  }

  const formData = new FormData(form);
  const payload = {
    recipientId: Number(formData.get("recipientId")),
    amount: Number(formData.get("amount")),
    description: formData.get("description"),
  };

  try {
    await postJson("/api/wallet/transfers/send", payload);
    form.reset();
    await loadWalletData();
    showStatus("Transfer request created successfully.", "success");
  } catch (error) {
    showStatus(error.message || "Transfer failed.", "error");
  }
}

async function handleAutoRechargeSubmit(form) {
  if (!state.user || isGuest()) {
    showStatus("Registered login is required for auto recharge.", "error");
    return;
  }

  const formData = new FormData(form);
  const enabled = formData.get("enabled") === "on";
  const payload = {
    enabled,
    amount: enabled ? Number(formData.get("amount") || 0) : undefined,
    threshold: enabled ? Number(formData.get("threshold") || 0) : undefined,
  };

  try {
    await postJson("/api/wallet/auto-recharge", payload);
    await loadWalletData();
    showStatus("Auto recharge settings updated.", "success");
  } catch (error) {
    showStatus(error.message || "Auto recharge update failed.", "error");
  }
}

async function handlePasswordChange(form) {
  if (!state.user || isGuest()) {
    showStatus("Registered login is required to change password.", "error");
    return;
  }

  const formData = new FormData(form);
  const currentPassword = String(formData.get("currentPassword") || "");
  const newPassword = String(formData.get("newPassword") || "");
  const confirmNewPassword = String(formData.get("confirmNewPassword") || "");

  if (newPassword !== confirmNewPassword) {
    showStatus("New passwords do not match.", "error");
    return;
  }

  try {
    await postJson("/api/auth/change-password", { currentPassword, newPassword });
    form.reset();
    showStatus("Password updated successfully.", "success");
  } catch (error) {
    showStatus(error.message || "Password update failed.", "error");
  }
}

async function handleStoreStatusSubmit(form) {
  if (!isStoreOwner()) {
    showStatus("Store-owner access is required.", "error");
    return;
  }

  const formData = new FormData(form);
  try {
    await putJson("/api/stores/status-message", {
      status_message: String(formData.get("status_message") || ""),
      is_closed: formData.get("is_closed") === "on",
    });
    await loadStoreOwnerData();
    showStatus("Store status updated successfully.", "success");
  } catch (error) {
    showStatus(error.message || "Store status update failed.", "error");
  }
}

async function handleTransferAction(action, transferId) {
  if (!Number.isInteger(transferId) || transferId <= 0) {
    return;
  }

  const pathMap = {
    accept: `/api/wallet/transfers/${transferId}/accept`,
    reject: `/api/wallet/transfers/${transferId}/reject`,
    cancel: `/api/wallet/transfers/${transferId}/cancel`,
  };
  const path = pathMap[action];
  if (!path) {
    return;
  }

  const init = { method: "POST", headers: {} };
  if (action === "reject") {
    const reason = window.prompt("Optional rejection reason:", "") || "";
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify({ reason });
  }

  try {
    await fetchJson(path, withAuth(init));
    await loadWalletData();
    showStatus(`Transfer ${action}ed successfully.`, "success");
  } catch (error) {
    showStatus(error.message || "Transfer action failed.", "error");
  }
}

async function handleRiderAction(action, orderId) {
  try {
    if (action === "push-location") {
      if (!navigator.geolocation) {
        throw new Error("Geolocation is not supported in this browser.");
      }
      const position = await getCurrentPosition();
      const latitude = Number(position.coords.latitude);
      const longitude = Number(position.coords.longitude);
      await putJson("/api/orders/rider/location", { latitude, longitude });
      state.rider.locationLabel = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      showStatus("Rider location pushed successfully.", "success");
      await loadRiderData();
      return;
    }

    if (!Number.isInteger(orderId) || orderId <= 0) {
      return;
    }

    if (action === "deliver") {
      await fetchJson(`/api/orders/${orderId}/deliver`, withAuth({ method: "PUT" }));
      showStatus("Order marked as delivered.", "success");
      await loadRiderData();
      return;
    }

    if (action === "payment-status") {
      const status = window.prompt("Enter payment status: pending, paid, or failed", "paid");
      if (!status) return;
      await putJson(`/api/orders/${orderId}/payment-status`, { payment_status: status.trim().toLowerCase() });
      showStatus("Payment status updated.", "success");
      await loadRiderData();
    }
  } catch (error) {
    showStatus(error.message || "Rider action failed.", "error");
  }
}

async function handleStoreOwnerAction(action, orderId) {
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return;
  }

  try {
    if (action === "update-status") {
      const status = window.prompt(
        "Enter order status: confirmed, preparing, ready, ready_for_pickup, picked_up, out_for_delivery, delivered, or cancelled",
        "preparing"
      );
      if (!status) return;
      await putJson(`/api/orders/${orderId}/status`, { status: status.trim() });
      showStatus("Order status updated.", "success");
      await loadStoreOwnerData();
    }
  } catch (error) {
    showStatus(error.message || "Store-owner action failed.", "error");
  }
}

async function handleAdminAction(action, targetId) {
  try {
    if (action === "update-status") {
      if (!Number.isInteger(targetId) || targetId <= 0) return;
      const status = window.prompt(
        "Enter order status: pending, confirmed, preparing, ready, ready_for_pickup, picked_up, out_for_delivery, delivered, or cancelled",
        "confirmed"
      );
      if (!status) return;
      await putJson(`/api/orders/${targetId}/status`, { status: status.trim() });
      showStatus("Order status updated.", "success");
      await loadAdminData();
      return;
    }

    if (action === "assign-rider") {
      if (!Number.isInteger(targetId) || targetId <= 0) return;
      const riderList = (state.admin.availableRiders || [])
        .map((rider) => `${rider.id}: ${rider.first_name || ""} ${rider.last_name || ""}`.trim())
        .join("\n");
      const riderId = window.prompt(`Enter rider ID to assign.\n\nAvailable riders:\n${riderList}`, "");
      if (!riderId) return;
      await putJson(`/api/orders/${targetId}/assign-rider`, { rider_id: Number(riderId) });
      showStatus("Rider assigned successfully.", "success");
      await loadAdminData();
      return;
    }

    if (action === "adjust-wallet") {
      if (!isAdmin() || !Number.isInteger(targetId) || targetId <= 0) return;
      const amount = window.prompt("Enter wallet adjustment amount. Use negative values to debit.", "0");
      if (!amount) return;
      const reason = window.prompt("Enter adjustment reason.", "Manual adjustment");
      if (!reason) return;
      await postJson(`/api/admin/wallets/${targetId}/adjust`, {
        amount: Number(amount),
        reason,
      });
      showStatus("Wallet adjusted successfully.", "success");
      await loadAdminData();
      return;
    }

    if (action === "create-category") {
      const name = window.prompt("Enter category name:", "");
      if (!name) return;
      const description = window.prompt("Enter category description:", "");
      if (!description) return;
      await postJson("/api/categories", { name, description });
      showStatus("Category created successfully.", "success");
      await loadAdminData();
      return;
    }

    if (action === "edit-category") {
      const category = state.admin.categories.find((entry) => Number(entry.id) === targetId);
      if (!category) return;
      const name = window.prompt("Update category name:", category.name || "");
      if (!name) return;
      const description = window.prompt("Update category description:", category.description || "");
      const active = window.prompt("Set active? yes/no", category.is_active ? "yes" : "no");
      await putJson(`/api/categories/${targetId}`, {
        name,
        description,
        is_active: String(active || "").trim().toLowerCase() === "yes",
      });
      showStatus("Category updated successfully.", "success");
      await loadAdminData();
      return;
    }

    if (action === "delete-category") {
      const category = state.admin.categories.find((entry) => Number(entry.id) === targetId);
      if (!category) return;
      const confirmDelete = window.prompt(`Type DELETE to remove category "${category.name}"`, "");
      if (confirmDelete !== "DELETE") return;
      await putJson(`/api/categories/${targetId}`, { is_active: false });
      showStatus("Category marked inactive.", "success");
      await loadAdminData();
      return;
    }

    if (action === "create-unit") {
      const name = window.prompt("Enter unit name:", "");
      if (!name) return;
      const abbreviation = window.prompt("Enter unit abbreviation:", "");
      const multiplier = window.prompt("Enter unit multiplier:", "1");
      await postJson("/api/units", {
        name,
        abbreviation,
        multiplier: Number(multiplier || 1),
      });
      showStatus("Unit created successfully.", "success");
      await loadAdminData();
      return;
    }

    if (action === "edit-unit") {
      const unit = state.admin.units.find((entry) => Number(entry.id) === targetId);
      if (!unit) return;
      const name = window.prompt("Update unit name:", unit.name || "");
      if (!name) return;
      const abbreviation = window.prompt("Update abbreviation:", unit.abbreviation || "");
      const multiplier = window.prompt("Update multiplier:", String(unit.multiplier ?? 1));
      await putJson(`/api/units/${targetId}`, {
        name,
        abbreviation,
        multiplier: Number(multiplier || 1),
      });
      showStatus("Unit updated successfully.", "success");
      await loadAdminData();
      return;
    }

    if (action === "delete-unit") {
      const confirmDelete = window.prompt("Type DELETE to remove this unit.", "");
      if (confirmDelete !== "DELETE") return;
      await apiJsonDelete(`/api/units/${targetId}`);
      showStatus("Unit deleted successfully.", "success");
      await loadAdminData();
      return;
    }

    if (action === "create-size") {
      const label = window.prompt("Enter size label:", "");
      if (!label) return;
      const description = window.prompt("Enter size description:", "");
      await postJson("/api/sizes", { label, description });
      showStatus("Size created successfully.", "success");
      await loadAdminData();
      return;
    }

    if (action === "edit-size") {
      const size = state.admin.sizes.find((entry) => Number(entry.id) === targetId);
      if (!size) return;
      const label = window.prompt("Update size label:", size.label || "");
      if (!label) return;
      const description = window.prompt("Update size description:", size.description || "");
      await putJson(`/api/sizes/${targetId}`, { label, description });
      showStatus("Size updated successfully.", "success");
      await loadAdminData();
      return;
    }

    if (action === "delete-size") {
      const confirmDelete = window.prompt("Type DELETE to remove this size.", "");
      if (confirmDelete !== "DELETE") return;
      await apiJsonDelete(`/api/sizes/${targetId}`);
      showStatus("Size deleted successfully.", "success");
      await loadAdminData();
      return;
    }

    if (action === "create-group") {
      const name = window.prompt("Enter permission group name:", "");
      if (!name) return;
      const description = window.prompt("Enter group description:", "");
      await postJson("/api/permissions/groups", { name, description });
      showStatus("Permission group created.", "success");
      await loadAdminData();
      return;
    }

    if (action === "edit-group") {
      const group = state.admin.permissionGroups.find((entry) => Number(entry.id) === targetId);
      if (!group) return;
      const name = window.prompt("Update group name:", group.name || "");
      if (!name) return;
      const description = window.prompt("Update group description:", group.description || "");
      await putJson(`/api/permissions/groups/${targetId}`, { name, description });
      showStatus("Permission group updated.", "success");
      await loadAdminData();
      return;
    }

    if (action === "delete-group") {
      const confirmDelete = window.prompt("Type DELETE to remove this group.", "");
      if (confirmDelete !== "DELETE") return;
      await apiJsonDelete(`/api/permissions/groups/${targetId}`);
      showStatus("Permission group deleted.", "success");
      await loadAdminData();
      return;
    }

    if (action === "assign-user-group") {
      const user = state.admin.permissionUsers.find((entry) => Number(entry.id) === targetId);
      if (!user) return;
      const groupsList = state.admin.permissionGroups
        .map((group) => `${group.id}: ${group.name}`)
        .join("\n");
      const input = window.prompt(
        `Enter group ID for ${user.first_name || ""} ${user.last_name || ""}.\nLeave blank or 0 to clear.\n\nAvailable groups:\n${groupsList}`,
        user.group_id ? String(user.group_id) : ""
      );
      if (input === null) return;
      const groupId = Number(input || 0);
      await postJson(`/api/permissions/user/${targetId}/group`, {
        group_id: Number.isInteger(groupId) && groupId > 0 ? groupId : null,
      });
      showStatus("User group assignment updated.", "success");
      await loadAdminData();
    }
  } catch (error) {
    showStatus(error.message || "Admin action failed.", "error");
  }
}

function persistSession(token, user) {
  state.authToken = token || "";
  state.user = user || null;
  if (token) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  }
  if (user) {
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  }
  renderProfile();
  renderRiderViews();
  renderStoreOwnerViews();
  renderAdminViews();
  updateHeader();
}

function logout(showMessage = true) {
  state.authToken = "";
  state.user = null;
  state.orders = [];
  state.support = null;
  state.wallet = null;
  state.walletTransactions = [];
  state.sentTransfers = [];
  state.receivedTransfers = [];
  state.walletAutoRecharge = null;
  state.rider = {
    profile: null,
    wallet: null,
    stats: null,
    assignedDeliveries: [],
    completedDeliveries: [],
    financial: null,
    locationLabel: "",
  };
  state.storeOwner = {
    stats: null,
    orders: [],
    financial: null,
    statusMessage: null,
    banks: [],
    campaigns: [],
  };
  state.admin = {
    visitorStats: null,
    recentActivity: null,
    orders: [],
    stores: [],
    users: [],
    products: [],
    riders: [],
    categories: [],
    units: [],
    sizes: [],
    permissionGroups: [],
    permissionUsers: [],
    availableRiders: [],
    paymentsStats: null,
    payments: [],
    walletsStats: null,
    wallets: [],
    financialDashboard: null,
    financialReports: [],
  };
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  renderOrders();
  renderWallet();
  renderProfile();
  renderRiderViews();
  renderStoreOwnerViews();
  renderAdminViews();
  renderCart();
  updateHeader();
  if (showMessage) {
    showStatus("You have been logged out.", "success");
  }
}

function updateHeader() {
  updateCartBadges();
  renderRoleVisibility();
  els.authActionBtn.textContent = state.user ? "Open Workspace" : "Login";
  els.heroAuthState.textContent = state.user
    ? String(state.user.first_name || state.user.email || "Active")
    : "Guest";
}

function renderRoleVisibility() {
  const riderVisible = isRider();
  const storeOwnerVisible = isStoreOwner();
  const adminVisible = isAdminLike();
  els.riderNav?.classList.toggle("hidden", !riderVisible);
  els.riderNavLabel?.classList.toggle("hidden", !riderVisible);
  els.storeOwnerNav?.classList.toggle("hidden", !storeOwnerVisible);
  els.storeOwnerNavLabel?.classList.toggle("hidden", !storeOwnerVisible);
  els.adminNav?.classList.toggle("hidden", !adminVisible);
  els.adminNavLabel?.classList.toggle("hidden", !adminVisible);
}

function updateCartBadges() {
  const count = state.cart.reduce((sum, item) => sum + Number(item.quantity), 0);
  els.sidebarCartCount.textContent = String(count);
  els.heroCartCount.textContent = String(count);
}

function addProductFromButton(button) {
  const payload = parseJson(button.dataset.addProduct);
  if (!payload) {
    return;
  }

  const key = [payload.productId, payload.storeId, payload.sizeId ?? "", payload.unitId ?? ""].join(":");
  const existing = state.cart.find((item) => item.key === key);
  if (existing) {
    existing.quantity += 1;
  } else {
    state.cart.push({
      key,
      productId: payload.productId,
      name: payload.name,
      storeId: payload.storeId,
      storeName: payload.storeName,
      price: Number(payload.price) || 0,
      quantity: 1,
      sizeId: payload.sizeId ?? null,
      unitId: payload.unitId ?? null,
      variantLabel: payload.variantLabel || "",
    });
  }

  persistCart();
  renderCart();
  showStatus(`${payload.name} added to cart.`, "success");
}

function mutateCartItem(key, action) {
  const item = state.cart.find((entry) => entry.key === key);
  if (!item) {
    return;
  }

  if (action === "increase") item.quantity += 1;
  if (action === "decrease") item.quantity -= 1;
  if (action === "remove") item.quantity = 0;

  state.cart = state.cart.filter((entry) => entry.quantity > 0);
  persistCart();
  renderCart();
}

function calculateCartSummary() {
  const subtotal = state.cart.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);
  const storeIds = new Set(state.cart.map((item) => item.storeId).filter(Boolean));
  const storeCount = storeIds.size || (state.cart.length ? 1 : 0);
  const delivery = storeCount
    ? state.deliveryConfig.base_fee + Math.max(0, storeCount - 1) * state.deliveryConfig.additional_per_store
    : 0;

  return {
    subtotal,
    delivery,
    total: subtotal + delivery,
  };
}

function openAuthModal(tab) {
  setAuthTab(tab);
  els.authModal.showModal();
}

function setAuthTab(tab) {
  const selected = tab === "register" ? "register" : "login";
  els.authModalTitle.textContent = selected === "register" ? "Register" : "Login";
  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.authTab === selected);
  });
  document.querySelectorAll(".auth-form").forEach((form) => {
    form.classList.toggle("active", form.id === `${selected}Form`);
  });
}

function showStatus(message, type = "success") {
  els.statusBanner.textContent = message;
  els.statusBanner.className = `status-banner ${type}`;
  els.statusBanner.classList.remove("hidden");
  window.clearTimeout(showStatus.timer);
  showStatus.timer = window.setTimeout(() => {
    els.statusBanner.classList.add("hidden");
  }, 4000);
}

function storeCardTemplate(store) {
  const image = normalizeImage(store.image_url || store.cover_image);
  return `
    <article class="store-card">
      <div class="store-thumb">
        <img src="${image}" alt="${escapeHtml(store.name || "Store")}" />
      </div>
      <div class="stack">
        <div class="cart-row">
          <strong>${escapeHtml(store.name || "Store")}</strong>
          <span class="pill ${store.is_open ? "" : "warning"}">${store.is_open ? "Open" : "Closed"}</span>
        </div>
        <div class="store-meta">
          <span>${escapeHtml(store.location || "Location unavailable")}</span>
          <span>Rating ${(Number(store.rating) || 0).toFixed(1)}</span>
          <span>${escapeHtml(store.delivery_time || "30-45 min")}</span>
        </div>
        <button class="primary-button" type="button" data-store-id="${store.id}">
          Open store
        </button>
      </div>
    </article>
  `;
}

function productCardTemplate(product, storeId, storeName) {
  const image = normalizeImage(product.image_url || product.image);
  const variants = Array.isArray(product.size_variants) ? product.size_variants : [];
  const variant = variants[0] || null;
  const priceSource = variant || product;
  const price = effectivePrice(priceSource);
  const variantLabel = variant ? [variant.size_label, variant.unit_name].filter(Boolean).join(" ") : "";
  const payload = escapeAttribute(JSON.stringify({
    productId: product.id,
    name: product.name,
    storeId,
    storeName,
    price,
    sizeId: variant?.size_id ?? null,
    unitId: variant?.unit_id ?? null,
    variantLabel,
  }));

  return `
    <article class="product-card">
      <div class="product-thumb">
        <img src="${image}" alt="${escapeHtml(product.name || "Product")}" />
      </div>
      <div class="stack">
        <strong>${escapeHtml(product.name || "Product")}</strong>
        <div class="product-meta">
          ${variantLabel ? `<span>${escapeHtml(variantLabel)}</span>` : ""}
          <span>Stock ${Number(product.stock_quantity) || 0}</span>
        </div>
        <div class="cart-row">
          <strong>PKR ${price.toFixed(2)}</strong>
          <button class="primary-button" type="button" data-add-product="${payload}">Add</button>
        </div>
      </div>
    </article>
  `;
}

function orderCardTemplate(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsHtml = items.length
    ? items.map((item) => `
        <div class="list-row">
          <div>
            <strong>${escapeHtml(item.product_name || item.name || "Item")}</strong>
            <small>${item.variant_label ? `${escapeHtml(item.variant_label)} | ` : ""}Qty ${Number(item.quantity) || 0}</small>
          </div>
          <strong>PKR ${(Number(item.price) || 0).toFixed(2)}</strong>
        </div>
      `).join("")
    : emptyInline("No items found.");

  return `
    <article class="panel">
      <div class="cart-row">
        <div>
          <h4>${escapeHtml(order.order_number || `Order #${order.id}`)}</h4>
          <div class="store-meta">
            <span>${escapeHtml(order.store_name || "Multiple Stores")}</span>
            <span>${formatDateTime(order.created_at)}</span>
          </div>
        </div>
        <div class="stack stack-tight align-end">
          <span class="pill">${escapeHtml(order.status || "pending")}</span>
          <strong>PKR ${(Number(order.total_amount) || 0).toFixed(2)}</strong>
        </div>
      </div>
      <div class="summary-grid">
        <article class="summary-card"><small>Payment</small><strong>${escapeHtml(order.payment_method || "-")}</strong></article>
        <article class="summary-card"><small>Delivery fee</small><strong>PKR ${(Number(order.delivery_fee) || 0).toFixed(2)}</strong></article>
        <article class="summary-card"><small>Address</small><strong>${escapeHtml(order.delivery_address || "-")}</strong></article>
        <article class="summary-card"><small>Rider</small><strong>${escapeHtml(buildRiderName(order) || "Not assigned yet")}</strong></article>
      </div>
      <div class="list-stack">${itemsHtml}</div>
    </article>
  `;
}

function riderDeliveryCardTemplate(delivery, active) {
  return `
    <article class="admin-row">
      <div class="admin-row-top">
        <div>
          <strong>${escapeHtml(delivery.order_number || `Order #${delivery.id}`)}</strong>
          <div class="admin-row-meta">
            <span>${escapeHtml(delivery.store_name || "Multiple Stores")}</span>
            <span>${escapeHtml(delivery.status || "-")}</span>
            <span>${escapeHtml(delivery.payment_status || "-")}</span>
            <span>${formatDateTime(delivery.created_at)}</span>
          </div>
        </div>
        <strong>PKR ${(Number(delivery.total_amount) || 0).toFixed(2)}</strong>
      </div>
      <div class="inline-actions">
        ${active ? `<button class="ghost-button button-small" type="button" data-rider-action="payment-status" data-order-id="${delivery.id}">Update payment</button>` : ""}
        ${active ? `<button class="primary-button button-small" type="button" data-rider-action="deliver" data-order-id="${delivery.id}">Mark delivered</button>` : ""}
      </div>
    </article>
  `;
}

function storeOwnerOrderCardTemplate(order) {
  return `
    <article class="admin-row">
      <div class="admin-row-top">
        <div>
          <strong>${escapeHtml(order.order_number || `Order #${order.id}`)}</strong>
          <div class="admin-row-meta">
            <span>${escapeHtml(order.first_name || "")} ${escapeHtml(order.last_name || "")}</span>
            <span>${escapeHtml(order.phone || "-")}</span>
            <span>${escapeHtml(order.status || "-")}</span>
          </div>
        </div>
        <strong>PKR ${(Number(order.total_amount) || 0).toFixed(2)}</strong>
      </div>
      <div class="inline-actions">
        <button class="ghost-button button-small" type="button" data-store-action="update-status" data-order-id="${order.id}">Update order status</button>
      </div>
    </article>
  `;
}

function transferRowTemplate(transfer, kind) {
  const counterparty = kind === "sent"
    ? `${transfer.recipient_name || ""}${transfer.recipient_email ? ` | ${transfer.recipient_email}` : ""}`
    : `${transfer.sender_name || ""}${transfer.sender_email ? ` | ${transfer.sender_email}` : ""}`;
  const label = kind === "sent" ? "To" : "From";
  return `
    <div class="list-row">
      <div>
        <strong>${label}: ${escapeHtml(counterparty.trim() || "User")}</strong>
        <small>${formatDateTime(transfer.created_at)} | ${escapeHtml(transfer.status || "pending")}</small>
      </div>
      <div class="stack stack-tight align-end">
        <strong>PKR ${(Number(transfer.amount) || 0).toFixed(2)}</strong>
        ${transferActionButtons(transfer, kind)}
      </div>
    </div>
  `;
}

function transferActionButtons(transfer, kind) {
  const status = String(transfer?.status || "").toLowerCase();
  if (status !== "pending") {
    return "";
  }

  if (kind === "received") {
    return `
      <div class="inline-actions">
        <button class="ghost-button button-small" type="button" data-transfer-action="accept" data-transfer-id="${transfer.id}">Accept</button>
        <button class="ghost-button button-small" type="button" data-transfer-action="reject" data-transfer-id="${transfer.id}">Reject</button>
      </div>
    `;
  }

  return `
    <button class="ghost-button button-small" type="button" data-transfer-action="cancel" data-transfer-id="${transfer.id}">
      Cancel
    </button>
  `;
}

function buildRiderName(order) {
  const first = String(order?.rider_first_name || "").trim();
  const last = String(order?.rider_last_name || "").trim();
  return `${first} ${last}`.trim();
}

function effectivePrice(source) {
  const base = Number(source?.price) || 0;
  const promo = source?.promotional_price === null || source?.promotional_price === undefined
    ? null
    : Number(source.promotional_price);
  return Number.isFinite(promo) && promo >= 0 && promo < base ? promo : base;
}

function initStripe(publicKey) {
  if (!publicKey || typeof window.Stripe !== "function" || state.stripe) {
    return;
  }

  try {
    state.stripe = window.Stripe(publicKey);
    state.stripeElements = state.stripe.elements();
    state.stripeCard = state.stripeElements.create("card");
  } catch (_) {
    state.stripe = null;
    state.stripeElements = null;
    state.stripeCard = null;
  }
}

function mountStripeCardElement() {
  if (!state.stripeCard) {
    return;
  }
  const host = document.getElementById("walletCardElement");
  if (!host || host.dataset.mounted === "true") {
    return;
  }

  state.stripeCard.mount("#walletCardElement");
  host.dataset.mounted = "true";
}

function normalizeImage(raw) {
  const fallback = "/images/servenow_brand_logo.png";
  const value = String(raw || "").trim().replace(/\\/g, "/");
  if (!value) return fallback;
  if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return value;
  if (value.startsWith("/")) return value;
  return `/${value.replace(/^\/+/, "")}`;
}

function apiFetch(path, init = {}) {
  return fetch(`${API_BASE}${path}`, withAuth(init));
}

function withAuth(init = {}) {
  const headers = new Headers(init.headers || {});
  if (state.authToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${state.authToken}`);
  }
  return { ...init, headers };
}

async function publicJson(path) {
  return parseResponse(await fetch(`${API_BASE}${path}`));
}

async function apiJson(path) {
  return parseResponse(await apiFetch(path));
}

async function postJson(path, body) {
  return parseResponse(await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

async function putJson(path, body) {
  return parseResponse(await apiFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

async function apiJsonDelete(path) {
  return parseResponse(await apiFetch(path, {
    method: "DELETE",
  }));
}

async function fetchJson(path, init) {
  return parseResponse(await fetch(`${API_BASE}${path}`, init));
}

async function parseResponse(response) {
  let data = null;
  try {
    data = await response.json();
  } catch (_) {
    data = null;
  }
  if (!response.ok || data?.success === false) {
    throw new Error(data?.message || `Request failed with status ${response.status}`);
  }
  return data || {};
}

function persistCart() {
  localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
  updateHeader();
}

function loadCart() {
  const parsed = parseJson(localStorage.getItem(CART_KEY));
  return Array.isArray(parsed) ? parsed : [];
}

function parseJson(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch (_) {
    return null;
  }
}

function defaultWorkspaceRoute() {
  if (isAdminLike()) return "admin-dashboard";
  if (isRider()) return "rider-dashboard";
  if (isStoreOwner()) return "store-dashboard";
  return "profile";
}

function isGuest() {
  return !!(state.user && (state.user.user_type === "guest" || state.user.is_guest));
}

function isRider() {
  return !!(state.user && state.user.user_type === "rider");
}

function isStoreOwner() {
  return !!(state.user && state.user.user_type === "store_owner");
}

function isAdminLike() {
  return !!(state.user && (state.user.user_type === "admin" || state.user.user_type === "standard_user"));
}

function isAdmin() {
  return !!(state.user && state.user.user_type === "admin");
}

function isCustomerLike() {
  return !!(state.user && (state.user.user_type === "customer" || isAdminLike() || isStoreOwner()));
}

function loginPrompt(message) {
  return `
    <div class="panel">
      <h4>Login required</h4>
      <p>${escapeHtml(message)}</p>
      <a class="primary-button" href="/next/login" style="display:inline-flex;align-items:center;justify-content:center;text-decoration:none;">Open login</a>
    </div>
  `;
}

function guestPrompt(message) {
  return `
    <div class="panel">
      <h4>Access note</h4>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function emptyState(message) {
  return `<div class="empty-state"><p>${escapeHtml(message)}</p></div>`;
}

function emptyInline(message) {
  return `<p class="muted-copy">${escapeHtml(message)}</p>`;
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 10000,
    });
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
