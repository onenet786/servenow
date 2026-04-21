const API_BASE = `${window.location.protocol}//${window.location.host}`;
const AUTH_TOKEN_KEY = "serveNowToken";
const AUTH_USER_KEY = "serveNowUser";

document.addEventListener("DOMContentLoaded", () => {
  bindLoginForm();
  bindRegisterForm();
  bindForgotPasswordForm();
  bindVerifyEmailForm();
  bindResetPasswordForm();
});

function bindLoginForm() {
  const form = document.getElementById("loginForm");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    try {
      const data = await postJson("/api/auth/login", {
        email: formData.get("email"),
        password: formData.get("password"),
      });

      persistSession(data.token, data.user);
      showStatus("Login successful.", "success");
      window.location.href = nextRouteForUser(data.user);
    } catch (error) {
      const message = String(error.message || "Login failed.");
      if (message.toLowerCase().includes("verify")) {
        showStatus(message, "warning");
        const email = encodeURIComponent(String(formData.get("email") || "").trim());
        window.setTimeout(() => {
          window.location.href = `/next/verify-email?email=${email}`;
        }, 700);
        return;
      }
      showStatus(message, "error");
    }
  });
}

function bindRegisterForm() {
  const form = document.getElementById("registerForm");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");
    if (password !== confirmPassword) {
      showStatus("Passwords do not match.", "error");
      return;
    }

    try {
      const data = await postJson("/api/auth/register", {
        firstName: formData.get("firstName"),
        lastName: formData.get("lastName"),
        email: formData.get("email"),
        phone: formData.get("phone"),
        address: formData.get("address"),
        password,
        userType: "customer",
      });

      if (data.token && data.user) {
        persistSession(data.token, data.user);
        showStatus("Registration successful.", "success");
        window.location.href = nextRouteForUser(data.user);
        return;
      }

      const email = encodeURIComponent(String(formData.get("email") || "").trim());
      showStatus(data.message || "Account created. Please verify your email.", "success");
      window.setTimeout(() => {
        window.location.href = `/next/verify-email?email=${email}`;
      }, 700);
    } catch (error) {
      showStatus(error.message || "Registration failed.", "error");
    }
  });
}

function bindVerifyEmailForm() {
  const form = document.getElementById("verifyEmailForm");
  if (!form) return;

  const emailInput = document.getElementById("verifyEmail");
  const queryEmail = new URLSearchParams(window.location.search).get("email");
  if (emailInput && queryEmail) {
    emailInput.value = queryEmail;
  }

  const resendBtn = document.getElementById("resendCodeBtn");
  resendBtn?.addEventListener("click", async () => {
    const email = String(emailInput?.value || "").trim();
    if (!email) {
      showStatus("Enter your email first.", "error");
      return;
    }
    try {
      const data = await postJson("/api/auth/resend-code", { email });
      showStatus(data.message || "Verification code sent.", "success");
    } catch (error) {
      showStatus(error.message || "Failed to resend code.", "error");
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    try {
      const data = await postJson("/api/auth/verify-email", {
        email: formData.get("email"),
        code: formData.get("code"),
      });
      showStatus(data.message || "Email verified successfully.", "success");
      window.setTimeout(() => {
        window.location.href = "/next/login";
      }, 700);
    } catch (error) {
      showStatus(error.message || "Verification failed.", "error");
    }
  });
}

function bindForgotPasswordForm() {
  const requestForm = document.getElementById("forgotPasswordRequestForm");
  const verifyForm = document.getElementById("forgotPasswordVerifyForm");
  if (!requestForm || !verifyForm) return;

  const emailInput = document.getElementById("forgotEmail");
  const otpStep = document.getElementById("forgotOtpStep");
  const resetStep = document.getElementById("forgotResetStep");
  const verifyStep = document.getElementById("forgotVerifyStep");
  const tokenInput = document.getElementById("forgotResetToken");
  const backBtn = document.getElementById("forgotBackBtn");

  requestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(requestForm);
    try {
      const data = await postJson("/api/auth/forgot-password", {
        email: formData.get("email"),
      });
      showStatus(data.message || "OTP sent to your email.", "success");
      verifyStep.classList.add("hidden");
      otpStep.classList.remove("hidden");
    } catch (error) {
      showStatus(error.message || "Failed to send OTP.", "error");
    }
  });

  verifyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(verifyForm);
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");

    if (otpStep.classList.contains("hidden")) {
      if (password !== confirmPassword) {
        showStatus("Passwords do not match.", "error");
        return;
      }
      try {
        const data = await postJson("/api/auth/reset-password", {
          token: tokenInput.value,
          password,
        });
        showStatus(data.message || "Password reset successfully.", "success");
        window.setTimeout(() => {
          window.location.href = "/next/login";
        }, 700);
      } catch (error) {
        showStatus(error.message || "Password reset failed.", "error");
      }
      return;
    }

    try {
      const data = await postJson("/api/auth/verify-reset-otp", {
        email: emailInput.value,
        otp: formData.get("otp"),
      });
      tokenInput.value = data.reset_token || "";
      otpStep.classList.add("hidden");
      resetStep.classList.remove("hidden");
      backBtn?.classList.remove("hidden");
      showStatus(data.message || "OTP verified.", "success");
    } catch (error) {
      showStatus(error.message || "OTP verification failed.", "error");
    }
  });

  backBtn?.addEventListener("click", () => {
    otpStep.classList.remove("hidden");
    resetStep.classList.add("hidden");
    backBtn.classList.add("hidden");
  });
}

function bindResetPasswordForm() {
  const form = document.getElementById("resetPasswordForm");
  if (!form) return;

  const tokenInput = document.getElementById("resetToken");
  const queryToken = new URLSearchParams(window.location.search).get("token");
  if (tokenInput && queryToken) {
    tokenInput.value = queryToken;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const password = String(formData.get("password") || "");
    const confirmPassword = String(formData.get("confirmPassword") || "");
    if (password !== confirmPassword) {
      showStatus("Passwords do not match.", "error");
      return;
    }

    try {
      const data = await postJson("/api/auth/reset-password", {
        token: formData.get("token"),
        password,
      });
      showStatus(data.message || "Password reset successfully.", "success");
      window.setTimeout(() => {
        window.location.href = "/next/login";
      }, 700);
    } catch (error) {
      showStatus(error.message || "Password reset failed.", "error");
    }
  });
}

async function postJson(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  let data = {};
  try {
    data = await response.json();
  } catch (_) {
    data = {};
  }

  if (!response.ok || data.success === false) {
    throw new Error(data.message || `Request failed with status ${response.status}`);
  }

  return data;
}

function persistSession(token, user) {
  if (token) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  }
  if (user) {
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  }
}

function nextRouteForUser(user) {
  if (!user) return "/next/";
  if (user.user_type === "admin" || user.user_type === "standard_user") return "/next/#admin-dashboard";
  if (user.user_type === "rider") return "/next/#rider-dashboard";
  if (user.user_type === "store_owner") return "/next/#store-dashboard";
  return "/next/#profile";
}

function showStatus(message, type = "success") {
  const el = document.getElementById("statusBanner");
  if (!el) return;
  el.textContent = message;
  el.className = `status-banner ${type}`;
  el.classList.remove("hidden");
  window.clearTimeout(showStatus.timer);
  showStatus.timer = window.setTimeout(() => {
    el.classList.add("hidden");
  }, 4000);
}
