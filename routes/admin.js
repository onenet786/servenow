const express = require("express");
const { authenticateToken, requireAdmin, requireStaffAccess, requirePermission } = require("../middleware/auth");
const { recordFinancialTransaction } = require("../utils/dbHelpers");
const {
  ensurePushDeviceTokensTable,
  getPushServiceStatus,
} = require("../services/pushNotifications");

const router = express.Router();
const RESTRICTED_FINANCIAL_REPORT_EMAILS = new Set(
  String(process.env.PRIVILEGED_ADMIN_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean)
);

function canViewRestrictedFinancialReports(req) {
  if (req.user && req.user.user_type === "admin") return true;
  const email = String(req.user && req.user.email ? req.user.email : "")
    .trim()
    .toLowerCase();
  if (RESTRICTED_FINANCIAL_REPORT_EMAILS.size === 0) return true;
  return RESTRICTED_FINANCIAL_REPORT_EMAILS.has(email);
}
const fs = require("fs");
const path = require("path");
const { exec, spawn } = require("child_process");
const mysqlLib = require("mysql2");

const INTERNAL_SKIP_TABLES = new Set([
  "schema_migrations",
  "migrations",
  "sqlite_sequence",
]);

const PROTECTED_EXACT_TABLES = new Set([
  "users",
  "user_permissions",
  "riders",
  "stores",
  "products",
  "categories",
  "units",
  "sizes",
  "product_size_prices",
  "wallets",
]);

const CORE_KEEP_TABLES = new Set([
  "banks",
  "categories",
  "items",
  "orders",
  "order_items",
  "products",
  "product_size_prices",
  "riders",
  "sizes",
  "stores",
  "units",
  "users",
  "user_permissions",
]);

const DEFAULT_BASE_DELIVERY_FEE = 70;
const DEFAULT_ADDITIONAL_STORE_FEE = 30;

async function ensureSystemSettingsTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS system_settings (
      setting_key VARCHAR(120) PRIMARY KEY,
      setting_value VARCHAR(255) NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

async function getDeliveryFeeSettings(db) {
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

  const base_fee =
    Number.isFinite(parsedBase) && parsedBase >= 0
      ? parsedBase
      : DEFAULT_BASE_DELIVERY_FEE;
  const additional_per_store =
    Number.isFinite(parsedAdditional) && parsedAdditional >= 0
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

function isUserStoreRelatedTable(tableName) {
  const t = String(tableName || "").toLowerCase();
  if (!t) return false;
  if (PROTECTED_EXACT_TABLES.has(t)) return true;
  if (t.includes("store")) return true;
  if (t.startsWith("user_") || t.endsWith("_user") || t.includes("user")) return true;
  return false;
}

async function getAllBaseTables(connection) {
  const [rows] = await connection.execute(
    `SELECT TABLE_NAME AS name
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME`
  );
  return rows.map((r) => r.name).filter(Boolean);
}

async function hasColumn(db, tableName, columnName) {
  const [rows] = await db.execute(
    `SELECT COUNT(*) AS cnt
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  return Number(rows?.[0]?.cnt || 0) > 0;
}

async function ensureManualOrderItemCostColumn(db) {
  try {
    const exists = await hasColumn(db, "order_items", "cost_price");
    if (!exists) {
      await db.execute(
        "ALTER TABLE order_items ADD COLUMN cost_price DECIMAL(10, 2) NULL AFTER price"
      );
    }
  } catch (err) {
    console.error("Failed to ensure order_items.cost_price column:", err);
  }
}

// Helper to check specific permissions for non-admin staff
async function hasPermission(req, permissionKey) {
    if (req.user.user_type === 'admin') return true;
    try {
        const [rows] = await req.db.execute(
            'SELECT 1 FROM user_permissions WHERE user_id = ? AND permission_key = ?',
            [req.user.id, permissionKey]
        );
        return rows.length > 0;
    } catch (e) {
        console.error('Permission check failed:', e);
        return false;
    }
}

function canViewRestrictedFinancialReports(req) {
  const email = String(req.user && req.user.email ? req.user.email : "")
    .trim()
    .toLowerCase();
  return RESTRICTED_FINANCIAL_REPORT_EMAILS.has(email);
}

const BACKUP_DIR = path.join(__dirname, "..", "database", "backups");

let createImageUpload;
try {
  ({ createImageUpload } = require("../middleware/upload"));
} catch (_) {
  const multer = require("multer");
  createImageUpload = () =>
    multer({ dest: path.join(__dirname, "..", "uploads", "tmp") });
}
const sharp = (() => {
  try {
    return require("sharp");
  } catch (e) {
    return null;
  }
})();
const upload = createImageUpload();
function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// Execute a limited ALTER TABLE statement
// Body: { sql: "ALTER TABLE ..." }
router.post(
  "/execute-sql",
  authenticateToken,
  requirePermission('menu_settings_database'),
  async (req, res) => {
    try {
      const { sql } = req.body || {};
      if (!sql || typeof sql !== "string")
        return res
          .status(400)
          .json({ success: false, message: "Missing sql statement" });

      // Only allow ALTER TABLE statements and restrict table names
      const m = sql.trim().match(/^ALTER\s+TABLE\s+`?(\w+)`?/i);
      if (!m)
        return res.status(400).json({
          success: false,
          message: "Only ALTER TABLE statements are permitted",
        });

      const table = m[1];
      const allowed = ["stores", "riders_fuel_history", "riders"];
      if (!allowed.includes(table))
        return res.status(403).json({
          success: false,
          message: `ALTER TABLE on '${table}' is not permitted`,
        });

      // Execute
      const [result] = await req.db.execute(sql);
      return res.json({ success: true, result });
    } catch (err) {
      console.error("Error executing SQL:", err && err.stack ? err.stack : err);
      const payload = { success: false, message: "SQL execution failed" };
      if (err && err.message) payload.error = err.message;
      if (err && err.sqlMessage) payload.sqlMessage = err.sqlMessage;
      return res.status(500).json(payload);
    }
  }
);

router.get(
  "/delivery-fee-settings",
  authenticateToken,
  requirePermission("menu_settings_general"),
  async (req, res) => {
    try {
      const settings = await getDeliveryFeeSettings(req.db);
      return res.json({ success: true, ...settings });
    } catch (error) {
      console.error("delivery-fee-settings get error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to load delivery fee settings",
        error: error.message,
      });
    }
  }
);

router.get(
  "/push-notification-status",
  authenticateToken,
  requireStaffAccess,
  async (req, res) => {
    try {
      await ensurePushDeviceTokensTable(req.db);

      const [rows] = await req.db.execute(
        `SELECT
           u.id,
           u.first_name,
           u.last_name,
           u.email,
           LOWER(COALESCE(u.user_type, '')) AS user_type,
           COUNT(CASE WHEN pdt.is_active = 1 THEN 1 END) AS active_tokens,
           MAX(CASE WHEN pdt.is_active = 1 THEN pdt.last_seen_at END) AS last_seen_at
         FROM users u
         LEFT JOIN push_device_tokens pdt
           ON pdt.user_id = u.id
          AND LOWER(COALESCE(pdt.user_type, '')) = LOWER(COALESCE(u.user_type, ''))
         WHERE LOWER(COALESCE(u.user_type, '')) IN ('admin', 'standard_user')
         GROUP BY u.id, u.first_name, u.last_name, u.email, u.user_type
         ORDER BY active_tokens DESC, u.id ASC`
      );

      const admins = (rows || []).map((row) => ({
        id: row.id,
        name: `${row.first_name || ""} ${row.last_name || ""}`.trim(),
        email: row.email || "",
        user_type: row.user_type || "",
        active_tokens: Number(row.active_tokens || 0),
        last_seen_at: row.last_seen_at || null,
      }));

      return res.json({
        success: true,
        push_service: getPushServiceStatus(),
        admin_devices: admins,
        active_admin_count: admins.filter((admin) => admin.active_tokens > 0).length,
      });
    } catch (error) {
      console.error("Push notification status error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to load push notification status",
        error: error.message,
      });
    }
  }
);

router.put(
  "/delivery-fee-settings",
  authenticateToken,
  requirePermission("menu_settings_general"),
  async (req, res) => {
    try {
      const baseFee = Number.parseFloat(req.body?.base_fee);
      const additionalFee = Number.parseFloat(req.body?.additional_per_store);

      if (!Number.isFinite(baseFee) || baseFee < 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid base delivery fee",
        });
      }
      if (!Number.isFinite(additionalFee) || additionalFee < 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid additional per store fee",
        });
      }

      await ensureSystemSettingsTable(req.db);
      await req.db.execute(
        `INSERT INTO system_settings (setting_key, setting_value)
         VALUES ('delivery_fee_base', ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [String(baseFee)]
      );
      await req.db.execute(
        `INSERT INTO system_settings (setting_key, setting_value)
         VALUES ('delivery_fee_additional_per_store', ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [String(additionalFee)]
      );

      return res.json({
        success: true,
        message: "Delivery fee settings updated",
        base_fee: baseFee,
        additional_per_store: additionalFee,
      });
    } catch (error) {
      console.error("delivery-fee-settings update error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update delivery fee settings",
        error: error.message,
      });
    }
  }
);

router.get(
  "/visitor-stats",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const today = new Date().toISOString().split("T")[0];
      // Count total logins today (customers only)
      const [todayLogins] = await req.db.execute(
        "SELECT COUNT(*) as count FROM login_logs WHERE DATE(login_time) = ? AND user_type = 'customer'",
        [today]
      );

      // Count distinct visitors today (customers only)
      const [todayVisitors] = await req.db.execute(
        "SELECT COUNT(DISTINCT user_id) as count FROM login_logs WHERE DATE(login_time) = ? AND user_type = 'customer'",
        [today]
      );

      // Count active users (last 30 minutes) (customers only)
      const [activeUsers] = await req.db.execute(
        "SELECT COUNT(DISTINCT user_id) as count FROM login_logs WHERE login_time >= NOW() - INTERVAL 30 MINUTE AND user_type = 'customer'"
      );

      return res.json({
        success: true,
        today_logins: Number(todayLogins[0].count),
        today_unique_visitors: Number(todayVisitors[0].count),
        active_users: Number(activeUsers[0].count),
      });
    } catch (err) {
      console.error("Visitor stats error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch visitor stats",
        error: err.message,
      });
    }
  }
);

router.get(
  "/daily-sales-summary",
  authenticateToken,
  requireStaffAccess,
  async (req, res) => {
    try {
      if (!canViewRestrictedFinancialReports(req)) {
        return res.status(403).json({
          success: false,
          message: "Permission denied: restricted financial report access required",
        });
      }
      const requestedDate = String(req.query.date || "").trim();
      const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
        ? requestedDate
        : new Date().toISOString().slice(0, 10);
      const canViewDashboard =
        req.user.user_type === "admin" ||
        (await hasPermission(req, "menu_dashboard")) ||
        (await hasPermission(req, "report_sales"));
      if (!canViewDashboard) {
        return res.status(403).json({
          success: false,
          message: "Permission denied: dashboard or sales report access required",
        });
      }

      const [summaryRows] = await req.db.execute(`
        SELECT
          COUNT(*) AS total_orders,
          SUM(CASE WHEN LOWER(TRIM(COALESCE(status, ''))) = 'delivered' THEN 1 ELSE 0 END) AS delivered_orders,
          SUM(CASE WHEN LOWER(TRIM(COALESCE(status, ''))) <> 'cancelled' THEN COALESCE(total_amount, 0) ELSE 0 END) AS gross_sales,
          SUM(CASE WHEN LOWER(TRIM(COALESCE(status, ''))) = 'delivered' THEN COALESCE(total_amount, 0) ELSE 0 END) AS delivered_sales,
          SUM(CASE WHEN LOWER(TRIM(COALESCE(status, ''))) <> 'cancelled' THEN COALESCE(delivery_fee, 0) ELSE 0 END) AS delivery_fees,
          SUM(CASE WHEN LOWER(TRIM(COALESCE(payment_method, ''))) = 'cash'
                    AND LOWER(TRIM(COALESCE(status, ''))) = 'delivered'
                   THEN COALESCE(total_amount, 0) ELSE 0 END) AS cash_sales,
          SUM(CASE WHEN LOWER(TRIM(COALESCE(payment_method, ''))) <> 'cash'
                    AND LOWER(TRIM(COALESCE(status, ''))) = 'delivered'
                   THEN COALESCE(total_amount, 0) ELSE 0 END) AS digital_sales,
          SUM(CASE WHEN LOWER(TRIM(COALESCE(payment_method, ''))) = 'cash'
                    AND LOWER(TRIM(COALESCE(status, ''))) = 'delivered'
                    AND rider_id IS NOT NULL
                   THEN GREATEST(COALESCE(total_amount, 0) - COALESCE(delivery_fee, 0), 0) ELSE 0 END) AS rider_cash
        FROM orders
        WHERE DATE(created_at) = ?
      `, [targetDate]);

      const [creditRows] = await req.db.execute(`
        SELECT
          COALESCE(SUM(
            CASE
              WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%credit%'
                   AND LOWER(TRIM(COALESCE(o.status, ''))) <> 'cancelled'
              THEN CASE
                WHEN COALESCE(totals.order_item_sales, 0) > 0
                  THEN COALESCE(o.total_amount, 0) * ((oi.quantity * oi.price) / totals.order_item_sales)
                ELSE oi.quantity * oi.price
              END
              ELSE 0
            END
          ), 0) AS total_store_credit
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        LEFT JOIN products p ON p.id = oi.product_id
        JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id, o.store_id)
        LEFT JOIN (
            SELECT oi2.order_id, SUM(oi2.quantity * oi2.price) AS order_item_sales
            FROM order_items oi2
            JOIN orders o2 ON o2.id = oi2.order_id
            WHERE o2.status != 'cancelled'
            GROUP BY oi2.order_id
        ) totals ON totals.order_id = o.id
        WHERE DATE(o.created_at) = ?
      `, [targetDate]);

      const [orderCreditRows] = await req.db.execute(`
        SELECT
          COALESCE(SUM(
            CASE
              WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%credit%'
                   AND LOWER(TRIM(COALESCE(o.status, ''))) <> 'cancelled'
              THEN COALESCE(o.total_amount, 0)
              ELSE 0
            END
          ), 0) AS store_order_credit
        FROM orders o
        JOIN stores s ON s.id = o.store_id
        WHERE DATE(o.created_at) = ?
          AND NOT EXISTS (
            SELECT 1 FROM order_items oi WHERE oi.order_id = o.id
          )
      `, [targetDate]);

      const totalStoreCredit =
        (parseFloat(creditRows[0]?.total_store_credit) || 0) +
        (parseFloat(orderCreditRows[0]?.store_order_credit) || 0);

      const [riderRows] = await req.db.execute(`
        SELECT
          o.rider_id,
          CONCAT(COALESCE(r.first_name, 'Rider'), ' ', COALESCE(r.last_name, CONCAT('#', o.rider_id))) AS rider_name,
          COUNT(*) AS orders,
          SUM(GREATEST(COALESCE(o.total_amount, 0) - COALESCE(o.delivery_fee, 0), 0)) AS rider_cash
        FROM orders o
        LEFT JOIN riders r ON r.id = o.rider_id
        WHERE DATE(o.created_at) = ?
          AND o.rider_id IS NOT NULL
          AND LOWER(TRIM(COALESCE(o.payment_method, ''))) = 'cash'
          AND LOWER(TRIM(COALESCE(o.status, ''))) = 'delivered'
        GROUP BY o.rider_id, r.first_name, r.last_name
        ORDER BY rider_cash DESC
        LIMIT 8
      `, [targetDate]);

      const summary = summaryRows[0] || {};
      const money = (value) => Number(Number(value || 0).toFixed(2));

      return res.json({
        success: true,
        summary: {
          date: targetDate,
          total_orders: Number(summary.total_orders || 0),
          delivered_orders: Number(summary.delivered_orders || 0),
          gross_sales: money(summary.gross_sales),
          delivered_sales: money(summary.delivered_sales),
          delivery_fees: money(summary.delivery_fees),
          cash_sales: money(summary.cash_sales),
          digital_sales: money(summary.digital_sales),
          total_store_credit: money(totalStoreCredit),
          store_credit: money(totalStoreCredit),
          rider_cash: money(summary.rider_cash),
        },
        rider_cash_breakdown: riderRows.map((row) => ({
          rider_id: row.rider_id,
          rider_name: String(row.rider_name || `Rider #${row.rider_id}`).trim(),
          orders: Number(row.orders || 0),
          rider_cash: money(row.rider_cash),
        })),
      });
    } catch (error) {
      console.error("Daily sales summary error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch daily sales summary",
        error: error.message,
      });
    }
  }
);

