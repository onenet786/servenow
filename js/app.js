// API Base URL - dynamically determine based on current location
const API_BASE = window.location.protocol + "//" + window.location.host;
const SERVICE_UNAVAILABLE_MESSAGE =
  "ServeNow is temporarily unavailable. The site is under maintenance. Please try again shortly.";

function getServiceUnavailableMessage() {
  return SERVICE_UNAVAILABLE_MESSAGE;
}

function sanitizeUserFacingErrorMessage(message, fallback = SERVICE_UNAVAILABLE_MESSAGE) {
  const raw = String(message || "").trim();
  if (!raw) return fallback;

  const lower = raw.toLowerCase();
  const connectivityHints = [
    "failed to fetch",
    "networkerror",
    "network request failed",
    "fetch failed",
    "load failed",
    "socketexception",
    "clientexception",
    "connection refused",
    "connection reset",
    "connection aborted",
    "timed out",
    "timeout",
    "err_connection",
    "err_name_not_resolved",
    "err_internet_disconnected",
    "xhr failed",
    "xmlhttprequest",
  ];

  if (connectivityHints.some((hint) => lower.includes(hint))) {
    return fallback;
  }

  if (/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/.test(raw)) {
    return fallback;
  }

  return raw;
}

window.getServiceUnavailableMessage = getServiceUnavailableMessage;
window.sanitizeUserFacingErrorMessage = sanitizeUserFacingErrorMessage;

// Enforce session-only auth persistence (no browser relaunch auto-login).
(() => {
  const AUTH_KEYS = new Set(["serveNowToken", "serveNowUser"]);
  let localGet;
  let localSet;
  let localRemove;

  try {
    localGet = localStorage.getItem.bind(localStorage);
    localSet = localStorage.setItem.bind(localStorage);
    localRemove = localStorage.removeItem.bind(localStorage);

    // Migrate legacy persisted auth to session storage once, then clear local copy.
    AUTH_KEYS.forEach((key) => {
      const legacyVal = localGet(key);
      if (legacyVal !== null && sessionStorage.getItem(key) === null) {
        sessionStorage.setItem(key, legacyVal);
      }
      localRemove(key);
    });

    // Redirect auth key operations through sessionStorage.
    localStorage.getItem = function (key) {
      if (AUTH_KEYS.has(String(key))) return sessionStorage.getItem(String(key));
      return localGet(key);
    };
    localStorage.setItem = function (key, value) {
      if (AUTH_KEYS.has(String(key))) {
        sessionStorage.setItem(String(key), String(value));
        return;
      }
      return localSet(key, value);
    };
    localStorage.removeItem = function (key) {
      if (AUTH_KEYS.has(String(key))) {
        sessionStorage.removeItem(String(key));
        return;
      }
      return localRemove(key);
    };
  } catch (_) {
    // Storage may be restricted; leave default behavior.
  }
})();

// Global fetch wrapper: automatically attach Authorization header when a token exists
(() => {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      const token = localStorage.getItem("serveNowToken");
      if (!token) return nativeFetch(input, init);

      // If caller passed a Request object, clone it and add the header safely
      if (typeof Request !== "undefined" && input instanceof Request) {
        const newHeaders = new Headers(input.headers || {});
        if (!newHeaders.has("Authorization"))
          newHeaders.set("Authorization", `Bearer ${token}`);
        const reqInit = {
          method: input.method,
          headers: newHeaders,
          body: input.body,
          mode: input.mode,
          credentials: input.credentials,
          cache: input.cache,
          redirect: input.redirect,
          referrer: input.referrer,
          referrerPolicy: input.referrerPolicy,
          integrity: input.integrity,
          keepalive: input.keepalive,
          signal: input.signal,
        };
        // If an explicit init was also provided, merge it (init takes precedence)
        const mergedInit = Object.assign({}, reqInit, init || {});
        return nativeFetch(new Request(input.url, mergedInit));
      }

      // Otherwise handle (input, init) style
      init = init || {};
      init.headers = init.headers || {};

      if (init.headers instanceof Headers) {
        if (!init.headers.has("Authorization"))
          init.headers.set("Authorization", `Bearer ${token}`);
      } else if (Array.isArray(init.headers)) {
        const h = new Headers(init.headers);
        if (!h.has("Authorization")) h.set("Authorization", `Bearer ${token}`);
        init.headers = h;
      } else {
        if (!init.headers["Authorization"] && !init.headers["authorization"]) {
          init.headers["Authorization"] = `Bearer ${token}`;
        }
      }
    } catch (e) {
      // ignore errors accessing localStorage or headers
    }
    return nativeFetch(input, init).then(response => {
        if (!response.ok && response.status === 404) {
            console.warn(`[fetch] 404 Not Found: ${input.url || input}`);
        }
        return response;
    }).catch((error) => {
        if (error && error.name === "AbortError") {
          throw error;
        }
        const safeMessage = sanitizeUserFacingErrorMessage(
          error && error.message ? error.message : String(error)
        );
        const wrapped = new Error(safeMessage);
        wrapped.isServiceUnavailable = safeMessage === SERVICE_UNAVAILABLE_MESSAGE;
        wrapped.originalError = error;
        throw wrapped;
    });
  };
})();

// Toggle Mobile Menu
function toggleMobileMenu() {
  const navUl = document.querySelector("nav ul");
  const menuToggle = document.querySelector(".menu-toggle");
  navUl.classList.toggle("active");
  menuToggle.classList.toggle("active");
}

