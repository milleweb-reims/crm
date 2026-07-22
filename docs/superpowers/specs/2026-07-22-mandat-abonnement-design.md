# Lien de mandat pour l'abonnement mensuel — Design

**Date** : 2026-07-22
**Statut** : validé

## Objectif

Permettre de générer, copier et envoyer un lien GoCardless de signature de
mandat SEPA pour l'abonnement mensuel du client (hébergement, maintenance,
mises à jour — 29 €/mois HT par défaut), sur le même principe que le lien de
paiement du site existant. À la signature du mandat, l'abonnement mensuel est
créé automatiquement via le webhook.

## Décisions produit

| Décision | Choix |
|---|---|
| Création de l'abonnement | Automatique via webhook à la signature du mandat |
| Montant | `subscriptionAmount` par prospect, défaut 29 € HT, éditable admin uniquement (comme `quoteAmount`) |
| TVA | Montant HT saisi ; le client est prélevé du TTC (`ttcFromHt`) |
| Premier prélèvement | Signature + 1 mois (`start_date` de la subscription) |
| UI | Section « Abonnement » dans la carte « Devis & paiement » existante |
| Envoi par email | Oui, route `send` dédiée avec template adapté |
| Facturation Qonto des prélèvements mensuels | Oui — `generateSubscriptionInvoice` à chaque prélèvement confirmé : facture Qonto au montant prélevé (libellé « Abonnement site — {mois} »), trace en activité (pas sur les champs uniques du prospect), email au client avec PDF. Idempotence partagée avec l'activité de prélèvement (une facture par paymentId). |

## Architecture

Mécanique GoCardless : billing request avec `mandate_request` (scheme
`sepa_core`) au lieu de `payment_request`, puis billing request flow →
`authorisation_url`. Le mandat seul ne prélève rien : le webhook crée ensuite
la subscription mensuelle sur le mandat signé.

### 1. Modèle prospect (`lib/models/prospect.model.ts` + `types/index.ts`)

Nouveaux champs :

- `subscriptionAmount: Number` (défaut 29) — € HT/mois
- `mandateLink`, `mandateLinkCreatedAt`, `gcMandateBillingRequestId` — miroir
  des champs du lien de paiement
- `gcMandateId`, `mandateSignedAt` — renseignés par le webhook à la signature
- `gcSubscriptionId`, `subscriptionStartDate` — renseignés à la création auto
  de la subscription

### 2. Client GoCardless (`lib/gocardless.ts`)

- `createProspectMandateLink(prospect)` : billing request `{ mandate_request:
  { scheme: "sepa_core", currency: "EUR", metadata } }` avec metadata
  `prospect_id` **et `purpose: "subscription_mandate"`** (sur la billing
  request ET la mandate_request) — marqueur permettant au webhook de
  distinguer les billing requests de mandat de celles de paiement. Puis
  billing request flow avec `prefilled_customer` → `authorisation_url`.
- `createSubscription({ mandateId, amountHt, name, prospectId, startDate })` :
  `POST /subscriptions` — `amount` = TTC en centimes, `currency: "EUR"`,
  `interval_unit: "monthly"`, `start_date` = signature + 1 mois,
  `links.mandate`, metadata `prospect_id`.
- `cancelBillingRequest` existant réutilisé pour la régénération.

### 3. Routes API

- `POST /api/prospects/[id]/mandate-link` : copie du pattern `payment-link` —
  auth session, 404, montant requis, idempotent (`existing: true` si
  `mandateLink` présent), `{ regenerate: true }` annule l'ancienne billing
  request, sauvegarde des champs, activité « 🔗 Lien de mandat généré », émission
  `prospect:updated`.
- `POST /api/prospects/[id]/mandate-link/send` : copie du pattern
  `payment-link/send` — email au prospect avec le lien et le montant mensuel
  TTC (« mandat de prélèvement pour votre abonnement de X €/mois TTC —
  hébergement, maintenance et mises à jour »), activité « 📧 ».
- `POST /api/prospects/[id]/subscription` : rattrapage (pattern « facture
  Qonto non générée ») — crée l'abonnement sur le mandat signé si la création
  automatique du webhook a échoué. Idempotent via `gcSubscriptionId` ; si la
  date signature + 1 mois est passée, `start_date` est omise (GoCardless
  prélève à la première date possible).
- `PUT /api/prospects/[id]` : `subscriptionAmount` accepté, gardé admin
  uniquement (même mécanique que `processQuoteAmountField`).

### 4. Webhook (`app/api/webhooks/gocardless/route.ts`)

Deux régressions potentielles à neutraliser :

- **`billing_requests/fulfilled`** : le handler actuel suppose un paiement ;
  une billing request de mandat aboutie passerait dans le fallback et
  marquerait le prospect « payé » à tort. Routage préalable : si l'événement
  correspond à un mandat (metadata `purpose` ou `gcMandateBillingRequestId`),
  traiter le flux mandat : enregistrer `gcMandateId` (lien
  `mandate_request_mandate`) + `mandateSignedAt`, créer la subscription
  (start_date +1 mois), sauvegarder `gcSubscriptionId` +
  `subscriptionStartDate`, activité « ✍️ Mandat signé » + « 🔁 Abonnement créé »,
  email admin, événement temps réel. Ne PAS toucher au statut « payé ».
- **`payments/confirmed`** : les prélèvements mensuels de la subscription
  arrivent ici. Détection via `links.subscription` sur le paiement → activité
  « 💰 Prélèvement abonnement reçu (X €) », sans marquage « payé » ni facture
  Qonto.

Idempotence webhook : ne pas recréer de subscription si `gcSubscriptionId`
déjà présent.

### 5. UI (`components/payment-link-card.tsx`)

Section « Abonnement » ajoutée sous la section lien de paiement :

- Montant mensuel éditable en ligne (admin, défaut 29) avec affichage TTC
- Générer / copier / envoyer par email / régénérer le lien de mandat
- Statut : « Mandat signé le X », puis « Abonnement actif — 1er prélèvement
  le X »

## Gestion d'erreurs

Identique au lien de paiement : `GoCardlessError` avec statuts 500 (config/
token) et 502 (API), messages français, `console.error` avec IDs contextuels.
Échec de création de subscription dans le webhook : logguer + email admin
(le mandat reste enregistré, la subscription peut être recréée).

## Tests / vérification

`npx tsc --noEmit` + lint. Vérification manuelle du parcours en sandbox
GoCardless si configurée.