// Recent Activity Endpoint
router.get(
  "/recent-activity",
  authenticateToken,
  async (req, res) => {
    console.log('[DEBUG] GET /api/admin/recent-activity hit. User:', req.user ? `${req.user.id} (${req.user.user_type})` : 'No user');
    // Permission check
    if (req.user.user_type === 'admin') {
       // Allowed
    } else if (req.user.user_type === 'standard_user') {
        // Check permissions
        try {
            // Debug: Check which permissions the user has
            const [debugPerms] = await req.db.execute(
                'SELECT permission_key FROM user_permissions WHERE user_id = ?',
                [req.user.id]
            );
            console.log(`[DEBUG] User ${req.user.id} permissions:`, debugPerms.map(p => p.permission_key));

            // CHANGED: Allow recent-activity if user has dashboard OR orders permission
            const [perms] = await req.db.execute(
                'SELECT 1 FROM user_permissions WHERE user_id = ? AND permission_key IN (?, ?)',
                [req.user.id, 'menu_dashboard', 'menu_orders']
            );
            if (perms.length === 0) {
                 console.log(`[DEBUG] User ${req.user.id} denied access to recent-activity. Missing menu_dashboard or menu_orders.`);
                 return res.status(403).json({ success: false, message: 'Access denied' });
            }
        } catch (e) {
            console.error('[DEBUG] Permission check error:', e);
            return res.status(500).json({ success: false, message: 'Permission check failed' });
        }
    } else {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    try {
      // Fetch recent orders
      const [orders] = await req.db.execute(`
            SELECT id, total_amount, status, created_at, payment_method, delivery_address 
            FROM orders 
            ORDER BY created_at DESC 
            LIMIT 2
        `);

      // Fetch recent users
      const [users] = await req.db.execute(`
            SELECT id, first_name, last_name, email, phone, created_at 
            FROM users 
            ORDER BY created_at DESC 
            LIMIT 2
        `);

      // Fetch recent store updates/creations
      const [stores] = await req.db.execute(`
            SELECT id, name, location, phone, created_at 
            FROM stores 
            ORDER BY created_at DESC 
            LIMIT 2
        `);

      // Format data
      const recent_orders = orders.map((o) => ({
        type: "order",
        title: `New Order #${o.id}`,
        subtitle: `${o.status} - PKR ${o.total_amount}`,
        timestamp: o.created_at,
        icon: "shopping_bag",
        color: "blue",
        details: {
          "Order ID": `#${o.id}`,
          Amount: `PKR ${o.total_amount}`,
          Status: o.status,
          Payment: o.payment_method,
          Address: o.delivery_address,
          Date: o.created_at,
        },
      }));

      const recent_users = users.map((u) => ({
        type: "user",
        title: "New User Registered",
        subtitle: `${u.first_name} ${u.last_name}`,
        timestamp: u.created_at,
        icon: "person_add",
        color: "green",
        details: {
          Name: `${u.first_name} ${u.last_name}`,
          Email: u.email,
          Phone: u.phone || "N/A",
          Date: u.created_at,
        },
      }));

      const recent_stores = stores.map((s) => ({
        type: "store",
        title: `New Store "${s.name}"`,
        subtitle: "Store registered",
        timestamp: s.created_at,
        icon: "store",
        color: "orange",
        details: {
          "Store Name": s.name,
          Location: s.location || "N/A",
          Phone: s.phone || "N/A",
          Date: s.created_at,
        },
      }));

      res.json({
        success: true,
        recent_orders,
        recent_users,
        recent_stores,
      });
    } catch (err) {
      console.error("Recent activity error:", err);
      res.status(500).json({
        success: false,
        message: "Failed to fetch recent activity",
        error: err.message,
      });
    }
  }
);

router.get(
  "/inventory-report",
  authenticateToken,
  requireStaffAccess,
  async (req, res) => {
    try {
      if (!(await hasPermission(req, 'report_inventory'))) {
          return res.status(403).json({ success: false, message: 'Permission denied: report_inventory required' });
      }

      const parsedStoreId = Number.parseInt(String(req.query.store_id || ""), 10);
      const hasStoreFilter = Number.isInteger(parsedStoreId) && parsedStoreId > 0;

      const [storeLookup] = await req.db.execute(`
            SELECT id, name, is_active
            FROM stores
            ORDER BY name
        `);

      const storeInventorySql = `
            SELECT 
                s.id as store_id,
                s.name as store_name,
                s.is_active,
                COUNT(p.id) as total_products,
                SUM(p.stock_quantity) as total_stock,
                SUM(p.stock_quantity * p.price) as total_inventory_value
            FROM stores s
            LEFT JOIN products p ON s.id = p.store_id
            ${hasStoreFilter ? "WHERE s.id = ?" : ""}
            GROUP BY s.id, s.name, s.is_active
            ORDER BY s.name
        `;
      const [storeInventory] = await req.db.execute(
        storeInventorySql,
        hasStoreFilter ? [parsedStoreId] : []
      );

      const categorySql = `
            SELECT 
                c.id as category_id,
                c.name as category_name,
                COUNT(p.id) as total_products,
                SUM(p.stock_quantity) as total_stock,
                SUM(p.stock_quantity * p.price) as total_inventory_value
            FROM categories c
            LEFT JOIN products p ON c.id = p.category_id
              ${hasStoreFilter ? "AND p.store_id = ?" : ""}
            GROUP BY c.id, c.name
            ORDER BY c.name
        `;
      const [categoryInventory] = await req.db.execute(
        categorySql,
        hasStoreFilter ? [parsedStoreId] : []
      );

      const breakdownSql = `
            SELECT 
                s.id as store_id,
                s.name as store_name,
                c.id as category_id,
                c.name as category_name,
                COUNT(p.id) as product_count,
                SUM(p.stock_quantity) as stock_quantity,
                SUM(p.stock_quantity * p.price) as inventory_value
            FROM stores s
            LEFT JOIN products p ON s.id = p.store_id
            LEFT JOIN categories c ON p.category_id = c.id
            ${hasStoreFilter ? "WHERE s.id = ?" : ""}
            GROUP BY s.id, s.name, c.id, c.name
            ORDER BY s.name, c.name
        `;
      const [storeCategoryBreakdown] = await req.db.execute(
        breakdownSql,
        hasStoreFilter ? [parsedStoreId] : []
      );

      const statsSql = `
            SELECT 
                ${
                  hasStoreFilter
                    ? "(SELECT COUNT(*) FROM stores WHERE id = ?) as total_stores,"
                    : "(SELECT COUNT(*) FROM stores) as total_stores,"
                }
                ${
                  hasStoreFilter
                    ? "(SELECT COUNT(DISTINCT category_id) FROM products WHERE store_id = ?) as total_categories,"
                    : "(SELECT COUNT(*) FROM categories) as total_categories,"
                }
                COUNT(p.id) as total_products,
                SUM(p.stock_quantity) as total_stock,
                SUM(p.stock_quantity * p.price) as total_inventory_value
            FROM products p
            ${hasStoreFilter ? "WHERE p.store_id = ?" : ""}
        `;
      const [totalStats] = await req.db.execute(
        statsSql,
        hasStoreFilter ? [parsedStoreId, parsedStoreId, parsedStoreId] : []
      );

      const hasProductColumn = async (columnName) => {
        const [rows] = await req.db.execute(
          `SELECT COUNT(*) as cnt
           FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME = 'products'
             AND COLUMN_NAME = ?`,
          [columnName]
        );
        return Number(rows?.[0]?.cnt || 0) > 0;
      };
      const hasProfitTypeColumn = await hasProductColumn("profit_type");
      const hasProfitValueColumn = await hasProductColumn("profit_value");

      const productSql = `
            SELECT
                p.id as product_id,
                p.name as product_name,
                s.id as store_id,
                s.name as store_name,
                s.payment_term,
                c.name as category_name,
                p.stock_quantity,
                p.cost_price,
                p.price as sale_price,
                ${hasProfitTypeColumn ? "p.profit_type" : "NULL"} as profit_type,
                ${hasProfitValueColumn ? "p.profit_value" : "NULL"} as profit_value,
                p.discount_type,
                p.discount_value,
                p.is_available
            FROM products p
            LEFT JOIN stores s ON s.id = p.store_id
            LEFT JOIN categories c ON c.id = p.category_id
            ${hasStoreFilter ? "WHERE p.store_id = ?" : ""}
            ORDER BY s.name, c.name, p.name
        `;
      const [products] = await req.db.execute(
        productSql,
        hasStoreFilter ? [parsedStoreId] : []
      );

      let variantsByProductId = {};
      try {
        const productIds = (products || [])
          .map((p) => Number(p.product_id))
          .filter((id) => Number.isInteger(id) && id > 0);
        if (productIds.length) {
          const placeholders = productIds.map(() => "?").join(",");
          const [variantRows] = await req.db.execute(
            `
              SELECT
                psp.product_id,
                psp.price as variant_sale_price,
                psp.cost_price as variant_cost_price,
                psp.sort_order,
                sz.label as size_label,
                u.name as unit_name,
                u.abbreviation as unit_abbreviation
              FROM product_size_prices psp
              LEFT JOIN sizes sz ON sz.id = psp.size_id
              LEFT JOIN units u ON u.id = psp.unit_id
              WHERE psp.product_id IN (${placeholders})
              ORDER BY psp.product_id ASC, psp.sort_order ASC, psp.id ASC
            `,
            productIds
          );
          variantsByProductId = (variantRows || []).reduce((acc, row) => {
            const pid = Number(row.product_id);
            if (!Number.isInteger(pid) || pid <= 0) return acc;
            if (!acc[pid]) acc[pid] = [];
            acc[pid].push(row);
            return acc;
          }, {});
        }
      } catch (variantErr) {
        console.warn("Inventory variants lookup failed:", variantErr.message);
      }

      const isProfitPaymentTerm = (term) => {
        const t = String(term || "").toLowerCase().trim();
        return t === "cash only" || t === "credit";
      };
      const computeManualProfitValue = (salePrice, costPrice) => {
        const sale = Number(salePrice);
        const cost = Number(costPrice);
        if (!Number.isFinite(sale) || !Number.isFinite(cost)) return null;
        return Math.round((sale - cost) * 100) / 100;
      };

      const normalizeMonetaryType = (rawType, rawValue) => {
        const t = String(rawType || "").trim().toLowerCase();
        const parsed = Number(rawValue);
        const hasValue = Number.isFinite(parsed) && parsed > 0;
        if (t === "percent" || t === "%") return "percent";
        if (t === "amount" || t === "fixed" || t === "fixed_amount" || t === "pkr") return "amount";
        if (hasValue) return "amount";
        return null;
      };

      const buildVariantLabel = (variantRow) => {
        const sizeLabel = String(variantRow?.size_label || "").trim();
        const unitLabel = String(
          variantRow?.unit_abbreviation || variantRow?.unit_name || ""
        ).trim();
        const parts = [sizeLabel, unitLabel].filter(Boolean);
        return parts.length ? parts.join(" / ") : "-";
      };

      return res.json({
        success: true,
        selected_store_id: hasStoreFilter ? parsedStoreId : null,
        stores: storeLookup.map((r) => ({
          id: Number(r.id),
          name: r.name,
          is_active: !!r.is_active,
        })),
        store_wise: storeInventory.map((row) => ({
          store_id: row.store_id,
          store_name: row.store_name,
          is_active: row.is_active,
          total_products: Number(row.total_products) || 0,
          total_stock: Number(row.total_stock) || 0,
          total_inventory_value: parseFloat(row.total_inventory_value) || 0,
        })),
        category_wise: categoryInventory.map((row) => ({
          category_id: row.category_id,
          category_name: row.category_name,
          total_products: Number(row.total_products) || 0,
          total_stock: Number(row.total_stock) || 0,
          total_inventory_value: parseFloat(row.total_inventory_value) || 0,
        })),
        store_category_breakdown: storeCategoryBreakdown.map((row) => ({
          store_id: row.store_id,
          store_name: row.store_name,
          category_id: row.category_id,
          category_name: row.category_name,
          product_count: Number(row.product_count) || 0,
          stock_quantity: Number(row.stock_quantity) || 0,
          inventory_value: parseFloat(row.inventory_value) || 0,
        })),
        products: products.flatMap((row) => {
          const stock = Number(row.stock_quantity) || 0;
          const baseSalePrice = parseFloat(row.sale_price) || 0;
          const parsedBaseCost = parseFloat(row.cost_price);
          const baseCostPrice = Number.isFinite(parsedBaseCost) ? parsedBaseCost : null;
          const profitType = normalizeMonetaryType(row.profit_type, row.profit_value);
          const discountType = normalizeMonetaryType(row.discount_type, row.discount_value);
          const parsedProfitValue = parseFloat(row.profit_value);
          const parsedDiscountValue = parseFloat(row.discount_value);
          const profitValue = Number.isFinite(parsedProfitValue) ? parsedProfitValue : null;
          const discountValue = Number.isFinite(parsedDiscountValue) ? parsedDiscountValue : null;
          const financialMode = isProfitPaymentTerm(row.payment_term) ? "profit" : "discount";
          const baseManualProfit = computeManualProfitValue(baseSalePrice, baseCostPrice);
          const variants = variantsByProductId[Number(row.product_id)] || [];

          const baseRecord = {
            product_id: Number(row.product_id),
            product_name: row.product_name,
            store_id: Number(row.store_id),
            store_name: row.store_name,
            category_name: row.category_name || "Uncategorized",
            payment_term: row.payment_term || null,
            stock_quantity: stock,
            cost_price: baseCostPrice,
            sale_price: baseSalePrice,
            variant_label: "-",
            financial_mode: financialMode,
            financial_type: financialMode === "profit" ? "manual" : discountType,
            financial_value: financialMode === "profit" ? baseManualProfit : discountValue,
            profit_type: profitType,
            profit_value: profitValue,
            discount_type: discountType,
            discount_value: discountValue,
            inventory_sale_value: stock * baseSalePrice,
            inventory_cost_value: baseCostPrice === null ? null : stock * baseCostPrice,
            potential_profit:
              baseCostPrice === null ? null : stock * (baseSalePrice - baseCostPrice),
            is_available: !!row.is_available,
          };

          if (!variants.length) return [baseRecord];

          return variants.map((variantRow) => {
            const parsedVariantSale = parseFloat(variantRow.variant_sale_price);
            const parsedVariantCost = parseFloat(variantRow.variant_cost_price);
            const variantSalePrice = Number.isFinite(parsedVariantSale)
              ? parsedVariantSale
              : baseSalePrice;
            const variantCostPrice = Number.isFinite(parsedVariantCost)
              ? parsedVariantCost
              : baseCostPrice;
            const variantManualProfit = computeManualProfitValue(
              variantSalePrice,
              variantCostPrice
            );

            return {
              ...baseRecord,
              variant_label: buildVariantLabel(variantRow),
              cost_price: variantCostPrice,
              sale_price: variantSalePrice,
              financial_value:
                financialMode === "profit"
                  ? variantManualProfit
                  : baseRecord.financial_value,
              inventory_sale_value: stock * variantSalePrice,
              inventory_cost_value:
                variantCostPrice === null ? null : stock * variantCostPrice,
              potential_profit:
                variantCostPrice === null ? null : stock * (variantSalePrice - variantCostPrice),
            };
          });
        }),
        summary: {
          total_stores: Number(totalStats[0].total_stores) || 0,
          total_categories: Number(totalStats[0].total_categories) || 0,
          total_products: Number(totalStats[0].total_products) || 0,
          total_stock: Number(totalStats[0].total_stock) || 0,
          total_inventory_value:
            parseFloat(totalStats[0].total_inventory_value) || 0,
        },
      });
    } catch (err) {
      console.error("Inventory report error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch inventory report",
        error: err.message,
      });
    }
  }
);

