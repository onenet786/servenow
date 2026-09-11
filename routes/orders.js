const express = require("express");
const axios = require("axios");
const { body, validationResult } = require("express-validator");
const {
  authenticateToken,
  requireAdmin,
  requireStoreOwner,
  requireDispatchAccess,
  requireStaffAccess,
} = require("../middleware/auth");
const { sendOrderThanksEmail } = require("../services/emailService");
const { recordFinancialTransaction } = require("../utils/dbHelpers");
const { sendPushToUser } = require("../services/pushNotifications");
const {
  ensureStoreOfferCampaignTables,
  getActiveStoreCampaignsMap,
  campaignsForProduct,
  applyCampaignToCartLine,
} = require("../utils/offerCampaigns");

const router = express.Router();

const DEFAULT_BASE_DELIVERY_FEE = 70;
const DEFAULT_PARCEL_DELIVERY_FEE = 150;
const DEFAULT_ADDITIONAL_STORE_FEE = 30;
const RESTRICTED_FINANCIAL_REPORT_EMAILS = new Set(
  String(process.env.PRIVILEGED_ADMIN_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean)
);
const riderReverseGeocodeCache = new Map();
const riderReverseGeocodePending = new Map();

function orderBusinessDateSql(columnName = "o.created_at") {
  return `DATE(${columnName})`;
}

function canViewRestrictedFinancialReports(req) {
  const email = String(req.user && req.user.email ? req.user.email : "")
    .trim()
    .toLowerCase();
  return RESTRICTED_FINANCIAL_REPORT_EMAILS.has(email);
}

async function ensureSystemSettingsTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS system_settings (
      setting_key VARCHAR(120) PRIMARY KEY,
      setting_value VARCHAR(255) NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

async function getDeliveryFeeConfig(db) {
  await ensureSystemSettingsTable(db);
  const [rows] = await db.execute(
    `SELECT setting_key, setting_value
     FROM system_settings
     WHERE setting_key IN ('delivery_fee_base', 'delivery_fee_additional_per_store')`
  );

  const map = new Map(rows.map((r) => [r.setting_key, r.setting_value]));
  const parsedBase = Number.parseFloat(map.get("delivery_fee_base"));
  const parsedAdditional = Number.parseFloat(
    map.get("delivery_fee_additional_per_store")
  );

  const base_fee = Number.isFinite(parsedBase) && parsedBase >= 0
    ? parsedBase
    : DEFAULT_BASE_DELIVERY_FEE;
  const additional_per_store = Number.isFinite(parsedAdditional) &&
      parsedAdditional >= 0
    ? parsedAdditional
    : DEFAULT_ADDITIONAL_STORE_FEE;

  if (!map.has("delivery_fee_base")) {
    await db.execute(
      `INSERT INTO system_settings (setting_key, setting_value)
       VALUES ('delivery_fee_base', ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [String(base_fee)]
    );
  }
  if (!map.has("delivery_fee_additional_per_store")) {
    await db.execute(
      `INSERT INTO system_settings (setting_key, setting_value)
       VALUES ('delivery_fee_additional_per_store', ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [String(additional_per_store)]
    );
  }

  return { base_fee, additional_per_store };
}

function calculateDeliveryFeeByStoreCount(storeCount, feeConfig) {
  const cfg = feeConfig || {
    base_fee: DEFAULT_BASE_DELIVERY_FEE,
    additional_per_store: DEFAULT_ADDITIONAL_STORE_FEE,
  };
  if (!storeCount || storeCount <= 0) return 0;
  if (storeCount === 1) return Number(cfg.base_fee) || DEFAULT_BASE_DELIVERY_FEE;
  return (
    (Number(cfg.base_fee) || DEFAULT_BASE_DELIVERY_FEE) +
    (storeCount - 1) *
      (Number(cfg.additional_per_store) || DEFAULT_ADDITIONAL_STORE_FEE)
  );
}

async function loadProductSizeVariants(db, productIds) {
  try {
    const ids = (Array.isArray(productIds) ? productIds : [])
      .map((x) => parseInt(String(x), 10))
      .filter((x) => Number.isInteger(x) && x > 0);
    if (!ids.length) return {};

    const placeholders = ids.map(() => "?").join(",");
    const [rows] = await db.execute(
      `
        SELECT psp.product_id, psp.size_id, psp.unit_id, psp.price, psp.cost_price,
               sz.label as size_label, u.name as unit_name, u.abbreviation as unit_abbreviation
        FROM product_size_prices psp
        LEFT JOIN sizes sz ON psp.size_id = sz.id
        LEFT JOIN units u ON psp.unit_id = u.id
        WHERE psp.product_id IN (${placeholders})
        ORDER BY psp.product_id ASC, psp.sort_order ASC, psp.id ASC
      `,
      ids
    );

    const out = {};
    for (const row of rows || []) {
      const productId = Number(row.product_id);
      if (!out[productId]) out[productId] = [];
      out[productId].push({
        size_id:
          row.size_id === null || row.size_id === undefined
            ? null
            : Number(row.size_id),
        unit_id:
          row.unit_id === null || row.unit_id === undefined
            ? null
            : Number(row.unit_id),
        size_label: row.size_label || null,
        unit_name: row.unit_name || null,
        unit_abbreviation: row.unit_abbreviation || null,
        price: Number(row.price),
        cost_price:
          row.cost_price === null || row.cost_price === undefined
            ? null
            : Number(row.cost_price),
      });
    }

    return out;
  } catch (error) {
    return {};
  }
}

function formatVariantLabel(sizeLabel, unitName, unitAbbreviation) {
  const safeSize = sizeLabel ? String(sizeLabel).trim() : "";
  const safeUnit = unitAbbreviation || unitName
    ? String(unitAbbreviation || unitName).trim()
    : "";
  if (safeSize && safeUnit) return `${safeSize} ${safeUnit}`;
  return safeSize || safeUnit || null;
}

async function getAdminPushRecipients(db) {
  try {
    const [rows] = await db.execute(
      `SELECT id, user_type
       FROM users
       WHERE LOWER(COALESCE(user_type, '')) IN ('admin', 'standard_user')`
    );
    return (rows || [])
      .map((row) => ({
        id: Number.parseInt(String(row.id), 10),
        user_type: String(row.user_type || "").trim().toLowerCase(),
      }))
      .filter(
        (row) =>
          Number.isInteger(row.id) &&
          row.id > 0 &&
          (row.user_type === "admin" || row.user_type === "standard_user")
      );
  } catch (error) {
    console.error("[Orders] Failed to load admin push recipients:", error);
    return [];
  }
}

async function getCustomerSupportContact(db) {
  await ensureSystemSettingsTable(db);
  const [settingRows] = await db.execute(
    `SELECT setting_key, setting_value
     FROM system_settings
     WHERE setting_key IN ('support_phone', 'support_whatsapp', 'support_email', 'support_name')`
  );

  const settings = new Map(settingRows.map((row) => [row.setting_key, row.setting_value]));
  let phone = String(settings.get("support_phone") || "").trim();
  let whatsapp = String(settings.get("support_whatsapp") || "").trim();
  let email = String(settings.get("support_email") || "").trim();
  let name = String(settings.get("support_name") || "").trim();

  if (!phone || !email || !name) {
    const [adminRows] = await db.execute(
      `SELECT first_name, last_name, email, phone
       FROM users
       WHERE user_type = 'admin'
       ORDER BY id ASC
       LIMIT 1`
    );
    if (adminRows.length) {
      const admin = adminRows[0];
      if (!phone) phone = String(admin.phone || "").trim();
      if (!email) email = String(admin.email || "").trim();
      if (!name) {
        name = `${String(admin.first_name || "").trim()} ${String(admin.last_name || "").trim()}`.trim();
      }
    }
  }

  // Ensure WhatsApp matches the call contact number
  if (phone) {
    whatsapp = phone;
  } else if (!whatsapp) {
    whatsapp = phone;
  }
  if (!name) name = "ServeNow Support";

  return {
    name,
    phone,
    whatsapp,
    email,
  };
}

function isProfitPaymentTerm(term) {
  const t = String(term || "").toLowerCase().trim();
  return t === "cash only" || t === "credit";
}

function isDiscountPaymentTerm(term) {
  const t = String(term || "").toLowerCase().trim();
  return t.includes("discount");
}

function normalizeAdjustmentType(rawType) {
  const t = String(rawType || "").toLowerCase().trim();
  if (t === "percent" || t === "%") return "percent";
  if (t === "amount" || t === "pkr" || t === "fixed") return "amount";
  return null;
}

function normalizeNonNegativeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function deriveOrderItemAdjustmentSnapshot({
  paymentTerm,
  unitPrice,
  productCostPrice,
  discountType,
  discountValue,
  profitType,
  profitValue,
}) {
  const p = normalizeNonNegativeNumber(unitPrice) ?? 0;
  const c = normalizeNonNegativeNumber(productCostPrice);
  const dType = normalizeAdjustmentType(discountType);
  const dVal = normalizeNonNegativeNumber(discountValue);
  const pType = normalizeAdjustmentType(profitType);
  const pVal = normalizeNonNegativeNumber(profitValue);

  if (isProfitPaymentTerm(paymentTerm)) {
    if (pType && pVal !== null) {
      return { type: pType, value: pVal };
    }
    if (c !== null && p >= c) {
      return { type: "amount", value: Math.round((p - c) * 100) / 100 };
    }
    return { type: "amount", value: 0 };
  }

  if (isDiscountPaymentTerm(paymentTerm)) {
    if (dType && dVal !== null) {
      return { type: dType, value: dVal };
    }
    if (c !== null && p >= c) {
      return { type: "amount", value: Math.round((p - c) * 100) / 100 };
    }
    return { type: "amount", value: 0 };
  }

  return { type: null, value: null };
}

async function ensureGlobalDeliveryStatusTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS global_delivery_status (
      id INT PRIMARY KEY AUTO_INCREMENT,
      is_enabled BOOLEAN DEFAULT FALSE,
      block_ordering BOOLEAN DEFAULT FALSE,
      title VARCHAR(120) NULL,
      status_message TEXT NULL,
      start_at DATETIME NULL,
      end_at DATETIME NULL,
      updated_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  const [cols] = await db.execute(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'global_delivery_status'
       AND COLUMN_NAME = 'block_ordering'
     LIMIT 1`
  );
  if (!cols || !cols.length) {
    await db.execute(
      `ALTER TABLE global_delivery_status
       ADD COLUMN block_ordering BOOLEAN DEFAULT FALSE`
    );
  }
}

router.get("/delivery-fee-config", async (req, res) => {
  try {
    const cfg = await getDeliveryFeeConfig(req.db);
    return res.json({ success: true, ...cfg });
  } catch (error) {
    console.error("Error loading delivery fee config:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load delivery fee config",
      error: error.message,
    });
  }
});

async function getGlobalDeliveryBlockState(db) {
  await ensureGlobalDeliveryStatusTable(db);
  const [rows] = await db.execute(
    `SELECT id, is_enabled, block_ordering, status_message, start_at, end_at
     FROM global_delivery_status
     ORDER BY id DESC
     LIMIT 1`
  );
  const row = rows[0];
  if (!row || !row.is_enabled) return { blocked: false, message: "" };
  const start = row.start_at ? new Date(row.start_at) : null;
  const end = row.end_at ? new Date(row.end_at) : null;
  const now = new Date();
  const inWindow =
    start &&
    end &&
    !Number.isNaN(start.getTime()) &&
    !Number.isNaN(end.getTime()) &&
    now >= start &&
    now <= end;

  if (end && !Number.isNaN(end.getTime()) && now > end) {
    await db.execute(
      `UPDATE global_delivery_status
       SET is_enabled = 0,
           block_ordering = 0,
           title = NULL,
           status_message = NULL,
           start_at = NULL,
           end_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [row.id]
    );
    return { blocked: false, message: "" };
  }

  if (!inWindow || !row.block_ordering) return { blocked: false, message: "" };
  return {
    blocked: true,
    message:
      row.status_message ||
      "Delivery is temporarily unavailable in this time window.",
  };
}

async function hasColumn(db, table, column) {
  const [rows] = await db.execute(
    "SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column],
  );
  return rows && rows[0] && rows[0].cnt > 0;
}

async function ensureOrderItemsSchema(db) {
  const columns = [
    { name: "size_id", definition: "INT NULL" },
    { name: "unit_id", definition: "INT NULL" },
    { name: "variant_label", definition: "VARCHAR(255) NULL" },
    { name: "cost_price", definition: "DECIMAL(10, 2) NULL" },
    {
      name: "store_id",
      definition: "INT NULL",
      constraint:
        "FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE SET NULL",
    },
    { name: "discount_type", definition: "ENUM('amount', 'percent') NULL" },
    { name: "discount_value", definition: "DECIMAL(10, 2) NULL" },
    {
      name: "item_status",
      definition:
        "ENUM('pending', 'confirmed', 'preparing', 'ready', 'ready_for_pickup', 'picked_up', 'out_for_delivery', 'delivered', 'cancelled') DEFAULT 'pending'",
    },
  ];

  for (const col of columns) {
    try {
      const exists = await hasColumn(db, "order_items", col.name);
      if (!exists) {
        await db.execute(
          `ALTER TABLE order_items ADD COLUMN ${col.name} ${col.definition}`,
        );
        if (col.constraint) {
          try {
            await db.execute(`ALTER TABLE order_items ADD ${col.constraint}`);
          } catch (err) {
            // Constraint might already exist or fail for other reasons
          }
        }
      }
    } catch (e) {
      console.error(`Failed to ensure column ${col.name}:`, e);
    }
  }
  try {
    await db.execute(
      "ALTER TABLE order_items MODIFY COLUMN item_status ENUM('pending','confirmed','preparing','ready','ready_for_pickup','picked_up','out_for_delivery','delivered','cancelled') DEFAULT 'pending'"
    );
  } catch (_) {}
}

async function ensureProductsProfitSchema(db) {
  const columns = [
    { name: "profit_type", definition: "ENUM('amount', 'percent') NULL" },
    { name: "profit_value", definition: "DECIMAL(10, 2) NULL" },
  ];
  for (const col of columns) {
    try {
      const exists = await hasColumn(db, "products", col.name);
      if (!exists) {
        await db.execute(
          `ALTER TABLE products ADD COLUMN ${col.name} ${col.definition}`,
        );
      }
    } catch (e) {
      console.error(`Failed to ensure products.${col.name}:`, e);
    }
  }
}

async function ensureOrdersParentColumn(db) {
  try {
    // Try to select the column to check existence (more robust than information_schema)
    await db.execute("SELECT parent_order_number FROM orders LIMIT 1");
  } catch (e) {
    // If error is about missing column, add it
    if (
      e.code === "ER_BAD_FIELD_ERROR" ||
      (e.message && e.message.includes("Unknown column"))
    ) {
      try {
        await db.execute(
          "ALTER TABLE orders ADD COLUMN parent_order_number VARCHAR(50) NULL",
        );
        try {
          await db.execute(
            "CREATE INDEX idx_orders_parent_order_number ON orders(parent_order_number)",
          );
        } catch (idxErr) {
          // Ignore index creation error
        }
      } catch (alterErr) {
        console.error("Failed to add parent_order_number column:", alterErr);
      }
    }
  }
}

async function ensureOrdersStoreIdNullable(db) {
  try {
    // Check if store_id is nullable (simplified: just try to modify it)
    await db.execute("ALTER TABLE orders MODIFY COLUMN store_id INT NULL");
  } catch (e) {
    // Ignore if already nullable or other non-critical errors
    // console.error('Failed to make store_id nullable:', e);
  }
}

async function ensureRiderLocationColumns(db) {
  try {
    const hasRiderLatitude = await hasColumn(db, "orders", "rider_latitude");
    if (!hasRiderLatitude) {
      await db.execute(
        "ALTER TABLE orders ADD COLUMN rider_latitude DECIMAL(10, 8) NULL",
      );
    }
  } catch (e) {
    console.error("Failed to add rider_latitude column:", e);
  }

  try {
    const hasRiderLongitude = await hasColumn(db, "orders", "rider_longitude");
    if (!hasRiderLongitude) {
      await db.execute(
        "ALTER TABLE orders ADD COLUMN rider_longitude DECIMAL(11, 8) NULL",
      );
    }
  } catch (e) {
    console.error("Failed to add rider_longitude column:", e);
  }
}

async function ensureRiderLocationLogsTable(db) {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS rider_location_logs (
        id INT PRIMARY KEY AUTO_INCREMENT,
        rider_id INT NOT NULL,
        order_id INT NULL,
        latitude DECIMAL(10, 8) NOT NULL,
        longitude DECIMAL(11, 8) NOT NULL,
        location_label VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_rider_location_logs_rider_created (rider_id, created_at),
        INDEX idx_rider_location_logs_order_created (order_id, created_at)
      )
    `);
    const hasOrderId = await hasColumn(
      db,
      "rider_location_logs",
      "order_id",
    );
    if (!hasOrderId) {
      await db.execute(
        "ALTER TABLE rider_location_logs ADD COLUMN order_id INT NULL AFTER rider_id",
      );
      try {
        await db.execute(
          "CREATE INDEX idx_rider_location_logs_order_created ON rider_location_logs(order_id, created_at)",
        );
      } catch (_) {}
    }
    const hasLocationLabel = await hasColumn(
      db,
      "rider_location_logs",
      "location_label",
    );
    if (!hasLocationLabel) {
      await db.execute(
        "ALTER TABLE rider_location_logs ADD COLUMN location_label VARCHAR(255) NULL AFTER longitude",
      );
    }
  } catch (e) {
    console.error("Failed to ensure rider_location_logs table:", e);
  }
}

const ACTIVE_RIDER_DELIVERY_STATUSES = [
  "confirmed",
  "preparing",
  "ready",
  "ready_for_pickup",
  "picked_up",
  "out_for_delivery",
];
const ACTIVE_RIDER_DELIVERY_STATUS_SQL = ACTIVE_RIDER_DELIVERY_STATUSES.map(
  (status) => `'${status}'`,
).join(", ");

async function attachItemsToDeliveries(db, deliveries) {
  if (!Array.isArray(deliveries) || deliveries.length === 0) return deliveries;

  const orderIds = deliveries
    .map((delivery) => Number(delivery.id))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (orderIds.length === 0) {
    for (const delivery of deliveries) delivery.items = [];
    return deliveries;
  }

  try {
    const placeholders = orderIds.map(() => "?").join(",");
    const [items] = await db.execute(
      `
        SELECT
          oi.*,
          p.name as product_name,
          p.image_url,
          s.name as store_name
        FROM order_items oi
        LEFT JOIN products p ON oi.product_id = p.id
        LEFT JOIN stores s ON COALESCE(oi.store_id, p.store_id) = s.id
        WHERE oi.order_id IN (${placeholders})
        ORDER BY oi.order_id ASC, oi.id ASC
      `,
      orderIds,
    );
    const itemsByOrder = new Map();
    for (const item of items || []) {
      const orderId = Number(item.order_id);
      if (!itemsByOrder.has(orderId)) itemsByOrder.set(orderId, []);
      itemsByOrder.get(orderId).push(item);
    }
    for (const delivery of deliveries) {
      delivery.items = itemsByOrder.get(Number(delivery.id)) || [];
    }
  } catch (itemError) {
    console.error("Error fetching rider delivery items:", itemError);
    for (const delivery of deliveries) {
      delivery.items = [];
    }
  }

  return deliveries;
}

async function recordPickupPaidStorePaymentsForOrder(db, {
  orderId,
  riderId,
  orderNumber,
  createdBy = null,
}) {
  if (!orderId || !riderId) return [];
  await ensureRiderStorePaymentsTable(db);
  await ensureRiderCashMovementTypes(db);

  const [storesToSettle] = await db.execute(
    `SELECT
       COALESCE(oi.store_id, p.store_id) AS store_id,
       s.name AS store_name,
       s.payment_term,
       COALESCE(SUM(
         COALESCE(oi.cost_price, psp.cost_price, p.cost_price, oi.price) * oi.quantity
       ), 0) AS payable_to_store
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id)
     LEFT JOIN product_size_prices psp
       ON psp.product_id = oi.product_id
      AND (
        (oi.size_id IS NOT NULL AND psp.size_id = oi.size_id AND psp.unit_id IS NULL)
        OR
        (oi.unit_id IS NOT NULL AND psp.unit_id = oi.unit_id AND psp.size_id IS NULL)
      )
     WHERE oi.order_id = ?
       AND LOWER(TRIM(COALESCE(s.payment_term, ''))) IN ('cash only', 'cash with discount')
     GROUP BY COALESCE(oi.store_id, p.store_id), s.name, s.payment_term`,
    [orderId],
  );

  if (!storesToSettle.length) return [];

  const walletInfo = await getOrCreateRiderWallet(db, riderId);
  const [walletOwnerRows] = await db.execute(
    "SELECT rider_id, balance FROM wallets WHERE id = ?",
    [walletInfo.walletId],
  );
  if (
    !walletOwnerRows.length ||
    Number(walletOwnerRows[0].rider_id) !== Number(riderId)
  ) {
    const error = new Error("Rider wallet ownership mismatch during store payment");
    error.statusCode = 409;
    throw error;
  }

  let runningBalance = Number(walletOwnerRows[0].balance || 0);
  const recorded = [];

  for (const store of storesToSettle) {
    const storeId = Number(store.store_id);
    const payable = roundAmount(store.payable_to_store || 0);
    if (!storeId || payable <= 0) continue;

    const [existingPayment] = await db.execute(
      `SELECT id
       FROM rider_store_payments
       WHERE order_id = ? AND store_id = ? AND source_status = 'picked_up'
       LIMIT 1`,
      [orderId, storeId],
    );
    if (existingPayment.length) continue;

    runningBalance = roundAmount(runningBalance - payable);
    await db.execute(
      "UPDATE wallets SET balance = ?, total_spent = total_spent + ? WHERE id = ?",
      [runningBalance, payable, walletInfo.walletId],
    );
    await db.execute(
      `INSERT INTO wallet_transactions
       (wallet_id, type, amount, description, reference_type, reference_id, balance_after)
       VALUES (?, 'debit', ?, ?, 'order', ?, ?)`,
      [
        walletInfo.walletId,
        payable,
        `Paid to pickup-paid store ${store.store_name || storeId} for order #${orderNumber || orderId}`,
        orderId,
        runningBalance,
      ],
    );
    await db.execute(
      `INSERT INTO rider_cash_movements
       (movement_number, rider_id, movement_date, movement_type, amount, description, reference_type, reference_id, status, recorded_by)
       VALUES (?, ?, CURDATE(), 'store_payment', ?, ?, 'order', ?, 'completed', ?)`,
      [
        `RCM-SP-${Date.now()}-${storeId}`,
        riderId,
        payable,
        `Store payment on pickup for ${store.store_name || "Store"} (Order #${orderNumber || orderId})`,
        orderId,
        createdBy,
      ],
    );
    await db.execute(
      `INSERT INTO rider_store_payments
       (order_id, store_id, rider_id, amount, source_status, created_by)
       VALUES (?, ?, ?, ?, 'picked_up', ?)`,
      [orderId, storeId, riderId, payable, createdBy],
    );
    await recordFinancialTransaction(db, {
      transaction_type: "adjustment",
      category: "rider_store_payment",
      description: `Rider paid pickup-paid store (${store.store_name || storeId}) for order #${orderNumber || orderId}`,
      amount: payable,
      payment_method: "cash",
      related_entity_type: "rider",
      related_entity_id: riderId,
      reference_type: "order",
      reference_id: orderId,
      created_by: createdBy,
      notes: "Auto deduction from rider wallet for pickup-paid store",
    });

    recorded.push({ store_id: storeId, amount: payable });
  }

  return recorded;
}

function buildRiderLocationUpdatePayload({
  riderId,
  latitude,
  longitude,
  location,
  orderIds = [],
}) {
  return {
    type: "rider_location_update",
    rider_id: riderId,
    latitude: Number.parseFloat(latitude),
    longitude: Number.parseFloat(longitude),
    location: location || null,
    order_ids: orderIds,
    updated_at: new Date().toISOString(),
  };
}

function emitRiderLocationUpdate(io, payload) {
  if (!io || !payload) return;
  io.to("admins").emit("rider_location_update", payload);
  if (payload.rider_id) {
    io.to(`rider_${payload.rider_id}`).emit("rider_location_update", payload);
  }
}

