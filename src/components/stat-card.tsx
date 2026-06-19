import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, type LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: number | string;
  change?: number;
  icon: LucideIcon;
  iconColor?: string;
}

export function StatCard({
  title,
  value,
  change,
  icon: Icon,
  iconColor = "text-primary",
}: StatCardProps) {
  return (
    <div className="rounded-xl border border-border bg-background p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <div
          className={cn(
            "h-10 w-10 rounded-lg flex items-center justify-center bg-muted",
            iconColor
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-3 flex items-end gap-2">
        <p className="text-3xl font-semibold text-foreground">{value}</p>
        {change !== undefined && change !== 0 && (
          <span
            className={cn(
              "flex items-center gap-0.5 text-xs font-medium mb-1",
              change > 0 ? "text-green-600" : "text-red-600"
            )}
          >
            {change > 0 ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {change > 0 ? "+" : ""}
            {change}%
          </span>
        )}
      </div>
    </div>
  );
}