router.get(
  "/store-sales-report",
  authenticateToken,
  requireStaffAccess,
  async (req, res) => {
    try {
      if (!(await hasPermission(req, 'report_sales'))) {
          return res.status(403).json({ success: false, message: 'Permission denied: report_sales required' });
      }

      const parsedStoreId = Number.parseInt(String(req.query.store_id || ""), 10);
      const hasStoreFilter = Number.isInteger(parsedStoreId) && parsedStoreId > 0;
      const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.start_date || "").trim())
        ? String(req.query.start_date).trim()
        : "";
      const endDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.end_date || "").trim())
        ? String(req.query.end_date).trim()
        : "";
      const whereClauses = [];
      const queryParams = [];

      if (hasStoreFilter) {
        whereClauses.push("s.id = ?");
        queryParams.push(parsedStoreId);
      }
      if (startDate) {
        whereClauses.push("DATE(o.created_at) >= ?");
        queryParams.push(startDate);
      }
      if (endDate) {
        whereClauses.push("DATE(o.created_at) <= ?");
        queryParams.push(endDate);
      }

      const [storeSales] = await req.db.execute(`
            SELECT
                s.id as store_id,
                s.name as store_name,
                s.payment_term as store_payment_term,
                CASE
                    WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%credit%'
                         AND LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%discount%' THEN 'credit_discount'
                    WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%credit%' THEN 'credit'
                    WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%discount%' THEN 'cash_discount'
                    ELSE 'cash'
                END as store_payment_type,
                COUNT(DISTINCT CASE WHEN o.status != 'cancelled' THEN oi.order_id END) as total_orders,
                COALESCE(SUM(
                    CASE
                        WHEN o.status != 'cancelled' THEN oi.quantity * oi.price
                        ELSE 0
                    END
                ), 0) as total_sales_gross,
                COALESCE(SUM(
                    CASE
                        WHEN o.status != 'cancelled' THEN oi.quantity * oi.price
                        ELSE 0
                    END
                ), 0) as total_sales_net,
                COUNT(DISTINCT CASE
                    WHEN o.status != 'cancelled'
                         AND LOWER(TRIM(COALESCE(s.payment_term, ''))) NOT LIKE '%credit%'
                         AND LOWER(TRIM(COALESCE(s.payment_term, ''))) NOT LIKE '%discount%'
                    THEN oi.order_id
                END) as cash_orders,
                COALESCE(SUM(
                    CASE
                        WHEN o.status != 'cancelled'
                             AND LOWER(TRIM(COALESCE(s.payment_term, ''))) NOT LIKE '%credit%'
                             AND LOWER(TRIM(COALESCE(s.payment_term, ''))) NOT LIKE '%discount%'
                        THEN oi.quantity * oi.price
                        ELSE 0
                    END
                ), 0) as cash_sales,
                COUNT(DISTINCT CASE
                    WHEN o.status != 'cancelled'
                         AND LOWER(TRIM(COALESCE(s.payment_term, ''))) NOT LIKE '%credit%'
                         AND LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%discount%'
                    THEN oi.order_id
                END) as cash_discount_orders,
                COALESCE(SUM(
                    CASE
                        WHEN o.status != 'cancelled'
                             AND LOWER(TRIM(COALESCE(s.payment_term, ''))) NOT LIKE '%credit%'
                             AND LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%discount%'
                        THEN oi.quantity * oi.price
                        ELSE 0
                    END
                ), 0) as cash_discount_sales,
                COUNT(DISTINCT CASE
                    WHEN o.status != 'cancelled'
                         AND LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%credit%'
                         AND LOWER(TRIM(COALESCE(s.payment_term, ''))) NOT LIKE '%discount%'
                    THEN oi.order_id
                END) as credit_orders,
                COALESCE(SUM(
                    CASE
                        WHEN o.status != 'cancelled'
                             AND LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%credit%'
                             AND LOWER(TRIM(COALESCE(s.payment_term, ''))) NOT LIKE '%discount%'
                        THEN oi.quantity * oi.price
                        ELSE 0
                    END
                ), 0) as credit_sales,
                COUNT(DISTINCT CASE
                    WHEN o.status != 'cancelled'
                         AND LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%credit%'
                         AND LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%discount%'
                    THEN oi.order_id
                END) as credit_discount_orders,
                COALESCE(SUM(
                    CASE
                        WHEN o.status != 'cancelled'
                             AND LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%credit%'
                             AND LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%discount%'
                        THEN oi.quantity * oi.price
                        ELSE 0
                    END
                ), 0) as credit_discount_sales,
                COALESCE(SUM(
                    CASE
                        WHEN o.status != 'cancelled' THEN
                            oi.quantity * (
                                CASE
                                    WHEN oi.discount_type = 'percent'
                                         AND COALESCE(oi.discount_value, 0) > 0
                                        THEN oi.price * (oi.discount_value / 100)
                                    WHEN oi.discount_type = 'amount'
                                         AND COALESCE(oi.discount_value, 0) > 0
                                        THEN oi.discount_value
                                    ELSE 0
                                END
                            )
                        ELSE 0
                    END
                ), 0) as total_discount,
                COALESCE(SUM(
                    CASE
                        WHEN o.status != 'cancelled' THEN
                            oi.quantity * COALESCE(oi.cost_price, psp.cost_price, p.cost_price, 0)
                        ELSE 0
                    END
                ), 0) as total_cost,
                COALESCE(SUM(
                    CASE
                        WHEN o.status != 'cancelled' THEN
                            oi.quantity * (
                                oi.price - COALESCE(oi.cost_price, psp.cost_price, p.cost_price, 0)
                            )
                        ELSE 0
                    END
                ), 0) as estimated_profit,
                COUNT(DISTINCT CASE WHEN o.status != 'cancelled' THEN o.user_id END) as unique_customers
            FROM stores s
            LEFT JOIN (
                SELECT
                    oi.order_id,
                    oi.product_id,
                    oi.quantity,
                    oi.price,
                    oi.cost_price,
                    oi.size_id,
                    oi.unit_id,
                    oi.discount_type,
                    oi.discount_value,
                    COALESCE(oi.store_id, p.store_id) as resolved_store_id
                FROM order_items oi
                LEFT JOIN products p ON p.id = oi.product_id
            ) oi ON oi.resolved_store_id = s.id
            LEFT JOIN orders o ON o.id = oi.order_id
            LEFT JOIN products p ON p.id = oi.product_id
            LEFT JOIN product_size_prices psp ON oi.product_id = psp.product_id
                AND (
                    (oi.size_id IS NOT NULL AND psp.size_id = oi.size_id)
                    OR
                    (oi.unit_id IS NOT NULL AND psp.unit_id = oi.unit_id)
                )
            ${whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : ""}
            GROUP BY s.id, s.name, s.payment_term
            ORDER BY total_sales_net DESC
        `,
        queryParams
      );

      const detailWhereClauses = ["o.status != 'cancelled'"];
      const detailParams = [];
      if (hasStoreFilter) {
        detailWhereClauses.push("s.id = ?");
        detailParams.push(parsedStoreId);
      }
      if (startDate) {
        detailWhereClauses.push("DATE(o.created_at) >= ?");
        detailParams.push(startDate);
      }
      if (endDate) {
        detailWhereClauses.push("DATE(o.created_at) <= ?");
        detailParams.push(endDate);
      }

      const [storeOrderDetails] = await req.db.execute(
        `
          SELECT
              s.id as store_id,
              s.name as store_name,
              s.payment_term as store_payment_term,
              CASE
                  WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%credit%'
                       AND LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%discount%' THEN 'credit_discount'
                  WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%credit%' THEN 'credit'
                  WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%discount%' THEN 'cash_discount'
                  ELSE 'cash'
              END as sale_type,
              o.id as order_id,
              o.order_number,
              o.status as order_status,
              o.created_at as sold_at,
              LOWER(TRIM(COALESCE(o.payment_method, ''))) as payment_method,
              o.payment_status,
              o.delivery_fee,
              o.total_amount as order_total,
              CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as customer_name,
              u.phone as customer_phone,
              SUM(oi.quantity) as total_quantity,
              SUM(oi.quantity * COALESCE(oi.cost_price, psp.cost_price, p.cost_price, 0)) as total_cost,
              SUM(oi.quantity * oi.price) as gross_sales,
              SUM(
                  oi.quantity * (
                      CASE
                          WHEN oi.discount_type = 'percent'
                               AND COALESCE(oi.discount_value, 0) > 0
                              THEN oi.price * (oi.discount_value / 100)
                          WHEN oi.discount_type = 'amount'
                               AND COALESCE(oi.discount_value, 0) > 0
                              THEN oi.discount_value
                          ELSE 0
                      END
                  )
              ) as total_discount,
              SUM(
                  oi.quantity * (
                      oi.price - COALESCE(oi.cost_price, psp.cost_price, p.cost_price, 0)
                  )
              ) as estimated_profit
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          LEFT JOIN users u ON u.id = o.user_id
          LEFT JOIN products p ON p.id = oi.product_id
          JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id)
          LEFT JOIN product_size_prices psp ON oi.product_id = psp.product_id
              AND (
                  (oi.size_id IS NOT NULL AND psp.size_id = oi.size_id)
                  OR
                  (oi.unit_id IS NOT NULL AND psp.unit_id = oi.unit_id)
              )
          WHERE ${detailWhereClauses.join(" AND ")}
          GROUP BY s.id, s.name, s.payment_term, o.id, o.order_number, o.status, o.created_at,
                   o.payment_method, o.payment_status, o.delivery_fee, o.total_amount,
                   u.first_name, u.last_name, u.phone,
                   CASE
                       WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%credit%'
                            AND LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%discount%' THEN 'credit_discount'
                       WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%credit%' THEN 'credit'
                       WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%discount%' THEN 'cash_discount'
                       ELSE 'cash'
                   END
          ORDER BY s.name ASC, o.created_at DESC, o.order_number DESC
        `,
        detailParams
      );

      const distinctOrderIds = new Set();
      const distinctCustomerKeys = new Set();
      const distinctOrderDeliveryMap = new Map();
      const ordersByStore = new Map();
      storeOrderDetails.forEach((row) => {
        const orderId = Number(row.order_id) || null;
        if (orderId) {
          distinctOrderIds.add(orderId);
          if (!distinctOrderDeliveryMap.has(orderId)) {
            distinctOrderDeliveryMap.set(orderId, parseFloat(row.delivery_fee) || 0);
          }
        }
        const custKey = (row.customer_phone || row.customer_name || "").trim();
        if (custKey) distinctCustomerKeys.add(custKey);

        const storeId = Number(row.store_id) || null;
        if (!storeId) return;
        if (!ordersByStore.has(storeId)) ordersByStore.set(storeId, []);
        const grossSales = parseFloat(row.gross_sales) || 0;
        const totalDiscount = parseFloat(row.total_discount) || 0;
        const totalCost = parseFloat(row.total_cost) || 0;
        const netSales = Math.max(0, grossSales - totalDiscount);
        ordersByStore.get(storeId).push({
          store_id: storeId,
          store_name: row.store_name,
          store_payment_term: row.store_payment_term || null,
          sale_type: String(row.sale_type || "").toLowerCase(),
          order_id: orderId,
          order_number: row.order_number,
          order_status: String(row.order_status || "").toLowerCase(),
          sold_at: row.sold_at,
          payment_method: String(row.payment_method || "").toLowerCase(),
          payment_status: String(row.payment_status || "").toLowerCase(),
          customer_name: String(row.customer_name || "").trim(),
          customer_phone: row.customer_phone || "",
          total_quantity: Number(row.total_quantity) || 0,
          total_cost: totalCost,
          gross_sales: grossSales,
          total_discount: totalDiscount,
          net_sales: netSales,
          delivery_fee: parseFloat(row.delivery_fee) || 0,
          estimated_profit: netSales - totalCost,
          order_total: parseFloat(row.order_total) || 0,
        });
      });

      let totalDeliveryCharges = 0;
      for (const fee of distinctOrderDeliveryMap.values()) {
        totalDeliveryCharges += fee;
      }

      return res.json({
        success: true,
        summary: {
          total_orders: distinctOrderIds.size,
          unique_customers: distinctCustomerKeys.size,
          total_delivery_charges: totalDeliveryCharges,
        },
        store_sales: storeSales.map((row) => {
          const storePaymentType = String(row.store_payment_type || "").toLowerCase();
          const totalOrders = Number(row.total_orders) || 0;
          const totalSalesGross = parseFloat(row.total_sales_gross) || 0;
          const totalDiscount = parseFloat(row.total_discount) || 0;
          const totalSalesNet = Math.max(0, totalSalesGross - totalDiscount);
          const totalCost = parseFloat(row.total_cost) || 0;
          const typeSales = {
            cash: parseFloat(row.cash_sales) || 0,
            cash_discount: parseFloat(row.cash_discount_sales) || 0,
            credit: parseFloat(row.credit_sales) || 0,
            credit_discount: parseFloat(row.credit_discount_sales) || 0,
          };
          if (typeSales[storePaymentType] !== undefined) {
            typeSales[storePaymentType] = Math.max(0, typeSales[storePaymentType] - totalDiscount);
          }

          const storeOrders = ordersByStore.get(Number(row.store_id)) || [];
          const storeDeliveryCharges = storeOrders.reduce(
            (sum, o) => sum + (parseFloat(o.delivery_fee) || 0),
            0
          );
          const totalWithDelivery = totalSalesNet + storeDeliveryCharges;

          return {
            store_id: row.store_id,
            store_name: row.store_name,
            store_payment_term: row.store_payment_term || null,
            store_payment_type: storePaymentType,
            total_orders: totalOrders,
            total_sales_gross: totalSalesGross,
            total_sales_net: totalSalesNet,
            delivery_fee: storeDeliveryCharges,
            delivery_charges: storeDeliveryCharges,
            total_with_delivery: totalWithDelivery,
            cash_orders: Number(row.cash_orders) || 0,
            cash_sales: typeSales.cash,
            cash_discount_orders: Number(row.cash_discount_orders) || 0,
            cash_discount_sales: typeSales.cash_discount,
            credit_orders: Number(row.credit_orders) || 0,
            credit_sales: typeSales.credit,
            credit_discount_orders: Number(row.credit_discount_orders) || 0,
            credit_discount_sales: typeSales.credit_discount,
            total_discount: totalDiscount,
            total_cost: totalCost,
            estimated_profit: totalSalesNet - totalCost,
            average_order_value: totalOrders > 0 ? totalSalesNet / totalOrders : 0,
            unique_customers: Number(row.unique_customers) || 0,
            orders: storeOrders,
          };
        }),
      });
    } catch (err) {
      console.error("Store sales report error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch store sales report",
        error: err.message,
      });
    }
  }
);

router.get(
  "/store-product-sales-report",
  authenticateToken,
  requireStaffAccess,
  async (req, res) => {
    try {
      await ensureManualOrderItemCostColumn(req.db);

      if (!(await hasPermission(req, "report_sales"))) {
        return res
          .status(403)
          .json({
            success: false,
            message: "Permission denied: report_sales required",
          });
      }

      const parsedStoreId = Number.parseInt(String(req.query.store_id || ""), 10);
      const hasStoreFilter = Number.isInteger(parsedStoreId) && parsedStoreId > 0;
      const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.start_date || "").trim())
        ? String(req.query.start_date).trim()
        : "";
      const endDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.end_date || "").trim())
        ? String(req.query.end_date).trim()
        : "";
      const manualProductDescription = "created from admin manual order";
      const queryParams = [manualProductDescription];

      if (hasStoreFilter) queryParams.push(parsedStoreId);
      if (startDate) queryParams.push(startDate);
      if (endDate) queryParams.push(endDate);

      const [rows] = await req.db.execute(
        `
          SELECT
              oi.id as order_item_id,
              o.id as order_id,
              o.order_number,
              o.status as order_status,
              o.created_at as sold_at,
              COALESCE(o.total_amount, 0) as order_total,
              COALESCE(o.delivery_fee, 0) as delivery_fee,
              s.id as store_id,
              s.name as store_name,
              c.name as category_name,
              p.id as product_id,
              p.name as product_name,
              oi.quantity as total_quantity,
              oi.price as sale_price,
              COALESCE(oi.cost_price, psp.cost_price, p.cost_price, 0) as cost_price,
              CASE
                  WHEN oi.discount_type = 'percent'
                       AND COALESCE(oi.discount_value, 0) > 0
                    THEN oi.price * (oi.discount_value / 100)
                  WHEN oi.discount_type = 'amount'
                       AND COALESCE(oi.discount_value, 0) > 0
                    THEN oi.discount_value
                  ELSE 0
              END as unit_discount,
              oi.quantity * oi.price as gross_sales,
              oi.quantity * (
                  CASE
                      WHEN oi.discount_type = 'percent'
                           AND COALESCE(oi.discount_value, 0) > 0
                        THEN oi.price * (oi.discount_value / 100)
                      WHEN oi.discount_type = 'amount'
                           AND COALESCE(oi.discount_value, 0) > 0
                        THEN oi.discount_value
                      ELSE 0
                  END
              ) as total_discount,
              oi.quantity * oi.price as net_sales,
              oi.quantity * COALESCE(oi.cost_price, psp.cost_price, p.cost_price, 0) as total_cost,
              oi.quantity * (
                  oi.price - COALESCE(oi.cost_price, psp.cost_price, p.cost_price, 0)
              ) as estimated_profit,
              1 as total_orders,
              1 as unique_customers
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          JOIN products p ON p.id = oi.product_id
          JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id)
          LEFT JOIN categories c ON c.id = p.category_id
          LEFT JOIN product_size_prices psp ON oi.product_id = psp.product_id
              AND (
                  (oi.size_id IS NOT NULL AND psp.size_id = oi.size_id)
                  OR
                  (oi.unit_id IS NOT NULL AND psp.unit_id = oi.unit_id)
              )
          WHERE LOWER(TRIM(COALESCE(p.description, ''))) != ?
          AND o.status != 'cancelled'
          ${hasStoreFilter ? "AND COALESCE(oi.store_id, p.store_id) = ?" : ""}
          ${startDate ? "AND DATE(o.created_at) >= ?" : ""}
          ${endDate ? "AND DATE(o.created_at) <= ?" : ""}
          ORDER BY o.created_at DESC, o.order_number DESC, oi.id DESC
        `,
        queryParams
      );

      return res.json({
        success: true,
        store_product_sales: rows.map((row) => {
          const totalQuantity = Number(row.total_quantity) || 0;
          const grossSales = parseFloat(row.gross_sales) || 0;
          const netSales = parseFloat(row.net_sales) || 0;
          const costPrice = parseFloat(row.cost_price) || 0;
          const salePrice = parseFloat(row.sale_price) || 0;
          return {
            order_item_id: Number(row.order_item_id) || null,
            order_id: Number(row.order_id) || null,
            order_number: row.order_number,
            order_status: String(row.order_status || "").toLowerCase(),
            store_id: Number(row.store_id) || null,
            store_name: row.store_name,
            category_name: row.category_name || "Uncategorized",
            product_id: Number(row.product_id) || null,
            product_name: row.product_name,
            total_orders: 1,
            total_quantity: totalQuantity,
            sale_price: salePrice,
            cost_price: costPrice,
            gross_sales: grossSales,
            total_discount: parseFloat(row.total_discount) || 0,
            net_sales: netSales,
            total_cost: parseFloat(row.total_cost) || 0,
            estimated_profit: parseFloat(row.estimated_profit) || 0,
            average_cost_price: costPrice,
            average_unit_price: totalQuantity > 0 ? netSales / totalQuantity : 0,
            average_sale_price: salePrice,
            unique_customers: 1,
            order_total: parseFloat(row.order_total) || 0,
            delivery_fee: parseFloat(row.delivery_fee) || 0,
            last_sold_at: row.sold_at || null,
            order_numbers: String(row.order_number || "").trim(),
          };
        }),
      });
    } catch (err) {
      console.error("Store product sales report error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch store product sales report",
        error: err.message,
      });
    }
  }
);

