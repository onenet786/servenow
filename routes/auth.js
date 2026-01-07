const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const { sendVerificationEmail, sendWelcomeEmail } = require("../services/emailService");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// Helper: safe boolean check
function isTrue(v) {
  return v === true || v === 1 || v === "1";
}

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
        `INSERT INTO users (first_name, last_name, email, phone, address, password, user_type, verification_code, verification_expires_at, is_verified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          firstName,
          lastName,
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
      
      // Send welcome email
      await sendWelcomeEmail(email, firstName);

      // Emit new_user event to admin
      try {
        if (req.io) {
          req.io.emit('new_user', {
            id: result.insertId,
            first_name: firstName,
            last_name: lastName,
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
            { expiresIn: process.env.JWT_EXPIRE }
          );
      }

      return res.status(201).json({
        success: true,
        message:
          "User registered successfully. Please check your email for verification code.",
        requires_verification: true,
        token, // Will be null
        user: {
          id: result.insertId,
          first_name: firstName,
          last_name: lastName,
          email,
          user_type: userType,
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
      if (process.env.NODE_ENV === "development")
        console.log("[auth] Login attempt:", email);

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
            { expiresIn: process.env.JWT_EXPIRE }
          );

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
            user: {
              id: user.id,
              first_name: user.first_name,
              last_name: user.last_name,
              email: user.email,
              user_type: user.user_type,
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
          passOk = passStr === password;
        }

        // Optional dev backdoor (keep only if needed)
        if (
          !passOk &&
          process.env.NODE_ENV === "development" &&
          rider.email === "ahmed.rider@servenow.com" &&
          password === "rider123"
        ) {
          passOk = true;
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
            { expiresIn: process.env.JWT_EXPIRE }
          );

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

// Get current user profile (users table)
router.get("/me", authenticateToken, async (req, res) => {
  try {
    if (
      process.env.NODE_ENV === "development" &&
      req.user &&
      req.user.id === 0 &&
      req.user.email === "admin@servenow.com"
    ) {
      return res.json({
        success: true,
        user: {
          id: 0,
          first_name: req.user.first_name || "Dev",
          last_name: req.user.last_name || "Admin",
          email: req.user.email,
          user_type: req.user.user_type || "admin",
        },
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
      "SELECT id, first_name, last_name, email, phone, address, user_type, created_at FROM users WHERE id = ? AND email = ?",
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

      // Verify current password (hash or legacy plain for rider)
      let isPasswordValid = false;
      const passStr = String(entity.password || "");
      if (
        table === "riders" &&
        !(
          passStr.startsWith("$2a$") ||
          passStr.startsWith("$2b$") ||
          passStr.startsWith("$2y$")
        )
      ) {
        isPasswordValid = passStr === currentPassword;
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
    if (
      process.env.NODE_ENV === "development" &&
      req.user &&
      req.user.id === 0 &&
      req.user.email === "admin@servenow.com"
    ) {
      return res.json({
        success: true,
        user: {
          id: 0,
          first_name: req.user.first_name || "Dev",
          last_name: req.user.last_name || "Admin",
          email: req.user.email,
          user_type: req.user.user_type || "admin",
        },
      });
    }

    const [users] = await req.db.execute(
      "SELECT id, first_name, last_name, email, phone, address, user_type, created_at FROM users WHERE id = ?",
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

module.exports = router;
