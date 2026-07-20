# Territoires — attribution des villes aux closers

Date : 2026-07-20
Statut : validé

## Contexte

L'attribution d'un prospect à un closer se fait aujourd'hui **une fiche à la
fois** : `PUT /api/prospects/[id]` avec `{ assignedTo }`, réservé à l'admin
(`src/app/api/prospects/[id]/route.ts:135-188`). Il n'existe aucun endpoint de
masse.

Après un import Excel de plusieurs centaines de lignes sur une même ville,
l'admin doit ouvrir chaque fiche pour la distribuer. Le champ `?city=` est déjà
accepté par `GET /api/prospects` (`buildProspectFilter`) mais **aucun composant
ne le pilote** : la page prospects n'a que recherche, statut et `assignedTo`.

Il n'existe ni collection Territoire, ni notion de propriété d'une ville.

## Objectifs

1. L'admin déclare qu'une ville appartient à un ou plusieurs closers.
2. Les prospects **non attribués** de cette ville sont répartis immédiatement.
3. Les imports et créations **futurs** sur cette ville sont attribués
   automatiquement, sans intervention.
4. La répartition suit la charge réelle : le prospect va au closer qui a le
   moins d'appels en attente.
5. L'admin peut voir la liste d'une ville dans l'interface.

## Décisions actées

| Question | Décision |
|---|---|
| Ponctuel ou durable | **Durable** — une collection `Territory` |
| Une ville, combien de closers | **Plusieurs** |
| Règle de répartition | **Charge réelle**, pas de round-robin ni de quotas |
| Définition de la charge | Prospects au statut `prospect` uniquement |
| Portée de la charge | **Globale** — toutes villes confondues |
| Prospects déjà attribués | **Jamais touchés**, quel que soit leur statut |
| Tests | Vitest introduit dans le projet |

## 1. Normalisation des villes

Les données viennent d'un scrap Google Maps : `Reims`, `REIMS`, `Épernay` et
`Epernay` coexistent dans `address.city`. Le filtre `?city=` actuel utilise une
regex insensible à la casse, qui **ne rattrape pas les accents** — `Épernay` et
`Epernay` sont deux villes distinctes pour lui.

### Helper

Nouveau fichier `src/lib/city.ts` :

```ts
export function normalizeCity(value: string): string
```

Minuscules, décomposition NFD, suppression des diacritiques, espaces normalisés
et rognés. `"  Épernay  "` et `"EPERNAY"` donnent tous deux `"epernay"`.

### Champ dérivé sur Prospect

Ajout de `address.cityKey` (String, indexé) au schéma
`src/lib/models/prospect.model.ts`, dérivé de `address.city`.

La dérivation est **explicite aux points d'écriture**, pas via un hook Mongoose :
`findOneAndUpdate` ne déclenche pas les hooks document, ce qui rendrait le champ
silencieusement obsolète après une modification d'adresse. Un helper
`withCityKey(prospect)` exporté par `src/lib/city.ts` est appelé dans :

- `src/lib/import-parser.ts` — `parseRow`
- `POST /api/prospects` — création manuelle
- `PUT /api/prospects/[id]` — uniquement si `address.city` change

### Backfill

Script `src/scripts/backfill-city-key.ts`, exécutable une fois, qui parcourt les
prospects existants et renseigne `address.cityKey`. Idempotent : ne réécrit que
les documents dont la clé est absente ou divergente.