// Toast Notification System
function showToast(title, message, type = "info", duration = 2000) {
  try {
    const d = Number(duration);
    if (!isFinite(d) || d < 500) {
      duration = 2000;
    } else {
      duration = d;
    }
  } catch (_) {
    duration = 2000;
  }
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toast-container";
    container.style.pointerEvents = "none";
    document.body.appendChild(container);
  }

  const toastId = "toast-" + Date.now();
  const toast = document.createElement("div");
  toast.id = toastId;
  toast.className = `toast ${type} slideIn`;
  toast.innerHTML = `
        <div class="toast-icon">
            ${
              type === "success"
                ? "✓"
                : type === "error"
                ? "✕"
                : type === "warning"
                ? "!"
                : "ℹ"
            }
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
      elem.classList.remove("slideIn");
      elem.classList.add("slideOut");
      setTimeout(() => elem.remove(), 300);
    }
  }, duration);
}

function showSuccess(title, message, duration = 2000) {
  showToast(title, message, "success", duration);
}

function showError(title, message, duration = 2000) {
  showToast(title, sanitizeUserFacingErrorMessage(message), "error", duration);
}

function showWarning(title, message, duration = 2000) {
  showToast(title, message, "warning", duration);
}

function showInfo(title, message, duration = 2000) {
  showToast(title, message, "info", duration);
}

function escapeHtmlPublic(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

window.__globalDeliveryStatus = null;
window.__livePromotions = null;
window.__globalDeliveryRefreshTimer = null;
window.__globalDeliveryPollTimer = null;

function buildDeliveryReasonWithWindow(status) {
  if (!status) return "";
  const reason = String(status.status_message || "").trim();
  const when = formatDeliveryWindow(status.start_at, status.end_at);
  if (reason && when) return `${reason} (${when})`;
  if (reason) return reason;
  if (when) return `Delivery update: ${when}`;
  return "";
}

function getOrderingGuardState() {
  const s = window.__globalDeliveryStatus || null;
  const blocked = !!(s && s.is_window_active && s.block_ordering_active);
  return {
    blocked,
    message:
      buildDeliveryReasonWithWindow(s) ||
      "Delivery is temporarily unavailable in this time window.",
  };
}

window.getOrderingGuardState = getOrderingGuardState;

function scheduleGlobalDeliveryAutoRefresh(status) {
  if (window.__globalDeliveryRefreshTimer) {
    clearTimeout(window.__globalDeliveryRefreshTimer);
    window.__globalDeliveryRefreshTimer = null;
  }
  if (!status || !status.end_at) return;
  const endMs = new Date(status.end_at).getTime();
  if (!Number.isFinite(endMs)) return;
  const nowMs = Date.now();
  const delay = Math.max(1000, endMs - nowMs + 1000);
  window.__globalDeliveryRefreshTimer = setTimeout(() => {
    loadGlobalDeliveryWidget(true);
  }, delay);
}

// Authentication state
let currentUser = null;
let authToken = localStorage.getItem("serveNowToken");

function updateNavigation() {
  const token = localStorage.getItem("serveNowToken");
  const userStr = localStorage.getItem("serveNowUser");
  const navUl = document.querySelector("nav ul");
  const welcomeName = document.getElementById("welcomeName");
  
  if (!navUl) return;

  const currentPage = window.location.pathname.toLowerCase();
  const isLoginPage = currentPage.includes("login.html");
  const isRegisterPage = currentPage.includes("register.html");

  if (token && userStr) {
    let user;
    try {
      user = JSON.parse(userStr);
    } catch (e) {
      console.error("Error parsing user data:", e);
      return;
    }

    // Role-based redirects
    if (user.user_type === "rider") {
      if (currentPage.includes("admin.html") || isLoginPage || isRegisterPage) {
        window.location.href = "rider.html";
        return;
      }
    } else if (user.user_type === "customer" || user.user_type === "store_owner") {
      if (currentPage.includes("admin.html") || currentPage.includes("rider.html") || isLoginPage || isRegisterPage) {
        window.location.href = "index.html";
        return;
      }
    } else if (user.user_type === "admin" || user.user_type === "standard_user") {
      if (isLoginPage || isRegisterPage) {
        window.location.href = "admin.html";
        return;
      }
    }

    // Update Sidebar Navigation
    // For riders, we might want a different set of links
    if (user.user_type === "rider") {
        navUl.innerHTML = `
            <li class="nav-dynamic">Welcome ${user.first_name}</li>
            <li><a href="rider.html"><i class="fas fa-motorcycle"></i> Dashboard</a></li>
            <li><a href="orders.html"><i class="fas fa-box"></i> Orders</a></li>
            <li><a href="profile.html"><i class="fas fa-user"></i> Profile</a></li>
            <li class="nav-dynamic"><a href="#" onclick="showChangePasswordModal(); return false;"><i class="fas fa-key"></i> Change Password</a></li>
            <li class="nav-dynamic nav-logout"><a href="#" onclick="logout(); return false;"><i class="fas fa-sign-out-alt"></i> Logout</a></li>
        `;
    } else {
        // Standard user navigation
        // We want to keep the existing links but maybe toggle login/register
        const links = Array.from(navUl.querySelectorAll('li'));
        links.forEach(li => {
            const a = li.querySelector('a');
            if (a) {
                const href = a.getAttribute('href');
                if (href === 'login.html' || href === 'register.html') {
                    li.style.display = 'none';
                } else {
                    li.style.display = 'block';
                }
            }
        });

        // Add Profile and Logout if not present
        if (!navUl.querySelector('a[href="profile.html"]')) {
            const profileLi = document.createElement('li');
            profileLi.className = 'nav-dynamic';
            profileLi.innerHTML = `<a href="profile.html"><i class="fas fa-user"></i> Profile</a>`;
            navUl.appendChild(profileLi);
        }

        // Add Change Password if not present
        if (!navUl.querySelector('a[onclick*="showChangePasswordModal"]')) {
            const pwdLi = document.createElement('li');
            pwdLi.className = 'nav-dynamic';
            pwdLi.innerHTML = `<a href="#" onclick="showChangePasswordModal(); return false;"><i class="fas fa-key"></i> Change Password</a>`;
            navUl.appendChild(pwdLi);
        }
        
        if (!navUl.querySelector('.nav-logout')) {
            const logoutLi = document.createElement('li');
            logoutLi.className = 'nav-dynamic nav-logout';
            logoutLi.innerHTML = `<a href="#" onclick="logout(); return false;"><i class="fas fa-sign-out-alt"></i> Logout</a>`;
            navUl.appendChild(logoutLi);
        }
    }

    // Update Header Welcome
    if (welcomeName) {
      welcomeName.textContent = `Welcome, ${user.first_name || 'User'}`;
    }
    
    // Header Logout Button
    const userProfileDiv = document.querySelector('.user-profile');
    if (userProfileDiv && !document.getElementById('headerLogoutBtn')) {
        const logoutBtn = document.createElement('button');
        logoutBtn.id = 'headerLogoutBtn';
        logoutBtn.className = 'btn btn-small';
        logoutBtn.style.marginLeft = '1rem';
        logoutBtn.style.color = 'var(--danger)';
        logoutBtn.title = 'Logout';
        logoutBtn.setAttribute('aria-label', 'Logout');
        logoutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i>';
        logoutBtn.onclick = logout;
        userProfileDiv.appendChild(logoutBtn);
    }

  } else {
    // Not logged in
    const links = Array.from(navUl.querySelectorAll('li'));
    links.forEach(li => {
        const a = li.querySelector('a');
        if (a) {
            const href = a.getAttribute('href');
            if (href === 'login.html' || href === 'register.html') {
                li.style.display = 'block';
            }
            // Hide protected links if necessary, or just leave them (server will handle)
        }
    });
    
    // Remove dynamic items
    navUl.querySelectorAll('.nav-dynamic').forEach(el => el.remove());

    if (welcomeName) {
      welcomeName.textContent = 'Welcome';
    }
    const headerLogoutBtn = document.getElementById('headerLogoutBtn');
    if (headerLogoutBtn) {
      headerLogoutBtn.remove();
    }
  }
}

// Global Sidebar Toggle logic
document.addEventListener('click', (e) => {
    const sidebar = document.getElementById('appSidebar');
    const toggle = document.getElementById('sidebarToggle');
    
    if (!sidebar) return;

    if (toggle && (toggle === e.target || toggle.contains(e.target))) {
        sidebar.classList.toggle('active');
    } else if (!sidebar.contains(e.target) && sidebar.classList.contains('active')) {
        sidebar.classList.remove('active');
    }
});

// Apply saved image-fit preference (so preview matches admin choice)
window.addEventListener("DOMContentLoaded", function () {
  updateNavigation();
  try {
    const fit = localStorage.getItem("productImageFit");
    if (fit) {
      document.body.classList.remove("image-fit-cover", "image-fit-fill");
      document.body.classList.add(`image-fit-${fit}`);
    }
  } catch (e) {
    console.warn("Could not apply saved image fit:", e);
  }
});

// Load categories on the homepage dynamically (replaces the static 4 cards)
async function loadHomeCategories() {
  const grid = document.querySelector(".category-grid");
  if (!grid) return;

  try {
    const res = await fetch(`${API_BASE}/api/categories`);
    const data = await res.json();
    if (!data.success || !Array.isArray(data.categories)) return;

    // Clear existing (static) cards so we render server-driven categories
    grid.innerHTML = "";

    data.categories.forEach((cat) => {
      // only show active categories
      if (!cat.is_active) return;

      const name = cat.name || "Category";
      // build URL-safe slug
      const slug = String(name)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      // normalize image URL similar to product handling
      let imageSrc = "/images/servenow_brand_logo.png";
      if (cat.image_url) {
        let url = String(cat.image_url).trim().replace(/\\/g, "/");
        if (
          /^https?:\/\//i.test(url) ||
          url.toLowerCase().startsWith("data:")
        ) {
          imageSrc = url;
        } else if (url.startsWith("/")) {
          imageSrc = API_BASE.replace(/\/$/, "") + url;
        } else {
          imageSrc =
            API_BASE.replace(/\/$/, "") + "/" + url.replace(/^\/+/, "");
        }
      }

      const card = document.createElement("div");
      card.className = "category-card";
      card.innerHTML = `
                <img src="${imageSrc}" alt="${name}">
                <div class="category-card-content">
                    <h4>${name}</h4>
                    <a href="stores.html?category=${encodeURIComponent(
                      slug
                    )}&category_id=${encodeURIComponent(cat.id)}">Shop Now</a>
                </div>
            `;
      grid.appendChild(card);
    });
  } catch (err) {
    // Leave static cards as fallback and log error
    console.error("Error loading home categories:", err);
  }
}

async function loadHeaderWalletBalance() {
  const token = localStorage.getItem("serveNowToken");
  if (!token) return;

  // Look for wallet link in nav
  const navUl = document.querySelector("nav ul");
  if (!navUl) return;

  try {
    const response = await fetch(`${API_BASE}/api/wallet/balance`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const data = await response.json();

    if (data.success && data.wallet) {
      const balance = parseFloat(data.wallet.balance);

      // Check if balance span already exists
      let balanceSpan = document.getElementById("headerWalletBalance");
      if (!balanceSpan) {
        // Find wallet link
        const walletLink = Array.from(navUl.querySelectorAll("a")).find((a) =>
          a.href.includes("wallet.html")
        );
        if (walletLink) {
          balanceSpan = document.createElement("span");
          balanceSpan.id = "headerWalletBalance";
          balanceSpan.className = "header-balance";
          walletLink.appendChild(balanceSpan);
        }
      }

      if (balanceSpan) {
        balanceSpan.textContent = ` (PKR ${balance.toFixed(2)})`;
      }
    }
  } catch (error) {
    console.error("Error loading header wallet balance:", error);
  }
}

// Trigger home categories load on DOM ready (safe to call on any page)
window.addEventListener("DOMContentLoaded", function () {
  updateNavigation();
  try {
    loadHomeCategories();
  } catch (e) {
    /* ignore */
  }
  try {
    loadHeaderWalletBalance();
  } catch (e) {
    /* ignore */
  }
  try {
    loadGlobalDeliveryWidget();
  } catch (e) {
    /* ignore */
  }
  if (window.__globalDeliveryPollTimer) {
    clearInterval(window.__globalDeliveryPollTimer);
  }
  window.__globalDeliveryPollTimer = setInterval(() => {
    loadGlobalDeliveryWidget(true);
  }, 5000);
  window.addEventListener("storage", (event) => {
    if (
      event &&
      (event.key === "serveNowGlobalDeliveryStatusUpdatedAt" ||
        event.key === "serveNowLivePromotionsUpdatedAt")
    ) {
      loadGlobalDeliveryWidget(true);
    }
  });
  window.addEventListener("globalDeliveryStatusSaved", () => {
    loadGlobalDeliveryWidget(true);
  });
  window.addEventListener("livePromotionsSaved", () => {
    loadGlobalDeliveryWidget(true);
  });
  updateCartCount();
});

// Cart functionality
var cart = JSON.parse(localStorage.getItem("serveNowCart")) || [];

function updateCartCount() {
  const cartCount = document.getElementById("cartCount");
  if (cartCount) {
    cartCount.textContent = cart.length;
  }
}

async function fetchProductStock(productId) {
  try {
    const resp = await fetch(
      `${API_BASE}/api/products/${encodeURIComponent(productId)}`
    );
    const data = await resp.json();
    if (data && data.success && data.product) {
      const sq = parseInt(data.product.stock_quantity, 10);
      return Number.isFinite(sq) ? Math.max(0, sq) : null;
    }
  } catch (e) {
    /* ignore */
  }
  return null;
}

async function addToCart(
  productId,
  productName,
  price,
  stockQty,
  unitName,
  unitId,
  imageSrc,
  storeId,
  variantData,
  quantityToAdd = 1
) {
  try {
    await loadGlobalDeliveryWidget(true);
    const guard = getOrderingGuardState();
    if (guard.blocked) {
      showWarning("Delivery Unavailable", guard.message);
      return;
    }
  } catch (_) {
    /* ignore */
  }

  const qToAdd = parseFloat(quantityToAdd) || 1;

  // Mixed store check removed to allow multi-store orders

  const existingItem = cart.find((item) => item.id === productId);
  let maxQty = Number.isFinite(parseFloat(stockQty))
    ? Math.max(0, parseInt(stockQty, 10))
    : null;
  if (maxQty === null) {
    maxQty = await fetchProductStock(productId);
  }
  if (existingItem) {
    if (imageSrc) existingItem.image = imageSrc;
    if (maxQty !== null) existingItem.maxQty = maxQty;
    if (storeId && !existingItem.storeId) existingItem.storeId = storeId;
    if (variantData) {
      existingItem.offerBadge = variantData.offerBadge || existingItem.offerBadge || null;
      existingItem.offerMeta = variantData.offerMeta || existingItem.offerMeta || null;
      existingItem.originalPrice = variantData.originalPrice || existingItem.originalPrice || price;
    }

    const next = (existingItem.quantity || 0) + qToAdd;
    if (maxQty !== null && next > maxQty) {
      showWarning(
        "Limited Stock",
        `Only ${maxQty} available for ${productName}.`
      );
      existingItem.quantity = maxQty;
    } else {
      existingItem.quantity = next;
    }
  } else {
    if (maxQty !== null && maxQty <= 0) {
      showWarning("Out of Stock", `${productName} is currently unavailable.`);
      localStorage.setItem("serveNowCart", JSON.stringify(cart));
      updateCartCount();
      return;
    }

    let initialQty = qToAdd;
    if (maxQty !== null && initialQty > maxQty) {
      showWarning(
        "Limited Stock",
        `Only ${maxQty} available for ${productName}.`
      );
      initialQty = maxQty;
    }

    const item = {
      id: productId,
      name: productName,
      price: price,
      storeId: storeId,
      quantity: initialQty,
      unitName: unitName || null,
      unitId: unitId || null,
      image: imageSrc || null,
    };

    if (variantData) {
      item.sizeId = variantData.size_id;
      item.sizeLabel = variantData.size_label;
      item.variantLabel = variantData.variant_label;
      item.offerBadge = variantData.offerBadge || null;
      item.offerMeta = variantData.offerMeta || null;
      item.originalPrice = variantData.originalPrice || price;
    }

    if (maxQty !== null) item.maxQty = maxQty;
    cart.push(item);
  }
  localStorage.setItem("serveNowCart", JSON.stringify(cart));
  updateCartCount();
  showSuccess("Added to Cart", "Item added to cart successfully!");
}

function removeFromCart(productId) {
  cart = cart.filter((item) => item.id !== productId);
  localStorage.setItem("serveNowCart", JSON.stringify(cart));
  updateCartCount();
  displayCart();
}

function isFractionalUnit(name, id) {
  if (id) {
    const uid = parseInt(id, 10);
    if (uid === 1 || uid === 32) return true;
  }
  const n = String(name || "")
    .toLowerCase()
    .trim()
    .replace(/\./g, "");
  if (!n) return false;
  const singular = n.replace(/s$/, "");
  if (singular === "kilogram" || singular === "kiligram" || singular === "kg")
    return true;
  if (
    singular === "liter" ||
    singular === "litre" ||
    singular === "ltr" ||
    singular === "l"
  )
    return true;
  if (singular.includes("kilo")) return true;
  if (singular.includes("lit")) return true;
  return false;
}

function qtyStepForUnit(name, id) {
  return isFractionalUnit(name, id) ? 0.25 : 1;
}

function isBxgyCartItem(item) {
  return String(item?.offerMeta?.campaign_type || "").toLowerCase() === "bxgy";
}

function bxgyBuyQty(item) {
  return Math.max(1, parseInt(item?.offerMeta?.buy_qty || 1, 10) || 1);
}

function bxgyGetQty(item) {
  return Math.max(1, parseInt(item?.offerMeta?.get_qty || 1, 10) || 1);
}

function getCartItemFreeQuantity(item) {
  if (!isBxgyCartItem(item)) return 0;
  const qty = parseInt(item?.quantity || 0, 10) || 0;
  const bundleQty = bxgyBuyQty(item) + bxgyGetQty(item);
  return Math.floor(qty / bundleQty) * bxgyGetQty(item);
}

function getCartItemPaidQuantity(item) {
  const qty = parseInt(item?.quantity || 0, 10) || 0;
  return Math.max(0, qty - getCartItemFreeQuantity(item));
}

function getCartItemTotal(item) {
  const price = parseFloat(item?.price || 0) || 0;
  return price * getCartItemPaidQuantity(item);
}

function setCartItemQuantity(productId, quantity) {
  const item = cart.find((i) => i.id === productId);
  const isFrac = item ? isFractionalUnit(item.unitName, item.unitId) : false;
  const qRaw = isFrac ? parseFloat(quantity) : parseInt(quantity, 10);
  const base = Number.isFinite(qRaw) ? qRaw : 1;
  const minQ = qtyStepForUnit(item?.unitName, item?.unitId);
  const q = Math.max(minQ, base);
  if (item) {
    let finalQ = q;
    if (Number.isFinite(item.maxQty)) {
      if (q > item.maxQty) {
        finalQ = item.maxQty;
        showWarning(
          "Limited Stock",
          `Only ${item.maxQty} available for ${item.name}.`
        );
      }
    }
    item.quantity = finalQ;
    localStorage.setItem("serveNowCart", JSON.stringify(cart));
    updateCartCount();
    displayCart();
  }
}

async function ensureItemMaxQty(productId) {
  const item = cart.find((i) => i.id === productId);
  if (!item) return null;
  if (Number.isFinite(item.maxQty)) return item.maxQty;
  const maxQty = await fetchProductStock(productId);
  if (maxQty !== null) {
    item.maxQty = maxQty;
    localStorage.setItem("serveNowCart", JSON.stringify(cart));
  }
  return item.maxQty || null;
}

async function incrementQty(productId) {
  const item = cart.find((i) => i.id === productId);
  const max = await ensureItemMaxQty(productId);
  const step = qtyStepForUnit(item?.unitName, item?.unitId);
  const next = item ? item.quantity + step : step;
  if (item && Number.isFinite(max) && next > max) {
    showWarning("Limited Stock", `Only ${max} available for ${item.name}.`);
    return;
  }
  setCartItemQuantity(productId, next);
}

function decrementQty(productId) {
  const item = cart.find((i) => i.id === productId);
  const step = qtyStepForUnit(item?.unitName, item?.unitId);
  const minQ = step;
  const next = item ? Math.max(minQ, item.quantity - step) : minQ;
  setCartItemQuantity(productId, next);
}

async function changeQty(productId, value) {
  const item = cart.find((i) => i.id === productId);
  const max = await ensureItemMaxQty(productId);
  const isFrac = item ? isFractionalUnit(item.unitName, item.unitId) : false;
  const qRaw = isFrac ? parseFloat(value) : parseInt(value, 10);
  const base = Number.isFinite(qRaw) ? qRaw : 1;
  const minQ = qtyStepForUnit(item?.unitName, item?.unitId);
  let q = Math.max(minQ, base);
  if (item && Number.isFinite(max) && q > max) {
    q = max;
    showWarning("Limited Stock", `Only ${max} available for ${item.name}.`);
  }
  setCartItemQuantity(productId, q);
}

function displayCart() {
  const cartContainer = document.getElementById("cartItems");
  const cartTotal = document.getElementById("cartTotal");

  if (!cartContainer) return;

  cartContainer.innerHTML = "";
  let total = 0;

  cart.forEach((item) => {
    const itemTotal = getCartItemTotal(item);
    total += itemTotal;
    const step = qtyStepForUnit(item.unitName, item.unitId);
    const isFrac = isFractionalUnit(item.unitName, item.unitId);

    const imgSrc = item.image || "/images/servenow_brand_logo.png";

    const itemElement = document.createElement("div");
    itemElement.className = "cart-item serving-card";
    const variantLabel = item.variantLabel
      ? `<p class="variant-label" style="font-size: 0.85em; color: #666; margin: 4px 0 0 0;">${item.variantLabel}</p>`
      : "";
    const offerLine = isBxgyCartItem(item)
      ? `<p class="variant-label" style="font-size: 0.82em; color: #166534; font-weight: 800; margin: 4px 0 0 0;">${item.offerBadge || "Bundle Offer"} - Qty ${item.quantity}, Pay ${getCartItemPaidQuantity(item)}, Free ${getCartItemFreeQuantity(item)}</p>`
      : "";
    itemElement.innerHTML = `
            <div class="serving-dish">
                <div class="dish-shadow"></div>
                <img src="${imgSrc}" alt="${item.name}" class="dish-image">
            </div>
            <div class="serving-content">
                <div class="serving-header">
                    <h4>${item.name}</h4>
                    <button class="serving-remove" onclick="removeFromCart(${
                      item.id
                    })" title="Remove Item">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                ${variantLabel}
                ${offerLine}
                <div class="serving-details">
                    <div class="cart-qty">
                        <button class="qty-btn" onclick="decrementQty(${
                          item.id
                        })">−</button>
                        <input type="range" class="qty-slider" min="${step}" max="${
      Number.isFinite(item.maxQty) ? item.maxQty : 20
    }" step="${step}" value="${item.quantity}" oninput="changeQty(${
      item.id
    }, this.value)">
                        ${
                          isFrac
                            ? `<input type="text" class="qty-value-input" value="${item.quantity}" oninput="changeQty(${item.id}, this.value)" inputmode="decimal">`
                            : `<span class="qty-value">${item.quantity}</span>`
                        }
                        <button class="qty-btn" onclick="incrementQty(${
                          item.id
                        })">+</button>
                    </div>
                    <span class="serving-price">PKR ${itemTotal.toFixed(
                      2
                    )}</span>
                </div>
            </div>
        `;
    cartContainer.appendChild(itemElement);
  });

  if (cartTotal) {
    cartTotal.textContent = `Total: PKR ${total.toFixed(2)}`;
  }
}

// Location-based functionality
function getUserLocation() {
  if (!navigator.geolocation) {
    showInfo(
      "Geolocation Unavailable",
      "Geolocation is not supported by this browser."
    );
    return;
  }

  // Show loading state
  const locationBtn = document.getElementById("getLocation");
  if (locationBtn) {
    locationBtn.textContent = "Getting location...";
    locationBtn.disabled = true;
  }

  navigator.geolocation.getCurrentPosition(showPosition, showLocationError, {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 300000, // 5 minutes
  });
}

function showPosition(position) {
  const latitude = position.coords.latitude;
  const longitude = position.coords.longitude;

  console.log(`User location: ${latitude}, ${longitude}`);

  // Reset button state
  const locationBtn = document.getElementById("getLocation");
  if (locationBtn) {
    locationBtn.textContent = "Stores Found!";
    locationBtn.disabled = false;
    setTimeout(() => {
      locationBtn.textContent = "Find Stores Near Me";
    }, 2000);
  }

  // In a real app, you would send this to your backend to find nearby stores
  // For now, we'll just show all stores with a success message
  displayNearbyStores();
}

function showLocationError(error) {
  // Reset button state
  const locationBtn = document.getElementById("getLocation");
  if (locationBtn) {
    locationBtn.textContent = "Find Stores Near Me";
    locationBtn.disabled = false;
  }

  let errorMessage = "Location access failed: ";
  switch (error.code) {
    case error.PERMISSION_DENIED:
      errorMessage +=
        "Please enable location permissions in your browser settings.";
      break;
    case error.POSITION_UNAVAILABLE:
      errorMessage += "Location information is unavailable.";
      break;
    case error.TIMEOUT:
      errorMessage += "Location request timed out. Please try again.";
      break;
    case error.UNKNOWN_ERROR:
      errorMessage += "An unknown error occurred.";
      break;
  }
  showError("Error", errorMessage);
}

function normalizePublicImageUrl(rawUrl, fallbackUrl) {
  try {
    if (!rawUrl) return fallbackUrl;
    let url = String(rawUrl).trim().replace(/\\/g, "/");
    if (!url) return fallbackUrl;
    if (/^https?:\/\//i.test(url) || url.toLowerCase().startsWith("data:"))
      return url;
    if (url.startsWith("//")) return window.location.protocol + url;
    if (url.startsWith("/")) return API_BASE.replace(/\/$/, "") + url;
    return API_BASE.replace(/\/$/, "") + "/" + url.replace(/^\/+/, "");
  } catch (e) {
    return fallbackUrl;
  }
}

function formatStoreRatingValue(rating) {
  const n = parseFloat(rating);
  if (Number.isFinite(n)) return n.toFixed(1);
  return "N/A";
}

function formatDeliveryWindow(startAt, endAt) {
  if (!startAt || !endAt) return "";
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  return `${start.toLocaleString()} - ${end.toLocaleString()}`;
}

function buildPromotionReasonWithWindow(promo) {
  if (!promo) return "";
  const reason = String(promo.status_message || "").trim();
  const when = formatDeliveryWindow(promo.start_at, promo.end_at);
  if (reason && when) return `${reason} (${when})`;
  if (reason) return reason;
  if (when) return `Promotion window: ${when}`;
  return "";
}

function renderGlobalDeliveryWidget(status, promotions) {
  const host = document.getElementById("globalDeliveryWidget");
  if (!host) return;

  window.__globalDeliveryStatus = status || null;
  window.__livePromotions = promotions || null;

  const hasPromo = !!(
    promotions &&
    promotions.is_enabled &&
    promotions.is_window_active &&
    Array.isArray(promotions.widget_images) &&
    promotions.widget_images.length
  );
  const isUnavailable = !!(status && status.is_window_active);
  const hasNotice = !!(
    status &&
    status.is_enabled &&
    status.is_window_active &&
    status.status_message
  );
  if (!hasNotice && !hasPromo) {
    host.innerHTML = "";
    host.style.display = "none";
    scheduleGlobalDeliveryAutoRefresh(status);
    try {
      window.dispatchEvent(
        new CustomEvent("globalDeliveryStatusUpdated", {
          detail: window.__globalDeliveryStatus,
        })
      );
    } catch (_) {}
    return;
  }

  host.style.display = "block";
  const promoTitle = (promotions && promotions.title) || "Live Promotions";
  const promoMessage = buildPromotionReasonWithWindow(promotions);
  const promoImages = hasPromo ? promotions.widget_images.slice(0, 5) : [];
  const title = status && status.title ? status.title : "Delivery Update";
  const message =
    buildDeliveryReasonWithWindow(status) ||
    (status && status.status_message) ||
    "";
  const when = status ? formatDeliveryWindow(status.start_at, status.end_at) : "";
  host.innerHTML = `
    ${
      hasPromo
        ? `<article class="delivery-live-card delivery-live-card--promo">
      <div class="delivery-live-card__top">
        <span class="delivery-live-card__chip">Live: Promotions / Events</span>
        <span class="delivery-live-card__state">Active</span>
      </div>
      <h3>${escapeHtmlPublic(promoTitle)}</h3>
      <p>${escapeHtmlPublic(promoMessage)}</p>
      <div class="promo-widget-grid">
        ${promoImages
          .map(
            (img, idx) =>
              `<div class="promo-widget-item"><img src="${normalizePublicImageUrl(
                img,
                "/images/servenow_brand_logo.png"
              )}" alt="Promo ${idx + 1}" loading="lazy" decoding="async"></div>`
          )
          .join("")}
      </div>
    </article>`
        : ""
    }
    ${
      hasNotice
        ? `<article class="delivery-live-card ${isUnavailable ? "delivery-live-card--alert" : "delivery-live-card--info"}">
      <div class="delivery-live-card__top">
        <span class="delivery-live-card__chip">${isUnavailable ? "Live: Delivery Paused" : "Upcoming Delivery Update"}</span>
        <span class="delivery-live-card__state">Unavailable Now</span>
      </div>
      <h3>${escapeHtmlPublic(title)}</h3>
      <p>${escapeHtmlPublic(message)}</p>
      ${when ? `<p class="delivery-live-card__window"><i class="fas fa-clock"></i> ${escapeHtmlPublic(when)}</p>` : ""}
    </article>`
        : ""
    }
  `;
  scheduleGlobalDeliveryAutoRefresh(status);
  try {
    window.dispatchEvent(
      new CustomEvent("globalDeliveryStatusUpdated", {
        detail: window.__globalDeliveryStatus,
      })
    );
  } catch (_) {}
}

