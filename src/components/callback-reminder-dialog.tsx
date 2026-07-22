"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Date du lendemain au format YYYY-MM-DD (heure locale), valeur par défaut du
 * rappel : un closer refait sa pile « à rappeler » le lendemain matin.
 */
function tomorrowLocalDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

interface CallbackReminderDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly prospectId: string;
  readonly prospectName: string;
  /** Appelé après création réussie du rappel (rafraîchissement des listes). */
  readonly onCreated?: () => void;
}

/**
 * Prompt proposé au passage d'une fiche en « À rappeler » : crée un rappel
 * daté en un clic. Toujours annulable — le statut est déjà changé, seul le
 * rappel est optionnel.
 */
export function CallbackReminderDialog({
  open,
  onOpenChange,
  prospectId,
  prospectName,
  onCreated,
}: CallbackReminderDialogProps) {
  const [dueDate, setDueDate] = useState(tomorrowLocalDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  /** Toute fermeture repart d'un état propre pour la prochaine ouverture. */
  function handleOpenChange(next: boolean) {
    if (!next) {
      setDueDate(tomorrowLocalDate());
      setError(false);
    }
    onOpenChange(next);
  }

  async function handleConfirm() {
    if (!dueDate || saving) return;
    setSaving(true);
    setError(false);

    // Parse local (et non new Date("YYYY-MM-DD") qui décale d'un jour en UTC).
    const [y, m, d] = dueDate.split("-").map(Number);

    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prospectId,
          title: `Rappeler ${prospectName}`,
          description: "",
          dueDate: new Date(y!, m! - 1, d!),
        }),
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      handleOpenChange(false);
      onCreated?.();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm" data-test="callback-reminder-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            Programmer le rappel
          </DialogTitle>
          <DialogDescription>
            {`Quand faut-il rappeler ${prospectName} ? Le rappel apparaîtra sur le tableau de bord.`}
          </DialogDescription>
        </DialogHeader>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm"
          autoFocus
          data-test="callback-reminder-date"
        />
        {error && (
          <p className="text-sm font-medium text-red-700">
            Impossible de créer le rappel — réessaie.
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            data-test="callback-reminder-skip"
          >
            Sans rappel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!dueDate || saving}
            data-test="callback-reminder-confirm"
          >
            {saving && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            )}
            {saving ? "Création…" : "Créer le rappel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
