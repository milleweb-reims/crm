import Link from "next/link";
import { ExternalLink, Globe } from "lucide-react";

export interface DeliveryItem {
  _id: string;
  name: string;
  address?: { city?: string };
  paidAt: string | null;
  devUrl: string | null;
}

interface DeliveryListProps {
  items: DeliveryItem[];
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
}

export function DeliveryList({ items }: DeliveryListProps) {
  return (
    <div className="rounded-xl border border-border bg-background p-6 shadow-sm">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">
        Sites à livrer
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucun site en attente de livraison 🎉
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item._id} className="flex items-center gap-3 py-3">
              <div className="flex-1 min-w-0">
                <Link
                  href={`/prospects/${item._id}`}
                  className="text-sm font-medium text-foreground hover:underline truncate block"
                  data-test="delivery-item-link"
                >
                  {item.name}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {item.address?.city || "Ville inconnue"} · payé le{" "}
                  {formatDate(item.paidAt)}
                </p>
              </div>
              {item.devUrl ? (
                <a
                  href={item.devUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                  data-test="delivery-item-devurl"
                >
                  <Globe className="h-3.5 w-3.5" />
                  Dev
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span className="text-xs text-red-500 font-medium">
                  URL dev manquante
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