router.get(
  "/combined-product-sales-report",
  authenticateToken,
  requireStaffAccess,
  async (req, res) => {
    try {
      await ensureManualOrderItemCostColumn(req.db);

      if (!(await hasPermission(req, "report_sales"))) {
        return res
          .status(403)
          .json({
            success: false,
            message: "Permission denied: report_sales required",
          });
      }

      const parsedStoreId = Number.parseInt(String(req.query.store_id || ""), 10);
      const hasStoreFilter = Number.isInteger(parsedStoreId) && parsedStoreId > 0;
      const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.start_date || "").trim())
        ? String(req.query.start_date).trim()
        : "";
      const endDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.end_date || "").trim())
        ? String(req.query.end_date).trim()
        : "";
      const manualProductDescription = "created from admin manual order";
      const queryParams = [manualProductDescription];

      if (hasStoreFilter) queryParams.push(parsedStoreId);
      if (startDate) queryParams.push(startDate);
      if (endDate) queryParams.push(endDate);

      const [rows] = await req.db.execute(
        `
          SELECT
              oi.id as order_item_id,
              o.id as order_id,
              o.order_number,
              o.status as order_status,
              o.created_at as sold_at,
              COALESCE(o.total_amount, 0) as order_total,
              COALESCE(o.delivery_fee, 0) as delivery_fee,
              s.id as store_id,
              s.name as store_name,
              c.name as category_name,
              p.id as product_id,
              p.name as product_name,
              CASE
                  WHEN LOWER(TRIM(COALESCE(p.description, ''))) = ? THEN 'manual'
                  ELSE 'store'
              END as sale_type,
              oi.quantity as total_quantity,
              oi.price as sale_price,
              COALESCE(oi.cost_price, psp.cost_price, p.cost_price, 0) as cost_price,
              CASE
                  WHEN oi.discount_type = 'percent'
                       AND COALESCE(oi.discount_value, 0) > 0
                    THEN oi.price * (oi.discount_value / 100)
                  WHEN oi.discount_type = 'amount'
                       AND COALESCE(oi.discount_value, 0) > 0
                    THEN oi.discount_value
                  ELSE 0
              END as unit_discount,
              oi.quantity * oi.price as gross_sales,
              oi.quantity * (
                  CASE
                      WHEN oi.discount_type = 'percent'
                           AND COALESCE(oi.discount_value, 0) > 0
                        THEN oi.price * (oi.discount_value / 100)
                      WHEN oi.discount_type = 'amount'
                           AND COALESCE(oi.discount_value, 0) > 0
                        THEN oi.discount_value
                      ELSE 0
                  END
              ) as total_discount,
              oi.quantity * oi.price as net_sales,
              oi.quantity * COALESCE(oi.cost_price, psp.cost_price, p.cost_price, 0) as total_cost,
              oi.quantity * (
                  oi.price - COALESCE(oi.cost_price, psp.cost_price, p.cost_price, 0)
              ) as estimated_profit,
              1 as total_orders,
              1 as unique_customers
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          JOIN products p ON p.id = oi.product_id
          JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id)
          LEFT JOIN categories c ON c.id = p.category_id
          LEFT JOIN product_size_prices psp ON oi.product_id = psp.product_id
              AND (
                  (oi.size_id IS NOT NULL AND psp.size_id = oi.size_id)
                  OR
                  (oi.unit_id IS NOT NULL AND psp.unit_id = oi.unit_id)
              )
          WHERE o.status != 'cancelled'
          ${hasStoreFilter ? "AND COALESCE(oi.store_id, p.store_id) = ?" : ""}
          ${startDate ? "AND DATE(o.created_at) >= ?" : ""}
          ${endDate ? "AND DATE(o.created_at) <= ?" : ""}
          ORDER BY o.created_at DESC, o.order_number DESC, oi.id DESC
        `,
        queryParams
      );

      return res.json({
        success: true,
        combined_product_sales: rows.map((row) => {
          const totalQuantity = Number(row.total_quantity) || 0;
          const grossSales = parseFloat(row.gross_sales) || 0;
          const netSales = parseFloat(row.net_sales) || 0;
          const costPrice = parseFloat(row.cost_price) || 0;
          const salePrice = parseFloat(row.sale_price) || 0;
          return {
            order_item_id: Number(row.order_item_id) || null,
            order_id: Number(row.order_id) || null,
            order_number: row.order_number,
            order_status: String(row.order_status || "").toLowerCase(),
            sale_type: String(row.sale_type || "").toLowerCase(),
            store_id: Number(row.store_id) || null,
            store_name: row.store_name,
            category_name: row.category_name || "Uncategorized",
            product_id: Number(row.product_id) || null,
            product_name: row.product_name,
            total_orders: 1,
            total_quantity: totalQuantity,
            sale_price: salePrice,
            cost_price: costPrice,
            gross_sales: grossSales,
            total_discount: parseFloat(row.total_discount) || 0,
            net_sales: netSales,
            total_cost: parseFloat(row.total_cost) || 0,
            estimated_profit: parseFloat(row.estimated_profit) || 0,
            average_cost_price: costPrice,
            average_unit_price: totalQuantity > 0 ? netSales / totalQuantity : 0,
            average_sale_price: salePrice,
            unique_customers: 1,
            order_total: parseFloat(row.order_total) || 0,
            delivery_fee: parseFloat(row.delivery_fee) || 0,
            last_sold_at: row.sold_at || null,
            order_numbers: String(row.order_number || "").trim(),
          };
        }),
      });
    } catch (err) {
      console.error("Combined product sales report error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch combined product sales report",
        error: err.message,
      });
    }
  }
);

router.get(
  "/customer-details-sales-report/customers",
  authenticateToken,
  requireStaffAccess,
  async (req, res) => {
    try {
      if (!(await hasPermission(req, "report_sales"))) {
        return res.status(403).json({
          success: false,
          message: "Permission denied: report_sales required",
        });
      }

      const [rows] = await req.db.execute(
        `
          SELECT DISTINCT
              u.id,
              CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as customer_name,
              u.email,
              u.phone
          FROM orders o
          JOIN users u ON u.id = o.user_id
          ORDER BY customer_name ASC, u.email ASC
        `
      );

      return res.json({
        success: true,
        customers: rows.map((row) => ({
          id: Number(row.id) || null,
          name: String(row.customer_name || "").trim() || `Customer #${row.id}`,
          email: row.email || "",
          phone: row.phone || "",
        })),
      });
    } catch (err) {
      console.error("Customer details filter customers error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch report customers",
        error: err.message,
      });
    }
  }
);

router.get(
  "/customer-details-sales-report",
  authenticateToken,
  requireStaffAccess,
  async (req, res) => {
    try {
      if (!(await hasPermission(req, "report_sales"))) {
        return res.status(403).json({
          success: false,
          message: "Permission denied: report_sales required",
        });
      }

      const parsedStoreId = Number.parseInt(String(req.query.store_id || ""), 10);
      const hasStoreFilter = Number.isInteger(parsedStoreId) && parsedStoreId > 0;
      const parsedCustomerId = Number.parseInt(String(req.query.customer_id || ""), 10);
      const hasCustomerFilter = Number.isInteger(parsedCustomerId) && parsedCustomerId > 0;
      const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.start_date || "").trim())
        ? String(req.query.start_date).trim()
        : "";
      const endDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.end_date || "").trim())
        ? String(req.query.end_date).trim()
        : "";
      const requestedReportView = String(req.query.view || "detail").trim().toLowerCase();
      const reportView = requestedReportView === "summary"
        ? "order-summary"
        : (["detail", "order-summary", "customer-summary"].includes(requestedReportView)
            ? requestedReportView
            : "detail");
      const queryParams = [];

      if (hasStoreFilter) queryParams.push(parsedStoreId);
      if (hasCustomerFilter) queryParams.push(parsedCustomerId);
      if (startDate) queryParams.push(startDate);
      if (endDate) queryParams.push(endDate);

      if (reportView === "customer-summary") {
        const [rows] = await req.db.execute(
          `
            SELECT
                scoped.customer_id,
                scoped.customer_name,
                scoped.customer_email,
                scoped.contact_no,
                MAX(scoped.customer_address) as customer_address,
                COUNT(*) as total_orders,
                SUM(CASE WHEN scoped.order_status = 'delivered' THEN 1 ELSE 0 END) as delivered_orders,
                SUM(CASE WHEN scoped.order_status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_orders,
                SUM(CASE WHEN scoped.order_status NOT IN ('delivered', 'cancelled') THEN 1 ELSE 0 END) as active_orders,
                SUM(scoped.total_quantity) as total_quantity,
                SUM(scoped.items_subtotal) as items_subtotal,
                SUM(scoped.delivery_fee) as delivery_fee,
                SUM(scoped.order_total) as total_order_amount,
                SUM(CASE WHEN scoped.order_status = 'delivered' THEN scoped.order_total ELSE 0 END) as delivered_amount,
                SUM(CASE WHEN scoped.order_status = 'cancelled' THEN scoped.order_total ELSE 0 END) as cancelled_amount,
                SUM(CASE WHEN scoped.order_status NOT IN ('delivered', 'cancelled') THEN scoped.order_total ELSE 0 END) as active_amount,
                MAX(scoped.order_date) as last_order_date,
                GROUP_CONCAT(DISTINCT scoped.store_names ORDER BY scoped.store_names SEPARATOR ', ') as store_names
            FROM (
                SELECT
                    o.id as order_id,
                    LOWER(TRIM(COALESCE(o.status, ''))) as order_status,
                    o.created_at as order_date,
                    u.id as customer_id,
                    CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as customer_name,
                    u.email as customer_email,
                    COALESCE(NULLIF(u.phone, ''), '-') as contact_no,
                    COALESCE(NULLIF(o.delivery_address, ''), NULLIF(u.address, ''), '-') as customer_address,
                    GROUP_CONCAT(DISTINCT s.name ORDER BY s.name SEPARATOR ', ') as store_names,
                    SUM(oi.quantity) as total_quantity,
                    SUM(oi.quantity * oi.price) as items_subtotal,
                    COALESCE(o.delivery_fee, 0) as delivery_fee,
                    COALESCE(o.total_amount, 0) as order_total
                FROM order_items oi
                JOIN orders o ON o.id = oi.order_id
                JOIN users u ON u.id = o.user_id
                JOIN products p ON p.id = oi.product_id
                JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id, o.store_id)
                WHERE 1 = 1
                ${hasStoreFilter ? "AND COALESCE(oi.store_id, p.store_id, o.store_id) = ?" : ""}
                ${hasCustomerFilter ? "AND o.user_id = ?" : ""}
                ${startDate ? "AND DATE(o.created_at) >= ?" : ""}
                ${endDate ? "AND DATE(o.created_at) <= ?" : ""}
                GROUP BY
                    o.id, o.status, o.created_at, o.delivery_fee, o.total_amount,
                    u.id, u.first_name, u.last_name, u.email, u.phone, u.address, o.delivery_address
            ) scoped
            GROUP BY scoped.customer_id, scoped.customer_name, scoped.customer_email, scoped.contact_no
            ORDER BY total_order_amount DESC, total_orders DESC, scoped.customer_name ASC
          `,
          queryParams
        );

        const customerSummaryRows = rows.map((row) => {
          const customerName = String(row.customer_name || "").trim() || `Customer #${row.customer_id}`;
          return {
            customer_id: Number(row.customer_id) || null,
            customer_name: customerName,
            customer_email: row.customer_email || "",
            contact_no: row.contact_no || "-",
            customer_address: row.customer_address || "-",
            store_names: row.store_names || "",
            total_orders: Number(row.total_orders) || 0,
            delivered_orders: Number(row.delivered_orders) || 0,
            cancelled_orders: Number(row.cancelled_orders) || 0,
            active_orders: Number(row.active_orders) || 0,
            total_quantity: Number(row.total_quantity) || 0,
            items_subtotal: parseFloat(row.items_subtotal) || 0,
            delivery_fee: parseFloat(row.delivery_fee) || 0,
            total_order_amount: parseFloat(row.total_order_amount) || 0,
            delivered_amount: parseFloat(row.delivered_amount) || 0,
            cancelled_amount: parseFloat(row.cancelled_amount) || 0,
            active_amount: parseFloat(row.active_amount) || 0,
            last_order_date: row.last_order_date || null,
          };
        });

        const summary = customerSummaryRows.reduce(
          (acc, row) => {
            acc.customers += 1;
            acc.total_orders += Number(row.total_orders || 0) || 0;
            acc.delivered_orders += Number(row.delivered_orders || 0) || 0;
            acc.cancelled_orders += Number(row.cancelled_orders || 0) || 0;
            acc.active_orders += Number(row.active_orders || 0) || 0;
            acc.total_quantity += Number(row.total_quantity || 0) || 0;
            acc.items_subtotal += Number(row.items_subtotal || 0) || 0;
            acc.delivery_fee += Number(row.delivery_fee || 0) || 0;
            acc.total_order_amount += Number(row.total_order_amount || 0) || 0;
            acc.delivered_amount += Number(row.delivered_amount || 0) || 0;
            acc.cancelled_amount += Number(row.cancelled_amount || 0) || 0;
            acc.active_amount += Number(row.active_amount || 0) || 0;
            return acc;
          },
          {
            customers: 0,
            total_orders: 0,
            delivered_orders: 0,
            cancelled_orders: 0,
            active_orders: 0,
            total_quantity: 0,
            items_subtotal: 0,
            delivery_fee: 0,
            total_order_amount: 0,
            delivered_amount: 0,
            cancelled_amount: 0,
            active_amount: 0,
          }
        );

        return res.json({
          success: true,
          report_view: "customer-summary",
          customer_summary: customerSummaryRows,
          summary: {
            customers: summary.customers,
            total_orders: summary.total_orders,
            delivered_orders: summary.delivered_orders,
            cancelled_orders: summary.cancelled_orders,
            active_orders: summary.active_orders,
            total_quantity: summary.total_quantity,
            items_subtotal: Number(summary.items_subtotal.toFixed(2)),
            delivery_fee: Number(summary.delivery_fee.toFixed(2)),
            total_order_amount: Number(summary.total_order_amount.toFixed(2)),
            delivered_amount: Number(summary.delivered_amount.toFixed(2)),
            cancelled_amount: Number(summary.cancelled_amount.toFixed(2)),
            active_amount: Number(summary.active_amount.toFixed(2)),
          },
        });
      }

      if (reportView === "order-summary") {
        const [rows] = await req.db.execute(
          `
            SELECT
                o.id as order_id,
                o.order_number,
                o.status as order_status,
                o.created_at as order_date,
                u.id as customer_id,
                CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as customer_name,
                u.email as customer_email,
                COALESCE(NULLIF(u.phone, ''), '-') as contact_no,
                COALESCE(NULLIF(o.delivery_address, ''), NULLIF(u.address, ''), '-') as customer_address,
                GROUP_CONCAT(DISTINCT s.name ORDER BY s.name SEPARATOR ', ') as store_names,
                COUNT(DISTINCT p.id) as product_count,
                SUM(oi.quantity) as total_quantity,
                GROUP_CONCAT(CONCAT(p.name, ' x ', oi.quantity) ORDER BY p.name SEPARATOR ', ') as products_summary,
                SUM(oi.quantity * oi.price) as items_subtotal,
                COALESCE(o.delivery_fee, 0) as delivery_fee,
                COALESCE(o.total_amount, 0) as order_total
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            JOIN users u ON u.id = o.user_id
            JOIN products p ON p.id = oi.product_id
            JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id, o.store_id)
            WHERE o.status != 'cancelled'
            ${hasStoreFilter ? "AND COALESCE(oi.store_id, p.store_id, o.store_id) = ?" : ""}
            ${hasCustomerFilter ? "AND o.user_id = ?" : ""}
            ${startDate ? "AND DATE(o.created_at) >= ?" : ""}
            ${endDate ? "AND DATE(o.created_at) <= ?" : ""}
            GROUP BY
                o.id, o.order_number, o.status, o.created_at, o.delivery_fee, o.total_amount,
                u.id, u.first_name, u.last_name, u.email, u.phone, u.address, o.delivery_address
            ORDER BY o.created_at DESC, o.order_number DESC
          `,
          queryParams
        );

        const summaryRows = rows.map((row) => {
          const customerName = String(row.customer_name || "").trim() || `Customer #${row.customer_id}`;
          return {
            order_id: Number(row.order_id) || null,
            order_number: row.order_number || "",
            order_status: String(row.order_status || "").toLowerCase(),
            order_date: row.order_date || null,
            customer_id: Number(row.customer_id) || null,
            customer_name: customerName,
            customer_email: row.customer_email || "",
            contact_no: row.contact_no || "-",
            customer_address: row.customer_address || "-",
            store_names: row.store_names || "",
            product_count: Number(row.product_count) || 0,
            total_quantity: Number(row.total_quantity) || 0,
            products_summary: row.products_summary || "",
            items_subtotal: parseFloat(row.items_subtotal) || 0,
            delivery_fee: parseFloat(row.delivery_fee) || 0,
            order_total: parseFloat(row.order_total) || 0,
          };
        });

        const summary = summaryRows.reduce(
          (acc, row) => {
            acc.total_orders += 1;
            acc.total_quantity += Number(row.total_quantity || 0) || 0;
            acc.items_subtotal += Number(row.items_subtotal || 0) || 0;
            acc.delivery_fee += Number(row.delivery_fee || 0) || 0;
            acc.order_total += Number(row.order_total || 0) || 0;
            if (row.customer_id) acc.customer_ids.add(String(row.customer_id));
            return acc;
          },
          {
            total_orders: 0,
            total_quantity: 0,
            items_subtotal: 0,
            delivery_fee: 0,
            order_total: 0,
            customer_ids: new Set(),
          }
        );

        return res.json({
          success: true,
          report_view: "order-summary",
          customer_order_summary: summaryRows,
          summary: {
            total_orders: summary.total_orders,
            total_quantity: summary.total_quantity,
            items_subtotal: Number(summary.items_subtotal.toFixed(2)),
            delivery_fee: Number(summary.delivery_fee.toFixed(2)),
            order_total: Number(summary.order_total.toFixed(2)),
            unique_customers: summary.customer_ids.size,
          },
        });
      }

      const [rows] = await req.db.execute(
        `
          SELECT
              oi.id as order_item_id,
              o.id as order_id,
              o.order_number,
              o.status as order_status,
              o.created_at as order_date,
              s.id as store_id,
              s.name as store_name,
              p.id as product_id,
              p.name as product_name,
              u.id as customer_id,
              CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')) as customer_name,
              u.email as customer_email,
              COALESCE(NULLIF(u.phone, ''), '-') as contact_no,
              COALESCE(NULLIF(o.delivery_address, ''), NULLIF(u.address, ''), '-') as customer_address,
              oi.quantity,
              oi.price as sale_price,
              oi.quantity * oi.price as line_total
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          JOIN users u ON u.id = o.user_id
          JOIN products p ON p.id = oi.product_id
          JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id, o.store_id)
          WHERE o.status != 'cancelled'
          ${hasStoreFilter ? "AND COALESCE(oi.store_id, p.store_id, o.store_id) = ?" : ""}
          ${hasCustomerFilter ? "AND o.user_id = ?" : ""}
          ${startDate ? "AND DATE(o.created_at) >= ?" : ""}
          ${endDate ? "AND DATE(o.created_at) <= ?" : ""}
          ORDER BY s.name ASC, o.created_at DESC, o.order_number DESC, oi.id DESC
        `,
        queryParams
      );

      const reportRows = rows.map((row) => {
        const quantity = Number(row.quantity) || 0;
        const salePrice = parseFloat(row.sale_price) || 0;
        const lineTotal = parseFloat(row.line_total) || quantity * salePrice;
        const customerName = String(row.customer_name || "").trim() || `Customer #${row.customer_id}`;
        return {
          order_item_id: Number(row.order_item_id) || null,
          order_id: Number(row.order_id) || null,
          order_number: row.order_number || "",
          order_status: String(row.order_status || "").toLowerCase(),
          order_date: row.order_date || null,
          store_id: Number(row.store_id) || null,
          store_name: row.store_name || "",
          product_id: Number(row.product_id) || null,
          product_name: row.product_name || "",
          customer_id: Number(row.customer_id) || null,
          customer_name: customerName,
          customer_email: row.customer_email || "",
          contact_no: row.contact_no || "-",
          customer_address: row.customer_address || "-",
          quantity,
          sale_price: salePrice,
          line_total: lineTotal,
        };
      });

      const summary = reportRows.reduce(
        (acc, row) => {
          acc.total_rows += 1;
          acc.total_quantity += Number(row.quantity || 0) || 0;
          acc.total_sales += Number(row.line_total || 0) || 0;
          if (row.customer_id) acc.customer_ids.add(String(row.customer_id));
          if (row.store_id) acc.store_ids.add(String(row.store_id));
          return acc;
        },
        {
          total_rows: 0,
          total_quantity: 0,
          total_sales: 0,
          customer_ids: new Set(),
          store_ids: new Set(),
        }
      );

      return res.json({
        success: true,
        customer_details: reportRows,
        summary: {
          total_rows: summary.total_rows,
          total_quantity: summary.total_quantity,
          total_sales: Number(summary.total_sales.toFixed(2)),
          unique_customers: summary.customer_ids.size,
          total_stores: summary.store_ids.size,
        },
      });
    } catch (err) {
      console.error("Customer details sales report error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch customer details report",
        error: err.message,
      });
    }
  }
);