function ensureGlobalDeliveryWidgetHost() {
  const existing = document.getElementById("globalDeliveryWidget");
  if (existing) return existing;
  const path = (window.location.pathname || "").toLowerCase();
  if (path.includes("admin.html") || path.includes("rider.html")) return null;
  const appContent = document.querySelector(".app-content");
  if (!appContent) return null;
  const section = document.createElement("section");
  section.id = "globalDeliveryWidget";
  section.className = "global-delivery-widget";
  section.style.display = "none";
  appContent.insertBefore(section, appContent.firstChild);
  return section;
}

async function loadGlobalDeliveryWidget(forceRefresh = false) {
  const host = ensureGlobalDeliveryWidgetHost();
  if (!host) return;
  if (
    !forceRefresh &&
    window.__globalDeliveryStatus &&
    window.__globalDeliveryStatus.is_enabled !== undefined &&
    window.__livePromotions &&
    window.__livePromotions.is_enabled !== undefined
  ) {
    renderGlobalDeliveryWidget(window.__globalDeliveryStatus, window.__livePromotions);
    return;
  }
  try {
    const [deliveryResp, promoResp] = await Promise.all([
      fetch(`${API_BASE}/api/stores/global-delivery-status`),
      fetch(`${API_BASE}/api/stores/live-promotions`),
    ]);
    const data = await deliveryResp.json();
    const promoData = await promoResp.json();
    const nextDelivery =
      data && data.success && data.global_delivery_status
        ? data.global_delivery_status
        : null;
    const nextPromotions =
      promoData && promoData.success && promoData.live_promotions
        ? promoData.live_promotions
        : null;
    if (!nextDelivery && !nextPromotions) {
      window.__globalDeliveryStatus = null;
      window.__livePromotions = null;
      host.style.display = "none";
      try {
        window.dispatchEvent(
          new CustomEvent("globalDeliveryStatusUpdated", {
            detail: window.__globalDeliveryStatus,
          })
        );
      } catch (_) {}
      return;
    }
    renderGlobalDeliveryWidget(nextDelivery, nextPromotions);
  } catch (error) {
    console.error("Error loading global delivery widget:", error);
    window.__globalDeliveryStatus = null;
    window.__livePromotions = null;
    host.style.display = "none";
    try {
      window.dispatchEvent(
        new CustomEvent("globalDeliveryStatusUpdated", {
          detail: window.__globalDeliveryStatus,
        })
      );
    } catch (_) {}
  }
}

