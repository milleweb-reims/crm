# Tarifs de création et d'abonnement par closer — Design

**Date** : 2026-08-12
**Statut** : validé

## Objectif

Chaque closer pratique ses propres prix. Le montant de création du site et
l'abonnement mensuel ne sont plus des données de la fiche prospect mais du
compte qui détient la fiche, et le lien GoCardless généré porte le montant du
closer concerné.

## Décisions produit

| Décision | Choix |
|---|---|
| Porteur du tarif | Le compte `User`, pas la fiche prospect |
| Prix appliqué | Celui du **détenteur de la fiche** (`assignedTo`), jamais celui de qui clique |
| Moment d'application | Dynamique : résolu à chaque lecture, rien n'est figé côté CRM |
| Surcharge par fiche | **Supprimée** — un prix négocié pour un seul client n'est plus possible |
| Qui configure | L'admin seul, dans Paramètres → Utilisateurs |
| Champs de constat sur la fiche | **Aucun** — le CRM ne mémorise pas ce que prélève un lien déjà émis |
| Abonnements déjà actifs | Jamais modifiés : changer un tarif n'affecte pas les prélèvements en cours |
| Fiches déjà payées | Non concernées — `paidAmount` et les factures Qonto sont ancrés sur le montant réellement prélevé |
| TVA | Tarifs saisis en HT ; le client est prélevé du TTC (`ttcFromHt`), inchangé |

### Conséquences assumées

Ces deux points découlent des décisions ci-dessus et sont acceptés :

1. **Un lien déjà envoyé ne suit pas le tarif.** GoCardless fige le montant à la
   création de la billing request. Après un changement de tarif, la fiche
   affichera le nouveau prix alors que le lien en circulation prélèvera
   l'ancien, et le CRM n'aura aucun moyen de signaler l'écart. La trace du
   montant réellement demandé subsiste uniquement dans l'activité de génération
   (`metadata.amount`) et, après paiement, dans `paidAmount`.
2. **Réattribuer une fiche change son prix.** Une fiche non entamée qui passe de
   Moh à Paul passe du tarif de Moh à celui de Paul.

## Architecture

### 1. Modèle `User` (`lib/models/user.model.ts` + `types/index.ts`)

Deux champs, sur **tous** les comptes et pas seulement les closers — un admin
peut lui aussi détenir une fiche (`resolveClaimant` le lui attribue quand elle
est libre), et poser le tarif sur tout compte évite un cas particulier dans la
résolution :

- `quoteAmount: Number` (défaut 500) — création du site, € HT
- `subscriptionAmount: Number` (défaut 29) — abonnement mensuel, € HT

`IUser` reçoit les deux champs en lecture seule.

### 2. Modèle `Prospect` (`lib/models/prospect.model.ts` + `types/index.ts`)

`quoteAmount` et `subscriptionAmount` sont **retirés** du schéma et de
`IProspect`. Aucun champ de remplacement.

### 3. Résolution du prix (`lib/pricing.ts`, nouveau)

Point de décision unique. Toute lecture de prix passe par lui.

```ts
export const DEFAULT_QUOTE_AMOUNT = 500;
export const DEFAULT_SUBSCRIPTION_AMOUNT = 29;

export interface ProspectPricing {
  readonly quoteAmount: number;
  readonly subscriptionAmount: number;
}

/** Tarifs du détenteur de la fiche, ou tarifs par défaut si elle est libre. */
export async function resolveProspectPricing(
  assignedTo: unknown
): Promise<ProspectPricing>;
```

- Accepte `assignedTo` sous ses trois formes réelles : `ObjectId` brut,
  document peuplé, ou `null`. La normalisation en identifiant est une fonction
  pure exportée (`holderIdOf`) pour être testable sans base.
- Fiche non attribuée, compte supprimé, ou tarif absent / non strictement
  positif → repli sur les constantes. Un tarif à 0 ou négatif ne doit jamais
  atteindre GoCardless.
- Une seule lecture `User.findById(...).select("quoteAmount subscriptionAmount")`.

### 4. Points de lecture à basculer

Les six lectures actuelles de `prospect.quoteAmount` / `prospect.subscriptionAmount`
passent par `resolveProspectPricing` :

| Fichier | Usage |
|---|---|
| `api/prospects/[id]/payment-link/route.ts` | Montant du lien de paiement + activité |
| `api/prospects/[id]/payment-link/send/route.ts` | Montant affiché dans l'email au client |
| `api/prospects/[id]/mandate-link/route.ts` | Montant mensuel du mandat |
| `api/prospects/[id]/mandate-link/send/route.ts` | Montant mensuel dans l'email |
| `api/prospects/[id]/subscription/route.ts` | Abonnement créé en rattrapage |
| `api/webhooks/gocardless/route.ts` (~376) | Abonnement créé à la signature du mandat |

La garde existante du lien de paiement (« Renseigne d'abord le montant du
devis », `payment-link/route.ts:34`) est **supprimée** : `resolveProspectPricing`
garantit par construction un montant strictement positif, il n'y a plus de
montant manquant possible.

Deux morceaux de code deviennent morts et sont retirés dans le même geste :

