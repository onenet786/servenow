const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const mysql = require("mysql2/promise");
const path = require("path");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const compression = require("compression");

// Load environment variables from .env and allow the .env values to override existing env vars
const dotenvResult = dotenv.config({ override: true });
console.log("Server starting... Environment variables loaded.");
if (dotenvResult.parsed) {
  console.log(
    `Loaded ${
      Object.keys(dotenvResult.parsed).length
    } variables from .env (overrode existing env vars).`
  );
}

function getPortFromArgs(argv) {
  const equalsStyle = argv.find((arg) => arg.startsWith("--port="));
  if (equalsStyle) {
    return equalsStyle.split("=")[1];
  }

  const portFlagIndex = argv.findIndex((arg) => arg === "--port");
  if (portFlagIndex !== -1) {
    const nextArg = argv[portFlagIndex + 1];
    if (nextArg && !nextArg.startsWith("--")) {
      return nextArg;
    }
  }

  return undefined;
}

// Force the PORT value to the one declared in .env (or fallback to 3002), unless already set
const forcedPortFromArg = getPortFromArgs(process.argv);
const forcedPort =
  forcedPortFromArg ||
  process.env.PORT ||
  (dotenvResult.parsed && dotenvResult.parsed.PORT
    ? dotenvResult.parsed.PORT
    : "3002");
process.env.PORT = forcedPort;
console.log(`Force-set process.env.PORT => ${process.env.PORT}`);

// Provide a safe default JWT_SECRET in development to avoid accidental 401s
if (process.env.NODE_ENV === "development" && !process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "orderdrop-dev-secret";
  console.warn(
    "WARNING: No JWT_SECRET found in .env - using development fallback secret. Do NOT use this in production."
  );
}

// Import routes
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const storeRoutes = require("./routes/stores");
const productRoutes = require("./routes/products");
const orderRoutes = require("./routes/orders");
const categoryRoutes = require("./routes/categories");
const riderRoutes = require("./routes/riders");
const adminRoutes = require("./routes/admin");
const unitRoutes = require("./routes/units");
const sizeRoutes = require("./routes/sizes");
const paymentRoutes = require("./routes/payments");
const walletRoutes = require("./routes/wallets");
const financialRoutes = require("./routes/financial");
const permissionRoutes = require("./routes/permissions");
const { logError } = require("./utils/debugLogger");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
  pingInterval: 60000,
  pingTimeout: 30000,
  maxHttpBufferSize: 1e6,
});

// Export io for use in other files
module.exports = { io };

const fs = require("fs");
const debugLog = (msg) => {
  if (process.env.NODE_ENV === "production") return;
  const logMsg = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFile(path.join(__dirname, "socket_debug.log"), logMsg, (err) => {
    if (err) console.error("Failed to write socket debug log:", err.message);
  });
};

io.on("connection", (socket) => {
  debugLog(`New client connected: ${socket.id}`);
  console.log(`[Socket.IO] New connection: ${socket.id}`);
  
  socket.on("identify_user", (data) => {
    console.log(`[Socket.IO] identify_user received from ${socket.id}:`, data);
    if (data && (data.user_id !== undefined && data.user_id !== null) && data.user_type) {
      const userId = String(data.user_id);
      const userType = String(data.user_type);
      
      const userRoom = `user_${userId}`;
      const typeRoom = `${userType}_${userId}`;
      
      socket.join(userRoom);
      socket.join(typeRoom);
      
      if (userType === 'admin') {
        socket.join('admins');
        console.log(`[Socket.IO] Admin ${socket.id} joined "admins" room`);
      }
      
      console.log(`[Socket.IO] Client ${socket.id} joined rooms: "${userRoom}", "${typeRoom}" (User ID: ${userId}, Type: ${userType})`);
      debugLog(`Client ${socket.id} joined rooms: ${userRoom}, ${typeRoom}`);
      
      const allSockets = io.engine.clientsCount || 0;
      console.log(`[Socket.IO] Total connected clients: ${allSockets}`);
    } else {
      console.warn(`[Socket.IO] identify_user missing required fields:`, data);
    }
  });
  
  socket.on("disconnect", () => {
    debugLog(`Client disconnected: ${socket.id}`);
    console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
  });
  
  socket.on("error", (error) => {
    console.error(`[Socket.IO] Error from ${socket.id}:`, error);
  });
});

// Heartbeat for debugging (only in development)
const heartbeatInterval = process.env.NODE_ENV === "production" ? 120000 : 60000;
setInterval(() => {
  if (io) {
    io.emit('heartbeat', { time: new Date() });
    if (process.env.NODE_ENV !== "production") {
      debugLog(`Heartbeat emitted. Clients connected: ${io.engine.clientsCount}`);
    }
  }
}, heartbeatInterval);

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    socket: !!io,
    clients: io ? io.engine.clientsCount : 0,
    time: new Date()
  });
});

console.log("Express application created.");

// Middleware
console.log("Setting up middleware...");

// Make io available to routes
app.use((req, res, next) => {
  if (!io) {
    console.error("Socket.io instance (io) is not initialized!");
  }
  req.io = io;
  next();
});