function formatCoordinateLocationLabel(latitude, longitude) {
  const lat = Number.parseFloat(latitude);
  const lng = Number.parseFloat(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return "";
  }
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

function isCoordinateOnlyLocationLabel(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(text);
}

function resolveFastRiderLocationLabel(latitude, longitude, location) {
  const trimmedLocation = String(location || "").trim();
  if (trimmedLocation && !isCoordinateOnlyLocationLabel(trimmedLocation)) {
    return trimmedLocation;
  }
  return formatCoordinateLocationLabel(latitude, longitude);
}

function buildRiderReverseGeocodeKey(latitude, longitude) {
  const lat = Number.parseFloat(latitude);
  const lng = Number.parseFloat(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return "";
  }
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function formatReverseGeocodeLabel(payload) {
  if (!payload || typeof payload !== "object") return "";
  const address = payload.address || {};
  const parts = [
    address.road,
    address.suburb,
    address.neighbourhood,
    address.city || address.town || address.village,
    address.state,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const deduped = [];
  for (const part of parts) {
    if (!deduped.includes(part)) {
      deduped.push(part);
    }
  }
  if (deduped.length > 0) {
    return deduped.slice(0, 3).join(", ");
  }
  return String(payload.display_name || "").trim();
}

async function reverseGeocodeRiderLocation(latitude, longitude) {
  const fallback = formatCoordinateLocationLabel(latitude, longitude);
  const key = buildRiderReverseGeocodeKey(latitude, longitude);
  if (!key) return fallback;

  const cached = riderReverseGeocodeCache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.label;
  }

  if (riderReverseGeocodePending.has(key)) {
    return riderReverseGeocodePending.get(key);
  }

  const request = axios
    .get("https://nominatim.openstreetmap.org/reverse", {
      params: {
        format: "jsonv2",
        lat: Number.parseFloat(latitude),
        lon: Number.parseFloat(longitude),
        zoom: 18,
        addressdetails: 1,
      },
      timeout: 5000,
      headers: {
        "User-Agent": "ServeNow/1.0 rider-location",
      },
    })
    .then((response) => {
      const label = formatReverseGeocodeLabel(response.data) || fallback;
      riderReverseGeocodeCache.set(key, {
        label,
        expiresAt: now + 1000 * 60 * 60 * 12,
      });
      return label;
    })
    .catch((error) => {
      console.warn("Reverse geocoding rider location failed:", error.message);
      riderReverseGeocodeCache.set(key, {
        label: fallback,
        expiresAt: now + 1000 * 60 * 10,
      });
      return fallback;
    })
    .finally(() => {
      riderReverseGeocodePending.delete(key);
    });

  riderReverseGeocodePending.set(key, request);
  return request;
}

function compressLocationHistory(rows, maxPoints) {
  if (!Array.isArray(rows) || rows.length <= maxPoints) return rows;
  if (maxPoints <= 2) {
    return [rows[0], rows[rows.length - 1]];
  }

  const compressed = [rows[0]];
  const interiorSlots = maxPoints - 2;
  const lastIndex = rows.length - 1;

  for (let i = 1; i <= interiorSlots; i += 1) {
    const index = Math.round((i * lastIndex) / (interiorSlots + 1));
    compressed.push(rows[index]);
  }

  compressed.push(rows[lastIndex]);
  return compressed;
}

function calculateLocationDistanceKm(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return 0;

  const toRadians = (value) => (value * Math.PI) / 180;
  let previous = null;
  let meters = 0;

  for (const row of rows) {
    const latitude = Number.parseFloat(row.latitude);
    const longitude = Number.parseFloat(row.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

    const current = { latitude, longitude };
    if (previous) {
      const earthRadiusMeters = 6371000;
      const dLat = toRadians(current.latitude - previous.latitude);
      const dLng = toRadians(current.longitude - previous.longitude);
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(previous.latitude)) *
          Math.cos(toRadians(current.latitude)) *
          Math.sin(dLng / 2) *
          Math.sin(dLng / 2);
      const segmentMeters =
        earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      // Ignore obvious GPS jumps while keeping normal city delivery movement.
      if (Number.isFinite(segmentMeters) && segmentMeters >= 3 && segmentMeters <= 5000) {
        meters += segmentMeters;
      }
    }
    previous = current;
  }

  return Number((meters / 1000).toFixed(3));
}

function summarizeLocationRows(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  return {
    points: safeRows.length,
    distance_km: calculateLocationDistanceKm(safeRows),
    started_at: safeRows[0]?.created_at || null,
    updated_at: safeRows[safeRows.length - 1]?.created_at || null,
  };
}

function roundAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

async function syncOrderFinancialsAndDeliveryFee(db, orderId, options = {}) {
  const [orders] = await db.execute(
    "SELECT id, order_number, status, delivery_fee, total_amount, special_instructions FROM orders WHERE id = ?",
    [orderId]
  );
  if (!orders || orders.length === 0) return null;
  const order = orders[0];

  const [items] = await db.execute(
    `SELECT oi.id, oi.product_id, oi.quantity, oi.price,
            COALESCE(oi.store_id, p.store_id) AS effective_store_id
     FROM order_items oi
     LEFT JOIN products p ON oi.product_id = p.id
     WHERE oi.order_id = ?`,
    [orderId]
  );

  let itemsSubtotal = 0;
  const storeIds = new Set();
  for (const item of items) {
    const qty = parseInt(item.quantity, 10) || 0;
    const price = parseFloat(item.price) || 0;
    itemsSubtotal += qty * price;
    if (item.effective_store_id) {
      storeIds.add(Number(item.effective_store_id));
    }
  }
  itemsSubtotal = roundAmount(itemsSubtotal);

  const storeCount = storeIds.size;
  let newOrderStoreId = null;
  if (storeCount === 1) {
    newOrderStoreId = Array.from(storeIds)[0];
  }

  const isParcelOrder = Boolean(
    order.special_instructions &&
    String(order.special_instructions).includes("Pick & Drop Parcel")
  );

  let deliveryFee;
  if (isParcelOrder) {
    deliveryFee = DEFAULT_PARCEL_DELIVERY_FEE;
  } else if (
    options.manualDeliveryFee !== undefined &&
    options.manualDeliveryFee !== null &&
    !isNaN(parseFloat(options.manualDeliveryFee))
  ) {
    deliveryFee = roundAmount(parseFloat(options.manualDeliveryFee));
  } else {
    const deliveryFeeConfig = await getDeliveryFeeConfig(db);
    deliveryFee = calculateDeliveryFeeByStoreCount(storeCount, deliveryFeeConfig);
  }

  const newTotalAmount = roundAmount(itemsSubtotal + deliveryFee);

  await db.execute(
    "UPDATE orders SET total_amount = ?, delivery_fee = ?, store_id = ? WHERE id = ?",
    [newTotalAmount, deliveryFee, newOrderStoreId, orderId]
  );

  return {
    order_id: orderId,
    subtotal: itemsSubtotal,
    delivery_fee: deliveryFee,
    total_amount: newTotalAmount,
    store_count: storeCount,
    store_id: newOrderStoreId,
  };
}

async function generateOrderNumber(db) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const datePart = `${yy}${mm}${dd}`;
  const prefix = `Ord${datePart}`;

  const [rows] = await db.execute(
    "SELECT order_number FROM orders WHERE order_number LIKE ? ORDER BY order_number DESC LIMIT 1",
    [`${prefix}%`],
  );

  let sequence = 1;
  if (rows && rows.length > 0) {
    const lastOrderNumber = rows[0].order_number;
    const lastSequenceStr = lastOrderNumber.slice(-4);
    if (/^\d{4}$/.test(lastSequenceStr)) {
      sequence = parseInt(lastSequenceStr, 10) + 1;
    }
  }
  return `${prefix}${String(sequence).padStart(4, "0")}`;
}

async function ensureRiderStorePaymentsTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS rider_store_payments (
      id INT PRIMARY KEY AUTO_INCREMENT,
      order_id INT NOT NULL,
      store_id INT NOT NULL,
      rider_id INT NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      source_status VARCHAR(40) NOT NULL DEFAULT 'picked_up',
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_rider_store_payment (order_id, store_id, source_status),
      INDEX idx_rsp_rider (rider_id),
      INDEX idx_rsp_store (store_id),
      INDEX idx_rsp_order (order_id)
    )
  `);
}

async function ensureRiderCashMovementTypes(db) {
  try {
    await db.execute(
      `ALTER TABLE rider_cash_movements
       MODIFY COLUMN movement_type ENUM('cash_collection', 'cash_submission', 'advance', 'settlement', 'adjustment', 'store_payment', 'fuel_payment') NOT NULL`
    );
  } catch (_) {}
}

async function ensureRiderDayClosingsTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS rider_day_closings (
      id INT PRIMARY KEY AUTO_INCREMENT,
      rider_id INT NOT NULL,
      closed_date DATE NOT NULL,
      wallet_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
      cash_collection DECIMAL(12,2) NOT NULL DEFAULT 0,
      office_advance DECIMAL(12,2) NOT NULL DEFAULT 0,
      store_payment DECIMAL(12,2) NOT NULL DEFAULT 0,
      fuel_payment DECIMAL(12,2) NOT NULL DEFAULT 0,
      delivery_fee_earned DECIMAL(12,2) NOT NULL DEFAULT 0,
      notes TEXT NULL,
      closed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_rider_close_day (rider_id, closed_date),
      INDEX idx_rider_close_day (rider_id, closed_date)
    )
  `);
}

async function ensureRiderCashSubmissionOrdersTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS rider_cash_submission_orders (
      id INT PRIMARY KEY AUTO_INCREMENT,
      movement_id INT NOT NULL,
      order_id INT NOT NULL,
      rider_id INT NOT NULL,
      order_number VARCHAR(64) NULL,
      order_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_movement_order (movement_id, order_id),
      KEY idx_rcso_order (order_id),
      KEY idx_rcso_rider (rider_id),
      KEY idx_rcso_movement (movement_id)
    )
  `);
}

function isRiderPickupPaidPaymentTerm(term) {
  return ["cash only", "cash with discount"].includes(
    String(term || "").toLowerCase().trim()
  );
}

function normalizeDateOnlyInput(value) {
  const v = String(value || "").trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

async function ensureStoreFinancialColumns(db) {
  try {
    const hasGraceDays = await hasColumn(db, "stores", "payment_grace_days");
    if (!hasGraceDays) {
      await db.execute(
        "ALTER TABLE stores ADD COLUMN payment_grace_days INT NULL"
      );
    }
    const hasGraceStartDate = await hasColumn(
      db,
      "stores",
      "payment_grace_start_date",
    );
    if (!hasGraceStartDate) {
      await db.execute(
        "ALTER TABLE stores ADD COLUMN payment_grace_start_date DATE NULL",
      );
    }
    const hasGraceAlertMutedUntil = await hasColumn(
      db,
      "stores",
      "grace_alert_muted_until",
    );
    if (!hasGraceAlertMutedUntil) {
      await db.execute(
        "ALTER TABLE stores ADD COLUMN grace_alert_muted_until DATETIME NULL",
      );
    }
    const hasStoreDiscountApply = await hasColumn(
      db,
      "stores",
      "store_discount_apply_all_products",
    );
    if (!hasStoreDiscountApply) {
      await db.execute(
        "ALTER TABLE stores ADD COLUMN store_discount_apply_all_products TINYINT(1) NOT NULL DEFAULT 0",
      );
    }
    const hasStoreDiscountPercent = await hasColumn(
      db,
      "stores",
      "store_discount_percent",
    );
    if (!hasStoreDiscountPercent) {
      await db.execute(
        "ALTER TABLE stores ADD COLUMN store_discount_percent DECIMAL(10, 2) NULL",
      );
    }
  } catch (_) {}
}

async function getStoreOwnerScopedStores(db, user) {
  const userId = Number(user?.id || 0);
  if (!Number.isInteger(userId) || userId <= 0) return [];

  let fallbackStoreId = null;
  if (user?.user_type === "store_owner") {
    try {
      const [userRows] = await db.execute(
        "SELECT store_id FROM users WHERE id = ? LIMIT 1",
        [userId],
      );
      const candidate = Number(userRows?.[0]?.store_id || 0);
      if (Number.isInteger(candidate) && candidate > 0) {
        fallbackStoreId = candidate;
      }
    } catch (_) {}
  }

  if (fallbackStoreId) {
    const [stores] = await db.execute(
      "SELECT DISTINCT id, name, owner_id, payment_term, payment_grace_days FROM stores WHERE owner_id = ? OR id = ?",
      [userId, fallbackStoreId],
    );
    return stores || [];
  }

  const [stores] = await db.execute(
    "SELECT id, name, owner_id, payment_term, payment_grace_days FROM stores WHERE owner_id = ?",
    [userId],
  );
  return stores || [];
}

async function getOrCreateRiderWallet(db, riderId) {
  const [walletRows] = await db.execute(
    "SELECT id, balance FROM wallets WHERE rider_id = ? LIMIT 1",
    [riderId]
  );
  if (walletRows.length) {
    return {
      walletId: walletRows[0].id,
      balance: Number(walletRows[0].balance || 0),
    };
  }
  await db.execute(
    "INSERT INTO wallets (rider_id, user_type, balance) VALUES (?, 'rider', 0)",
    [riderId]
  );
  const [newRows] = await db.execute(
    "SELECT id, balance FROM wallets WHERE rider_id = ? LIMIT 1",
    [riderId]
  );
  return {
    walletId: newRows[0].id,
    balance: Number(newRows[0].balance || 0),
  };
}

async function assertNoWalletOrderCreditConflict(db, orderId, riderId, walletId) {
  const [existingCredits] = await db.execute(
    `SELECT wt.id, wt.wallet_id, w.rider_id AS wallet_rider_id
     FROM wallet_transactions wt
     JOIN wallets w ON w.id = wt.wallet_id
     WHERE wt.type = 'credit'
       AND wt.reference_type = 'order'
       AND CAST(wt.reference_id AS UNSIGNED) = ?
     LIMIT 5`,
    [orderId]
  );

  const conflictingCredit = existingCredits.find(
    (row) =>
      Number(row.wallet_id) !== Number(walletId) ||
      Number(row.wallet_rider_id) !== Number(riderId)
  );
  if (conflictingCredit) {
    const error = new Error(
      `Wallet credit conflict for order ${orderId}: already credited wallet ${conflictingCredit.wallet_id} / rider ${conflictingCredit.wallet_rider_id}`
    );
    error.statusCode = 409;
    throw error;
  }

  return existingCredits;
}

// Get user's orders
router.get("/my-orders", authenticateToken, async (req, res) => {
  try {
    await ensureOrderItemsSchema(req.db);

    const { status } = req.query;
    let query = `
            SELECT o.*, s.name as store_name, s.location as store_location, s.phone as store_phone, s.email as store_email,
                   r.first_name as rider_first_name, r.last_name as rider_last_name, r.phone as rider_phone
            FROM orders o
            LEFT JOIN stores s ON o.store_id = s.id
            LEFT JOIN riders r ON o.rider_id = r.id
            WHERE o.user_id = ?
        `;
    const params = [req.user.id];

    if (status && status !== "all") {
      if (status === "pending") {
        query +=
          " AND o.status IN ('pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery')";
      } else {
        query += " AND o.status = ?";
        params.push(status);
      }
    }

    query += " ORDER BY o.created_at DESC";

    const [orders] = await req.db.execute(query, params);

    if (orders.length > 0) {
      let hasVariantsTable = false;
      try {
        await req.db.execute("SELECT 1 FROM product_variants LIMIT 1");
        hasVariantsTable = true;
      } catch (e) {}

      const orderIds = orders.map((o) => o.id);
      const placeholders = orderIds.map(() => "?").join(",");

      const itemsQuery = hasVariantsTable
        ? `SELECT oi.*, p.name as product_name, p.image_url, p.store_id, s.name as item_store_name,
                  s.phone as item_store_phone, s.email as item_store_email,
                  CASE
                    WHEN LOWER(TRIM(COALESCE(p.description, ''))) = 'created from admin manual order' THEN 1
                    ELSE 0
                  END as is_manual_order_item,
                  v.label as variant_label
           FROM order_items oi
           JOIN products p ON oi.product_id = p.id
           LEFT JOIN product_variants v ON oi.variant_id = v.id
           LEFT JOIN stores s ON oi.store_id = s.id
           WHERE oi.order_id IN (${placeholders})`
        : `SELECT oi.*, p.name as product_name, p.image_url, p.store_id, s.name as item_store_name,
                  s.phone as item_store_phone, s.email as item_store_email,
                  CASE
                    WHEN LOWER(TRIM(COALESCE(p.description, ''))) = 'created from admin manual order' THEN 1
                    ELSE 0
                  END as is_manual_order_item,
                  NULL as variant_label
           FROM order_items oi
           JOIN products p ON oi.product_id = p.id
           LEFT JOIN stores s ON oi.store_id = s.id
           WHERE oi.order_id IN (${placeholders})`;

      const [allItems] = await req.db.execute(itemsQuery, orderIds);

      const itemsByOrderId = new Map();
      for (const item of allItems) {
        if (!itemsByOrderId.has(item.order_id)) itemsByOrderId.set(item.order_id, []);
        itemsByOrderId.get(item.order_id).push(item);
      }

      for (const order of orders) {
        const items = itemsByOrderId.get(order.id) || [];
        order.items = items;
        order.has_manual_order_item = items.some(
          (item) => Number(item.is_manual_order_item || 0) === 1,
        );

        if (!order.store_id) {
          order.store_name = "Multiple Stores";
          order.is_group = true;

          const storeGroups = {};
          items.forEach((item) => {
            const sId = item.store_id || 'unknown';
            if (!storeGroups[sId]) {
              storeGroups[sId] = {
                store_id: sId,
                store_name: item.item_store_name || 'Unknown Store',
                store_phone: item.item_store_phone || "",
                store_email: item.item_store_email || "",
                status: item.item_status || 'pending',
                has_manual_order_item: false,
                items: [],
                rider_first_name: order.rider_first_name,
                rider_last_name: order.rider_last_name,
                rider_phone: order.rider_phone
              };
            }
            if (Number(item.is_manual_order_item || 0) === 1) {
              storeGroups[sId].has_manual_order_item = true;
            }
            storeGroups[sId].items.push(item);
          });
          order.sub_orders = Object.values(storeGroups);
        }
      }
    }

    res.json({
      success: true,
      orders: orders,
    });
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
      error: error.message,
    });
  }
});

router.get("/customer-support-contact", authenticateToken, async (req, res) => {
  try {
    const support = await getCustomerSupportContact(req.db);
    res.json({
      success: true,
      support,
    });
  } catch (error) {
    console.error("Error fetching customer support contact:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch customer support contact",
      error: error.message,
    });
  }
});

// Test notification endpoint
if (process.env.NODE_ENV !== "production") router.get("/test-notification", (req, res) => {
  try {
    const fs = require("fs");
    const path = require("path");
    const logEvent = (msg) => {
      fs.appendFile(
        path.join(__dirname, "../socket_debug.log"),
        `[${new Date().toISOString()}] ${msg}\n`,
        () => {},
      );
    };

    logEvent(
      `Attempting to emit TEST notification. req.io present: ${!!req.io}`,
    );
    if (req.io) {
      req.io.to("admins").emit("new_order", {
        id: 0,
        order_number: "TEST-SOCKET",
        total_amount: 0.0,
        created_at: new Date(),
      });
      logEvent("TEST notification emitted");
      return res.json({ success: true, message: "Test notification emitted" });
    }
    logEvent("ERROR: req.io not found for TEST notification");
    res.status(500).json({ success: false, message: "req.io not found" });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Create new order
router.post("/", authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type === "guest" || req.user?.is_guest === true) {
      return res.status(403).json({
        success: false,
        message: "Please register your account before placing an order.",
        requires_registration: true,
      });
    }

    const globalBlock = await getGlobalDeliveryBlockState(req.db);
    if (globalBlock.blocked) {
      return res.status(403).json({
        success: false,
        message: globalBlock.message,
      });
    }

    await ensureProductsProfitSchema(req.db);

    const {
      items,
      delivery_address,
      delivery_time,
      payment_method,
      special_instructions,
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Order must contain at least one item",
      });
    }

    if (!delivery_address || delivery_address.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Delivery address is required",
      });
    }

    if (!payment_method) {
      return res.status(400).json({
        success: false,
        message: "Payment method is required",
      });
    }

    const order_number = await generateOrderNumber(req.db);

    // Validate and prepare items
    const preparedItems = [];
    const storeIds = new Set();
    let itemsSubtotal = 0;
    await ensureStoreOfferCampaignTables(req.db);
    const activeCampaignCacheByStore = new Map();

    const loadActiveCampaignsForStore = async (storeId) => {
      const sid = Number(storeId);
      if (!Number.isInteger(sid) || sid <= 0) return [];
      if (!activeCampaignCacheByStore.has(sid)) {
        const map = await getActiveStoreCampaignsMap(req.db, [sid]);
        activeCampaignCacheByStore.set(sid, map[sid] || []);
      }
      return activeCampaignCacheByStore.get(sid) || [];
    };

    for (let item of items) {
      const productId = parseInt(String(item.product_id), 10);
      const quantity = parseInt(String(item.quantity), 10);
      const sizeId =
        item.size_id === null || item.size_id === undefined
          ? null
          : parseInt(String(item.size_id), 10);
      const unitId =
        item.unit_id === null || item.unit_id === undefined
          ? null
          : parseInt(String(item.unit_id), 10);
      const providedVariantLabel = item.variant_label
        ? String(item.variant_label)
        : null;

      if (
        !Number.isInteger(productId) ||
        productId <= 0 ||
        !Number.isInteger(quantity) ||
        quantity <= 0
      ) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid order item payload" });
      }

      const [products] = await req.db.execute(
        `SELECT p.id, p.price, p.cost_price, p.store_id, p.name, p.size_id, p.unit_id,
                p.discount_type, p.discount_value, p.profit_type, p.profit_value,
                s.payment_term
           FROM products p
           LEFT JOIN stores s ON s.id = p.store_id
          WHERE p.id = ? AND p.is_available = true`,
        [productId],
      );

      if (!products || products.length === 0) {
        return res.status(400).json({
          success: false,
          message: `Product ${productId} not found or not available`,
        });
      }

      const product = products[0];
      storeIds.add(product.store_id);
      let unitPrice = Number(product.price);
      const parsedBaseCost = Number(product.cost_price);
      let unitCostPrice = Number.isFinite(parsedBaseCost)
        ? parsedBaseCost
        : null;
      let variantLabel = providedVariantLabel;

      if (sizeId || unitId) {
        let query = `
                    SELECT psp.price, psp.cost_price, sz.label as size_label, u.name as unit_name, u.abbreviation as unit_abbreviation
                    FROM product_size_prices psp
                    LEFT JOIN sizes sz ON psp.size_id = sz.id
                    LEFT JOIN units u ON psp.unit_id = u.id
                    WHERE psp.product_id = ?
                `;
        const params = [productId];

        if (sizeId && unitId) {
          query += " AND psp.size_id = ? AND psp.unit_id = ?";
          params.push(sizeId, unitId);
        } else if (sizeId) {
          query += " AND psp.size_id = ? AND psp.unit_id IS NULL";
          params.push(sizeId);
        } else if (unitId) {
          query += " AND psp.unit_id = ? AND psp.size_id IS NULL";
          params.push(unitId);
        }

        query += " LIMIT 1";

        const [rows] = await req.db.execute(query, params);

        if (rows && rows.length > 0) {
          unitPrice = Number(rows[0].price);
          const parsedVariantCost = Number(rows[0].cost_price);
          if (Number.isFinite(parsedVariantCost)) {
            unitCostPrice = parsedVariantCost;
          }
          if (!variantLabel) {
            const sizeLabel = rows[0].size_label
              ? String(rows[0].size_label)
              : "";
            const unitLabel =
              rows[0].unit_abbreviation || rows[0].unit_name
                ? String(rows[0].unit_abbreviation || rows[0].unit_name)
                : "";
            variantLabel =
              sizeLabel && unitLabel
                ? `${sizeLabel} ${unitLabel}`
                : sizeLabel || unitLabel || null;
          }
        } else {
          // Fallback: Check if requested variant matches the base product's size/unit
          const productSizeId =
            product.size_id === null || product.size_id === undefined
              ? null
              : parseInt(String(product.size_id), 10);
          const productUnitId =
            product.unit_id === null || product.unit_id === undefined
              ? null
              : parseInt(String(product.unit_id), 10);

          if (sizeId === productSizeId && unitId === productUnitId) {
            // Match found on base product
            unitPrice = Number(product.price);
            // Label remains default or provided
          } else {
            return res.status(400).json({
              success: false,
              message: `Variant with ${sizeId ? `size ${sizeId}` : ""} ${sizeId && unitId ? "and " : ""} ${unitId ? `unit ${unitId}` : ""} not found for product ${productId}`,
            });
          }
        }
      }

      const applicableCampaigns = campaignsForProduct(
        await loadActiveCampaignsForStore(product.store_id),
        productId,
      );
      const campaignLine = applyCampaignToCartLine(
        unitPrice,
        quantity,
        applicableCampaigns,
      );
      const finalUnitPrice = Number.isFinite(Number(campaignLine.unit_price))
        ? Number(campaignLine.unit_price)
        : unitPrice;

      const financialSnapshot = deriveOrderItemAdjustmentSnapshot({
        paymentTerm: product.payment_term,
        unitPrice: finalUnitPrice,
        productCostPrice: unitCostPrice,
        discountType: product.discount_type,
        discountValue: product.discount_value,
        profitType: product.profit_type,
        profitValue: product.profit_value,
      });

      const basePreparedItem = {
        productId,
        quantity,
        unitPrice: finalUnitPrice,
        costPrice: unitCostPrice,
        sizeId,
        unitId,
        variantLabel,
        storeId: product.store_id,
        discount_type: financialSnapshot.type,
        discount_value: financialSnapshot.value,
      };

      if (
        campaignLine.free_quantity > 0 &&
        campaignLine.paid_quantity > 0
      ) {
        preparedItems.push({
          ...basePreparedItem,
          quantity: campaignLine.paid_quantity,
          unitPrice,
          variantLabel,
        });
        preparedItems.push({
          ...basePreparedItem,
          quantity: campaignLine.free_quantity,
          unitPrice: 0,
          variantLabel: campaignLine.offer_badge
            ? `${variantLabel ? `${variantLabel} - ` : ""}${campaignLine.offer_badge}`
            : variantLabel,
        });
      } else {
        preparedItems.push(basePreparedItem);
      }

      itemsSubtotal += campaignLine.line_total;
    }

    let adminStoreNames = [];

    // Enforce store open/closed hours before proceeding
    const storeIdArray = Array.from(storeIds).filter(Boolean);
    if (storeIdArray.length > 0) {
      const placeholders = storeIdArray.map(() => "?").join(",");
      const [storeRows] = await req.db.execute(
        `SELECT s.id, s.name, s.opening_time, s.closing_time, s.is_active,
                COALESCE(sm.is_closed, 0) as is_closed,
                sm.status_message
           FROM stores s
           LEFT JOIN store_status_messages sm ON sm.store_id = s.id
          WHERE s.id IN (${placeholders})`,
        storeIdArray,
      );

      const now = new Date();
      const nowDouble = now.getHours() + now.getMinutes() / 60.0;
      const parseTimeStr = (t) => {
        if (!t) return null;
        const parts = String(t).split(":");
        const h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
        return h + m / 60.0;
      };

      adminStoreNames = storeRows
        .map((s) => String(s.name || "").trim())
        .filter(Boolean);

      for (const s of storeRows) {
        if (!s.is_active) {
          return res.status(400).json({
            success: false,
            message: `Store "${s.name}" is not active at the moment. Please try later.`,
          });
        }
        if (s.is_closed) {
          const reason = s.status_message
            ? ` Reason: ${s.status_message}`
            : "";
          return res.status(400).json({
            success: false,
            message: `Store "${s.name}" is currently closed.${reason}`,
          });
        }
        const openD = parseTimeStr(s.opening_time);
        const closeD = parseTimeStr(s.closing_time);
        if (openD === null || closeD === null) {
          return res.status(400).json({
            success: false,
            message: `Store "${s.name}" is currently closed.`,
          });
        }
        let isOpen;
        if (openD <= closeD) {
          isOpen = nowDouble >= openD && nowDouble <= closeD;
        } else {
          // Overnight hours (e.g., 22:00 - 04:00)
          isOpen = nowDouble >= openD || nowDouble <= closeD;
        }
        if (!isOpen) {
          return res.status(400).json({
            success: false,
            message: `Store "${s.name}" is currently closed. Please order during open hours.`,
          });
        }
      }
    }

    // Calculate delivery fee based on number of unique stores and admin-configured settings
    const storeCount = storeIds.size;
    const deliveryFeeConfig = await getDeliveryFeeConfig(req.db);
    const delivery_fee = calculateDeliveryFeeByStoreCount(
      storeCount,
      deliveryFeeConfig
    );

    const grandTotal = roundAmount(itemsSubtotal + delivery_fee);

    // Check Wallet
    let wallet = null;
    if (payment_method === "wallet") {
      const [wallets] = await req.db.execute(
        "SELECT id, balance FROM wallets WHERE user_id = ?",
        [req.user.id],
      );

      if (!wallets.length) {
        return res.status(400).json({
          success: false,
          message: "Wallet not found",
        });
      }

      wallet = wallets[0];
      const balance = parseFloat(wallet.balance);

      if (balance < grandTotal) {
        return res.status(400).json({
          success: false,
          message: `Insufficient wallet balance. Required: PKR ${grandTotal.toFixed(2)}, Available: PKR ${balance.toFixed(2)}`,
        });
      }
    }

    // Create Single Order
    await ensureOrderItemsSchema(req.db);
    await ensureOrdersStoreIdNullable(req.db); // Ensure store_id can be NULL

    // Determine store_id for the order
    let orderStoreId = null;
    if (storeIds.size === 1) {
      orderStoreId = Array.from(storeIds)[0];
    }

    const [orderResult] = await req.db.execute(
      `INSERT INTO orders (order_number, user_id, store_id, total_amount, delivery_fee, payment_method, delivery_address, delivery_time, special_instructions)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        order_number,
        req.user.id,
        orderStoreId,
        grandTotal,
        delivery_fee,
        payment_method,
        delivery_address,
        delivery_time || null,
        special_instructions || null,
      ],
    );

    const orderId = orderResult.insertId;

    for (let item of preparedItems) {
      await req.db.execute(
        "INSERT INTO order_items (order_id, product_id, store_id, quantity, price, cost_price, size_id, unit_id, variant_label, discount_type, discount_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          orderId,
          item.productId,
          item.storeId,
          item.quantity,
          item.unitPrice,
          item.costPrice,
          item.sizeId,
          item.unitId,
          item.variantLabel,
          item.discount_type || null,
          item.discount_value || null,
        ],
      );
    }

    // Update Wallet
    if (payment_method === "wallet" && wallet) {
      const newBalance = parseFloat(wallet.balance) - grandTotal;

      await req.db.execute(
        "UPDATE wallets SET balance = ?, total_spent = total_spent + ? WHERE id = ?",
        [newBalance, grandTotal, wallet.id],
      );

      await req.db.execute(
        `INSERT INTO wallet_transactions (wallet_id, type, amount, description, 
                 reference_type, reference_id, balance_after) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          wallet.id,
          "debit",
          grandTotal,
          `Order payment - ${order_number}`,
          "order",
          orderId,
          newBalance,
        ],
      );
    }

    const adminStoreSummary =
      adminStoreNames.length > 1
        ? adminStoreNames.join(", ")
        : adminStoreNames[0] || "Unknown Store";
    const adminOrderMessage =
      adminStoreNames.length > 1
        ? `${adminStoreSummary} | PKR ${grandTotal}`
        : `${adminStoreSummary} - PKR ${grandTotal}`;

    // Emit new_order event to admin
    try {
      const fs = require("fs");
      const path = require("path");
      const logEvent = (msg) => {
        fs.appendFile(
          path.join(__dirname, "../socket_debug.log"),
          `[${new Date().toISOString()}] ${msg}\n`,
          (e) => {
            if (e) console.error("Failed to write to socket_debug.log:", e);
          },
        );
      };

      logEvent(
        `Order Created: ${order_number} (ID: ${orderId}). req.io present: ${!!req.io}`,
      );
      if (req.io) {
        req.io.to("admins").emit("new_order", {
          id: orderId,
          order_number: order_number,
          total_amount: grandTotal,
          store_id: orderStoreId,
          store_name: adminStoreSummary,
          store_names: adminStoreNames,
          message: adminOrderMessage,
          created_at: new Date(),
          user_id: req.user.id,
        });
        logEvent(
          `new_order event emitted for ${order_number}. Total clients: ${req.io.engine.clientsCount}`,
        );

        // Notify Store Owners
        const storeIdList = Array.from(storeIds);
        if (storeIdList.length > 0) {
          const placeholders = storeIdList.map(() => "?").join(",");
          const [stores] = await req.db.execute(
            `SELECT id, owner_id, name FROM stores WHERE id IN (${placeholders})`,
            storeIdList,
          );

          for (const store of stores) {
            if (store.owner_id) {
              req.io
                .to(`user_${store.owner_id}`)
                .emit("store_owner_notification", {
                  type: "new_order",
                  order_id: orderId,
                  order_number: order_number,
                  store_id: store.id,
                  store_name: store.name,
                  message: `New order ${order_number} for ${store.name}`,
                  timestamp: new Date(),
                });
              await sendPushToUser(req.db, {
                userId: store.owner_id,
                userType: "store_owner",
                title: "New Store Order",
                message: `New order ${order_number} for ${store.name}`,
                data: {
                  type: "new_order",
                  order_id: orderId,
                  order_number: order_number,
                  store_id: store.id,
                },
                collapseKey: "store_owner_new_order",
              });
              logEvent(
                `store_owner_notification emitted to user_${store.owner_id}`,
              );
            }
          }
        }
      } else {
        logEvent(`WARNING: req.io missing for order ${order_number}`);
      }

      const adminRecipients = await getAdminPushRecipients(req.db);
      for (const adminRecipient of adminRecipients) {
        try {
          await sendPushToUser(req.db, {
            userId: adminRecipient.id,
            userType: adminRecipient.user_type,
            title: "New Order Received",
            message: adminOrderMessage,
            data: {
              type: "new_order",
              order_id: orderId,
              order_number: order_number,
              store_name: adminStoreSummary,
              store_names: adminStoreNames.join(", "),
              total_amount: String(grandTotal),
            },
            collapseKey: "admin_new_order",
          });
        } catch (pushError) {
          console.error(
            `[Orders] Failed sending admin push for ${order_number} to user ${adminRecipient.id}:`,
            pushError.message || pushError,
          );
        }
      }
    } catch (e) {
      console.error("Socket emit error:", e);
    }

    res.status(201).json({
      success: true,
      message: "Order created successfully",
      order: {
        id: orderId,
        order_number: order_number,
        total_amount: grandTotal,
        store_id: orderStoreId,
      },
    });
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create order",
      error: error.message,
    });
  }
});

// Create manual order by admin/staff, with optional auto-create product for future reuse
router.get(
  "/admin/manual-products",
  authenticateToken,
  requireStaffAccess,
  async (req, res) => {
    try {
      const storeId = parseInt(String(req.query.store_id || ""), 10);
      if (!Number.isInteger(storeId) || storeId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Valid store_id is required",
        });
      }

      const [products] = await req.db.execute(
        `SELECT id, name, price, cost_price, category_id, is_available
           FROM products
          WHERE store_id = ?
          ORDER BY name ASC, id DESC
          LIMIT 1000`,
        [storeId],
      );

      return res.json({
        success: true,
        products: products || [],
      });
    } catch (error) {
      console.error("Error fetching manual products:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch products",
        error: error.message,
      });
    }
  },
);

router.post(
  "/admin/manual-create",
  authenticateToken,
  requireStaffAccess,
  async (req, res) => {
    try {
      await ensureOrderItemsSchema(req.db);
      await ensureOrdersStoreIdNullable(req.db);
      await ensureProductsProfitSchema(req.db);

      const {
        order_type,
        customer_id,
        delivery_address,
        delivery_fee,
        payment_method,
        special_instructions,
        pickup_location,
        parcel_details,
        store_id,
        product_id,
        item_name,
        quantity,
        unit_price,
        cost_price,
        category_id,
        save_for_future = true,
      } = req.body || {};

      const isParcelDelivery = String(order_type || "").trim() === "parcel_delivery";
      const customerId = parseInt(String(customer_id || ""), 10);
      let storeId = parseInt(String(store_id || ""), 10);
      const selectedProductId = parseInt(String(product_id || ""), 10);
      const qty = parseInt(String(quantity || ""), 10);
      const unitPrice = Number(unit_price);
      const manualDeliveryFee =
        delivery_fee === null || delivery_fee === undefined || String(delivery_fee).trim() === ""
          ? null
          : Number(delivery_fee);
      const costPrice =
        cost_price === null || cost_price === undefined || String(cost_price).trim() === ""
          ? null
          : Number(cost_price);

      if (isParcelDelivery && (!Number.isInteger(storeId) || storeId <= 0)) {
        const [parcelStores] = await req.db.execute(
          "SELECT id FROM stores WHERE LOWER(name) LIKE '%parcel%' OR LOWER(name) LIKE '%pick%' LIMIT 1"
        );
        if (parcelStores.length > 0) {
          storeId = parcelStores[0].id;
        } else {
          const [anyStore] = await req.db.execute(
            "SELECT id FROM stores WHERE is_active = true ORDER BY id ASC LIMIT 1"
          );
          storeId = anyStore[0]?.id || 1;
        }
      }

      if (!Number.isInteger(customerId) || customerId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Valid customer is required",
        });
      }
      if (!Number.isInteger(storeId) || storeId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Valid store is required",
        });
      }
      if (!String(delivery_address || "").trim()) {
        return res.status(400).json({
          success: false,
          message: "Delivery address is required",
        });
      }
      let finalPickupLocation = String(pickup_location || "").trim();
      if (isParcelDelivery && !finalPickupLocation) {
        const [custRows] = await req.db.execute(
          "SELECT address, phone, first_name, last_name FROM users WHERE id = ? LIMIT 1",
          [customerId]
        );
        if (custRows.length > 0 && custRows[0].address) {
          finalPickupLocation = String(custRows[0].address).trim();
        }
      }
      if (isParcelDelivery && !finalPickupLocation) {
        return res.status(400).json({
          success: false,
          message: "Pickup place/location is required (customer has no saved address)",
        });
      }
      if (
        !isParcelDelivery &&
        (!Number.isInteger(selectedProductId) || selectedProductId <= 0) &&
        !String(item_name || "").trim()
      ) {
        return res.status(400).json({
          success: false,
          message: "Item name or valid product is required",
        });
      }
      if (!Number.isInteger(qty) || qty <= 0) {
        return res.status(400).json({
          success: false,
          message: "Quantity must be greater than zero",
        });
      }
      if (!Number.isFinite(unitPrice) || (isParcelDelivery ? unitPrice < 0 : unitPrice <= 0)) {
        return res.status(400).json({
          success: false,
          message: isParcelDelivery
            ? "Unit price must be a non-negative number"
            : "Unit price must be greater than zero",
        });
      }
      if (costPrice !== null && (!Number.isFinite(costPrice) || costPrice < 0)) {
        return res.status(400).json({
          success: false,
          message: "Cost price must be a non-negative number",
        });
      }
      if (manualDeliveryFee !== null && (!Number.isFinite(manualDeliveryFee) || manualDeliveryFee < 0)) {
        return res.status(400).json({
          success: false,
          message: "Delivery charges must be a non-negative number",
        });
      }

      const [users] = await req.db.execute(
        "SELECT id FROM users WHERE id = ? LIMIT 1",
        [customerId],
      );
      if (!users.length) {
        return res.status(404).json({
          success: false,
          message: "Customer not found",
        });
      }

      const [stores] = await req.db.execute(
        "SELECT id, name, is_active, payment_term FROM stores WHERE id = ? LIMIT 1",
        [storeId],
      );
      if (!stores.length) {
        return res.status(404).json({
          success: false,
          message: "Store not found",
        });
      }
      const store = stores[0];
      const adminStoreSummary = String(store.name || "Unknown Store").trim();
      if (!store.is_active) {
        return res.status(400).json({
          success: false,
          message: `Store "${store.name}" is not active`,
        });
      }

      let productId = null;
      const normalizedItemName = isParcelDelivery
        ? "Parcel / Item Delivery"
        : String(item_name || "").trim();

      if (!isParcelDelivery && Number.isInteger(selectedProductId) && selectedProductId > 0) {
        const [pickedProducts] = await req.db.execute(
          `SELECT p.id, p.name, p.price, p.cost_price, p.discount_type, p.discount_value, p.profit_type, p.profit_value, p.category_id
             FROM products p
            WHERE p.id = ? AND p.store_id = ?
            LIMIT 1`,
          [selectedProductId, storeId],
        );
        if (!pickedProducts.length) {
          return res.status(400).json({
            success: false,
            message: "Selected product does not belong to this store",
          });
        }
        productId = pickedProducts[0].id;
      }

      if (!productId && normalizedItemName) {
        const [existingProducts] = await req.db.execute(
          `SELECT p.id, p.price, p.cost_price, p.discount_type, p.discount_value, p.profit_type, p.profit_value
             FROM products p
            WHERE p.store_id = ?
              AND LOWER(TRIM(p.name)) = LOWER(TRIM(?))
            ORDER BY p.id DESC
            LIMIT 1`,
          [storeId, normalizedItemName],
        );

        if (existingProducts.length > 0) {
          productId = existingProducts[0].id;
        }
      }
      if (!productId && (save_for_future || isParcelDelivery)) {
        let finalCategoryId = null;
        const categoryIdNumber = parseInt(String(category_id || ""), 10);
        if (Number.isInteger(categoryIdNumber) && categoryIdNumber > 0) {
          finalCategoryId = categoryIdNumber;
        } else {
          const [cats] = await req.db.execute(
            "SELECT id FROM categories WHERE is_active = true ORDER BY id ASC LIMIT 1",
          );
          finalCategoryId = cats[0]?.id || null;
        }

        const baseCost = roundAmount(costPrice !== null ? costPrice : unitPrice);
        const productPrice = roundAmount(unitPrice);
        const [insertProduct] = await req.db.execute(
          `INSERT INTO products (
             name, description, cost_price, price, image_url, category_id, store_id, stock_quantity,
             discount_type, discount_value, profit_type, profit_value
           ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL, 'amount', 0)`,
          [
            normalizedItemName,
            "Created from admin manual order",
            baseCost,
            productPrice,
            finalCategoryId,
            storeId,
            9999,
          ],
        );
        productId = insertProduct.insertId;
      }

      if (!productId) {
        return res.status(400).json({
          success: false,
          message:
            "Product not found in selected store. Enable 'save for future' to create it.",
        });
      }

      const [productRows] = await req.db.execute(
        `SELECT id, cost_price, discount_type, discount_value, profit_type, profit_value
           FROM products
          WHERE id = ?
          LIMIT 1`,
        [productId],
      );
      const product = productRows[0] || {};

      const feeConfig = manualDeliveryFee === null && !isParcelDelivery ? await getDeliveryFeeConfig(req.db) : null;
      const deliveryFee =
        manualDeliveryFee !== null
          ? roundAmount(manualDeliveryFee)
          : (isParcelDelivery ? DEFAULT_PARCEL_DELIVERY_FEE : calculateDeliveryFeeByStoreCount(1, feeConfig));
      const subtotal = roundAmount(qty * roundAmount(unitPrice));
      const totalAmount = roundAmount(subtotal + deliveryFee);
      const adminOrderMessage = `${adminStoreSummary} - PKR ${totalAmount}`;
      const orderNumber = await generateOrderNumber(req.db);
      const pickupLocationText = String(finalPickupLocation || pickup_location || "").trim();
      const parcelDetailsText = String(parcel_details || "").trim();
      const instructionsParts = [];
      if (isParcelDelivery) {
        instructionsParts.push("Order Type: Pick & Drop Parcel / Item");
        instructionsParts.push(`Pickup: ${pickupLocationText}`);
        if (parcelDetailsText) instructionsParts.push(`Parcel/Item: ${parcelDetailsText}`);
      }
      if (special_instructions) {
        instructionsParts.push(String(special_instructions).trim());
      }
      const finalInstructions = instructionsParts.length ? instructionsParts.join("\n") : null;

      const [orderResult] = await req.db.execute(
        `INSERT INTO orders (
           order_number, user_id, store_id, total_amount, delivery_fee, payment_method,
           delivery_address, special_instructions
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderNumber,
          customerId,
          storeId,
          totalAmount,
          deliveryFee,
          String(payment_method || "cash"),
          String(delivery_address).trim(),
          finalInstructions,
        ],
      );
      const orderId = orderResult.insertId;

      const financialSnapshot = deriveOrderItemAdjustmentSnapshot({
        paymentTerm: store.payment_term,
        unitPrice: roundAmount(unitPrice),
        productCostPrice: costPrice !== null ? costPrice : product.cost_price,
        discountType: product.discount_type,
        discountValue: product.discount_value,
        profitType: product.profit_type,
        profitValue: product.profit_value,
      });

      await req.db.execute(
        `INSERT INTO order_items (
          order_id, product_id, store_id, quantity, price, cost_price, discount_type, discount_value
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          productId,
          storeId,
          qty,
          roundAmount(unitPrice),
          roundAmount(costPrice !== null ? costPrice : product.cost_price),
          financialSnapshot.type || null,
          financialSnapshot.value ?? null,
        ],
      );

      try {
        if (req.io) {
          req.io.to("admins").emit("new_order", {
            id: orderId,
            order_number: orderNumber,
            total_amount: totalAmount,
            store_id: storeId,
            store_name: adminStoreSummary,
            store_names: [adminStoreSummary],
            message: adminOrderMessage,
            created_at: new Date(),
            user_id: customerId,
          });
        }
        const adminRecipients = await getAdminPushRecipients(req.db);
        for (const adminRecipient of adminRecipients) {
          try {
            await sendPushToUser(req.db, {
              userId: adminRecipient.id,
              userType: adminRecipient.user_type,
              title: "New Order Received",
              message: adminOrderMessage,
              data: {
                type: "new_order",
                order_id: orderId,
                order_number: orderNumber,
                store_name: adminStoreSummary,
                store_names: adminStoreSummary,
                total_amount: String(totalAmount),
              },
              collapseKey: "admin_new_order",
            });
          } catch (pushError) {
            console.error(
              `[Orders] Failed sending admin push for manual order ${orderNumber} to user ${adminRecipient.id}:`,
              pushError.message || pushError,
            );
          }
        }
      } catch (_) {}

      return res.status(201).json({
        success: true,
        message: "Manual order created successfully",
        order: {
          id: orderId,
          order_number: orderNumber,
          total_amount: totalAmount,
          delivery_fee: deliveryFee,
          store_id: storeId,
          auto_saved_product_id: productId,
        },
      });
    } catch (error) {
      console.error("Error creating manual admin order:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to create manual order",
        error: error.message,
      });
    }
  },
);

// Get available riders (Admin & Dispatch)
router.get(
  "/available-riders",
  authenticateToken,
  requireDispatchAccess,
  async (req, res) => {
    try {
      const [riders] = await req.db.execute(
        "SELECT id, first_name, last_name, email, phone, vehicle_type FROM riders WHERE is_active = true AND is_available = true ORDER BY first_name ASC LIMIT 500",
      );

      res.json({
        success: true,
        riders: riders || [],
      });
    } catch (error) {
      console.error("Error fetching available riders:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch available riders",
        error: error.message,
      });
    }
  },
);

// Get current rider's deliveries (for mobile app)
router.get("/rider/deliveries", authenticateToken, async (req, res) => {
  try {
    await ensureOrderItemsSchema(req.db);
    if (req.user.user_type !== "rider") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Rider only.",
      });
    }

    const riderId = req.user.id;

    // Check if rider exists and is active
    const [riders] = await req.db.execute(
      "SELECT id FROM riders WHERE id = ? AND is_active = true",
      [riderId],
    );

    if (riders.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Rider account is inactive or not found. Access denied.",
      });
    }

    const { status } = req.query;
    let whereClause = "o.rider_id = ?";
    if (status === "assigned") {
      whereClause += ` AND o.status IN (${ACTIVE_RIDER_DELIVERY_STATUS_SQL})`;
    } else if (status === "completed") {
      whereClause += " AND o.status = 'delivered'";
    }

    const [deliveries] = await req.db.execute(
      `
            SELECT o.*, u.first_name, u.last_name, u.phone, s.name as store_name, s.location as store_location
            FROM orders o
            JOIN users u ON o.user_id = u.id
            LEFT JOIN stores s ON o.store_id = s.id
            WHERE ${whereClause}
            ORDER BY o.created_at DESC
        `,
      [riderId],
    );

    for (let delivery of deliveries) {
      // Set display name for multi-store orders
      if (!delivery.store_id) {
        delivery.store_name = "Multiple Stores";
        delivery.store_location = "Various Locations";
      }
    }
    await attachItemsToDeliveries(req.db, deliveries);

    res.json({
      success: true,
      deliveries,
    });
  } catch (error) {
    console.error("Error fetching rider deliveries:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch deliveries",
      error: error.message,
    });
  }
});

// Get rider's deliveries by ID (for admins viewing a specific rider)
router.get(
  "/rider/:riderId/deliveries",
  authenticateToken,
  async (req, res) => {
    try {
      await ensureOrderItemsSchema(req.db);
      const { riderId } = req.params;
      const { status } = req.query;

      // Only riders can view their own deliveries, admins can view any rider's deliveries
      if (req.user.user_type === "rider" && req.user.id != riderId) {
        return res.status(403).json({
          success: false,
          message: "Access denied. You can only view your own deliveries.",
        });
      }
      if (
        req.user.user_type !== "rider" &&
        req.user.user_type !== "admin" &&
        req.user.user_type !== "standard_user"
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied.",
        });
      }

      let whereClause = "o.rider_id = ?";
      if (status === "assigned") {
        whereClause += ` AND o.status IN (${ACTIVE_RIDER_DELIVERY_STATUS_SQL})`;
      } else if (status === "completed") {
        whereClause += " AND o.status = 'delivered'";
      }

      const [deliveries] = await req.db.execute(
        `
            SELECT o.*, u.first_name, u.last_name, u.phone, s.name as store_name, s.location as store_location
            FROM orders o
            JOIN users u ON o.user_id = u.id
            LEFT JOIN stores s ON o.store_id = s.id
            WHERE ${whereClause}
            ORDER BY o.created_at DESC
        `,
        [riderId],
      );

      for (let delivery of deliveries) {
        // Set display name for multi-store orders
        if (!delivery.store_id) {
          delivery.store_name = "Multiple Stores";
          delivery.store_location = "Various Locations";
        }
      }
      await attachItemsToDeliveries(req.db, deliveries);

      res.json({
        success: true,
        deliveries,
      });
    } catch (error) {
      console.error("Error fetching rider deliveries:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch deliveries",
        error: error.message,
      });
    }
  },
);

// Get rider profile
router.get("/rider/profile", authenticateToken, async (req, res) => {
  try {
    if (req.user.user_type !== "rider") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Rider only.",
      });
    }

    const [riders] = await req.db.execute(
      "SELECT id, first_name, last_name, email, phone, vehicle_type, image_url, id_card_url FROM riders WHERE id = ? AND is_active = true",
      [req.user.id],
    );

    if (riders.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Rider account is inactive or not found. Access denied.",
      });
    }

    res.json({
      success: true,
      rider: riders[0],
    });
  } catch (error) {
    console.error("Error fetching rider profile:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch rider profile",
      error: error.message,
    });
  }
});

// Update rider location
router.put(
  "/rider/location",
  authenticateToken,
  [
    body("latitude").isFloat().withMessage("Invalid latitude"),
    body("longitude").isFloat().withMessage("Invalid longitude"),
    body("location").optional().isString().withMessage("Invalid location"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      if (req.user.user_type !== "rider") {
        return res.status(403).json({
          success: false,
          message: "Access denied. Rider only.",
        });
      }

      const { latitude, longitude } = req.body;
      const location = String(req.body.location || "").trim() || null;
      const resolvedLocation = resolveFastRiderLocationLabel(
        latitude,
        longitude,
        location,
      );
      const riderId = req.user.id;

      await ensureRiderLocationColumns(req.db);
      await ensureRiderLocationLogsTable(req.db);

      const [activeOrders] = await req.db.execute(
        `SELECT id
         FROM orders
         WHERE rider_id = ?
           AND status IN (${ACTIVE_RIDER_DELIVERY_STATUS_SQL})`,
        [riderId],
      );

      const orderIds = activeOrders.map((order) => Number(order.id)).filter(
        (id) => Number.isInteger(id) && id > 0,
      );

      // Update rider location in database
      if (orderIds.length > 0) {
        const updateSql = resolvedLocation
          ? `UPDATE orders
             SET rider_latitude = ?, rider_longitude = ?, rider_location = ?
             WHERE rider_id = ?
               AND status IN (${ACTIVE_RIDER_DELIVERY_STATUS_SQL})`
          : `UPDATE orders
             SET rider_latitude = ?, rider_longitude = ?
             WHERE rider_id = ?
               AND status IN (${ACTIVE_RIDER_DELIVERY_STATUS_SQL})`;
        const updateParams = resolvedLocation
          ? [latitude, longitude, resolvedLocation, riderId]
          : [latitude, longitude, riderId];
        await req.db.execute(updateSql, updateParams);
      }

      // Also store in a rider location log table if available
      try {
        if (orderIds.length > 0) {
          const placeholders = orderIds.map(() => "(?, ?, ?, ?, ?)").join(", ");
          const insertParams = [];
          for (const orderId of orderIds) {
            insertParams.push(
              riderId,
              orderId,
              latitude,
              longitude,
              resolvedLocation,
            );
          }
          await req.db.execute(
            `INSERT INTO rider_location_logs (rider_id, order_id, latitude, longitude, location_label) VALUES ${placeholders}`,
            insertParams,
          );
        } else {
          await req.db.execute(
            `INSERT INTO rider_location_logs (rider_id, order_id, latitude, longitude, location_label) VALUES (?, NULL, ?, ?, ?)`,
            [riderId, latitude, longitude, resolvedLocation],
          );
        }
      } catch (e) {
        console.error("Failed to insert rider location log:", e);
      }

      emitRiderLocationUpdate(
        req.io,
        buildRiderLocationUpdatePayload({
          riderId,
          latitude,
          longitude,
          location: resolvedLocation,
          orderIds,
        }),
      );

      if (!location || isCoordinateOnlyLocationLabel(location)) {
        reverseGeocodeRiderLocation(latitude, longitude).catch(() => {});
      }

      res.json({
        success: true,
        message: "Location updated successfully",
        location: { latitude, longitude, label: resolvedLocation },
      });
    } catch (error) {
      console.error("Error updating rider location:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update location",
        error: error.message,
      });
    }
  },
);

router.get("/rider/location-history", authenticateToken, async (req, res) => {
  try {
    if (
      req.user.user_type !== "admin" &&
      req.user.user_type !== "standard_user"
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin only.",
      });
    }

    await ensureRiderLocationLogsTable(req.db);

    const riderIds = String(req.query.riderIds || "")
      .split(",")
      .map((value) => Number.parseInt(String(value).trim(), 10))
      .filter((value, index, arr) =>
        Number.isInteger(value) && value > 0 && arr.indexOf(value) === index
      );
    const orderIds = String(req.query.orderIds || "")
      .split(",")
      .map((value) => Number.parseInt(String(value).trim(), 10))
      .filter((value, index, arr) =>
        Number.isInteger(value) && value > 0 && arr.indexOf(value) === index
      );

    if (riderIds.length === 0) {
      return res.json({ success: true, histories: {} });
    }

    const hours = Math.min(
      Math.max(Number.parseInt(String(req.query.hours || "3"), 10) || 3, 1),
      24 * 45,
    );
    const limit = Math.min(
      Math.max(Number.parseInt(String(req.query.limit || "40"), 10) || 40, 5),
      2500,
    );

    const placeholders = riderIds.map(() => "?").join(", ");
    const orderPlaceholders = orderIds.map(() => "?").join(", ");
    const orderFilter =
      orderIds.length > 0
        ? ` AND (order_id IN (${orderPlaceholders}) OR order_id IS NULL)`
        : "";
    const [rows] = await req.db.execute(
      `SELECT rider_id, order_id, latitude, longitude, location_label, created_at
       FROM rider_location_logs
       WHERE rider_id IN (${placeholders})
         AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
         ${orderFilter}
       ORDER BY rider_id ASC, created_at ASC`,
      [...riderIds, hours, ...orderIds],
    );

    const histories = {};
    for (const riderId of riderIds) {
      histories[String(riderId)] = [];
    }
    for (const orderId of orderIds) {
      histories[`order_${orderId}`] = [];
    }

    for (const row of rows) {
      const key = String(row.rider_id);
      if (!histories[key]) histories[key] = [];
      const entry = {
        order_id:
          row.order_id === null || row.order_id === undefined
            ? null
            : Number.parseInt(String(row.order_id), 10),
        latitude: Number.parseFloat(row.latitude),
        longitude: Number.parseFloat(row.longitude),
        location_label: String(row.location_label || "").trim(),
        created_at: row.created_at,
      };
      histories[key].push(entry);
      if (entry.order_id) {
        const orderKey = `order_${entry.order_id}`;
        if (!histories[orderKey]) histories[orderKey] = [];
        histories[orderKey].push(entry);
      }
    }

    const summaries = {};
    for (const key of Object.keys(histories)) {
      summaries[key] = summarizeLocationRows(histories[key]);
      histories[key] = compressLocationHistory(histories[key], limit);
    }

    res.json({
      success: true,
      hours,
      limit,
      histories,
      summaries,
    });
  } catch (error) {
    console.error("Error fetching rider location history:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch rider location history",
      error: error.message,
    });
  }
});

router.get("/rider/travel-summary", authenticateToken, async (req, res) => {
  try {
    if (
      req.user.user_type !== "admin" &&
      req.user.user_type !== "standard_user"
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin only.",
      });
    }

    await ensureRiderLocationLogsTable(req.db);

    const dateText = String(req.query.date || "").trim();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateText)
      ? dateText
      : new Date().toISOString().slice(0, 10);

    const [rows] = await req.db.execute(
      `SELECT
         rll.rider_id,
         rll.order_id,
         rll.latitude,
         rll.longitude,
         rll.location_label,
         rll.created_at,
         o.order_number,
         o.status AS order_status,
         s.name AS store_name,
         CONCAT(COALESCE(r.first_name, ''), ' ', COALESCE(r.last_name, '')) AS rider_name
       FROM rider_location_logs rll
       LEFT JOIN orders o ON o.id = rll.order_id
       LEFT JOIN stores s ON s.id = o.store_id
       LEFT JOIN riders r ON r.id = rll.rider_id
       WHERE DATE(rll.created_at) = ?
       ORDER BY rll.rider_id ASC, rll.order_id ASC, rll.created_at ASC`,
      [date],
    );

    const [manualRows] = await req.db.execute(
      `SELECT
         rfh.rider_id,
         COALESCE(SUM(rfh.distance), 0) AS manual_km,
         CONCAT(COALESCE(r.first_name, ''), ' ', COALESCE(r.last_name, '')) AS rider_name
       FROM riders_fuel_history rfh
       LEFT JOIN riders r ON r.id = rfh.rider_id
       WHERE DATE(rfh.entry_date) = ?
       GROUP BY rfh.rider_id, r.first_name, r.last_name`,
      [date],
    );
    const manualKmByRider = new Map(
      (manualRows || []).map((row) => [
        String(row.rider_id),
        Number.parseFloat(row.manual_km || 0),
      ]),
    );
    const manualNameByRider = new Map(
      (manualRows || []).map((row) => [
        String(row.rider_id),
        String(row.rider_name || "").trim(),
      ]),
    );

    const byRider = new Map();
    const byOrder = new Map();
    for (const row of rows || []) {
      const riderKey = String(row.rider_id);
      if (!byRider.has(riderKey)) byRider.set(riderKey, []);
      byRider.get(riderKey).push(row);

      if (row.order_id) {
        const orderKey = String(row.order_id);
        if (!byOrder.has(orderKey)) byOrder.set(orderKey, []);
        byOrder.get(orderKey).push(row);
      }
    }

    const riders = Array.from(byRider.entries()).map(([riderId, riderRows]) => {
      const summary = summarizeLocationRows(riderRows);
      const manualKm = manualKmByRider.get(riderId) || 0;
      return {
        rider_id: Number.parseInt(riderId, 10),
        rider_name: String(
          riderRows[0]?.rider_name ||
            manualNameByRider.get(riderId) ||
            `Rider #${riderId}`,
        ).trim(),
        ...summary,
        manual_km: Number(manualKm.toFixed(3)),
        km_difference: Number((summary.distance_km - manualKm).toFixed(3)),
      };
    });
    for (const [riderId, manualKm] of manualKmByRider.entries()) {
      if (byRider.has(riderId)) continue;
      riders.push({
        rider_id: Number.parseInt(riderId, 10),
        rider_name: manualNameByRider.get(riderId) || `Rider #${riderId}`,
        points: 0,
        distance_km: 0,
        started_at: null,
        updated_at: null,
        manual_km: Number(manualKm.toFixed(3)),
        km_difference: Number((0 - manualKm).toFixed(3)),
      });
    }

    const orders = Array.from(byOrder.entries()).map(([orderId, orderRows]) => ({
      order_id: Number.parseInt(orderId, 10),
      order_number: orderRows[0]?.order_number || null,
      rider_id: orderRows[0]?.rider_id || null,
      rider_name: String(orderRows[0]?.rider_name || "").trim(),
      store_name: orderRows[0]?.store_name || null,
      status: orderRows[0]?.order_status || null,
      ...summarizeLocationRows(orderRows),
    }));

    res.json({
      success: true,
      date,
      riders,
      orders,
    });
  } catch (error) {
    console.error("Error fetching rider travel summary:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch rider travel summary",
      error: error.message,
    });
  }
});

