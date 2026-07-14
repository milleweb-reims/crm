# Admin sans verrou + Attribution des prospects aux closers

Date : 2026-07-14
Statut : validé

## Contexte

Le CRM verrouille les fiches prospect (`lockedBy`/`lockedAt`, TTL 3 min, statut
`en_appel` = verrou sans expiration) pour éviter que deux closers contactent le
même prospect. Aujourd'hui :

- Un admin qui ouvre une fiche verrouillée est bloqué par l'overlay « Prospect
  déjà pris » et ne peut que voler le verrou (« Forcer la prise »).
- Même sur une fiche libre, l'admin doit « Prendre ce prospect », ce qui la
  verrouille pour les closers.
- Le champ `assignedTo` existe (modèle, populate, filtre API) mais aucune UI ne
  permet d'attribuer manuellement un prospect à un closer ; l'attribution ne se
  fait qu'automatiquement au premier changement de statut.

## Objectifs

1. L'admin navigue dans toutes les fiches sans jamais être bloqué par le verrou
   et sans jamais poser de verrou lui-même.
2. L'admin peut attribuer un prospect à un closer depuis la fiche.
3. L'attribution est **exclusive** : seul le closer attribué (ou un admin) peut
   prendre la fiche.

## 1. Admin ne verrouille jamais

Fichier : `src/app/(dashboard)/prospects/[id]/page.tsx` (client uniquement).

- Si `session.user.role === "admin"` : aucun overlay, aucun `POST /lock`,
  aucun heartbeat, aucune libération. La fiche est pleinement interactive
  (le `PUT /api/prospects/[id]` autorise déjà l'admin sur une fiche
  verrouillée).
- Si un autre utilisateur tient le verrou (`getLockHolder`), afficher un
  bandeau discret en haut de fiche : « {nom} est actuellement sur cette
  fiche » avec un bouton « Forcer la prise » (comportement existant conservé :
  `POST /lock { force: true }` — vole le verrou).
- Le `<select>` de statut n'est plus désactivé pour l'admin
  (aujourd'hui `disabled={lockState !== "mine"}`).
- Aucun changement serveur pour cette partie.

## 2. Attribution d'un prospect à un closer

### UI — fiche prospect

Bloc « Attribué à » dans l'en-tête de la fiche :

- **Admin** : `<select>` avec « Non attribué » + les utilisateurs actifs de
  rôle `closer` (chargés via `GET /api/users`, filtrés côté client sur
  `role === "closer" && isActive`). Le changement envoie
  `PUT /api/prospects/[id]` avec `{ assignedTo: <id | null> }`.
- **Closer / dev** : affichage en lecture seule (« Attribué à {nom} », rien si
  non attribué).

### Serveur — `PUT /api/prospects/[id]`

- Si le body contient `assignedTo` et que la valeur diffère de l'existant :
  réservé à l'admin → 403 sinon. (L'auto-assignation serveur au changement de
  statut reste inchangée — elle est injectée après cette garde.)
- Refuser l'attribution à un utilisateur inexistant ou désactivé (400).
- Journaliser une activité : « Attribué à {nom} » ou « Attribution retirée ».

## 3. Exclusivité de l'attribution

### Serveur — `POST /api/prospects/[id]/lock`

Si `prospect.assignedTo` est défini, différent de `session.user.id`, et que
l'utilisateur n'est pas admin → **423** avec
`error: "Prospect réservé à {nom}"`. Un closer non attribué ne peut plus
prendre la fiche.

### Client

L'overlay « held » affiche ce message. Pas de polling de libération dans ce
cas (l'attribution ne se libère pas seule) : seul le bouton « Retour aux
prospects » est proposé.

## Cas limites

- Attribution pendant qu'un autre closer tient le verrou : le verrou en cours
  n'est pas cassé ; l'exclusivité s'applique à la prochaine tentative de prise.
- Le closer attribué reste soumis au verrou classique (heartbeat, TTL,
  `en_appel`).
- Utilisateur désactivé : refusé à l'attribution.

## Tests / vérification

Vérification manuelle des trois flux (pas de suite de tests unitaires
existante sur les routes) :

1. Admin ouvre une fiche verrouillée par un closer → pas d'overlay, bandeau
   visible, modification possible, verrou du closer intact.
2. Admin attribue une fiche à un closer B → activité journalisée, closer A ne
   peut plus la prendre (423), closer B peut la prendre normalement.
3. Admin ouvre / quitte des fiches libres → aucune fiche ne se retrouve
   verrouillée.
