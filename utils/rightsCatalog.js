// The list of rights a staff group can hold. This is the only source: the
// server refuses any other key and the screen is drawn from it. Every right here
// is checked on the server. Risk decides how carefully a grant is confirmed.
//
//   low    read-only, no money or personal data at stake
//   medium changes operations, or shows customer or financial detail
//   high   moves money, approves documents, or touches the whole database

const R = (key, label, module, risk, hint = '') => ({ key, label, module, risk, hint });

// Grouped and ordered like the admin sidebar: one group per menu, one right (or more)
// per sub-menu, so every menu item can be given to a group on its own.
const RIGHTS = [
  R('menu_dashboard', 'Dashboard', 'Dashboard', 'low'),

  // Accounts menu (User Rights itself stays with the owner account)
  R('menu_users', 'Users: view user accounts', 'Accounts', 'high', 'Shows every customer and staff contact'),
  R('menu_riders', 'Riders: view riders', 'Accounts', 'medium', 'Shows rider phone numbers'),
  R('action_manage_fuel', 'Riders: log rider fuel', 'Accounts', 'medium'),

  // Stores menu
  R('menu_stores', 'Stores: view stores', 'Stores', 'low'),
  R('menu_store_status', 'Store Status: open, close and store messages', 'Stores', 'medium', 'Customers see the message on the store'),
  R('menu_delivery_notice', 'Delivery Notice: switch delivery on or off for everyone', 'Stores', 'high', 'Stops or starts ordering for all customers'),
  R('menu_push_broadcast', 'Push Broadcast: send notifications and app update notices', 'Stores', 'high', 'Reaches every customer phone'),
  R('menu_promotions', 'Promotions / Events: change the banners', 'Stores', 'medium', 'Customers see these on the home screen'),
  R('menu_offer_campaigns', 'Offer Campaigns: add and edit offers', 'Stores', 'medium', 'Changes the price customers pay'),
  R('menu_flash_message', 'Flash Message: change the customer flash message', 'Stores', 'medium'),
  R('menu_customer_tile_demo', 'Customer Tile Demo', 'Stores', 'low', 'A design preview with no data; this only shows the menu link'),

  // Products menu
  R('menu_products', 'Products: view', 'Products', 'low'),
  R('action_manage_products', 'Products: add and edit', 'Products', 'medium', 'Includes prices'),
  R('action_delete_products', 'Products: delete', 'Products', 'high'),

  // Orders menu
  R('menu_orders', 'Orders: view', 'Orders', 'medium', 'Shows customer names, phones and addresses'),
  R('action_order_create', 'Orders: create manual orders', 'Orders', 'medium'),
  R('action_edit_order', 'Orders: edit and assign riders', 'Orders', 'medium', 'Items, delivery fee, customer details and rider. Also lets sale reports correct a line price'),
  R('action_order_status', 'Orders: change status', 'Orders', 'medium'),
  R('action_order_payment', 'Orders: mark paid', 'Orders', 'high', 'Records money as received'),
  R('action_order_cancel', 'Orders: cancel', 'Orders', 'high', 'Reverses the rider cash and store payment'),

  // Payments & Wallets menu
  R('menu_payments', 'Payments', 'Payments & Wallets', 'medium'),
  R('menu_wallets', 'Wallets', 'Payments & Wallets', 'medium'),

  // Reports menu
  R('menu_report_orders', 'Order Reports', 'Reports', 'medium'),
  R('menu_report_inventory', 'Inventory Report: open the page', 'Reports', 'low'),
  R('report_inventory', 'Inventory Report: load the figures', 'Reports', 'low'),
  R('menu_report_riders', 'Rider Reports', 'Reports', 'medium'),
  R('menu_report_stores', 'Store Reports', 'Reports', 'medium'),
  R('menu_report_store_payment_terms', 'Store Payment Term Report', 'Reports', 'medium'),
  R('report_store_payments', 'Store Payments & Balances', 'Reports', 'medium'),
  R('report_rider_performance', 'Rider performance figures', 'Reports', 'medium'),
  R('report_sales', 'Sales figures on the dashboard and periodic sales reports', 'Reports', 'medium'),

  // Reports > Sale Reports sub-menu
  R('sale_report_order_wise', 'Order-Wise Sales', 'Reports: Sale Reports', 'medium'),
  R('sale_report_store', 'Store Sale-wise', 'Reports: Sale Reports', 'medium'),
  R('sale_report_manual', 'Manual Order Sales', 'Reports: Sale Reports', 'medium'),
  R('sale_report_store_products', 'Store Product Sales', 'Reports: Sale Reports', 'medium'),
  R('sale_report_combined_products', 'Combined Product Sales', 'Reports: Sale Reports', 'medium'),
  R('sale_report_with_delivery', 'Sales with Delivery', 'Reports: Sale Reports', 'medium'),
  R('sale_report_cash_credit', 'Cash/Credit Sales', 'Reports: Sale Reports', 'medium'),
  R('sale_report_cash_credit_type', 'Cash/Credit (By Type)', 'Reports: Sale Reports', 'medium'),
  R('sale_report_customers', 'Customer Details', 'Reports: Sale Reports', 'medium', 'Shows customer names and phones'),

  // Reports > Financial Reports page: each report in its list
  R('menu_report_financial', 'Financial Reports: open the page', 'Reports: Financial Reports', 'medium'),
  R('report_daily_summary', 'Daily summary', 'Reports: Financial Reports', 'medium'),
  R('report_weekly_summary', 'Weekly summary', 'Reports: Financial Reports', 'medium'),
  R('report_monthly_summary', 'Monthly summary', 'Reports: Financial Reports', 'medium'),
  R('report_order_summary', 'Order, rider activity and profit reports', 'Reports: Financial Reports', 'medium'),
  R('report_store_settlement', 'Store settlement and reconciliation reports', 'Reports: Financial Reports', 'medium'),
  R('report_store_financials', 'Store financials', 'Reports: Financial Reports', 'medium'),
  R('report_rider_cash', 'Rider cash, wallet and day closing reports', 'Reports: Financial Reports', 'medium'),
  R('report_rider_fuel', 'Rider fuel and mileage reports', 'Reports: Financial Reports', 'low'),
  R('report_delivery_charges', 'Delivery charges', 'Reports: Financial Reports', 'medium'),
  R('report_expense', 'Expense report', 'Reports: Financial Reports', 'medium'),
  R('report_general_voucher', 'General voucher report', 'Reports: Financial Reports', 'medium'),
  R('report_transactions_summary', 'Transaction summary', 'Reports: Financial Reports', 'medium'),
  R('report_comprehensive_cash', 'Comprehensive cash and discrepancy reports', 'Reports: Financial Reports', 'high'),
  R('report_custom', 'Custom report', 'Reports: Financial Reports', 'medium'),

  // Reports > Reports Centre: one right per report group in its list
  R('report_centre_riders', 'Riders reports', 'Reports: Reports Centre', 'medium'),
  R('report_centre_stores', 'Stores reports', 'Reports: Reports Centre', 'medium'),
  R('report_centre_accounts', 'Accounts reports (daybook, cash book, profit, expenses)', 'Reports: Reports Centre', 'high'),
  R('report_centre_control', 'Control reports (exceptions, change log)', 'Reports: Reports Centre', 'high'),
  R('report_centre_sales', 'Sales reports', 'Reports: Reports Centre', 'medium'),

  // Reports > the books
  R('menu_financial_dashboard', 'Financial Dashboard', 'Reports: Books', 'high', 'Profit, cash and full books'),
  R('menu_general_ledger', 'General Ledger', 'Reports: Books', 'high', 'Trial balance, profit and loss, balance sheet, account ledgers'),
  R('menu_gl_accounts', 'Chart of Accounts: view', 'Reports: Books', 'medium'),
  R('action_manage_gl_accounts', 'Chart of Accounts: add and edit accounts', 'Reports: Books', 'high', 'Decides where money can be booked'),

  // Catalog menu
  R('menu_categories', 'Categories: view', 'Catalog', 'low'),
  R('action_manage_categories', 'Categories: add and edit', 'Catalog', 'medium'),
  R('menu_units', 'Units: view', 'Catalog', 'low'),
  R('action_manage_units', 'Units: add and edit', 'Catalog', 'medium'),
  R('menu_sizes', 'Sizes: view', 'Catalog', 'low'),
  R('action_manage_sizes', 'Sizes: add and edit', 'Catalog', 'medium'),

  // HR menu
  R('menu_hr', 'Employees: staff list and face photos', 'HR', 'medium', 'Shows staff photos'),
  R('menu_hr_attendance', 'Attendance: daily, month, shifts and kiosk screens', 'HR', 'medium', 'Shows staff photos and locations; can correct times'),
  R('menu_hr_payroll', 'Payroll: salaries and salary vouchers', 'HR', 'high', 'Shows salaries and creates draft payment vouchers'),

  // Financial menu
  R('menu_financial_cpv', 'CPV (Cash Payment Voucher): view and create', 'Financial', 'medium'),
  R('approve_cpv', 'CPV: approve', 'Financial', 'high', 'Money leaves the office'),
  R('menu_financial_settlements', 'Store Settlements: view and create', 'Financial', 'medium'),
  R('approve_settlements', 'Store Settlements: approve and pay', 'Financial', 'high', 'Money leaves to a store'),
  R('menu_financial_expenses', 'Expenses: view and record', 'Financial', 'medium'),
  R('approve_expenses', 'Expenses: approve and pay', 'Financial', 'high'),
  R('menu_financial_crv', 'CRV (Cash Receive Voucher): view and create', 'Financial', 'medium'),
  R('approve_crv', 'CRV: approve', 'Financial', 'high', 'Lowers a rider or store balance'),
  R('menu_financial_rider_cash', 'Rider Cash: view and record', 'Financial', 'medium'),
  R('approve_rider_cash', 'Rider Cash: approve hand-ins and fuel', 'Financial', 'high', 'Confirms cash was counted'),
  R('menu_financial_bpv', 'BPV (Bank Payment Voucher): view and create', 'Financial', 'medium'),
  R('approve_bpv', 'BPV: approve', 'Financial', 'high', 'Money leaves the bank'),
  R('menu_financial_brv', 'BRV (Bank Receive Voucher): view and create', 'Financial', 'medium'),
  R('approve_brv', 'BRV: approve', 'Financial', 'high', 'Lowers a rider or store balance'),
  R('menu_financial_jnv', 'JNV (Journal Voucher): view and create', 'Financial', 'medium'),
  R('approve_jnv', 'JNV: post and cancel', 'Financial', 'high', 'Changes the books directly'),

  R('menu_settings_general', 'Settings: system settings', 'Settings', 'high', 'Delivery fees and app-wide settings'),
  R('menu_settings_backup', 'Utilities: take and download database backups', 'Utilities', 'high', 'A backup holds all customer and financial data. Restoring stays with the owner account'),
  R('menu_settings_database', 'Utilities: other tools', 'Utilities', 'high', 'Clear data, shrink and SQL stay with the owner account'),
  R('menu_settings_problems', 'Problems and diagnostics', 'Problems', 'medium'),
];

