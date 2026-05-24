import { MapPin, Store as StoreIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { assetUrl } from "@/lib/api";
import type { Store } from "@/lib/types";

export function StoreGrid({ stores }: { stores: Store[] }) {
  if (!stores.length) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No stores found.</p>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {stores.map((store) => {
        const isClosed = Boolean(Number(store.is_closed));
        return (
          <Card key={store.id} className="overflow-hidden">
            <div className="aspect-[16/9] bg-muted">
              <img
                src={assetUrl(store.image_url || store.logo_url)}
                alt={store.name}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
            <CardContent className="grid gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold">{store.name}</h3>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{store.description || store.status_message || "Local ServeNow partner store"}</p>
                </div>
                <Badge variant={isClosed ? "muted" : "default"}>{isClosed ? "Closed" : "Open"}</Badge>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {store.address ? <MapPin className="h-4 w-4 shrink-0" /> : <StoreIcon className="h-4 w-4 shrink-0" />}
                <span className="truncate">{store.address || store.phone || "Store details available"}</span>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