router.get(
  "/sales-with-delivery-report",
  authenticateToken,
  requireStaffAccess,
  async (req, res) => {
    try {
      await ensureManualOrderItemCostColumn(req.db);

      if (!(await hasPermission(req, "report_sales"))) {
        return res
          .status(403)
          .json({
            success: false,
            message: "Permission denied: report_sales required",
          });
      }

      const parsedStoreId = Number.parseInt(String(req.query.store_id || ""), 10);
      const hasStoreFilter = Number.isInteger(parsedStoreId) && parsedStoreId > 0;
      const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.start_date || "").trim())
        ? String(req.query.start_date).trim()
        : "";
      const endDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.end_date || "").trim())
        ? String(req.query.end_date).trim()
        : "";
      const manualProductDescription = "created from admin manual order";
      const queryParams = [
        manualProductDescription,
        manualProductDescription,
        manualProductDescription,
      ];

      if (hasStoreFilter) queryParams.push(parsedStoreId);
      if (startDate) queryParams.push(startDate);
      if (endDate) queryParams.push(endDate);

      const [rows] = await req.db.execute(
        `
          SELECT
              o.id as order_id,
              o.order_number,
              o.status as order_status,
              o.created_at as sold_at,
              COALESCE(o.total_amount, 0) as order_total,
              GROUP_CONCAT(DISTINCT s.name ORDER BY s.name SEPARATOR ', ') as store_names,
              CASE
                  WHEN SUM(CASE WHEN LOWER(TRIM(COALESCE(p.description, ''))) = ? THEN 1 ELSE 0 END) > 0
                       AND SUM(CASE WHEN LOWER(TRIM(COALESCE(p.description, ''))) != ? THEN 1 ELSE 0 END) > 0
                    THEN 'mixed'
                  WHEN SUM(CASE WHEN LOWER(TRIM(COALESCE(p.description, ''))) = ? THEN 1 ELSE 0 END) > 0
                    THEN 'manual'
                  ELSE 'store'
              END as sale_type,
              SUM(oi.quantity) as total_quantity,
              SUM(oi.quantity * COALESCE(oi.cost_price, psp.cost_price, p.cost_price, 0)) as total_cost,
              SUM(oi.quantity * oi.price) as gross_sales,
              SUM(oi.quantity * oi.price) as net_sales,
              COALESCE(o.delivery_fee, 0) as delivery_fee,
              SUM(
                  oi.quantity * (
                      oi.price - COALESCE(oi.cost_price, psp.cost_price, p.cost_price, 0)
                  )
              ) as estimated_profit
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          JOIN products p ON p.id = oi.product_id
          JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id)
          LEFT JOIN product_size_prices psp ON oi.product_id = psp.product_id
              AND (
                  (oi.size_id IS NOT NULL AND psp.size_id = oi.size_id)
                  OR
                  (oi.unit_id IS NOT NULL AND psp.unit_id = oi.unit_id)
              )
          WHERE o.status != 'cancelled'
          ${hasStoreFilter ? "AND COALESCE(oi.store_id, p.store_id) = ?" : ""}
          ${startDate ? "AND DATE(o.created_at) >= ?" : ""}
          ${endDate ? "AND DATE(o.created_at) <= ?" : ""}
          GROUP BY o.id, o.order_number, o.status, o.created_at, o.delivery_fee
          ORDER BY o.created_at DESC, o.order_number DESC
        `,
        queryParams
      );

      return res.json({
        success: true,
        sales_with_delivery: rows.map((row) => {
          const grossSales = parseFloat(row.gross_sales) || 0;
          const netSales = parseFloat(row.net_sales) || 0;
          const deliveryFee = parseFloat(row.delivery_fee) || 0;
          return {
            order_id: Number(row.order_id) || null,
            order_number: row.order_number,
            order_status: String(row.order_status || "").toLowerCase(),
            sale_type: String(row.sale_type || "").toLowerCase(),
            store_names: row.store_names || "",
            total_quantity: Number(row.total_quantity) || 0,
            total_cost: parseFloat(row.total_cost) || 0,
            gross_sales: grossSales,
            net_sales: netSales,
            delivery_fee: deliveryFee,
            total_with_delivery: netSales + deliveryFee,
            order_total: parseFloat(row.order_total) || 0,
            estimated_profit: parseFloat(row.estimated_profit) || 0,
            last_sold_at: row.sold_at || null,
          };
        }),
      });
    } catch (err) {
      console.error("Sales with delivery report error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch sales with delivery report",
        error: err.message,
      });
    }
  }
);

router.get(
  "/sales-by-payment-report",
  authenticateToken,
  requireStaffAccess,
  async (req, res) => {
    try {
      await ensureManualOrderItemCostColumn(req.db);

      if (!(await hasPermission(req, "report_sales"))) {
        return res.status(403).json({
          success: false,
          message: "Permission denied: report_sales required",
        });
      }

      const parsedStoreId = Number.parseInt(String(req.query.store_id || ""), 10);
      const hasStoreFilter = Number.isInteger(parsedStoreId) && parsedStoreId > 0;
      const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.start_date || "").trim())
        ? String(req.query.start_date).trim()
        : "";
      const endDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.end_date || "").trim())
        ? String(req.query.end_date).trim()
        : "";
      const manualProductDescription = "created from admin manual order";
      const queryParams = [
        manualProductDescription,
        manualProductDescription,
        manualProductDescription,
      ];

      if (hasStoreFilter) queryParams.push(parsedStoreId);
      if (startDate) queryParams.push(startDate);
      if (endDate) queryParams.push(endDate);

      const [rows] = await req.db.execute(
        `
          SELECT
              o.id as order_id,
              o.order_number,
              o.status as order_status,
              o.created_at as sold_at,
              LOWER(TRIM(COALESCE(o.payment_method, ''))) as payment_method,
              GROUP_CONCAT(DISTINCT s.name ORDER BY s.name SEPARATOR ', ') as store_names,
              CASE
                  WHEN SUM(CASE WHEN LOWER(TRIM(COALESCE(p.description, ''))) = ? THEN 1 ELSE 0 END) > 0
                       AND SUM(CASE WHEN LOWER(TRIM(COALESCE(p.description, ''))) != ? THEN 1 ELSE 0 END) > 0
                    THEN 'mixed'
                  WHEN SUM(CASE WHEN LOWER(TRIM(COALESCE(p.description, ''))) = ? THEN 1 ELSE 0 END) > 0
                    THEN 'manual'
                  ELSE 'store'
              END as order_type,
              CASE
                  WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%credit%' THEN 'credit'
                  ELSE 'cash'
              END as store_payment_term,
              CASE
                  WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%credit%' THEN 'credit'
                  ELSE 'cash'
              END as sale_type,
              SUM(oi.quantity) as total_quantity,
              SUM(oi.quantity * COALESCE(oi.cost_price, psp.cost_price, p.cost_price, 0)) as total_cost,
              SUM(oi.quantity * oi.price) as gross_sales,
              SUM(oi.quantity * oi.price) as net_sales,
              CASE
                  WHEN COALESCE(totals.order_item_sales, 0) > 0
                    THEN COALESCE(o.delivery_fee, 0) * (SUM(oi.quantity * oi.price) / totals.order_item_sales)
                  ELSE 0
              END as delivery_fee,
              SUM(
                  oi.quantity * (
                      oi.price - COALESCE(oi.cost_price, psp.cost_price, p.cost_price, 0)
                  )
              ) as estimated_profit,
              CASE
                  WHEN COALESCE(totals.order_item_sales, 0) > 0
                    THEN COALESCE(o.total_amount, 0) * (SUM(oi.quantity * oi.price) / totals.order_item_sales)
                  ELSE 0
              END as order_total
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          JOIN products p ON p.id = oi.product_id
          JOIN stores s ON s.id = COALESCE(oi.store_id, p.store_id)
          LEFT JOIN (
              SELECT oi2.order_id, SUM(oi2.quantity * oi2.price) AS order_item_sales
              FROM order_items oi2
              JOIN orders o2 ON o2.id = oi2.order_id
              WHERE o2.status != 'cancelled'
              GROUP BY oi2.order_id
          ) totals ON totals.order_id = o.id
          LEFT JOIN product_size_prices psp ON oi.product_id = psp.product_id
              AND (
                  (oi.size_id IS NOT NULL AND psp.size_id = oi.size_id)
                  OR
                  (oi.unit_id IS NOT NULL AND psp.unit_id = oi.unit_id)
              )
          WHERE o.status != 'cancelled'
          ${hasStoreFilter ? "AND COALESCE(oi.store_id, p.store_id) = ?" : ""}
          ${startDate ? "AND DATE(o.created_at) >= ?" : ""}
          ${endDate ? "AND DATE(o.created_at) <= ?" : ""}
          GROUP BY o.id, o.order_number, o.status, o.created_at, o.delivery_fee, o.payment_method,
                   CASE
                       WHEN LOWER(TRIM(COALESCE(s.payment_term, ''))) LIKE '%credit%' THEN 'credit'
                       ELSE 'cash'
                   END
          ORDER BY sale_type ASC, o.created_at DESC, o.order_number DESC
        `,
        queryParams
      );

      return res.json({
        success: true,
        sales_by_payment: rows.map((row) => {
          const grossSales = parseFloat(row.gross_sales) || 0;
          const netSales = parseFloat(row.net_sales) || 0;
          const deliveryFee = parseFloat(row.delivery_fee) || 0;
          return {
            order_id: Number(row.order_id) || null,
            order_number: row.order_number,
            order_status: String(row.order_status || "").toLowerCase(),
            payment_method: String(row.payment_method || "").toLowerCase(),
            order_type: String(row.order_type || "").toLowerCase(),
            store_payment_term: String(row.store_payment_term || "").toLowerCase(),
            sale_type: String(row.sale_type || "").toLowerCase(),
            store_names: row.store_names || "",
            total_quantity: Number(row.total_quantity) || 0,
            total_cost: parseFloat(row.total_cost) || 0,
            gross_sales: grossSales,
            net_sales: netSales,
            delivery_fee: deliveryFee,
            total_with_delivery: netSales + deliveryFee,
            order_total: parseFloat(row.order_total) || 0,
            estimated_profit: parseFloat(row.estimated_profit) || 0,
            last_sold_at: row.sold_at || null,
          };
        }),
      });
    } catch (err) {
      console.error("Sales by payment report error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch sales by payment report",
        error: err.message,
      });
    }
  }
);

