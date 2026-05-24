import { Bell, Menu, MonitorSmartphone, Search, ShoppingCart, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { assetUrl } from "@/lib/api";

type AppShellProps = {
  children: React.ReactNode;
  onAuthClick: () => void;
  onLogout: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  userLabel: string;
  isSignedIn: boolean;
};

export function AppShell({ children, onAuthClick, onLogout, search, onSearchChange, userLabel, isSignedIn }: AppShellProps) {
  const isDesktop = Boolean(window.servenowDesktop?.isDesktop);

  return (
    <div className="app-surface min-h-screen">
      <header className="sticky top-0 z-40 border-b bg-background/92 backdrop-blur">
        <div className="container flex h-16 items-center gap-4">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex min-w-0 items-center gap-3">
            <img className="h-9 w-9 rounded-md object-cover" src={assetUrl("/images/servenow_brand_logo.png")} alt="ServeNow" />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold leading-5">ServeNow</p>
              <p className="truncate text-xs text-muted-foreground">React web workspace</p>
            </div>
          </div>
          <div className="relative ml-auto hidden w-full max-w-md md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              className="pl-9"
              placeholder="Search stores, products, categories"
            />
          </div>
          {isDesktop ? (
            <Badge variant="outline" className="hidden gap-1.5 xl:inline-flex">
              <MonitorSmartphone className="h-3.5 w-3.5" />
              Desktop
            </Badge>
          ) : null}
          <Button variant="ghost" size="icon" aria-label="Notifications">
            <Bell className="h-5 w-5" />
          </Button>
          <Button variant="outline" size="icon" aria-label="Cart">
            <ShoppingCart className="h-5 w-5" />
          </Button>
          <Button onClick={isSignedIn ? onLogout : onAuthClick} variant={isSignedIn ? "outline" : "default"} className="hidden sm:inline-flex">
            <UserRound className="h-4 w-4" />
            {userLabel}
          </Button>
        </div>
        <div className="container pb-3 md:hidden">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              className="pl-9"
              placeholder="Search ServeNow"
            />
          </div>
        </div>
      </header>
      <main className="container py-6">{children}</main>
    </div>
  );
}