// Get rider wallet stats (Daily, Weekly, Monthly)
router.get("/rider/wallet-stats", authenticateToken, async (req, res) => {
  try {
    if (req.user.user_type !== "rider") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Rider only.",
      });
    }

    const riderId = req.user.id;
    const { period } = req.query; // daily, weekly, monthly

    // Check if rider exists and is active
    const [riders] = await req.db.execute(
      "SELECT id FROM riders WHERE id = ? AND is_active = true",
      [riderId],
    );

    if (riders.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Rider account is inactive or not found. Access denied.",
      });
    }

    let dateCondition = "";
    if (period === "daily") {
      dateCondition = `${orderBusinessDateSql("o.created_at")} = ${orderBusinessDateSql("NOW()")}`;
    } else if (period === "weekly") {
      dateCondition = `${orderBusinessDateSql("o.created_at")} >= DATE_SUB(${orderBusinessDateSql("NOW()")}, INTERVAL 7 DAY)`;
    } else if (period === "monthly") {
      dateCondition = `${orderBusinessDateSql("o.created_at")} >= DATE_SUB(${orderBusinessDateSql("NOW()")}, INTERVAL 30 DAY)`;
    } else {
      dateCondition = `${orderBusinessDateSql("o.created_at")} = ${orderBusinessDateSql("NOW()")}`; // Default to daily
    }

    // 1. Daily Cash Received (Items amount only for cash orders, excluding delivery fee)
    const [cashReceivedResult] = await req.db.execute(
      `
            SELECT COALESCE(SUM(total_amount - COALESCE(delivery_fee, 0)), 0) as total_cash
            FROM orders o
            WHERE o.rider_id = ? AND o.payment_method = 'cash' AND o.payment_status = 'paid' AND o.status = 'delivered' AND ${dateCondition}
        `,
      [riderId],
    );

    // 2. Delivery Fees (All delivered orders regardless of payment method)
    const [deliveryFeesResult] = await req.db.execute(
      `
            SELECT COALESCE(SUM(delivery_fee), 0) as total_delivery_fees
            FROM orders o
            WHERE o.rider_id = ? AND o.status = 'delivered' AND ${dateCondition}
        `,
      [riderId],
    );

    // 3. Payment Summary (Breakdown by payment method)
    const [summaryResult] = await req.db.execute(
      `
            SELECT 
                payment_method,
                COUNT(*) as order_count,
                SUM(total_amount) as total_amount,
                SUM(delivery_fee) as total_delivery_fees
            FROM orders o
            WHERE o.rider_id = ? AND o.status = 'delivered' AND ${dateCondition}
            GROUP BY payment_method
        `,
      [riderId],
    );

    res.json({
      success: true,
      stats: {
        period,
        cash_received: cashReceivedResult[0].total_cash,
        total_delivery_fees: deliveryFeesResult[0].total_delivery_fees,
        payment_summary: summaryResult,
      },
    });
  } catch (error) {
    console.error("Error fetching rider wallet stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch wallet stats",
      error: error.message,
    });
  }
});

// Rider financial history with date filter
router.get("/rider/financial-history", authenticateToken, async (req, res) => {
  try {
    const isRider = req.user.user_type === "rider";
    const isAdminUser =
      req.user.user_type === "admin" || req.user.user_type === "standard_user";
    if (!isRider && !isAdminUser) {
      return res.status(403).json({
        success: false,
        message: "Access denied.",
      });
    }
    if (isAdminUser && !canViewRestrictedFinancialReports(req)) {
      return res.status(403).json({
        success: false,
        message: "Permission denied: restricted rider day transactions access required.",
      });
    }
    await ensureRiderStorePaymentsTable(req.db);
    await ensureRiderDayClosingsTable(req.db);
    await ensureRiderCashSubmissionOrdersTable(req.db);
    const requestedRiderId = Number.parseInt(
      String(req.query.rider_id || req.query.riderId || ""),
      10
    );
    const riderId = isRider ? req.user.id : requestedRiderId;
    if (!Number.isInteger(riderId) || riderId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid rider_id is required.",
      });
    }
    if (isAdminUser) {
      const [riderRows] = await req.db.execute(
        "SELECT id FROM riders WHERE id = ? LIMIT 1",
        [riderId]
      );
      if (!riderRows.length) {
        return res.status(404).json({
          success: false,
          message: "Rider not found.",
        });
      }
    }
    const from = (req.query.from || req.query.date_from || "").toString().trim();
    const to = (req.query.to || req.query.date_to || "").toString().trim();
    const hasFrom = !!from;
    const hasTo = !!to;

    const movementDateFilter = [
      hasFrom ? "rcm.movement_date >= ?" : null,
      hasTo ? "rcm.movement_date <= ?" : null,
    ].filter(Boolean).join(" AND ");
    const movementParams = [riderId, ...(hasFrom ? [from] : []), ...(hasTo ? [to] : [])];

    const [movements] = await req.db.execute(
      `SELECT
         rcm.id,
         rcm.movement_number,
         DATE_FORMAT(rcm.movement_date, '%Y-%m-%d') AS movement_date,
         DATE_FORMAT(COALESCE(rcm.created_at, rcm.movement_date), '%Y-%m-%d %H:%i:%s') AS movement_at,
         DATE_FORMAT(rcm.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
         rcm.movement_type,
         rcm.amount,
         rcm.description,
         rcm.status,
         rcm.reference_type,
         rcm.reference_id
       FROM rider_cash_movements rcm
       WHERE rcm.rider_id = ?
       ${movementDateFilter ? `AND ${movementDateFilter}` : ""}
       ORDER BY rcm.movement_date DESC, rcm.id DESC`,
      movementParams
    );

    const [walletRows] = await req.db.execute(
      "SELECT id, balance FROM wallets WHERE rider_id = ? LIMIT 1",
      [riderId]
    );
    const wallet = walletRows[0] || null;
    const walletId = wallet ? wallet.id : null;

    let walletTx = [];
    if (walletId) {
      const txFilter = [
        hasFrom ? "DATE(wt.created_at) >= ?" : null,
        hasTo ? "DATE(wt.created_at) <= ?" : null,
      ].filter(Boolean).join(" AND ");
      const txParams = [walletId, ...(hasFrom ? [from] : []), ...(hasTo ? [to] : [])];
      const [txRows] = await req.db.execute(
        `SELECT wt.id, wt.type, wt.amount, wt.description, wt.reference_type, wt.reference_id, wt.balance_after, wt.created_at
         FROM wallet_transactions wt
         WHERE wt.wallet_id = ?
         ${txFilter ? `AND ${txFilter}` : ""}
         ORDER BY wt.created_at DESC, wt.id DESC
         LIMIT 500`,
        txParams
      );
      walletTx = txRows || [];
    }

    const [fuelRows] = await req.db.execute(
      `SELECT id, entry_date, fuel_cost, distance, notes
       FROM riders_fuel_history
       WHERE rider_id = ?
       ${hasFrom ? "AND DATE(entry_date) >= ?" : ""}
       ${hasTo ? "AND DATE(entry_date) <= ?" : ""}
       ORDER BY entry_date DESC, id DESC`,
      [riderId, ...(hasFrom ? [from] : []), ...(hasTo ? [to] : [])]
    );

    const [unsubmittedCashOrders] = await req.db.execute(
      `SELECT
         o.id,
         o.order_number,
         o.created_at,
         o.total_amount,
         o.total_amount AS unsubmitted_amount,
         o.total_amount AS remaining_amount,
         o.delivery_fee,
         o.payment_method,
         o.payment_status,
         o.status
       FROM orders o
       WHERE o.rider_id = ?
         AND o.status = 'delivered'
         AND LOWER(TRIM(COALESCE(o.payment_method, ''))) = 'cash'
         AND LOWER(TRIM(COALESCE(o.payment_status, ''))) = 'paid'
         ${hasFrom ? "AND DATE(o.created_at) >= ?" : ""}
         ${hasTo ? "AND DATE(o.created_at) <= ?" : ""}
         AND NOT EXISTS (
           SELECT 1
           FROM rider_cash_submission_orders rcso
           JOIN rider_cash_movements rcm ON rcm.id = rcso.movement_id
           WHERE rcso.order_id = o.id
             AND rcm.movement_type = 'cash_submission'
             AND rcm.status IN ('pending', 'approved', 'completed')
         )
       ORDER BY o.created_at DESC, o.id DESC`,
      [riderId, ...(hasFrom ? [from] : []), ...(hasTo ? [to] : [])]
    );
    const unsubmittedCashTotal = roundAmount(
      unsubmittedCashOrders.reduce(
        (s, o) => s + Number(o.unsubmitted_amount || o.remaining_amount || 0),
        0
      )
    );

    const [orderLedgerRows] = await req.db.execute(
      `SELECT
         o.id AS order_id,
         o.order_number,
         DATE(o.created_at) AS order_date,
         o.created_at,
         o.total_amount,
         o.delivery_fee,
         o.payment_method,
         o.payment_status,
         o.status,
         COALESCE(oi.store_id, p.store_id) AS store_id,
         s.name AS store_name,
         s.payment_term,
         COALESCE(SUM(oi.quantity * oi.price), 0) AS customer_items_total,
         COALESCE(SUM(
           COALESCE(oi.cost_price, psp.cost_price, p.cost_price, oi.price) * oi.quantity
         ), 0) AS store_base_payable,
         COALESCE(rsp.amount, 0) AS rider_paid_store
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id
       JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id)
       LEFT JOIN product_size_prices psp
         ON psp.product_id = oi.product_id
        AND (
          (oi.size_id IS NOT NULL AND psp.size_id = oi.size_id AND psp.unit_id IS NULL)
          OR
          (oi.unit_id IS NOT NULL AND psp.unit_id = oi.unit_id AND psp.size_id IS NULL)
        )
       LEFT JOIN (
         SELECT order_id, store_id, SUM(amount) AS amount
         FROM rider_store_payments
         WHERE rider_id = ?
         GROUP BY order_id, store_id
       ) rsp ON rsp.order_id = o.id AND rsp.store_id = COALESCE(oi.store_id, p.store_id)
       WHERE o.rider_id = ?
         AND o.status = 'delivered'
         ${hasFrom ? "AND DATE(o.created_at) >= ?" : ""}
         ${hasTo ? "AND DATE(o.created_at) <= ?" : ""}
       GROUP BY
         o.id, o.order_number, DATE(o.created_at), o.created_at, o.total_amount, o.delivery_fee,
         o.payment_method, o.payment_status, o.status,
         COALESCE(oi.store_id, p.store_id), s.name, s.payment_term, rsp.amount
       ORDER BY o.created_at DESC, o.id DESC`,
      [riderId, riderId, ...(hasFrom ? [from] : []), ...(hasTo ? [to] : [])]
    );

    const ledgerByOrder = new Map();
    for (const row of orderLedgerRows || []) {
      const orderId = Number(row.order_id);
      if (!ledgerByOrder.has(orderId)) {
        const isCashOrder =
          String(row.payment_method || "").toLowerCase().trim() === "cash";
        ledgerByOrder.set(orderId, {
          order_id: orderId,
          order_number: row.order_number,
          order_date: row.order_date,
          created_at: row.created_at,
          payment_method: row.payment_method,
          payment_status: row.payment_status,
          status: row.status,
          order_total: roundAmount(row.total_amount || 0),
          delivery_fee: roundAmount(row.delivery_fee || 0),
          customer_cash_collected: isCashOrder ? roundAmount(row.total_amount || 0) : 0,
          stores: [],
          items_total: 0,
          rider_store_paid: 0,
          rider_store_payable_now: 0,
          missing_rider_store_payment: 0,
          store_payable_later: 0,
          company_profit_adjustment: 0,
          delivery_charge_cash: isCashOrder ? roundAmount(row.delivery_fee || 0) : 0,
          expected_rider_cash_effect: 0,
        });
      }

      const orderLedger = ledgerByOrder.get(orderId);
      const paymentTerm = row.payment_term || "";
      const isPickupPaid = isRiderPickupPaidPaymentTerm(paymentTerm);
      const customerItemsTotal = roundAmount(row.customer_items_total || 0);
      const storeBasePayable = roundAmount(row.store_base_payable || 0);
      const riderPaidStore = roundAmount(row.rider_paid_store || 0);
      const adjustment = roundAmount(customerItemsTotal - storeBasePayable);

      orderLedger.items_total = roundAmount(orderLedger.items_total + customerItemsTotal);
      orderLedger.rider_store_paid = roundAmount(orderLedger.rider_store_paid + riderPaidStore);
      orderLedger.rider_store_payable_now = roundAmount(
        orderLedger.rider_store_payable_now + (isPickupPaid ? storeBasePayable : 0)
      );
      orderLedger.missing_rider_store_payment = roundAmount(
        orderLedger.missing_rider_store_payment +
          (isPickupPaid ? Math.max(0, storeBasePayable - riderPaidStore) : 0)
      );
      orderLedger.store_payable_later = roundAmount(
        orderLedger.store_payable_later + (isPickupPaid ? 0 : storeBasePayable)
      );
      orderLedger.company_profit_adjustment = roundAmount(
        orderLedger.company_profit_adjustment + adjustment
      );
      orderLedger.stores.push({
        store_id: row.store_id,
        store_name: row.store_name,
        payment_term: paymentTerm,
        customer_items_total: customerItemsTotal,
        store_payable: storeBasePayable,
        store_payable_now: isPickupPaid ? storeBasePayable : 0,
        rider_paid_now: riderPaidStore,
        missing_rider_payment: isPickupPaid
          ? roundAmount(Math.max(0, storeBasePayable - riderPaidStore))
          : 0,
        store_payable_later: isPickupPaid ? 0 : storeBasePayable,
        company_profit_adjustment: adjustment,
        settlement_mode: isPickupPaid ? "rider_paid_now" : "office_credit_later",
      });
    }

    const orderLedger = Array.from(ledgerByOrder.values()).map((order) => ({
      ...order,
      expected_rider_cash_effect: roundAmount(
        Number(order.customer_cash_collected || 0) -
          Number(order.rider_store_paid || 0)
      ),
    }));

    const ledgerSummary = {
      cash_in_customer: roundAmount(
        orderLedger.reduce((s, o) => s + Number(o.customer_cash_collected || 0), 0)
      ),
      cash_out_store_paid: roundAmount(
        orderLedger.reduce((s, o) => s + Number(o.rider_store_paid || 0), 0)
      ),
      store_payable_later: roundAmount(
        orderLedger.reduce((s, o) => s + Number(o.store_payable_later || 0), 0)
      ),
      rider_store_payable_now: roundAmount(
        orderLedger.reduce((s, o) => s + Number(o.rider_store_payable_now || 0), 0)
      ),
      missing_rider_store_payment: roundAmount(
        orderLedger.reduce((s, o) => s + Number(o.missing_rider_store_payment || 0), 0)
      ),
      company_profit_adjustment: roundAmount(
        orderLedger.reduce((s, o) => s + Number(o.company_profit_adjustment || 0), 0)
      ),
      delivery_charge_cash: roundAmount(
        orderLedger.reduce((s, o) => s + Number(o.delivery_charge_cash || 0), 0)
      ),
      expected_rider_cash: 0,
    };
    ledgerSummary.expected_rider_cash = roundAmount(
      ledgerSummary.cash_in_customer - ledgerSummary.cash_out_store_paid
    );

    const summary = {
      wallet_balance: roundAmount(wallet?.balance || 0),
      unsubmitted_cash_received: unsubmittedCashTotal,
      cash_in_customer: ledgerSummary.cash_in_customer,
      cash_out_store_paid: ledgerSummary.cash_out_store_paid,
      rider_store_payable_now: ledgerSummary.rider_store_payable_now,
      missing_rider_store_payment: ledgerSummary.missing_rider_store_payment,
      store_payable_later: ledgerSummary.store_payable_later,
      company_profit_adjustment: ledgerSummary.company_profit_adjustment,
      expected_rider_cash: ledgerSummary.expected_rider_cash,
      cash_collection: roundAmount(
        movements
          .filter((m) => m.movement_type === "cash_collection")
          .reduce((s, m) => s + Number(m.amount || 0), 0)
      ),
      office_advance: roundAmount(
        movements
          .filter((m) => m.movement_type === "advance")
          .reduce((s, m) => s + Number(m.amount || 0), 0)
      ),
      store_payment: roundAmount(
        movements
          .filter((m) => m.movement_type === "store_payment")
          .reduce((s, m) => s + Number(m.amount || 0), 0)
      ),
      fuel_payment: roundAmount(
        fuelRows.reduce((s, r) => s + Number(r.fuel_cost || 0), 0)
      ),
      delivery_fee_earned: 0,
    };

    const [feeRows] = await req.db.execute(
      `SELECT COALESCE(SUM(delivery_fee), 0) as delivery_fee_earned
       FROM orders
       WHERE rider_id = ?
         AND status = 'delivered'
          ${hasFrom ? `AND ${orderBusinessDateSql("created_at")} >= ?` : ""}
          ${hasTo ? `AND ${orderBusinessDateSql("created_at")} <= ?` : ""}`,
      [riderId, ...(hasFrom ? [from] : []), ...(hasTo ? [to] : [])]
    );
    summary.delivery_fee_earned = roundAmount(feeRows[0]?.delivery_fee_earned || 0);

    const summaryDate = normalizeDateOnlyInput(to) ||
      normalizeDateOnlyInput(from) ||
      new Date().toISOString().slice(0, 10);
    const onSummaryDate = (raw) => {
      if (!raw) return false;
      const str = String(raw);
      return str.length >= 10 && str.slice(0, 10) === summaryDate;
    };
    const dailySummary = {
      date: summaryDate,
      cash_collection: roundAmount(
        movements
          .filter((m) => m.movement_type === "cash_collection" && onSummaryDate(m.movement_date))
          .reduce((s, m) => s + Number(m.amount || 0), 0)
      ),
      office_advance: roundAmount(
        movements
          .filter((m) => m.movement_type === "advance" && onSummaryDate(m.movement_date))
          .reduce((s, m) => s + Number(m.amount || 0), 0)
      ),
      store_payment: roundAmount(
        movements
          .filter((m) => m.movement_type === "store_payment" && onSummaryDate(m.movement_date))
          .reduce((s, m) => s + Number(m.amount || 0), 0)
      ),
      fuel_payment: roundAmount(
        fuelRows
          .filter((r) => onSummaryDate(r.entry_date))
          .reduce((s, r) => s + Number(r.fuel_cost || 0), 0)
      ),
      delivery_fee_earned: 0,
      wallet_balance: roundAmount(wallet?.balance || 0),
    };
    const [dailyFeeRows] = await req.db.execute(
      `SELECT COALESCE(SUM(delivery_fee), 0) as delivery_fee_earned
       FROM orders
       WHERE rider_id = ?
         AND status = 'delivered'
         AND ${orderBusinessDateSql("created_at")} = ?`,
      [riderId, summaryDate]
    );
    dailySummary.delivery_fee_earned = roundAmount(
      dailyFeeRows[0]?.delivery_fee_earned || 0
    );

    const [closingRows] = await req.db.execute(
      `SELECT id, rider_id, closed_date, wallet_balance, cash_collection, office_advance, store_payment, fuel_payment, delivery_fee_earned, notes, closed_at
       FROM rider_day_closings
       WHERE rider_id = ? AND closed_date = ?
       LIMIT 1`,
      [riderId, summaryDate]
    );
    const dayClosing = closingRows[0] || null;

    return res.json({
      success: true,
      summary,
      daily_summary: dailySummary,
      day_closing: dayClosing,
      movements,
      wallet_transactions: walletTx,
      unsubmitted_cash_orders: unsubmittedCashOrders || [],
      order_ledger: orderLedger,
      ledger_summary: ledgerSummary,
      fuel_entries: fuelRows || [],
      filters: { from: from || null, to: to || null, summary_date: summaryDate },
    });
  } catch (error) {
    console.error("Error fetching rider financial history:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch rider financial history",
      error: error.message,
    });
  }
});