function buildStoreCardHtml(store) {
  const fallbackImg = "/images/servenow_brand_logo.png";
  const imageSrc = normalizePublicImageUrl(
    store && store.image_url,
    fallbackImg
  );
  const safeAlt = String((store && store.name) || "Store").replace(
    /"/g,
    "&quot;"
  );
  const locationText = store && store.location ? store.location : "—";
  const ratingText = formatStoreRatingValue(store && store.rating);
  const deliveryText = store && store.delivery_time ? store.delivery_time : "—";
  const id = store && store.id ? store.id : "";
  const isOpen = store && (store.is_open === true || store.is_open === 1);

  return `
        <div class="store-status-container">
            <div class="store-status-badge ${isOpen ? 'status-open' : 'status-closed'}">
                <i class="fas ${isOpen ? 'fa-door-open' : 'fa-door-closed'}"></i>
                ${isOpen ? 'Open' : 'Closed'}
            </div>
        </div>
        <div class="store-image-container">
            <img src="${imageSrc}" alt="${safeAlt}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${fallbackImg}'">
        </div>
        <div class="store-card-content">
            <h4>${store && store.name ? store.name : "Store"}</h4>
            <p><i class="fas fa-map-marker-alt"></i> ${locationText}</p>
            <p><i class="fas fa-star"></i> ${ratingText} &nbsp;|&nbsp; <i class="fas fa-clock"></i> ${deliveryText}</p>
            <a href="store.html?id=${id}">View Store</a>
        </div>
    `;
}

