const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const { sendVerificationEmail, sendPasswordResetOTP } = require("../services/emailService");
const { authenticateToken } = require("../middleware/auth");
const {
  upsertPushToken,
  deactivatePushToken,
} = require("../services/pushNotifications");

const router = express.Router();

const ACCESS_TOKEN_EXPIRE = process.env.JWT_EXPIRE || "7d";
const REFRESH_TOKEN_EXPIRE_DAYS = parseInt(
  process.env.REFRESH_TOKEN_EXPIRE_DAYS || "30",
  10
);

// Helper: safe boolean check
function isTrue(v) {
  return v === true || v === 1 || v === "1";
}

function hashRefreshToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateRefreshToken() {
  return crypto.randomBytes(64).toString("hex");
}

async function issueRefreshToken(db, { userId, userType, deviceId = null }) {
  const refreshToken = generateRefreshToken();
  const tokenHash = hashRefreshToken(refreshToken);
  const expiresAt = new Date(
    Date.now() + REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60 * 1000
  );

  await db.execute(
    `INSERT INTO refresh_tokens (user_id, user_type, token_hash, expires_at, device_id)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, userType, tokenHash, expiresAt, deviceId]
  );

  return refreshToken;
}

async function rotateRefreshToken(db, tokenRow) {
  const now = new Date();
  const newToken = generateRefreshToken();
  const newHash = hashRefreshToken(newToken);
  const expiresAt = new Date(
    Date.now() + REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60 * 1000
  );

  await db.execute(
    `UPDATE refresh_tokens
     SET revoked_at = ?, replaced_by_hash = ?
     WHERE id = ?`,
    [now, newHash, tokenRow.id]
  );

  await db.execute(
    `INSERT INTO refresh_tokens (user_id, user_type, token_hash, expires_at, device_id)
     VALUES (?, ?, ?, ?, ?)`,
    [
      tokenRow.user_id,
      tokenRow.user_type,
      newHash,
      expiresAt,
      tokenRow.device_id || null,
    ]
  );

  return newToken;
}

async function loadAccountForToken(db, userId, userType) {
  if (userType === "rider") {
    const [riders] = await db.execute(
      "SELECT id, first_name, last_name, email, is_active FROM riders WHERE id = ?",
      [userId]
    );
    return riders[0] ? { ...riders[0], user_type: "rider" } : null;
  }

  const [users] = await db.execute(
    "SELECT id, first_name, last_name, email, user_type, is_active FROM users WHERE id = ?",
    [userId]
  );
  return users[0] || null;
}

function buildAccessTokenPayload(account) {
  return {
    id: account.id,
    email: account.email,
    user_type: account.user_type,
    first_name: account.first_name,
    last_name: account.last_name,
    is_guest: isTrue(account.is_guest),
  };
}

function buildGuestSession() {
  const guestId = crypto.randomInt(100000000, 999999999);
  return {
    id: guestId,
    email: `guest-${guestId}@guest.servenow.local`,
    user_type: "guest",
    first_name: "Guest",
    last_name: "User",
    is_guest: true,
  };
}

function buildGuestProfileFromToken(user) {
  const firstName = String(user?.first_name || "Guest").trim() || "Guest";
  const lastName = String(user?.last_name || "User").trim() || "User";
  const fallbackId = Number.parseInt(String(user?.id || ""), 10);
  const guestId = Number.isInteger(fallbackId) && fallbackId > 0
    ? fallbackId
    : crypto.randomInt(100000000, 999999999);

  return {
    id: guestId,
    first_name: firstName,
    last_name: lastName,
    email:
      String(user?.email || "").trim() ||
      `guest-${guestId}@guest.servenow.local`,
    user_type: "guest",
    is_guest: true,
    phone: null,
    address: null,
    date_of_birth: null,
  };
}

async function verifyGoogleIdToken(idToken) {
  const trimmed = String(idToken || "").trim();
  if (!trimmed) {
    throw new Error("Google ID token is required");
  }

  const response = await axios.get(
    "https://oauth2.googleapis.com/tokeninfo",
    {
      params: { id_token: trimmed },
      timeout: 10000,
    }
  );

  const payload = response.data || {};
  const issuer = String(payload.iss || "").trim();
  if (
    issuer !== "accounts.google.com" &&
    issuer !== "https://accounts.google.com"
  ) {
    throw new Error("Invalid Google token issuer");
  }

  const email = String(payload.email || "").trim().toLowerCase();
  if (!email) {
    throw new Error("Google account email not available");
  }

  const emailVerified =
    String(payload.email_verified || "").trim().toLowerCase() === "true";
  if (!emailVerified) {
    throw new Error("Google account email is not verified");
  }

  const configuredClientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
  const aud = String(payload.aud || "").trim();
  if (configuredClientId && aud && aud !== configuredClientId) {
    throw new Error("Google token audience mismatch");
  }

  return {
    googleId: String(payload.sub || "").trim(),
    email,
    firstName: String(payload.given_name || "").trim(),
    lastName: String(payload.family_name || "").trim(),
    fullName: String(payload.name || "").trim(),
    picture: String(payload.picture || "").trim(),
  };
}

async function verifyFacebookAccessToken(accessToken) {
  const trimmed = String(accessToken || "").trim();
  if (!trimmed) {
    throw new Error("Facebook access token is required");
  }

  const response = await axios.get("https://graph.facebook.com/me", {
    params: {
      fields: "id,email,first_name,last_name,name",
      access_token: trimmed,
    },
    timeout: 10000,
  });

  const payload = response.data || {};
  const email = String(payload.email || "").trim().toLowerCase();
  if (!email) {
    throw new Error(
      "Facebook account email not available. Please allow email permission."
    );
  }

  return {
    facebookId: String(payload.id || "").trim(),
    email,
    firstName: String(payload.first_name || "").trim(),
    lastName: String(payload.last_name || "").trim(),
    fullName: String(payload.name || "").trim(),
  };
}

// Forgot Password
router.post(
  "/forgot-password",
  [
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Please provide a valid email"),
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

      const { email } = req.body;

      // Check users table
      const [users] = await req.db.execute(
        "SELECT id FROM users WHERE email = ? AND is_active = true",
        [email]
      );

      // Check riders table
      const [riders] = await req.db.execute(
        "SELECT id FROM riders WHERE email = ? AND is_active = true",
        [email]
      );

      if (users.length === 0 && riders.length === 0) {
        // SECURITY: Don't reveal if email exists, but for UX we might.
        // The requirement says "via email address he added at registration time"
        return res.status(404).json({
          success: false,
          message: "No account found with that email address.",
        });
      }

      const otp = crypto.randomInt(100000, 999999).toString();
      const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      if (users.length > 0) {
        await req.db.execute(
          "UPDATE users SET reset_password_token = ?, reset_password_expires = ? WHERE id = ?",
          [otp, expires, users[0].id]
        );
      } else if (riders.length > 0) {
        await req.db.execute(
          "UPDATE riders SET reset_password_token = ?, reset_password_expires = ? WHERE id = ?",
          [otp, expires, riders[0].id]
        );
      }

      await sendPasswordResetOTP(email, otp);

      return res.json({
        success: true,
        message: "Password reset OTP has been sent to your email.",
      });
    } catch (error) {
      console.error("Forgot password error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to process forgot password request.",
        error: error.message,
      });
    }
  }
);

// Verify Reset OTP
router.post(
  "/verify-reset-otp",
  [
    body("email").isEmail().withMessage("Valid email is required"),
    body("otp").isLength({ min: 6, max: 6 }).withMessage("Valid 6-digit OTP is required"),
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

      const { email, otp } = req.body;

      // Check users
      const [users] = await req.db.execute(
        "SELECT id FROM users WHERE email = ? AND reset_password_token = ? AND reset_password_expires > NOW()",
        [email, otp]
      );

      // Check riders
      const [riders] = await req.db.execute(
        "SELECT id FROM riders WHERE email = ? AND reset_password_token = ? AND reset_password_expires > NOW()",
        [email, otp]
      );

      if (users.length === 0 && riders.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired OTP.",
        });
      }

      // Generate a temporary secure token for the password reset step
      const resetToken = crypto.randomBytes(32).toString("hex");
      const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      if (users.length > 0) {
        await req.db.execute(
          "UPDATE users SET reset_password_token = ?, reset_password_expires = ? WHERE id = ?",
          [resetToken, expires, users[0].id]
        );
      } else {
        await req.db.execute(
          "UPDATE riders SET reset_password_token = ?, reset_password_expires = ? WHERE id = ?",
          [resetToken, expires, riders[0].id]
        );
      }

      return res.json({
        success: true,
        message: "OTP verified successfully.",
        reset_token: resetToken,
      });
    } catch (error) {
      console.error("Verify OTP error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to verify OTP.",
        error: error.message,
      });
    }
  }
);

// Reset Password
router.post(
  "/reset-password",
  [
    body("token").notEmpty().withMessage("Token is required"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
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

      const { token, password } = req.body;

      // Find user or rider with this token
      const [users] = await req.db.execute(
        "SELECT id FROM users WHERE reset_password_token = ? AND reset_password_expires > NOW()",
        [token]
      );

      const [riders] = await req.db.execute(
        "SELECT id FROM riders WHERE reset_password_token = ? AND reset_password_expires > NOW()",
        [token]
      );

      if (users.length === 0 && riders.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Password reset token is invalid or has expired.",
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      if (users.length > 0) {
        await req.db.execute(
          "UPDATE users SET password = ?, reset_password_token = NULL, reset_password_expires = NULL WHERE id = ?",
          [hashedPassword, users[0].id]
        );
      } else if (riders.length > 0) {
        await req.db.execute(
          "UPDATE riders SET password = ?, reset_password_token = NULL, reset_password_expires = NULL WHERE id = ?",
          [hashedPassword, riders[0].id]
        );
      }

      return res.json({
        success: true,
        message: "Password has been reset successfully.",
      });
    } catch (error) {
      console.error("Reset password error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to reset password.",
        error: error.message,
      });
    }
  }
);

// Register user
router.post(
  "/register",
  [
    body("firstName")
      .trim()
      .isLength({ min: 2 })
      .withMessage("First name must be at least 2 characters"),
    body("lastName")
      .trim()
      .isLength({ min: 2 })
      .withMessage("Last name must be at least 2 characters"),
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Please provide a valid email"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    body("phone")
      .optional()
      .isMobilePhone()
      .withMessage("Please provide a valid phone number"),
    body("dateOfBirth")
      .optional({ checkFalsy: true })
      .isISO8601({ strict: true })
      .withMessage("Date of birth must be in YYYY-MM-DD format"),
    body("date_of_birth")
      .optional({ checkFalsy: true })
      .isISO8601({ strict: true })
      .withMessage("Date of birth must be in YYYY-MM-DD format"),
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

      const {
        firstName,
        lastName,
        email,
        phone,
        address,
        password,
        userType = "customer",
      } = req.body;
      const dateOfBirth = req.body.dateOfBirth || req.body.date_of_birth || null;

      // Check if user already exists
      const [existingUser] = await req.db.execute(
        "SELECT id FROM users WHERE email = ?",
        [email]
      );
      if (existingUser.length > 0) {
        return res.status(400).json({
          success: false,
          message: "User with this email already exists",
        });
      }

      // Hash password
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Generate verification code
      const verificationCode = crypto.randomInt(100000, 999999).toString();
      const verificationExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Insert user
      const [result] = await req.db.execute(
        `INSERT INTO users (first_name, last_name, date_of_birth, email, phone, address, password, user_type, verification_code, verification_expires_at, is_verified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          firstName,
          lastName,
          dateOfBirth,
          email,
          phone || null,
          address || null,
          hashedPassword,
          userType,
          verificationCode,
          verificationExpiresAt,
          false,
        ]
      );

      // Send verification email
      await sendVerificationEmail(email, verificationCode);

      // Emit new_user event to admin
      try {
        if (req.io) {
          req.io.emit('new_user', {
            id: result.insertId,
            first_name: firstName,
            last_name: lastName,
            date_of_birth: dateOfBirth,
            email: email,
            user_type: userType,
            created_at: new Date()
          });
        }
      } catch (e) {
        console.error('Socket emit error:', e);
      }

      // Issue token (client may gate access until verification)
      // SECURITY: Do not issue token if verification is required
      let token = null;
      let refreshToken = null;
      if (!process.env.REQUIRE_EMAIL_VERIFICATION || process.env.REQUIRE_EMAIL_VERIFICATION === 'false') {
          token = jwt.sign(
            {
              id: result.insertId,
              email,
              user_type: userType,
              first_name: firstName,
              last_name: lastName,
              is_verified: false,
            },
            process.env.JWT_SECRET,
            { expiresIn: ACCESS_TOKEN_EXPIRE }
          );

          refreshToken = await issueRefreshToken(req.db, {
            userId: result.insertId,
            userType: userType,
            deviceId: req.body.device_id || null,
          });
      }

      return res.status(201).json({
        success: true,
        message:
          "User registered successfully. Please check your email for verification code.",
        requires_verification: true,
        token, // Will be null
        refresh_token: refreshToken,
        user: {
          id: result.insertId,
          first_name: firstName,
          last_name: lastName,
          date_of_birth: dateOfBirth,
          email,
          user_type: userType,
          phone,
          address,
          is_verified: false,
        },
      });
    } catch (error) {
      console.error("Registration error:", error);
      return res.status(500).json({
        success: false,
        message: "Registration failed",
        error: error.message,
      });
    }
  }
);

