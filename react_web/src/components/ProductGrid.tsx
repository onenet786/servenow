import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { assetUrl } from "@/lib/api";
import type { Product } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

export function ProductGrid({ products }: { products: Product[] }) {
  if (!products.length) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No products found.</p>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {products.map((product) => {
        const activePrice = product.promotional_price || product.price;
        const hasOffer = Boolean(Number(product.has_active_offer)) || Boolean(product.promotional_price);
        return (
          <Card key={product.id} className="overflow-hidden">
            <div className="aspect-square bg-muted">
              <img src={assetUrl(product.image_url)} alt={product.name} className="h-full w-full object-cover" loading="lazy" />
            </div>
            <CardContent className="grid gap-3 p-4">
              <div className="min-w-0">
                <div className="mb-2 flex min-h-6 flex-wrap gap-2">
                  {product.category_name ? <Badge variant="outline">{product.category_name}</Badge> : null}
                  {hasOffer ? <Badge variant="secondary">{product.offer_badge || "Offer"}</Badge> : null}
                </div>
                <h3 className="line-clamp-2 min-h-10 text-sm font-semibold">{product.name}</h3>
                <p className="truncate text-xs text-muted-foreground">{product.store_name || "ServeNow catalog"}</p>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-base font-semibold">{formatCurrency(activePrice)}</p>
                  {hasOffer && product.original_price ? (
                    <p className="text-xs text-muted-foreground line-through">{formatCurrency(product.original_price)}</p>
                  ) : null}
                </div>
                <Button size="icon" aria-label={`Add ${product.name}`}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