function displayNearbyStores() {
  const allStoresSection = document.getElementById("allStoresSection");
  if (allStoresSection) {
    allStoresSection.scrollIntoView({ behavior: "smooth" });
  }
  displayAllStoresHorizontal();
}

// Display all stores in horizontal scroll (bottom section)
async function displayAllStoresHorizontal() {
  const storeContainer = document.getElementById("allStoresHorizontal");
  if (!storeContainer) return;

  try {
    const response = await fetch(`${API_BASE}/api/stores`);
    const data = await response.json();

    if (data.success) {
      storeContainer.innerHTML = "";

      // Show ALL stores (no slice)
      data.stores.forEach((store) => {
        const storeCard = document.createElement("div");
        storeCard.className = "store-card";
        storeCard.innerHTML = buildStoreCardHtml(store);
        storeContainer.appendChild(storeCard);
      });

      // Initialize scroll controls
      initScrollControls(storeContainer);
    }
  } catch (error) {
    console.error("Error loading stores:", error);
    storeContainer.innerHTML = "<p>Unable to load stores at this time.</p>";
  }
}

function initScrollControls(container) {
  const leftBtn = document.getElementById("scrollLeftBtn");
  const rightBtn = document.getElementById("scrollRightBtn");

  if (!leftBtn || !rightBtn) return;

  const scrollAmount = 350; // Width of card + gap approx

  leftBtn.addEventListener("click", () => {
    container.scrollBy({ left: -scrollAmount, behavior: "smooth" });
  });

  rightBtn.addEventListener("click", () => {
    container.scrollBy({ left: scrollAmount, behavior: "smooth" });
  });

  // Handle button visibility based on scroll position
  const updateButtons = () => {
    const isAtStart = container.scrollLeft <= 0;
    const isAtEnd =
      container.scrollLeft + container.clientWidth >= container.scrollWidth - 1; // -1 for rounding tolerance

    leftBtn.style.display = isAtStart ? "none" : "block";
    rightBtn.style.display = isAtEnd ? "none" : "block";
  };

  container.addEventListener("scroll", updateButtons);
  // Initial check
  setTimeout(updateButtons, 100); // Wait for layout
  window.addEventListener("resize", updateButtons);
}

// Perform search and display results in the replacement section
async function handleStoreSearch(filters = {}) {
  const searchResultsSection = document.getElementById("searchResultsSection");
  const categoriesSection = document.getElementById("categoriesSection");
  const allStoresSection = document.getElementById("allStoresSection");
  const searchResultsGrid = document.getElementById("searchResultsGrid");

  // If no filters active, show categories and featured stores, hide search results
  if (!filters.search && !filters.category) {
    if (categoriesSection) categoriesSection.classList.remove("hidden");
    if (allStoresSection) allStoresSection.style.display = "block";
    if (searchResultsSection) searchResultsSection.classList.add("hidden");
    return;
  }

  // Filters active: Hide categories and featured stores, show search results
  if (categoriesSection) categoriesSection.classList.add("hidden");
  if (allStoresSection) allStoresSection.style.display = "none";
  if (searchResultsSection) searchResultsSection.classList.remove("hidden");

  if (!searchResultsGrid) return;
  searchResultsGrid.innerHTML = "<p>Loading...</p>";

  try {
    let url = `${API_BASE}/api/stores`;
    const params = new URLSearchParams();

    if (filters.category) {
      params.append("category", filters.category);
    }
    if (filters.search) {
      params.append("search", filters.search);
    }

    const queryString = params.toString();
    if (queryString) {
      url += `?${queryString}`;
    }

    const response = await fetch(url);
    const data = await response.json();

    if (data.success) {
      searchResultsGrid.innerHTML = "";
      let stores = data.stores;

      if (stores.length === 0) {
        searchResultsGrid.innerHTML =
          "<p>No stores found matching your criteria.</p>";
        return;
      }

      stores.forEach((store) => {
        const storeCard = document.createElement("div");
        storeCard.className = "store-card";
        storeCard.innerHTML = buildStoreCardHtml(store);
        searchResultsGrid.appendChild(storeCard);
      });
    }
  } catch (error) {
    console.error("Error searching stores:", error);
    searchResultsGrid.innerHTML = "<p>Error searching stores.</p>";
  }
}