// Login user (handles both users and riders)
router.post(
  "/guest-login",
  async (req, res) => {
    try {
      const guest = buildGuestSession();
      const token = jwt.sign(
        buildAccessTokenPayload(guest),
        process.env.JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRE }
      );

      try {
        const ip =
          req.headers["x-forwarded-for"] || req.socket.remoteAddress;
        await req.db.execute(
          "INSERT INTO login_logs (user_id, user_type, ip_address) VALUES (?, ?, ?)",
          [guest.id, "guest", ip]
        );
      } catch (e) {
        console.error("Guest login log error:", e);
      }

      return res.json({
        success: true,
        message: "Guest login successful",
        token,
        refresh_token: null,
        user: buildGuestProfileFromToken(guest),
      });
    } catch (error) {
      console.error("Guest login error:", error);
      return res.status(500).json({
        success: false,
        message: "Guest login failed",
        error: error.message,
      });
    }
  }
);

// Login user (handles both users and riders)
router.post(
  "/login",
  [
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Please provide a valid email"),
    body("password").notEmpty().withMessage("Password is required"),
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

      const { email, password } = req.body;

      // Try USERS first
      const [users] = await req.db.execute(
        "SELECT * FROM users WHERE email = ? AND is_active = true",
        [email]
      );
      if (users.length > 0) {
        const user = users[0];
        let valid = false;
        try {
          valid = await bcrypt.compare(password, user.password);
        } catch (e) {
          valid = false;
        }
        if (valid) {
          if (!isTrue(user.is_verified)) {
            return res.status(403).json({
              success: false,
              message: "Email not verified. Please verify your email to login.",
              requires_verification: true,
              email: user.email,
            });
          }

          const token = jwt.sign(
            {
              id: user.id,
              email: user.email,
              user_type: user.user_type,
              first_name: user.first_name,
              last_name: user.last_name,
            },
            process.env.JWT_SECRET,
            { expiresIn: ACCESS_TOKEN_EXPIRE }
          );
          const refreshToken = await issueRefreshToken(req.db, {
            userId: user.id,
            userType: user.user_type,
            deviceId: req.body.device_id || null,
          });

          try {
            const ip =
              req.headers["x-forwarded-for"] || req.socket.remoteAddress;
            await req.db.execute(
              "INSERT INTO login_logs (user_id, user_type, ip_address) VALUES (?, ?, ?)",
              [user.id, user.user_type, ip]
            );
          } catch (e) {
            console.error("Login log error:", e);
          }

          return res.json({
            success: true,
            message: "Login successful",
            token,
            refresh_token: refreshToken,
            user: {
              id: user.id,
              first_name: user.first_name,
              last_name: user.last_name,
              date_of_birth: user.date_of_birth,
              email: user.email,
              user_type: user.user_type,
              phone: user.phone,
              address: user.address,
            },
          });
        }
        // if users found but password invalid, fall through to rider check
      }

      // Try RIDERS
      const [riders] = await req.db.execute(
        "SELECT * FROM riders WHERE email = ? AND is_active = true",
        [email]
      );
      if (riders.length > 0) {
        const rider = riders[0];
        let passOk = false;
        const passStr = String(rider.password || "");
        if (
          passStr.startsWith("$2a$") ||
          passStr.startsWith("$2b$") ||
          passStr.startsWith("$2y$")
        ) {
          try {
            passOk = await bcrypt.compare(password, passStr);
          } catch (e) {
            passOk = false;
          }
        } else {
          // Legacy plaintext credentials are deliberately rejected. The account
          // must complete the password-reset flow before it can authenticate.
          passOk = false;
        }

        if (passOk) {
          const token = jwt.sign(
            {
              id: rider.id,
              email: rider.email,
              user_type: "rider",
              first_name: rider.first_name,
              last_name: rider.last_name,
            },
            process.env.JWT_SECRET,
            { expiresIn: ACCESS_TOKEN_EXPIRE }
          );
          const refreshToken = await issueRefreshToken(req.db, {
            userId: rider.id,
            userType: "rider",
            deviceId: req.body.device_id || null,
          });

          try {
            const ip =
              req.headers["x-forwarded-for"] || req.socket.remoteAddress;
            await req.db.execute(
              "INSERT INTO login_logs (user_id, user_type, ip_address) VALUES (?, ?, ?)",
              [rider.id, "rider", ip]
            );
          } catch (e) {
            console.error("Login log error:", e);
          }

          return res.json({
            success: true,
            message: "Rider login successful",
            token,
            refresh_token: refreshToken,
            user: {
              id: rider.id,
              first_name: rider.first_name,
              last_name: rider.last_name,
              email: rider.email,
              user_type: "rider",
            },
          });
        }
      }

      // No user/rider valid
      if (process.env.NODE_ENV === "development")
        console.warn("[auth] Login failed for:", email);
      return res
        .status(401)
        .json({ success: false, message: "Invalid email or password" });
    } catch (error) {
      console.error("Login error:", error);
      return res.status(500).json({
        success: false,
        message: "Login failed",
        error: error.message,
      });
    }
  }
);

