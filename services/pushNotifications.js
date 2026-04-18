const admin = require("firebase-admin");

let firebaseReady = false;
let firebaseInitAttempted = false;
let firebaseInitError = null;

function initializeFirebaseAdmin() {
  if (firebaseInitAttempted) return firebaseReady;
  firebaseInitAttempted = true;

  try {
    if (admin.apps.length > 0) {
      firebaseReady = true;
      return true;
    }

    const jsonRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const pathRaw = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

    let credentials = null;
    if (jsonRaw && jsonRaw.trim()) {
      credentials = JSON.parse(jsonRaw);
    } else if (pathRaw && pathRaw.trim()) {
      credentials = require(pathRaw.trim());
    }

    if (!credentials) {
      console.warn(
        "[Push] Firebase Admin not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH.",
      );
      firebaseReady = false;
      firebaseInitError = "missing_credentials";
      return false;
    }

    admin.initializeApp({
      credential: admin.credential.cert(credentials),
    });
    firebaseReady = true;
    firebaseInitError = null;
    console.log("[Push] Firebase Admin initialized.");
    return true;
  } catch (error) {
    firebaseReady = false;
    firebaseInitError = error?.message || "init_failed";
    console.error("[Push] Firebase Admin initialization failed:", error.message);
    return false;
  }
}

function getPushServiceStatus() {
  const jsonRaw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const pathRaw = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const hasJson = !!(jsonRaw && jsonRaw.trim());
  const hasPath = !!(pathRaw && pathRaw.trim());
  const credentialSource = hasJson ? "env_json" : hasPath ? "env_path" : "none";
  const ready = initializeFirebaseAdmin();

  return {
    firebase_ready: !!ready,
    credential_source: credentialSource,
    init_attempted: firebaseInitAttempted,
    init_error: firebaseInitError,
  };
}

async function ensurePushDeviceTokensTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS push_device_tokens (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      user_type VARCHAR(30) NOT NULL,
      device_token VARCHAR(512) NOT NULL,
      platform VARCHAR(20) NOT NULL DEFAULT 'unknown',
      device_id VARCHAR(128) NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_user_type_token (user_id, user_type, device_token(191)),
      KEY idx_device_token (device_token(191)),
      KEY idx_user_lookup (user_id, user_type, is_active)
    )
  `);
}

function normalizeString(value, maxLen = 512) {
  const s = (value ?? "").toString().trim();
  if (!s) return "";
  return s.length > maxLen ? s.substring(0, maxLen) : s;
}

async function upsertPushToken(
  db,
  { userId, userType, deviceToken, platform = "unknown", deviceId = null },
) {
  const token = normalizeString(deviceToken, 512);
  const role = normalizeString(userType, 30);
  const platformNorm = normalizeString(platform, 20).toLowerCase() || "unknown";
  const deviceIdNorm = normalizeString(deviceId, 128) || null;
  const uid = parseInt(String(userId), 10);

  if (!uid || !token || !role) {
    throw new Error("Invalid push token payload");
  }

  await ensurePushDeviceTokensTable(db);
  await db.execute(
    `INSERT INTO push_device_tokens (user_id, user_type, device_token, platform, device_id, is_active)
     VALUES (?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       platform = VALUES(platform),
       device_id = VALUES(device_id),
       is_active = 1,
       last_seen_at = CURRENT_TIMESTAMP`,
    [uid, role, token, platformNorm, deviceIdNorm],
  );
}

async function deactivatePushToken(db, { userId, userType, deviceToken }) {
  const token = normalizeString(deviceToken, 512);
  const role = normalizeString(userType, 30);
  const uid = parseInt(String(userId), 10);
  if (!uid || !token || !role) return;

  await ensurePushDeviceTokensTable(db);
  await db.execute(
    `UPDATE push_device_tokens
     SET is_active = 0, last_seen_at = CURRENT_TIMESTAMP
     WHERE user_id = ? AND user_type = ? AND device_token = ?`,
    [uid, role, token],
  );
}

function toStringMap(input) {
  const out = {};
  const source = input && typeof input === "object" ? input : {};
  for (const [k, v] of Object.entries(source)) {
    if (v === null || v === undefined) continue;
    out[k] = String(v);
  }
  return out;
}

async function deactivateTokensByList(db, tokens) {
  if (!tokens || !tokens.length) return;
  const placeholders = tokens.map(() => "?").join(",");
  await db.execute(
    `UPDATE push_device_tokens
     SET is_active = 0, last_seen_at = CURRENT_TIMESTAMP
     WHERE device_token IN (${placeholders})`,
    tokens,
  );
}

async function sendPushToUser(
  db,
  { userId, userType, title, message, data = {}, collapseKey = null },
) {
  const uid = parseInt(String(userId), 10);
  const role = normalizeString(userType, 30);
  if (!uid || !role) {
    return { sent: 0, failed: 0, skipped: true, reason: "invalid_user" };
  }

  await ensurePushDeviceTokensTable(db);
  const [rows] = await db.execute(
    `SELECT device_token FROM push_device_tokens
     WHERE user_id = ? AND user_type = ? AND is_active = 1`,
    [uid, role],
  );
  const tokens = (rows || [])
    .map((x) => normalizeString(x.device_token, 512))
    .filter(Boolean);
  if (!tokens.length) {
    return { sent: 0, failed: 0, skipped: true, reason: "no_tokens" };
  }

  if (!initializeFirebaseAdmin()) {
    return {
      sent: 0,
      failed: tokens.length,
      skipped: true,
      reason: "firebase_not_ready",
    };
  }

  const payload = {
    notification: {
      title: normalizeString(title, 120) || "ServeNow",
      body: normalizeString(message, 500),
    },
    data: toStringMap({
      title: normalizeString(title, 120) || "ServeNow",
      message: normalizeString(message, 500),
      ...data,
    }),
    android: {
      priority: "high",
      collapseKey: collapseKey || undefined,
      notification: {
        channelId: "servenow_channel",
        sound: "default",
      },
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
        },
      },
    },
    tokens,
  };

  const response = await admin.messaging().sendEachForMulticast(payload);
  const invalidTokens = [];
  response.responses.forEach((r, index) => {
    if (r.success) return;
    const code = r.error?.code || "";
    if (
      code.includes("registration-token-not-registered") ||
      code.includes("invalid-registration-token")
    ) {
      invalidTokens.push(tokens[index]);
    }
  });
  if (invalidTokens.length) {
    try {
      await deactivateTokensByList(db, invalidTokens);
    } catch (e) {
      console.error("[Push] Failed deactivating invalid tokens:", e.message);
    }
  }

  return {
    sent: response.successCount,
    failed: response.failureCount,
    skipped: false,
  };
}

module.exports = {
  ensurePushDeviceTokensTable,
  upsertPushToken,
  deactivatePushToken,
  sendPushToUser,
  getPushServiceStatus,
};