// Load products by category
async function loadProducts(category) {
  const productGrid = document.getElementById("productGrid");
  const categoryTitle = document.getElementById("categoryTitle");
  if (!productGrid) return;

  // Update the page title
  if (categoryTitle) {
    const formattedCategory = category
      .replace(/-/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase());
    categoryTitle.textContent = formattedCategory;
  }

  try {
    const response = await fetch(
      `${API_BASE}/api/products?category=${category}`
    );
    const data = await response.json();

    if (data.success) {
      productGrid.innerHTML = "";

      data.products.forEach((product) => {
        const productCard = document.createElement("div");
        productCard.className = "product-card";

        // Normalize image URL: if it's a relative path, prefix with API_BASE
        let imageSrc = "/images/servenow_brand_logo.png";
        if (product.image_url) {
          // Normalize backslashes and trim
          let url = String(product.image_url).trim().replace(/\\/g, "/");
          if (
            /^https?:\/\//i.test(url) ||
            url.toLowerCase().startsWith("data:")
          ) {
            // absolute URL or data URI — use as-is
            imageSrc = url;
          } else if (url.startsWith("/")) {
            // root-relative — make absolute using API_BASE to avoid host/path mismatch
            imageSrc = API_BASE.replace(/\/$/, "") + url;
          } else {
            // relative path (no leading slash) — prefix with API_BASE
            imageSrc =
              API_BASE.replace(/\/$/, "") + "/" + url.replace(/^\/+/, "");
          }
        }

        const basePrice = Number(product.price || 0);
        const promoPrice =
          product.promotional_price !== undefined &&
          product.promotional_price !== null
            ? Number(product.promotional_price)
            : null;
        const effectivePrice =
          Number.isFinite(promoPrice) && promoPrice >= 0
            ? promoPrice
            : basePrice;
        const priceHtml =
          Number.isFinite(promoPrice) && promoPrice < basePrice
            ? `<p class="price"><span style="text-decoration:line-through;color:#94a3b8;margin-right:6px;">PKR ${basePrice.toFixed(2)}</span><strong style="color:#dc2626;">PKR ${promoPrice.toFixed(2)}</strong></p>`
            : `<p class="price">PKR ${basePrice.toFixed(2)}</p>`;

        productCard.innerHTML = `
                    <div class="product-image">
                                ${buildImgTag(
                                  imageSrc,
                                  product.image_variants || null,
                                  product.name,
                                  product.id,
                                  {
                                    image_bg_r: product.image_bg_r,
                                    image_bg_g: product.image_bg_g,
                                    image_bg_b: product.image_bg_b,
                                    image_overlay_alpha:
                                      product.image_overlay_alpha,
                                    image_contrast: product.image_contrast,
                                  }
                                )}
                    </div>
                    <div class="product-card-content">
                        <h4>${product.name}</h4>
                        ${priceHtml}
                        <button class="add-to-cart" onclick="addToCart(${
                          product.id
                        }, '${product.name}', ${effectivePrice}, ${
          Number.isFinite(parseInt(product.stock_quantity))
            ? parseInt(product.stock_quantity, 10)
            : "undefined"
        }, '${String(product.unit_name || "").replace(/'/g, "\\'")}', ${
          product.unit_id
        }, '${imageSrc.replace(/'/g, "\\'")}', ${
          product.store_id || "null"
        })">Add to Cart</button>
                    </div>
                `;
        productGrid.appendChild(productCard);
        // Ensure cached images get orientation fit applied immediately
        productCard.querySelectorAll("img").forEach((img) => {
          try {
            if (img.complete && img.naturalWidth && img.naturalHeight) {
              if (img.dataset && (img.dataset.bgR || img.dataset.bgR === "0"))
                window.applyImageBgFromMeta(img);
              else applyOrientationFit(img);
            }
          } catch (e) {
            /* ignore */
          }
        });
      });
    }
  } catch (error) {
    console.error("Error loading products:", error);
    productGrid.innerHTML = "<p>Unable to load products at this time.</p>";
  }
}

// Build img tag string with optional srcset using variants mapping
function buildImgTag(src, variants, alt, pid, meta) {
  const safeAlt = (alt || "").replace(/"/g, "&quot;");
  const fallback = "/images/servenow_brand_logo.png";
  if (variants && typeof variants === "object") {
    // build srcset entries sorted by width
    const entries = Object.keys(variants)
      .map((k) => `${variants[k]} ${k}w`)
      .join(", ");
    // choose smallest variant as src if available, else src
    const widths = Object.keys(variants)
      .map((n) => parseInt(n, 10))
      .sort((a, b) => a - b);
    const smallest = widths.length ? variants[widths[0]] : src;
    // include data-* attributes when meta is provided so client can apply colors without canvas
    const dataAttrs = meta
      ? `data-bg-r="${meta.image_bg_r || ""}" data-bg-g="${
          meta.image_bg_g || ""
        }" data-bg-b="${meta.image_bg_b || ""}" data-overlay-alpha="${
          meta.image_overlay_alpha || ""
        }" data-contrast="${meta.image_contrast || ""}"`
      : "";
    return `<img src="${
      smallest || src || fallback
    }" srcset="${entries}" sizes="(max-width: 600px) 50vw, (max-width: 1200px) 33vw, 25vw" alt="${safeAlt}" ${dataAttrs} loading="lazy" decoding="async" onload="(function(i){ if(i.dataset && (i.dataset.bgR || i.dataset.bgR==='0')){ window.applyImageBgFromMeta(i); } else { applyOrientationFit(i); } })(this)" onerror="this.onerror=null;this.src='${fallback}'; console.warn('Product image failed to load:', '${pid}', this.src)">`;
  }
  const dataAttrs = meta
    ? `data-bg-r="${meta.image_bg_r || ""}" data-bg-g="${
        meta.image_bg_g || ""
      }" data-bg-b="${meta.image_bg_b || ""}" data-overlay-alpha="${
        meta.image_overlay_alpha || ""
      }" data-contrast="${meta.image_contrast || ""}"`
    : "";
  return `<img src="${
    src || fallback
  }" alt="${safeAlt}" ${dataAttrs} loading="lazy" decoding="async" onload="(function(i){ if(i.dataset && (i.dataset.bgR || i.dataset.bgR==='0')){ window.applyImageBgFromMeta(i); } else { applyOrientationFit(i); } })(this)" onerror="this.onerror=null;this.src='${fallback}'; console.warn('Product image failed to load:', '${pid}', this.src)">`;
}

// Apply orientation-aware fit: portrait -> contain, landscape -> cover
function applyOrientationFit(img) {
  try {
    if (!img) return;
    const apply = () => {
      try {
        const w = img.naturalWidth || 0;
        const h = img.naturalHeight || 0;
        img.classList.remove("fit-contain", "fit-cover");
        if (h >= w) {
          img.classList.add("fit-contain");
        } else {
          img.classList.add("fit-cover");
        }
        // Also set the parent `.product-image` background to a matching color
        if (window.applyImageBgFromImage) {
          try {
            window.applyImageBgFromImage(img);
          } catch (e) {
            /* ignore */
          }
        }
      } catch (e) {
        console.warn("applyOrientationFit inner error", e);
      }
    };

    if (img.complete && img.naturalWidth && img.naturalHeight) {
      apply();
    } else {
      const onLoad = function () {
        apply();
        img.removeEventListener("load", onLoad);
      };
      img.addEventListener("load", onLoad);
    }
  } catch (e) {
    console.warn("applyOrientationFit failed", e);
  }
}

// Compute an average/dominant-ish background color from an image and apply it
// to the parent `.product-image` element. Best-effort: if the image is cross-origin
// and taints the canvas this will silently fail and leave the default background.
window.applyImageBgFromImage = function (img) {
  try {
    if (!img) return;
    const container = img.closest && img.closest(".product-image");
    if (!container) return;

    const computeAndSet = () => {
      try {
        const w = Math.min(40, Math.max(1, img.naturalWidth || 1));
        const h = Math.min(40, Math.max(1, img.naturalHeight || 1));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        let r = 0,
          g = 0,
          b = 0,
          count = 0;
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha === 0) continue;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }
        if (!count) return;
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);
        // Slightly desaturate and set CSS variables so CSS overlay can use them.
        container.style.transition = "background-color 450ms ease";
        container.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
        // Set CSS vars for overlay use (r,g,b) and compute a helpful overlay alpha
        container.style.setProperty("--product-bg-r", String(r));
        container.style.setProperty("--product-bg-g", String(g));
        container.style.setProperty("--product-bg-b", String(b));
        // Compute luminance to choose overlay strength (0..1)
        const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        let alpha = 0.2; // default for darker images
        if (lum > 0.75) alpha = 0.55; // very light images -> stronger overlay
        else if (lum > 0.6) alpha = 0.45;
        else if (lum > 0.45) alpha = 0.32;
        else alpha = 0.2;
        container.style.setProperty("--product-overlay-alpha", String(alpha));
        // Also expose a contrast color variable for potential label use
        container.style.setProperty(
          "--product-contrast",
          lum > 0.5 ? "#111" : "#fff"
        );
      } catch (e) {
        // likely CORS/tainted canvas; ignore and keep default background
      }
    };

    if (img.complete && img.naturalWidth && img.naturalHeight) {
      setTimeout(computeAndSet, 20);
    } else {
      const onLoad = function () {
        computeAndSet();
        img.removeEventListener("load", onLoad);
      };
      img.addEventListener("load", onLoad);
    }
  } catch (e) {
    // swallow errors to avoid breaking UI
  }
};