router.post(
  "/google-mobile",
  [body("id_token").notEmpty().withMessage("Google ID token is required")],
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

      const googleUser = await verifyGoogleIdToken(req.body.id_token);

      const [riders] = await req.db.execute(
        "SELECT id FROM riders WHERE email = ? AND is_active = true LIMIT 1",
        [googleUser.email]
      );
      if (riders.length > 0) {
        return res.status(400).json({
          success: false,
          message: "This Google account belongs to a rider account. Please use rider login.",
        });
      }

      const [users] = await req.db.execute(
        "SELECT * FROM users WHERE email = ? LIMIT 1",
        [googleUser.email]
      );

      let user = users[0] || null;
      if (user && !isTrue(user.is_active)) {
        return res.status(403).json({
          success: false,
          message: "Your account is inactive. Please contact support.",
        });
      }

      if (!user) {
        const firstName =
          googleUser.firstName ||
          googleUser.fullName.split(" ").filter(Boolean)[0] ||
          "Google";
        const fullParts = googleUser.fullName.split(" ").filter(Boolean);
        const lastName =
          googleUser.lastName ||
          (fullParts.length > 1 ? fullParts.slice(1).join(" ") : "User");
        const generatedPassword = await bcrypt.hash(
          crypto.randomBytes(24).toString("hex"),
          10
        );

        const [result] = await req.db.execute(
          `INSERT INTO users (first_name, last_name, email, phone, address, password, user_type, is_verified, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            firstName,
            lastName,
            googleUser.email,
            null,
            null,
            generatedPassword,
            "customer",
            true,
            true,
          ]
        );

        const [createdUsers] = await req.db.execute(
          "SELECT * FROM users WHERE id = ? LIMIT 1",
          [result.insertId]
        );
        user = createdUsers[0] || {
          id: result.insertId,
          first_name: firstName,
          last_name: lastName,
          email: googleUser.email,
          user_type: "customer",
          phone: null,
          address: null,
          date_of_birth: null,
        };
      } else if (!isTrue(user.is_verified)) {
        await req.db.execute(
          "UPDATE users SET is_verified = 1, verification_code = NULL, verification_expires_at = NULL WHERE id = ?",
          [user.id]
        );
        user.is_verified = 1;
      }

      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
          user_type: user.user_type,
          first_name: user.first_name,
          last_name: user.last_name,
        },
        process.env.JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRE }
      );
      const refreshToken = await issueRefreshToken(req.db, {
        userId: user.id,
        userType: user.user_type,
        deviceId: req.body.device_id || null,
      });

      try {
        const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
        await req.db.execute(
          "INSERT INTO login_logs (user_id, user_type, ip_address) VALUES (?, ?, ?)",
          [user.id, user.user_type, ip]
        );
      } catch (e) {
        console.error("Google login log error:", e);
      }

      return res.json({
        success: true,
        message: "Google login successful",
        token,
        refresh_token: refreshToken,
        user: {
          id: user.id,
          first_name: user.first_name,
          last_name: user.last_name,
          date_of_birth: user.date_of_birth || null,
          email: user.email,
          user_type: user.user_type,
          phone: user.phone || null,
          address: user.address || null,
        },
      });
    } catch (error) {
      console.error("Google mobile login error:", error);
      return res.status(500).json({
        success: false,
        message: "Google login failed",
        error: error.message,
      });
    }
  }
);

router.post(
  "/facebook-mobile",
  [
    body("access_token")
      .notEmpty()
      .withMessage("Facebook access token is required"),
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

      const facebookUser = await verifyFacebookAccessToken(
        req.body.access_token
      );

      const [riders] = await req.db.execute(
        "SELECT id FROM riders WHERE email = ? AND is_active = true LIMIT 1",
        [facebookUser.email]
      );
      if (riders.length > 0) {
        return res.status(400).json({
          success: false,
          message:
            "This Facebook account belongs to a rider account. Please use rider login.",
        });
      }

      const [users] = await req.db.execute(
        "SELECT * FROM users WHERE email = ? LIMIT 1",
        [facebookUser.email]
      );

      let user = users[0] || null;
      if (user && !isTrue(user.is_active)) {
        return res.status(403).json({
          success: false,
          message: "Your account is inactive. Please contact support.",
        });
      }

      if (!user) {
        const firstName =
          facebookUser.firstName ||
          facebookUser.fullName.split(" ").filter(Boolean)[0] ||
          "Facebook";
        const fullParts = facebookUser.fullName.split(" ").filter(Boolean);
        const lastName =
          facebookUser.lastName ||
          (fullParts.length > 1 ? fullParts.slice(1).join(" ") : "User");
        const generatedPassword = await bcrypt.hash(
          crypto.randomBytes(24).toString("hex"),
          10
        );

        const [result] = await req.db.execute(
          `INSERT INTO users (first_name, last_name, email, phone, address, password, user_type, is_verified, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            firstName,
            lastName,
            facebookUser.email,
            null,
            null,
            generatedPassword,
            "customer",
            true,
            true,
          ]
        );

        const [createdUsers] = await req.db.execute(
          "SELECT * FROM users WHERE id = ? LIMIT 1",
          [result.insertId]
        );
        user = createdUsers[0] || {
          id: result.insertId,
          first_name: firstName,
          last_name: lastName,
          email: facebookUser.email,
          user_type: "customer",
          phone: null,
          address: null,
          date_of_birth: null,
        };
      } else if (!isTrue(user.is_verified)) {
        await req.db.execute(
          "UPDATE users SET is_verified = 1, verification_code = NULL, verification_expires_at = NULL WHERE id = ?",
          [user.id]
        );
        user.is_verified = 1;
      }

      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
          user_type: user.user_type,
          first_name: user.first_name,
          last_name: user.last_name,
        },
        process.env.JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRE }
      );
      const refreshToken = await issueRefreshToken(req.db, {
        userId: user.id,
        userType: user.user_type,
        deviceId: req.body.device_id || null,
      });

      try {
        const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
        await req.db.execute(
          "INSERT INTO login_logs (user_id, user_type, ip_address) VALUES (?, ?, ?)",
          [user.id, user.user_type, ip]
        );
      } catch (e) {
        console.error("Facebook login log error:", e);
      }

      return res.json({
        success: true,
        message: "Facebook login successful",
        token,
        refresh_token: refreshToken,
        user: {
          id: user.id,
          first_name: user.first_name,
          last_name: user.last_name,
          date_of_birth: user.date_of_birth || null,
          email: user.email,
          user_type: user.user_type,
          phone: user.phone || null,
          address: user.address || null,
        },
      });
    } catch (error) {
      console.error("Facebook mobile login error:", error);
      return res.status(500).json({
        success: false,
        message: "Facebook login failed",
        error: error.message,
      });
    }
  }
);

