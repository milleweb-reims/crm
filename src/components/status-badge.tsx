import { Badge, type BadgeProps } from "@/components/ui/badge";
import { PROSPECT_STATUSES, type ProspectStatus } from "@/types";

interface StatusBadgeProps {
  status: ProspectStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = PROSPECT_STATUSES.find((s) => s.value === status);
  if (!config) return null;

  return (
    <Badge
      variant={config.color as BadgeProps["variant"]}
      className={className}
    >
      {config.label}
    </Badge>
  );
}