- `processAdminAmountField` (`api/prospects/[id]/route.ts:196`) et ses deux
  appels — plus aucun montant ne s'écrit sur une fiche ;
- `delete body.quoteAmount` (`api/prospects/route.ts:82`), qui protégeait la
  création d'un prospect par un closer.

### 5. Deux replis du webhook qui perdent leur source

Ces deux lignes s'appuyaient sur un montant stocké sur la fiche, qui disparaît :

- **`route.ts:220`** — `prospect.paidAmount = details.amount ?? prospect.quoteAmount ?? null`
  devient `details.amount ?? null`. En pratique le repli était déjà quasi mort :
  `details.amount` n'est `null` que si l'appel `/payments/{id}` échoue, cas où
  `prospectId` est également `null` et où aucune fiche n'est donc résolue.
- **`route.ts:498`** — `details.amount ?? ttcFromHt(prospect.subscriptionAmount ?? 29)`
  devient `details.amount ?? 0`. Inventer un montant sur une facture est pire
  que ne pas la produire, et le montant configuré ne dit de toute façon rien de
  ce qui a réellement été prélevé sur un abonnement lancé plus tôt. Aucun code
  à ajouter : la branche `else` existante traite déjà le montant non positif en
  journalisant et en appelant `notifyAdminSubscriptionInvoiceFailed`.

Aucun abonnement GoCardless existant n'est modifié nulle part : le tarif ne sert
qu'à la **création** d'une subscription.

### 6. API `PUT /api/users/[id]`

`ADMIN_EDITABLE` accueille `quoteAmount` et `subscriptionAmount`. Ils restent
hors de `SELF_EDITABLE` : un closer ne fixe pas son prix, même sur son propre
compte.

Validation, sur le modèle de `processAdminAmountField` : nombre fini
strictement positif, sinon 400 « Montant invalide ». Un champ absent du corps
n'est pas touché.

### 7. UI — Paramètres → Utilisateurs (`app/(dashboard)/settings/page.tsx`)

- Nouvelle colonne « Tarifs » affichant `690 € / 39 €` (création / mois),
  masquée sur mobile comme le sont déjà Email et Statut.
- Un crayon par ligne ouvre un dialogue à deux champs, sur le modèle du
  dialogue de suppression existant. Admin uniquement, et masqué pendant une
  substitution d'identité (comme le bouton de substitution).
- `data-test` : `edit-pricing-<userId>`, `pricing-quote`, `pricing-subscription`,
  `pricing-submit`.

### 8. UI — fiche prospect

La **saisie** du montant disparaît des deux cartes ; seul l'affichage du tarif
effectif reste.

- `components/payment-link-card.tsx` : suppression de `startEditQuote`,
  `handleSaveQuote` et de l'état d'édition associé.
- `components/subscription-mandate-section.tsx` : idem pour le montant mensuel.

Effet de bord corrigé au passage : ces deux cartes proposaient l'édition à un
closer alors que le serveur la refusait en 403 (`processAdminAmountField`).

Les montants effectifs sont exposés par `GET /api/prospects/[id]`, qui renvoie
la fiche augmentée d'un objet résolu `pricing: { quoteAmount, subscriptionAmount }`
— les cartes n'ont ainsi aucun calcul de prix à faire. `IProspect` reçoit
`pricing?: ProspectPricing` (optionnel : la liste `GET /api/prospects` ne le
renvoie pas, aucun écran de liste n'affiche de montant).

### 9. Reprise des données

Aucune migration nécessaire : les anciens champs deviennent inertes et ne sont
plus lus. Ils restent présents dans les documents Mongo existants, sans effet
(le schéma Mongoose en mode strict les ignore à l'écriture).

Les tarifs des comptes existants prennent les défauts du schéma (500 / 29), soit
exactement le comportement actuel : aucun prix ne change au déploiement.

## Gestion d'erreurs

- Compte détenteur introuvable ou base injoignable pendant la résolution :
  `console.error` avec l'identifiant de fiche, puis repli sur les constantes.
  Un lien de paiement ne doit pas échouer parce qu'un tarif est illisible.
- Tarif enregistré non conforme (0, négatif, non numérique) : refusé à
  l'écriture par le 400 de l'API ; la résolution s'en protège malgré tout.

## Tests / vérification

Nouveau `lib/pricing.test.ts` sur la partie pure et la résolution :

- tarifs du détenteur appliqués ;
- fiche libre → 500 / 29 ;
- compte sans tarif, tarif nul ou négatif → 500 / 29 ;
- `assignedTo` en `ObjectId` brut et en document peuplé → même résultat.

Puis `npx tsc --noEmit`, `npx eslint`, `npx vitest run`, et vérification
bout-en-bout contre la base locale sur le modèle des vérifications déjà
outillées : deux comptes de tarifs différents, une fiche chacun, contrôle que
le montant transmis à GoCardless suit le détenteur et non l'appelant.

## Hors scope

- Fourchettes min/max par closer, et tarif choisi par le closer lui-même.
- Historique des tarifs (qui pratiquait quel prix à quelle date).
- Signalement de l'écart entre un lien déjà émis et le tarif courant — écarté
  explicitement avec la suppression des champs de constat.