// Get current user profile (users table)
router.get("/me", authenticateToken, async (req, res) => {
  try {
    if (req.user.user_type === "guest" || isTrue(req.user.is_guest)) {
      return res.json({
        success: true,
        user: buildGuestProfileFromToken(req.user),
      });
    }

    // Check if user is a rider
    if (req.user.user_type === "rider") {
      if (process.env.NODE_ENV === "development")
        console.log("[auth] /me fetching rider profile for:", req.user.id);

      // Use email check to prevent ID collision with users table
      const [riders] = await req.db.execute(
        "SELECT id, first_name, last_name, email, phone, vehicle_type, license_number, is_available, created_at FROM riders WHERE id = ? AND email = ?",
        [req.user.id, req.user.email]
      );

      if (riders.length === 0) {
        // If not found by ID+Email, it might be a token issue or data inconsistency
        return res
          .status(404)
          .json({ success: false, message: "Rider not found" });
      }

      const rider = riders[0];
      return res.json({
        success: true,
        user: {
          ...rider,
          user_type: "rider",
        },
      });
    }

    // Default to Users table (Admin/Customer/Store Owner)
    // Use email check to prevent ID collision with riders table
    const [users] = await req.db.execute(
      "SELECT id, first_name, last_name, date_of_birth, email, phone, address, user_type, created_at FROM users WHERE id = ? AND email = ?",
      [req.user.id, req.user.email]
    );

    if (users.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    return res.json({ success: true, user: users[0] });
  } catch (error) {
    console.error("Profile fetch error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch profile",
      error: error.message,
    });
  }
});

