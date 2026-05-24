import { useMemo, useState } from "react";
import { Activity, PackageCheck, RefreshCcw, Store as StoreIcon, Truck } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { AuthDialog } from "@/components/AuthDialog";
import { ProductGrid } from "@/components/ProductGrid";
import { StoreGrid } from "@/components/StoreGrid";
import { AdminWorkspace } from "@/components/workspaces/AdminWorkspace";
import { RiderWorkspace } from "@/components/workspaces/RiderWorkspace";
import { StoreOwnerWorkspace } from "@/components/workspaces/StoreOwnerWorkspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiFetch, API_DISPLAY_URL, assetUrl } from "@/lib/api";
import type { Category, Product, Store, User } from "@/lib/types";
import { isAdminLike, isRider, isStoreOwner } from "@/lib/roles";
import { useApiResource } from "@/hooks/useApiResource";

type ListResponse<T> = T[] | { data?: T[]; products?: T[]; stores?: T[]; categories?: T[] };

function extractList<T>(payload: ListResponse<T>, key: "products" | "stores" | "categories"): T[] {
  if (Array.isArray(payload)) return payload;
  return payload[key] || payload.data || [];
}

export function App() {
  const [search, setSearch] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [token, setToken] = useState(() => localStorage.getItem("servenow.react.token") || localStorage.getItem("serveNowToken"));
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem("servenow.react.user") || localStorage.getItem("serveNowUser");
    try {
      return raw ? (JSON.parse(raw) as User) : null;
    } catch {
      return null;
    }
  });

  const stores = useApiResource(async () => extractList<Store>(await apiFetch<ListResponse<Store>>("/api/stores"), "stores"));
  const products = useApiResource(async () => extractList<Product>(await apiFetch<ListResponse<Product>>("/api/products"), "products"));
  const categories = useApiResource(async () => extractList<Category>(await apiFetch<ListResponse<Category>>("/api/categories"), "categories"));

  const filteredStores = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return stores.data || [];
    return (stores.data || []).filter((store) =>
      [store.name, store.description, store.address].some((value) => String(value || "").toLowerCase().includes(query)),
    );
  }, [search, stores.data]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return products.data || [];
    return (products.data || []).filter((product) =>
      [product.name, product.description, product.store_name, product.category_name].some((value) =>
        String(value || "").toLowerCase().includes(query),
      ),
    );
  }, [search, products.data]);

  function handleAuth(nextToken: string, nextUser?: User) {
    localStorage.setItem("servenow.react.token", nextToken);
    localStorage.setItem("serveNowToken", nextToken);
    if (nextUser) {
      localStorage.setItem("servenow.react.user", JSON.stringify(nextUser));
      localStorage.setItem("serveNowUser", JSON.stringify(nextUser));
    }
    setToken(nextToken);
    setUser(nextUser || null);
  }

  function handleLogout() {
    localStorage.removeItem("servenow.react.token");
    localStorage.removeItem("servenow.react.user");
    localStorage.removeItem("serveNowToken");
    localStorage.removeItem("serveNowUser");
    setToken(null);
    setUser(null);
  }

  function reloadAll() {
    stores.reload();
    products.reload();
    categories.reload();
  }

  const hasError = stores.error || products.error || categories.error;
  const isLoading = stores.isLoading || products.isLoading || categories.isLoading;

  return (
    <AppShell
      search={search}
      onSearchChange={setSearch}
      onAuthClick={() => setAuthOpen(true)}
      onLogout={handleLogout}
      userLabel={user ? "Logout" : token ? "Logout" : "Sign in"}
      isSignedIn={Boolean(token)}
    >
      {token && user && isAdminLike(user) ? (
        <AdminWorkspace token={token} user={user} />
      ) : token && user && isRider(user) ? (
        <RiderWorkspace token={token} user={user} />
      ) : token && user && isStoreOwner(user) ? (
        <StoreOwnerWorkspace token={token} user={user} />
      ) : (
      <section className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="grid content-start gap-4">
          <div className="overflow-hidden rounded-lg border bg-card shadow-soft">
            <div className="grid gap-6 p-5 md:grid-cols-[1fr_15rem] md:p-6">
              <div className="grid content-center gap-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">React 18</Badge>
                  <Badge variant="outline">TypeScript</Badge>
                  <Badge variant="outline">Vite</Badge>
                  <Badge variant="outline">Electron ready</Badge>
                </div>
                <div>
                  <h1 className="text-2xl font-semibold tracking-normal sm:text-3xl">ServeNow web workspace</h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    A separate modern frontend connected to the current Node.js API, built without changing the existing HTML app.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button onClick={reloadAll}>
                    <RefreshCcw className="h-4 w-4" />
                    Refresh live data
                  </Button>
                  <Button variant="outline" onClick={() => setAuthOpen(true)}>
                    Sign in to API
                  </Button>
                </div>
              </div>
              <img
                src={assetUrl("/images/servenow_food_delivery.png")}
                alt="ServeNow delivery"
                className="h-full min-h-44 w-full rounded-md object-cover"
              />
            </div>
          </div>

          {hasError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              {hasError}. Current API: {API_DISPLAY_URL}.
            </div>
          ) : null}

          <Tabs defaultValue="stores">
            <TabsList>
              <TabsTrigger value="stores">Stores</TabsTrigger>
              <TabsTrigger value="products">Products</TabsTrigger>
            </TabsList>
            <TabsContent value="stores">
              {isLoading ? <LoadingGrid /> : <StoreGrid stores={filteredStores} />}
            </TabsContent>
            <TabsContent value="products">
              {isLoading ? <LoadingGrid /> : <ProductGrid products={filteredProducts} />}
            </TabsContent>
          </Tabs>
        </div>

        <aside className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Live API Snapshot</CardTitle>
              <CardDescription>Loaded from the existing Express routes.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Metric icon={StoreIcon} label="Stores" value={stores.data?.length || 0} />
              <Metric icon={PackageCheck} label="Products" value={products.data?.length || 0} />
              <Metric icon={Activity} label="Categories" value={categories.data?.length || 0} />
              <Metric icon={Truck} label="Desktop shell" value={window.servenowDesktop?.isDesktop ? "Electron" : "Browser"} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Categories</CardTitle>
              <CardDescription>Quick catalog groups from `/api/categories`.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {(categories.data || []).slice(0, 12).map((category) => (
                <Badge key={category.id} variant="outline">
                  {category.name}
                </Badge>
              ))}
              {!categories.data?.length && !categories.isLoading ? <span className="text-sm text-muted-foreground">No categories loaded.</span> : null}
            </CardContent>
          </Card>
        </aside>
      </section>
      )}

      <AuthDialog open={authOpen} onOpenChange={setAuthOpen} onAuth={handleAuth} />
    </AppShell>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-background p-3">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="h-64 animate-pulse rounded-lg border bg-muted/70" />
      ))}
    </div>
  );
}
