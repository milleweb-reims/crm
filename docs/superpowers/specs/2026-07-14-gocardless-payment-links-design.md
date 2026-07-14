# Liens de paiement GoCardless par prospect — Design

Date : 2026-07-14 · Statut : approuvé

## Objectif

Remplacer l'usage des deux liens de paiement fixes (`PAYMENT_LINKS`, templates partagés)
par un lien de paiement généré par prospect via l'API GoCardless, du montant du devis
(`quoteAmount`), avec matching fiable du prospect dans le webhook.

## Décisions

- **Un seul lien** par prospect, montant = `quoteAmount` (total du devis), devise EUR.
- **Instant Bank Pay** (one-off) avec `fallback_enabled: true` (repli prélèvement).
- **Génération manuelle** : bouton sur la fiche prospect (actif si `quoteAmount` renseigné).
- **Transmission** : lien copiable + bouton « Envoyer par email » (mailer SMTP existant).
- Les anciens liens fixes `PAYMENT_LINKS` sont conservés (header de la fiche).

## Architecture

### 1. Client API GoCardless — `src/lib/gocardless.ts`

- `createProspectPaymentLink(prospect)` :
  1. `POST /billing_requests` avec `payment_request { description, amount (centimes), currency: EUR }`,
     `fallback_enabled: true`, `metadata.prospect_id` sur le payment_request (recopiée par
     GoCardless sur le paiement final) et sur la billing request.
  2. `POST /billing_request_flows` lié à la billing request, client prérempli
     (email, raison sociale) → `authorisation_url` = lien à partager.
- `cancelBillingRequest(id)` : `POST /billing_requests/:id/actions/cancel` (best effort,
  utilisé à la régénération).
- Env : `GOCARDLESS_ACCESS_TOKEN`, `GOCARDLESS_ENVIRONMENT` (sandbox/live). Token manquant
  → erreur explicite « GoCardless non configuré ».

### 2. Modèle Prospect (+ types)

Champs ajoutés : `gcBillingRequestId: string|null`, `paymentLink: string|null`,
`paymentLinkCreatedAt: Date|null`.

### 3. API — `POST /api/prospects/[id]/payment-link`

Authentifiée (session). Vérifie `quoteAmount > 0`.
- Lien actif existant et pas de `{ regenerate: true }` → renvoie le lien existant (idempotent).
- `regenerate` → annule l'ancienne billing request (best effort) puis recrée.
- Stocke les champs, crée une Activity (`payment`, « 🔗 Lien de paiement généré (X €) »),
  émet `prospect:updated`.

### 4. API — `POST /api/prospects/[id]/payment-link/send`

Envoie le lien par email au prospect (email requis) via un `sendEmail(to, subject, html)`
générique extrait du mailer (`sendAdminEmail` refactoré dessus). Trace une Activity `email`.

### 5. UI — carte « Paiement » sur la fiche prospect

`src/components/payment-link-card.tsx` (client) : bouton Générer/Régénérer (désactivé sans
devis), lien affiché + Copier + Envoyer par email (si email prospect). Affiche la date de
génération et le montant.

### 6. Webhook — matching fiable

`resolvePayment` lit d'abord `payment.metadata.prospect_id` → `findById` direct.
Fallback email/nom conservé pour les paiements via les anciens liens fixes.

## Gestion d'erreurs

- Erreurs API GoCardless loguées avec contexte (prospectId, status, body) ; la route renvoie
  un message utilisateur clair (500/502).
- Régénération disponible si le flow a expiré ou si le devis change.

## Tests / vérification

- `pnpm lint` + `tsc` + build.
- Test manuel sandbox : génération lien, ouverture page hébergée, webhook confirmé.
