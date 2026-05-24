import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Download,
  Clock3,
  Plus,
  RefreshCcw,
  Store as StoreIcon,
  UsersRound,
  UserRoundCog,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { WorkspaceTable } from "@/components/workspaces/WorkspaceTable";
import { apiFetch } from "@/lib/api";
import { adminModules, adminWorkflowGroups, getAdminModule, type AdminModuleId } from "@/lib/adminWorkflow";
import {
  calculateProductCost,
  isCashOnlyPaymentTerm,
  isDiscountPaymentTerm,
  isProfitPaymentTerm,
  roundProductAmount,
  toNumber,
} from "@/lib/productPricing";
import { formatCurrency } from "@/lib/utils";
import {
  addAdminOrderItem,
  fetchAdminOrderItems,
  recalculateAdminOrderDeliveryFee,
  removeAdminOrderItem,
  saveAdminOrderCustomer,
  saveAdminOrderDeliveryFee,
  type AdminOrderItem,
} from "@/services/adminOrders";
import {
  createPaymentVoucher,
  createReceiptVoucher,
  createRiderCashMovement,
  createStoreSettlement,
  updatePaymentVoucher,
  updateReceiptVoucher,
  updateRiderCashMovement,
  updateStoreSettlement,
} from "@/services/adminFinance";
import {
  checkBackupStatus,
  createBackup,
  downloadBackup,
  fetchDeliveryFeeSettings,
  listBackups,
  saveDeliveryFeeSettings,
  type BackupFile,
  type DeliveryFeeSettings,
} from "@/services/adminSystem";
import type { Category, Expense, FinancialDashboard, Order, Product, Rider, Store, User } from "@/lib/types";
import { useApiResource } from "@/hooks/useApiResource";

type AdminWorkspaceProps = {
  token: string;
  user: User;
};

type AdminData = {
  orders: Order[];
  stores: Store[];
  users: User[];
  products: Product[];
  riders: Rider[];
  categories: Category[];
  units: GenericRecord[];
  sizes: GenericRecord[];
  payments: GenericRecord[];
  wallets: GenericRecord[];
  cashLedger: GenericRecord[];
  transactions: GenericRecord[];
  paymentVouchers: GenericRecord[];
  receiptVouchers: GenericRecord[];
  journalVouchers: GenericRecord[];
  storeSettlements: GenericRecord[];
  riderCash: GenericRecord[];
  expenses: Expense[];
  reports: GenericRecord[];
  rightsGroups: GenericRecord[];
  rightsUsers: GenericRecord[];
  cashFlow: GenericRecord[];
  platformSummary: GenericRecord | null;
  topProducts: GenericRecord[];
  riderPerformance: GenericRecord[];
  storePerformance: GenericRecord[];
  financial: FinancialDashboard | null;
};

type GenericRecord = Record<string, unknown>;

async function optional<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch {
    return null;
  }
}

