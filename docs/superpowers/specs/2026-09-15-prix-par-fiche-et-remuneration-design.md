# Prix par fiche et rémunération du closer — Design

**Date** : 2026-09-15
**Statut** : validé, implémenté
**Remplace** : `2026-08-12-tarifs-par-closer-design.md` pour le prix de création. L'abonnement mensuel reste régi par cette spec.

## Objectif

Le closer fixe lui-même le prix du site, fiche par fiche, à 1 000 € HT minimum.
Tout ce qui dépasse ce plancher lui est reversé : un site vendu 2 000 € HT lui
rapporte 1 000 €. Le CRM affiche cette rémunération, par mois, au closer et à
l'admin.

## Décisions produit

| Décision | Choix |
|---|---|
| Porteur du prix de création | La fiche prospect (`quoteAmount`), plus le compte |
| Qui le fixe | Le closer qui détient la fiche, ou un admin. Une fiche libre accepte le prix d'un closer : le statut « en appel » la lui attribue |
| Plancher | 1 000 € HT. En dessous, l'API répond 400, la carte affiche l'erreur sans appeler l'API |
| Défaut d'une fiche | 1 000 € HT |
| Fiche payée | Prix figé, 403 pour tout le monde |
| Rémunération | `max(0, HT encaissé − 1 000)`, au centime |
| Moment du calcul | À la réception du paiement (webhook), depuis le TTC réellement prélevé par GoCardless, jamais depuis le prix configuré |
| Persistance | `paidAmountHt` et `closerCommission` sur la fiche, figés : un changement de prix ou de plancher ultérieur ne réécrit pas l'historique |
| Ventes antérieures | Sans `closerCommission`, comptées 0. Elles étaient à 500 € HT, en dessous du plancher |
| Abonnement mensuel | Inchangé : tarif du compte détenteur, réglé par l'admin dans Paramètres → Utilisateurs |

### Conséquences assumées

1. **Un lien déjà émis garde son montant.** GoCardless fige le montant à la
   création. La carte le rappelle quand on modifie le prix d'une fiche qui a
   déjà un lien, et propose « Régénérer ».
2. **Une fiche d'avant la règle porte encore 500.** La résolution la ramène à
   1 000 € HT pour tout lien généré ; le document n'est pas réécrit tant que le
   closer ne saisit pas un prix.
3. **La rémunération se lit sur le HT reconstitué** depuis le TTC prélevé, au
   taux `QONTO_VAT_RATE` en vigueur au moment du paiement. Si le taux change
   ensuite, les fiches déjà payées ne bougent pas.

## Architecture

### `lib/pricing.ts` (pur, testé)

- `MINIMUM_QUOTE_AMOUNT = 1000`
- `validateQuoteAmount(value)` → `{ amount }` ou `{ error }`
- `resolveProspectPricing(prospect, findHolder)` : `quoteAmount` de la fiche
  ramené au plancher si absent ou invalide ; `subscriptionAmount` du détenteur
- `closerCommission(paidAmountHt)` → part du closer
- `quoteAmountUpdate({ body, existing, user })` : autorisation et validation de
  l'écriture du prix (détenteur ou admin, fiche non payée, plancher)
- `pickPricingUpdates(body)` ne retient plus que `subscriptionAmount`

### `lib/vat.ts`

`htFromTtc(ttc)`, inverse de `ttcFromHt`, arrondi au centime.

### Modèles

- `Prospect` : `quoteAmount` (défaut 1000), `paidAmountHt`, `closerCommission`
- `User` : `quoteAmount` retiré du schéma. Les documents existants gardent le
  champ, inerte.

### Routes

| Route | Changement |
|---|---|
| `PUT /api/prospects/[id]` | Passe par `quoteAmountUpdate` avant les effets de statut |
| `GET /api/prospects/[id]` | `pricing` résolu depuis la fiche et son détenteur |
| `payment-link`, `payment-link/send` | Montant lu via `prospectPricing(prospect)` |
| `mandate-link`, `subscription`, webhook (abonnement) | Inchangés sur le fond, signature `prospectPricing(prospect)` |
| Webhook paiement | Fige `paidAmountHt` et `closerCommission` avec `paidAmount` |
| `PUT /api/users/[id]` | N'accepte plus `quoteAmount` |
| `GET /api/stats` | Closer : `commissionThisMonth`. Admin : `commission` par entrée du classement. Un closer ne voit ni CA ni rémunération des autres |

### Interface

- Carte « Devis & paiement » : le prix s'édite en place (crayon) par le
  détenteur ou l'admin, tant que la fiche n'est pas payée. Sous le montant : le
  TTC client et la part du closer ; une fois payée, la part figée.
  `data-test` : `edit-quote-amount`, `quote-amount-input`, `quote-amount-save`.
- Tableau de bord closer : carte « Ma rémunération (ce mois) ».
- Tableau de bord admin : « dont N € » sous le CA de chaque closer du classement.
- Paramètres → Utilisateurs : colonne et dialogue réduits à l'abonnement.

## Tests / vérification

- `lib/pricing.test.ts` (36 cas) et `lib/vat.test.ts` (3 cas), écrits et vus
  échouer avant l'implémentation.
- Vérifié au navigateur contre la base locale : saisie à 800 refusée avec le
  message du plancher ; 2 000 enregistré et affiché « 1 000 € pour le closer » ;
  un closer non détenteur n'a pas le bouton et reçoit 403 en appel direct ;
  après paiement simulé en base, le closer voit « Ma rémunération 1 000 € » et
  l'admin « 2 400 € dont 1 000 € » au classement.
- Non couvert : le webhook GoCardless réel (signature et appel API), dont la
  seule logique ajoutée est `htFromTtc` + `closerCommission`, testées à part.

## Hors scope

- Plancher différent par closer ou par période.
- Historique des prix d'une fiche.
- Export ou relevé mensuel de rémunération.