// Refresh access token
router.post(
  "/refresh",
  [body("refresh_token").notEmpty().withMessage("Refresh token is required")],
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

      const refreshToken = req.body.refresh_token;
      const tokenHash = hashRefreshToken(refreshToken);

      const [rows] = await req.db.execute(
        `SELECT id, user_id, user_type, expires_at, revoked_at, device_id
         FROM refresh_tokens
         WHERE token_hash = ? AND revoked_at IS NULL
         LIMIT 1`,
        [tokenHash]
      );

      if (rows.length === 0) {
        return res.status(401).json({
          success: false,
          message: "Refresh token invalid or expired",
        });
      }

      const tokenRow = rows[0];
      if (new Date(tokenRow.expires_at) <= new Date()) {
        await req.db.execute(
          "UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?",
          [new Date(), tokenRow.id]
        );
        return res.status(401).json({
          success: false,
          message: "Refresh token expired",
        });
      }

      const account = await loadAccountForToken(
        req.db,
        tokenRow.user_id,
        tokenRow.user_type
      );

      if (!account || account.is_active === false || account.is_active === 0) {
        await req.db.execute(
          "UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?",
          [new Date(), tokenRow.id]
        );
        return res.status(401).json({
          success: false,
          message: "Account inactive or not found",
        });
      }

      const accessToken = jwt.sign(
        buildAccessTokenPayload(account),
        process.env.JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRE }
      );

      const newRefreshToken = await rotateRefreshToken(req.db, tokenRow);

      return res.json({
        success: true,
        token: accessToken,
        refresh_token: newRefreshToken,
      });
    } catch (error) {
      console.error("Refresh token error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to refresh session",
        error: error.message,
      });
    }
  }
);