router.post("/rider/close-day", authenticateToken, async (req, res) => {
  try {
    if (req.user.user_type !== "rider") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Rider only.",
      });
    }
    await ensureRiderStorePaymentsTable(req.db);
    await ensureRiderDayClosingsTable(req.db);

    const riderId = req.user.id;
    const closeDate = normalizeDateOnlyInput(req.body?.date) ||
      new Date().toISOString().slice(0, 10);
    const notes = String(req.body?.notes || "").trim() || null;

    const [movementRows] = await req.db.execute(
      `SELECT movement_type, amount
       FROM rider_cash_movements
       WHERE rider_id = ? AND DATE(movement_date) = ?`,
      [riderId, closeDate]
    );
    const [fuelRows] = await req.db.execute(
      `SELECT fuel_cost
       FROM riders_fuel_history
       WHERE rider_id = ? AND DATE(entry_date) = ?`,
      [riderId, closeDate]
    );
    const [walletRows] = await req.db.execute(
      `SELECT balance FROM wallets WHERE rider_id = ? LIMIT 1`,
      [riderId]
    );
    const [feeRows] = await req.db.execute(
      `SELECT COALESCE(SUM(delivery_fee), 0) as delivery_fee_earned
       FROM orders
       WHERE rider_id = ?
         AND status = 'delivered'
         AND DATE(created_at) = ?`,
      [riderId, closeDate]
    );

    const summary = {
      date: closeDate,
      wallet_balance: roundAmount(walletRows[0]?.balance || 0),
      cash_collection: roundAmount(
        movementRows
          .filter((m) => m.movement_type === "cash_collection")
          .reduce((s, m) => s + Number(m.amount || 0), 0)
      ),
      office_advance: roundAmount(
        movementRows
          .filter((m) => m.movement_type === "advance")
          .reduce((s, m) => s + Number(m.amount || 0), 0)
      ),
      store_payment: roundAmount(
        movementRows
          .filter((m) => m.movement_type === "store_payment")
          .reduce((s, m) => s + Number(m.amount || 0), 0)
      ),
      fuel_payment: roundAmount(
        fuelRows.reduce((s, r) => s + Number(r.fuel_cost || 0), 0)
      ),
      delivery_fee_earned: roundAmount(feeRows[0]?.delivery_fee_earned || 0),
    };

    await req.db.execute(
      `INSERT INTO rider_day_closings (
         rider_id, closed_date, wallet_balance, cash_collection, office_advance, store_payment, fuel_payment, delivery_fee_earned, notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         wallet_balance = VALUES(wallet_balance),
         cash_collection = VALUES(cash_collection),
         office_advance = VALUES(office_advance),
         store_payment = VALUES(store_payment),
         fuel_payment = VALUES(fuel_payment),
         delivery_fee_earned = VALUES(delivery_fee_earned),
         notes = VALUES(notes),
         closed_at = CURRENT_TIMESTAMP`,
      [
        riderId,
        closeDate,
        summary.wallet_balance,
        summary.cash_collection,
        summary.office_advance,
        summary.store_payment,
        summary.fuel_payment,
        summary.delivery_fee_earned,
        notes,
      ]
    );

    const [rows] = await req.db.execute(
      `SELECT id, rider_id, closed_date, wallet_balance, cash_collection, office_advance, store_payment, fuel_payment, delivery_fee_earned, notes, closed_at
       FROM rider_day_closings
       WHERE rider_id = ? AND closed_date = ?
       LIMIT 1`,
      [riderId, closeDate]
    );

    return res.json({
      success: true,
      message: "Day closed successfully",
      day_closing: rows[0] || null,
      daily_summary: summary,
    });
  } catch (error) {
    console.error("Error closing rider day:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to close rider day",
      error: error.message,
    });
  }
});

// Store owner financial history with date filter
router.get("/store-owner/financial-history", authenticateToken, requireStoreOwner, async (req, res) => {
  try {
    await ensureRiderStorePaymentsTable(req.db);
    await ensureStoreFinancialColumns(req.db);
    const ownerId = req.user.id;
    const from = (req.query.from || req.query.date_from || "").toString().trim();
    const to = (req.query.to || req.query.date_to || "").toString().trim();
    const hasFrom = !!from;
    const hasTo = !!to;

    const stores = await getStoreOwnerScopedStores(req.db, req.user);
    if (!stores.length) {
      return res.json({ success: true, summary: {}, entries: [], stores: [] });
    }
    const storeIds = stores.map((s) => s.id);
    const placeholders = storeIds.map(() => "?").join(",");

    const [entries] = await req.db.execute(
      `SELECT
          oi.store_id,
          s.name as store_name,
          s.payment_term,
          s.payment_grace_days,
          o.id as order_id,
          o.order_number,
          o.status as order_status,
          o.payment_method,
          o.payment_status,
          DATE(o.created_at) as order_date,
          COALESCE(SUM(oi.quantity * oi.price), 0) as gross_store_amount
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN stores s ON s.id = oi.store_id
       WHERE oi.store_id IN (${placeholders})
       ${hasFrom ? "AND DATE(o.created_at) >= ?" : ""}
       ${hasTo ? "AND DATE(o.created_at) <= ?" : ""}
       GROUP BY oi.store_id, s.name, s.payment_term, s.payment_grace_days, o.id, o.order_number, o.status, o.payment_method, o.payment_status, DATE(o.created_at)
       ORDER BY o.created_at DESC`,
      [...storeIds, ...(hasFrom ? [from] : []), ...(hasTo ? [to] : [])]
    );

    const [riderSettlements] = await req.db.execute(
      `SELECT rsp.order_id, rsp.store_id, rsp.amount, rsp.created_at
       FROM rider_store_payments rsp
       WHERE rsp.store_id IN (${placeholders})
       ${hasFrom ? "AND DATE(rsp.created_at) >= ?" : ""}
       ${hasTo ? "AND DATE(rsp.created_at) <= ?" : ""}
       ORDER BY rsp.created_at DESC`,
      [...storeIds, ...(hasFrom ? [from] : []), ...(hasTo ? [to] : [])]
    );

    const settlementMap = new Map();
    for (const row of riderSettlements || []) {
      settlementMap.set(`${row.order_id}:${row.store_id}`, roundAmount(row.amount || 0));
    }
    const enriched = (entries || []).map((e) => {
      const settled = settlementMap.get(`${e.order_id}:${e.store_id}`) || 0;
      return {
        ...e,
        gross_store_amount: roundAmount(e.gross_store_amount || 0),
        rider_store_payment: settled,
      };
    });

    const summary = {
      total_orders: enriched.length,
      gross_store_amount: roundAmount(
        enriched.reduce((s, e) => s + Number(e.gross_store_amount || 0), 0)
      ),
      rider_store_payment: roundAmount(
        enriched.reduce((s, e) => s + Number(e.rider_store_payment || 0), 0)
      ),
    };

    return res.json({
      success: true,
      summary,
      entries: enriched,
      stores,
      filters: { from: from || null, to: to || null },
    });
  } catch (error) {
    console.error("Error fetching store-owner financial history:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch store-owner financial history",
      error: error.message,
    });
  }
});

// Get store owner's dashboard orders
router.get(
  "/store-dashboard",
  authenticateToken,
  requireStoreOwner,
  async (req, res) => {
    try {
      await ensureOrderItemsSchema(req.db);
      await ensureStoreFinancialColumns(req.db);
      const { status } = req.query;

      // Find stores owned by this user
      const myStores = await getStoreOwnerScopedStores(req.db, req.user);

      if (myStores.length === 0) {
        return res.json({ success: true, orders: [] });
      }

      const storeIds = myStores.map((s) => s.id);
      const placeholders = storeIds.map(() => "?").join(",");

      let query = `
            SELECT DISTINCT o.*, u.first_name, u.last_name, u.phone
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            JOIN users u ON o.user_id = u.id
            WHERE oi.store_id IN (${placeholders})
        `;
      const params = [...storeIds];

      if (status && status !== "all") {
        query += " AND o.status = ?";
        params.push(status);
      }

      query += " ORDER BY o.created_at DESC";

      const [orders] = await req.db.execute(query, params);

      // For each order, we only want to show items related to MY stores
      for (const order of orders) {
        const [items] = await req.db.execute(
          `
                SELECT oi.*, p.name as product_name, p.image_url
                FROM order_items oi
                JOIN products p ON oi.product_id = p.id
                WHERE oi.order_id = ? AND oi.store_id IN (${placeholders})
            `,
          [order.id, ...storeIds],
        );
        order.items = items;
      }

      // --- NEW: Calculate Dashboard Stats ---
      
      // 1. Order Counts (Distinct Orders)
      const [countRows] = await req.db.execute(`
          SELECT 
              COUNT(DISTINCT o.id) as total_orders,
              COUNT(DISTINCT CASE WHEN o.status = 'delivered' THEN o.id END) as delivered,
              COUNT(DISTINCT CASE WHEN o.status = 'preparing' THEN o.id END) as preparing,
              COUNT(DISTINCT CASE WHEN o.status = 'ready' THEN o.id END) as ready
          FROM orders o
          JOIN order_items oi ON o.id = oi.order_id
          WHERE oi.store_id IN (${placeholders})
      `, [...storeIds]);

      // 2. Delivered sales total kept only for legacy compatibility on the stats payload.
      const [revenueRows] = await req.db.execute(
          `SELECT
              COALESCE(SUM(
                oi.quantity * (
                  oi.price - (
                    CASE
                      WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%discount%'
                           AND COALESCE(s.store_discount_apply_all_products, 0) = 1
                           AND COALESCE(s.store_discount_percent, 0) > 0
                        THEN oi.price * (COALESCE(s.store_discount_percent, 0) / 100)
                      WHEN oi.discount_type = 'percent' AND COALESCE(oi.discount_value, 0) > 0
                        THEN oi.price * (COALESCE(oi.discount_value, 0) / 100)
                      WHEN oi.discount_type = 'amount' AND COALESCE(oi.discount_value, 0) > 0
                        THEN COALESCE(oi.discount_value, 0)
                      ELSE 0
                    END
                  )
                )
              ), 0) AS total_amount
           FROM order_items oi
           JOIN orders o ON oi.order_id = o.id
           JOIN stores s ON s.id = oi.store_id
           WHERE oi.store_id IN (${placeholders})
             AND o.status = 'delivered'`,
          [...storeIds]
      );
      const totalAmount = roundAmount(Number(revenueRows?.[0]?.total_amount || 0));

      // 3. Store wallet ledger balance (kept for diagnostics/display if needed)
      const [walletLedgerRows] = await req.db.execute(
          `SELECT
              COALESCE(SUM(CASE WHEN wt.type = 'credit' THEN wt.amount ELSE 0 END), 0) AS credits,
              COALESCE(SUM(CASE WHEN wt.type = 'debit' THEN wt.amount ELSE 0 END), 0) AS debits
           FROM wallets w
           LEFT JOIN wallet_transactions wt ON wt.wallet_id = w.id
           WHERE w.store_id IN (${placeholders})`,
          [...storeIds]
      );
      const ledgerCredits = Number(walletLedgerRows?.[0]?.credits || 0);
      const ledgerDebits = Number(walletLedgerRows?.[0]?.debits || 0);
      const walletBalance = roundAmount(ledgerCredits - ledgerDebits);

      // 4. Pending settlement payable (business balance for store owner dashboard)
      // Align with web store reports: for cash-only/cash-with-discount stores, pending is zero.
      const [pendingRows] = await req.db.execute(
          `SELECT
              COALESCE(SUM(earn.total_payable), 0) AS total_payable,
              COALESCE(SUM(paid.total_paid), 0) AS total_paid,
              COALESCE(SUM(
                CASE
                  WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) IN ('cash only', 'cash with discount')
                    THEN 0
                  ELSE GREATEST(0, COALESCE(earn.total_payable, 0) - COALESCE(paid.total_paid, 0))
                END
              ), 0) AS pending_settlement
           FROM stores s
           LEFT JOIN (
             SELECT
               COALESCE(oi.store_id, p.store_id) AS store_id,
               SUM(
                 GREATEST(
                   0,
                   (oi.price * oi.quantity) -
                   (
                     oi.quantity * (
                       CASE
                         WHEN LOWER(TRIM(COALESCE(s2.payment_term, ''))) LIKE '%discount%'
                              AND COALESCE(s2.store_discount_apply_all_products, 0) = 1
                              AND COALESCE(s2.store_discount_percent, 0) > 0
                           THEN oi.price * (COALESCE(s2.store_discount_percent, 0) / 100)
                         WHEN oi.discount_type = 'percent' AND COALESCE(oi.discount_value, 0) > 0
                           THEN oi.price * (COALESCE(oi.discount_value, 0) / 100)
                         WHEN oi.discount_type = 'amount' AND COALESCE(oi.discount_value, 0) > 0
                           THEN COALESCE(oi.discount_value, 0)
                         ELSE 0
                       END
                     )
                   )
                 )
               ) AS total_payable
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             JOIN products p ON p.id = oi.product_id
             JOIN stores s2 ON s2.id = COALESCE(oi.store_id, p.store_id)
             WHERE o.status = 'delivered'
             GROUP BY COALESCE(oi.store_id, p.store_id)
           ) earn ON earn.store_id = s.id
           LEFT JOIN (
             SELECT store_id, SUM(net_amount) AS total_paid
             FROM store_settlements
             WHERE status = 'paid'
             GROUP BY store_id
           ) paid ON paid.store_id = s.id
           WHERE s.id IN (${placeholders})`,
          [...storeIds]
      );
      const pendingSettlement = roundAmount(Number(pendingRows?.[0]?.pending_settlement || 0));

      // 5. Get Store Name explicitly for dashboard display
      const [storeInfo] = await req.db.execute(
          'SELECT name, owner_name, payment_term FROM stores WHERE id = ?', 
          [myStores[0].id]
      );
      const storeName = storeInfo.length > 0 ? storeInfo[0].name : myStores[0].name;
      const storeOwnerName = storeInfo.length > 0
        ? (storeInfo[0].owner_name || '').toString().trim()
        : '';
      const paymentTerm = storeInfo.length > 0
        ? (storeInfo[0].payment_term || '').toString().trim()
        : '';

      // 6. Owner info for dashboard header
      const ownerId = myStores[0].owner_id || req.user.id;
      const [ownerInfoRows] = await req.db.execute(
          `SELECT first_name, last_name, email, phone
           FROM users
           WHERE id = ?
           LIMIT 1`,
          [ownerId]
      );
      const ownerInfo = ownerInfoRows.length > 0 ? ownerInfoRows[0] : {};
      let ownerName = storeOwnerName;
      if (!ownerName) {
        ownerName = `${ownerInfo.first_name || ''} ${ownerInfo.last_name || ''}`.trim();
      }
      if (ownerName && String(ownerName).toLowerCase() === String(storeName).toLowerCase()) {
        ownerName = '';
      }
      if (!ownerName) {
        ownerName = 'N/A';
      }

      const stats = {
          store_id: myStores[0].id,
          store_name: storeName, // Ensure this is populated correctly
          owner_name: ownerName || 'N/A',
          owner_email: ownerInfo.email || 'N/A',
          owner_phone: ownerInfo.phone || 'N/A',
          payment_term: paymentTerm || '',
          total_orders: countRows[0].total_orders,
          delivered: countRows[0].delivered,
          preparing: countRows[0].preparing,
          ready: countRows[0].ready,
          total_amount: totalAmount,
          // Business-facing balance for store dashboard
          received_balance: pendingSettlement,
          // Diagnostics: underlying wallet ledger balance
          wallet_balance: walletBalance
      };

      res.json({ success: true, orders, stats });
    } catch (error) {
      console.error("Error fetching store orders:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch store orders",
        error: error.message,
      });
    }
  },
);