Nouvel index `{ "address.cityKey": 1 }`. L'index composite existant
`{ name: 1, "address.city": 1 }` est conservé (il sert la détection de doublons
à l'import).

## 2. Modèle Territory

Nouveau fichier `src/lib/models/territory.model.ts` :

| Champ | Type | Notes |
|---|---|---|
| `city` | String, requis | Forme affichée, saisie par l'admin (`"Reims"`) |
| `cityKey` | String, requis, **unique** | `normalizeCity(city)` |
| `closers` | `[ObjectId]` ref User | Peut être vide (territoire inactif) |
| `createdBy` | ObjectId ref User | |
| `createdAt` / `updatedAt` | timestamps | |

L'index unique sur `cityKey` garantit qu'une ville n'a qu'un territoire, donc
qu'aucune ambiguïté de rattachement n'est possible.

`closers` n'est pas contraint au rôle `closer` par le schéma — la validation se
fait dans la route (voir §4), comme pour `assignedTo` aujourd'hui.

## 3. Logique de répartition

Nouveau fichier `src/lib/territory-balance.ts`, **sans dépendance à Mongoose**,
donc testable isolément.

```ts
export interface CloserLoad {
  readonly closerId: string;
  readonly load: number;
}

export function distribute(options: {
  readonly loads: ReadonlyArray<CloserLoad>;
  readonly count: number;
}): string[]
```

Retourne `count` identifiants de closer, dans l'ordre d'attribution.

Algorithme : à chaque itération, prendre le closer de charge minimale,
l'attribuer, incrémenter sa charge en mémoire. Égalité départagée par
`closerId` croissant — le résultat est **déterministe**, donc testable.

Cas dégénérés, tous silencieux (tableau vide, jamais d'exception) :
`loads` vide, `count` nul, `count` négatif.

L'incrément en mémoire est ce qui permet de répartir un lot entier à partir
d'**une seule** mesure de charge : la fonction n'interroge jamais la base.

### Mesure de la charge

Une seule agrégation, dans `src/lib/territory-service.ts` :

```
Prospect.aggregate([
  { $match: { assignedTo: { $in: closerIds }, status: "prospect" } },
  { $group: { _id: "$assignedTo", n: { $sum: 1 } } },
])
```

Les closers absents du résultat ont une charge de 0. Portée **globale** : aucun
filtre sur la ville, conformément à la décision actée.

Un lot de N prospects coûte **une** requête de comptage, pas N.

## 4. API territoires

Toutes les routes sont **admin uniquement** (`session.user.role !== "admin"`
→ 403 `{ error: "Accès refusé" }`), en suivant le patron de
`src/app/api/prospects/route.ts`.

| Route | Effet |
|---|---|
| `GET /api/territories` | Liste, `closers` peuplés (`name email`), plus par ville : nombre de prospects et nombre de non attribués |
| `POST /api/territories` | Crée le territoire **et applique** (voir ci-dessous) |
| `PUT /api/territories/[id]` | Modifie la liste des closers **et applique** |
| `DELETE /api/territories/[id]` | Supprime la règle. **N'annule aucune attribution existante** |

### Validation

- `city` non vide, sinon 400.
- `cityKey` déjà pris → 409 `{ error: "Un territoire existe déjà pour cette ville" }`.
- Chaque id de `closers` doit correspondre à un utilisateur existant, actif, de
  rôle `closer` — sinon 400.

> Cette validation est **plus stricte** que celle de `processAssignedToField`,
> qui vérifie l'existence et `isActive` mais pas le rôle. Choix délibéré : un
> territoire est un outil de pilotage d'équipe commerciale, y placer un `dev` ou
> un `admin` n'a pas de sens. L'attribution unitaire existante n'est pas
> modifiée.

Retirer un closer d'un territoire ne retire **aucune** attribution existante :
ses prospects restent les siens, seule la répartition future change.

### Application

`applyTerritory(territoryId)` dans `src/lib/territory-service.ts` :

1. Sélectionner les prospects de la ville **non attribués** :
   `{ "address.cityKey": key, assignedTo: null }`.
2. Filtrer `closers` sur les utilisateurs encore actifs.
3. Si aucun closer actif → ne rien faire, retourner des compteurs à zéro.
4. Mesurer les charges, appeler `distribute`.
5. Écrire via `bulkWrite` (`updateOne` par prospect).

Retourne `{ assigned: number, perCloser: Record<string, number> }`, remonté tel
quel par la route.

> **Pas d'atomicité.** MongoDB tourne en standalone sur cet environnement, donc
> sans transaction multi-documents. Un `bulkWrite` partiellement échoué laisse
> une partie des prospects attribués. Les compteurs retournés reflètent les
> écritures réellement effectuées — jamais l'intention.

## 5. Attribution automatique

Nouveau helper `resolveAssignee(cityKey)` dans `src/lib/territory-service.ts` :
cherche le territoire, filtre les closers actifs, mesure les charges, retourne
l'id du moins chargé — ou `null` si pas de territoire ou pas de closer actif.

### Import Excel — `POST /api/prospects/import`

Regrouper les prospects importés par `cityKey`, puis résoudre les territoires
concernés.

La charge étant **globale**, mesurer une fois pour l'union de tous les closers
impliqués dans l'import, puis enchaîner les `distribute` ville par ville **en
reportant les charges incrémentées d'un groupe au suivant**. Une mesure par
groupe donnerait un résultat faux : les écritures du groupe précédent ne sont
pas encore visibles, donc le même closer paraîtrait libre deux fois et
récupérerait les deux villes.

Coût total : une agrégation pour l'import entier.

Les prospects sans ville, ou dont la ville n'a pas de territoire, sont créés non
attribués — comportement actuel inchangé.

L'activité d'import existante mentionne en plus le nombre d'attributions.

### Création manuelle — `POST /api/prospects`

Appel unitaire à `resolveAssignee`. Si le body fournit déjà `assignedTo`, il est
respecté : le territoire ne s'applique qu'à défaut.

## 6. Journalisation

Un `Activity` par prospect serait disproportionné sur un lot de plusieurs
centaines. On suit le précédent de l'import
(`createImportActivityRecord`) : **une** activité par application de territoire,
rattachée au premier prospect affecté.

- `type: "note"` — l'énumération de `activity.model.ts` n'a pas de type
  d'attribution, et le code d'attribution existant utilise déjà `"note"`.
  Ne pas étendre l'énumération pour ce besoin.
- `content` : « Territoire {ville} : {n} prospects attribués »
- `metadata` : `{ territoryId, city, perCloser }`

Un `emitCrmEvent({ type: "prospect:updated", ... })` est émis une fois pour que
les écrans ouverts se rafraîchissent.

## 7. Interface

### Page `/territoires`

Nouvelle entrée de sidebar, **visible pour l'admin uniquement**
(`session?.user?.role === "admin"`, comme le bouton « Tout supprimer » de la
page prospects).

Un tableau : ville, closers, nombre de prospects, nombre non attribués, actions.
Création et édition dans un `Dialog` (composant déjà présent).

La sélection multi-closers a besoin d'un `Checkbox`, absent de
`src/components/ui/`. Ajout **via le CLI shadcn**, sans laisser le CLI réécrire
`globals.css`.

### Filtre ville sur la page prospects

`src/components/prospect-filters.tsx` reçoit un champ ville, câblé sur le
paramètre `city` déjà accepté par l'API. Sans lui, l'admin ne peut pas consulter
la liste d'une ville — qui est la demande d'origine.

## Cas limites

| Situation | Comportement |
|---|---|
| Prospect sans ville | Jamais rattaché à un territoire, reste non attribué |
| Territoire sans closer actif | Aucune attribution, aucune erreur |
| Closer désactivé après création du territoire | Exclu de la répartition ; ses prospects actuels ne bougent pas |
| Closer supprimé | `DELETE /api/users/[id]` transfère déjà `assignedTo` et purge `lockedBy` (`src/app/api/users/[id]/route.ts:229-235`). À compléter : retirer l'id des `closers` de tout territoire, sinon la répartition cible un utilisateur inexistant |
| Territoire supprimé | Les attributions passées sont conservées |
| Deux villes homographes (`Reims` en Champagne et ailleurs) | Non traité — `cityKey` est national. Découpage par code postal hors périmètre |
| Lot plus petit que le nombre de closers | `distribute` sert les moins chargés d'abord ; certains ne reçoivent rien |

## Tests

Vitest est introduit dans le projet (aucun framework aujourd'hui). Environnement
`node` : la logique visée est pure, aucun DOM nécessaire.

`src/lib/territory-balance.test.ts` couvre :

- répartition sur charges égales — alternance stricte et déterministe
- répartition sur charges inégales — le retard est comblé avant l'alternance
- un seul closer — tout lui revient
- liste de closers vide — tableau vide, pas d'exception
- `count` nul ou négatif — tableau vide
- lot plus petit que le nombre de closers
- déterminisme — deux appels identiques donnent le même résultat

`src/lib/city.test.ts` couvre la normalisation : casse, accents, espaces
superflus, chaîne vide.

La logique de service (agrégation, `bulkWrite`) n'est pas testée
automatiquement : elle exige une base. Vérification manuelle des trois flux :

1. Créer un territoire à deux closers sur une ville chargée → répartition
   conforme aux charges de départ, prospects déjà attribués intacts.
2. Importer un Excel sur cette ville → les nouvelles lignes se répartissent.
3. Supprimer le territoire → aucune attribution perdue.

## Hors périmètre

- Découpage d'une ville par code postal ou par quartier.
- Quotas ou parts par closer.
- Réattribution automatique quand un closer part en congés.
- Rééquilibrage rétroactif des prospects déjà attribués.
