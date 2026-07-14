# Dashboard par rôle — Design

**Date :** 2026-07-14
**Statut :** Validé

## Objectif

Le dashboard actuel affiche les mêmes 4 KPI globaux pour tout le monde. Chaque rôle
(`admin`, `closer`, `dev`) doit voir des KPI et données pertinentes pour son travail.

## Backend — `/api/stats` role-aware

Une seule route. La réponse dépend de `session.user.role` (jamais d'un paramètre
client). Tous les filtres « personnels » utilisent `session.user.id`.

### Réponse admin

| Champ | Source |
|---|---|
| `caThisMonth` / `caPrevMonth` | somme `paidAmount` où `paidAt` dans le mois |
| `salesThisMonth` / `salesPrevMonth` | count `paidAt` dans le mois |
| `totalProspects`, `byStatus` | counts par statut (funnel) |
| `untreatedStock` | count `status: "prospect"` |
| `leaderboard[]` | agrégat par `assignedTo` : ventes + CA du mois + RDV pris ce mois, avec nom du closer (`$lookup` users) |
| `monthlyTrend` | existant (6 mois) |
| `todayReminders` | existant |

### Réponse closer (filtré `assignedTo = user.id`)

| Champ | Source |
|---|---|
| `myProspects` | count assignés |
| `callsToday` | count `Activity` `type: "call"`, `userId`, aujourd'hui |
| `upcomingRdv` | count `rdvDate >= now` |
| `liensEnvoyes` | count `status: "lien_envoye"` |
| `salesThisMonth` / `salesPrevMonth` | count `paidAt` dans le mois, assignés |
| `caThisMonth` | somme `paidAmount` du mois, assignés (son CA à lui) |
| `todayReminders` | existant, filtré `userId` |
| `leaderboard[]` | ventes du mois par closer (nom + ventes uniquement, **pas de CA global ni par closer**) |

### Réponse dev

| Champ | Source |
|---|---|
| `toDeliver` | count `paidAt != null && deliveredDate == null` |
| `missingDevUrl` | count payés sans `devUrl` |
| `deliveredThisMonth` | count `deliveredDate` dans le mois |
| `totalPaid` | count `paidAt != null` |
| `deliveryList[]` | payés non livrés (nom, ville, `paidAt`, `devUrl`), tri `paidAt` asc, limite 20 |

## Frontend — `src/app/(dashboard)/page.tsx`

- Rôle lu via `useSession()` (déjà dispo dans `Providers`).
- Un seul fetch `/api/stats` + `useRealtime(fetchStats)` inchangé.
- Rendu par rôle :
  - **Admin** : 4 StatCards (CA du mois avec variation, ventes du mois, stock non
    traité, RDV en cours) + funnel de conversion + leaderboard closers +
    `ProspectsChart`.
  - **Closer** : 4 StatCards (appels du jour, RDV à venir, liens envoyés, ventes du
    mois avec variation + son CA) + mini-leaderboard + rappels du jour.
  - **Dev** : 4 StatCards (à livrer, sans URL dev, livrés ce mois, total payés) +
    liste « Sites à livrer » (liens vers les fiches prospects).

### Nouveaux composants

- `src/components/conversion-funnel.tsx` — barres par statut avec taux de
  conversion entre étapes (prospect → RDV → lien → payé).
- `src/components/closers-leaderboard.tsx` — classement ; prop `showCa` pour
  masquer le CA côté closer.
- `src/components/delivery-list.tsx` — liste des sites à livrer (vue dev).

## Sécurité

- Filtrage côté API à partir de la session uniquement.
- Un closer ne reçoit jamais le CA global ni le CA des autres closers.
- Le dev ne reçoit pas de données financières agrégées (uniquement des counts).

## Hors scope

- Pas de nouvelle collection ni de champ modèle.
- Pas de sélecteur de période (mois courant fixe).
