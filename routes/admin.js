const express = require("express");
const { authenticateToken, requireAdmin } = require("../middleware/auth");
const { recordFinancialTransaction } = require("../utils/dbHelpers");

const router = express.Router();
const fs = require("fs");
const path = require("path");
const { exec, spawn } = require("child_process");
const mysqlLib = require("mysql2");

const BACKUP_DIR = path.join(__dirname, "..", "database", "backups");

const multer = require("multer");
const sharp = (() => {
  try {
    return require("sharp");
  } catch (e) {
    return null;
  }
})();
const upload = multer({ dest: path.join(__dirname, "..", "uploads", "tmp") });
function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// Execute a limited ALTER TABLE statement (admin-only)
// Body: { sql: "ALTER TABLE ..." }
router.post(
  "/execute-sql",
  authenticateToken,
  requireAdmin,
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

// Recent Activity Endpoint
router.get(
  "/recent-activity",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
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
  requireAdmin,
  async (req, res) => {
    try {
      const [storeInventory] = await req.db.execute(`
            SELECT 
                s.id as store_id,
                s.name as store_name,
                s.is_active,
                COUNT(p.id) as total_products,
                SUM(p.stock_quantity) as total_stock,
                SUM(p.stock_quantity * p.price) as total_inventory_value
            FROM stores s
            LEFT JOIN products p ON s.id = p.store_id
            GROUP BY s.id, s.name, s.is_active
            ORDER BY s.name
        `);

      const [categoryInventory] = await req.db.execute(`
            SELECT 
                c.id as category_id,
                c.name as category_name,
                COUNT(p.id) as total_products,
                SUM(p.stock_quantity) as total_stock,
                SUM(p.stock_quantity * p.price) as total_inventory_value
            FROM categories c
            LEFT JOIN products p ON c.id = p.category_id
            GROUP BY c.id, c.name
            ORDER BY c.name
        `);

      const [storeCategoryBreakdown] = await req.db.execute(`
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
            GROUP BY s.id, s.name, c.id, c.name
            ORDER BY s.name, c.name
        `);

      const [totalStats] = await req.db.execute(`
            SELECT 
                (SELECT COUNT(*) FROM stores) as total_stores,
                (SELECT COUNT(*) FROM categories) as total_categories,
                COUNT(p.id) as total_products,
                SUM(p.stock_quantity) as total_stock,
                SUM(p.stock_quantity * p.price) as total_inventory_value
            FROM products p
        `);

      return res.json({
        success: true,
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
  requireAdmin,
  async (req, res) => {
    try {
      const [storeSales] = await req.db.execute(`
            SELECT 
                s.id as store_id,
                s.name as store_name,
                COUNT(DISTINCT o.id) as total_orders,
                COALESCE(SUM(o.total_amount), 0) as total_sales,
                COALESCE(AVG(o.total_amount), 0) as average_order_value,
                COUNT(DISTINCT o.user_id) as unique_customers
            FROM stores s
            LEFT JOIN orders o ON s.id = o.store_id AND o.status != 'cancelled'
            GROUP BY s.id, s.name
            ORDER BY total_sales DESC
        `);

      return res.json({
        success: true,
        store_sales: storeSales.map((row) => ({
          store_id: row.store_id,
          store_name: row.store_name,
          total_orders: Number(row.total_orders) || 0,
          total_sales: parseFloat(row.total_sales) || 0,
          average_order_value: parseFloat(row.average_order_value) || 0,
          unique_customers: Number(row.unique_customers) || 0,
        })),
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

// --- Database backup endpoints ---
// POST /api/admin/backup-db  -> create a new dump (admin only)
// GET  /api/admin/backup-db/list -> list available dumps
// GET  /api/admin/backup-db/download?file=<name> -> download a dump file

router.post("/backup-db", authenticateToken, requireAdmin, async (req, res) => {
  try {
    ensureBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `backup-${timestamp}.sql`;
    const filepath = path.join(BACKUP_DIR, filename);

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
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    } catch (e) {
      /* ignore */
    }
    return res
      .status(500)
      .json({ success: false, message: "Backup failed", error: err.message });
  }
});

router.get(
  "/backup-db/list",
  authenticateToken,
  requireAdmin,
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

// Diagnostic check for backup prerequisites (admin-only)
router.get(
  "/backup-db/check",
  authenticateToken,
  requireAdmin,
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
  requireAdmin,
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
  requireAdmin,
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

// Get all payments with filters and pagination
router.get("/payments", authenticateToken, requireAdmin, async (req, res) => {
  try {
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
  requireAdmin,
  async (req, res) => {
    try {
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

// Payment statistics for admin dashboard
router.get(
  "/payments/stats",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
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

// ===== WALLET MANAGEMENT (ADMIN) =====

// Get all wallets with pagination
router.get("/wallets", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page, limit, minBalance, maxBalance } = req.query;
    const pageVal = Math.max(1, parseInt(page) || 1);
    const limitVal = Math.max(1, parseInt(limit) || 20);
    const offsetVal = (pageVal - 1) * limitVal;

    let query =
      `SELECT w.*, 
              COALESCE(u.email, r.email) as email, 
              COALESCE(u.first_name, r.first_name, r.full_name) as first_name, 
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
  requireAdmin,
  async (req, res) => {
    try {
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

// Wallet statistics for admin dashboard
router.get(
  "/wallets/stats",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
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

// ===== SYSTEM DIAGNOSTICS (ADMIN) =====

router.get("/diagnostics", authenticateToken, requireAdmin, async (req, res) => {
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

module.exports = router;
