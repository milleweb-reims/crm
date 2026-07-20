"use client";

import { useState } from "react";
import { Link2, Loader2, Check, ExternalLink } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

interface DevUrlCardProps {
  prospectId: string;
  devUrl: string | null;
  onUpdated?: () => void;
}

export function DevUrlCard({ prospectId, devUrl, onUpdated }: DevUrlCardProps) {
  const [value, setValue] = useState(devUrl || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/prospects/${prospectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ devUrl: value.trim() || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Impossible d'enregistrer le lien");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onUpdated?.();
    } catch {
      setError("Erreur réseau — réessaie");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <div className="flex flex-1 min-w-[220px] items-center gap-2">
        <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          type="url"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Lien du site en démo…"
          className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm"
          data-test="dev-url-input"
        />
        <Button variant="outline" size="sm" onClick={handleSave} disabled={saving} data-test="dev-url-save">
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : saved ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            "Enregistrer"
          )}
        </Button>
      </div>
      {devUrl && (
        <a
          href={devUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ size: "sm" })}
          data-test="dev-url-view"
        >
          <ExternalLink className="h-4 w-4" />
          Voir le site
        </a>
      )}
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </div>
  );
}