// Change password (supports user and rider)
router.post(
  "/change-password",
  authenticateToken,
  [
    body("currentPassword")
      .notEmpty()
      .withMessage("Current password is required"),
    body("newPassword")
      .isLength({ min: 6 })
      .withMessage("New password must be at least 6 characters"),
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

      const { currentPassword, newPassword } = req.body;
      const userId = req.user.id;
      const userType = req.user.user_type;

      const table = userType === "rider" ? "riders" : "users";

      const [rows] = await req.db.execute(
        `SELECT * FROM ${table} WHERE id = ?`,
        [userId]
      );
      if (rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      const entity = rows[0];

      // All stored passwords must use an approved adaptive hash.
      let isPasswordValid = false;
      const passStr = String(entity.password || "");
      if (!(
          passStr.startsWith("$2a$") ||
          passStr.startsWith("$2b$") ||
          passStr.startsWith("$2y$")
        )) {
        return res.status(403).json({ success: false, message: "Password reset required" });
      } else {
        try {
          isPasswordValid = await bcrypt.compare(currentPassword, passStr);
        } catch (e) {
          isPasswordValid = false;
        }
      }

      if (!isPasswordValid) {
        return res
          .status(401)
          .json({ success: false, message: "Invalid current password" });
      }

      const saltRounds = 10;
      const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

      await req.db.execute(`UPDATE ${table} SET password = ? WHERE id = ?`, [
        hashedNewPassword,
        userId,
      ]);

      return res.json({
        success: true,
        message: "Password changed successfully",
      });
    } catch (error) {
      console.error("Change password error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to change password",
        error: error.message,
      });
    }
  }
);