router.get(
  "/manual-order-sales-report",
  authenticateToken,
  requireStaffAccess,
  async (req, res) => {
    try {
      await ensureManualOrderItemCostColumn(req.db);

      if (!(await hasPermission(req, "report_sales"))) {
        return res
          .status(403)
          .json({
            success: false,
            message: "Permission denied: report_sales required",
          });
      }

      const parsedStoreId = Number.parseInt(String(req.query.store_id || ""), 10);
      const hasStoreFilter = Number.isInteger(parsedStoreId) && parsedStoreId > 0;
      const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.start_date || "").trim())
        ? String(req.query.start_date).trim()
        : "";
      const endDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.end_date || "").trim())
        ? String(req.query.end_date).trim()
        : "";
      const manualProductDescription = "created from admin manual order";
      const queryParams = [manualProductDescription];

      if (hasStoreFilter) queryParams.push(parsedStoreId);
      if (startDate) queryParams.push(startDate);
      if (endDate) queryParams.push(endDate);

      const [rows] = await req.db.execute(
        `
          SELECT
              oi.id as order_item_id,
              o.id as order_id,
              o.order_number,
              o.status as order_status,
              o.created_at as sold_at,
              COALESCE(o.total_amount, 0) as order_total,
              s.id as store_id,
              s.name as store_name,
              c.name as category_name,
              p.id as product_id,
              p.name as product_name,
              oi.quantity as total_quantity,
              oi.price as sale_price,
              COALESCE(oi.cost_price, psp.cost_price, p.cost_price, 0) as cost_price,
              CASE
                  WHEN oi.discount_type = 'percent'
                       AND COALESCE(oi.discount_value, 0) > 0
                    THEN oi.price * (oi.discount_value / 100)
                  WHEN oi.discount_type = 'amount'
                       AND COALESCE(oi.discount_value, 0) > 0
                    THEN oi.discount_value
                  ELSE 0
              END as unit_discount,
              oi.quantity * oi.price as gross_sales,
              oi.quantity * (
                  CASE
                      WHEN oi.discount_type = 'percent'
                           AND COALESCE(oi.discount_value, 0) > 0
                        THEN oi.price * (oi.discount_value / 100)
                      WHEN oi.discount_type = 'amount'
                           AND COALESCE(oi.discount_value, 0) > 0
                        THEN oi.discount_value
                      ELSE 0
                  END
              ) as total_discount,
              oi.quantity * oi.price as net_sales,
              oi.quantity * COALESCE(oi.cost_price, psp.cost_price, p.cost_price, 0) as total_cost,
              oi.quantity * (
                  oi.price - COALESCE(oi.cost_price, psp.cost_price, p.cost_price, 0)
              ) as estimated_profit,
              1 as total_orders,
              1 as unique_customers
          FROM products p
          JOIN stores s ON s.id = p.store_id
          LEFT JOIN categories c ON c.id = p.category_id
          JOIN order_items oi ON oi.product_id = p.id
          JOIN orders o ON o.id = oi.order_id
          LEFT JOIN product_size_prices psp ON oi.product_id = psp.product_id
              AND (
                  (oi.size_id IS NOT NULL AND psp.size_id = oi.size_id)
                  OR
                  (oi.unit_id IS NOT NULL AND psp.unit_id = oi.unit_id)
              )
          WHERE LOWER(TRIM(COALESCE(p.description, ''))) = ?
          AND o.status != 'cancelled'
          ${hasStoreFilter ? "AND p.store_id = ?" : ""}
          ${startDate ? "AND DATE(o.created_at) >= ?" : ""}
          ${endDate ? "AND DATE(o.created_at) <= ?" : ""}
          ORDER BY o.created_at DESC, o.order_number DESC, oi.id DESC
        `,
        queryParams
      );

      return res.json({
        success: true,
        manual_product_sales: rows.map((row) => {
          const totalQuantity = Number(row.total_quantity) || 0;
          const grossSales = parseFloat(row.gross_sales) || 0;
          const netSales = parseFloat(row.net_sales) || 0;
          const costPrice = parseFloat(row.cost_price) || 0;
          const salePrice = parseFloat(row.sale_price) || 0;
          return {
            order_item_id: Number(row.order_item_id) || null,
            order_id: Number(row.order_id) || null,
            order_number: row.order_number,
            order_status: String(row.order_status || "").toLowerCase(),
            store_id: Number(row.store_id) || null,
            store_name: row.store_name,
            category_name: row.category_name || "Uncategorized",
            product_id: Number(row.product_id) || null,
            product_name: row.product_name,
            total_orders: 1,
            total_quantity: totalQuantity,
            sale_price: salePrice,
            cost_price: costPrice,
            gross_sales: grossSales,
            total_discount: parseFloat(row.total_discount) || 0,
            net_sales: netSales,
            total_cost: parseFloat(row.total_cost) || 0,
            estimated_profit: parseFloat(row.estimated_profit) || 0,
            average_cost_price: costPrice,
            average_unit_price: totalQuantity > 0 ? netSales / totalQuantity : 0,
            average_sale_price: salePrice,
            unique_customers: 1,
            order_total: parseFloat(row.order_total) || 0,
            last_sold_at: row.sold_at || null,
            order_numbers: String(row.order_number || "").trim(),
          };
        }),
      });
    } catch (err) {
      console.error("Manual order sales report error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch manual order sales report",
        error: err.message,
      });
    }
  }
);

router.put(
  "/store-product-sales-report/:orderItemId",
  authenticateToken,
  requireStaffAccess,
  async (req, res) => {
    try {
      await ensureManualOrderItemCostColumn(req.db);

      if (!(await hasPermission(req, "action_edit_order"))) {
        return res.status(403).json({
          success: false,
          message: "Permission denied: action_edit_order required",
        });
      }

      const orderItemId = Number.parseInt(String(req.params.orderItemId || ""), 10);
      const salePrice = Number(req.body?.sale_price);
      const costPrice = Number(req.body?.cost_price);
      const manualProductDescription = "created from admin manual order";

      if (!Number.isInteger(orderItemId) || orderItemId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Valid order item is required",
        });
      }
      if (!Number.isFinite(salePrice) || salePrice <= 0) {
        return res.status(400).json({
          success: false,
          message: "Sale price must be greater than zero",
        });
      }
      if (!Number.isFinite(costPrice) || costPrice < 0) {
        return res.status(400).json({
          success: false,
          message: "Cost price must be a non-negative number",
        });
      }

      const [rows] = await req.db.execute(
        `
          SELECT
              oi.id as order_item_id,
              oi.order_id,
              oi.quantity,
              oi.product_id,
              o.order_number,
              o.delivery_fee,
              p.name as product_name,
              LOWER(TRIM(COALESCE(p.description, ''))) as product_description
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          JOIN products p ON p.id = oi.product_id
          WHERE oi.id = ?
          LIMIT 1
        `,
        [orderItemId]
      );

      if (!rows.length) {
        return res.status(404).json({
          success: false,
          message: "Order item not found",
        });
      }

      const item = rows[0];
      if (item.product_description === manualProductDescription) {
        return res.status(400).json({
          success: false,
          message: "Manual-order product rows must be edited from the manual-order report",
        });
      }

      await req.db.execute(
        "UPDATE order_items SET price = ?, cost_price = ? WHERE id = ?",
        [salePrice, costPrice, orderItemId]
      );

      const [subtotalRows] = await req.db.execute(
        "SELECT COALESCE(SUM(quantity * price), 0) as subtotal FROM order_items WHERE order_id = ?",
        [item.order_id]
      );
      const subtotal = parseFloat(subtotalRows?.[0]?.subtotal || 0) || 0;
      const deliveryFee = parseFloat(item.delivery_fee || 0) || 0;
      const totalAmount = Math.round((subtotal + deliveryFee) * 100) / 100;

      await req.db.execute(
        "UPDATE orders SET total_amount = ? WHERE id = ?",
        [totalAmount, item.order_id]
      );

      return res.json({
        success: true,
        message: `Pricing updated for order ${item.order_number}`,
        order_item_id: orderItemId,
        order_id: Number(item.order_id) || null,
        order_number: item.order_number,
        product_id: Number(item.product_id) || null,
        product_name: item.product_name,
        quantity: Number(item.quantity) || 0,
        sale_price: Math.round(salePrice * 100) / 100,
        cost_price: Math.round(costPrice * 100) / 100,
        total_amount: totalAmount,
      });
    } catch (err) {
      console.error("Store product sales report update error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to update store sale pricing",
        error: err.message,
      });
    }
  }
);

router.put(
  "/manual-order-sales-report/:orderItemId",
  authenticateToken,
  requireStaffAccess,
  async (req, res) => {
    try {
      await ensureManualOrderItemCostColumn(req.db);

      if (!(await hasPermission(req, "action_edit_order"))) {
        return res.status(403).json({
          success: false,
          message: "Permission denied: action_edit_order required",
        });
      }

      const orderItemId = Number.parseInt(String(req.params.orderItemId || ""), 10);
      const salePrice = Number(req.body?.sale_price);
      const costPrice = Number(req.body?.cost_price);
      const manualProductDescription = "created from admin manual order";

      if (!Number.isInteger(orderItemId) || orderItemId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Valid order item is required",
        });
      }
      if (!Number.isFinite(salePrice) || salePrice <= 0) {
        return res.status(400).json({
          success: false,
          message: "Sale price must be greater than zero",
        });
      }
      if (!Number.isFinite(costPrice) || costPrice < 0) {
        return res.status(400).json({
          success: false,
          message: "Cost price must be a non-negative number",
        });
      }

      const [rows] = await req.db.execute(
        `
          SELECT
              oi.id as order_item_id,
              oi.order_id,
              oi.quantity,
              oi.product_id,
              o.order_number,
              o.delivery_fee,
              p.name as product_name,
              LOWER(TRIM(COALESCE(p.description, ''))) as product_description
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          JOIN products p ON p.id = oi.product_id
          WHERE oi.id = ?
          LIMIT 1
        `,
        [orderItemId]
      );

      if (!rows.length) {
        return res.status(404).json({
          success: false,
          message: "Order item not found",
        });
      }

      const item = rows[0];
      if (item.product_description !== manualProductDescription) {
        return res.status(400).json({
          success: false,
          message: "Only manual-order product rows can be edited from this report",
        });
      }

      await req.db.execute(
        "UPDATE order_items SET price = ?, cost_price = ? WHERE id = ?",
        [salePrice, costPrice, orderItemId]
      );

      const [subtotalRows] = await req.db.execute(
        "SELECT COALESCE(SUM(quantity * price), 0) as subtotal FROM order_items WHERE order_id = ?",
        [item.order_id]
      );
      const subtotal = parseFloat(subtotalRows?.[0]?.subtotal || 0) || 0;
      const deliveryFee = parseFloat(item.delivery_fee || 0) || 0;
      const totalAmount = Math.round((subtotal + deliveryFee) * 100) / 100;

      await req.db.execute(
        "UPDATE orders SET total_amount = ? WHERE id = ?",
        [totalAmount, item.order_id]
      );

      return res.json({
        success: true,
        message: `Pricing updated for order ${item.order_number}`,
        order_item_id: orderItemId,
        order_id: Number(item.order_id) || null,
        order_number: item.order_number,
        product_id: Number(item.product_id) || null,
        product_name: item.product_name,
        quantity: Number(item.quantity) || 0,
        sale_price: Math.round(salePrice * 100) / 100,
        cost_price: Math.round(costPrice * 100) / 100,
        total_amount: totalAmount,
      });
    } catch (err) {
      console.error("Manual order sales report update error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to update manual order pricing",
        error: err.message,
      });
    }
  }
);

router.get(
  "/store-order-breakdown",
  authenticateToken,
  requireStaffAccess,
  async (req, res) => {
    try {
      const [rows] = await req.db.execute(`
            SELECT
                s.id as store_id,
                s.name as store_name,
                o.id as order_id,
                o.order_number,
                o.status,
                o.created_at,
                COALESCE(SUM(oi.price * oi.quantity), 0) as store_order_amount
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            JOIN stores s ON oi.store_id = s.id
            GROUP BY s.id, s.name, o.id, o.order_number, o.status, o.created_at
            ORDER BY o.created_at DESC
        `);

      return res.json({
        success: true,
        store_orders: rows.map((row) => ({
          store_id: Number(row.store_id),
          store_name: row.store_name,
          order_id: Number(row.order_id),
          order_number: row.order_number,
          status: String(row.status || "").toLowerCase(),
          created_at: row.created_at,
          store_order_amount: parseFloat(row.store_order_amount || 0),
        })),
      });
    } catch (err) {
      console.error("Store order breakdown error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch store order breakdown",
        error: err.message,
      });
    }
  },
);

// --- Database backup endpoints ---
// POST /api/admin/backup-db  -> create a new dump (admin only)
// GET  /api/admin/backup-db/list -> list available dumps
// GET  /api/admin/backup-db/download?file=<name> -> download a dump file

// Trigger manual backup
router.post(
  "/backup-db",
  authenticateToken,
  requirePermission('menu_settings_backup'),
  async (req, res) => {
  let filepath = null;
  try {
    ensureBackupDir();
    const rawFilename = String(req.body?.filename || '').trim();
    if (!rawFilename) {
      return res.status(400).json({ success: false, message: "Backup file name is required" });
    }

    const normalizedBase = rawFilename
      .replace(/\.sql$/i, '')
      .replace(/[^a-zA-Z0-9 _-]/g, '')
      .trim()
      .replace(/\s+/g, '-');

    if (!normalizedBase) {
      return res.status(400).json({
        success: false,
        message: "Backup file name must contain letters, numbers, spaces, dashes, or underscores"
      });
    }

    const filename = `${normalizedBase}.sql`;
    filepath = path.join(BACKUP_DIR, filename);

    if (fs.existsSync(filepath)) {
      return res.status(400).json({
        success: false,
        message: "A backup with this file name already exists"
      });
    }

    const dbName =
      process.env.DB_NAME || process.env.MYSQL_DATABASE || "servenow";

    const outStream = fs.createWriteStream(filepath, { flags: "w" });
    // write header
    outStream.write(
      `-- ServeNow database dump\n-- Database: ${dbName}\n-- Generated: ${new Date().toISOString()}\n\n`
    );

    // Get list of tables
    const [tables] = await req.db.execute(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?",
      [dbName]
    );

    for (const trow of tables) {
      const table = trow.TABLE_NAME;
      // Write DROP + CREATE statement
      const [createRes] = await req.db.execute(
        `SHOW CREATE TABLE \`${table}\``
      );
      const createSql =
        createRes &&
        createRes[0] &&
        (createRes[0]["Create Table"] ||
          createRes[0]["Create View"] ||
          Object.values(createRes[0])[1]);
      outStream.write(`DROP TABLE IF EXISTS \`${table}\`;\n`);
      outStream.write(createSql + `;\n\n`);

      // Dump rows as INSERTs
      const [rows] = await req.db.execute(`SELECT * FROM \`${table}\``);
      if (rows && rows.length > 0) {
        const cols = Object.keys(rows[0])
          .map((c) => `\`${c}\``)
          .join(", ");
        // Batch inserts in groups of 100
        const batchSize = 100;
        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize);
          const values = batch.map(
            (r) =>
              "(" +
              Object.keys(r)
                .map((c) => mysqlLib.escape(r[c]))
                .join(",") +
              ")"
          );
          outStream.write(
            `INSERT INTO \`${table}\` (${cols}) VALUES\n${values.join(
              ",\n"
            )};\n`
          );
        }
        outStream.write("\n");
      }
    }

    outStream.end();
    return res.json({
      success: true,
      filename,
      downloadUrl: `/api/admin/backup-db/download?file=${encodeURIComponent(
        filename
      )}`,
    });
  } catch (err) {
    console.error("Backup error (mysql2):", err);
    try {
      if (filepath && fs.existsSync(filepath)) fs.unlinkSync(filepath);
    } catch (e) {
      /* ignore */
    }
    return res
      .status(500)
      .json({ success: false, message: "Backup failed", error: err.message });
  }
});

// List available backups
router.get(
  "/backup-db/list",
  authenticateToken,
  requirePermission('menu_settings_backup'),
  async (req, res) => {
    try {
      ensureBackupDir();
      const files = fs
        .readdirSync(BACKUP_DIR)
        .filter((f) => f.endsWith(".sql"))
        .map((f) => {
          const s = fs.statSync(path.join(BACKUP_DIR, f));
          return { filename: f, size: s.size, mtime: s.mtime };
        })
        .sort((a, b) => b.mtime - a.mtime);
      return res.json({ success: true, backups: files });
    } catch (err) {
      console.error("List backups error:", err);
      return res
        .status(500)
        .json({ success: false, message: "List failed", error: err.message });
    }
  }
);

// Diagnostic check for backup prerequisites
router.get(
  "/backup-db/check",
  authenticateToken,
  requirePermission('menu_settings_backup'),
  async (req, res) => {
    try {
      ensureBackupDir();
      const mysqldump = process.env.MYSQLDUMP_PATH || "mysqldump";

      // Check mysqldump availability
      const checkDump = await new Promise((resolve) => {
        const p = spawn(mysqldump, ["--version"]);
        let out = "";
        let err = "";
        p.stdout.on("data", (c) => (out += c.toString()));
        p.stderr.on("data", (c) => (err += c.toString()));
        p.on("error", (e) => resolve({ ok: false, error: e.message }));
        p.on("close", (code) => {
          if (code === 0) resolve({ ok: true, version: out.trim() });
          else resolve({ ok: false, error: err.trim() || `exit ${code}` });
        });
      });

      // Check write permission in backup dir
      const testFile = path.join(BACKUP_DIR, `.writetest-${Date.now()}.tmp`);
      let writeOk = false;
      let writeErr = null;
      try {
        fs.writeFileSync(testFile, "ok");
        fs.unlinkSync(testFile);
        writeOk = true;
      } catch (e) {
        writeErr = e.message;
      }

      // Check env vars
      const env = {
        DB_NAME: process.env.DB_NAME || process.env.MYSQL_DATABASE || null,
        DB_USER: process.env.DB_USER || process.env.MYSQL_USER || null,
        DB_HOST: process.env.DB_HOST || null,
        DB_PORT: process.env.DB_PORT || null,
        MYSQLDUMP_PATH: process.env.MYSQLDUMP_PATH || null,
      };

      return res.json({
        success: true,
        mysqldump: checkDump,
        backupsWritable: writeOk,
        writeError: writeErr,
        env,
      });
    } catch (err) {
      console.error("Backup check error:", err);
      return res
        .status(500)
        .json({ success: false, message: "Check failed", error: err.message });
    }
  }
);

