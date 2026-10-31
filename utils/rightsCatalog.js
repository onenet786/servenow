// The list of rights a staff group can hold. This is the only source: the
// server refuses any other key and the screen is drawn from it. Every right here
// is checked on the server. Risk decides how carefully a grant is confirmed.
//
//   low    read-only, no money or personal data at stake
//   medium changes operations, or shows customer or financial detail
//   high   moves money, approves documents, or touches the whole database

const R = (key, label, module, risk, hint = '') => ({ key, label, module, risk, hint });

const RIGHTS = [
  R('menu_dashboard', 'View dashboard', 'Dashboard', 'low'),

  R('menu_orders', 'View orders', 'Orders', 'medium', 'Shows customer names, phones and addresses'),
  R('action_order_create', 'Create manual orders', 'Orders', 'medium'),
  R('action_edit_order', 'Edit orders and assign riders', 'Orders', 'medium', 'Items, delivery fee, customer details and rider'),
  R('action_order_status', 'Change order status', 'Orders', 'medium'),
  R('action_order_payment', 'Mark orders paid', 'Orders', 'high', 'Records money as received'),
  R('action_order_cancel', 'Cancel orders', 'Orders', 'high', 'Reverses the rider cash and store payment'),

  R('menu_products', 'View products', 'Catalog', 'low'),
  R('action_manage_products', 'Add and edit products', 'Catalog', 'medium', 'Includes prices'),
  R('action_delete_products', 'Delete products', 'Catalog', 'high'),
  R('menu_categories', 'View categories', 'Catalog', 'low'),
  R('action_manage_categories', 'Add and edit categories', 'Catalog', 'medium'),
  R('menu_units', 'View units', 'Catalog', 'low'),
  R('action_manage_units', 'Add and edit units', 'Catalog', 'medium'),
  R('menu_sizes', 'View sizes', 'Catalog', 'low'),
  R('action_manage_sizes', 'Add and edit sizes', 'Catalog', 'medium'),

  R('menu_stores', 'View stores', 'Stores', 'low'),
  R('menu_store_status', 'View store status', 'Stores', 'low'),

  R('menu_riders', 'View riders', 'Riders', 'medium', 'Shows rider phone numbers'),
  R('action_manage_fuel', 'Log rider fuel', 'Riders', 'medium'),

  R('menu_users', 'View user accounts', 'Accounts', 'high', 'Shows every customer and staff contact'),
  R('menu_payments', 'View payments', 'Payments and wallets', 'medium'),
  R('menu_wallets', 'View wallets', 'Payments and wallets', 'medium'),

  R('menu_financial_cpv', 'Cash payment vouchers: view and create', 'Vouchers', 'medium'),
  R('approve_cpv', 'Cash payment vouchers: approve', 'Vouchers', 'high', 'Money leaves the office'),
  R('menu_financial_bpv', 'Bank payment vouchers: view and create', 'Vouchers', 'medium'),
  R('approve_bpv', 'Bank payment vouchers: approve', 'Vouchers', 'high', 'Money leaves the bank'),
  R('menu_financial_crv', 'Cash receipt vouchers: view and create', 'Vouchers', 'medium'),
  R('approve_crv', 'Cash receipt vouchers: approve', 'Vouchers', 'high', 'Lowers a rider or store balance'),
  R('menu_financial_brv', 'Bank receipt vouchers: view and create', 'Vouchers', 'medium'),
  R('approve_brv', 'Bank receipt vouchers: approve', 'Vouchers', 'high', 'Lowers a rider or store balance'),
  R('menu_financial_jnv', 'Journal vouchers: view and create', 'Vouchers', 'medium'),
  R('approve_jnv', 'Journal vouchers: post and cancel', 'Vouchers', 'high', 'Changes the books directly'),

  R('menu_financial_rider_cash', 'Rider cash: view and record', 'Rider cash and stores', 'medium'),
  R('approve_rider_cash', 'Rider cash: approve hand-ins and fuel', 'Rider cash and stores', 'high', 'Confirms cash was counted'),
  R('menu_financial_settlements', 'Store settlements: view and create', 'Rider cash and stores', 'medium'),
  R('approve_settlements', 'Store settlements: approve and pay', 'Rider cash and stores', 'high', 'Money leaves to a store'),
  R('menu_financial_expenses', 'Expenses: view and record', 'Rider cash and stores', 'medium'),
  R('approve_expenses', 'Expenses: approve and pay', 'Rider cash and stores', 'high'),

  R('menu_financial_dashboard', 'Financial dashboard and general ledger', 'Accounts reports', 'high', 'Profit, cash and full books'),
  R('report_store_payments', 'Store Payments and Balances', 'Accounts reports', 'medium'),
  R('report_centre_accounts', 'Reports Centre: accounts', 'Accounts reports', 'high', 'Cash book, suspense, profit and expenses'),
  R('report_centre_control', 'Reports Centre: control', 'Accounts reports', 'high', 'Exceptions and change log'),

  R('report_centre_riders', 'Reports Centre: riders', 'Reports Centre', 'medium'),
  R('report_centre_stores', 'Reports Centre: stores', 'Reports Centre', 'medium'),
  R('report_centre_sales', 'Reports Centre: sales', 'Reports Centre', 'medium'),

  R('menu_report_orders', 'Order reports page', 'Report pages', 'medium'),
  R('menu_report_inventory', 'Inventory report page', 'Report pages', 'low'),
  R('menu_report_sales', 'Sale reports page', 'Report pages', 'medium'),
  R('menu_report_riders', 'Rider reports page', 'Report pages', 'medium'),
  R('menu_report_stores', 'Store reports page', 'Report pages', 'medium'),
  R('menu_report_store_payment_terms', 'Credit store reports page', 'Report pages', 'medium'),
  R('menu_report_financial', 'Financial reports page', 'Report pages', 'medium'),
  R('report_inventory', 'Inventory report data', 'Report pages', 'low'),
  R('report_sales', 'Sales report data', 'Report pages', 'medium', 'Also periodic sales and customer sales'),
  R('report_rider_performance', 'Rider performance data', 'Report pages', 'medium'),

  R('report_daily_summary', 'Daily summary', 'Generated reports', 'medium'),
  R('report_weekly_summary', 'Weekly summary', 'Generated reports', 'medium'),
  R('report_monthly_summary', 'Monthly summary', 'Generated reports', 'medium'),
  R('report_order_summary', 'Order, rider activity and profit reports', 'Generated reports', 'medium'),
  R('report_store_settlement', 'Store settlement and reconciliation reports', 'Generated reports', 'medium'),
  R('report_store_financials', 'Store financials', 'Generated reports', 'medium'),
  R('report_rider_cash', 'Rider cash, wallet and day closing reports', 'Generated reports', 'medium'),
  R('report_rider_fuel', 'Rider fuel and mileage reports', 'Generated reports', 'low'),
  R('report_delivery_charges', 'Delivery charges', 'Generated reports', 'medium'),
  R('report_expense', 'Expense report', 'Generated reports', 'medium'),
  R('report_general_voucher', 'General voucher report', 'Generated reports', 'medium'),
  R('report_transactions_summary', 'Transaction summary', 'Generated reports', 'medium'),
  R('report_comprehensive_cash', 'Comprehensive cash and discrepancy reports', 'Generated reports', 'high'),
  R('report_custom', 'Custom report', 'Generated reports', 'medium'),

  R('menu_settings_general', 'System settings', 'System', 'high', 'Delivery fees and app-wide settings'),
  R('menu_settings_problems', 'Problems and diagnostics', 'System', 'medium'),
  R('menu_settings_backup', 'Database backups', 'System', 'high', 'A backup holds all customer and financial data'),
  R('menu_settings_database', 'Database restore tools', 'System', 'high', 'Can overwrite the whole database'),
];