// Get single order details
router.get("/:id(\\d+)", authenticateToken, async (req, res) => {
  console.log(`[orders] Fetching order details for ID: ${req.params.id}`);
  try {
    await ensureStoreFinancialColumns(req.db);
    const { id } = req.params;
    await ensureOrderItemsSchema(req.db);

    const [orders] = await req.db.execute(
      `
            SELECT o.*, u.first_name, u.last_name, u.email, u.phone, s.name as store_name,
                   r.first_name as rider_first_name, r.last_name as rider_last_name, r.phone as rider_phone
            FROM orders o
            JOIN users u ON o.user_id = u.id
            LEFT JOIN stores s ON o.store_id = s.id
            LEFT JOIN riders r ON o.rider_id = r.id
            WHERE o.id = ?
        `,
      [id],
    );

    console.log(`[orders] Found ${orders.length} orders for ID: ${id}`);

    if (orders.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const order = orders[0];

    // Check permission: Admin, Standard User, Rider assigned, Customer who owns the order, or Store Owner linked to items
    let isStoreOwner = false;
    if (req.user.user_type === "store_owner") {
      // Check if this order contains items from any store owned by this user
      const [storeCheck] = await req.db.execute(
        `
            SELECT 1 
            FROM order_items oi
            JOIN stores s ON oi.store_id = s.id
            WHERE oi.order_id = ? AND s.owner_id = ?
            LIMIT 1
        `,
        [id, req.user.id],
      );
      if (storeCheck.length > 0) {
        isStoreOwner = true;
      }
    }

    if (
      req.user.user_type !== "admin" &&
      req.user.user_type !== "standard_user" &&
      req.user.id !== order.user_id &&
      req.user.user_type === "rider" &&
      req.user.id !== order.rider_id &&
      !isStoreOwner
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    // Get order items with store info
    const [items] = await req.db.execute(
      `
            SELECT oi.*, p.name as product_name, p.image_url, s.name as store_name, s.payment_term, s.payment_grace_days
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            LEFT JOIN stores s ON oi.store_id = s.id
            WHERE oi.order_id = ?
        `,
      [id],
    );

    order.items = items;

    // Group items by store for proper multi-store display
    const storeGroups = {};
    items.forEach((item) => {
      const sId = item.store_id || "unknown";
      if (!storeGroups[sId]) {
        storeGroups[sId] = {
          store_id: item.store_id,
          store_name: item.store_name || "Unknown Store",
          payment_term: item.payment_term || null,
          payment_grace_days:
            item.payment_grace_days === null ||
            item.payment_grace_days === undefined
              ? null
              : Number(item.payment_grace_days),
          items: [],
        };
      }
      storeGroups[sId].items.push(item);
    });

    order.store_wise_items = Object.values(storeGroups);

    res.json({
      success: true,
      order,
    });
  } catch (error) {
    console.error("Error fetching order details:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch order details",
      error: error.message,
    });
  }
});

// Helper to get store ID for owner
async function getStoreIdForOwner(db, userId) {
    const [rows] = await db.execute('SELECT id FROM stores WHERE owner_id = ? LIMIT 1', [userId]);
    return rows.length > 0 ? rows[0].id : null;
}

// Get all orders (Admin & Dispatch only)
router.get("/", authenticateToken, async (req, res) => {
  console.log(
    "[DEBUG] GET /api/orders hit. User:",
    req.user ? `${req.user.id} (${req.user.user_type})` : "No user",
  );
  try {
    // Permission check: Admin, Dispatch, or Dashboard Viewer
    if (req.user.user_type === "admin") {
      // Admin allowed
    } else if (req.user.user_type === "standard_user") {
      // Check for specific permissions
      try {
        // Debug permissions
        const [debugPerms] = await req.db.execute(
          "SELECT permission_key FROM user_permissions WHERE user_id = ?",
          [req.user.id],
        );
        console.log(
          `[DEBUG] Orders Route - User ${req.user.id} permissions:`,
          debugPerms.map((p) => p.permission_key),
        );

        const [perms] = await req.db.execute(
          "SELECT 1 FROM user_permissions WHERE user_id = ? AND permission_key IN (?, ?)",
          [req.user.id, "menu_dashboard", "menu_orders"],
        );
        if (perms.length === 0) {
          console.log(
            `[DEBUG] User ${req.user.id} denied access to orders. Missing menu_dashboard or menu_orders.`,
          );
          return res
            .status(403)
            .json({ success: false, message: "Access denied" });
        }
      } catch (e) {
        console.error("[DEBUG] Orders permission check error:", e);
        return res
          .status(500)
          .json({ success: false, message: "Permission check failed" });
      }
    } else {
      // Other roles (e.g. store owner) might need access logic here or be blocked
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { status, assignment, startDate, endDate, storeId } = req.query;
    const includeItemsCount =
      String(req.query.includeItemsCount ?? "true").toLowerCase() !== "false";
    const includeStoreStatuses =
      String(req.query.includeStoreStatuses ?? "true").toLowerCase() !==
      "false";
    const includeStoreDetails =
      String(req.query.includeStoreDetails ?? "true").toLowerCase() !==
      "false";
    let conditions = [];
    let params = [];

    if (status && status !== "all") {
      conditions.push(`o.status = ?`);
      params.push(status);
    }

    if (assignment === "unassigned") {
      conditions.push(
        `o.rider_id IS NULL AND o.status NOT IN ('delivered', 'cancelled')`,
      );
    } else if (assignment === "assigned") {
      conditions.push(`o.rider_id IS NOT NULL`);
    }

    if (startDate) {
      conditions.push(`${orderBusinessDateSql("o.created_at")} >= ?`);
      params.push(startDate);
    }

    if (endDate) {
      conditions.push(`${orderBusinessDateSql("o.created_at")} <= ?`);
      params.push(endDate);
    }

    if (storeId) {
      conditions.push(
        `(o.store_id = ? OR EXISTS (SELECT 1 FROM order_items oi_store WHERE oi_store.order_id = o.id AND oi_store.store_id = ?))`,
      );
      params.push(storeId, storeId);
    }

    let whereClause = "";
    if (conditions.length > 0) {
      whereClause = "WHERE " + conditions.join(" AND ");
    }

    const dynamicFields = [];
    if (includeItemsCount) {
      dynamicFields.push(
        "CAST((SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS SIGNED) as items_count",
      );
    }
    if (includeStoreStatuses) {
      dynamicFields.push(`(
          SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT(
              'store_id', s2.id,
              'store_name', s2.name,
              'status', COALESCE(oi2.item_status, 'pending')
          )), ']')
          FROM order_items oi2
          JOIN stores s2 ON oi2.store_id = s2.id
          WHERE oi2.order_id = o.id
          GROUP BY oi2.order_id
      ) as store_statuses`);
    }
    if (includeStoreDetails) {
      dynamicFields.push(`(
          SELECT CONCAT('[', GROUP_CONCAT(JSON_OBJECT(
              'store_id', COALESCE(oi3.store_id, p3.store_id),
              'store_name', COALESCE(s3.name, 'Unknown Store'),
              'product_name', COALESCE(p3.name, CONCAT('Product #', oi3.product_id)),
              'variant_label', oi3.variant_label,
              'quantity', oi3.quantity,
              'price', oi3.price,
              'line_total', oi3.quantity * oi3.price,
              'status', COALESCE(oi3.item_status, 'pending')
          ) ORDER BY s3.name ASC, oi3.id ASC SEPARATOR ','), ']')
          FROM order_items oi3
          LEFT JOIN products p3 ON oi3.product_id = p3.id
          LEFT JOIN stores s3 ON s3.id = COALESCE(oi3.store_id, p3.store_id)
          WHERE oi3.order_id = o.id
      ) as order_store_details`);
    }
    const selectExtra = dynamicFields.length ? `, ${dynamicFields.join(",\n                   ")}` : "";

    if (includeStoreDetails) {
      try {
        await req.db.execute("SET SESSION group_concat_max_len = 65535");
      } catch (_) {}
    }

    const [orders] = await req.db.execute(
      `
            SELECT o.*, DATE_FORMAT(${orderBusinessDateSql("o.created_at")}, '%Y-%m-%d') AS order_business_date,
                   u.first_name, u.last_name, u.email, s.name as store_name,
                   s.payment_term as store_payment_term,
                   s.latitude as store_latitude, s.longitude as store_longitude,
                   r.first_name as rider_first_name, r.last_name as rider_last_name
                   ${selectExtra}
            FROM orders o
            JOIN users u ON o.user_id = u.id
            LEFT JOIN stores s ON o.store_id = s.id
            LEFT JOIN riders r ON o.rider_id = r.id
            ${whereClause}
            ORDER BY o.created_at DESC
        `,
      params,
    );

    res.json({
      success: true,
      orders,
    });
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
      error: error.message,
    });
  }
});

const TERMINAL_ORDER_RESET_EMAILS = RESTRICTED_FINANCIAL_REPORT_EMAILS;

function canResetTerminalOrder(user) {
  const email = String(user?.email || "").trim().toLowerCase();
  return TERMINAL_ORDER_RESET_EMAILS.has(email);
}

async function emitOrderResetToNew(req, order) {
  if (!req.io) return;

  const payload = {
    id: String(order.id),
    order_number: order.order_number,
    status: "pending",
    user_id: order.user_id,
    updated_at: new Date(),
    reset_to_new: true,
  };

  req.io.to(`user_${order.user_id}`).emit("order_status_update", payload);
  req.io.to("admins").emit("order_status_update", payload);
  req.io.to(`user_${order.user_id}`).emit("user_notification", {
    type: "refresh_orders",
    message: "Order reset to new order state",
    order_id: order.id,
  });

  if (order.rider_id) {
    req.io.to(`rider_${order.rider_id}`).emit("order_status_update", payload);
  }

  const [storeOwners] = await req.db.execute(
    `SELECT DISTINCT s.owner_id
     FROM order_items oi
     JOIN stores s ON oi.store_id = s.id
     WHERE oi.order_id = ?`,
    [order.id],
  );

  for (const owner of storeOwners) {
    if (owner.owner_id) {
      req.io.to(`user_${owner.owner_id}`).emit("store_owner_notification", {
        type: "silent_refresh",
        order_id: order.id,
        message: "",
      });
    }
  }
}

// Reset delivered/cancelled orders to the new-order state for selected admins only.
router.put(
  "/:id(\\d+)/reset-to-new",
  authenticateToken,
  requireStaffAccess,
  async (req, res) => {
    try {
      if (!canResetTerminalOrder(req.user)) {
        return res.status(403).json({
          success: false,
          message: "Only authorized users can reset delivered or cancelled orders.",
        });
      }

      const { id } = req.params;
      const [orders] = await req.db.execute(
        "SELECT id, order_number, user_id, rider_id, status FROM orders WHERE id = ?",
        [id],
      );

      if (orders.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      const order = orders[0];
      const currentStatus = String(order.status || "").trim().toLowerCase();
      if (!["delivered", "cancelled"].includes(currentStatus)) {
        return res.status(400).json({
          success: false,
          message: "Only delivered or cancelled orders can be reset to new.",
        });
      }

      await req.db.execute(
        "UPDATE order_items SET item_status = 'pending' WHERE order_id = ?",
        [id],
      );
      await req.db.execute(
        "UPDATE orders SET status = 'pending', rider_id = NULL, estimated_delivery_time = NULL, updated_at = NOW() WHERE id = ?",
        [id],
      );

      try {
        await emitOrderResetToNew(req, order);
      } catch (emitError) {
        console.error("Socket emit error in reset-to-new:", emitError);
      }

      res.json({
        success: true,
        message: "Order reset to new order state successfully",
        global_status: "pending",
      });
    } catch (error) {
      console.error("Error resetting order to new:", error);
      res.status(500).json({
        success: false,
        message: "Failed to reset order to new",
        error: error.message,
      });
    }
  },
);

// Update order status (Admin, Store Owner, or Standard User)
router.put(
  "/:id(\\d+)/status",
  authenticateToken,
  requireStaffAccess,
  [
    body("status")
      .isIn([
        "pending",
        "confirmed",
        "preparing",
        "ready",
        "ready_for_pickup", // New status
        "picked_up", // New status
        "delivered",
        "cancelled",
        "out_for_delivery",
      ])
      .withMessage("Invalid status"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { id } = req.params;
      const { status } = req.body;
      const itemStatusForDB = status === 'picked_up' ? 'out_for_delivery' : (status === 'ready_for_pickup' ? 'ready' : status);

      // Check if order exists and user has permission
      // NOTE: For multi-store orders, o.store_id might be null or one of them. 
      // We need to check if the user owns ANY of the stores in this order.
      const [orders] = await req.db.execute(
        `
            SELECT o.*, s.owner_id as main_store_owner_id
            FROM orders o
            LEFT JOIN stores s ON o.store_id = s.id
            WHERE o.id = ?
        `,
        [id],
      );

      if (orders.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      const order = orders[0];
      const currentOrderStatus = String(order.status || "").trim().toLowerCase();
      const currentPaymentStatus = String(order.payment_status || "")
        .trim()
        .toLowerCase();
      const isTerminalReopen =
        ["delivered", "cancelled"].includes(currentOrderStatus) &&
        !["delivered", "cancelled"].includes(status);
      const isTerminalResetToNew =
        status === "pending" &&
        ["delivered", "cancelled"].includes(currentOrderStatus);

      // Check permission
      let hasPermission = false;
      if (req.user.user_type === "admin" || req.user.user_type === "standard_user") {
          hasPermission = true;
      } else if (req.user.user_type === "store_owner") {
          // Check if this user owns ANY store involved in this order
          const [myStores] = await req.db.execute(
              `SELECT 1 FROM order_items oi
               JOIN stores s ON oi.store_id = s.id
               WHERE oi.order_id = ? AND s.owner_id = ?
               LIMIT 1`,
              [id, req.user.id]
          );
          if (myStores.length > 0) {
              hasPermission = true;
          }
      }

      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to update this order",
        });
      }

      if (isTerminalReopen && !canResetTerminalOrder(req.user)) {
        return res.status(403).json({
          success: false,
          message: "Only authorized users can reopen delivered or cancelled orders.",
        });
      }

      if (itemStatusForDB === "delivered" && currentPaymentStatus !== "paid") {
        return res.status(400).json({
          success: false,
          message:
            "Payment must be marked as paid before order can be delivered.",
        });
      }

      // --- Multi-Store Status Logic ---

      // 1. Identify which items to update
      let targetItemIds = [];
      if (req.user.user_type === 'store_owner') {
          // Store Owner: Only update their own items
          const [myItems] = await req.db.execute(
              `SELECT oi.id FROM order_items oi 
               JOIN stores s ON oi.store_id = s.id 
               WHERE oi.order_id = ? AND s.owner_id = ?`,
              [id, req.user.id]
          );
          targetItemIds = myItems.map(i => i.id);
      } else {
          // Admin/Staff: Update ALL items (force sync)
          const [allItems] = await req.db.execute(
              'SELECT id FROM order_items WHERE order_id = ?', 
              [id]
          );
          targetItemIds = allItems.map(i => i.id);
      }

      // 2. Update Item Statuses
      if (targetItemIds.length > 0) {
          const placeholders = targetItemIds.map(() => '?').join(',');
          await req.db.execute(
              `UPDATE order_items SET item_status = ? WHERE id IN (${placeholders})`,
              [itemStatusForDB, ...targetItemIds]
          );
      }

      // 3. Recalculate Global Status
      // We need to know the status of ALL items to determine the global order status
      const [allOrderItems] = await req.db.execute(
          'SELECT item_status FROM order_items WHERE order_id = ?', 
          [id]
      );
      
      // Default nulls to 'pending'
      const statuses = allOrderItems.map(i => i.item_status || 'pending');
      
      let newGlobalStatus = 'pending';
      const uniqueStatuses = new Set(statuses);

      if (statuses.length === 0) {
          newGlobalStatus = status; // Fallback if no items
      } else if (uniqueStatuses.size === 1) {
          // All items have same status
          newGlobalStatus = statuses[0];
      } else {
          // Mixed statuses - Determine lowest common denominator
          const has = (s) => statuses.includes(s);
          
          // Custom logic: If status requested is 'ready_for_pickup', allow it to influence global state
          // The issue is if Store A is 'ready_for_pickup' and Store B is 'pending', global is 'preparing'.
          // But if Store A says 'ready_for_pickup', the customer should see 'ready' for Store A.
          
          if (statuses.every(s => s === 'cancelled')) {
              newGlobalStatus = 'cancelled';
          } else if (statuses.every(s => s === 'delivered' || s === 'cancelled')) {
              newGlobalStatus = 'delivered';
          } else if (has('out_for_delivery') || has('picked_up')) {
              // If any item is out/picked up, global status is out_for_delivery
              newGlobalStatus = 'out_for_delivery';
          } else if (has('ready_for_pickup')) {
              // If ANY item is ready for pickup, the order is effectively in a "ready" state for that store.
              // BUT for global status, if there are still items "preparing", global should stay "preparing".
              // If there are "ready" and "ready_for_pickup" and no "preparing", then global is "ready".
              
              const activeStatuses = statuses.filter(s => !['delivered', 'cancelled'].includes(s));
              // Check if anything is still preparing or pending
              if (activeStatuses.some(s => ['preparing', 'pending', 'confirmed'].includes(s))) {
                  // If specifically THIS request was setting it to ready_for_pickup, we want to ensure
                  // the frontend reflects this progress, but 'preparing' is technically correct for the whole order.
                  newGlobalStatus = 'preparing';
              } else {
                  // Everything is at least ready or ready_for_pickup
                  newGlobalStatus = 'ready';
              }
          } else if (has('preparing')) {
              // If any item is still preparing, the whole order is preparing
              newGlobalStatus = 'preparing';
          } else if (has('pending') || has('confirmed')) {
              // If things are ready but some are still pending/confirmed (not started), it's confirmed/pending
              // But effectively "Preparing" is a better summary if work has started elsewhere? 
              // No, if Store A is Ready and Store B is Pending, we are waiting.
              // Let's stick to: If ANY is preparing, it's preparing.
              // If ALL are Ready (ignoring done ones), it's Ready.
              const activeStatuses = statuses.filter(s => !['delivered', 'cancelled'].includes(s));
              if (activeStatuses.every(s => s === 'ready')) {
                  newGlobalStatus = 'ready';
              } else if (activeStatuses.some(s => s === 'preparing')) {
                  newGlobalStatus = 'preparing';
              } else {
                  // Mixed Ready + Pending? effectively "Confirmed" or "Preparing"?
                  // Let's say "Preparing" to indicate work is needed/ongoing.
                  newGlobalStatus = 'preparing';
              }
          } else {
              newGlobalStatus = 'preparing'; // Default fallthrough
          }
      }

      if (newGlobalStatus === "delivered" && currentPaymentStatus !== "paid") {
        return res.status(400).json({
          success: false,
          message:
            "Payment must be marked as paid before order can be delivered.",
        });
      }

      if (isTerminalResetToNew) {
        await req.db.execute(
          "UPDATE orders SET status = ?, rider_id = NULL, estimated_delivery_time = NULL, updated_at = NOW() WHERE id = ?",
          [newGlobalStatus, id],
        );
      } else {
        await req.db.execute(
          "UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?",
          [newGlobalStatus, id],
        );
      }

      // Pickup-paid store settlement:
      // Only Cash Only / Cash with Discount stores are paid by the rider at pickup.
      // Credit stores are settled by office/admin, so rider wallet must not be debited.
      if (status === "picked_up" && order.rider_id) {
        await recordPickupPaidStorePaymentsForOrder(req.db, {
          orderId: id,
          riderId: order.rider_id,
          orderNumber: order.order_number,
          createdBy: req.user.id || null,
        });
      }

      if (
        newGlobalStatus === "delivered" &&
        currentPaymentStatus === "paid" &&
        order.rider_id
      ) {
        await recordPickupPaidStorePaymentsForOrder(req.db, {
          orderId: id,
          riderId: order.rider_id,
          orderNumber: order.order_number,
          createdBy: req.user.id || null,
        });
      }

      // Emit order_status_update event - only to specific rooms to avoid duplicates
      try {
        if (req.io) {
          const statusUpdateData = {
            id: id,
            order_number: order.order_number,
            status: newGlobalStatus, // Emit the calculated global status
            user_id: order.user_id,
            updated_at: new Date(),
            // ADDED: Include which specific store updated which status
            store_update: req.user.user_type === 'store_owner' ? {
                store_id: req.user.store_id || (await getStoreIdForOwner(req.db, req.user.id)),
                status: status, // The specific status requested (e.g., 'preparing')
                item_ids: targetItemIds
            } : null
          };
          
          // Send to user room only (avoid duplicate by not sending to all)
          req.io
            .to(`user_${order.user_id}`)
            .emit("order_status_update", statusUpdateData);
          req.io.to("admins").emit("order_status_update", statusUpdateData);

          // Custom logic: Only emit 'notification' event for user-facing status changes
          // Avoid spamming generic notifications.
          
          if (status === 'picked_up') {
              // ... existing picked_up logic ...
              // Fetch Store Name and Rider Name for the message
              const [details] = await req.db.execute(
                  `SELECT s.name as store_name, r.first_name as rider_name 
                   FROM order_items oi
                   JOIN stores s ON oi.store_id = s.id
                   LEFT JOIN orders o ON oi.order_id = o.id
                   LEFT JOIN riders r ON o.rider_id = r.id
                   WHERE oi.id = ?`,
                  [targetItemIds[0]] // Use first item to get store/rider details
              );
              
              if (details.length > 0) {
                  const { store_name, rider_name } = details[0];
                  const message = `Your order #${order.order_number} containing ${store_name} products has been picked up by rider ${rider_name || 'Assigned Rider'}. Please act accordingly.`;
                  
                  // Emit specific notification event
                  req.io.to(`user_${order.user_id}`).emit('notification', {
                      type: 'order_update',
                      title: 'Order Picked Up',
                      message: message,
                      order_id: id
                  });
                  await sendPushToUser(req.db, {
                    userId: order.user_id,
                    userType: "customer",
                    title: "Order Picked Up",
                    message,
                    data: {
                      type: "order_update",
                      order_id: id,
                      status: "picked_up",
                    },
                    collapseKey: "order_status",
                  });
              }
          } else if (status === 'ready_for_pickup') {
              // ALSO notify when "Ready for Pickup"
              const [details] = await req.db.execute(
                  `SELECT s.name as store_name FROM stores s WHERE s.id = (SELECT store_id FROM order_items WHERE id = ? LIMIT 1)`,
                  [targetItemIds[0]]
              );
              
              if (details.length > 0) {
                  const { store_name } = details[0];
                  req.io.to(`user_${order.user_id}`).emit('notification', {
                      type: 'order_update',
                      title: 'Order Ready',
                      message: `Your items from ${store_name} are ready for pickup.`,
                      order_id: id
                  });
                  await sendPushToUser(req.db, {
                    userId: order.user_id,
                    userType: "customer",
                    title: "Order Ready",
                    message: `Your items from ${store_name} are ready for pickup.`,
                    data: {
                      type: "order_update",
                      order_id: id,
                      status: "ready_for_pickup",
                    },
                    collapseKey: "order_status",
                  });
              }
          } else if (status === 'preparing' || status === 'ready') {
              // For preparing/ready, send a silent refresh only, OR a less intrusive notification if desired.
              // The user asked to STOP excessive notifications.
              // So for "Preparing", we just send the refresh signal, no visible toast needed unless customer is staring at screen.
              req.io.to(`user_${order.user_id}`).emit('user_notification', {
                  type: 'refresh_orders', // This triggers refresh but no toast in updated mobile code
                  message: '', 
                  order_id: id
              });
          }

          // Always ensure data is fresh on customer side (redundant but safe)
          if (status !== 'preparing' && status !== 'ready') {
             req.io.to(`user_${order.user_id}`).emit('user_notification', {
                type: 'refresh_orders',
                message: 'Order status updated',
                order_id: id
             });
          }
          
          // NEW: Notify Store Owners as well so their dashboard updates automatically
          // We need to notify ALL store owners involved in this order, not just the one who made the change
          // because if one store updates, the others might see a change in global status or just need a refresh.
          const [storeOwners] = await req.db.execute(
            `SELECT DISTINCT s.owner_id 
             FROM order_items oi
             JOIN stores s ON oi.store_id = s.id
             WHERE oi.order_id = ?`,
            [id]
          );
          
          for (const owner of storeOwners) {
              if (owner.owner_id) {
                  // Use 'silent_refresh' type to avoid visible notifications on other stores
                  req.io.to(`user_${owner.owner_id}`).emit('store_owner_notification', {
                      type: 'silent_refresh',
                      order_id: id,
                      message: '' 
                  });
              }
          }

          const fs = require("fs");
          const path = require("path");
          const logMsg = `[${new Date().toISOString()}] Status updated: ${order.order_number} -> ${newGlobalStatus} (Requested: ${status}). Store Owner Update: ${req.user.user_type === 'store_owner'}. Total clients: ${req.io.engine.clientsCount}\n`;
          fs.appendFile(
            path.join(__dirname, "../socket_debug.log"),
            logMsg,
            () => {},
          );
        }
      } catch (e) {
        console.error("Socket emit error:", e);
      }

      res.json({
        success: true,
        message: "Order status updated successfully",
        global_status: newGlobalStatus
      });
    } catch (error) {
      console.error("Error updating order:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update order",
        error: error.message,
      });
    }
  },
);

