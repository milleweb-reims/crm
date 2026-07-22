"use client";

import { useState } from "react";
import {
  Check,
  Copy,
  CreditCard,
  Download,
  FileText,
  Pencil,
  RefreshCw,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, CardContent } from "@/components/ui/card";
import { SubscriptionMandateSection } from "@/components/subscription-mandate-section";
import { ttcFromHt } from "@/lib/vat";
import type { IProspect } from "@/types";

interface PaymentLinkCardProps {
  readonly prospect: IProspect;
  readonly onUpdated: () => void;
  /** Seul un admin peut définir ou modifier le montant du devis. */
  readonly canEditQuote: boolean;
  readonly className?: string;
}

/**
 * Carte « Devis & paiement » : montant du devis éditable en ligne, puis
 * génération / copie / envoi du lien de paiement GoCardless correspondant.
 */
export function PaymentLinkCard({ prospect, onUpdated, canEditQuote, className }: PaymentLinkCardProps) {
  const [editingQuote, setEditingQuote] = useState(false);
  const [quoteInput, setQuoteInput] = useState("");
  const [savingQuote, setSavingQuote] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingInvoice, setGeneratingInvoice] = useState(false);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const prospectEmail =
    prospect.email || prospect.emails?.individual || prospect.emails?.contact;
  const hasQuote = !!prospect.quoteAmount && prospect.quoteAmount > 0;

  function startEditQuote() {
    // Prix par défaut d'un site : 500 €
    setQuoteInput(prospect.quoteAmount ? String(prospect.quoteAmount) : "500");
    setEditingQuote(true);
  }

  async function handleSaveQuote() {
    const amount = Number(quoteInput.replace(",", "."));
    if (!amount || amount <= 0) {
      setError("Montant invalide");
      return;
    }
    setSavingQuote(true);
    setError(null);
    try {
      const res = await fetch(`/api/prospects/${prospect._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteAmount: amount }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Échec de l'enregistrement du devis");
        return;
      }
      setEditingQuote(false);
      onUpdated();
    } catch {
      setError("Erreur réseau — réessaie");
    } finally {
      setSavingQuote(false);
    }
  }

  async function handleGenerate(regenerate = false) {
    setGenerating(true);
    setError(null);
    setSentTo(null);
    try {
      const res = await fetch(`/api/prospects/${prospect._id}/payment-link`, {
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

  // Rattrapage : paiement reçu mais facture Qonto non générée (admin)
  async function handleGenerateInvoice() {
    setGeneratingInvoice(true);
    setError(null);
    try {
      const res = await fetch(`/api/prospects/${prospect._id}/invoice`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Échec de la génération de la facture");
        return;
      }
      onUpdated();
    } catch {
      setError("Erreur réseau — réessaie");
    } finally {
      setGeneratingInvoice(false);
    }
  }

  async function handleCopy() {
    if (!prospect.paymentLink) return;
    await navigator.clipboard.writeText(prospect.paymentLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/prospects/${prospect._id}/payment-link/send`,
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
    <Card className={className}>
      <div className="flex items-center justify-between">
        <CardTitle>Devis &amp; paiement</CardTitle>
        <CreditCard className="h-4 w-4 text-muted-foreground" />
      </div>
      <CardContent className="mt-4 space-y-4">
        {/* Montant du devis */}
        {editingQuote && canEditQuote ? (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <input
                type="number"
                min="0"
                step="50"
                value={quoteInput}
                onChange={(e) => setQuoteInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveQuote()}
                placeholder="500"
                autoFocus
                className="h-10 w-40 rounded-lg border border-border bg-background pl-3 pr-12 text-sm"
                data-test="quote-amount-input"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                € HT
              </span>
            </div>
            <Button
              size="sm"
              disabled={savingQuote}
              onClick={handleSaveQuote}
              data-test="save-quote"
            >
              {savingQuote ? "Enregistrement…" : "Enregistrer"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditingQuote(false)}
            >
              Annuler
            </Button>
          </div>
        ) : (
          <div className="flex items-end justify-between gap-2">
            <div>
              <p className="text-xs text-muted-foreground">Montant du devis</p>
              <p className="text-3xl font-semibold text-foreground">
                {hasQuote
                  ? `${prospect.quoteAmount!.toLocaleString("fr-FR")} € HT`
                  : "—"}
              </p>
              {hasQuote && (
                <p className="text-xs text-muted-foreground">
                  soit {ttcFromHt(prospect.quoteAmount!).toLocaleString("fr-FR")} € TTC
                  payés par le client
                </p>
              )}
            </div>
            {canEditQuote && (
              <Button
                variant="outline"
                size="sm"
                onClick={startEditQuote}
                data-test="edit-quote"
              >
                <Pencil className="h-4 w-4" />
                {hasQuote ? "Modifier" : "Définir le devis"}
              </Button>
            )}
          </div>
        )}

        <div className="border-t border-border" />

        {/* Lien de paiement */}
        {!prospect.paymentLink ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {hasQuote
                ? "Aucun lien de paiement pour ce client."
                : canEditQuote
                  ? "Définis le devis pour générer le lien de paiement."
                  : "Le montant du devis doit être défini par un admin."}
            </p>
            <Button
              size="sm"
              disabled={!hasQuote || generating}
              onClick={() => handleGenerate(false)}
              data-test="generate-payment-link"
            >
              <CreditCard className="h-4 w-4" />
              {generating ? "Génération…" : "Générer le lien"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/50 px-3 py-2">
              <a
                href={prospect.paymentLink}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-sm text-primary hover:underline"
              >
                {prospect.paymentLink}
              </a>
              <div className="mt-1 flex items-center justify-between gap-2">
                {prospect.paymentLinkCreatedAt ? (
                  <p className="text-xs text-muted-foreground">
                    Généré le{" "}
                    {new Date(prospect.paymentLinkCreatedAt).toLocaleDateString(
                      "fr-FR",
                      { day: "numeric", month: "long", year: "numeric" }
                    )}
                  </p>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  disabled={generating}
                  onClick={() => handleGenerate(true)}
                  title="Annule l'ancien lien et en crée un nouveau (devis modifié, lien expiré…)"
                  data-test="regenerate-payment-link"
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
                data-test="copy-payment-link"
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
                data-test="send-payment-link"
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

        {/* Abonnement mensuel : mandat de prélèvement + création auto de la subscription */}
        <SubscriptionMandateSection
          prospect={prospect}
          onUpdated={onUpdated}
          canEditAmount={canEditQuote}
        />

        {/* Facture Qonto générée à la réception du paiement */}
        {(prospect.qontoInvoiceNumber || prospect.qontoInvoiceUrl) && (
          <>
            <div className="border-t border-border" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm text-foreground">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                Facture
                {prospect.qontoInvoiceNumber
                  ? ` n° ${prospect.qontoInvoiceNumber}`
                  : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                {prospect.qontoInvoiceUrl && (
                  <a
                    href={prospect.qontoInvoiceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button variant="outline" size="sm" data-test="view-invoice">
                      <FileText className="h-4 w-4" />
                      Voir la facture
                    </Button>
                  </a>
                )}
                <a href={`/api/prospects/${prospect._id}/invoice`} download>
                  <Button variant="outline" size="sm" data-test="download-invoice">
                    <Download className="h-4 w-4" />
                    Télécharger
                  </Button>
                </a>
              </div>
            </div>
          </>
        )}

        {/* Rattrapage : payé mais pas de facture (échec de la génération auto) */}
        {canEditQuote &&
          prospect.paidAt &&
          !prospect.qontoInvoiceId &&
          !prospect.qontoInvoiceNumber && (
          <>
            <div className="border-t border-border" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                Paiement reçu mais facture Qonto non générée.
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={generatingInvoice}
                onClick={handleGenerateInvoice}
                data-test="generate-invoice"
              >
                <FileText className="h-4 w-4" />
                {generatingInvoice ? "Génération…" : "Générer la facture"}
              </Button>
            </div>
          </>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}