export function AdminWorkspace({ token, user }: AdminWorkspaceProps) {
  const [activeModule, setActiveModule] = useState<AdminModuleId>("dashboard");
  const [status, setStatus] = useState<string | null>(null);
  const [productEdit, setProductEdit] = useState<Product | null | "new">(null);
  const [storeEdit, setStoreEdit] = useState<Store | null | "new">(null);
  const [categoryEdit, setCategoryEdit] = useState<GenericRecord | null | "new">(null);
  const [unitEdit, setUnitEdit] = useState<GenericRecord | null | "new">(null);
  const [sizeEdit, setSizeEdit] = useState<GenericRecord | null | "new">(null);
  const [paymentVoucherEdit, setPaymentVoucherEdit] = useState<GenericRecord | null | "new">(null);
  const [receiptVoucherEdit, setReceiptVoucherEdit] = useState<GenericRecord | null | "new">(null);
  const [riderCashEdit, setRiderCashEdit] = useState<GenericRecord | null | "new">(null);
  const [settlementEdit, setSettlementEdit] = useState<GenericRecord | null | "new">(null);
  const [userEdit, setUserEdit] = useState<User | null | "new">(null);
  const [riderEdit, setRiderEdit] = useState<Rider | null | "new">(null);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [orderAction, setOrderAction] = useState<Order | null>(null);

  const adminData = useApiResource<AdminData>(async () => {
    const [
      orders,
      stores,
      users,
      products,
      riders,
      categories,
      units,
      sizes,
      payments,
      wallets,
      financial,
      cashLedger,
      transactions,
      paymentVouchers,
      receiptVouchers,
      journalVouchers,
      storeSettlements,
      riderCash,
      expenses,
      reports,
      rightsGroups,
      rightsUsers,
      cashFlow,
      platformSummary,
      topProducts,
      riderPerformance,
      storePerformance,
    ] = await Promise.all([
      optional(apiFetch<{ orders?: Order[] }>("/api/orders", { token })),
      optional(apiFetch<{ stores?: Store[] }>("/api/stores?admin=1", { token })),
      optional(apiFetch<{ users?: User[] }>("/api/users", { token })),
      optional(apiFetch<{ products?: Product[] }>("/api/products?admin=true&include_variants=0&include_image_variants=0", { token })),
      optional(apiFetch<{ riders?: Rider[] }>("/api/riders", { token })),
      optional(apiFetch<{ categories?: Category[] }>("/api/categories?includeInactive=true", { token })),
      optional(apiFetch<{ units?: GenericRecord[] }>("/api/units", { token })),
      optional(apiFetch<{ sizes?: GenericRecord[] }>("/api/sizes", { token })),
      optional(apiFetch<{ payments?: GenericRecord[] }>("/api/admin/payments?limit=50", { token })),
      optional(apiFetch<{ wallets?: GenericRecord[] }>("/api/admin/wallets?limit=50", { token })),
      optional(apiFetch<{ dashboard?: FinancialDashboard; stats?: FinancialDashboard }>("/api/financial/dashboard?period=all", { token })),
      optional(apiFetch<{ entries?: GenericRecord[]; ledger?: GenericRecord[]; transactions?: GenericRecord[] }>("/api/financial/cash-ledger", { token })),
      optional(apiFetch<{ transactions?: GenericRecord[] }>("/api/financial/transactions", { token })),
      optional(apiFetch<{ vouchers?: GenericRecord[]; paymentVouchers?: GenericRecord[] }>("/api/financial/payment-vouchers", { token })),
      optional(apiFetch<{ vouchers?: GenericRecord[]; receiptVouchers?: GenericRecord[] }>("/api/financial/receipt-vouchers", { token })),
      optional(apiFetch<{ vouchers?: GenericRecord[]; journalVouchers?: GenericRecord[] }>("/api/financial/journal-vouchers", { token })),
      optional(apiFetch<{ settlements?: GenericRecord[] }>("/api/financial/store-settlements", { token })),
      optional(apiFetch<{ movements?: GenericRecord[]; riderCash?: GenericRecord[] }>("/api/financial/rider-cash", { token })),
      optional(apiFetch<{ expenses?: Expense[] }>("/api/financial/expenses?limit=50", { token })),
      optional(apiFetch<{ reports?: GenericRecord[] }>("/api/financial/reports", { token })),
      optional(apiFetch<{ groups?: GenericRecord[] }>("/api/permissions/groups", { token })),
      optional(apiFetch<{ users?: GenericRecord[] }>("/api/permissions/users", { token })),
      optional(apiFetch<{ cashFlow?: GenericRecord[]; data?: GenericRecord[] }>("/api/financial/reports/cash-flow", { token })),
      optional(apiFetch<GenericRecord>("/api/financial/reports/platform-summary", { token })),
      optional(apiFetch<{ products?: GenericRecord[]; topProducts?: GenericRecord[] }>("/api/financial/reports/top-products", { token })),
      optional(apiFetch<{ riders?: GenericRecord[]; performance?: GenericRecord[] }>("/api/financial/reports/rider-performance", { token })),
      optional(apiFetch<{ stores?: GenericRecord[]; performance?: GenericRecord[] }>("/api/financial/reports/store-performance", { token })),
    ]);

    return {
      orders: orders?.orders || [],
      stores: stores?.stores || [],
      users: users?.users || [],
      products: products?.products || [],
      riders: riders?.riders || [],
      categories: categories?.categories || [],
      units: units?.units || [],
      sizes: sizes?.sizes || [],
      payments: payments?.payments || [],
      wallets: wallets?.wallets || [],
      cashLedger: cashLedger?.entries || cashLedger?.ledger || cashLedger?.transactions || [],
      transactions: transactions?.transactions || [],
      paymentVouchers: paymentVouchers?.vouchers || paymentVouchers?.paymentVouchers || [],
      receiptVouchers: receiptVouchers?.vouchers || receiptVouchers?.receiptVouchers || [],
      journalVouchers: journalVouchers?.vouchers || journalVouchers?.journalVouchers || [],
      storeSettlements: storeSettlements?.settlements || [],
      riderCash: riderCash?.movements || riderCash?.riderCash || [],
      expenses: expenses?.expenses || [],
      reports: reports?.reports || [],
      rightsGroups: rightsGroups?.groups || [],
      rightsUsers: rightsUsers?.users || [],
      cashFlow: cashFlow?.cashFlow || cashFlow?.data || [],
      platformSummary: platformSummary || null,
      topProducts: topProducts?.products || topProducts?.topProducts || [],
      riderPerformance: riderPerformance?.riders || riderPerformance?.performance || [],
      storePerformance: storePerformance?.stores || storePerformance?.performance || [],
      financial: normalizeFinancial(financial),
    };
  }, [token]);

  const data = adminData.data;
  const activeModuleConfig = getAdminModule(activeModule);
  const financialCards = useMemo(() => {
    const financial = data?.financial || {};
    return [
      { label: "Income", value: formatCurrency(financial.income) },
      { label: "Expense", value: formatCurrency(financial.expense) },
      { label: "Cash In Hand", value: formatCurrency(financial.cashInHand) },
      { label: "Store Balances", value: formatCurrency(financial.totalStoreBalances || financial.storeBalances) },
    ];
  }, [data?.financial]);
  const operations = useMemo(() => {
    const orders = data?.orders || [];
    const pendingOrders = orders.filter((order) => ["pending", "confirmed", "preparing", "ready", "ready_for_pickup"].includes(String(order.status || "").toLowerCase())).length;
    const deliveryOrders = orders.filter((order) => ["picked_up", "out_for_delivery"].includes(String(order.status || "").toLowerCase())).length;
    const unassignedOrders = orders.filter((order) => !order.rider_id && !["delivered", "cancelled"].includes(String(order.status || "").toLowerCase())).length;
    const closedStores = (data?.stores || []).filter((store) => Number(store.is_closed || 0) === 1).length;
    const inactiveRiders = (data?.riders || []).filter((rider) => Number(rider.is_active || 0) !== 1).length;
    return { pendingOrders, deliveryOrders, unassignedOrders, closedStores, inactiveRiders };
  }, [data?.orders, data?.riders, data?.stores]);

  async function runAction(action: () => Promise<unknown>, success: string) {
    setStatus(null);
    try {
      await action();
      setStatus(success);
      adminData.reload();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Action failed");
    }
  }

  return (
    <section className="admin-workspace grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 shadow-sm">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge variant="default">{user.user_type}</Badge>
            <Badge variant="outline">Legacy tab: {activeModuleConfig.legacyTab}</Badge>
          </div>
          <h1 className="text-2xl font-semibold tracking-normal">{activeModuleConfig.label}</h1>
          <p className="max-w-4xl text-sm text-muted-foreground">{activeModuleConfig.summary}</p>
        </div>
        <Button onClick={adminData.reload}>
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {status ? <div className="rounded-lg border bg-card p-3 text-sm">{status}</div> : null}
      {adminData.error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{adminData.error}</div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric icon={ClipboardList} label="Orders" value={data?.orders.length || 0} tone="primary" />
        <Metric icon={Clock3} label="Pending" value={operations.pendingOrders} tone="warning" />
        <Metric icon={AlertTriangle} label="Unassigned" value={operations.unassignedOrders} tone="danger" />
        <Metric icon={StoreIcon} label="Stores" value={data?.stores.length || 0} tone="neutral" />
        <Metric icon={Boxes} label="Products" value={data?.products.length || 0} tone="neutral" />
        <Metric icon={Banknote} label="Finance" value={data?.financial ? "Live" : "-"} tone="success" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[19rem_1fr]">
        <AdminMenu activeModule={activeModule} onSelect={setActiveModule} />
        <div className="min-w-0">
        <WorkflowStrip workflow={activeModuleConfig.workflow} />
        {activeModule === "dashboard" ? (
          <DashboardHome
            data={data}
            financialCards={financialCards}
            operations={operations}
            onSelect={setActiveModule}
          />
        ) : null}

        {activeModule === "products" ? (
          <div className="mb-3 flex justify-end">
            <Button onClick={() => setProductEdit("new")}><Plus className="h-4 w-4" /> Add Product</Button>
          </div>
        ) : null}
        {activeModule === "products" ? (
          <WorkspaceTable
            title="Products"
            description="Catalog records available to admin and staff users."
            rows={data?.products || []}
            columns={[
              { key: "id", label: "ID", render: (row) => row.id },
              { key: "name", label: "Name", render: (row) => row.name },
              { key: "store", label: "Store", render: (row) => row.store_name || row.store_id || "-" },
              { key: "category", label: "Category", render: (row) => row.category_name || "-" },
              { key: "price", label: "Price", render: (row) => formatCurrency(row.promotional_price || row.price) },
              { key: "actions", label: "Actions", render: (row) => <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setProductEdit(row)}>Edit</Button><Button size="sm" variant="destructive" onClick={() => runAction(() => apiFetch(`/api/products/${row.id}`, { method: "DELETE", token }), "Product deleted.")}>Delete</Button></div> },
            ]}
          />
        ) : null}

        {activeModule === "accounts" ? (
        <>
          <div className="mb-3 flex justify-end">
            <Button onClick={() => setUserEdit("new")}><Plus className="h-4 w-4" /> Add User</Button>
          </div>
          <WorkspaceTable
            title="Users"
            description="Customer, staff, admin, and store-owner accounts."
            rows={data?.users || []}
            columns={[
              { key: "id", label: "ID", render: (row) => row.id },
              { key: "name", label: "Name", render: (row) => `${row.first_name || ""} ${row.last_name || ""}`.trim() || "-" },
              { key: "email", label: "Email", render: (row) => row.email || "-" },
              { key: "role", label: "Role", render: (row) => <Badge variant="outline">{row.user_type || "-"}</Badge> },
              { key: "actions", label: "Actions", render: (row) => <Button size="sm" variant="outline" onClick={() => setUserEdit(row)}>Edit</Button> },
            ]}
          />
        </>
        ) : null}

        {activeModule === "riders" ? (
        <>
          <div className="mb-3 flex justify-end">
            <Button onClick={() => setRiderEdit("new")}><Plus className="h-4 w-4" /> Add Rider</Button>
          </div>
          <WorkspaceTable
            title="Riders"
            description="Delivery rider records and active status."
            rows={data?.riders || []}
            columns={[
              { key: "id", label: "ID", render: (row) => row.id },
              { key: "name", label: "Name", render: (row) => `${row.first_name || ""} ${row.last_name || ""}`.trim() || "-" },
              { key: "phone", label: "Phone", render: (row) => row.phone || "-" },
              { key: "vehicle", label: "Vehicle", render: (row) => row.vehicle_type || "-" },
              { key: "active", label: "Status", render: (row) => <Badge variant={Number(row.is_active) ? "default" : "muted"}>{Number(row.is_active) ? "Active" : "Inactive"}</Badge> },
              { key: "actions", label: "Actions", render: (row) => <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setRiderEdit(row)}>Edit</Button><Button size="sm" variant="destructive" onClick={() => runAction(() => apiFetch(`/api/riders/${row.id}`, { method: "DELETE", token }), "Rider deleted.")}>Delete</Button></div> },
            ]}
          />
        </>
        ) : null}

        {activeModule === "stores" ? (
          <WorkspaceTable
            title="Stores"
            description="Store partners, locations, and operating state."
            rows={data?.stores || []}
            actions={<Button onClick={() => setStoreEdit("new")}><Plus className="h-4 w-4" /> Add Store</Button>}
            columns={[
              { key: "id", label: "ID", render: (row) => row.id },
              { key: "name", label: "Name", render: (row) => row.name },
              { key: "term", label: "Payment Term", render: (row) => <Badge variant="outline">{row.payment_term || "-"}</Badge> },
              { key: "address", label: "Address", render: (row) => row.location || row.address || "-" },
              { key: "phone", label: "Phone", render: (row) => row.phone || "-" },
              { key: "active", label: "Status", render: (row) => <Badge variant={Number(row.is_closed) ? "muted" : "default"}>{Number(row.is_closed) ? "Closed" : "Open"}</Badge> },
              { key: "actions", label: "Actions", render: (row) => <Button size="sm" variant="outline" onClick={() => setStoreEdit(row)}>Edit Store</Button> },
            ]}
          />
        ) : null}

        {activeModule === "orders" ? (
          <WorkspaceTable
            title="Orders"
            description="Recent platform orders from the existing order module."
            rows={data?.orders || []}
            columns={[
              { key: "id", label: "ID", render: (row) => row.order_number || row.id },
              { key: "customer", label: "Customer", render: (row) => row.customer_name || "-" },
              { key: "status", label: "Status", render: (row) => <Badge variant="outline">{row.status || "-"}</Badge> },
              { key: "rider", label: "Rider", render: (row) => row.rider_name || row.rider_id || "Unassigned" },
              { key: "total", label: "Total", render: (row) => formatCurrency(row.total_amount) },
              { key: "created", label: "Created", render: (row) => row.created_at ? new Date(row.created_at).toLocaleString() : "-" },
              { key: "actions", label: "Actions", render: (row) => <Button size="sm" variant="outline" onClick={() => setOrderAction(row)}>Manage</Button> },
            ]}
          />
        ) : null}

        {activeModule === "catalog" ? (
          <div className="grid gap-4 xl:grid-cols-3">
            <SimpleResource
              title="Categories"
              description="Product categories."
              rows={data?.categories || []}
              preferred={["id", "name", "description", "is_active"]}
              actions={<Button onClick={() => setCategoryEdit("new")}><Plus className="h-4 w-4" /> Add Category</Button>}
              rowAction={(row) => <Button size="sm" variant="outline" onClick={() => setCategoryEdit(row)}>Edit</Button>}
            />
            <SimpleResource
              title="Units"
              description="Product unit setup."
              rows={data?.units || []}
              preferred={["id", "name", "abbreviation", "multiplier"]}
              actions={<Button onClick={() => setUnitEdit("new")}><Plus className="h-4 w-4" /> Add Unit</Button>}
              rowAction={(row) => <Button size="sm" variant="outline" onClick={() => setUnitEdit(row)}>Edit</Button>}
            />
            <SimpleResource
              title="Sizes"
              description="Product size setup."
              rows={data?.sizes || []}
              preferred={["id", "label", "name", "description"]}
              actions={<Button onClick={() => setSizeEdit("new")}><Plus className="h-4 w-4" /> Add Size</Button>}
              rowAction={(row) => <Button size="sm" variant="outline" onClick={() => setSizeEdit(row)}>Edit</Button>}
            />
          </div>
        ) : null}

        {activeModule === "payments-wallets" ? (
          <div className="grid gap-4">
            <SimpleResource title="Payments" description="Old payments admin tab via `/api/admin/payments`." rows={data?.payments || []} preferred={["id", "order_id", "amount", "payment_method", "status", "created_at"]} />
            <SimpleResource title="Wallets" description="Old wallets admin tab via `/api/admin/wallets`." rows={data?.wallets || []} preferred={["id", "email", "first_name", "last_name", "balance", "user_type"]} />
          </div>
        ) : null}

        {activeModule === "financial-dashboard" ? (
        <>
          <div className="mb-3 flex justify-end">
            <Button onClick={() => setExpenseOpen(true)}><Plus className="h-4 w-4" /> Add Expense</Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {financialCards.map((item) => (
              <Card key={item.label}>
                <CardHeader>
                  <CardDescription>{item.label}</CardDescription>
                  <CardTitle>{item.value}</CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>
          <div className="mt-4">
            <div className="mb-4 grid gap-4 xl:grid-cols-2">
              <SimpleResource title="Cash Ledger" description="Cash ledger module." rows={data?.cashLedger || []} preferred={["id", "transaction_date", "description", "amount", "balance", "created_at"]} />
              <SimpleResource title="Transactions" description="Financial transactions module." rows={data?.transactions || []} preferred={["id", "transaction_type", "category", "amount", "payment_method", "status"]} />
            </div>
            <WorkspaceTable
              title="Expenses"
              description="Recent admin expenses with status."
              rows={data?.expenses || []}
              columns={[
                { key: "number", label: "Number", render: (row) => row.expense_number || row.id },
                { key: "category", label: "Category", render: (row) => row.category || "-" },
                { key: "amount", label: "Amount", render: (row) => formatCurrency(row.amount) },
                { key: "method", label: "Method", render: (row) => row.payment_method || "-" },
                { key: "status", label: "Status", render: (row) => <Badge variant="outline">{row.status || "-"}</Badge> },
              ]}
            />
          </div>
        </>
        ) : null}

        {activeModule === "vouchers" ? (
          <div className="grid gap-4">
            <SimpleResource title="Payment Vouchers" description="Cash/bank payment vouchers." rows={data?.paymentVouchers || []} preferred={["id", "voucher_number", "payee_name", "payee_type", "amount", "payment_method", "status"]} actions={<Button onClick={() => setPaymentVoucherEdit("new")}><Plus className="h-4 w-4" /> Add Payment Voucher</Button>} rowAction={(row) => <Button size="sm" variant="outline" onClick={() => setPaymentVoucherEdit(row)}>Edit</Button>} />
            <SimpleResource title="Receipt Vouchers" description="Cash/bank receipt vouchers." rows={data?.receiptVouchers || []} preferred={["id", "voucher_number", "payer_name", "payer_type", "amount", "payment_method", "status"]} actions={<Button onClick={() => setReceiptVoucherEdit("new")}><Plus className="h-4 w-4" /> Add Receipt Voucher</Button>} rowAction={(row) => <Button size="sm" variant="outline" onClick={() => setReceiptVoucherEdit(row)}>Edit</Button>} />
            <SimpleResource title="Journal Vouchers" description="General voucher and journal flow." rows={data?.journalVouchers || []} preferred={["id", "voucher_number", "voucher_date", "description", "status"]} />
            <SimpleResource title="Store Settlements" description="Store settlement module." rows={data?.storeSettlements || []} preferred={["id", "settlement_number", "store_name", "net_amount", "status"]} actions={<Button onClick={() => setSettlementEdit("new")}><Plus className="h-4 w-4" /> Add Settlement</Button>} rowAction={(row) => <Button size="sm" variant="outline" onClick={() => setSettlementEdit(row)}>Edit</Button>} />
            <SimpleResource title="Rider Cash" description="Rider cash movement module." rows={data?.riderCash || []} preferred={["id", "movement_number", "rider_name", "movement_type", "amount", "status"]} actions={<Button onClick={() => setRiderCashEdit("new")}><Plus className="h-4 w-4" /> Add Rider Cash</Button>} rowAction={(row) => <Button size="sm" variant="outline" onClick={() => setRiderCashEdit(row)}>Edit</Button>} />
          </div>
        ) : null}

        {activeModule === "reports" ? (
          <div className="grid gap-4">
            <SimpleResource title="Generated Financial Reports" description="Financial report records." rows={data?.reports || []} preferred={["id", "report_type", "period_start", "period_end", "created_at"]} />
            <SimpleResource title="Cash Flow" description="Cash flow report endpoint." rows={data?.cashFlow || []} preferred={["date", "income", "expense", "cash_in", "cash_out", "balance"]} />
            <SimpleResource title="Top Products" description="Top product performance report." rows={data?.topProducts || []} preferred={["product_name", "store_name", "quantity", "revenue", "profit"]} />
            <SimpleResource title="Rider Performance" description="Rider performance report." rows={data?.riderPerformance || []} preferred={["rider_name", "orders", "delivery_fee", "cash_collection"]} />
            <SimpleResource title="Store Performance" description="Store performance report." rows={data?.storePerformance || []} preferred={["store_name", "orders", "sales", "settlements", "balance"]} />
            <Card>
              <CardHeader>
                <CardTitle>Platform Summary</CardTitle>
                <CardDescription>Platform summary report endpoint.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                {Object.entries(data?.platformSummary || {}).slice(0, 20).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-3 border-b py-1"><span className="text-muted-foreground">{key}</span><strong>{String(value ?? "-")}</strong></div>
                ))}
              </CardContent>
            </Card>
          </div>
        ) : null}

        {activeModule === "user-rights" ? (
          <div className="grid gap-4 xl:grid-cols-2">
            <SimpleResource title="Permission Groups" description="Old User Rights group module." rows={data?.rightsGroups || []} preferred={["id", "name", "description", "is_active"]} />
            <SimpleResource title="Permission Users" description="Standard users and assigned groups." rows={data?.rightsUsers || []} preferred={["id", "first_name", "last_name", "email", "group_name"]} />
          </div>
        ) : null}

        {activeModule === "store-status" ? (
          <WorkflowModuleCard title="Store Status Delivery" description="Global delivery status, block ordering, customer messaging, broadcast push, app update push, live promotions, offer campaigns, and flash messages from the old Store Status tab." />
        ) : null}

        {activeModule === "manual-orders" ? (
          <WorkflowModuleCard title="Manual Order Desk" description="The old workflow creates or selects customer/store, loads manual-products, accepts item lines, and applies delivery charges before submitting the manual order." />
        ) : null}

        {activeModule === "settlements" ? (
          <div className="grid gap-4">
            <SimpleResource title="Store Settlements" description="Store settlement approval and payment queue." rows={data?.storeSettlements || []} preferred={["id", "settlement_number", "store_name", "net_amount", "status"]} actions={<Button onClick={() => setSettlementEdit("new")}><Plus className="h-4 w-4" /> Add Settlement</Button>} rowAction={(row) => <Button size="sm" variant="outline" onClick={() => setSettlementEdit(row)}>Edit</Button>} />
            <SimpleResource title="Rider Cash" description="Rider cash movement approval queue." rows={data?.riderCash || []} preferred={["id", "movement_number", "rider_name", "movement_type", "amount", "status"]} actions={<Button onClick={() => setRiderCashEdit("new")}><Plus className="h-4 w-4" /> Add Rider Cash</Button>} rowAction={(row) => <Button size="sm" variant="outline" onClick={() => setRiderCashEdit(row)}>Edit</Button>} />
          </div>
        ) : null}

        {activeModule === "expenses" ? (
          <WorkspaceTable
            title="Expenses"
            description="Expense entry, approval, and payment status from the old financial module."
            rows={data?.expenses || []}
            actions={<Button onClick={() => setExpenseOpen(true)}><Plus className="h-4 w-4" /> Add Expense</Button>}
            columns={[
              { key: "number", label: "Number", render: (row) => row.expense_number || row.id },
              { key: "category", label: "Category", render: (row) => row.category || "-" },
              { key: "amount", label: "Amount", render: (row) => formatCurrency(row.amount) },
              { key: "method", label: "Method", render: (row) => row.payment_method || "-" },
              { key: "status", label: "Status", render: (row) => <Badge variant="outline">{row.status || "-"}</Badge> },
            ]}
          />
        ) : null}

        {activeModule === "inventory-report" ? (
          <WorkflowModuleCard title="Inventory and Cash/Credit Sales Reports" description="Old reports include inventory, store sales, manual order sales, store product sales, combined product sales, sales with delivery, and cash/credit sales with delivery by type." />
        ) : null}

        {activeModule === "rider-reports" ? (
          <SimpleResource title="Rider Performance" description="Rider reporting endpoint mapped from the old rider reports tab." rows={data?.riderPerformance || []} preferred={["rider_name", "orders", "delivery_fee", "cash_collection"]} />
        ) : null}

        {activeModule === "store-reports" ? (
          <SimpleResource title="Store Performance" description="Store reporting endpoint mapped from the old store reports tab." rows={data?.storePerformance || []} preferred={["store_name", "orders", "sales", "settlements", "balance"]} />
        ) : null}

        {activeModule === "store-payment-term-reports" ? (
          <WorkflowModuleCard title="Store Payment Term Reports" description="Tracks payment terms, credit/cash status, grace period aging, outstanding store balances, and payment-term summaries from the old financial reports." />
        ) : null}

        {activeModule === "settings" ? (
          <DeliverySettingsPanel token={token} />
        ) : null}

        {activeModule === "db-backup" ? (
          <BackupPanel token={token} />
        ) : null}

        {activeModule === "problems" ? (
          <WorkflowModuleCard title="Problems and Diagnostics" description="Run diagnostics and inspect problem reports from the old Problems tab." />
        ) : null}
        </div>
      </div>

      <ProductDialog open={productEdit !== null} product={productEdit} stores={data?.stores || []} categories={data?.categories || []} onOpenChange={(open) => !open && setProductEdit(null)} onSave={(payload, id) => runAction(() => apiFetch(id ? `/api/products/${id}` : "/api/products", { method: id ? "PUT" : "POST", token, body: JSON.stringify(payload) }), id ? "Product updated." : "Product created.")} />
      <StoreDialog open={storeEdit !== null} store={storeEdit} onOpenChange={(open) => !open && setStoreEdit(null)} onSave={(payload, id) => runAction(() => apiFetch(id ? `/api/stores/${id}` : "/api/stores", { method: id ? "PUT" : "POST", token, body: JSON.stringify(payload) }), id ? "Store updated." : "Store created.")} />
      <CategoryDialog open={categoryEdit !== null} category={categoryEdit} onOpenChange={(open) => !open && setCategoryEdit(null)} onSave={(payload, id) => runAction(() => apiFetch(id ? `/api/categories/${id}` : "/api/categories", { method: id ? "PUT" : "POST", token, body: JSON.stringify(payload) }), id ? "Category updated." : "Category created.")} />
      <UnitDialog open={unitEdit !== null} unit={unitEdit} onOpenChange={(open) => !open && setUnitEdit(null)} onSave={(payload, id) => runAction(() => apiFetch(id ? `/api/units/${id}` : "/api/units", { method: id ? "PUT" : "POST", token, body: JSON.stringify(payload) }), id ? "Unit updated." : "Unit created.")} />
      <SizeDialog open={sizeEdit !== null} size={sizeEdit} onOpenChange={(open) => !open && setSizeEdit(null)} onSave={(payload, id) => runAction(() => apiFetch(id ? `/api/sizes/${id}` : "/api/sizes", { method: id ? "PUT" : "POST", token, body: JSON.stringify(payload) }), id ? "Size updated." : "Size created.")} />
      <PaymentVoucherDialog open={paymentVoucherEdit !== null} voucher={paymentVoucherEdit} onOpenChange={(open) => !open && setPaymentVoucherEdit(null)} onSave={(payload, id) => runAction(() => id ? updatePaymentVoucher(token, id, payload) : createPaymentVoucher(token, payload), id ? "Payment voucher updated." : "Payment voucher created.")} />
      <ReceiptVoucherDialog open={receiptVoucherEdit !== null} voucher={receiptVoucherEdit} onOpenChange={(open) => !open && setReceiptVoucherEdit(null)} onSave={(payload, id) => runAction(() => id ? updateReceiptVoucher(token, id, payload) : createReceiptVoucher(token, payload), id ? "Receipt voucher updated." : "Receipt voucher created.")} />
      <RiderCashDialog open={riderCashEdit !== null} movement={riderCashEdit} riders={data?.riders || []} onOpenChange={(open) => !open && setRiderCashEdit(null)} onSave={(payload, id) => runAction(() => id ? updateRiderCashMovement(token, id, payload) : createRiderCashMovement(token, payload), id ? "Rider cash updated." : "Rider cash created.")} />
      <StoreSettlementDialog open={settlementEdit !== null} settlement={settlementEdit} stores={data?.stores || []} onOpenChange={(open) => !open && setSettlementEdit(null)} onSave={(payload, id) => runAction(() => id ? updateStoreSettlement(token, id, payload) : createStoreSettlement(token, payload), id ? "Settlement updated." : "Settlement created.")} />
      <UserDialog open={userEdit !== null} user={userEdit} stores={data?.stores || []} onOpenChange={(open) => !open && setUserEdit(null)} onSave={(payload, id) => runAction(() => apiFetch(id ? `/api/users/${id}` : "/api/users", { method: id ? "PUT" : "POST", token, body: JSON.stringify(payload) }), id ? "User updated." : "User created.")} />
      <RiderDialog open={riderEdit !== null} rider={riderEdit} onOpenChange={(open) => !open && setRiderEdit(null)} onSave={(payload, id) => runAction(() => apiFetch(id ? `/api/riders/${id}` : "/api/riders", { method: id ? "PUT" : "POST", token, body: JSON.stringify(payload) }), id ? "Rider updated." : "Rider created.")} />
      <OrderActionDialog open={orderAction !== null} order={orderAction} token={token} users={data?.users || []} products={data?.products || []} riders={data?.riders || []} onOpenChange={(open) => !open && setOrderAction(null)} onStatus={(orderId, nextStatus) => runAction(() => apiFetch(`/api/orders/${orderId}/status`, { method: "PUT", token, body: JSON.stringify({ status: nextStatus }) }), "Order status updated.")} onAssign={(orderId, riderId, deliveryFee) => runAction(() => apiFetch(`/api/orders/${orderId}/assign-rider`, { method: "PUT", token, body: JSON.stringify({ rider_id: riderId, delivery_fee: deliveryFee }) }), "Rider assigned.")} onChanged={adminData.reload} />
      <ExpenseDialog open={expenseOpen} onOpenChange={setExpenseOpen} onSave={(payload) => runAction(() => apiFetch("/api/financial/expenses", { method: "POST", token, body: JSON.stringify(payload) }), "Expense recorded.")} />
    </section>
  );
}

