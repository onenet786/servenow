import { RefreshCcw, Route, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WorkspaceTable } from "@/components/workspaces/WorkspaceTable";
import { apiFetch } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import type { Order, User } from "@/lib/types";
import { useApiResource } from "@/hooks/useApiResource";

type RiderData = {
  assigned: Order[];
  completed: Order[];
  wallet: { balance?: number | string } | null;
};

export function RiderWorkspace({ token, user }: { token: string; user: User }) {
  const riderData = useApiResource<RiderData>(async () => {
    const [assigned, completed, wallet] = await Promise.all([
      apiFetch<{ deliveries?: Order[] }>("/api/orders/rider/deliveries?status=assigned", { token }),
      apiFetch<{ deliveries?: Order[] }>("/api/orders/rider/deliveries?status=completed", { token }),
      apiFetch<{ wallet?: { balance?: number | string } }>("/api/orders/rider/wallet-stats", { token }),
    ]);

    return {
      assigned: assigned.deliveries || [],
      completed: completed.deliveries || [],
      wallet: normalizeWallet(wallet),
    };
  }, [token]);

  const data = riderData.data;

  return (
    <section className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Badge>{user.user_type}</Badge>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal">Rider dashboard</h1>
          <p className="text-sm text-muted-foreground">Assigned deliveries, completed work, and wallet summary.</p>
        </div>
        <Button onClick={riderData.reload}>
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Summary icon={Route} label="Assigned" value={data?.assigned.length || 0} />
        <Summary icon={Route} label="Completed" value={data?.completed.length || 0} />
        <Summary icon={WalletCards} label="Wallet" value={formatCurrency(data?.wallet?.balance)} />
      </div>
      {riderData.error ? <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{riderData.error}</div> : null}
      <WorkspaceTable
        title="Assigned Deliveries"
        description="Current delivery work assigned to this rider."
        rows={data?.assigned || []}
        columns={[
          { key: "id", label: "Order", render: (row) => row.order_number || row.id },
          { key: "status", label: "Status", render: (row) => <Badge variant="outline">{row.status || "-"}</Badge> },
          { key: "total", label: "Total", render: (row) => formatCurrency(row.total_amount) },
          { key: "created", label: "Created", render: (row) => row.created_at ? new Date(row.created_at).toLocaleString() : "-" },
        ]}
      />
    </section>
  );
}

function normalizeWallet(wallet: { wallet?: { balance?: number | string }; balance?: number | string } | null) {
  if (!wallet) return null;
  return wallet.wallet || { balance: wallet.balance };
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