router.get(
  "/backup-db/download",
  authenticateToken,
  requirePermission('menu_settings_backup'),
  async (req, res) => {
    try {
      const file = req.query.file;
      if (!file)
        return res
          .status(400)
          .json({ success: false, message: "file query parameter required" });
      const safe = path.basename(file);
      const filepath = path.join(BACKUP_DIR, safe);
      if (!fs.existsSync(filepath))
        return res
          .status(404)
          .json({ success: false, message: "File not found" });
      return res.download(filepath);
    } catch (err) {
      console.error("Download backup error:", err);
      return res.status(500).json({
        success: false,
        message: "Download failed",
        error: err.message,
      });
    }
  }
);

// RESTORE endpoint (safe/no-op by default)
// Historically this project provided a restore route. To avoid client-side JSON parse errors
// when the route is missing, provide a safe JSON response here. Enabling real restores
// requires setting ENABLE_RESTORE=true and ensuring mysqldump/mysql client availability
// and appropriate security considerations.
router.post(
  "/restore-db",
  authenticateToken,
  requirePermission('menu_settings_backup'),
  async (req, res) => {
    try {
      const { filename } = req.body || {};
      if (!filename)
        return res
          .status(400)
          .json({ success: false, message: "filename is required" });

      if (process.env.ENABLE_RESTORE !== "true") {
        return res.status(501).json({
          success: false,
          message:
            "Restore endpoint is disabled on this server. Set ENABLE_RESTORE=true to enable.",
        });
      }

      // Implement restore using mysql2 connector (no external mysql client)
      const safe = path.basename(filename);
      const filepath = path.join(BACKUP_DIR, safe);
      if (!fs.existsSync(filepath))
        return res
          .status(404)
          .json({ success: false, message: "Backup file not found" });

      // Require the request to come from the web admin UI (extra guard against mobile API calls)
      const requestedFrom = (
        req.get("X-Requested-From") ||
        req.get("x-requested-from") ||
        ""
      ).toString();
      const referer = (
        req.get("referer") ||
        req.get("referrer") ||
        ""
      ).toString();
      if (requestedFrom !== "web-admin" && !referer.includes("/admin.html")) {
        return res.status(403).json({
          success: false,
          message: "Restore requests must originate from the web admin UI",
        });
      }

      // Require a server-side passphrase for extra confirmation
      const providedPass =
        req.body && req.body.password ? String(req.body.password) : "";
      const requiredPass = process.env.RESTORE_PASSPHRASE;
      if (!requiredPass)
        return res.status(500).json({
          success: false,
          message:
            "Server restore passphrase not configured (RESTORE_PASSPHRASE)",
        });
      if (providedPass !== requiredPass)
        return res.status(403).json({
          success: false,
          message: "Invalid restore confirmation passphrase",
        });

      // Locking to prevent concurrent restores
      const lockFile = path.join(BACKUP_DIR, ".restore.lock");
      if (fs.existsSync(lockFile)) {
        try {
          const info = JSON.parse(fs.readFileSync(lockFile, "utf8"));
          return res.status(423).json({
            success: false,
            message: "Restore already in progress",
            info,
          });
        } catch (_) {
          return res
            .status(423)
            .json({ success: false, message: "Restore already in progress" });
        }
      }

      // create lock
      try {
        fs.writeFileSync(
          lockFile,
          JSON.stringify({
            pid: process.pid,
            ts: Date.now(),
            user: req.user && req.user.id ? req.user.id : null,
          })
        );
      } catch (e) {
        console.error("Failed to create restore lock:", e);
        return res
          .status(500)
          .json({ success: false, message: "Failed to create restore lock" });
      }

      // Read SQL file and execute using mysql2/promise
      const mysqlPromise = require("mysql2/promise");
      const dbHost =
        process.env.DB_HOST || process.env.MYSQL_HOST || "localhost";
      const dbPort = process.env.DB_PORT || process.env.MYSQL_PORT || "3306";
      const dbUser =
        process.env.DB_USER ||
        process.env.MYSQL_USER ||
        process.env.MYSQL_USERNAME;
      const dbPass = process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD;
      const dbName =
        process.env.DB_NAME || process.env.MYSQL_DATABASE || "servenow";

      if (!dbUser) {
        try {
          fs.unlinkSync(lockFile);
        } catch (_) {}
        return res.status(500).json({
          success: false,
          message: "DB user not configured on server",
        });
      }

      try {
        const sql = fs.readFileSync(filepath, "utf8");
        const conn = await mysqlPromise.createConnection({
          host: dbHost,
          port: Number(dbPort),
          user: dbUser,
          password: dbPass,
          database: dbName,
          multipleStatements: true,
        });
        await conn.query("SET FOREIGN_KEY_CHECKS=0");
        await conn.query(sql);
        await conn.query("SET FOREIGN_KEY_CHECKS=1");
        await conn.end();
        try {
          fs.unlinkSync(lockFile);
        } catch (_) {}
        return res.json({
          success: true,
          message: "Restore completed successfully",
        });
      } catch (errExec) {
        console.error(
          "Restore (connector) failed:",
          errExec && errExec.stack ? errExec.stack : errExec
        );
        try {
          fs.unlinkSync(lockFile);
        } catch (_) {}
        return res.status(500).json({
          success: false,
          message: "Restore failed",
          error: errExec && errExec.message ? errExec.message : String(errExec),
        });
      }
    } catch (err) {
      console.error("Restore backup error:", err);
      return res.status(500).json({
        success: false,
        message: "Restore failed",
        error: err.message,
      });
    }
  }
);

router.post(
  "/upload-image",
  authenticateToken,
  requireAdmin,
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file)
        return res
          .status(400)
          .json({ success: false, message: "No file uploaded" });
      const uploadDir = path.join(__dirname, "..", "uploads");
      if (!fs.existsSync(uploadDir))
        fs.mkdirSync(uploadDir, { recursive: true });
      const originalPath = req.file.path;
      const ext = path.extname(req.file.originalname) || ".jpg";
      const baseName = `upload_${Date.now()}_${Math.round(
        Math.random() * 1000
      )}`;
      const outName = `${baseName}${ext}`;
      const outPath = path.join(uploadDir, outName);
      fs.renameSync(originalPath, outPath);
      const publicPath = "/uploads/" + outName;
      const variants = {};
      if (sharp) {
        const sizes = [320, 640, 1024];
        for (const w of sizes) {
          try {
            const vname = `${baseName}_${w}${ext}`;
            const vpath = path.join(uploadDir, vname);
            await sharp(outPath).resize({ width: w }).toFile(vpath);
            variants[w] = "/uploads/" + vname;
          } catch (_) {}
        }
      }
      res.json({ success: true, image_url: publicPath, variants });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Image upload failed",
        error: error.message,
      });
    }
  }
);

router.post(
  "/migrate/items",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const createItemsSql = `
            CREATE TABLE IF NOT EXISTS items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                description TEXT NULL,
                image_url VARCHAR(255) NULL,
                category_id INT NULL,
                unit_id INT NULL,
                size_id INT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `;
      await req.db.execute(createItemsSql);

      const [[colExists]] = await req.db.execute(
        `
            SELECT COUNT(*) AS cnt
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'products' AND COLUMN_NAME = 'item_id'
        `,
        [process.env.DB_NAME || process.env.MYSQL_DATABASE]
      );
      if (!colExists || !colExists.cnt) {
        await req.db.execute(
          `ALTER TABLE products ADD COLUMN item_id INT NULL`
        );
      }

      await req.db.execute(
        `ALTER TABLE items ADD UNIQUE KEY uniq_items (name, category_id, unit_id, size_id)`
      );

      await req.db.execute(`
            INSERT INTO items (name, description, image_url, category_id, unit_id, size_id)
            SELECT p.name, 
                   SUBSTRING_INDEX(GROUP_CONCAT(IFNULL(p.description, '') ORDER BY p.id SEPARATOR '||'), '||', 1),
                   SUBSTRING_INDEX(GROUP_CONCAT(IFNULL(p.image_url, '') ORDER BY p.id SEPARATOR '||'), '||', 1),
                   p.category_id, p.unit_id, p.size_id
            FROM products p
            GROUP BY p.name, p.category_id, p.unit_id, p.size_id
            ON DUPLICATE KEY UPDATE description=VALUES(description), image_url=VALUES(image_url)
        `);

      const [updateRes] = await req.db.execute(`
            UPDATE products p
            JOIN items i
              ON i.name = p.name
             AND (i.category_id <=> p.category_id)
             AND (i.unit_id <=> p.unit_id)
             AND (i.size_id <=> p.size_id)
            SET p.item_id = i.id
            WHERE p.item_id IS NULL
        `);

      return res.json({
        success: true,
        message: "Migration completed",
        updated: updateRes.affectedRows || 0,
      });
    } catch (err) {
      console.error("Items migration error:", err);
      return res.status(500).json({
        success: false,
        message: "Migration failed",
        error: err.message,
      });
    }
  }
);

// ===== PAYMENT MANAGEMENT (ADMIN) =====

// Payment statistics for admin dashboard
router.get(
  "/payments/stats",
  authenticateToken,
  requireStaffAccess,
  async (req, res) => {
    try {
      if (!(await hasPermission(req, 'menu_payments'))) {
          return res.status(403).json({ success: false, message: 'Permission denied: menu_payments required' });
      }

      const [totalResult] = await req.db.execute(
        "SELECT COUNT(*) as total, SUM(amount) as total_amount FROM payments"
      );
      const [successResult] = await req.db.execute(
        'SELECT COUNT(*) as total, SUM(amount) as total_amount FROM payments WHERE status = "success"'
      );
      const [pendingResult] = await req.db.execute(
        'SELECT COUNT(*) as total, SUM(amount) as total_amount FROM payments WHERE status = "pending"'
      );
      const [failedResult] = await req.db.execute(
        'SELECT COUNT(*) as total, SUM(amount) as total_amount FROM payments WHERE status = "failed"'
      );
      const [methodStats] = await req.db.execute(
        'SELECT payment_method, COUNT(*) as count, SUM(amount) as total FROM payments WHERE status = "success" GROUP BY payment_method'
      );
      const [todayStats] = await req.db.execute(
        'SELECT COUNT(*) as count, SUM(amount) as total FROM payments WHERE status = "success" AND DATE(created_at) = CURDATE()'
      );

      return res.json({
        success: true,
        stats: {
          total: {
            total: Number(totalResult[0].total),
            total_amount: Number(totalResult[0].total_amount || 0),
          },
          successful: {
            total: Number(successResult[0].total),
            total_amount: Number(successResult[0].total_amount || 0),
          },
          pending: {
            total: Number(pendingResult[0].total),
            total_amount: Number(pendingResult[0].total_amount || 0),
          },
          failed: {
            total: Number(failedResult[0].total),
            total_amount: Number(failedResult[0].total_amount || 0),
          },
          today: {
            count: Number(todayStats[0].count),
            total: Number(todayStats[0].total || 0),
          },
          by_method: methodStats.map((m) => ({
            payment_method: m.payment_method,
            count: Number(m.count),
            total: Number(m.total || 0),
          })),
        },
      });
    } catch (error) {
      console.error("Payment stats error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch payment stats",
        error: error.message,
      });
    }
  }
);

// Get all payments with filters and pagination
router.get("/payments", authenticateToken, requireStaffAccess, async (req, res) => {
  try {
    if (!(await hasPermission(req, 'menu_payments'))) {
        return res.status(403).json({ success: false, message: 'Permission denied: menu_payments required' });
    }

    const { page, limit, status, startDate, endDate, userId } = req.query;
    const pageVal = Math.max(1, parseInt(page) || 1);
    const limitVal = Math.max(1, parseInt(limit) || 20);
    const offsetVal = (pageVal - 1) * limitVal;

    let query =
      "SELECT p.*, u.email, u.first_name, u.last_name, o.total_amount FROM payments p JOIN users u ON p.user_id = u.id JOIN orders o ON p.order_id = o.id WHERE 1=1";
    const params = [];

    if (status) {
      query += " AND p.status = ?";
      params.push(status);
    }
    if (startDate) {
      query += " AND DATE(p.created_at) >= ?";
      params.push(startDate);
    }
    if (endDate) {
      query += " AND DATE(p.created_at) <= ?";
      params.push(endDate);
    }
    if (userId) {
      query += " AND p.user_id = ?";
      params.push(userId);
    }

    const [payments] = await req.db.execute(
      query + " ORDER BY p.created_at DESC LIMIT ? OFFSET ?",
      [...params, limitVal, offsetVal]
    );
    const [countResult] = await req.db.execute(
      "SELECT COUNT(*) as total FROM payments p WHERE 1=1" +
        (status ? " AND p.status = ?" : "") +
        (startDate ? " AND DATE(p.created_at) >= ?" : "") +
        (endDate ? " AND DATE(p.created_at) <= ?" : "") +
        (userId ? " AND p.user_id = ?" : ""),
      params
    );

    return res.json({
      success: true,
      payments,
      total: Number(countResult[0].total),
      page: pageVal,
      limit: limitVal,
    });
  } catch (error) {
    console.error("Get payments error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch payments",
      error: error.message,
    });
  }
});

// Get payment details
router.get(
  "/payments/:paymentId",
  authenticateToken,
  requireStaffAccess,
  async (req, res) => {
    try {
      if (!(await hasPermission(req, 'menu_payments'))) {
          return res.status(403).json({ success: false, message: 'Permission denied: menu_payments required' });
      }

      const { paymentId } = req.params;
      const [payments] = await req.db.execute(
        "SELECT p.*, u.email, u.first_name, u.last_name, u.phone, o.total_amount, o.status as order_status FROM payments p JOIN users u ON p.user_id = u.id JOIN orders o ON p.order_id = o.id WHERE p.id = ?",
        [paymentId]
      );

      if (!payments.length) {
        return res
          .status(404)
          .json({ success: false, message: "Payment not found" });
      }

      return res.json({ success: true, payment: payments[0] });
    } catch (error) {
      console.error("Get payment details error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch payment details",
        error: error.message,
      });
    }
  }
);

// ===== WALLET MANAGEMENT (ADMIN) =====

// Wallet statistics for admin dashboard
router.get(
  "/wallets/stats",
  authenticateToken,
  requireStaffAccess,
  async (req, res) => {
    try {
      if (!(await hasPermission(req, 'menu_payments'))) {
          return res.status(403).json({ success: false, message: 'Permission denied: menu_payments required' });
      }

      const [totalStats] = await req.db.execute(
        "SELECT COUNT(*) as total_wallets, SUM(balance) as total_balance, AVG(balance) as avg_balance FROM wallets"
      );
      const [activeStats] = await req.db.execute(
        "SELECT COUNT(*) as count FROM wallets WHERE balance > 0"
      );
      const [autoRechargeStats] = await req.db.execute(
        "SELECT COUNT(*) as count FROM wallets WHERE auto_recharge_enabled = TRUE"
      );
      const [transactionStats] = await req.db.execute(
        'SELECT COUNT(*) as total_transactions, SUM(CASE WHEN type = "credit" THEN amount ELSE 0 END) as total_credited, SUM(CASE WHEN type = "debit" THEN amount ELSE 0 END) as total_spent FROM wallet_transactions'
      );

      return res.json({
        success: true,
        stats: {
          total_wallets: Number(totalStats[0].total_wallets),
          total_balance: Number(totalStats[0].total_balance || 0),
          avg_balance: Number(totalStats[0].avg_balance || 0),
          active_wallets: Number(activeStats[0].count),
          with_auto_recharge: Number(autoRechargeStats[0].count),
          transactions: {
            total_transactions: Number(transactionStats[0].total_transactions),
            total_credited: Number(transactionStats[0].total_credited || 0),
            total_spent: Number(transactionStats[0].total_spent || 0),
          },
        },
      });
    } catch (error) {
      console.error("Wallet stats error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch wallet stats",
        error: error.message,
      });
    }
  }
);

// Get all wallets with pagination
router.get("/wallets", authenticateToken, requireStaffAccess, async (req, res) => {
  try {
    if (!(await hasPermission(req, 'menu_payments'))) {
        return res.status(403).json({ success: false, message: 'Permission denied: menu_payments required' });
    }

    const { page, limit, minBalance, maxBalance } = req.query;
    const pageVal = Math.max(1, parseInt(page) || 1);
    const limitVal = Math.max(1, parseInt(limit) || 20);
    const offsetVal = (pageVal - 1) * limitVal;

    let query =
      `SELECT w.*, 
              COALESCE(u.email, r.email) as email, 
              COALESCE(u.first_name, r.first_name) as first_name, 
              COALESCE(u.last_name, r.last_name) as last_name 
       FROM wallets w 
       LEFT JOIN users u ON w.user_id = u.id 
       LEFT JOIN riders r ON w.rider_id = r.id 
       WHERE 1=1`;
    const params = [];

    if (minBalance) {
      query += " AND w.balance >= ?";
      params.push(minBalance);
    }
    if (maxBalance) {
      query += " AND w.balance <= ?";
      params.push(maxBalance);
    }

    const [wallets] = await req.db.execute(
      query + " ORDER BY w.balance DESC LIMIT ? OFFSET ?",
      [...params, limitVal, offsetVal]
    );
    const [countResult] = await req.db.execute(
      "SELECT COUNT(*) as total FROM wallets w WHERE 1=1" +
        (minBalance ? " AND w.balance >= ?" : "") +
        (maxBalance ? " AND w.balance <= ?" : ""),
      params
    );

    return res.json({
      success: true,
      wallets,
      total: Number(countResult[0].total),
      page: pageVal,
      limit: limitVal,
    });
  } catch (error) {
    console.error("Get wallets error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch wallets",
      error: error.message,
    });
  }
});