// Rights that were split into one right per sub-menu. Whoever held the old right keeps
// exactly what they could open before (utils/rightsMigration.js adds these once).
const SPLITS = [
  { id: '2026-11-10-hr-attendance', from: ['menu_hr'], add: ['menu_hr_attendance'] },
  { id: '2026-11-10-general-ledger', from: ['menu_financial_dashboard'], add: ['menu_general_ledger'] },
  { id: '2026-11-10-sale-reports', from: ['report_sales'], add: ['sale_report_order_wise', 'sale_report_store', 'sale_report_manual', 'sale_report_store_products', 'sale_report_combined_products', 'sale_report_with_delivery', 'sale_report_cash_credit', 'sale_report_cash_credit_type', 'sale_report_customers'] },
];

const MODULES = [...new Set(RIGHTS.map((r) => r.module))];
const KEYS = new Set(RIGHTS.map((r) => r.key));

// Never delegated, whatever a group holds. Listed so the screen can say so.
const ADMIN_ONLY = [
  'Manage user rights and groups',
  'Restore a database backup (owner account only)',
  'Clear data, shrink the database or run SQL (owner account only)',
  'Create, edit or deactivate users',
  'Create, edit or delete riders',
  'Add, edit or delete stores (store owners can edit their own)',
  'Adjust a wallet balance by hand',
  'Reset a delivered or cancelled order',
  'Run SQL on the database',
];