// Apply image meta supplied by server (data attributes or metadata object)
window.applyImageBgFromMeta = function (img) {
  try {
    if (!img) return;
    const container = img.closest && img.closest(".product-image");
    if (!container) return;
    const ds = img.dataset || {};
    const r = ds.bgR || ds.imageBgR || null;
    const g = ds.bgG || ds.imageBgG || null;
    const b = ds.bgB || ds.imageBgB || null;
    const alpha = ds.overlayAlpha || ds.imageOverlayAlpha || null;
    const contrast = ds.contrast || ds.imageContrast || null;
    if (r && g && b) {
      container.style.transition = "background-color 450ms ease";
      container.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
      if (alpha !== null && alpha !== undefined)
        container.style.setProperty("--product-overlay-alpha", String(alpha));
      if (contrast) container.style.setProperty("--product-contrast", contrast);
      // Also expose the rgb vars for advanced CSS usage
      container.style.setProperty("--product-bg-r", String(r));
      container.style.setProperty("--product-bg-g", String(g));
      container.style.setProperty("--product-bg-b", String(b));
    }
  } catch (e) {
    /* ignore */
  }
};

// Authentication functions
async function handleLogin(e) {
  e.preventDefault();

  const formData = new FormData(e.target);
  const loginData = {
    email: formData.get("email"),
    password: formData.get("password"),
  };

  try {
    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(loginData),
    });

    const data = await response.json();

    if (data.success) {
      localStorage.setItem("serveNowToken", data.token);
      localStorage.setItem("serveNowUser", JSON.stringify(data.user));
      currentUser = data.user;
      showSuccess("Login Successful", "Logged in successfully!");

      // Redirect based on user type
      if (data.user.user_type === "admin" || data.user.user_type === "standard_user") {
        window.location.href = "admin.html";
      } else if (data.user.user_type === "rider") {
        window.location.href = "rider.html";
      } else {
        window.location.href = "index.html";
      }
    } else if (data.requires_verification === true) {
      showWarning("Verification Required", "Please verify your email to continue.");
      showVerificationModal(loginData.email);
    } else {
      showError(
        "Login Failed",
        data.message || "Login failed. Please try again."
      );
    }
  } catch (error) {
    console.error("Login error:", error);
    showError("Error", "Login failed. Please try again.");
  }
}

async function handleRegister(e) {
  e.preventDefault();

  const formData = new FormData(e.target);
  const registerData = {
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    address: formData.get("address"),
    password: formData.get("password"),
    userType: formData.get("userType") || "customer",
  };

  // Validate password confirmation
  if (registerData.password !== formData.get("confirmPassword")) {
    showWarning("Invalid Password", "Passwords do not match");
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/auth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(registerData),
    });

    const data = await response.json();

    if (data.success && data.requires_verification === true) {
      showSuccess("Account Created", "Please verify your email to activate your account.");
      showVerificationModal(registerData.email);
    } else if (data.success) {
      localStorage.setItem("serveNowToken", data.token);
      localStorage.setItem("serveNowUser", JSON.stringify(data.user));
      currentUser = data.user;
      showSuccess("Registration Successful", "Registration successful!");

      // Redirect based on user type
      if (data.user.user_type === "admin" || data.user.user_type === "standard_user") {
        window.location.href = "admin.html";
      } else {
        window.location.href = "index.html";
      }
    } else {
      showError(
        "Registration Failed",
        data.message || "Registration failed. Please try again."
      );
    }
  } catch (error) {
    console.error("Registration error:", error);
    showError("Error", "Registration failed. Please try again.");
  }
}