// Assign rider to order (Admin only)
router.put(
  "/:id(\\d+)/assign-rider",
  authenticateToken,
  requireDispatchAccess,
  [
    body("rider_id").isInt().withMessage("Rider ID must be a valid integer"),
    body("delivery_fee")
      .optional()
      .isFloat({ min: 0 })
      .withMessage("Invalid delivery fee"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { id } = req.params;
      const { rider_id, delivery_fee } = req.body;

      // Check if order exists
      const [orders] = await req.db.execute(
        "SELECT id, order_number, user_id, total_amount, delivery_fee, status FROM orders WHERE id = ?",
        [id],
      );
      if (orders.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      const order = orders[0];

      // Do not allow assigning riders to already completed or cancelled orders
      if (order.status === "delivered" || order.status === "cancelled") {
        return res.status(400).json({
          success: false,
          message: `Cannot assign rider to an order that is already ${order.status}`,
        });
      }

      if (order.rider_id && Number(order.rider_id) !== Number(rider_id)) {
        const [financialRows] = await req.db.execute(
          `SELECT 'wallet_transaction' AS source, wt.id
           FROM wallet_transactions wt
           WHERE wt.reference_type = 'order'
             AND CAST(wt.reference_id AS UNSIGNED) = ?
           LIMIT 1`,
          [id]
        );
        const [submissionRows] = await req.db.execute(
          `SELECT 'cash_submission_link' AS source, rcso.id
           FROM rider_cash_submission_orders rcso
           JOIN rider_cash_movements rcm ON rcm.id = rcso.movement_id
           WHERE rcso.order_id = ?
             AND rcm.status IN ('pending', 'approved', 'completed')
           LIMIT 1`,
          [id]
        );
        if (financialRows.length || submissionRows.length) {
          return res.status(409).json({
            success: false,
            message:
              "Cannot change rider after wallet or cash-submission records exist for this order",
          });
        }
      }

      // Check if rider exists and is available
      const [riders] = await req.db.execute(
        "SELECT id, first_name, last_name FROM riders WHERE id = ? AND is_active = true",
        [rider_id],
      );
      if (riders.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Rider not found or not active",
        });
      }

      const rider = riders[0];

      // Set estimated delivery time (current time + 30 minutes)
      const estimatedDelivery = new Date(Date.now() + 30 * 60 * 1000);

      // Recalculate total based on actual items
      const [items] = await req.db.execute(
        "SELECT price, quantity FROM order_items WHERE order_id = ?",
        [id],
      );

      let itemsSubtotal = 0;
      for (const item of items) {
        itemsSubtotal +=
          (parseFloat(item.price) || 0) * (parseInt(item.quantity) || 0);
      }

      let newTotal = order.total_amount;
      let finalDeliveryFee = parseFloat(order.delivery_fee) || 0;

      if (delivery_fee !== undefined) {
        finalDeliveryFee = parseFloat(delivery_fee);
        newTotal = Number(itemsSubtotal) + Number(finalDeliveryFee);
      } else {
        newTotal = Number(itemsSubtotal) + Number(finalDeliveryFee);
      }

      // Assign rider and update status
      // NOTE: We only update global status to 'out_for_delivery' if it was 'ready' or 'pending'.
      // If it was already 'out_for_delivery' or 'delivered', we shouldn't revert it.
      // But actually, assigning a rider usually implies the process is moving forward.
      // However, if we blindly set 'out_for_delivery', it might override 'preparing' or 'ready' logic.
      // If items are still 'preparing', the global status should arguably stay 'preparing' until pickup?
      // BUT typically "Assigned" means the rider is on the way. 
      // The issue user reported: "it again gone preparing status in store dashboard"
      // This implies we MIGHT be setting it to something that triggers a revert, OR we are NOT updating item statuses?
      //
      // Wait, the user said: "it again gone preparing status in store dashboard and preparing too with store info"
      // If we set global status to 'out_for_delivery', the store dashboard (which filters Active = preparing/ready/out_for_delivery) shows it.
      // But why "preparing"?
      // Ah, maybe the frontend or backend logic reverts it?
      //
      // If we look at the store dashboard logic:
      // Active = preparing || ready || out_for_delivery
      //
      // If the admin assigns a rider, the status becomes 'out_for_delivery' here (line 1877).
      //
      // BUT, if the Store Owner had marked their items as "Ready", and now we assign a rider...
      // Does assigning a rider change ITEM statuses? No.
      //
      // If the global status is 'out_for_delivery', but item status is 'ready', what does the dashboard show?
      // The dashboard shows the item status if available, or global status if not.
      //
      // If the user sees "preparing", it means either:
      // 1. The global status became "preparing" (unlikely here, we set it to out_for_delivery).
      // 2. The item status is still "preparing".
      //
      // "when assign order to rider after making all stores ready in admin panel"
      // If admin makes stores ready, they likely used the "Update Status" feature.
      //
      // If we assign a rider, we explicitly set status = 'out_for_delivery'.
      //
      // Let's check if we are overwriting something we shouldn't.
      //
      // Use case: Admin sets status to "Ready" (Global). Items might be updated to "Ready".
      // Then Admin assigns Rider.
      // This route updates global status to 'out_for_delivery'.
      //
      // If item statuses are 'ready', and global is 'out_for_delivery', the store dashboard should show 'Ready' or 'Out for Delivery'?
      //
      // Let's look at store_owner_dashboard_screen.dart again (from memory/previous reads):
      // It displays `item['item_status']` if available.
      //
      // If the item status is "preparing", it shows preparing.
      //
      // The user says: "after making all stores ready in admin panel".
      // If the admin panel updates status, it calls `PUT /:id/status`.
      // That endpoint updates `order_items` AND recalculates global status.
      //
      // If the admin assigns a rider, it calls `POST /:id/assign-rider`.
      // This endpoint (here) updates `orders` table but NOT `order_items`.
      //
      // If `order_items` were 'ready', they remain 'ready'.
      //
      // However, if the user sees "preparing", it implies `order_items` are 'preparing'.
      //
      // HYPOTHESIS: The Admin Panel "Make Ready" button might NOT be updating `order_items` correctly for all stores?
      // OR, when assigning a rider, we trigger some side effect?
      //
      // Actually, if we set global status to 'out_for_delivery', we should probably NOT force it if items aren't ready?
      // OR, we should just let it be.
      //
      // Wait, if the global status is 'out_for_delivery', but items are 'ready', the store owner sees 'ready'.
      //
      // If the user says it "gone preparing", it means `item_status` reverted to `preparing` OR global status became `preparing`.
      //
      // Let's look at the `PUT /:id/status` logic again (it was in previous turns).
      // It updates `order_items`.
      //
      // Here in `assign-rider`, we set global status to `out_for_delivery`.
      //
      // Is there any hook that runs on `out_for_delivery`?
      //
      // Maybe the issue is simpler: When a rider is assigned, we should probably NOT change the status to `out_for_delivery` immediately?
      // Usually "Out for Delivery" means the rider picked it up.
      // "Assigned" just means "Rider Assigned" (status could be 'ready' or 'preparing').
      //
      // If we set it to 'out_for_delivery' immediately upon assignment, that might be premature.
      //
      // If we change this to keep the existing status (or only update if it's pending), that might fix the confusion.
      //
      // Let's check what the current status is.
      // If status is 'ready', and we assign rider, it should probably stay 'ready' (or 'ready_for_pickup').
      //
      // If I change line 1877 to use the existing status (unless it's pending), that might be safer.
      //
      // BUT, usually assigning a rider moves it to "Accepted" or something.
      //
      // User said: "it again gone preparing".
      // This strongly suggests something is resetting the status.
      //
      // Let's look at line 1874: `UPDATE orders SET ... status = 'out_for_delivery' ...`
      // This forces global status to `out_for_delivery`.
      //
      // If the Store Owner dashboard sees `out_for_delivery`, it should show that?
      //
      // Unless... `_getStatusColor` or logic in dashboard defaults to something else?
      //
      // Wait! I recall the store dashboard logic:
      // `_activeOrders` includes `preparing`, `ready`, `out_for_delivery`.
      //
      // If the user says it "gone preparing", it implies the TEXT says "Preparing".
      //
      // Let's try to preserve the current status if it is 'ready' or 'preparing'.
      // Only change to 'confirmed' or 'preparing' if it was 'pending'?
      //
      // Actually, if a rider is assigned, the status shouldn't necessarily jump to `out_for_delivery`.
      // `out_for_delivery` usually happens when Rider clicks "Pick Up".
      //
      // So, I should change this to NOT force `out_for_delivery`.
      // I should leave the status as is, OR set it to 'confirmed'/ 'preparing' if it was pending.
      //
      // If the order was 'ready', it should stay 'ready'.
      // If the order was 'preparing', it should stay 'preparing'.
      //
      // So, I will remove `status = 'out_for_delivery'` from the update query,
      // OR only update it if it's currently 'pending'.
      
      let newStatus = order.status;
      if (order.status === 'pending') {
          newStatus = 'confirmed'; // or 'preparing'
      }
      // If it's already 'ready' or 'preparing', keep it.
      
      await req.db.execute(
        "UPDATE orders SET rider_id = ?, status = ?, estimated_delivery_time = ?, delivery_fee = ?, total_amount = ? WHERE id = ?",
        [
          rider_id,
          newStatus,
          estimatedDelivery,
          finalDeliveryFee,
          newTotal,
          id,
        ],
      );

      // Emit order_assigned event
      try {
        if (req.io) {
          const orderData = {
            id: id,
            order_number: order.order_number,
            rider_id: rider_id,
            rider_name: `${rider.first_name} ${rider.last_name}`,
            status: newStatus, // Send the ACTUAL new status, not hardcoded 'out_for_delivery'
            estimated_delivery_time: estimatedDelivery,
            delivery_fee: finalDeliveryFee,
            total_amount: newTotal,
          };

          console.log(
            `[Orders] Broadcasting order_assigned to admins`,
            orderData,
          );
          req.io.to("admins").emit("order_assigned", orderData);

          // NEW: Send "Store Owner Notification" to all store owners involved in this order
          // Identify unique stores in this order
          const [storeOwners] = await req.db.execute(
            `SELECT DISTINCT s.owner_id, s.name as store_name
             FROM order_items oi
             JOIN stores s ON oi.store_id = s.id
             WHERE oi.order_id = ?`,
            [id]
          );

          for (const owner of storeOwners) {
              const message = `Order #${order.order_number} containing ${owner.store_name} products has been assigned to rider ${rider.first_name} ${rider.last_name}.`;
              
              // Emit specific notification event to store owner
              // Assuming store owners join room 'user_{id}' just like customers
              req.io.to(`user_${owner.owner_id}`).emit('store_owner_notification', {
                  type: 'rider_assigned',
                  title: 'Rider Assigned',
                  message: message,
                  order_id: id,
                  rider_name: `${rider.first_name} ${rider.last_name}`
              });
              await sendPushToUser(req.db, {
                userId: owner.owner_id,
                userType: "store_owner",
                title: "Rider Assigned",
                message,
                data: {
                  type: "rider_assigned",
                  order_id: id,
                  order_number: order.order_number,
                },
                collapseKey: "store_owner_rider_assigned",
              });

              // Log notification
              const logMsg = `[${new Date().toISOString()}] Store notification sent to owner ${owner.owner_id} for store ${owner.store_name}\n`;
              const fs = require("fs");
              const path = require("path");
              fs.appendFile(path.join(__dirname, "../socket_debug.log"), logMsg, () => {});
          }

          const riderRoomName = `rider_${rider_id}`;
          const userRoomName = `user_${order.user_id}`;

          console.log(
            `[Orders] Emitting rider_notification to room: ${riderRoomName}`,
            { rider_id, order_number: order.order_number },
          );
          req.io.to(riderRoomName).emit("rider_notification", {
            type: "assigned",
            rider_id: rider_id,
            order_id: id,
            order_number: order.order_number,
            message: `New order assigned: ${order.order_number}`,
            timestamp: new Date(),
          });
          await sendPushToUser(req.db, {
            userId: rider_id,
            userType: "rider",
            title: "New Assignment",
            message: `New order assigned: ${order.order_number}`,
            data: {
              type: "assigned",
              order_id: id,
              order_number: order.order_number,
            },
            collapseKey: "rider_assignment",
          });

          console.log(
            `[Orders] Emitting user_notification to room: ${userRoomName}`,
            { user_id: order.user_id, order_number: order.order_number },
          );
          req.io.to(userRoomName).emit("user_notification", {
            type: "order_update",
            user_id: order.user_id,
            order_id: id,
            order_number: order.order_number,
            status: "out_for_delivery",
            message: `Your order ${order.order_number} has been assigned to rider ${rider.first_name}.`,
            timestamp: new Date(),
          });
          await sendPushToUser(req.db, {
            userId: order.user_id,
            userType: "customer",
            title: "Order Update",
            message: `Your order ${order.order_number} has been assigned to rider ${rider.first_name}.`,
            data: {
              type: "order_update",
              order_id: id,
              order_number: order.order_number,
              status: "out_for_delivery",
            },
            collapseKey: "order_status",
          });
          
          const fs = require("fs");
          const path = require("path");
          const logMsg = `[${new Date().toISOString()}] Order assigned: ${order.order_number} to ${rider.first_name}. Sent to rooms: ${riderRoomName}, ${userRoomName}\n`;
          fs.appendFile(
            path.join(__dirname, "../socket_debug.log"),
            logMsg,
            () => {},
          );
        }
      } catch (e) {
        console.error("Socket emit error:", e);
      }

      res.json({
        success: true,
        message: "Rider assigned successfully",
        delivery_fee: finalDeliveryFee,
        total_amount: newTotal,
      });
    } catch (error) {
      console.error("Error assigning rider:", error);
      res.status(500).json({
        success: false,
        message: "Failed to assign rider",
        error: error.message,
      });
    }
  },
);

// Update delivery fee (Admin only) - Auto-calculates based on unique stores in order
// Update delivery fee (Admin or Standard User)
router.put(
  "/:id(\\d+)/delivery-fee",
  authenticateToken,
  requireStaffAccess,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { delivery_fee: manual_delivery_fee } = req.body;

      // Check if order exists
      const [orders] = await req.db.execute(
        "SELECT id, total_amount, delivery_fee as old_delivery_fee FROM orders WHERE id = ?",
        [id],
      );
      if (orders.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      let is_manual = false;
      let manualFee = undefined;
      if (manual_delivery_fee !== undefined && manual_delivery_fee !== null && String(manual_delivery_fee).trim() !== "") {
        const parsed = parseFloat(manual_delivery_fee);
        if (isNaN(parsed) || parsed < 0) {
          return res
            .status(400)
            .json({ success: false, message: "Invalid delivery fee provided" });
        }
        manualFee = parsed;
        is_manual = true;
      }

      const synced = await syncOrderFinancialsAndDeliveryFee(req.db, id, {
        manualDeliveryFee: manualFee,
      });

      res.json({
        success: true,
        message: is_manual
          ? "Delivery fee updated manually"
          : "Delivery fee auto-calculated and updated successfully",
        delivery_fee: parseFloat(synced?.delivery_fee || 0),
        total_amount: parseFloat(synced?.total_amount || 0),
        store_count: synced?.store_count || 0,
      });
    } catch (error) {
      console.error("Error updating delivery fee:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update delivery fee",
        error: error.message,
      });
    }
  },
);

// Update rider location (Rider or Admin)
router.put(
  "/:id(\\d+)/rider-location",
  authenticateToken,
  [
    body("latitude").optional().isFloat().withMessage("Invalid latitude"),
    body("longitude").optional().isFloat().withMessage("Invalid longitude"),
    body("location").optional().notEmpty().withMessage("Location is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { id } = req.params;
      const { latitude, longitude } = req.body;
      const location = String(req.body.location || "").trim() || null;
      const resolvedLocation =
        latitude !== undefined && longitude !== undefined
          ? resolveFastRiderLocationLabel(latitude, longitude, location)
          : location;

      // Check if order exists and user has permission (rider or admin)
      const [orders] = await req.db.execute(
        "SELECT id, rider_id, user_id, order_number, total_amount, payment_status, status FROM orders WHERE id = ?",
        [id],
      );

      if (orders.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      const order = orders[0];

      // Check ownership permission
      if (
        req.user.user_type !== "admin" &&
        req.user.user_type !== "standard_user" &&
        order.rider_id !== req.user.id
      ) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to update this order",
        });
      }

      await ensureRiderLocationColumns(req.db);

      if (latitude !== undefined && longitude !== undefined) {
        await ensureRiderLocationLogsTable(req.db);
        const updateSql = resolvedLocation
          ? "UPDATE orders SET rider_latitude = ?, rider_longitude = ?, rider_location = ? WHERE id = ?"
          : "UPDATE orders SET rider_latitude = ?, rider_longitude = ? WHERE id = ?";
        const updateParams = resolvedLocation
          ? [latitude, longitude, resolvedLocation, id]
          : [latitude, longitude, id];
        await req.db.execute(updateSql, updateParams);
        try {
          await req.db.execute(
            "INSERT INTO rider_location_logs (rider_id, order_id, latitude, longitude, location_label) VALUES (?, ?, ?, ?, ?)",
            [order.rider_id, id, latitude, longitude, resolvedLocation],
          );
        } catch (e) {
          console.error("Failed to insert rider location log:", e);
        }

        emitRiderLocationUpdate(
          req.io,
          buildRiderLocationUpdatePayload({
            riderId: order.rider_id,
            latitude,
            longitude,
            location: resolvedLocation,
            orderIds: [Number.parseInt(String(id), 10)].filter(
              (value) => Number.isInteger(value) && value > 0,
            ),
          }),
        );

        if (!location || isCoordinateOnlyLocationLabel(location)) {
          reverseGeocodeRiderLocation(latitude, longitude).catch(() => {});
        }
      }

      res.json({
        success: true,
        message: "Rider location updated successfully",
      });
    } catch (error) {
      console.error("Error updating rider location:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update rider location",
        error: error.message,
      });
    }
  },
);

// Mark order as delivered (Rider or Admin)
router.put("/:id(\\d+)/deliver", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if order exists and user has permission (rider, admin, or standard user)
    const [orders] = await req.db.execute(
      `SELECT o.id, o.rider_id, o.user_id, o.order_number, o.total_amount, o.delivery_fee, o.payment_method, o.payment_status, o.status,
                    u.email as user_email, u.first_name as user_first_name
             FROM orders o
             JOIN users u ON o.user_id = u.id
             WHERE o.id = ?`,
      [id],
    );

    if (orders.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const order = orders[0];

    // Check ownership permission
    if (
      req.user.user_type !== "admin" &&
      req.user.user_type !== "standard_user" &&
      order.rider_id !== req.user.id
    ) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to update this order",
      });
    }

    const paymentStatus = String(order.payment_status || "")
      .trim()
      .toLowerCase();
    if (paymentStatus !== "paid") {
      return res.status(400).json({
        success: false,
        message:
          "Payment must be marked as paid before order can be delivered.",
      });
    }

    const [deliverResult] = await req.db.execute(
      "UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ? AND payment_status = ?",
      ["delivered", id, "paid"],
    );

    if (deliverResult.affectedRows === 0) {
      return res.status(409).json({
        success: false,
        message:
          "Order was not delivered because payment is no longer marked as paid. Please mark payment received first.",
      });
    }

    // Force update all order items to 'delivered' so they move to history in store dashboard
    await req.db.execute(
      "UPDATE order_items SET item_status = 'delivered' WHERE order_id = ?",
      [id]
    );

    // Notifications - only to specific rooms to avoid duplicates
    try {
      if (req.io) {
        // Status update to user room only (not to all)
        const statusUpdateData = {
          id: id,
          order_number: order.order_number,
          status: "delivered",
          user_id: order.user_id,
          updated_at: new Date(),
        };
        req.io
          .to(`user_${order.user_id}`)
          .emit("order_status_update", statusUpdateData);
        req.io.to("admins").emit("order_status_update", statusUpdateData);
        if (order.rider_id) {
          req.io.to(`rider_${order.rider_id}`).emit("order_status_update", {
            ...statusUpdateData,
            rider_id: order.rider_id,
          });
          req.io.to(`rider_${order.rider_id}`).emit("rider_notification", {
            type: "order_status_update",
            rider_id: order.rider_id,
            order_id: id,
            order_number: order.order_number,
            status: "delivered",
            message: `Order ${order.order_number} marked as delivered.`,
            timestamp: new Date(),
          });
          await sendPushToUser(req.db, {
            userId: order.rider_id,
            userType: "rider",
            title: "Order Delivered",
            message: `Order ${order.order_number} marked as delivered.`,
            data: {
              type: "order_status_update",
              order_id: id,
              order_number: order.order_number,
              status: "delivered",
            },
            collapseKey: "rider_order_status",
          });
        }

        const [storeOwners] = await req.db.execute(
          `SELECT DISTINCT s.owner_id
           FROM order_items oi
           JOIN stores s ON oi.store_id = s.id
           WHERE oi.order_id = ?`,
          [id],
        );
        for (const owner of storeOwners) {
          if (!owner.owner_id) continue;
          req.io.to(`user_${owner.owner_id}`).emit("store_owner_notification", {
            type: "order_status_update",
            order_id: id,
            order_number: order.order_number,
            status: "delivered",
            message: `Order ${order.order_number} delivered.`,
            timestamp: new Date(),
          });
          await sendPushToUser(req.db, {
            userId: owner.owner_id,
            userType: "store_owner",
            title: "Store Order Delivered",
            message: `Order ${order.order_number} delivered.`,
            data: {
              type: "order_status_update",
              order_id: id,
              order_number: order.order_number,
              status: "delivered",
            },
            collapseKey: "store_owner_order_status",
          });
        }

        // User notification
        const userNotifData = {
          type: "order_update",
          user_id: order.user_id,
          order_id: id,
          order_number: order.order_number,
          status: "delivered",
          message: `Your order ${order.order_number} has been delivered.`,
          timestamp: new Date(),
        };
        req.io
          .to(`user_${order.user_id}`)
          .emit("user_notification", userNotifData);
        await sendPushToUser(req.db, {
          userId: order.user_id,
          userType: "customer",
          title: "Order Delivered",
          message: `Your order ${order.order_number} has been delivered.`,
          data: {
            type: "order_update",
            order_id: id,
            order_number: order.order_number,
            status: "delivered",
          },
          collapseKey: "order_status",
        });

        // Admin notification
        const adminNotifData = {
          type: "order_update",
          order_id: id,
          order_number: order.order_number,
          status: "delivered",
          message: `Order ${order.order_number} has been delivered by rider.`,
          timestamp: new Date(),
        };
        req.io.to("admins").emit("user_notification", adminNotifData);

        // Check if completed (paid + delivered)
        if (order.payment_status === "paid") {
          const completedData = {
            id: id,
            order_number: order.order_number,
            user_id: order.user_id,
            total_amount: order.total_amount,
            message: `Thank you for choosing ServeNow! Your order ${order.order_number} has been completed and delivered.`,
            timestamp: new Date(),
          };
          // Send to user room only (not to all)
          req.io
            .to(`user_${order.user_id}`)
            .emit("order_completed", completedData);
          req.io.to("admins").emit("order_completed", completedData);

          // Send Thanks Email
          if (order.user_email) {
            sendOrderThanksEmail(
              order.user_email,
              order.user_first_name || "Customer",
              order.order_number,
            );
          }
        }
      }
    } catch (e) {
      console.error("Socket emit error in deliver:", e);
    }

    res.json({
      success: true,
      message: "Order marked as delivered successfully",
    });
  } catch (error) {
    console.error("Error marking order as delivered:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark order as delivered",
      error: error.message,
    });
  }
});

