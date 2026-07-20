export const DAY_LABELS_FR: Readonly<Record<string, string>> = {
  monday: "Lundi",
  tuesday: "Mardi",
  wednesday: "Mercredi",
  thursday: "Jeudi",
  friday: "Vendredi",
  saturday: "Samedi",
  sunday: "Dimanche",
};

/**
 * Convertit les valeurs Google du type "7-am-11-pm", "7:30-am-11-pm" ou
 * "730-am-6-pm" (minutes sans deux-points) en "7h – 23h" / "7h30 – 18h".
 */
export function formatHoursFr(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (lower === "closed") return "Fermé";
  if (lower === "open-24-hours" || lower === "open 24 hours") return "24h/24";

  const toFr = (options: {
    readonly hours: number;
    readonly minutes: string | undefined;
    readonly meridiem: string;
  }) => {
    const hour = (options.hours % 12) + (options.meridiem === "pm" ? 12 : 0);
    return `${hour}h${options.minutes ?? ""}`;
  };

  const match = lower.match(
    /^(\d{1,2})(?::?(\d{2}))?-(am|pm)-(\d{1,2})(?::?(\d{2}))?-(am|pm)$/
  );
  if (!match) return raw;
  const [, h1, m1, mer1, h2, m2, mer2] = match;
  return `${toFr({ hours: Number(h1), minutes: m1, meridiem: mer1! })} – ${toFr({ hours: Number(h2), minutes: m2, meridiem: mer2! })}`;
}