const VIEW_ORDERS = ['menu_dashboard', 'menu_orders'];
const CATALOG_VIEW = ['menu_products', 'menu_categories', 'menu_units', 'menu_sizes'];

// Starting points: the least each job needs. Staff can be given more afterwards.
const TEMPLATES = [
  { key: 'dispatcher', label: 'Dispatcher', description: 'Runs orders and riders. No money.',
    rights: [...VIEW_ORDERS, 'menu_riders', 'menu_stores', 'menu_store_status', 'action_edit_order', 'action_order_status'] },
  { key: 'catalog', label: 'Catalog editor', description: 'Keeps products and prices up to date.',
    rights: ['menu_dashboard', ...CATALOG_VIEW, 'menu_stores', 'action_manage_products', 'action_manage_categories', 'action_manage_units', 'action_manage_sizes'] },
  { key: 'cashier', label: 'Cashier', description: 'Records rider cash and vouchers. Cannot approve them.',
    rights: [...VIEW_ORDERS, 'menu_riders', 'action_manage_fuel', 'menu_financial_rider_cash', 'menu_financial_cpv', 'menu_financial_crv', 'menu_financial_expenses', 'report_centre_riders'] },
  { key: 'accountant', label: 'Accountant', description: 'Approves documents and reads the books.',
    rights: ['menu_dashboard', 'menu_financial_cpv', 'menu_financial_bpv', 'menu_financial_crv', 'menu_financial_brv', 'menu_financial_jnv', 'menu_financial_rider_cash', 'menu_financial_settlements', 'menu_financial_expenses', 'approve_cpv', 'approve_bpv', 'approve_crv', 'approve_brv', 'approve_jnv', 'approve_rider_cash', 'approve_settlements', 'approve_expenses', 'menu_financial_dashboard', 'menu_general_ledger', 'menu_gl_accounts', 'report_store_payments', 'report_centre_accounts', 'report_centre_control', 'report_centre_riders', 'report_centre_stores', 'report_centre_sales'] },
  { key: 'auditor', label: 'Auditor (read-only)', description: 'Sees reports and the books. Cannot change anything.',
    rights: ['menu_dashboard', 'menu_financial_dashboard', 'menu_general_ledger', 'menu_gl_accounts', 'report_store_payments', 'report_centre_accounts', 'report_centre_control', 'report_centre_riders', 'report_centre_stores', 'report_centre_sales'] },
  { key: 'support', label: 'Customer support', description: 'Looks up orders and contacts customers.',
    rights: [...VIEW_ORDERS, 'menu_stores', 'menu_store_status'] },
];

const isRight = (key) => KEYS.has(key);
const unknownRights = (keys) => keys.filter((k) => !KEYS.has(k));
const highRisk = (keys) => RIGHTS.filter((r) => r.risk === 'high' && keys.includes(r.key));

module.exports = { RIGHTS, MODULES, ADMIN_ONLY, TEMPLATES, SPLITS, isRight, unknownRights, highRisk };
