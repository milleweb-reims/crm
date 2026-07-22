"use client";

import { useState } from "react";
import { Check, Copy, Pencil, RefreshCw, Repeat, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ttcFromHt } from "@/lib/vat";
import type { IProspect } from "@/types";

interface SubscriptionMandateSectionProps {
  readonly prospect: IProspect;
  readonly onUpdated: () => void;
  /** Seul un admin peut modifier le montant de l'abonnement. */
  readonly canEditAmount: boolean;
}

function formatDateFr(date: Date | string): string {
  return new Date(date).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Section « Abonnement » de la carte « Devis & paiement » : montant mensuel
 * éditable, génération / copie / envoi du lien de mandat GoCardless, puis suivi
 * du mandat signé et de l'abonnement créé automatiquement par le webhook.
 */
export function SubscriptionMandateSection({
  prospect,
  onUpdated,
  canEditAmount,
}: SubscriptionMandateSectionProps) {
  const [editingAmount, setEditingAmount] = useState(false);
  const [amountInput, setAmountInput] = useState("");
  const [savingAmount, setSavingAmount] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const prospectEmail =
    prospect.email || prospect.emails?.individual || prospect.emails?.contact;
  // Prix par défaut de l'abonnement : 29 € HT/mois
  const amountHt = prospect.subscriptionAmount ?? 29;
  const subscriptionActive = !!prospect.gcSubscriptionId;

  function startEditAmount() {
    setAmountInput(String(amountHt));
    setEditingAmount(true);
  }

  async function handleSaveAmount() {
    const amount = Number(amountInput.replace(",", "."));
    if (!amount || amount <= 0) {
      setError("Montant invalide");
      return;
    }
    setSavingAmount(true);
    setError(null);
    try {
      const res = await fetch(`/api/prospects/${prospect._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionAmount: amount }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Échec de l'enregistrement du montant");
        return;
      }
      setEditingAmount(false);
      onUpdated();
    } catch {
      setError("Erreur réseau — réessaie");
    } finally {
      setSavingAmount(false);
    }
  }

  async function handleGenerate(regenerate = false) {
    setGenerating(true);
    setError(null);
    setSentTo(null);
    try {
      const res = await fetch(`/api/prospects/${prospect._id}/mandate-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Échec de la génération du lien");
        return;
      }
      onUpdated();
    } catch {
      setError("Erreur réseau — réessaie");
    } finally {
      setGenerating(false);
    }
  }

  // Rattrapage : mandat signé mais création auto de l'abonnement échouée
  async function handleCreateSubscription() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/prospects/${prospect._id}/subscription`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Échec de la création de l'abonnement");
        return;
      }
      onUpdated();
    } catch {
      setError("Erreur réseau — réessaie");
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy() {
    if (!prospect.mandateLink) return;
    await navigator.clipboard.writeText(prospect.mandateLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/prospects/${prospect._id}/mandate-link/send`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Échec de l'envoi de l'email");
        return;
      }
      setSentTo(data.to);
      onUpdated();
    } catch {
      setError("Erreur réseau — réessaie");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="border-t border-border" />
      <div className="space-y-3">
        {/* Montant de l'abonnement */}
        {editingAmount && canEditAmount ? (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <input
                type="number"
                min="0"
                step="1"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveAmount()}
                placeholder="29"
                autoFocus
                className="h-10 w-40 rounded-lg border border-border bg-background pl-3 pr-20 text-sm"
                data-test="subscription-amount-input"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                € HT/mois
              </span>
            </div>
            <Button
              size="sm"
              disabled={savingAmount}
              onClick={handleSaveAmount}
              data-test="save-subscription-amount"
            >
              {savingAmount ? "Enregistrement…" : "Enregistrer"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditingAmount(false)}
            >
              Annuler
            </Button>
          </div>
        ) : (
          <div className="flex items-end justify-between gap-2">
            <div>
              <p className="text-xs text-muted-foreground">Abonnement mensuel</p>
              <p className="text-xl font-semibold text-foreground">
                {amountHt.toLocaleString("fr-FR")} € HT/mois
              </p>
              <p className="text-xs text-muted-foreground">
                soit {ttcFromHt(amountHt).toLocaleString("fr-FR")} € TTC prélevés
                chaque mois
              </p>
            </div>
            {canEditAmount && !subscriptionActive && (
              <Button
                variant="outline"
                size="sm"
                onClick={startEditAmount}
                data-test="edit-subscription-amount"
              >
                <Pencil className="h-4 w-4" />
                Modifier
              </Button>
            )}
          </div>
        )}

        {/* Statut de l'abonnement / du mandat / du lien */}
        {subscriptionActive ? (
          <p className="text-sm text-green-600" data-test="subscription-active">
            Abonnement actif
            {prospect.mandateSignedAt
              ? ` — mandat signé le ${formatDateFr(prospect.mandateSignedAt)}`
              : ""}
            {prospect.subscriptionStartDate
              ? ` — 1er prélèvement le ${formatDateFr(prospect.subscriptionStartDate)}`
              : ""}
            .
          </p>
        ) : prospect.mandateSignedAt ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" data-test="mandate-signed">
              ✍️ Mandat signé le {formatDateFr(prospect.mandateSignedAt)} —
              abonnement pas encore actif.
            </p>
            {canEditAmount && (
              <Button
                size="sm"
                disabled={creating}
                onClick={handleCreateSubscription}
                title="À utiliser si la création automatique par le webhook a échoué"
                data-test="create-subscription"
              >
                <Repeat className="h-4 w-4" />
                {creating ? "Création…" : "Créer l'abonnement"}
              </Button>
            )}
          </div>
        ) : !prospect.mandateLink ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Aucun lien de mandat pour ce client.
            </p>
            <Button
              size="sm"
              disabled={generating}
              onClick={() => handleGenerate(false)}
              data-test="generate-mandate-link"
            >
              <Repeat className="h-4 w-4" />
              {generating ? "Génération…" : "Générer le lien de mandat"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/50 px-3 py-2">
              <a
                href={prospect.mandateLink}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-sm text-primary hover:underline"
              >
                {prospect.mandateLink}
              </a>
              <div className="mt-1 flex items-center justify-between gap-2">
                {prospect.mandateLinkCreatedAt ? (
                  <p className="text-xs text-muted-foreground">
                    Généré le {formatDateFr(prospect.mandateLinkCreatedAt)}
                  </p>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  disabled={generating}
                  onClick={() => handleGenerate(true)}
                  title="Annule l'ancien lien et en crée un nouveau (montant modifié, lien expiré…)"
                  data-test="regenerate-mandate-link"
                  className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-xs font-medium text-foreground hover:underline disabled:cursor-default disabled:opacity-50"
                >
                  <RefreshCw className={`h-3 w-3 ${generating ? "animate-spin" : ""}`} />
                  Régénérer
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                data-test="copy-mandate-link"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copié !" : "Copier"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!prospectEmail || sending}
                title={
                  prospectEmail
                    ? `Envoyer à ${prospectEmail}`
                    : "Ce prospect n'a pas d'email"
                }
                onClick={handleSend}
                data-test="send-mandate-link"
              >
                <Send className="h-4 w-4" />
                {sending ? "Envoi…" : "Envoyer par email"}
              </Button>
            </div>
            {sentTo && (
              <p className="text-xs text-green-600">Email envoyé à {sentTo}.</p>
            )}
          </div>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </>
  );
}
