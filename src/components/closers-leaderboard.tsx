import { Trophy } from "lucide-react";
import { hasSales } from "@/lib/leaderboard";
import { cn } from "@/lib/utils";

export interface LeaderboardEntry {
  userId: string;
  name: string;
  sales: number;
  ca?: number;
  /** Part reversée au closer ce mois. */
  commission?: number;
  rdv?: number;
}

interface ClosersLeaderboardProps {
  entries: LeaderboardEntry[];
  showCa?: boolean;
  currentUserId?: string;
}

const RANK_COLORS = ["text-yellow-500", "text-gray-400", "text-amber-700"];

export function ClosersLeaderboard({
  entries,
  showCa = false,
  currentUserId,
}: ClosersLeaderboardProps) {
  if (!hasSales(entries)) return null;

  return (
    <div className="rounded-xl border border-border bg-background p-6 shadow-sm">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">
        Classement des closers (ce mois)
      </h3>
      <ul className="space-y-2">
          {entries.map((entry, i) => (
            <li
              key={entry.userId}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2",
                entry.userId === currentUserId ? "bg-muted" : ""
              )}
            >
              <span className="w-6 shrink-0 flex items-center justify-center">
                {i < 3 ? (
                  <Trophy className={cn("h-4 w-4", RANK_COLORS[i])} />
                ) : (
                  <span className="text-xs text-muted-foreground">{i + 1}</span>
                )}
              </span>
              <span className="flex-1 truncate text-sm font-medium text-foreground">
                {entry.name}
              </span>
              {entry.rdv !== undefined && (
                <span className="text-xs text-muted-foreground">
                  {entry.rdv} RDV
                </span>
              )}
              <span className="text-sm font-semibold text-foreground">
                {entry.sales} vente{entry.sales > 1 ? "s" : ""}
              </span>
              {showCa && entry.ca !== undefined && (
                <span className="w-20 shrink-0 text-right">
                  <span className="block text-sm font-semibold text-green-600">
                    {entry.ca.toLocaleString("fr-FR")} €
                  </span>
                  {entry.commission !== undefined && (
                    <span
                      className="block text-xs text-muted-foreground"
                      title="Rémunération du closer : tout ce qui dépasse 1 000 € HT par vente"
                    >
                      dont {entry.commission.toLocaleString("fr-FR")} €
                    </span>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
    </div>
  );
}
