import { Banknote, ClipboardList, Megaphone, RefreshCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkspaceTable } from "@/components/workspaces/WorkspaceTable";
import { apiFetch } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import type { Order, User } from "@/lib/types";
import { useApiResource } from "@/hooks/useApiResource";

type StoreOwnerData = {
  orders: Order[];
  stats: Record<string, unknown> | null;
  financial: Record<string, unknown> | null;
  campaigns: Array<{ id: number; title?: string; name?: string; is_active?: boolean | number }>;
};

export function StoreOwnerWorkspace({ token, user }: { token: string; user: User }) {
  const storeData = useApiResource<StoreOwnerData>(async () => {
    const [dashboard, financial, campaigns] = await Promise.all([
      apiFetch<{ orders?: Order[]; stats?: Record<string, unknown> }>("/api/orders/store-dashboard?status=all", { token }),
      apiFetch<Record<string, unknown>>("/api/orders/store-owner/financial-history", { token }),
      apiFetch<{ campaigns?: Array<{ id: number; title?: string; name?: string; is_active?: boolean | number }> }>("/api/stores/offer-campaigns", { token }),
    ]);

    return {
      orders: dashboard.orders || [],
      stats: dashboard.stats || null,
      financial,
      campaigns: campaigns.campaigns || [],
    };
  }, [token]);

  const data = storeData.data;

  return (
    <section className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Badge>{user.user_type}</Badge>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal">Store workspace</h1>
          <p className="text-sm text-muted-foreground">Store-owner orders, financial history, and offer campaigns.</p>
        </div>
        <Button onClick={storeData.reload}>
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Summary icon={ClipboardList} label="Orders" value={data?.orders.length || 0} />
        <Summary icon={Banknote} label="Financial" value={data?.financial ? "Live" : "-"} />
        <Summary icon={Megaphone} label="Campaigns" value={data?.campaigns.length || 0} />
      </div>
      {storeData.error ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{storeData.error}</div> : null}
      <WorkspaceTable
        title="Store Orders"
        description="Orders connected to the signed-in store owner."
        rows={data?.orders || []}
        columns={[
          { key: "id", label: "Order", render: (row) => row.order_number || row.id },
          { key: "customer", label: "Customer", render: (row) => row.customer_name || "-" },
          { key: "status", label: "Status", render: (row) => <Badge variant="outline">{row.status || "-"}</Badge> },
          { key: "total", label: "Total", render: (row) => formatCurrency(row.total_amount) },
          { key: "created", label: "Created", render: (row) => row.created_at ? new Date(row.created_at).toLocaleString() : "-" },
        ]}
      />
    </section>
  );
}

function Summary({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string | number }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon className="h-4 w-4" />
          {label}
        </CardDescription>
        <CardTitle>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