const MODULES = [...new Set(RIGHTS.map((r) => r.module))];
const KEYS = new Set(RIGHTS.map((r) => r.key));

// Never delegated, whatever a group holds. Listed so the screen can say so.
const ADMIN_ONLY = [
  'Manage user rights and groups',
  'Create, edit or deactivate users',
  'Create, edit or delete riders',
  'Add, edit or delete stores (store owners can edit their own)',
  'Adjust a wallet balance by hand',
  'Send push notifications and promotions',
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
    rights: ['menu_dashboard', 'menu_financial_cpv', 'menu_financial_bpv', 'menu_financial_crv', 'menu_financial_brv', 'menu_financial_jnv', 'menu_financial_rider_cash', 'menu_financial_settlements', 'menu_financial_expenses', 'approve_cpv', 'approve_bpv', 'approve_crv', 'approve_brv', 'approve_jnv', 'approve_rider_cash', 'approve_settlements', 'approve_expenses', 'menu_financial_dashboard', 'report_store_payments', 'report_centre_accounts', 'report_centre_control', 'report_centre_riders', 'report_centre_stores', 'report_centre_sales'] },
  { key: 'auditor', label: 'Auditor (read-only)', description: 'Sees reports and the books. Cannot change anything.',
    rights: ['menu_dashboard', 'menu_financial_dashboard', 'report_store_payments', 'report_centre_accounts', 'report_centre_control', 'report_centre_riders', 'report_centre_stores', 'report_centre_sales'] },
  { key: 'support', label: 'Customer support', description: 'Looks up orders and contacts customers.',
    rights: [...VIEW_ORDERS, 'menu_stores', 'menu_store_status'] },
];

const isRight = (key) => KEYS.has(key);
const unknownRights = (keys) => keys.filter((k) => !KEYS.has(k));
const highRisk = (keys) => RIGHTS.filter((r) => r.risk === 'high' && keys.includes(r.key));

module.exports = { RIGHTS, MODULES, ADMIN_ONLY, TEMPLATES, isRight, unknownRights, highRisk };
