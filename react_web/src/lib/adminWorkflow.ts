import type { LucideIcon } from "lucide-react";
import {
  Banknote,
  Boxes,
  ClipboardList,
  DatabaseBackup,
  FileBarChart,
  Landmark,
  Megaphone,
  PackageSearch,
  ReceiptText,
  Settings,
  ShieldCheck,
  Store,
  UsersRound,
  UserRoundCog,
  WalletCards,
  Wrench,
} from "lucide-react";

export type AdminModuleId =
  | "dashboard"
  | "orders"
  | "manual-orders"
  | "stores"
  | "store-status"
  | "accounts"
  | "riders"
  | "user-rights"
  | "products"
  | "catalog"
  | "payments-wallets"
  | "financial-dashboard"
  | "vouchers"
  | "settlements"
  | "expenses"
  | "reports"
  | "inventory-report"
  | "rider-reports"
  | "store-reports"
  | "store-payment-term-reports"
  | "settings"
  | "db-backup"
  | "problems";

export type AdminModule = {
  id: AdminModuleId;
  label: string;
  legacyTab: string;
  summary: string;
  workflow: string[];
};

export type AdminModuleGroup = {
  label: string;
  icon: LucideIcon;
  modules: AdminModule[];
};

export const adminWorkflowGroups: AdminModuleGroup[] = [
  {
    label: "Command",
    icon: ClipboardList,
    modules: [
      {
        id: "dashboard",
        label: "Dashboard",
        legacyTab: "dashboard",
        summary: "Operational and finance counters used as the admin landing view.",
        workflow: ["Load platform counts", "Show finance totals", "Jump into active work queues"],
      },
      {
        id: "orders",
        label: "Order Management",
        legacyTab: "orders",
        summary: "Order queue, status changes, rider assignment, customer/address edit, item edit, delivery fee edit.",
        workflow: ["Filter order queue", "Manage post-placement changes", "Recalculate totals and delivery fee"],
      },
      {
        id: "manual-orders",
        label: "Manual Orders",
        legacyTab: "manualOrderModal",
        summary: "Create counter/manual orders with customer/store/product creation support.",
        workflow: ["Select or create customer", "Select or create store", "Add products and delivery charge"],
      },
    ],
  },
  {
    label: "Partners",
    icon: Store,
    modules: [
      {
        id: "stores",
        label: "Stores",
        legacyTab: "stores",
        summary: "Store profile, owner, bank details, priority, payment term, grace days, discount policy.",
        workflow: ["Create and edit store", "Manage payment term", "Set priority and banking metadata"],
      },
      {
        id: "store-status",
        label: "Store Status",
        legacyTab: "store-status",
        summary: "Global delivery status, broadcast push, app update push, promotions, offers, flash messages.",
        workflow: ["Control delivery availability", "Send customer notifications", "Publish promotional surfaces"],
      },
    ],
  },
  {
    label: "People",
    icon: UsersRound,
    modules: [
      {
        id: "accounts",
        label: "Accounts",
        legacyTab: "accounts",
        summary: "Customer, admin, standard user, rider, and store-owner accounts.",
        workflow: ["Filter accounts", "Manage roles and linked stores", "Activate and verify users"],
      },
      {
        id: "riders",
        label: "Riders",
        legacyTab: "riders",
        summary: "Rider records, availability, active deliveries, completed deliveries, fuel entry.",
        workflow: ["Manage rider profile", "Track availability", "Review delivery and fuel queues"],
      },
      {
        id: "user-rights",
        label: "User Rights",
        legacyTab: "user-rights",
        summary: "Permission groups and assignment for standard users.",
        workflow: ["Create rights group", "Select menu permissions", "Assign users to groups"],
      },
    ],
  },
  {
    label: "Catalog",
    icon: PackageSearch,
    modules: [
      {
        id: "products",
        label: "Products",
        legacyTab: "products",
        summary: "Products, stock, variants, units, sizes, store payment-term pricing rules.",
        workflow: ["Select store payment term", "Calculate cost using discount/profit rules", "Maintain variants and stock"],
      },
      {
        id: "catalog",
        label: "Categories, Units, Sizes",
        legacyTab: "categories/units/sizes",
        summary: "Reference data for catalog grouping and product variants.",
        workflow: ["Manage categories", "Manage unit multipliers", "Manage size labels"],
      },
    ],
  },
  {
    label: "Payments",
    icon: WalletCards,
    modules: [
      {
        id: "payments-wallets",
        label: "Payments and Wallets",
        legacyTab: "payments/wallets",
        summary: "Payment list, payment stats, wallet balances, manual wallet adjustment.",
        workflow: ["Review payments", "Filter wallet balances", "Apply wallet credit/debit adjustments"],
      },
    ],
  },
  {
    label: "Financial",
    icon: Landmark,
    modules: [
      {
        id: "financial-dashboard",
        label: "Dashboard and Ledger",
        legacyTab: "financial-dashboard",
        summary: "Financial dashboard, cash ledger, transactions, store-wise summaries.",
        workflow: ["Review cash position", "Open ledger", "Trace transaction entries"],
      },
      {
        id: "vouchers",
        label: "Vouchers",
        legacyTab: "payment/receipt/bank/journal-vouchers",
        summary: "Payment, receipt, bank payment, bank receipt, and journal voucher flows.",
        workflow: ["Draft voucher", "Post or approve", "Download or review entries"],
      },
      {
        id: "settlements",
        label: "Settlements and Rider Cash",
        legacyTab: "store-settlements/rider-cash",
        summary: "Store settlement approval/payment and rider cash movement approval.",
        workflow: ["Load unsettled items", "Approve settlement", "Mark paid or approve rider cash"],
      },
      {
        id: "expenses",
        label: "Expenses",
        legacyTab: "expenses",
        summary: "Expense entry, approval, payment status, vendor and receipt tracking.",
        workflow: ["Record expense", "Approve expense", "Pay expense"],
      },
    ],
  },
  {
    label: "Reports",
    icon: FileBarChart,
    modules: [
      {
        id: "reports",
        label: "Financial Reports",
        legacyTab: "financial-reports/order-reports",
        summary: "Generated financial and order reports with PDF export.",
        workflow: ["Choose report type", "Apply date/store filters", "Preview, save, export"],
      },
      {
        id: "inventory-report",
        label: "Inventory and Sales",
        legacyTab: "inventory-report",
        summary: "Inventory, store sales, manual sales edit, product sales, cash/credit delivery reports.",
        workflow: ["Choose inventory report", "Review editable rows", "Export PDF"],
      },
      {
        id: "rider-reports",
        label: "Rider Reports",
        legacyTab: "rider-reports",
        summary: "Rider delivery and performance reports.",
        workflow: ["Select rider/date", "Generate performance view", "Export report"],
      },
      {
        id: "store-reports",
        label: "Store Reports",
        legacyTab: "store-reports",
        summary: "Store performance and payment balance reports.",
        workflow: ["Select store/date", "Generate store summary", "Export report"],
      },
      {
        id: "store-payment-term-reports",
        label: "Payment Term Reports",
        legacyTab: "store-payment-term-reports",
        summary: "Credit/cash store aging, grace period, and payment term reporting.",
        workflow: ["Load store terms", "Review grace state", "Track payment balances"],
      },
    ],
  },
  {
    label: "System",
    icon: Wrench,
    modules: [
      {
        id: "settings",
        label: "Settings",
        legacyTab: "settings",
        summary: "Delivery fee settings and operational configuration.",
        workflow: ["Load delivery fee config", "Update store-count fee rules", "Save settings"],
      },
      {
        id: "db-backup",
        label: "DB Backup",
        legacyTab: "db-backup",
        summary: "Create backup, refresh backups, restore confirmation, transactional cleanup tools.",
        workflow: ["Create backup", "Review backup list", "Restore or maintenance actions"],
      },
      {
        id: "problems",
        label: "Problems",
        legacyTab: "problems",
        summary: "Diagnostics and health checks.",
        workflow: ["Run diagnostics", "Run single diagnostic", "Inspect results"],
      },
    ],
  },
];

export const adminModules = adminWorkflowGroups.flatMap((group) => group.modules);

export function getAdminModule(id: string) {
  return adminModules.find((module) => module.id === id) || adminModules[0];
}
