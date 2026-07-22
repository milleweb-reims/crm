import { PROSPECT_STATUSES } from "@/types";

interface ConversionFunnelProps {
  byStatus: Record<string, number>;
  total: number;
}

const FUNNEL_STEPS = ["prospect", "en_appel", "rdv", "lien_envoye", "paye"] as const;

const BAR_COLORS: Record<string, string> = {
  prospect: "bg-gray-400",
  en_appel: "bg-amber-500",
  rdv: "bg-blue-500",
  lien_envoye: "bg-violet-500",
  paye: "bg-green-500",
};

/**
 * « À rappeler » n'est pas une étape de progression : c'est la même macro-étape
 * que « En appel » (prospection téléphonique en boucle), donc ses fiches sont
 * comptées dans la barre « En appel » pour ne pas fausser les taux de conversion.
 */
function stepCount(byStatus: Record<string, number>, status: string): number {
  const base = byStatus[status] || 0;
  return status === "en_appel" ? base + (byStatus["a_rappeler"] || 0) : base;
}

export function ConversionFunnel({ byStatus, total }: ConversionFunnelProps) {
  const max = Math.max(...FUNNEL_STEPS.map((s) => stepCount(byStatus, s)), 1);

  return (
    <div className="rounded-xl border border-border bg-background p-6 shadow-sm">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">
        Funnel de conversion
      </h3>
      <div className="space-y-3">
        {FUNNEL_STEPS.map((status, i) => {
          const count = stepCount(byStatus, status);
          const label = PROSPECT_STATUSES.find((s) => s.value === status)?.label;
          const prev = i > 0 ? stepCount(byStatus, FUNNEL_STEPS[i - 1]!) : 0;
          const rate = i > 0 && prev > 0 ? Math.round((count / prev) * 100) : null;

          return (
            <div key={status} className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-xs text-muted-foreground">
                {label}
              </span>
              <div className="flex-1 h-6 rounded bg-muted overflow-hidden">
                <div
                  className={`h-full rounded ${BAR_COLORS[status]}`}
                  style={{ width: `${Math.max((count / max) * 100, count > 0 ? 2 : 0)}%` }}
                />
              </div>
              <span className="w-14 shrink-0 text-sm font-medium text-foreground text-right">
                {count}
              </span>
              <span className="w-12 shrink-0 text-xs text-muted-foreground text-right">
                {rate !== null ? `${rate}%` : ""}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        {`${total} prospects au total — les % indiquent la conversion depuis l'étape précédente`}
      </p>
    </div>
  );
}