// Update payment status (Admin or Rider)
router.put(
  "/:id(\\d+)/payment-status",
  authenticateToken,
  [
    body("payment_status")
      .isIn(["pending", "paid", "failed"])
      .withMessage("Invalid payment status"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { id } = req.params;
      const { payment_status } = req.body;

      if (!payment_status) {
        return res.status(400).json({
          success: false,
          message: "Payment status is required",
        });
      }

      // Check if order exists and user has permission (rider or admin)
      const [orders] = await req.db.execute(
        `SELECT o.id, o.store_id, o.rider_id, o.user_id, o.order_number, o.total_amount, o.delivery_fee, o.payment_method, o.payment_status, o.status,
                    u.email as user_email, u.first_name as user_first_name
             FROM orders o
             JOIN users u ON o.user_id = u.id
             WHERE o.id = ?`,
        [id],
      );

      if (orders.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      const order = orders[0];

      // Check ownership permission
      if (
        req.user.user_type !== "admin" &&
        req.user.user_type !== "standard_user" &&
        order.rider_id !== req.user.id
      ) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to update this order",
        });
      }

      const [paymentUpdateResult] = await req.db.execute(
        "UPDATE orders SET payment_status = ?, updated_at = NOW() WHERE id = ? AND COALESCE(payment_status, '') <> ?",
        [payment_status, id, payment_status],
      );
      const paymentStatusChanged = Number(paymentUpdateResult?.affectedRows || 0) > 0;

      if (
        payment_status === "paid" &&
        order.rider_id &&
        paymentStatusChanged &&
        order.payment_status !== "paid"
      ) {
        // New Financial Management Logic for Basic Delivery of Goods
        // Store: 100 (Cr.), Delivery Charges: 70 (Cr.), Rider: 170 (Dr.)
        const orderTotal = parseFloat(order.total_amount || 0);
        const deliveryFee = parseFloat(order.delivery_fee || 0);
        const storeAmount = orderTotal - deliveryFee;

        // 1. Credit the Store (Payable to store)
        await recordFinancialTransaction(req.db, {
          transaction_type: "adjustment", // Using adjustment for payable, settlement is for actual payout
          category: "store_payable",
          description: `Store Credit for Order #${order.order_number}`,
          amount: storeAmount,
          payment_method: order.payment_method,
          related_entity_type: "store",
          related_entity_id: order.store_id,
          reference_type: "order",
          reference_id: id,
          created_by: req.user.id,
          notes: "Store: 100 (Cr.)",
        });

        // 2. Credit Total Order Amount (Income)
        // We record the full amount as income, and payouts to stores/riders as settlements/expenses
        await recordFinancialTransaction(req.db, {
          transaction_type: "income",
          category: "order_revenue",
          description: `Total Revenue for Order #${order.order_number}`,
          amount: orderTotal,
          payment_method: order.payment_method,
          related_entity_type: "rider",
          related_entity_id: order.rider_id,
          reference_type: "order",
          reference_id: id,
          created_by: req.user.id,
          notes: `Gross Income: ${orderTotal} (Cr.)`,
        });

        // 3. Update Rider Wallet
        // Wallet balance in mobile app is treated as rider's available amount.
        // For cash orders, credit full collected amount.
        // For non-cash orders, credit only delivery fee earnings.
        const isCash = order.payment_method === "cash";
        const cashCollected = isCash ? parseFloat(order.total_amount || 0) : 0;
        const riderDrAmount = cashCollected;

        // Get or Create Wallet
        const [wallets] = await req.db.execute(
          "SELECT id, balance FROM wallets WHERE rider_id = ?",
          [order.rider_id],
        );

        let walletId;
        let currentBalance = 0;

        if (wallets.length > 0) {
          walletId = wallets[0].id;
          currentBalance = parseFloat(wallets[0].balance || 0);
        } else {
          await req.db.execute(
            "INSERT INTO wallets (rider_id, user_type, balance) VALUES (?, ?, ?)",
            [order.rider_id, "rider", 0],
          );
          const [newWallets] = await req.db.execute(
            "SELECT id FROM wallets WHERE rider_id = ?",
            [order.rider_id],
          );
          walletId = newWallets[0].id;
        }

        // 3a. Credit rider wallet
        const walletCreditAmount = isCash ? cashCollected : deliveryFee;
        if (walletCreditAmount > 0) {
          const walletConn = await req.db.getConnection();
          try {
            await walletConn.beginTransaction();
            const [lockedWallets] = await walletConn.execute(
              "SELECT id, rider_id, balance FROM wallets WHERE id = ? FOR UPDATE",
              [walletId],
            );
            if (
              !lockedWallets.length ||
              Number(lockedWallets[0].rider_id) !== Number(order.rider_id)
            ) {
              throw new Error(
                `Wallet ${walletId} does not belong to rider ${order.rider_id}`
              );
            }
            currentBalance = parseFloat(lockedWallets?.[0]?.balance || 0);
            const existingCredits = await assertNoWalletOrderCreditConflict(
              walletConn,
              id,
              order.rider_id,
              walletId
            );

            if (!existingCredits.length) {
              currentBalance = roundAmount(currentBalance + walletCreditAmount);
              await walletConn.execute(
                "UPDATE wallets SET balance = ?, total_credited = total_credited + ? WHERE id = ?",
                [currentBalance, walletCreditAmount, walletId],
              );
              await walletConn.execute(
                `INSERT INTO wallet_transactions (wallet_id, type, amount, description, reference_type, reference_id, balance_after)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                  walletId,
                  "credit",
                  walletCreditAmount,
                  isCash
                    ? `Cash collection for order #${order.order_number}`
                    : `Delivery fee for order #${order.order_number}`,
                  "order",
                  id,
                  currentBalance,
                ],
              );
            }
            await walletConn.commit();
          } catch (walletCreditError) {
            await walletConn.rollback();
            throw walletCreditError;
          } finally {
            walletConn.release();
          }
        }

        // Record Rider Dr in financial_transactions
        await recordFinancialTransaction(req.db, {
          transaction_type: "adjustment",
          category: "rider_receivable",
          description: `Rider Debit for Order #${order.order_number}`,
          amount: riderDrAmount,
          payment_method: order.payment_method,
          related_entity_type: "rider",
          related_entity_id: order.rider_id,
          reference_type: "order",
          reference_id: id,
          created_by: req.user.id,
          notes: `Rider's Balance: ${riderDrAmount} (Dr.)`,
        });

        // Create rider cash movement for cash payments
        if (order.payment_method === "cash") {
          try {
            await ensureRiderCashMovementTypes(req.db);

            await req.db.execute(
              `INSERT INTO payments
               (order_id, user_id, amount, payment_method, gateway, status)
               SELECT ?, ?, ?, 'cash', 'local', 'success'
               WHERE NOT EXISTS (
                 SELECT 1
                 FROM payments
                 WHERE order_id = ?
                   AND payment_method = 'cash'
                   AND status = 'success'
               )`,
              [id, order.user_id, order.total_amount, id],
            );

            const now = new Date();
            const movementDate = `${now.getFullYear()}-${String(
              now.getMonth() + 1,
            ).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
            const dateStr = movementDate.replace(/-/g, "");
            const randomStr = Math.random()
              .toString(36)
              .substring(2, 8)
              .toUpperCase();
            const movementNumber = `RCM-${dateStr}-${randomStr}`;

            await req.db.execute(
              `INSERT INTO rider_cash_movements
               (movement_number, rider_id, movement_date, movement_type, amount, description, reference_type, reference_id, status, recorded_by)
               SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
               WHERE NOT EXISTS (
                 SELECT 1
                 FROM rider_cash_movements
                 WHERE reference_type = 'order'
                   AND reference_id = ?
                   AND movement_type = 'cash_collection'
               )`,
              [
                movementNumber,
                order.rider_id,
                movementDate,
                "cash_collection",
                order.total_amount,
                `Cash collection for Order #${order.order_number}`,
                "order",
                id,
                "completed",
                req.user.user_type === "admin" ? req.user.id : null,
                id,
              ],
            );
          } catch (err) {
            console.error("Error creating rider cash movement:", err);
            // Don't fail the whole request if financial recording fails, but log it
          }
        }

        if (order.payment_method === "cash") {
          await recordPickupPaidStorePaymentsForOrder(req.db, {
            orderId: id,
            riderId: order.rider_id,
            orderNumber: order.order_number,
            createdBy: req.user.id || null,
          });
        }
      }

      // Notifications - only to specific rooms to avoid duplicates
      try {
        if (req.io) {
          const paymentUpdateData = {
            id: id,
            order_number: order.order_number,
            payment_status: payment_status,
            user_id: order.user_id,
            timestamp: new Date(),
          };
          // Send to user room only (not to all)
          req.io
            .to(`user_${order.user_id}`)
            .emit("payment_status_update", paymentUpdateData);
          req.io.to("admins").emit("payment_status_update", paymentUpdateData);

          // User notification
          const userPaymentNotif = {
            type: "payment_status_update",
            order_id: id,
            order_number: order.order_number,
            payment_status: payment_status,
            message: `Payment received for order ${order.order_number}.`,
            timestamp: new Date(),
          };
          req.io
            .to(`user_${order.user_id}`)
            .emit("user_notification", userPaymentNotif);
          await sendPushToUser(req.db, {
            userId: order.user_id,
            userType: "customer",
            title: "Payment Update",
            message: `Payment received for order ${order.order_number}.`,
            data: {
              type: "payment_status_update",
              order_id: id,
              order_number: order.order_number,
              payment_status: payment_status,
            },
            collapseKey: "payment_status",
          });

          // Admin notification
          const adminPaymentNotif = {
            type: "payment_status_update",
            order_id: id,
            order_number: order.order_number,
            payment_status: payment_status,
            message: `Payment ${payment_status} for order ${order.order_number}.`,
            timestamp: new Date(),
          };
          req.io.to("admins").emit("user_notification", adminPaymentNotif);

          // Check if completed (paid + delivered)
          if (payment_status === "paid" && order.status === "delivered") {
            const completedData = {
              id: id,
              order_number: order.order_number,
              user_id: order.user_id,
              total_amount: order.total_amount,
              message: `Thank you for choosing ServeNow! Your order ${order.order_number} has been completed and delivered.`,
              timestamp: new Date(),
            };
            // Send to user room only (not to all)
            req.io
              .to(`user_${order.user_id}`)
              .emit("order_completed", completedData);
            req.io.to("admins").emit("order_completed", completedData);

            // Send Thanks Email
            if (order.user_email) {
              sendOrderThanksEmail(
                order.user_email,
                order.user_first_name || "Customer",
                order.order_number,
              );
            }
          }
        }
      } catch (e) {
        console.error("Socket emit error in payment-status:", e);
      }

      res.json({
        success: true,
        message: "Payment status updated successfully",
      });
    } catch (error) {
      console.error("Error updating payment status:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update payment status",
        error: error.message,
      });
    }
  },
);

router.put(
  "/:id(\\d+)/items",
  authenticateToken,
  requireStaffAccess,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { items, store_id } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Items array is required and cannot be empty",
        });
      }

      const [orders] = await req.db.execute(
        "SELECT * FROM orders WHERE id = ?",
        [id],
      );

      if (orders.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      const order = orders[0];

      if (order.status === "delivered" || order.status === "cancelled") {
        return res.status(400).json({
          success: false,
          message: `Cannot update items for ${order.status} orders`,
        });
      }

      let itemsSubtotal = 0;

      for (const item of items) {
        const { id: itemId, quantity } = item;

        if (!quantity || quantity < 1) {
          return res.status(400).json({
            success: false,
            message: "All items must have a quantity of at least 1",
          });
        }

        if (itemId) {
          const [existingItems] = await req.db.execute(
            "SELECT price FROM order_items WHERE id = ? AND order_id = ?",
            [itemId, id],
          );

          if (existingItems.length === 0) {
            return res.status(400).json({
              success: false,
              message: "Invalid item ID",
            });
          }

          const price = existingItems[0].price;
          const updateFields = ["quantity = ?"];
          const updateValues = [quantity];

          if (store_id && store_id !== null) {
            updateFields.push("store_id = ?");
            updateValues.push(store_id);
          }

          updateValues.push(itemId);
          updateValues.push(id);

          await req.db.execute(
            `UPDATE order_items SET ${updateFields.join(", ")} WHERE id = ? AND order_id = ?`,
            updateValues,
          );

          itemsSubtotal += price * quantity;
        }
      }

      // Recalculate totals, delivery fee and store_id from DB to ensure consistency across all items
      const synced = await syncOrderFinancialsAndDeliveryFee(req.db, id);

      res.json({
        success: true,
        message: "Order items updated successfully",
        delivery_fee: synced?.delivery_fee,
        total_amount: synced?.total_amount,
        store_count: synced?.store_count,
      });
    } catch (error) {
      console.error("Error updating order items:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update order items",
        error: error.message,
      });
    }
  },
);

router.get(
  "/:id(\\d+)/items",
  authenticateToken,
  requireStaffAccess,
  async (req, res) => {
    try {
      const { id } = req.params;
      const [ordersResult, itemsResult, storesResult] = await Promise.all([
        req.db.execute(
          `SELECT o.id, o.user_id, o.status, o.store_id, o.total_amount, o.delivery_fee,
                  o.rider_id, o.rider_location, o.rider_latitude, o.rider_longitude,
                  o.delivery_address, o.special_instructions,
                  u.first_name, u.last_name, u.email, u.phone
             FROM orders o
             JOIN users u ON o.user_id = u.id
            WHERE o.id = ?`,
          [id],
        ),
        req.db.execute(
          `
              SELECT oi.id, oi.product_id, oi.quantity, oi.price,
                     COALESCE(oi.store_id, p.store_id) AS store_id,
                     oi.variant_label,
                     p.name as product_name, p.image_url,
                     s.name as store_name
              FROM order_items oi
              JOIN products p ON oi.product_id = p.id
              LEFT JOIN stores s ON COALESCE(oi.store_id, p.store_id) = s.id
              WHERE oi.order_id = ?
              ORDER BY oi.id ASC
          `,
          [id],
        ),
        req.db.execute(`
              SELECT DISTINCT s.id, s.name
              FROM stores s
              INNER JOIN products p ON s.id = p.store_id
              WHERE s.is_active = true AND p.is_available = true
              ORDER BY s.name ASC
          `),
      ]);
      const [orders] = ordersResult;

      if (orders.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }
      const [items] = itemsResult;
      const [stores] = storesResult;

      res.json({
        success: true,
        order: orders[0],
        items: items || [],
        availableStores: stores || [],
      });
    } catch (error) {
      console.error("Error fetching order items:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch order items",
        error: error.message,
      });
    }
  },
);

router.put(
  "/:id(\\d+)/customer",
  authenticateToken,
  requireStaffAccess,
  [
    body("customer_id").isInt({ min: 1 }).withMessage("Valid customer is required"),
    body("delivery_address")
      .optional({ nullable: true })
      .isString()
      .withMessage("Delivery address must be text"),
    body("special_instructions")
      .optional({ nullable: true })
      .isString()
      .withMessage("Special instructions must be text"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { id } = req.params;
      const customerId = parseInt(String(req.body.customer_id), 10);
      const specialInstructionsRaw =
        req.body.special_instructions === undefined ||
        req.body.special_instructions === null
          ? null
          : String(req.body.special_instructions).trim();

      const [orders] = await req.db.execute(
        "SELECT id, status, delivery_address FROM orders WHERE id = ?",
        [id]
      );
      if (!orders.length) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      const order = orders[0];
      if (order.status === "delivered" || order.status === "cancelled") {
        return res.status(400).json({
          success: false,
          message: `Cannot change customer for ${order.status} orders`,
        });
      }

      const [customers] = await req.db.execute(
        `SELECT id, first_name, last_name, phone, email, address
           FROM users
          WHERE id = ? AND user_type = 'customer'
          LIMIT 1`,
        [customerId]
      );
      if (!customers.length) {
        return res.status(404).json({
          success: false,
          message: "Customer not found",
        });
      }

      const customer = customers[0];
      const deliveryAddress =
        String(req.body.delivery_address || "").trim() ||
        String(customer.address || "").trim() ||
        String(order.delivery_address || "").trim();

      if (!deliveryAddress) {
        return res.status(400).json({
          success: false,
          message: "Delivery address is required",
        });
      }

      await req.db.execute(
        `UPDATE orders
            SET user_id = ?, delivery_address = ?, special_instructions = ?
          WHERE id = ?`,
        [
          customerId,
          deliveryAddress,
          specialInstructionsRaw || null,
          id,
        ]
      );

      res.json({
        success: true,
        message: "Order customer updated successfully",
        customer: {
          id: customer.id,
          first_name: customer.first_name,
          last_name: customer.last_name,
          phone: customer.phone,
          email: customer.email,
        },
        delivery_address: deliveryAddress,
        special_instructions: specialInstructionsRaw || null,
      });
    } catch (error) {
      console.error("Error updating order customer:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update order customer",
        error: error.message,
      });
    }
  }
);

router.post(
  "/:id(\\d+)/items/add",
  authenticateToken,
  requireStaffAccess,
  async (req, res) => {
    try {
      await ensureProductsProfitSchema(req.db);
      const { id } = req.params;
      const { product_id, quantity, store_id } = req.body;
      const sizeId =
        req.body.size_id === null || req.body.size_id === undefined
          ? null
          : parseInt(String(req.body.size_id), 10);
      const unitId =
        req.body.unit_id === null || req.body.unit_id === undefined
          ? null
          : parseInt(String(req.body.unit_id), 10);
      const providedVariantLabel = req.body.variant_label
        ? String(req.body.variant_label)
        : null;

      if (!product_id || !quantity || quantity < 1) {
        return res.status(400).json({
          success: false,
          message: "Product ID and quantity (minimum 1) are required",
        });
      }

      const [orders] = await req.db.execute(
        "SELECT * FROM orders WHERE id = ?",
        [id],
      );

      if (orders.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      const order = orders[0];

      if (order.status === "delivered" || order.status === "cancelled") {
        return res.status(400).json({
          success: false,
          message: `Cannot add items to ${order.status} orders`,
        });
      }

      const [products] = await req.db.execute(
        `SELECT p.id, p.name, p.price, p.cost_price, p.store_id, p.size_id, p.unit_id,
                p.discount_type, p.discount_value, p.profit_type, p.profit_value, s.payment_term
           FROM products p
           LEFT JOIN stores s ON s.id = p.store_id
          WHERE p.id = ? AND p.is_available = true`,
        [product_id],
      );

      if (products.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Product not found or unavailable",
        });
      }

      const product = products[0];
      let price = Number(product.price);
      const parsedBaseCost = Number(product.cost_price);
      let costPrice = Number.isFinite(parsedBaseCost) ? parsedBaseCost : null;
      let variantLabel = providedVariantLabel;

      if (sizeId || unitId) {
        let query = `
          SELECT psp.price, psp.cost_price, sz.label as size_label,
                 u.name as unit_name, u.abbreviation as unit_abbreviation
          FROM product_size_prices psp
          LEFT JOIN sizes sz ON psp.size_id = sz.id
          LEFT JOIN units u ON psp.unit_id = u.id
          WHERE psp.product_id = ?
        `;
        const params = [product_id];

        if (sizeId && unitId) {
          query += " AND psp.size_id = ? AND psp.unit_id = ?";
          params.push(sizeId, unitId);
        } else if (sizeId) {
          query += " AND psp.size_id = ? AND psp.unit_id IS NULL";
          params.push(sizeId);
        } else if (unitId) {
          query += " AND psp.unit_id = ? AND psp.size_id IS NULL";
          params.push(unitId);
        }

        query += " LIMIT 1";

        const [variantRows] = await req.db.execute(query, params);
        if (variantRows && variantRows.length > 0) {
          price = Number(variantRows[0].price);
          const parsedVariantCost = Number(variantRows[0].cost_price);
          if (Number.isFinite(parsedVariantCost)) {
            costPrice = parsedVariantCost;
          }
          if (!variantLabel) {
            variantLabel = formatVariantLabel(
              variantRows[0].size_label,
              variantRows[0].unit_name,
              variantRows[0].unit_abbreviation
            );
          }
        } else {
          const productSizeId =
            product.size_id === null || product.size_id === undefined
              ? null
              : parseInt(String(product.size_id), 10);
          const productUnitId =
            product.unit_id === null || product.unit_id === undefined
              ? null
              : parseInt(String(product.unit_id), 10);

          if (sizeId === productSizeId && unitId === productUnitId) {
            price = Number(product.price);
          } else {
            return res.status(400).json({
              success: false,
              message: "Selected variant not found for this product",
            });
          }
        }
      }

      const itemStoreId =
        store_id || order.store_id || product.store_id || null;

      const financialSnapshot = deriveOrderItemAdjustmentSnapshot({
        paymentTerm: product.payment_term,
        unitPrice: price,
        productCostPrice: costPrice,
        discountType: product.discount_type,
        discountValue: product.discount_value,
        profitType: product.profit_type,
        profitValue: product.profit_value,
      });

      const [result] = await req.db.execute(
        `
            INSERT INTO order_items (order_id, product_id, quantity, price, cost_price, store_id, size_id, unit_id, variant_label, discount_type, discount_value)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          id,
          product_id,
          quantity,
          price,
          costPrice,
          itemStoreId,
          sizeId,
          unitId,
          variantLabel,
          financialSnapshot.type,
          financialSnapshot.value,
        ],
      );

      const synced = await syncOrderFinancialsAndDeliveryFee(req.db, id);

      res.json({
        success: true,
        message: "Item added successfully",
        item_id: result.insertId,
        delivery_fee: synced?.delivery_fee,
        total_amount: synced?.total_amount,
        store_count: synced?.store_count,
      });
    } catch (error) {
      console.error("Error adding item to order:", error);
      res.status(500).json({
        success: false,
        message: "Failed to add item to order",
        error: error.message,
      });
    }
  },
);

router.delete(
  "/:id(\\d+)/items/:itemId(\\d+)",
  authenticateToken,
  requireStaffAccess,
  async (req, res) => {
    try {
      const { id, itemId } = req.params;

      const [orders] = await req.db.execute(
        "SELECT * FROM orders WHERE id = ?",
        [id],
      );

      if (orders.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      const order = orders[0];

      if (order.status === "delivered" || order.status === "cancelled") {
        return res.status(400).json({
          success: false,
          message: `Cannot remove items from ${order.status} orders`,
        });
      }

      const [items] = await req.db.execute(
        "SELECT id FROM order_items WHERE id = ? AND order_id = ?",
        [itemId, id],
      );

      if (items.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Item not found in this order",
        });
      }

      await req.db.execute(
        "DELETE FROM order_items WHERE id = ? AND order_id = ?",
        [itemId, id],
      );

      const synced = await syncOrderFinancialsAndDeliveryFee(req.db, id);

      const [remainingItems] = await req.db.execute(
        "SELECT COUNT(*) as count FROM order_items WHERE order_id = ?",
        [id],
      );

      if (remainingItems[0]?.count === 0) {
        return res.json({
          success: true,
          message: "Item removed. Order has no items left.",
          empty: true,
        });
      }

      res.json({
        success: true,
        message: "Item removed successfully",
        delivery_fee: synced?.delivery_fee,
        total_amount: synced?.total_amount,
        store_count: synced?.store_count,
      });
    } catch (error) {
      console.error("Error removing item from order:", error);
      res.status(500).json({
        success: false,
        message: "Failed to remove item from order",
        error: error.message,
      });
    }
  },
);

router.get(
  "/:id(\\d+)/available-products",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { store_id } = req.query;

      const [orders] = await req.db.execute(
        "SELECT store_id FROM orders WHERE id = ?",
        [id],
      );

      if (orders.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      const orderStoreId = orders[0].store_id;
      const filterStoreId = store_id || orderStoreId;

      if (!filterStoreId) {
        return res.json({
          success: true,
          products: [],
          order_store_id: orderStoreId,
          requires_store_filter: true,
          message: "Select a store to load products for multi-store orders",
        });
      }

      let query = `
            SELECT p.id, p.name, p.price, p.store_id, s.name as store_name
            FROM products p
            INNER JOIN stores s ON p.store_id = s.id
            WHERE p.is_available = true AND s.is_active = true
        `;

      const params = [];

      if (filterStoreId) {
        query += " AND p.store_id = ?";
        params.push(filterStoreId);
      }

      query += " ORDER BY p.name ASC LIMIT 1000";

      const [products] = await req.db.execute(query, params);
      const variantsByProductId = await loadProductSizeVariants(
        req.db,
        (products || []).map((product) => product.id)
      );
      const expandedProducts = [];

      for (const product of products || []) {
        const variants = variantsByProductId[product.id] || [];
        if (variants.length) {
          for (const variant of variants) {
            const variantLabel = formatVariantLabel(
              variant.size_label,
              variant.unit_name,
              variant.unit_abbreviation
            );
            expandedProducts.push({
              id: product.id,
              name: product.name,
              price: Number(variant.price),
              store_id: product.store_id,
              store_name: product.store_name,
              size_id: variant.size_id,
              unit_id: variant.unit_id,
              variant_label: variantLabel,
            });
          }
          continue;
        }

        expandedProducts.push({
          id: product.id,
          name: product.name,
          price: Number(product.price),
          store_id: product.store_id,
          store_name: product.store_name,
          size_id: null,
          unit_id: null,
          variant_label: null,
        });
      }

      res.json({
        success: true,
        products: expandedProducts,
        order_store_id: orderStoreId,
      });
    } catch (error) {
      console.error("Error fetching available products:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch products",
        error: error.message,
      });
    }
  },
);

module.exports = router;