// Duplicate profile endpoint for compatibility
router.get("/profile", authenticateToken, async (req, res) => {
  try {
    if (req.user.user_type === "guest" || isTrue(req.user.is_guest)) {
      return res.json({
        success: true,
        user: buildGuestProfileFromToken(req.user),
      });
    }

    const [users] = await req.db.execute(
      "SELECT id, first_name, last_name, date_of_birth, email, phone, address, user_type, created_at FROM users WHERE id = ?",
      [req.user.id]
    );

    if (users.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    return res.json({ success: true, user: users[0] });
  } catch (error) {
    console.error("Profile fetch error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch profile",
      error: error.message,
    });
  }
});

// Verify email
router.post(
  "/verify-email",
  [
    body("email").isEmail().withMessage("Please provide a valid email"),
    body("code")
      .isLength({ min: 6, max: 6 })
      .withMessage("Code must be 6 digits"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { email, code } = req.body;

      const [users] = await req.db.execute(
        "SELECT * FROM users WHERE email = ? AND verification_code = ? AND verification_expires_at > NOW()",
        [email, code]
      );

      if (users.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired verification code",
        });
      }

      const user = users[0];

      await req.db.execute(
        "UPDATE users SET is_verified = TRUE, verification_code = NULL, verification_expires_at = NULL WHERE id = ?",
        [user.id]
      );

      return res.json({
        success: true,
        message: "Email verified successfully",
      });
    } catch (error) {
      console.error("Verification error:", error);
      return res.status(500).json({
        success: false,
        message: "Verification failed",
        error: error.message,
      });
    }
  }
);