// Compression middleware - gzip responses for better bandwidth usage
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers["x-no-compression"]) return false;
    return compression.filter(req, res);
  }
}));
console.log("Response compression enabled.");

// Request logging (less verbose in production)
if (process.env.NODE_ENV === "production") {
  app.use(morgan("combined", {
    skip: (req, res) => {
      return res.statusCode < 400 && !req.path.startsWith("/api/");
    }
  }));
} else {
  app.use(morgan("dev"));
}
console.log("Morgan request logging configured.");

// Rate limiting - production-safe configuration
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === "production" ? 300 : 10000, // 300 req/15min for prod, generous for dev
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks and static assets
    return (
      req.path === "/health" ||
      req.path.match(
        /\.(js|css|html|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/
      )
    );
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === "production" ? 5 : 50, // 5 attempts for prod, 50 for dev
  message: "Too many login attempts, please try again later.",
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
});

const orderLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: process.env.NODE_ENV === "production" ? 20 : 100, // Prevent order spam
  message: "Too many order requests, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/", limiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/orders", orderLimiter);
console.log(
  `Rate limiting configured for ${
    process.env.NODE_ENV || "production"
  } environment.`
);

// CORS configuration - restrict in production
const corsOptions = {
  origin: function (origin, callback) {
    if (process.env.NODE_ENV === "development") {
      callback(null, true);
    } else {
      const allowedOrigins = process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
        : ["http://localhost:3002", "http://localhost:3001"];

      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS not allowed"));
      }
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

app.use(cors(corsOptions));

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains"
  );
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=()"
  );
  next();
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
console.log("Middleware setup complete.");

// Static files
console.log("Setting up static file serving...");
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/images", express.static(path.join(__dirname, "images")));
app.use("/next", express.static(path.join(__dirname, "webapp_v2"), { etag: true }));
console.log("Static files configured for /uploads and /images paths.");

// Database connection pool
let pool;
async function connectDB() {
  console.log("Attempting to connect to database...");
  try {
    const connectionLimit = process.env.NODE_ENV === "production" ? 20 : 10;
    pool = await mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT,
      waitForConnections: true,
      connectionLimit: connectionLimit,
      queueLimit: 0,
      enableKeepAlive: true,
      maxIdle: 30000,
      idleTimeout: 60000
    });
    console.log(`Connected to MySQL database pool: ${process.env.DB_NAME}`);
    console.log(`Database host: ${process.env.DB_HOST}:${process.env.DB_PORT}`);
    console.log(`Connection pool size: ${connectionLimit}`);
  } catch (error) {
    console.error("Database connection failed:", error);
    process.exit(1);
  }
}

// Make database pool available to routes
app.use((req, res, next) => {
  req.db = pool;
  next();
});

