"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { UserCog } from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  closer: "Closer",
  dev: "Dev",
};

/**
 * Bandeau permanent affiché pendant une substitution.
 *
 * Il n'est pas décoratif : pendant une substitution, l'interface est celle du
 * compte visé (la navigation admin disparaît si c'est un closer). Sans ce
 * bandeau, l'admin n'aurait plus aucun moyen de revenir à son compte, et
 * surtout aucun signal qu'il écrit sous le nom de quelqu'un d'autre.
 */
export function ImpersonationBanner() {
  const { data: session } = useSession();
  const [stopping, setStopping] = useState(false);

  const impersonator = session?.impersonator;
  if (!impersonator) return null;

  const roleLabel = ROLE_LABELS[session.user.role] ?? session.user.role;

  async function handleStop() {
    setStopping(true);

    const res = await fetch("/api/impersonation", { method: "DELETE" }).catch(
      () => null
    );

    if (!res?.ok) {
      setStopping(false);
      return;
    }

    // Rechargement complet plutôt que router.refresh() : la substitution est
    // portée par un cookie lu côté serveur, et SessionProvider garde la session
    // en cache tant que le document n'est pas rechargé.
    window.location.assign("/");
  }

  return (
    <div
      className="sticky top-0 z-30 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-300 bg-amber-100 px-4 py-2.5 pl-16 text-sm text-amber-950 lg:pl-4"
      data-test="impersonation-banner"
    >
      <UserCog className="h-4 w-4 flex-shrink-0" />
      <p className="flex-1 min-w-0">
        Vous agissez en tant que{" "}
        <strong className="font-semibold">{session.user.name}</strong> ({roleLabel})
        — tout ce que vous enregistrez sera à son nom.
      </p>
      <button
        onClick={handleStop}
        disabled={stopping}
        className="flex-shrink-0 rounded-lg bg-amber-950 px-3 py-1.5 text-xs font-semibold text-amber-50 transition-colors hover:bg-amber-900 disabled:opacity-50 cursor-pointer"
        data-test="impersonation-stop"
      >
        {stopping ? "Retour…" : `Revenir à ${impersonator.name}`}
      </button>
    </div>
  );
}