// Get wallet details
router.get(
  "/wallets/:walletId",
  authenticateToken,
  requireStaffAccess,
  async (req, res) => {
    try {
      if (!(await hasPermission(req, 'menu_payments'))) {
          return res.status(403).json({ success: false, message: 'Permission denied: menu_payments required' });
      }

      const { walletId } = req.params;
      const [wallets] = await req.db.execute(
        "SELECT w.*, u.email, u.first_name, u.last_name, u.phone FROM wallets w JOIN users u ON w.user_id = u.id WHERE w.id = ?",
        [walletId]
      );

      if (!wallets.length) {
        return res
          .status(404)
          .json({ success: false, message: "Wallet not found" });
      }

      const wallet = wallets[0];

      const [transactions] = await req.db.execute(
        "SELECT * FROM wallet_transactions WHERE wallet_id = ? ORDER BY created_at DESC LIMIT 50",
        [walletId]
      );

      return res.json({
        success: true,
        wallet,
        recent_transactions: transactions,
      });
    } catch (error) {
      console.error("Get wallet details error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch wallet details",
        error: error.message,
      });
    }
  }
);

// Manually adjust wallet balance (admin only)
router.post(
  "/wallets/:walletId/adjust",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { walletId } = req.params;
      const { amount, reason } = req.body;

      if (!amount || !reason) {
        return res
          .status(400)
          .json({ success: false, message: "Amount and reason are required" });
      }

      if (isNaN(amount) || amount === 0) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid amount" });
      }

      const [wallets] = await req.db.execute(
        "SELECT * FROM wallets WHERE id = ?",
        [walletId]
      );
      if (!wallets.length) {
        return res
          .status(404)
          .json({ success: false, message: "Wallet not found" });
      }

      const wallet = wallets[0];
      const newBalance = parseFloat(wallet.balance) + parseFloat(amount);

      if (newBalance < 0) {
        return res.status(400).json({
          success: false,
          message: "Insufficient balance for deduction",
        });
      }

      const type = amount > 0 ? "credit" : "debit";

      await req.db.execute("UPDATE wallets SET balance = ? WHERE id = ?", [
        newBalance,
        walletId,
      ]);
      const [txResult] = await req.db.execute(
        "INSERT INTO wallet_transactions (wallet_id, type, amount, description, balance_after) VALUES (?, ?, ?, ?, ?)",
        [
          walletId,
          type,
          Math.abs(amount),
          `Admin adjustment: ${reason}`,
          newBalance,
        ]
      );

      // Record in Master Ledger (financial_transactions)
      await recordFinancialTransaction(req.db, {
        transaction_type: type === 'credit' ? 'expense' : 'income',
        category: 'wallet_adjustment',
        description: `Admin Wallet Adjustment (${type}): ${reason}`,
        amount: Math.abs(amount),
        payment_method: 'wallet',
        related_entity_type: 'user',
        related_entity_id: wallet.user_id || wallet.rider_id,
        reference_type: 'wallet_transaction',
        reference_id: txResult.insertId,
        created_by: req.user.id
      });

      return res.json({
        success: true,
        message: "Wallet adjusted successfully",
        new_balance: newBalance,
      });
    } catch (error) {
      console.error("Adjust wallet error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to adjust wallet",
        error: error.message,
      });
    }
  }
);

// ===== SYSTEM DIAGNOSTICS (ADMIN) =====

// Run single diagnostic
router.get(
  "/diagnostics",
  authenticateToken,
  requirePermission('menu_settings_problems'),
  async (req, res) => {
  try {
    const { type } = req.query;
    const results = [];

    // Helper to add result
    const addResult = (checkType, status, issuesFound, details) => {
      results.push({
        type: checkType,
        status,
        issuesFound,
        details,
        lastRun: new Date().toISOString()
      });
    };

    // 1. Admin User Check
    if (!type || type === "all" || type === "admin") {
      const [admins] = await req.db.execute("SELECT * FROM users WHERE user_type = 'admin'");
      if (admins.length === 0) {
        addResult("Admin User", "Error", 1, "No admin user found in database!");
      } else {
        addResult("Admin User", "Success", 0, `Found ${admins.length} admin user(s).`);
      }
    }

    // 2. Orphan Records Check
    if (!type || type === "all" || type === "orphans") {
      let orphansCount = 0;
      let orphanDetails = [];

      // Check products without stores
      const [badProducts] = await req.db.execute("SELECT COUNT(*) as count FROM products WHERE store_id NOT IN (SELECT id FROM stores)");
      if (badProducts[0].count > 0) {
        orphansCount += badProducts[0].count;
        orphanDetails.push(`${badProducts[0].count} products with invalid store_id`);
      }

      // Check order items without orders
      const [badItems] = await req.db.execute("SELECT COUNT(*) as count FROM order_items WHERE order_id NOT IN (SELECT id FROM orders)");
      if (badItems[0].count > 0) {
        orphansCount += badItems[0].count;
        orphanDetails.push(`${badItems[0].count} order items with invalid order_id`);
      }

      if (orphansCount > 0) {
        addResult("Orphan Records", "Warning", orphansCount, orphanDetails.join(", "));
      } else {
        addResult("Orphan Records", "Success", 0, "No orphaned records found.");
      }
    }

    // 3. Enum Types Check
    if (!type || type === "all" || type === "types") {
      // Check for any invalid statuses in orders
      const [invalidOrders] = await req.db.execute("SELECT COUNT(*) as count FROM orders WHERE status NOT IN ('pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled')");
      if (invalidOrders[0].count > 0) {
        addResult("Enum Types", "Error", invalidOrders[0].count, `${invalidOrders[0].count} orders have invalid status values`);
      } else {
        addResult("Enum Types", "Success", 0, "All order statuses are valid.");
      }
    }

    // 4. Wallets Consistency Check
    if (!type || type === "all" || type === "wallets") {
      const [badWallets] = await req.db.execute("SELECT COUNT(*) as count FROM wallets WHERE balance < 0");
      if (badWallets[0].count > 0) {
        addResult("Wallets", "Error", badWallets[0].count, `${badWallets[0].count} wallets have negative balances`);
      } else {
        addResult("Wallets", "Success", 0, "All wallet balances are non-negative.");
      }
    }

    // 5. Transaction References Check
    if (!type || type === "all" || type === "tx_ref") {
      const [missingRefs] = await req.db.execute("SELECT COUNT(*) as count FROM financial_transactions WHERE related_entity_id IS NULL AND transaction_type IN ('income', 'settlement')");
      if (missingRefs[0].count > 0) {
        addResult("Transaction References", "Warning", missingRefs[0].count, `${missingRefs[0].count} transactions missing entity references`);
      } else {
        addResult("Transaction References", "Success", 0, "All critical transactions have references.");
      }
    }

    // 6. Logs Schema Check
    if (!type || type === "all" || type === "logs_schema") {
      try {
        await req.db.execute("DESCRIBE login_logs");
        addResult("Logs Schema", "Success", 0, "login_logs table exists and is accessible.");
      } catch (err) {
        addResult("Logs Schema", "Error", 1, "login_logs table is missing or corrupted.");
      }
    }

    res.json({ success: true, results });
  } catch (error) {
    console.error("Diagnostics error:", error);
    res.status(500).json({ success: false, message: "Diagnostics failed", error: error.message });
  }
});

// Clear Transactional Data (Orders, Payments, Transactions)
router.post(
  "/clear-transactional-data",
  authenticateToken,
  requirePermission('menu_settings_database'),
  async (req, res) => {
    const { table } = req.body;
    const providedPass =
      req.body && req.body.password ? String(req.body.password) : "";
    const requiredPass = process.env.RESTORE_PASSPHRASE;

    if (!requiredPass) {
      return res.status(500).json({
        success: false,
        message:
          "Server restore passphrase not configured (RESTORE_PASSPHRASE)",
      });
    }
    if (providedPass !== requiredPass) {
      return res.status(403).json({
        success: false,
        message: "Invalid super admin passphrase",
      });
    }

    const specialModes = new Set([
      "all",
      "all_except_user_store",
      "all_except_core_keep",
      "all_tables",
    ]);
    if (!table || typeof table !== "string") {
      return res.status(400).json({ success: false, message: "Invalid table specified" });
    }

    // Use connection from pool for transaction support if req.db is pool, 
    // BUT middleware usually attaches pool to req.db. 
    // To use transactions, we need a dedicated connection.
    let connection;
    try {
        // If req.db has getConnection (pool), use it. If it IS a connection, use it directly (but dangerous for transactions if shared)
        // Standard pattern: req.db is pool.
        if (typeof req.db.getConnection === 'function') {
            connection = await req.db.getConnection();
        } else {
            // Fallback if req.db is already a connection (unlikely in this setup but safe)
            // However, mysql2/promise connection does not have 'beginTransaction' directly if it's a pool connection?
            // Actually, pool.execute works, but transactions need connection.
            // If req.db is a connection, we can use it.
            connection = req.db; 
        }

        // Check if beginTransaction is available
        // NOTE: mysql2/promise connection object DOES support beginTransaction.
        // If it's missing, maybe it's not a connection object or something else is wrong.
        // We'll skip transaction if not available but warn.
        if (typeof connection.beginTransaction !== 'function') {
             console.warn("Database connection does not support transactions. Proceeding without transaction.");
             // Fallback: Just execute queries directly without transaction wrapper
             // We can't use commit/rollback here.
        } else {
             await connection.beginTransaction();
        }

        const allTables = await getAllBaseTables(connection);
        const tablesByLower = new Map(allTables.map((t) => [String(t).toLowerCase(), t]));

        let selected = String(table).trim().toLowerCase();
        // Backward-compatible aliases for UI values
        const modeAliases = {
          all_except_users_stores: "all_except_user_store",
          all_except_store_user: "all_except_user_store",
          except_user_store: "all_except_user_store",
          all_except_core_tables: "all_except_core_keep",
          all_except_keep_list: "all_except_core_keep",
          clear_except_core: "all_except_core_keep",
          all_db: "all_tables",
          all_data: "all_tables",
        };
        selected = modeAliases[selected] || selected;

        const actualTableName = tablesByLower.get(selected);

        if (!specialModes.has(selected) && !actualTableName) {
          // For optional tables, treat as no-op instead of hard failure.
          return res.json({
            success: true,
            message: `Table '${table}' not found. Nothing to clear.`,
          });
        }
        if (!specialModes.has(selected) && INTERNAL_SKIP_TABLES.has(actualTableName)) {
          return res.status(400).json({ success: false, message: `Table '${actualTableName}' cannot be cleared` });
        }

        if (selected === 'all') {
            // Clear all transactional data in correct order
            await connection.execute('DELETE FROM order_items');
            await connection.execute('DELETE FROM orders');
            await connection.execute('DELETE FROM payments');
            await connection.execute('DELETE FROM wallet_transactions');
            
            // Try to delete notifications, ignore if table doesn't exist
            try {
                await connection.execute('DELETE FROM notifications');
            } catch (e) {
                console.warn("Could not clear notifications table (might not exist):", e.message);
            }
            
            // Reset wallet balances to 0
            await connection.execute('UPDATE wallets SET balance = 0.00');
            
            if (typeof connection.commit === 'function') {
                await connection.commit();
            }
            return res.json({ success: true, message: "All transactional data cleared and wallets reset." });
        } else if (selected === 'all_except_user_store') {
            const clearTargets = allTables.filter(
              (t) => !INTERNAL_SKIP_TABLES.has(t) && !isUserStoreRelatedTable(t)
            );

            await connection.execute("SET FOREIGN_KEY_CHECKS = 0");
            try {
              for (const t of clearTargets) {
                await connection.execute(`DELETE FROM ${mysqlLib.escapeId(t)}`);
              }
            } finally {
              await connection.execute("SET FOREIGN_KEY_CHECKS = 1");
            }

            if (typeof connection.commit === 'function') {
                await connection.commit();
            }
            return res.json({
              success: true,
              message: `Cleared ${clearTargets.length} tables. User/store related tables were preserved.`,
              cleared_tables: clearTargets,
            });
        } else if (selected === 'all_except_core_keep') {
            const clearTargets = allTables.filter((t) => {
              const lower = String(t).toLowerCase();
              if (INTERNAL_SKIP_TABLES.has(t)) return false;
              return !CORE_KEEP_TABLES.has(lower);
            });

            await connection.execute("SET FOREIGN_KEY_CHECKS = 0");
            try {
              for (const t of clearTargets) {
                await connection.execute(`DELETE FROM ${mysqlLib.escapeId(t)}`);
              }
            } finally {
              await connection.execute("SET FOREIGN_KEY_CHECKS = 1");
            }

            if (typeof connection.commit === "function") {
              await connection.commit();
            }
            return res.json({
              success: true,
              message: `Cleared ${clearTargets.length} tables. Kept core tables: ${Array.from(CORE_KEEP_TABLES).join(", ")}.`,
              cleared_tables: clearTargets,
              kept_tables: Array.from(CORE_KEEP_TABLES),
            });
        } else if (selected === 'all_tables') {
            const clearTargets = allTables.filter((t) => !INTERNAL_SKIP_TABLES.has(t));

            await connection.execute("SET FOREIGN_KEY_CHECKS = 0");
            try {
              for (const t of clearTargets) {
                await connection.execute(`DELETE FROM ${mysqlLib.escapeId(t)}`);
              }
            } finally {
              await connection.execute("SET FOREIGN_KEY_CHECKS = 1");
            }

            if (typeof connection.commit === 'function') {
                await connection.commit();
            }
            return res.json({
              success: true,
              message: `Cleared ALL tables (${clearTargets.length}).`,
              cleared_tables: clearTargets,
            });
        } else {
            // Clear specific table
            if (selected === 'orders') {
                await connection.execute('DELETE FROM order_items'); // FK dependency
                await connection.execute('DELETE FROM orders');
            } else if (selected === 'order_items') {
                await connection.execute('DELETE FROM order_items');
            } else if (selected === 'payments') {
                await connection.execute('DELETE FROM payments');
            } else if (selected === 'wallet_transactions') {
                await connection.execute('DELETE FROM wallet_transactions');
                // Note: Deleting transactions might make balances inconsistent if not reset
            } else if (selected === 'notifications') {
                try {
                    await connection.execute('DELETE FROM notifications');
                } catch (e) {
                    throw new Error("Notifications table does not exist or cannot be cleared.");
                }
            } else {
                await connection.execute(`DELETE FROM ${mysqlLib.escapeId(actualTableName)}`);
            }
            
            if (typeof connection.commit === 'function') {
                await connection.commit();
            }
            return res.json({ success: true, message: `Table '${actualTableName || table}' cleared successfully.` });
        }

    } catch (error) {
        if (connection && typeof connection.rollback === 'function') {
            await connection.rollback();
        }
        console.error("Clear data error:", error);
        res.status(500).json({ success: false, message: "Failed to clear data", error: error.message });
    } finally {
        if (connection && typeof connection.release === 'function') {
            connection.release();
        }
    }
});

router.get(
  "/clearable-tables",
  authenticateToken,
  requirePermission("menu_settings_database"),
  async (req, res) => {
    try {
      const tables = await getAllBaseTables(req.db);
      return res.json({
        success: true,
        tables: tables
          .filter((t) => !INTERNAL_SKIP_TABLES.has(t))
          .map((t) => ({
            name: t,
            protected: isUserStoreRelatedTable(t),
          })),
      });
    } catch (error) {
      console.error("clearable-tables error:", error);
      return res
        .status(500)
        .json({ success: false, message: "Failed to load table list", error: error.message });
    }
  }
);

router.post(
  "/shrink-database",
  authenticateToken,
  requirePermission("menu_settings_database"),
  async (req, res) => {
    let connection;
    try {
      if (typeof req.db.getConnection === "function") {
        connection = await req.db.getConnection();
      } else {
        connection = req.db;
      }

      const allTables = await getAllBaseTables(connection);
      const optimizeTargets = allTables.filter((t) => !INTERNAL_SKIP_TABLES.has(t));

      const results = [];
      for (const t of optimizeTargets) {
        try {
          const [optRows] = await connection.query(
            `OPTIMIZE TABLE ${mysqlLib.escapeId(t)}`
          );
          results.push({ table: t, success: true, result: optRows });
        } catch (err) {
          results.push({ table: t, success: false, error: err.message });
        }
      }

      const failed = results.filter((r) => !r.success);
      return res.json({
        success: failed.length === 0,
        message:
          failed.length === 0
            ? `Database optimized successfully for ${optimizeTargets.length} tables.`
            : `Optimization completed with ${failed.length} table errors.`,
        total_tables: optimizeTargets.length,
        failed_tables: failed.map((f) => ({ table: f.table, error: f.error })),
      });
    } catch (error) {
      console.error("shrink-database error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to shrink database",
        error: error.message,
      });
    } finally {
      if (connection && typeof connection.release === "function") {
        connection.release();
      }
    }
  }
);

module.exports = router;
