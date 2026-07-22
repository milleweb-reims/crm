"use client";

import { useState } from "react";
import { Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface RdvDateDialogProps {
  readonly open: boolean;
  readonly prospectName: string;
  readonly saving: boolean;
  /** Toute fermeture sans confirmation (Annuler, croix, Échap, clic dehors). */
  readonly onCancel: () => void;
  readonly onConfirm: (rdvDateTime: string) => void;
}

/**
 * Date/heure obligatoire pour passer une fiche en « RDV Démo » — un RDV sans
 * date n'existe pas. Même règle que le modal de la page détail, pour le drop
 * kanban : annuler rend la fiche à sa colonne d'origine.
 */
export function RdvDateDialog({
  open,
  prospectName,
  saving,
  onCancel,
  onConfirm,
}: RdvDateDialogProps) {
  const [dateTime, setDateTime] = useState("");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-sm" data-test="rdv-date-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            Fixer le rendez-vous
          </DialogTitle>
          <DialogDescription>
            {`Date et heure du RDV avec ${prospectName}. Sans date, la fiche reste à son statut actuel.`}
          </DialogDescription>
        </DialogHeader>
        <input
          type="datetime-local"
          value={dateTime}
          onChange={(e) => setDateTime(e.target.value)}
          className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm"
          autoFocus
          data-test="rdv-date-input"
        />
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={saving}
            data-test="rdv-date-cancel"
          >
            Annuler
          </Button>
          <Button
            onClick={() => onConfirm(dateTime)}
            disabled={!dateTime || saving}
            data-test="rdv-date-confirm"
          >
            {saving && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            )}
            {saving ? "Enregistrement…" : "Confirmer le RDV"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