// Request logging middleware (only in development)
if (process.env.NODE_ENV !== "production") {
  app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path} - ${req.ip}`);
    next();
  });
}

// Routes
console.log("Setting up API routes...");
app.use("/api/auth", authRoutes);
console.log("Auth routes mounted at /api/auth");
app.use("/api/users", userRoutes);
console.log("User routes mounted at /api/users");
app.use("/api/stores", storeRoutes);
console.log("Store routes mounted at /api/stores");
app.use("/api/products", productRoutes);
console.log("Product routes mounted at /api/products");
app.use("/api/orders", orderRoutes);
console.log("Order routes mounted at /api/orders");
app.use("/api/categories", categoryRoutes);
console.log("Category routes mounted at /api/categories");
app.use("/api/riders", riderRoutes);
console.log("Rider routes mounted at /api/riders");
app.use("/api/admin", adminRoutes);
console.log("Admin routes mounted at /api/admin");
app.use("/api/units", unitRoutes);
console.log("Unit routes mounted at /api/units");
app.use("/api/sizes", sizeRoutes);
console.log("Size routes mounted at /api/sizes");
app.use("/api/payments", paymentRoutes);
console.log("Payment routes mounted at /api/payments");
app.use("/api/wallet", walletRoutes);
console.log("Wallet routes mounted at /api/wallet");
app.use("/api/financial", financialRoutes);
console.log("Financial routes mounted at /api/financial");
app.use("/api/permissions", permissionRoutes);
console.log("Permission routes mounted at /api/permissions");
console.log("All API routes configured.");

// Serve login.html for the root path
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

// Explicit route for data deletion request page (required for Play Store compliance)
app.get("/data-deletion", (req, res) => {
  res.sendFile(path.join(__dirname, "data-deletion.html"));
});

app.get("/data-deletion.html", (req, res) => {
  res.sendFile(path.join(__dirname, "data-deletion.html"));
});

// Dedicated route for the redesigned web experience.
app.get("/next", (req, res) => {
  res.sendFile(path.join(__dirname, "webapp_v2", "index.html"));
});

app.get("/next/", (req, res) => {
  res.sendFile(path.join(__dirname, "webapp_v2", "index.html"));
});

app.get("/next/login", (req, res) => {
  res.sendFile(path.join(__dirname, "webapp_v2", "login.html"));
});

app.get("/next/register", (req, res) => {
  res.sendFile(path.join(__dirname, "webapp_v2", "register.html"));
});

app.get("/next/forgot-password", (req, res) => {
  res.sendFile(path.join(__dirname, "webapp_v2", "forgot-password.html"));
});

app.get("/next/reset-password", (req, res) => {
  res.sendFile(path.join(__dirname, "webapp_v2", "reset-password.html"));
});

app.get("/next/verify-email", (req, res) => {
  res.sendFile(path.join(__dirname, "webapp_v2", "verify-email.html"));
});

// Caching strategy for frontend assets
app.use((req, res, next) => {
  if (req.path.endsWith(".js") || req.path.endsWith(".css")) {
    if (process.env.NODE_ENV === "production") {
      res.setHeader("Cache-Control", "public, max-age=86400");
    } else {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
  } else if (req.path.endsWith(".html")) {
    if (process.env.NODE_ENV === "production") {
      res.setHeader("Cache-Control", "no-cache");
    } else {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
  } else if (req.path.startsWith("/images/") || req.path.startsWith("/uploads/")) {
    res.setHeader("Cache-Control", "public, max-age=604800");
  }
  next();
});

// Serve static files from the root directory for the frontend
console.log("Setting up frontend static file serving...");
app.use(express.static(path.join(__dirname), { etag: true }));
console.log("Frontend static files configured.");

// Catch all handler: send back index.html for any non-API routes
console.log("Setting up catch-all handler for frontend routing...");
app.get("*", (req, res) => {
  // Only serve index.html for non-API routes
  if (!req.path.startsWith("/api/")) {
    console.log(`Serving frontend: ${req.path} -> index.html`);
    res.sendFile(path.join(__dirname, "index.html"));
  } else {
    console.log(`[404] API endpoint not found: ${req.method} ${req.path}`);
    res.status(404).json({ message: "API endpoint not found", path: req.path });
  }
});
console.log("Catch-all handler configured.");

// Error handling middleware
console.log("Setting up error handling middleware...");
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Error:`, err.stack);
  logError(`Global Handler (${req.method} ${req.path})`, err);
  res.status(500).json({
    success: false,
    message: "Something went wrong!",
    error: process.env.NODE_ENV === "development" ? err.message : {},
  });
});
console.log("Error handling middleware configured.");

// Start server
const PORT = forcedPortFromArg || process.env.PORT || 3002;
console.log(`Configured PORT: ${PORT}`);

async function startServer() {
  console.log("Starting server initialization...");
  await connectDB();

  // Create login_logs table if not exists
  try {
    await pool.query(`
            CREATE TABLE IF NOT EXISTS login_logs (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user_id INT NOT NULL,
                user_type VARCHAR(20) NOT NULL,
                login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ip_address VARCHAR(45)
            )
        `);
    console.log("Verified login_logs table exists");
  } catch (err) {
    console.error("Error creating login_logs table:", err);
  }

  try {
    const [cols] = await pool.execute(
      "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1",
      [process.env.DB_NAME, "products", "cost_price"]
    );
    if (!cols || cols.length === 0) {
      await pool.execute(
        "ALTER TABLE products ADD COLUMN cost_price DECIMAL(10, 2) NULL"
      );
      console.log("Added products.cost_price column");
    }
  } catch (err) {
    console.error(
      "Error ensuring products.cost_price column:",
      err && err.message ? err.message : err
    );
  }

  // Create performance indexes
  const indexesToCreate = [
    { table: 'products', index: 'idx_products_is_available', columns: 'is_available' },
    { table: 'products', index: 'idx_products_store_is_available', columns: 'store_id, is_available' },
    { table: 'order_items', index: 'idx_order_items_product_id', columns: 'product_id' },
    { table: 'order_items', index: 'idx_order_items_store_id', columns: 'store_id' },
    { table: 'riders', index: 'idx_riders_is_active', columns: 'is_active' },
    { table: 'riders', index: 'idx_riders_is_available', columns: 'is_available' },
    { table: 'stores', index: 'idx_stores_is_active', columns: 'is_active' }
  ];

  for (const idx of indexesToCreate) {
    try {
      const [indexes] = await pool.execute(
        "SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1",
        [process.env.DB_NAME, idx.table, idx.index]
      );
      if (!indexes || indexes.length === 0) {
        await pool.execute(
          `CREATE INDEX ${idx.index} ON ${idx.table}(${idx.columns})`
        );
        console.log(`Created index: ${idx.index}`);
      }
    } catch (err) {
      console.error(
        `Error ensuring index ${idx.index}:`,
        err && err.message ? err.message : err
      );
    }
  }

  console.log("Database connected. Starting HTTP server...");
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV}`);
    console.log(`Server accessible at: http://0.0.0.0:${PORT}`);
    console.log(`External access URL: http://23.137.84.249:${PORT}`);
    console.log("Server startup complete. Ready to accept connections.");
  });
}

console.log("Initiating server startup...");
startServer().catch((error) => {
  console.error("Server startup failed:", error);
  process.exit(1);
});
