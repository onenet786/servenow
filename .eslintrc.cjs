module.exports = {
  ignorePatterns: ["mobile_app/**", "mobile_app/build/**", "js/admin.js"],
  env: {
    browser: true,
    node: true,
    es2021: true
  },
  extends: ["eslint:recommended"],
  parserOptions: {
    ecmaVersion: 12,
    sourceType: "module"
  },
  globals: {
    API_BASE: "readonly",
    cart: "writable",
    authToken: "readonly",
    Stripe: "readonly",
    filepath: "writable"
  },
  rules: {
    "no-unused-vars": "off",
    "no-console": ["off"],
    semi: ["error", "always"],
    "no-undef": "off",
    "no-empty": "off",
    "no-useless-escape": "off"
  }
};