function normalizeFinancial(
  financial: { dashboard?: FinancialDashboard; stats?: FinancialDashboard } | FinancialDashboard | null,
): FinancialDashboard | null {
  if (!financial) return null;
  if ("dashboard" in financial || "stats" in financial) {
    return financial.dashboard || financial.stats || null;
  }
  return financial as FinancialDashboard;
}

function AdminMenu({
  activeModule,
  onSelect,
}: {
  activeModule: AdminModuleId;
  onSelect: (module: AdminModuleId) => void;
}) {
  return (
    <aside className="h-fit overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="border-b p-4">
        <p className="text-sm font-semibold">ServeNow Admin</p>
        <p className="text-xs text-muted-foreground">Workflow menu from old web app</p>
      </div>
      <nav className="grid gap-1 p-2">
        {adminWorkflowGroups.map((group) => {
          const Icon = group.icon;
          return (
            <div key={group.label} className="py-1">
              <div className="flex items-center gap-2 px-2 py-2 text-xs font-semibold uppercase text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
                {group.label}
              </div>
              <div className="grid gap-1">
                {group.modules.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelect(item.id)}
                    className={[
                      "flex min-h-9 w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                      activeModule === item.id
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    ].join(" ")}
                  >
                    <span className="truncate">{item.label}</span>
                    <span className="text-[10px] opacity-70">{item.legacyTab}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function DashboardHome({
  data,
  financialCards,
  operations,
  onSelect,
}: {
  data?: AdminData | null;
  financialCards: Array<{ label: string; value: string }>;
  operations: {
    pendingOrders: number;
    deliveryOrders: number;
    unassignedOrders: number;
    closedStores: number;
    inactiveRiders: number;
  };
  onSelect: (module: AdminModuleId) => void;
}) {
  const highValueModules: AdminModuleId[] = ["orders", "products", "stores", "financial-dashboard", "reports", "store-status"];
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Operations Command Center</CardTitle>
                <CardDescription>Live queues and actions that usually need admin attention first.</CardDescription>
              </div>
              <Badge variant="outline">Today</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 p-4 md:grid-cols-2">
            <QueueButton icon={Clock3} label="Pending Orders" value={operations.pendingOrders} onClick={() => onSelect("orders")} />
            <QueueButton icon={Activity} label="In Delivery" value={operations.deliveryOrders} onClick={() => onSelect("orders")} />
            <QueueButton icon={AlertTriangle} label="Need Rider" value={operations.unassignedOrders} onClick={() => onSelect("orders")} tone="danger" />
            <QueueButton icon={StoreIcon} label="Closed Stores" value={operations.closedStores} onClick={() => onSelect("store-status")} />
            <QueueButton icon={UserRoundCog} label="Inactive Riders" value={operations.inactiveRiders} onClick={() => onSelect("riders")} />
            <QueueButton icon={CheckCircle2} label="Finance Status" value={data?.financial ? "Loaded" : "Missing"} onClick={() => onSelect("financial-dashboard")} tone="success" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle>Financial Position</CardTitle>
            <CardDescription>Core finance signals from the existing API.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 p-4">
            {financialCards.map((item) => (
              <div key={item.label} className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2">
                <span className="text-sm text-muted-foreground">{item.label}</span>
                <span className="text-sm font-semibold">{item.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Workflow Launchpad</CardTitle>
          <CardDescription>Modern React entry points grouped from the old admin workflow.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {highValueModules.map((moduleId) => {
            const module = getAdminModule(moduleId);
            return (
              <button
                key={module.id}
                type="button"
                onClick={() => onSelect(module.id)}
                className="group rounded-lg border bg-background p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/30"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{module.label}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{module.summary}</p>
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {module.workflow.map((step) => (
                    <Badge key={step} variant="muted">{step}</Badge>
                  ))}
                </div>
              </button>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>All Admin Modules</CardTitle>
          <CardDescription>Complete module map available for the React rewrite.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-4">
          {adminModules.map((module) => (
            <button
              key={module.id}
              type="button"
              onClick={() => onSelect(module.id)}
              className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-left text-sm hover:bg-muted/40"
            >
              <span className="truncate">{module.label}</span>
              <span className="text-[10px] text-muted-foreground">{module.legacyTab}</span>
            </button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function QueueButton({
  icon: Icon,
  label,
  value,
  tone = "neutral",
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  tone?: "neutral" | "danger" | "success";
  onClick: () => void;
}) {
  const toneClass = {
    neutral: "bg-muted text-foreground",
    danger: "bg-destructive/10 text-destructive",
    success: "bg-primary/10 text-primary",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3 text-left transition-colors hover:bg-muted/35"
    >
      <span className="flex items-center gap-3">
        <span className={`flex h-9 w-9 items-center justify-center rounded-md ${toneClass}`}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </span>
      <span className="text-lg font-semibold">{value}</span>
    </button>
  );
}

function WorkflowStrip({ workflow }: { workflow: string[] }) {
  return (
    <div className="mb-4 grid gap-2 rounded-lg border bg-card p-3 shadow-sm md:grid-cols-3">
      {workflow.map((step, index) => (
        <div key={step} className="flex items-center gap-3 rounded-md bg-muted/35 px-3 py-2 text-sm">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
            {index + 1}
          </span>
          <span className="min-w-0">{step}</span>
        </div>
      ))}
    </div>
  );
}

function SimpleResource({
  title,
  description,
  rows,
  preferred,
  actions,
  rowAction,
}: {
  title: string;
  description: string;
  rows: GenericRecord[];
  preferred: string[];
  actions?: React.ReactNode;
  rowAction?: (row: GenericRecord) => React.ReactNode;
}) {
  const columns = buildColumns(rows, preferred);
  const tableColumns: Array<{ key: string; label: string; render: (row: GenericRecord) => React.ReactNode }> = columns.map((key) => ({
    key,
    label: humanizeKey(key),
    render: (row: GenericRecord) => formatCell(row[key]),
  }));
  if (rowAction) {
    tableColumns.push({
      key: "actions",
      label: "Actions",
      render: rowAction,
    });
  }
  return (
    <WorkspaceTable
      title={title}
      description={description}
      rows={rows}
      actions={actions}
      columns={tableColumns}
    />
  );
}

function WorkflowModuleCard({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Badge variant="outline">Workflow mapped from legacy web</Badge>
      </CardContent>
    </Card>
  );
}

function DeliverySettingsPanel({ token }: { token: string }) {
  const [settings, setSettings] = useState<DeliveryFeeSettings>({});
  const [status, setStatus] = useState<string | null>(null);

  async function load() {
    setStatus("Loading delivery fee settings...");
    try {
      const result = await fetchDeliveryFeeSettings(token);
      setSettings({
        base_fee: result.base_fee ?? "",
        additional_per_store: result.additional_per_store ?? "",
      });
      setStatus(null);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Unable to load delivery settings");
    }
  }

  useEffect(() => {
    load();
  }, [token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);
    const form = new FormData(event.currentTarget);
    try {
      const result = await saveDeliveryFeeSettings(token, {
        base_fee: Number(form.get("base_fee")),
        additional_per_store: Number(form.get("additional_per_store")),
      });
      setSettings(result);
      setStatus(result.message || "Delivery fee settings saved.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Unable to save delivery settings");
    }
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Delivery Charge Settings</CardTitle>
            <CardDescription>Controls automatic delivery fee calculation when orders contain one or more stores.</CardDescription>
          </div>
          <Button variant="outline" onClick={load}><RefreshCcw className="h-4 w-4" /> Reload</Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 p-4">
        {status ? <div className="rounded-md border bg-muted/35 p-3 text-sm">{status}</div> : null}
        <form className="grid gap-3 md:grid-cols-[1fr_1fr_auto]" onSubmit={submit}>
          <Input name="base_fee" defaultValue={settings.base_fee || ""} type="number" min="0" step="0.01" placeholder="Base delivery fee" required />
          <Input name="additional_per_store" defaultValue={settings.additional_per_store || ""} type="number" min="0" step="0.01" placeholder="Additional per store" required />
          <Button type="submit">Save Charges</Button>
        </form>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border bg-muted/20 p-4">
            <p className="text-sm font-semibold">Single Store Order</p>
            <p className="mt-2 text-2xl font-semibold">{formatCurrency(settings.base_fee)}</p>
          </div>
          <div className="rounded-lg border bg-muted/20 p-4">
            <p className="text-sm font-semibold">Each Extra Store</p>
            <p className="mt-2 text-2xl font-semibold">{formatCurrency(settings.additional_per_store)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function BackupPanel({ token }: { token: string }) {
  const [filename, setFilename] = useState(`servenow-backup-${new Date().toISOString().slice(0, 10)}`);
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<Record<string, unknown> | null>(null);

  async function load() {
    setStatus("Loading backups...");
    try {
      const result = await listBackups(token);
      setBackups(result.backups || []);
      setStatus(null);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Unable to load backups");
    }
  }

  useEffect(() => {
    load();
  }, [token]);

  async function create() {
    if (!filename.trim()) {
      setStatus("Backup filename is required.");
      return;
    }
    setStatus("Creating backup...");
    try {
      const result = await createBackup(token, filename);
      setStatus(result.filename ? `Created ${result.filename}` : "Backup created.");
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Unable to create backup");
    }
  }

  async function check() {
    setStatus("Checking backup prerequisites...");
    try {
      const result = await checkBackupStatus(token);
      setCheckResult(result);
      setStatus("Backup check complete.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Unable to check backup status");
    }
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Database Backup</CardTitle>
          <CardDescription>Create and download SQL backups using the existing admin backup endpoints.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 p-4">
          {status ? <div className="rounded-md border bg-muted/35 p-3 text-sm">{status}</div> : null}
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <Input value={filename} onChange={(event) => setFilename(event.target.value)} placeholder="Backup file name" />
            <Button onClick={create}>Create Backup</Button>
            <Button variant="outline" onClick={load}><RefreshCcw className="h-4 w-4" /> Refresh</Button>
          </div>
          <div className="flex justify-end">
            <Button variant="outline" onClick={check}>Run Backup Check</Button>
          </div>
          {checkResult ? (
            <pre className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-3 text-xs">{JSON.stringify(checkResult, null, 2)}</pre>
          ) : null}
        </CardContent>
      </Card>
      <WorkspaceTable
        title="Available Backups"
        description="Files returned by `/api/admin/backup-db/list`."
        rows={backups}
        columns={[
          { key: "filename", label: "Filename", render: (row) => row.filename },
          { key: "size", label: "Size", render: (row) => humanFileSize(row.size || 0) },
          { key: "mtime", label: "Modified", render: (row) => row.mtime ? new Date(row.mtime).toLocaleString() : "-" },
          {
            key: "actions",
            label: "Actions",
            render: (row) => (
              <Button size="sm" variant="outline" onClick={() => downloadBackup(token, row.filename).catch((err) => setStatus(err instanceof Error ? err.message : "Download failed"))}>
                <Download className="h-4 w-4" />
                Download
              </Button>
            ),
          },
        ]}
      />
    </div>
  );
}

function humanFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function buildColumns(rows: GenericRecord[], preferred: string[]) {
  const first = rows[0] || {};
  const available = new Set(Object.keys(first));
  const preferredAvailable = preferred.filter((key) => available.has(key));
  const fallback = Object.keys(first).filter((key) => !preferredAvailable.includes(key)).slice(0, Math.max(0, 6 - preferredAvailable.length));
  return [...preferredAvailable, ...fallback].slice(0, 6);
}

function humanizeKey(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatCell(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function ProductDialog({
  open,
  product,
  stores,
  categories,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  product: Product | "new" | null;
  stores: Store[];
  categories: Category[];
  onOpenChange: (open: boolean) => void;
  onSave: (payload: Record<string, unknown>, id?: number) => void;
}) {
  const current = product === "new" ? null : product;
  const [storeId, setStoreId] = useState(current?.store_id ? String(current.store_id) : "");
  const [price, setPrice] = useState(String(current?.price || ""));
  const [manualCost, setManualCost] = useState(Boolean(Number(current?.manual_cost_override || 0)));
  const [costPrice, setCostPrice] = useState(String(current?.cost_price || ""));
  const [discountType, setDiscountType] = useState(String(current?.discount_type || "amount"));
  const [discountValue, setDiscountValue] = useState(String(current?.discount_value || ""));
  const [profitType, setProfitType] = useState(String(current?.profit_type || "amount"));
  const [profitValue, setProfitValue] = useState(String(current?.profit_value || ""));
  const [manualVariantCost, setManualVariantCost] = useState(Boolean(Number(current?.manual_variant_cost_override || 0)));

  useEffect(() => {
    if (!open) return;
    setStoreId(current?.store_id ? String(current.store_id) : "");
    setPrice(String(current?.price || ""));
    setManualCost(Boolean(Number(current?.manual_cost_override || 0)));
    setCostPrice(String(current?.cost_price || ""));
    setDiscountType(String(current?.discount_type || "amount"));
    setDiscountValue(String(current?.discount_value || ""));
    setProfitType(String(current?.profit_type || "amount"));
    setProfitValue(String(current?.profit_value || ""));
    setManualVariantCost(Boolean(Number(current?.manual_variant_cost_override || 0)));
  }, [current, open]);

  const selectedStore = stores.find((store) => String(store.id) === storeId);
  const storeDiscountEnabled = Boolean(selectedStore && isDiscountPaymentTerm(selectedStore.payment_term) && Number(selectedStore.store_discount_apply_all_products || 0) === 1);
  const calculatedCost = calculateProductCost({
    price: toNumber(price),
    store: selectedStore,
    discountType: storeDiscountEnabled ? "percent" : discountType,
    discountValue: storeDiscountEnabled ? toNumber(selectedStore?.store_discount_percent) : toNumber(discountValue),
    profitType,
    profitValue: toNumber(profitValue),
  });
  const effectivePrice = selectedStore && isCashOnlyPaymentTerm(selectedStore.payment_term) && profitType === "percent" && !manualCost
    ? roundProductAmount(toNumber(price))
    : toNumber(price);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const isDiscountStore = isDiscountPaymentTerm(selectedStore?.payment_term);
    const isProfitStore = isProfitPaymentTerm(selectedStore?.payment_term);
    onSave({
      name: form.get("name"),
      store_id: Number(storeId),
      category_id: form.get("category_id") ? Number(form.get("category_id")) : null,
      price: effectivePrice,
      cost_price: manualCost ? toNumber(costPrice) : calculatedCost,
      manual_cost_override: manualCost,
      manual_variant_cost_override: manualVariantCost,
      discount_type: isDiscountStore ? (storeDiscountEnabled ? "percent" : discountType) : null,
      discount_value: isDiscountStore ? (storeDiscountEnabled ? toNumber(selectedStore?.store_discount_percent) : toNumber(discountValue)) : 0,
      profit_type: isProfitStore ? profitType : null,
      profit_value: isProfitStore ? toNumber(profitValue) : 0,
      stock_quantity: Number(form.get("stock_quantity") || 0),
      description: form.get("description") || "",
    }, current?.id);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{current ? "Edit Product" : "Add Product"}</DialogTitle>
          <DialogDescription>Product cost follows the old admin rule: discount stores reduce cost by discount, cash/credit stores reduce cost by profit.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
          <Input name="name" defaultValue={current?.name || ""} placeholder="Product name" required />
          <Input name="price" value={price} onChange={(event) => setPrice(event.target.value)} type="number" min="0" step="0.01" placeholder="Sale price" required />
          <select name="store_id" value={storeId} onChange={(event) => setStoreId(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm" required>
            <option value="">Select store</option>
            {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select>
          <select name="category_id" defaultValue={current?.category_id || ""} className="h-10 rounded-md border bg-background px-3 text-sm">
            <option value="">No category</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
          <div className="rounded-md border bg-muted/30 p-3 text-sm sm:col-span-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">Payment Term</Badge>
              <span className="font-medium">{selectedStore?.payment_term || "Select a store"}</span>
              {storeDiscountEnabled ? <Badge variant="default">Store discount {toNumber(selectedStore?.store_discount_percent)}%</Badge> : null}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Cash only and credit stores use profit settings. Discount stores use product discount unless the store applies one discount to all products.
            </p>
          </div>
          {selectedStore && isDiscountPaymentTerm(selectedStore.payment_term) ? (
            <>
              <select value={storeDiscountEnabled ? "percent" : discountType} onChange={(event) => setDiscountType(event.target.value)} disabled={storeDiscountEnabled} className="h-10 rounded-md border bg-background px-3 text-sm">
                <option value="amount">Discount Amount</option>
                <option value="percent">Discount Percent</option>
              </select>
              <Input value={storeDiscountEnabled ? String(selectedStore.store_discount_percent || 0) : discountValue} onChange={(event) => setDiscountValue(event.target.value)} disabled={storeDiscountEnabled} type="number" min="0" step="0.01" placeholder="Discount value" />
            </>
          ) : null}
          {selectedStore && isProfitPaymentTerm(selectedStore.payment_term) ? (
            <>
              <select value={profitType} onChange={(event) => setProfitType(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm">
                <option value="amount">Profit Amount</option>
                <option value="percent">Profit Percent</option>
              </select>
              <Input value={profitValue} onChange={(event) => setProfitValue(event.target.value)} type="number" min="0" step="0.01" placeholder="Profit value" />
            </>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={manualCost} onChange={(event) => setManualCost(event.target.checked)} />
            Manual Cost Price
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={manualVariantCost} onChange={(event) => setManualVariantCost(event.target.checked)} />
            Manual Variant Costs
          </label>
          <Input name="cost_price" value={manualCost ? costPrice : String(calculatedCost || "")} onChange={(event) => setCostPrice(event.target.value)} readOnly={!manualCost} type="number" min="0" step="0.01" placeholder="Cost price" />
          <Input name="stock_quantity" defaultValue={current?.stock_quantity || 0} type="number" min="0" placeholder="Stock" />
          <textarea name="description" defaultValue={current?.description || ""} className="min-h-24 rounded-md border bg-background p-3 text-sm sm:col-span-2" placeholder="Description" />
          <Button type="submit" className="sm:col-span-2">{current ? "Save Product" : "Create Product"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StoreDialog({
  open,
  store,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  store: Store | "new" | null;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: Record<string, unknown>, id?: number) => void;
}) {
  const current = store === "new" ? null : store;
  const [paymentTerm, setPaymentTerm] = useState(current?.payment_term || "");
  const [applyDiscount, setApplyDiscount] = useState(Boolean(Number(current?.store_discount_apply_all_products || 0)));
  const discountApplicable = isDiscountPaymentTerm(paymentTerm);
  const graceApplicable = ["credit", "credit with discount"].includes(String(paymentTerm || "").toLowerCase().trim());

  useEffect(() => {
    if (!open) return;
    setPaymentTerm(current?.payment_term || "");
    setApplyDiscount(Boolean(Number(current?.store_discount_apply_all_products || 0)));
  }, [current, open]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      name: form.get("name"),
      owner_name: form.get("owner_name") || undefined,
      description: form.get("description") || "",
      location: form.get("location"),
      address: form.get("address") || "",
      phone: form.get("phone") || undefined,
      email: form.get("email") || undefined,
      rating: form.get("rating") ? Number(form.get("rating")) : undefined,
      delivery_time: form.get("delivery_time") || undefined,
      opening_time: form.get("opening_time") || null,
      closing_time: form.get("closing_time") || null,
      payment_term: paymentTerm || null,
      payment_grace_days: graceApplicable && form.get("payment_grace_days") ? Number(form.get("payment_grace_days")) : null,
      payment_grace_start_date: graceApplicable ? form.get("payment_grace_start_date") || null : null,
      store_discount_apply_all_products: discountApplicable && applyDiscount,
      store_discount_percent: discountApplicable && applyDiscount && form.get("store_discount_percent")
        ? Number(form.get("store_discount_percent"))
        : null,
      priority: form.get("priority") ? Number(form.get("priority")) : null,
      is_customer_visible: form.get("is_customer_visible") === "on",
      status: form.get("status") || "active",
      bank_id: form.get("bank_id") ? Number(form.get("bank_id")) : null,
      store_bank_account_title: form.get("store_bank_account_title") || null,
      store_bank_account_number: form.get("store_bank_account_number") || null,
    };
    onSave(payload, current?.id);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{current ? "Edit Store" : "Add Store"}</DialogTitle>
          <DialogDescription>Store profile, payment term, grace days, discount policy, priority, and bank metadata.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
          <Input name="name" defaultValue={current?.name || ""} placeholder="Store name" required />
          <Input name="owner_name" defaultValue={current?.owner_name || ""} placeholder="Owner name" />
          <Input name="location" defaultValue={current?.location || current?.address || ""} placeholder="Location" required />
          <Input name="phone" defaultValue={current?.phone || ""} placeholder="Phone" />
          <Input name="email" defaultValue={current?.email || ""} type="email" placeholder="Email" />
          <Input name="delivery_time" defaultValue={current?.delivery_time || ""} placeholder="Delivery time e.g. 30-45 min" />
          <Input name="opening_time" defaultValue={current?.opening_time || ""} type="time" />
          <Input name="closing_time" defaultValue={current?.closing_time || ""} type="time" />
          <select value={paymentTerm} onChange={(event) => setPaymentTerm(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm">
            <option value="">No payment term</option>
            <option value="cash only">Cash Only</option>
            <option value="credit">Credit</option>
            <option value="cash with discount">Cash With Discount</option>
            <option value="credit with discount">Credit With Discount</option>
          </select>
          <select name="status" defaultValue={Number(current?.is_active ?? 1) ? "active" : "inactive"} className="h-10 rounded-md border bg-background px-3 text-sm">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <Input name="rating" defaultValue={current?.rating || ""} type="number" min="0" max="5" step="0.1" placeholder="Rating" />
          <Input name="priority" defaultValue={current?.priority || ""} type="number" min="1" max="5" placeholder="Priority 1-5" />
          {graceApplicable ? (
            <>
              <Input name="payment_grace_days" defaultValue={current?.payment_grace_days || ""} type="number" min="0" placeholder="Payment grace days" />
              <Input name="payment_grace_start_date" defaultValue={String(current?.payment_grace_start_date || "").slice(0, 10)} type="date" />
            </>
          ) : null}
          {discountApplicable ? (
            <>
              <label className="flex items-center gap-2 rounded-md border px-3 text-sm">
                <input type="checkbox" checked={applyDiscount} onChange={(event) => setApplyDiscount(event.target.checked)} />
                Apply store discount to all products
              </label>
              <Input name="store_discount_percent" defaultValue={current?.store_discount_percent || ""} disabled={!applyDiscount} type="number" min="0" step="0.01" placeholder="Store discount %" />
            </>
          ) : null}
          <Input name="bank_id" defaultValue={current?.bank_id || ""} type="number" min="1" placeholder="Bank ID" />
          <Input name="store_bank_account_title" defaultValue={current?.store_bank_account_title || ""} placeholder="Bank account title" />
          <Input name="store_bank_account_number" defaultValue={current?.store_bank_account_number || ""} placeholder="Bank account number" />
          <label className="flex items-center gap-2 text-sm">
            <input name="is_customer_visible" type="checkbox" defaultChecked={current ? Boolean(Number(current.is_customer_visible ?? 1)) : true} />
            Visible to customers
          </label>
          <textarea name="address" defaultValue={current?.address || ""} className="min-h-20 rounded-md border bg-background p-3 text-sm sm:col-span-2" placeholder="Address" />
          <textarea name="description" defaultValue={current?.description || ""} className="min-h-20 rounded-md border bg-background p-3 text-sm sm:col-span-2" placeholder="Description" />
          <Button type="submit" className="sm:col-span-2">{current ? "Save Store" : "Create Store"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CategoryDialog({
  open,
  category,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  category: GenericRecord | "new" | null;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: Record<string, unknown>, id?: number) => void;
}) {
  const current = category === "new" ? null : category;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({
      name: form.get("name"),
      description: form.get("description"),
      image_url: form.get("image_url") || null,
      is_active: form.get("is_active") === "on",
    }, current?.id as number | undefined);
    onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{current ? "Edit Category" : "Add Category"}</DialogTitle>
          <DialogDescription>Category requires name and description in the existing API.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={submit}>
          <Input name="name" defaultValue={String(current?.name || "")} placeholder="Category name" required />
          <Input name="image_url" defaultValue={String(current?.image_url || "")} placeholder="Image URL or /uploads path" />
          <textarea name="description" defaultValue={String(current?.description || "")} className="min-h-24 rounded-md border bg-background p-3 text-sm" placeholder="Description" required />
          <label className="flex items-center gap-2 text-sm">
            <input name="is_active" type="checkbox" defaultChecked={current ? Boolean(Number(current.is_active ?? 1)) : true} />
            Active
          </label>
          <Button type="submit">{current ? "Save Category" : "Create Category"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UnitDialog({
  open,
  unit,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  unit: GenericRecord | "new" | null;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: Record<string, unknown>, id?: number) => void;
}) {
  const current = unit === "new" ? null : unit;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({
      name: form.get("name"),
      abbreviation: form.get("abbreviation") || null,
      multiplier: Number(form.get("multiplier") || 1),
    }, current?.id as number | undefined);
    onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{current ? "Edit Unit" : "Add Unit"}</DialogTitle>
          <DialogDescription>Units drive product unit and variant pricing.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={submit}>
          <Input name="name" defaultValue={String(current?.name || "")} placeholder="Unit name" required />
          <Input name="abbreviation" defaultValue={String(current?.abbreviation || "")} placeholder="Abbreviation" />
          <Input name="multiplier" defaultValue={String(current?.multiplier || 1)} type="number" min="0" step="0.001" placeholder="Multiplier" required />
          <Button type="submit">{current ? "Save Unit" : "Create Unit"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SizeDialog({
  open,
  size,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  size: GenericRecord | "new" | null;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: Record<string, unknown>, id?: number) => void;
}) {
  const current = size === "new" ? null : size;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({
      label: form.get("label"),
      description: form.get("description") || null,
    }, current?.id as number | undefined);
    onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{current ? "Edit Size" : "Add Size"}</DialogTitle>
          <DialogDescription>Sizes are used by product variants.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={submit}>
          <Input name="label" defaultValue={String(current?.label || current?.name || "")} placeholder="Size label" required />
          <textarea name="description" defaultValue={String(current?.description || "")} className="min-h-20 rounded-md border bg-background p-3 text-sm" placeholder="Description" />
          <Button type="submit">{current ? "Save Size" : "Create Size"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UserDialog({
  open,
  user,
  stores,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  user: User | "new" | null;
  stores: Store[];
  onOpenChange: (open: boolean) => void;
  onSave: (payload: Record<string, unknown>, id?: number) => void;
}) {
  const current = user === "new" ? null : user;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = {
      firstName: form.get("firstName"),
      lastName: form.get("lastName"),
      email: form.get("email"),
      phone: form.get("phone") || undefined,
      address: form.get("address") || undefined,
      user_type: form.get("user_type"),
      store_id: form.get("store_id") ? Number(form.get("store_id")) : null,
      is_active: form.get("is_active") === "on",
      is_verified: form.get("is_verified") === "on",
    };
    if (form.get("password")) payload.password = form.get("password");
    onSave(payload, current?.id);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{current ? "Edit User" : "Add User"}</DialogTitle>
          <DialogDescription>Manage accounts and roles through `/api/users`.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
          <Input name="firstName" defaultValue={current?.first_name || ""} placeholder="First name" required />
          <Input name="lastName" defaultValue={current?.last_name || ""} placeholder="Last name" required />
          <Input name="email" defaultValue={current?.email || ""} type="email" placeholder="Email" required />
          <Input name="phone" defaultValue={current?.phone || ""} placeholder="Phone" />
          <Input name="password" type="password" placeholder={current ? "New password optional" : "Password"} required={!current} />
          <select name="user_type" defaultValue={current?.user_type || "customer"} className="h-10 rounded-md border bg-background px-3 text-sm">
            <option value="customer">Customer</option>
            <option value="store_owner">Store Owner</option>
            <option value="standard_user">Standard User</option>
            <option value="admin">Admin</option>
            <option value="rider">Rider</option>
          </select>
          <select name="store_id" defaultValue={current?.store_id || ""} className="h-10 rounded-md border bg-background px-3 text-sm">
            <option value="">No linked store</option>
            {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select>
          <Input name="address" defaultValue={current?.address || ""} placeholder="Address" />
          <label className="flex items-center gap-2 text-sm"><input name="is_active" type="checkbox" defaultChecked={current ? Boolean(Number(current.is_active)) : true} /> Active</label>
          <label className="flex items-center gap-2 text-sm"><input name="is_verified" type="checkbox" defaultChecked={current ? Boolean(Number(current.is_verified)) : true} /> Verified</label>
          <Button type="submit" className="sm:col-span-2">{current ? "Save User" : "Create User"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RiderDialog({
  open,
  rider,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  rider: Rider | "new" | null;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: Record<string, unknown>, id?: number) => void;
}) {
  const current = rider === "new" ? null : rider;
  const fullName = current?.full_name || `${current?.first_name || ""} ${current?.last_name || ""}`.trim();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = {
      fullName: form.get("fullName"),
      fatherName: form.get("fatherName") || undefined,
      email: form.get("email"),
      phone: form.get("phone"),
      vehicleType: form.get("vehicleType"),
      licenseNumber: form.get("licenseNumber"),
      idCardNum: form.get("idCardNum") || undefined,
      isActive: form.get("isActive") === "on",
      isAvailable: form.get("isAvailable") === "on",
    };
    if (form.get("password")) payload.password = form.get("password");
    onSave(payload, current?.id);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{current ? "Edit Rider" : "Add Rider"}</DialogTitle>
          <DialogDescription>Manage rider profile, vehicle, and active status.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
          <Input name="fullName" defaultValue={fullName} placeholder="Full name" required />
          <Input name="fatherName" defaultValue={current?.father_name || ""} placeholder="Father name" />
          <Input name="email" defaultValue={current?.email || ""} type="email" placeholder="Email" required />
          <Input name="phone" defaultValue={current?.phone || ""} placeholder="Phone" required />
          <Input name="password" type="password" placeholder={current ? "New password optional" : "Password"} required={!current} />
          <select name="vehicleType" defaultValue={current?.vehicle_type || "bike"} className="h-10 rounded-md border bg-background px-3 text-sm">
            <option value="bike">Bike</option>
            <option value="car">Car</option>
            <option value="van">Van</option>
            <option value="bicycle">Bicycle</option>
          </select>
          <Input name="licenseNumber" defaultValue={current?.license_number || ""} placeholder="License number" required />
          <Input name="idCardNum" defaultValue={current?.id_card_num || ""} placeholder="ID card xxxxx-xxxxxxx-x" />
          <label className="flex items-center gap-2 text-sm"><input name="isActive" type="checkbox" defaultChecked={current ? Boolean(Number(current.is_active)) : true} /> Active</label>
          <label className="flex items-center gap-2 text-sm"><input name="isAvailable" type="checkbox" defaultChecked={current ? Boolean(Number(current.is_available)) : true} /> Available</label>
          <Button type="submit" className="sm:col-span-2">{current ? "Save Rider" : "Create Rider"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OrderActionDialog({
  open,
  order,
  token,
  users,
  products,
  riders,
  onOpenChange,
  onStatus,
  onAssign,
  onChanged,
}: {
  open: boolean;
  order: Order | null;
  token: string;
  users: User[];
  products: Product[];
  riders: Rider[];
  onOpenChange: (open: boolean) => void;
  onStatus: (orderId: number, status: string) => void;
  onAssign: (orderId: number, riderId: number, deliveryFee?: number) => void;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<AdminOrderItem[]>([]);
  const [deliveryFee, setDeliveryFee] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [loadingItems, setLoadingItems] = useState(false);
  const [dialogStatus, setDialogStatus] = useState<string | null>(null);
  const [customer, setCustomer] = useState({ id: "", name: "", phone: "", email: "", address: "", instructions: "" });

  async function loadOrderItems() {
    if (!order) return;
    setLoadingItems(true);
    setDialogStatus(null);
    try {
      const result = await fetchAdminOrderItems(order.id, token);
      setItems(result.items || []);
      setDeliveryFee(String(result.order?.delivery_fee ?? ""));
      setCustomer({
        id: String(result.order?.user_id || ""),
        name: `${result.order?.first_name || ""} ${result.order?.last_name || ""}`.trim(),
        phone: result.order?.phone || "",
        email: result.order?.email || "",
        address: result.order?.delivery_address || "",
        instructions: result.order?.special_instructions || "",
      });
    } catch (err) {
      setDialogStatus(err instanceof Error ? err.message : "Unable to load order items");
    } finally {
      setLoadingItems(false);
    }
  }

  useEffect(() => {
    if (open && order) {
      setSelectedProductId("");
      setQuantity("1");
      loadOrderItems();
    }
  }, [open, order?.id]);

  async function runDialogAction(action: () => Promise<unknown>, success: string) {
    setDialogStatus(null);
    try {
      await action();
      setDialogStatus(success);
      await loadOrderItems();
      onChanged();
    } catch (err) {
      setDialogStatus(err instanceof Error ? err.message : "Order action failed");
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!order) return;
    const form = new FormData(event.currentTarget);
    const nextStatus = String(form.get("status") || "");
    const riderId = Number(form.get("rider_id") || 0);
    if (nextStatus && nextStatus !== order.status) onStatus(order.id, nextStatus);
    if (riderId) onAssign(order.id, riderId, deliveryFee === "" ? undefined : toNumber(deliveryFee));
  }

  const selectedProduct = products.find((product) => String(product.id) === selectedProductId);
  const subtotal = items.reduce((sum, item) => sum + toNumber(item.price) * toNumber(item.quantity), 0);
  const customerUsers = users.filter((item) => item.user_type === "customer");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Manage Order {order?.order_number || order?.id}</DialogTitle>
          <DialogDescription>Admin order workflow: change status, assign rider, edit customer details, add or remove items, and recalculate delivery charges.</DialogDescription>
        </DialogHeader>
        {dialogStatus ? <div className="rounded-md border bg-muted/40 p-3 text-sm">{dialogStatus}</div> : null}
        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="grid gap-3">
            <div className="rounded-lg border">
              <div className="flex items-center justify-between border-b p-3">
                <div>
                  <p className="text-sm font-semibold">Order Items</p>
                  <p className="text-xs text-muted-foreground">Additions and removals use the legacy recalculation endpoints.</p>
                </div>
                <Badge variant="outline">{loadingItems ? "Loading" : `${items.length} items`}</Badge>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Product</th>
                      <th className="px-3 py-2 text-left">Store</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Price</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id} className="border-t">
                        <td className="px-3 py-2">
                          <div className="font-medium">{item.product_name || `Product ${item.product_id || ""}`}</div>
                          {item.variant_label ? <div className="text-xs text-muted-foreground">{item.variant_label}</div> : null}
                        </td>
                        <td className="px-3 py-2">{item.store_name || item.store_id || "-"}</td>
                        <td className="px-3 py-2 text-right">{item.quantity || 0}</td>
                        <td className="px-3 py-2 text-right">{formatCurrency(item.price)}</td>
                        <td className="px-3 py-2 text-right">{formatCurrency(toNumber(item.price) * toNumber(item.quantity))}</td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => order && runDialogAction(
                              () => removeAdminOrderItem(order.id, item.id, token),
                              "Item removed and order total recalculated.",
                            )}
                          >
                            Remove
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {!items.length ? (
                      <tr>
                        <td className="px-3 py-6 text-center text-muted-foreground" colSpan={6}>No items loaded for this order.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_7rem_auto]">
              <select value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)} className="h-10 min-w-0 rounded-md border bg-background px-3 text-sm">
                <option value="">Select product to add</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} {product.store_name ? `- ${product.store_name}` : ""}
                  </option>
                ))}
              </select>
              <Input value={quantity} onChange={(event) => setQuantity(event.target.value)} type="number" min="1" placeholder="Qty" />
              <Button
                type="button"
                disabled={!order || !selectedProduct}
                onClick={() => order && selectedProduct && runDialogAction(
                  () => addAdminOrderItem({
                    orderId: order.id,
                    token,
                    productId: selectedProduct.id,
                    quantity: Math.max(1, toNumber(quantity, 1)),
                    storeId: selectedProduct.store_id,
                  }),
                  "Item added and order total recalculated.",
                )}
              >
                Add Item
              </Button>
            </div>
          </div>

          <div className="grid gap-3 content-start">
            <form className="grid gap-3 rounded-lg border p-3" onSubmit={submit}>
              <select name="status" defaultValue={order?.status || "pending"} className="h-10 rounded-md border bg-background px-3 text-sm">
                {["pending", "confirmed", "preparing", "ready", "ready_for_pickup", "picked_up", "out_for_delivery", "delivered", "cancelled"].map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
              <select name="rider_id" defaultValue={order?.rider_id || ""} className="h-10 rounded-md border bg-background px-3 text-sm">
                <option value="">No rider change</option>
                {riders.map((rider) => <option key={rider.id} value={rider.id}>{`${rider.first_name || ""} ${rider.last_name || ""}`.trim() || rider.full_name || `Rider ${rider.id}`}</option>)}
              </select>
              <Input value={deliveryFee} onChange={(event) => setDeliveryFee(event.target.value)} type="number" min="0" step="0.01" placeholder="Delivery fee" />
              <div className="grid grid-cols-2 gap-2">
                <Button type="submit">Apply</Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!order}
                  onClick={() => order && runDialogAction(
                    () => recalculateAdminOrderDeliveryFee(order.id, token),
                    "Delivery fee auto recalculated.",
                  )}
                >
                  Auto Fee
                </Button>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={!order}
                onClick={() => order && runDialogAction(
                  () => saveAdminOrderDeliveryFee(order.id, token, toNumber(deliveryFee)),
                  "Manual delivery fee saved.",
                )}
              >
                Save Manual Delivery Fee
              </Button>
            </form>

            <div className="grid gap-2 rounded-lg border p-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Items Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Delivery Fee</span><span>{formatCurrency(deliveryFee)}</span></div>
              <div className="flex justify-between font-semibold"><span>Visible Total</span><span>{formatCurrency(subtotal + toNumber(deliveryFee))}</span></div>
            </div>

            <div className="grid gap-2 rounded-lg border p-3">
              <p className="text-sm font-semibold">Customer and Address</p>
              <select value={customer.id} onChange={(event) => setCustomer((current) => ({ ...current, id: event.target.value }))} className="h-10 rounded-md border bg-background px-3 text-sm">
                <option value="">{customer.name || "Select customer"}</option>
                {customerUsers.map((item) => (
                  <option key={item.id} value={item.id}>{`${item.first_name || ""} ${item.last_name || ""}`.trim() || item.email}</option>
                ))}
              </select>
              <Input value={customer.phone} readOnly placeholder="Phone" />
              <Input value={customer.email} readOnly placeholder="Email" />
              <textarea value={customer.address} onChange={(event) => setCustomer((current) => ({ ...current, address: event.target.value }))} className="min-h-20 rounded-md border bg-background p-3 text-sm" placeholder="Delivery address" />
              <textarea value={customer.instructions} onChange={(event) => setCustomer((current) => ({ ...current, instructions: event.target.value }))} className="min-h-16 rounded-md border bg-background p-3 text-sm" placeholder="Special instructions" />
              <Button
                type="button"
                variant="outline"
                disabled={!order || !customer.id}
                onClick={() => order && runDialogAction(
                  () => saveAdminOrderCustomer({
                    orderId: order.id,
                    token,
                    customerId: Number(customer.id),
                    deliveryAddress: customer.address,
                    specialInstructions: customer.instructions || null,
                  }),
                  "Customer and address updated.",
                )}
              >
                Save Customer Details
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ExpenseDialog({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: Record<string, unknown>) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({
      category: form.get("category"),
      amount: Number(form.get("amount")),
      payment_method: form.get("payment_method"),
      description: form.get("description") || "",
      vendor_name: form.get("vendor_name") || undefined,
      receipt_number: form.get("receipt_number") || undefined,
      notes: form.get("notes") || undefined,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Expense</DialogTitle>
          <DialogDescription>Record an admin expense in the financial module.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={submit}>
          <Input name="category" placeholder="Category" required />
          <Input name="amount" type="number" min="0.01" step="0.01" placeholder="Amount" required />
          <select name="payment_method" defaultValue="cash" className="h-10 rounded-md border bg-background px-3 text-sm">
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="cheque">Cheque</option>
            <option value="bank_transfer">Bank Transfer</option>
          </select>
          <Input name="vendor_name" placeholder="Vendor name" />
          <Input name="receipt_number" placeholder="Receipt number" />
          <textarea name="description" className="min-h-20 rounded-md border bg-background p-3 text-sm" placeholder="Description" />
          <textarea name="notes" className="min-h-20 rounded-md border bg-background p-3 text-sm" placeholder="Notes" />
          <Button type="submit">Record Expense</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PaymentVoucherDialog({
  open,
  voucher,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  voucher: GenericRecord | "new" | null;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: Record<string, unknown>, id?: number) => void;
}) {
  const current = voucher === "new" ? null : voucher;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({
      payee_name: form.get("payee_name"),
      payee_type: form.get("payee_type"),
      payee_id: form.get("payee_id") ? Number(form.get("payee_id")) : null,
      amount: Number(form.get("amount")),
      purpose: form.get("purpose") || null,
      description: form.get("description") || null,
      payment_method: form.get("payment_method"),
      cheque_number: form.get("cheque_number") || null,
      status: current ? form.get("status") : undefined,
    }, current?.id as number | undefined);
    onOpenChange(false);
  }
  return (
    <VoucherDialogFrame open={open} onOpenChange={onOpenChange} title={current ? "Edit Payment Voucher" : "Add Payment Voucher"} description="Cash payment voucher for store, rider, vendor, employee, expense, customer, bank, or other payee.">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
        <Input name="payee_name" defaultValue={String(current?.payee_name || "")} placeholder="Payee name" required />
        <select name="payee_type" defaultValue={String(current?.payee_type || "store")} className="h-10 rounded-md border bg-background px-3 text-sm">
          {["store", "rider", "vendor", "employee", "expense", "customer", "bank", "other"].map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <Input name="payee_id" defaultValue={String(current?.payee_id || "")} type="number" min="1" placeholder="Linked ID optional" />
        <Input name="amount" defaultValue={String(current?.amount || "")} type="number" min="0.01" step="0.01" placeholder="Amount" required />
        <select name="payment_method" defaultValue={String(current?.payment_method || "cash")} className="h-10 rounded-md border bg-background px-3 text-sm">
          <option value="cash">Cash</option>
          <option value="cheque">Cheque</option>
          <option value="bank_transfer">Bank Transfer</option>
        </select>
        <Input name="cheque_number" defaultValue={String(current?.cheque_number || current?.check_number || "")} placeholder="Cheque/check number" />
        {current ? <StatusSelect defaultValue={String(current.status || "draft")} statuses={["draft", "pending", "approved", "paid", "cancelled"]} /> : null}
        <Input name="purpose" defaultValue={String(current?.purpose || "")} placeholder="Purpose" />
        <textarea name="description" defaultValue={String(current?.description || "")} className="min-h-20 rounded-md border bg-background p-3 text-sm sm:col-span-2" placeholder="Description" />
        <Button type="submit" className="sm:col-span-2">{current ? "Save Voucher" : "Create Voucher"}</Button>
      </form>
    </VoucherDialogFrame>
  );
}

function ReceiptVoucherDialog({
  open,
  voucher,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  voucher: GenericRecord | "new" | null;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: Record<string, unknown>, id?: number) => void;
}) {
  const current = voucher === "new" ? null : voucher;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({
      payer_name: form.get("payer_name"),
      payer_type: form.get("payer_type"),
      payer_id: form.get("payer_id") ? Number(form.get("payer_id")) : null,
      amount: Number(form.get("amount")),
      description: form.get("description") || null,
      details: form.get("details") || null,
      payment_method: form.get("payment_method"),
      cheque_number: form.get("cheque_number") || null,
      status: current ? form.get("status") : undefined,
    }, current?.id as number | undefined);
    onOpenChange(false);
  }
  return (
    <VoucherDialogFrame open={open} onOpenChange={onOpenChange} title={current ? "Edit Receipt Voucher" : "Add Receipt Voucher"} description="Cash receipt voucher for customer, store, rider, vendor, employee, expense, bank, or other payer.">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
        <Input name="payer_name" defaultValue={String(current?.payer_name || "")} placeholder="Payer name" required />
        <select name="payer_type" defaultValue={String(current?.payer_type || "customer")} className="h-10 rounded-md border bg-background px-3 text-sm">
          {["customer", "store", "rider", "vendor", "employee", "expense", "bank", "other"].map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <Input name="payer_id" defaultValue={String(current?.payer_id || "")} type="number" min="1" placeholder="Linked ID optional" />
        <Input name="amount" defaultValue={String(current?.amount || "")} type="number" min="0.01" step="0.01" placeholder="Amount" required />
        <select name="payment_method" defaultValue={String(current?.payment_method || "cash")} className="h-10 rounded-md border bg-background px-3 text-sm">
          <option value="cash">Cash</option>
          <option value="cheque">Cheque</option>
          <option value="bank_transfer">Bank Transfer</option>
        </select>
        <Input name="cheque_number" defaultValue={String(current?.cheque_number || current?.check_number || "")} placeholder="Cheque/check number" />
        {current ? <StatusSelect defaultValue={String(current.status || "draft")} statuses={["draft", "pending", "approved", "received", "cancelled"]} /> : null}
        <textarea name="description" defaultValue={String(current?.description || "")} className="min-h-20 rounded-md border bg-background p-3 text-sm sm:col-span-2" placeholder="Description" />
        <textarea name="details" defaultValue={String(current?.details || "")} className="min-h-20 rounded-md border bg-background p-3 text-sm sm:col-span-2" placeholder="Details" />
        <Button type="submit" className="sm:col-span-2">{current ? "Save Voucher" : "Create Voucher"}</Button>
      </form>
    </VoucherDialogFrame>
  );
}

function RiderCashDialog({
  open,
  movement,
  riders,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  movement: GenericRecord | "new" | null;
  riders: Rider[];
  onOpenChange: (open: boolean) => void;
  onSave: (payload: Record<string, unknown>, id?: number) => void;
}) {
  const current = movement === "new" ? null : movement;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({
      rider_id: Number(form.get("rider_id")),
      movement_type: form.get("movement_type"),
      amount: Number(form.get("amount")),
      description: form.get("description") || null,
      notes: form.get("notes") || null,
      status: current ? form.get("status") : undefined,
    }, current?.id as number | undefined);
    onOpenChange(false);
  }
  return (
    <VoucherDialogFrame open={open} onOpenChange={onOpenChange} title={current ? "Edit Rider Cash" : "Add Rider Cash"} description="Rider cash submissions, advances, settlements, adjustments, store payments, and fuel payments.">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
        <select name="rider_id" defaultValue={String(current?.rider_id || "")} className="h-10 rounded-md border bg-background px-3 text-sm" required>
          <option value="">Select rider</option>
          {riders.map((rider) => <option key={rider.id} value={rider.id}>{rider.full_name || `${rider.first_name || ""} ${rider.last_name || ""}`.trim() || `Rider ${rider.id}`}</option>)}
        </select>
        <select name="movement_type" defaultValue={String(current?.movement_type || "cash_submission")} className="h-10 rounded-md border bg-background px-3 text-sm">
          {["cash_submission", "advance", "settlement", "adjustment", "store_payment", "fuel_payment"].map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <Input name="amount" defaultValue={String(current?.amount || "")} type="number" min="0.01" step="0.01" placeholder="Amount" required />
        {current ? <StatusSelect defaultValue={String(current.status || "pending")} statuses={["pending", "approved", "completed", "cancelled"]} /> : null}
        <textarea name="description" defaultValue={String(current?.description || "")} className="min-h-20 rounded-md border bg-background p-3 text-sm sm:col-span-2" placeholder="Description" />
        <textarea name="notes" defaultValue={String(current?.notes || "")} className="min-h-20 rounded-md border bg-background p-3 text-sm sm:col-span-2" placeholder="Notes" />
        <Button type="submit" className="sm:col-span-2">{current ? "Save Rider Cash" : "Create Rider Cash"}</Button>
      </form>
    </VoucherDialogFrame>
  );
}

function StoreSettlementDialog({
  open,
  settlement,
  stores,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  settlement: GenericRecord | "new" | null;
  stores: Store[];
  onOpenChange: (open: boolean) => void;
  onSave: (payload: Record<string, unknown>, id?: number) => void;
}) {
  const current = settlement === "new" ? null : settlement;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({
      store_id: Number(form.get("store_id")),
      period_from: form.get("period_from") || null,
      period_to: form.get("period_to") || null,
      total_orders_amount: Number(form.get("total_orders_amount") || 0),
      commissions: Number(form.get("commissions") || 0),
      deductions: Number(form.get("deductions") || 0),
      net_amount: Number(form.get("net_amount") || 0),
      payment_method: form.get("payment_method"),
      notes: form.get("notes") || null,
      auto_calculate: form.get("auto_calculate") === "on",
      status: current ? form.get("status") : undefined,
    }, current?.id as number | undefined);
    onOpenChange(false);
  }
  return (
    <VoucherDialogFrame open={open} onOpenChange={onOpenChange} title={current ? "Edit Store Settlement" : "Add Store Settlement"} description="Create pending store settlement manually or use auto-calculate against unpaid settlement items.">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
        <select name="store_id" defaultValue={String(current?.store_id || "")} className="h-10 rounded-md border bg-background px-3 text-sm" required>
          <option value="">Select store</option>
          {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
        </select>
        <select name="payment_method" defaultValue={String(current?.payment_method || "cash")} className="h-10 rounded-md border bg-background px-3 text-sm">
          <option value="cash">Cash</option>
          <option value="cheque">Cheque</option>
          <option value="bank_transfer">Bank Transfer</option>
        </select>
        <Input name="period_from" defaultValue={String(current?.period_from || "").slice(0, 10)} type="date" />
        <Input name="period_to" defaultValue={String(current?.period_to || "").slice(0, 10)} type="date" />
        <Input name="total_orders_amount" defaultValue={String(current?.total_orders_amount || "")} type="number" min="0" step="0.01" placeholder="Total orders amount" />
        <Input name="commissions" defaultValue={String(current?.commissions || "")} type="number" min="0" step="0.01" placeholder="Commissions" />
        <Input name="deductions" defaultValue={String(current?.deductions || "")} type="number" min="0" step="0.01" placeholder="Deductions" />
        <Input name="net_amount" defaultValue={String(current?.net_amount || "")} type="number" min="0" step="0.01" placeholder="Net amount" />
        {current ? <StatusSelect defaultValue={String(current.status || "pending")} statuses={["pending", "approved", "paid", "cancelled"]} /> : null}
        <label className="flex items-center gap-2 text-sm">
          <input name="auto_calculate" type="checkbox" defaultChecked={false} />
          Auto-calculate from unpaid items
        </label>
        <textarea name="notes" defaultValue={String(current?.notes || "")} className="min-h-20 rounded-md border bg-background p-3 text-sm sm:col-span-2" placeholder="Notes" />
        <Button type="submit" className="sm:col-span-2">{current ? "Save Settlement" : "Create Settlement"}</Button>
      </form>
    </VoucherDialogFrame>
  );
}

function StatusSelect({ defaultValue, statuses }: { defaultValue: string; statuses: string[] }) {
  return (
    <select name="status" defaultValue={defaultValue} className="h-10 rounded-md border bg-background px-3 text-sm">
      {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
    </select>
  );
}

function VoucherDialogFrame({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  tone?: "neutral" | "primary" | "success" | "warning" | "danger";
}) {
  const toneClass = {
    neutral: "bg-muted text-muted-foreground",
    primary: "bg-primary/10 text-primary",
    success: "bg-emerald-50 text-emerald-700",
    warning: "bg-amber-50 text-amber-700",
    danger: "bg-destructive/10 text-destructive",
  }[tone];
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <span className={`flex h-9 w-9 items-center justify-center rounded-md ${toneClass}`}>
            <Icon className="h-4 w-4" />
          </span>
          <span className="text-sm text-muted-foreground">{label}</span>
        </div>
        <span className="text-sm font-semibold">{value}</span>
      </CardContent>
    </Card>
  );
}