// Resend verification code
router.post(
  "/resend-code",
  [body("email").isEmail().withMessage("Please provide a valid email")],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { email } = req.body;

      const [users] = await req.db.execute(
        "SELECT id, is_verified FROM users WHERE email = ?",
        [email]
      );
      if (users.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      const user = users[0];
      if (isTrue(user.is_verified)) {
        return res
          .status(400)
          .json({ success: false, message: "Email already verified" });
      }

      const verificationCode = crypto.randomInt(100000, 999999).toString();
      const verificationExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await req.db.execute(
        "UPDATE users SET verification_code = ?, verification_expires_at = ? WHERE id = ?",
        [verificationCode, verificationExpiresAt, user.id]
      );

      await sendVerificationEmail(email, verificationCode);

      return res.json({ success: true, message: "Verification code sent" });
    } catch (error) {
      console.error("Resend code error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to resend code",
        error: error.message,
      });
    }
  }
);

router.post(
  "/push-token",
  authenticateToken,
  [
    body("device_token")
      .trim()
      .isLength({ min: 20, max: 512 })
      .withMessage("Valid device token is required"),
    body("platform")
      .optional()
      .trim()
      .isIn(["android", "ios", "web", "unknown"])
      .withMessage("Invalid platform"),
    body("device_id")
      .optional()
      .trim()
      .isLength({ max: 128 })
      .withMessage("device_id too long"),
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

      await upsertPushToken(req.db, {
        userId: req.user.id,
        userType: req.user.user_type,
        deviceToken: req.body.device_token,
        platform: req.body.platform || "unknown",
        deviceId: req.body.device_id || null,
      });

      return res.json({ success: true, message: "Push token registered" });
    } catch (error) {
      console.error("Push token register error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to register push token",
        error: error.message,
      });
    }
  },
);

router.delete(
  "/push-token",
  authenticateToken,
  [body("device_token").trim().isLength({ min: 20, max: 512 })],
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

      await deactivatePushToken(req.db, {
        userId: req.user.id,
        userType: req.user.user_type,
        deviceToken: req.body.device_token,
      });
      return res.json({ success: true, message: "Push token removed" });
    } catch (error) {
      console.error("Push token remove error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to remove push token",
        error: error.message,
      });
    }
  },
);

module.exports = router;