async function verifyEmailCode(email, code) {
  try {
    const response = await fetch(`${API_BASE}/api/auth/verify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    const data = await response.json();
    if (data.success) {
      hideVerificationModal();
      showSuccess("Email Verified", "Please login to continue.");
      window.location.href = "login.html";
    } else {
      showError("Verification Failed", data.message || "Invalid or expired code.");
    }
  } catch (error) {
    console.error("Verification error:", error);
    showError("Error", "Verification failed. Please try again.");
  }
}

async function resendVerificationCode(email) {
  try {
    const response = await fetch(`${API_BASE}/api/auth/resend-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await response.json();
    if (data.success) {
      showSuccess("Code Sent", "Verification code sent to your email.");
    } else {
      showError("Failed", data.message || "Could not resend code.");
    }
  } catch (error) {
    console.error("Resend code error:", error);
    showError("Error", "Failed to resend code. Please try again.");
  }
}

function showVerificationModal(email) {
  let modal = document.getElementById("verificationModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "verificationModal";
    modal.className = "modal";
    modal.innerHTML = `
      <div class="modal-content">
        <span class="close" onclick="hideVerificationModal()">&times;</span>
        <h3>Email Verification</h3>
        <form id="verificationForm">
          <div class="form-group">
            <label for="verificationEmail">Email</label>
            <input type="email" id="verificationEmail" required>
          </div>
          <div class="form-group">
            <label for="verificationCode">6-digit Code</label>
            <input type="text" id="verificationCode" required maxlength="6" minlength="6" pattern="\\d{6}">
          </div>
          <div class="modal-footer">
            <button type="submit" class="btn btn-primary">Verify</button>
            <button type="button" class="btn btn-secondary" id="resendCodeBtn">Resend Code</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById("verificationForm").addEventListener("submit", function (e) {
      e.preventDefault();
      const em = document.getElementById("verificationEmail").value;
      const code = document.getElementById("verificationCode").value;
      verifyEmailCode(em, code);
    });
    document.getElementById("resendCodeBtn").addEventListener("click", function () {
      const em = document.getElementById("verificationEmail").value;
      if (!em) {
        showWarning("Email Required", "Please enter your email.");
        return;
      }
      resendVerificationCode(em);
    });
  }
  const emailInput = document.getElementById("verificationEmail");
  if (emailInput && email) {
    emailInput.value = email;
  }
  modal.style.display = "block";
  setTimeout(() => modal.classList.add("show"), 10);
}

function hideVerificationModal() {
  const modal = document.getElementById("verificationModal");
  if (modal) {
    modal.classList.remove("show");
    setTimeout(() => {
      modal.style.display = "none";
      const form = document.getElementById("verificationForm");
      if (form) form.reset();
    }, 300);
  }
}
// Form validation
function validateForm(formId) {
  const form = document.getElementById(formId);
  if (!form) return false;

  const inputs = form.querySelectorAll(
    "input[required], select[required], textarea[required]"
  );
  let isValid = true;
  let missingFields = [];

  inputs.forEach((input) => {
    // Skip hidden inputs (type="hidden")
    if (input.type === 'hidden') return;

    // Skip visually hidden inputs
    const style = window.getComputedStyle(input);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    
    // Skip inputs inside hidden parents
    if (input.offsetParent === null && style.position !== 'fixed') return;

    if (!input.value.trim()) {
      input.style.borderColor = "red";
      isValid = false;
      // Get field label or name for error message
      let fieldName = input.getAttribute('name') || input.id;
      const label = form.querySelector(`label[for="${input.id}"]`);
      if (label) fieldName = label.textContent;
      missingFields.push(fieldName);
    } else {
      input.style.borderColor = "#ddd";
    }
  });

  if (!isValid && missingFields.length > 0) {
      // Store missing fields in a data attribute or global to be used by the caller if needed, 
      // or just rely on the side effect of red borders.
      // We will update the showWarning call in the event listener to include this info.
      form.dataset.missingFields = missingFields.join(", ");
  }

  return isValid;
}

function logout() {
  localStorage.clear();
  window.location.href = "login.html";
}

async function changePassword(currentPassword, newPassword) {
  try {
    const token = localStorage.getItem("serveNowToken");
    const response = await fetch(`${API_BASE}/api/auth/change-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    const data = await response.json();
    if (data.success) {
      showSuccess("Success", "Password changed successfully!");
      hideChangePasswordModal();
    } else {
      showError("Error", data.message || "Failed to change password");
    }
  } catch (error) {
    console.error("Change password error:", error);
    showError("Error", "An error occurred while changing password");
  }
}

function showChangePasswordModal() {
  let modal = document.getElementById("changePasswordModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "changePasswordModal";
    modal.className = "modal";
    modal.innerHTML = `
            <div class="modal-content">
                <span class="close" onclick="hideChangePasswordModal()">&times;</span>
                <h3>Change Password</h3>
                <form id="changePasswordForm">
                    <div class="form-group">
                        <label for="currentPassword">Current Password</label>
                        <input type="password" id="currentPassword" required>
                    </div>
                    <div class="form-group">
                        <label for="newPassword">New Password</label>
                        <input type="password" id="newPassword" required minlength="6">
                    </div>
                    <div class="form-group">
                        <label for="confirmNewPassword">Confirm New Password</label>
                        <input type="password" id="confirmNewPassword" required minlength="6">
                    </div>
                    <div class="modal-footer">
                        <button type="submit" class="btn btn-primary">Update Password</button>
                        <button type="button" class="btn btn-secondary" onclick="hideChangePasswordModal()">Cancel</button>
                    </div>
                </form>
            </div>
        `;
    document.body.appendChild(modal);

    document
      .getElementById("changePasswordForm")
      .addEventListener("submit", function (e) {
        e.preventDefault();
        const currentPwd = document.getElementById("currentPassword").value;
        const newPwd = document.getElementById("newPassword").value;
        const confirmPwd = document.getElementById("confirmNewPassword").value;

        if (newPwd !== confirmPwd) {
          showWarning("Validation Error", "New passwords do not match");
          return;
        }

        changePassword(currentPwd, newPwd);
      });
  }
  modal.style.display = "block";
  setTimeout(() => modal.classList.add("show"), 10);
}

function hideChangePasswordModal() {
  const modal = document.getElementById("changePasswordModal");
  if (modal) {
    modal.classList.remove("show");
    setTimeout(() => {
      modal.style.display = "none";
      const form = document.getElementById("changePasswordForm");
      if (form) form.reset();
    }, 300);
  }
}

// Initialize the app
document.addEventListener("DOMContentLoaded", function () {
  // Mobile menu toggle (available on pages with menuToggle/navMenu)
  try {
    const menuToggle = document.getElementById("menuToggle");
    const navMenu = document.getElementById("navMenu");
    if (menuToggle && navMenu) {
      menuToggle.addEventListener("click", function (e) {
        e.stopPropagation();
        navMenu.classList.toggle("active");
        menuToggle.classList.toggle("active");
        navMenu.style.transform = "";
        navMenu.style.opacity = "";
        navMenu.style.visibility = "";
        navMenu.style.display = "";
      });
      const navLinks = navMenu.querySelectorAll("a");
      navLinks.forEach((link) => {
        link.addEventListener("click", function () {
          navMenu.classList.remove("active");
          menuToggle.classList.remove("active");
          navMenu.style.transform = "";
          navMenu.style.opacity = "";
          navMenu.style.visibility = "";
          navMenu.style.display = "";
        });
      });
      document.addEventListener("click", function (event) {
        if (
          !navMenu.contains(event.target) &&
          !menuToggle.contains(event.target)
        ) {
          navMenu.classList.remove("active");
          menuToggle.classList.remove("active");
          navMenu.style.transform = "";
          navMenu.style.opacity = "";
          navMenu.style.visibility = "";
          navMenu.style.display = "";
        }
      });
    }
  } catch (e) {
    /* ignore toggle wiring errors */
  }
  // Redirect to login if not authenticated
  const currentPage = window.location.pathname;
  const isLoginPage = currentPage.includes("login.html");
  const isRegisterPage = currentPage.includes("register.html");

  const token = localStorage.getItem("serveNowToken");
  const path = (currentPage || "").toLowerCase();
  const publicPages = [
    "index.html",
    "stores.html",
    "store.html",
    "products.html",
    "cart.html",
    "login.html",
    "register.html",
    "forgot-password.html",
    "reset-password.html",
    "data-deletion.html",
  ];
  const isPublic =
    publicPages.some((p) => path.endsWith(p)) ||
    path === "/" ||
    path === "" ||
    path.endsWith("/");
  if (!token && !isPublic) {
    window.location.href = "login.html";
    return;
  }

  // Hide Home/Stores/Cart navigation on login page
  if (isLoginPage) {
    const navUl = document.querySelector("nav ul");
    if (navUl) {
      // Keep only non-navigation items (like login/register links if they exist)
      const listItems = navUl.querySelectorAll("li");
      listItems.forEach((item) => {
        const link = item.querySelector("a");
        if (link) {
          const href = link.getAttribute("href");
          // Hide Home, Stores, Cart links
          if (
            href &&
            (href.includes("index.html") ||
              href.includes("stores.html") ||
              href.includes("cart.html"))
          ) {
            item.style.display = "none";
          }
        }
      });
    }
  }
  // Update nav if logged in - handle different user types
  else if (token) {
    updateNavigation();
  }

  updateCartCount();

  // Get location button
  const getLocationBtn = document.getElementById("getLocation");
  if (getLocationBtn) {
    getLocationBtn.addEventListener("click", getUserLocation);
  }

  const formatPhoneValue = (raw) => {
    const digits = String(raw || "").replace(/[^\d]/g, "");
    let local = digits.replace(/^92/, "");
    if (local.length > 10) local = local.slice(0, 10);
    return "+92" + local;
  };
  const attachPhoneFormatterTo = (input) => {
    if (!input) return;
    const ensurePrefix = () => {
      if (!input.value || !String(input.value).startsWith("+92")) {
        input.value = formatPhoneValue(input.value);
      }
    };
    input.addEventListener("focus", ensurePrefix);
    input.addEventListener("keydown", function (e) {
      const v = String(input.value || "");
      if (
        (e.key === "Backspace" || e.key === "Delete") &&
        input.selectionStart <= 3
      ) {
        e.preventDefault();
        input.setSelectionRange(3, 3);
      }
    });
    input.addEventListener("input", function () {
      const start = input.selectionStart;
      input.value = formatPhoneValue(input.value);
      const pos = Math.max(3, start);
      input.setSelectionRange(pos, pos);
    });
    input.addEventListener("blur", ensurePrefix);
    ensurePrefix();
  };
  window.attachPhoneFormatterTo = attachPhoneFormatterTo;
  const phoneInputs = Array.from(
    document.querySelectorAll(
      'input[type="tel"][name="phone"], #phone, #userPhone, #storePhone, #riderPhone'
    )
  );
  phoneInputs.forEach(attachPhoneFormatterTo);

  // Load products if on products page
  const urlParams = new URLSearchParams(window.location.search);
  const category = urlParams.get("category");
  if (category) {
    loadProducts(category);
  }

  // Display cart if on cart page
  if (document.getElementById("cartItems")) {
    displayCart();
  }

  // Display featured stores on homepage (Bottom Section, Horizontal Scroll)
  if (document.getElementById("allStoresHorizontal")) {
    displayAllStoresHorizontal();

    // Populate Store Category Filter
    const storeCategoryFilter = document.getElementById("storeCategoryFilter");
    if (storeCategoryFilter) {
      fetch(`${API_BASE}/api/categories`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            data.categories.forEach((cat) => {
              const opt = document.createElement("option");
              opt.value = cat.slug;
              opt.textContent = cat.name;
              storeCategoryFilter.appendChild(opt);
            });
          }
        })
        .catch((e) => console.error("Error loading filter categories:", e));
    }

    // Filter Event Listeners
    const storeSearch = document.getElementById("storeSearch");
    const clearStoreFiltersBtn = document.getElementById(
      "clearStoreFiltersBtn"
    );

    const applyStoreFilters = () => {
      const search = storeSearch ? storeSearch.value : "";
      const category = storeCategoryFilter ? storeCategoryFilter.value : "";
      // Use the new handleStoreSearch function
      handleStoreSearch({ search, category });
    };

    if (storeSearch) {
      storeSearch.addEventListener("input", applyStoreFilters);
    }
    if (storeCategoryFilter) {
      storeCategoryFilter.addEventListener("change", applyStoreFilters);
    }
    if (clearStoreFiltersBtn) {
      clearStoreFiltersBtn.addEventListener("click", () => {
        if (storeSearch) storeSearch.value = "";
        if (storeCategoryFilter) storeCategoryFilter.value = "";
        applyStoreFilters();
      });
    }
  }

  // Form submission
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");

  if (loginForm) {
    loginForm.addEventListener("submit", handleLogin);
  }

  if (registerForm) {
    registerForm.addEventListener("submit", handleRegister);
  }

  // Other forms
  const otherForms = document.querySelectorAll(
    "form:not(#loginForm):not(#registerForm)"
  );
  otherForms.forEach((form) => {
    form.addEventListener("submit", function (e) {
      if (!validateForm(form.id)) {
        e.preventDefault();
        showWarning("Incomplete Form", "Please fill in all required fields.");
      }
    });
  });
});

