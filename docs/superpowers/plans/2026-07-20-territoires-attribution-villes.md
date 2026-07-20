# Territoires — attribution des villes aux closers : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à l'admin de déclarer qu'une ville appartient à plusieurs closers, avec répartition automatique des prospects non attribués selon la charge réelle de chacun, à l'application de la règle comme aux imports futurs.

**Architecture:** Une collection `Territory` (ville → closers) indexée sur une clé de ville normalisée sans accents. La répartition est une fonction pure testée isolément, alimentée par une unique agrégation de charge. Les points d'écriture de prospects (import, création) consultent le territoire pour renseigner `assignedTo`.

**Tech Stack:** Next.js 16.2.9 (App Router), React 19.2.4, MongoDB + Mongoose 9, next-auth 5 beta, Tailwind 4 + shadcn/ui, Vitest (introduit par ce plan).

**Spec :** `docs/superpowers/specs/2026-07-20-territoires-attribution-villes-design.md`

## Global Constraints

- **Langue** : tout le texte visible par l'utilisateur et tous les commentaires de code sont en **français**. Les identifiants de code sont en anglais.
- **Immutabilité** : pas de mutation d'objet partagé. Exception admise et commentée : l'état de travail local d'un algorithme pur.
- **Rôles** : `"admin" | "closer" | "dev"`. Toute route territoire est **admin uniquement**.
- **Statuts prospect** : `"prospect" | "en_appel" | "rdv" | "lien_envoye" | "paye" | "pas_interesse"`.
- **Erreurs API** : `unauthorized()` → 401 `{ error: "Non autorisé" }`, `forbidden()` → 403 `{ error: "Accès refusé" }`, depuis `@/lib/api-auth`.
- **Pas de `import "server-only"`** : ce projet ne l'utilise nulle part, ne pas l'introduire.
- **Pas de transaction MongoDB** : instance standalone. Un `bulkWrite` partiel est possible ; toujours rapporter les compteurs réellement écrits.
- **Ne jamais réattribuer un prospect déjà attribué**, quel que soit son statut.
- **pnpm** : si l'installation d'une dépendance réclame l'autorisation d'un script de build, l'ajouter à `pnpm-workspace.yaml` sous `allowBuilds`.
- **Vérification avant commit** : `npx tsc --noEmit` et `npx eslint <fichiers>` doivent passer.

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `src/lib/city.ts` | Normalisation d'un nom de ville + dérivation de `address.cityKey`. Aucune dépendance. |
| `src/lib/territory-balance.ts` | Algorithme de répartition. Fonction pure, aucune dépendance à Mongoose. |
| `src/lib/models/territory.model.ts` | Schéma Mongoose `Territory`. |
| `src/lib/territory-service.ts` | Accès base : mesure des charges, application d'un territoire, résolution d'un assigné. |
| `src/app/api/territories/route.ts` | `GET` liste, `POST` création. |
| `src/app/api/territories/[id]/route.ts` | `PUT` modification, `DELETE` suppression. |
| `src/app/(dashboard)/territoires/page.tsx` | Écran d'administration des territoires. |
| `src/lib/backfill-city-key.ts` | Script ponctuel de rattrapage de `address.cityKey`. |

---

### Task 1 : Vitest et normalisation des villes

**Files:**
- Create: `vitest.config.ts`
- Create: `src/lib/city.ts`
- Create: `src/lib/city.test.ts`
- Modify: `package.json` (scripts + devDependencies)

**Interfaces:**
- Consumes: rien.
- Produces: `normalizeCity(value: string): string` et `withCityKey(prospect: Record<string, unknown>): Record<string, unknown>`, exportés par `@/lib/city`.

- [ ] **Step 1 : Installer Vitest**

```bash
pnpm add -D vitest
```

Si pnpm refuse un script de build, ajouter le paquet concerné sous `allowBuilds` dans `pnpm-workspace.yaml` puis relancer.

- [ ] **Step 2 : Créer la configuration Vitest**

Créer `vitest.config.ts` :

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // La logique testée est pure : aucun DOM nécessaire.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
```

- [ ] **Step 3 : Ajouter les scripts de test**

Dans `package.json`, section `scripts`, ajouter après `"lint": "eslint"` :

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

- [ ] **Step 4 : Écrire les tests de normalisation (ils doivent échouer)**

Créer `src/lib/city.test.ts` :

```ts
import { describe, expect, it } from "vitest";

import { normalizeCity, withCityKey } from "./city";

describe("normalizeCity", () => {
  it("met en minuscules", () => {
    expect(normalizeCity("REIMS")).toBe("reims");
  });

  it("supprime les accents", () => {
    expect(normalizeCity("Épernay")).toBe("epernay");
  });

  it("fait converger les graphies accentuée et non accentuée", () => {
    expect(normalizeCity("Épernay")).toBe(normalizeCity("Epernay"));
  });

  it("rogne les espaces de bord", () => {
    expect(normalizeCity("  Reims  ")).toBe("reims");
  });

  it("normalise les espaces internes", () => {
    expect(normalizeCity("Vitry   le   François")).toBe("vitry le francois");
  });

  it("conserve les traits d'union", () => {
    expect(normalizeCity("Saint-Étienne")).toBe("saint-etienne");
  });

  it("accepte la chaîne vide", () => {
    expect(normalizeCity("")).toBe("");
  });
});

describe("withCityKey", () => {
  it("dérive la clé depuis address.city", () => {
    const result = withCityKey({ name: "X", address: { city: "Épernay" } });
    expect((result.address as Record<string, unknown>).cityKey).toBe("epernay");
  });

  it("conserve les autres champs de l'adresse", () => {
    const result = withCityKey({
      address: { city: "Reims", postalCode: "51100" },
    });
    expect(result.address).toEqual({
      city: "Reims",
      postalCode: "51100",
      cityKey: "reims",
    });
  });

  it("ne mute pas l'objet d'origine", () => {
    const original = { address: { city: "Reims" } };
    withCityKey(original);
    expect(original.address).toEqual({ city: "Reims" });
  });

  it("laisse le prospect intact sans adresse", () => {
    const input = { name: "X" };
    expect(withCityKey(input)).toEqual({ name: "X" });
  });

  it("laisse le prospect intact quand la ville est vide", () => {
    const input = { address: { city: "   " } };
    expect(withCityKey(input)).toEqual({ address: { city: "   " } });
  });
});
```

- [ ] **Step 5 : Lancer les tests pour vérifier qu'ils échouent**

Run: `pnpm test`
Expected: FAIL — `Failed to resolve import "./city"`.

- [ ] **Step 6 : Écrire l'implémentation**

Créer `src/lib/city.ts` :

```ts
// Rattachement d'un prospect à un territoire. Les données viennent d'un scrap
// Google Maps : « Reims », « REIMS », « Épernay » et « Epernay » désignent la
// même ville et doivent tomber sur la même clé.

/**
 * Normalise un nom de ville en clé de rattachement.
 * Minuscules, sans accents, espaces internes réduits à un seul.
 */
export function normalizeCity(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Retourne un nouveau prospect avec address.cityKey dérivé de address.city.
 * Sans adresse ou sans ville exploitable, le prospect est retourné tel quel :
 * il ne sera rattaché à aucun territoire.
 */
export function withCityKey(
  prospect: Record<string, unknown>
): Record<string, unknown> {
  const address = prospect.address;
  if (!address || typeof address !== "object") return prospect;

  const { city } = address as Record<string, unknown>;
  if (typeof city !== "string" || city.trim() === "") return prospect;

  return {
    ...prospect,
    address: {
      ...(address as Record<string, unknown>),
      cityKey: normalizeCity(city),
    },
  };
}
```

- [ ] **Step 7 : Lancer les tests pour vérifier qu'ils passent**

Run: `pnpm test`
Expected: PASS — 12 tests.

- [ ] **Step 8 : Vérifier types et lint**

Run: `npx tsc --noEmit && npx eslint src/lib/city.ts src/lib/city.test.ts vitest.config.ts`
Expected: aucune erreur.

- [ ] **Step 9 : Commit**

```bash
git add vitest.config.ts src/lib/city.ts src/lib/city.test.ts package.json pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(territoires): Ajouter Vitest et la normalisation des noms de ville"
```

---

### Task 2 : Algorithme de répartition par charge

**Files:**
- Create: `src/lib/territory-balance.ts`
- Create: `src/lib/territory-balance.test.ts`

**Interfaces:**
- Consumes: rien (fonction pure).
- Produces: `CloserLoad` (`{ closerId: string; load: number }`) et `distribute(options: { loads: ReadonlyArray<CloserLoad>; count: number }): string[]`, exportés par `@/lib/territory-balance`. Task 4 et Task 6 les consomment.

- [ ] **Step 1 : Écrire les tests (ils doivent échouer)**

Créer `src/lib/territory-balance.test.ts` :

```ts
import { describe, expect, it } from "vitest";

import { distribute } from "./territory-balance";

describe("distribute", () => {
  it("alterne quand les charges sont égales", () => {
    const result = distribute({
      loads: [
        { closerId: "a", load: 0 },
        { closerId: "b", load: 0 },
      ],
      count: 4,
    });
    expect(result).toEqual(["a", "b", "a", "b"]);
  });

  it("comble le retard avant d'alterner", () => {
    // a est déjà à 5, b à 2 : b encaisse trois prospects pour rattraper,
    // puis l'égalité est départagée par identifiant croissant.
    const result = distribute({
      loads: [
        { closerId: "a", load: 5 },
        { closerId: "b", load: 2 },
      ],
      count: 4,
    });
    expect(result).toEqual(["b", "b", "b", "a"]);
  });

  it("donne tout au closer unique", () => {
    const result = distribute({
      loads: [{ closerId: "a", load: 12 }],
      count: 3,
    });
    expect(result).toEqual(["a", "a", "a"]);
  });

  it("sert les moins chargés quand le lot est plus petit que l'équipe", () => {
    const result = distribute({
      loads: [
        { closerId: "a", load: 3 },
        { closerId: "b", load: 1 },
        { closerId: "c", load: 2 },
      ],
      count: 2,
    });
    expect(result).toEqual(["b", "c"]);
  });

  it("retourne un tableau vide sans closer", () => {
    expect(distribute({ loads: [], count: 5 })).toEqual([]);
  });

  it("retourne un tableau vide pour un lot nul", () => {
    expect(distribute({ loads: [{ closerId: "a", load: 0 }], count: 0 })).toEqual([]);
  });

  it("retourne un tableau vide pour un lot négatif", () => {
    expect(distribute({ loads: [{ closerId: "a", load: 0 }], count: -3 })).toEqual([]);
  });

  it("est déterministe", () => {
    const loads = [
      { closerId: "b", load: 4 },
      { closerId: "a", load: 4 },
      { closerId: "c", load: 1 },
    ];
    const first = distribute({ loads, count: 6 });
    const second = distribute({ loads, count: 6 });
    expect(first).toEqual(second);
  });

  it("ne mute pas les charges reçues", () => {
    const loads = [
      { closerId: "a", load: 0 },
      { closerId: "b", load: 0 },
    ];
    distribute({ loads, count: 4 });
    expect(loads).toEqual([
      { closerId: "a", load: 0 },
      { closerId: "b", load: 0 },
    ]);
  });
});
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run: `pnpm test src/lib/territory-balance.test.ts`
Expected: FAIL — `Failed to resolve import "./territory-balance"`.

- [ ] **Step 3 : Écrire l'implémentation**

Créer `src/lib/territory-balance.ts` :

```ts
// Répartition d'un lot de prospects entre les closers d'un territoire.
// Le prospect va toujours au closer qui a le moins d'appels en attente.
// Fonction pure : elle n'interroge jamais la base, ce qui permet de répartir
// un lot entier à partir d'une seule mesure de charge.

export interface CloserLoad {
  readonly closerId: string;
  readonly load: number;
}

/**
 * Retourne `count` identifiants de closer, dans l'ordre d'attribution.
 * Égalité départagée par identifiant croissant : le résultat est déterministe.
 * Cas dégénérés (aucun closer, lot nul ou négatif) : tableau vide, sans erreur.
 */
export function distribute(options: {
  readonly loads: ReadonlyArray<CloserLoad>;
  readonly count: number;
}): string[] {
  const { loads, count } = options;

  if (loads.length === 0 || count <= 0) return [];

  // Copie de travail locale : `loads` n'est jamais modifié. La mutation reste
  // confinée à cette fonction, qui demeure pure vue de l'extérieur.
  const running = loads.map((entry) => ({ ...entry }));
  const picked: string[] = [];

  for (let i = 0; i < count; i += 1) {
    let best = running[0]!;

    for (const candidate of running) {
      const lighter = candidate.load < best.load;
      const tieBrokenById =
        candidate.load === best.load && candidate.closerId < best.closerId;

      if (lighter || tieBrokenById) best = candidate;
    }

    picked.push(best.closerId);
    best.load += 1;
  }

  return picked;
}
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run: `pnpm test src/lib/territory-balance.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5 : Vérifier types et lint**

Run: `npx tsc --noEmit && npx eslint src/lib/territory-balance.ts src/lib/territory-balance.test.ts`
Expected: aucune erreur.

- [ ] **Step 6 : Commit**

```bash
git add src/lib/territory-balance.ts src/lib/territory-balance.test.ts
git commit -m "feat(territoires): Ajouter la répartition des prospects par charge"
```

---

### Task 3 : Champ `address.cityKey` sur Prospect et rattrapage

**Files:**
- Modify: `src/lib/models/prospect.model.ts` (sous-schéma `addressSchema` ligne 3-17, index ligne 120-123)
- Modify: `src/lib/import-parser.ts` (fonction `parseRow`)
- Modify: `src/app/api/prospects/route.ts` (`POST`, ligne 135)
- Create: `src/lib/backfill-city-key.ts`
- Modify: `package.json` (script de rattrapage)

**Interfaces:**
- Consumes: `withCityKey` de `@/lib/city` (Task 1).
- Produces: le champ persistant `address.cityKey` sur tout prospect créé. Task 4 et Task 6 s'appuient dessus pour rattacher un prospect à son territoire.

- [ ] **Step 1 : Ajouter le champ au schéma**

Dans `src/lib/models/prospect.model.ts`, dans `addressSchema`, après la ligne `city: { type: String, default: "" },` :

```ts
    // Clé normalisée (minuscules, sans accents) servant au rattachement
    // à un territoire. Dérivée de `city` via withCityKey aux points d'écriture.
    cityKey: { type: String, default: "" },
```

- [ ] **Step 2 : Ajouter l'index**

Dans le même fichier, après `prospectSchema.index({ assignedTo: 1 });` :

```ts
prospectSchema.index({ "address.cityKey": 1 });
```

- [ ] **Step 3 : Dériver la clé à l'import Excel**

Dans `src/lib/import-parser.ts`, ajouter l'import en tête de fichier :

```ts
import { withCityKey } from "./city";
```

Puis, dans `parseRow`, remplacer le bloc final :

```ts
  if (contactPages.length > 0) {
    prospect.contactPages = contactPages;
  }

  return prospect;
```

par :

```ts
  if (contactPages.length > 0) {
    prospect.contactPages = contactPages;
  }

  return withCityKey(prospect);
```

- [ ] **Step 4 : Dériver la clé à la création manuelle**

Dans `src/app/api/prospects/route.ts`, ajouter aux imports :

```ts
import { withCityKey } from "@/lib/city";
```

Puis remplacer, dans `POST` :

```ts
  const prospect = await Prospect.create(body);
```

par :

```ts
  const prospect = await Prospect.create(withCityKey(body));
```

- [ ] **Step 5 : Écrire le script de rattrapage**

Créer `src/lib/backfill-city-key.ts`. Le script se connecte directement via
`mongoose.connect`, comme `src/lib/seed.ts` : `src/lib/db.ts` lève à
l'import si `MONGODB_URI` est absent, ce qui rendrait le script inutilisable
hors environnement applicatif.

```ts
// Rattrapage ponctuel : renseigne address.cityKey sur les prospects créés
// avant l'introduction du champ. Idempotent — relançable sans risque.

import mongoose from "mongoose";

import { normalizeCity } from "./city";
import { Prospect } from "./models/prospect.model";

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/crm-milleweb";

async function backfill() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connecté à MongoDB");

  const prospects = await Prospect.find({}, { "address.city": 1, "address.cityKey": 1 }).lean();

  const operations = prospects
    .map((prospect) => {
      const city = prospect.address?.city;
      if (typeof city !== "string" || city.trim() === "") return null;

      const expected = normalizeCity(city);
      if (prospect.address?.cityKey === expected) return null;

      return {
        updateOne: {
          filter: { _id: prospect._id },
          update: { $set: { "address.cityKey": expected } },
        },
      };
    })
    .filter((operation) => operation !== null);

  if (operations.length === 0) {
    console.log(`${prospects.length} prospects examinés, aucun à corriger`);
    await mongoose.disconnect();
    return;
  }

  const { modifiedCount } = await Prospect.bulkWrite(operations);
  console.log(`${prospects.length} prospects examinés, ${modifiedCount} mis à jour`);

  await mongoose.disconnect();
}

backfill().catch((error) => {
  console.error("Échec du rattrapage", error);
  process.exit(1);
});
```

- [ ] **Step 6 : Ajouter le script npm**

Dans `package.json`, section `scripts`, après `"seed"` :

```json
    "backfill:city-key": "npx tsx src/lib/backfill-city-key.ts",
```

- [ ] **Step 7 : Vérifier que l'import Excel produit bien la clé**

Les tests d'import n'existent pas ; vérifier par le typecheck puis manuellement
à la Task 6. Pour un contrôle immédiat, ajouter dans `src/lib/import-parser.test.ts` :

```ts
import { describe, expect, it } from "vitest";

import { detectMapping, parseRows } from "./import-parser";

describe("parseRows — clé de ville", () => {
  it("dérive address.cityKey depuis la ville", () => {
    const rows = [{ Nom: "Test", Ville: "Épernay", "Téléphone": "0102030405" }];
    const mapping = detectMapping(["Nom", "Ville", "Téléphone"]);
    const { prospects } = parseRows(rows, mapping);
    const address = prospects[0]!.address as Record<string, unknown>;
    expect(address.cityKey).toBe("epernay");
  });

  it("laisse la clé absente quand il n'y a pas de ville", () => {
    const rows = [{ Nom: "Test", "Téléphone": "0102030405" }];
    const mapping = detectMapping(["Nom", "Téléphone"]);
    const { prospects } = parseRows(rows, mapping);
    const address = prospects[0]!.address as Record<string, unknown>;
    expect(address.cityKey).toBeUndefined();
  });
});
```

- [ ] **Step 8 : Lancer les tests**

Run: `pnpm test`
Expected: PASS — les tests de Task 1, Task 2 et les 2 nouveaux.

- [ ] **Step 9 : Exécuter le rattrapage sur la base locale**

Run: `pnpm backfill:city-key`
Expected: `N prospects examinés, M mis à jour`. Relancer une seconde fois doit afficher `aucun à corriger` — c'est le contrôle d'idempotence.

- [ ] **Step 10 : Vérifier types et lint, puis commit**

```bash
npx tsc --noEmit && npx eslint src/lib/models/prospect.model.ts src/lib/import-parser.ts src/lib/backfill-city-key.ts src/lib/import-parser.test.ts "src/app/api/prospects/route.ts"
git add src/lib/models/prospect.model.ts src/lib/import-parser.ts src/lib/import-parser.test.ts src/lib/backfill-city-key.ts "src/app/api/prospects/route.ts" package.json
git commit -m "feat(territoires): Ajouter address.cityKey et son script de rattrapage"
```

---

### Task 4 : Modèle Territory et service de répartition

**Files:**
- Create: `src/lib/models/territory.model.ts`
- Create: `src/lib/territory-service.ts`

**Interfaces:**
- Consumes: `distribute`, `CloserLoad` de `@/lib/territory-balance` (Task 2) ; `normalizeCity` de `@/lib/city` (Task 1) ; `address.cityKey` (Task 3).
- Produces, exportés par `@/lib/territory-service` :
  - `measureLoads(closerIds: string[]): Promise<CloserLoad[]>`
  - `applyTerritory(territoryId: string, userId: string): Promise<ApplyResult>` où `ApplyResult = { assigned: number; perCloser: Record<string, number> }`
  - `resolveAssignmentsByCity(cityKeys: string[]): Promise<Map<string, string[]>>`
  - `activeCloserIds(closerIds: unknown[]): Promise<string[]>`
  - `validateClosers(closers: unknown): Promise<string[] | null>`
  
  Task 5 consomme `applyTerritory` et `validateClosers`, Task 6 consomme `resolveAssignmentsByCity`.

- [ ] **Step 1 : Créer le modèle**

Créer `src/lib/models/territory.model.ts` :

```ts
import mongoose, { Schema } from "mongoose";

// Un territoire attribue une ville à un ou plusieurs closers. L'index unique
// sur cityKey garantit qu'une ville n'a qu'un seul territoire, donc qu'aucune
// ambiguïté de rattachement n'est possible à l'import.
const territorySchema = new Schema(
  {
    // Forme affichée, telle que saisie par l'admin : « Reims ».
    city: { type: String, required: true },
    // normalizeCity(city) — clé de rattachement, minuscules et sans accents.
    cityKey: { type: String, required: true, unique: true },
    closers: [{ type: Schema.Types.ObjectId, ref: "User" }],
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export const Territory =
  mongoose.models.Territory || mongoose.model("Territory", territorySchema);
```

- [ ] **Step 2 : Créer le service**

Créer `src/lib/territory-service.ts` :

```ts
// Accès base pour les territoires. La logique de répartition elle-même vit
// dans territory-balance.ts, sans dépendance à Mongoose, pour rester testable.

import { emitCrmEvent } from "./events";
import { Activity } from "./models/activity.model";
import { Prospect } from "./models/prospect.model";
import { Territory } from "./models/territory.model";
import { User } from "./models/user.model";
import { distribute, type CloserLoad } from "./territory-balance";

export interface ApplyResult {
  readonly assigned: number;
  readonly perCloser: Record<string, number>;
}

/**
 * Valide une liste d'identifiants de closer soumise par l'admin.
 * Retourne les identifiants si TOUS sont valides, null au moindre invalide —
 * un territoire à moitié appliqué serait pire qu'un refus net.
 *
 * Plus strict que l'attribution unitaire de PUT /api/prospects/[id], qui ne
 * vérifie pas le rôle : un territoire pilote une équipe commerciale, y placer
 * un dev ou un admin n'aurait pas de sens.
 */
export async function validateClosers(
  closers: unknown
): Promise<string[] | null> {
  if (!Array.isArray(closers)) return null;
  if (closers.length === 0) return [];

  const ids = closers.map(String);
  const found = await User.find(
    { _id: { $in: ids }, isActive: true, role: "closer" },
    { _id: 1 }
  ).lean();

  return found.length === ids.length ? ids : null;
}

/**
 * Ne conserve que les identifiants correspondant à un closer encore actif.
 * Un closer désactivé ou supprimé ne doit plus recevoir de prospects, mais
 * ceux qu'il détient déjà ne bougent pas.
 */
export async function activeCloserIds(closerIds: unknown[]): Promise<string[]> {
  if (closerIds.length === 0) return [];

  const users = await User.find(
    { _id: { $in: closerIds }, isActive: true, role: "closer" },
    { _id: 1 }
  ).lean();

  return users.map((user) => String(user._id));
}

/**
 * Mesure la charge d'appels en attente de chaque closer.
 * Portée volontairement globale : on compte toutes villes confondues, pour
 * refléter la bande passante réelle du closer et non l'équilibre d'une ville.
 * Une seule agrégation, quel que soit le nombre de prospects à répartir.
 */
export async function measureLoads(closerIds: string[]): Promise<CloserLoad[]> {
  if (closerIds.length === 0) return [];

  const rows = await Prospect.aggregate<{ _id: unknown; n: number }>([
    { $match: { assignedTo: { $in: closerIds }, status: "prospect" } },
    { $group: { _id: "$assignedTo", n: { $sum: 1 } } },
  ]);

  const counts = new Map(rows.map((row) => [String(row._id), row.n]));

  // Un closer absent du résultat n'a aucun prospect en attente : charge nulle.
  return closerIds.map((closerId) => ({
    closerId,
    load: counts.get(closerId) ?? 0,
  }));
}

/**
 * Répartit les prospects NON ATTRIBUÉS d'un territoire entre ses closers actifs.
 * Les prospects déjà attribués ne sont jamais touchés, quel que soit leur statut.
 *
 * MongoDB tourne en standalone : pas de transaction. Les compteurs retournés
 * reflètent les écritures réellement effectuées, jamais l'intention.
 */
export async function applyTerritory(
  territoryId: string,
  userId: string
): Promise<ApplyResult> {
  const empty: ApplyResult = { assigned: 0, perCloser: {} };

  const territory = await Territory.findById(territoryId).lean();
  if (!territory) return empty;

  const closerIds = await activeCloserIds(territory.closers ?? []);
  if (closerIds.length === 0) return empty;

  const prospects = await Prospect.find(
    { "address.cityKey": territory.cityKey, assignedTo: null },
    { _id: 1 }
  ).lean();

  if (prospects.length === 0) return empty;

  const loads = await measureLoads(closerIds);
  const picks = distribute({ loads, count: prospects.length });

  const operations = prospects.map((prospect, index) => ({
    updateOne: {
      // Le filtre reprend `assignedTo: null` : si un autre écrivain a attribué
      // ce prospect entre-temps, l'opération devient un no-op au lieu de l'écraser.
      filter: { _id: prospect._id, assignedTo: null },
      update: { $set: { assignedTo: picks[index]! } },
    },
  }));

  const { modifiedCount } = await Prospect.bulkWrite(operations);

  const perCloser = picks.reduce<Record<string, number>>((acc, closerId) => {
    return { ...acc, [closerId]: (acc[closerId] ?? 0) + 1 };
  }, {});

  if (modifiedCount > 0) {
    // Une activité par prospect serait disproportionnée sur un lot de plusieurs
    // centaines. On suit le précédent de l'import : une seule activité,
    // rattachée au premier prospect affecté.
    // Le type reste "note" : l'énumération d'Activity n'a pas de type
    // d'attribution, et le code d'attribution unitaire utilise déjà "note".
    await Activity.create({
      prospectId: prospects[0]!._id,
      userId,
      type: "note",
      content: `Territoire ${territory.city} : ${modifiedCount} prospects attribués`,
      metadata: { territoryId, city: territory.city, perCloser },
    });

    emitCrmEvent({
      type: "prospect:updated",
      userId,
      timestamp: Date.now(),
    });
  }

  return { assigned: modifiedCount, perCloser };
}

/**
 * Pour un ensemble de villes, retourne la file des closers à qui attribuer les
 * prospects, ville par ville.
 *
 * La charge étant globale, elle est mesurée UNE fois pour l'union des closers
 * concernés, puis les répartitions s'enchaînent en reportant les charges
 * incrémentées d'une ville à la suivante. Mesurer ville par ville donnerait un
 * résultat faux : les attributions de la ville précédente ne sont pas encore
 * écrites, donc le même closer paraîtrait libre deux fois.
 *
 * @param cityKeys Une entrée par prospect à attribuer — les doublons comptent,
 *   puisqu'ils représentent chacun un prospect de cette ville.
 * @returns Une file d'identifiants de closer par cityKey. Les villes sans
 *   territoire ou sans closer actif sont absentes de la Map.
 */
export async function resolveAssignmentsByCity(
  cityKeys: string[]
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (cityKeys.length === 0) return result;

  const demand = cityKeys.reduce<Map<string, number>>((acc, key) => {
    return acc.set(key, (acc.get(key) ?? 0) + 1);
  }, new Map());

  const territories = await Territory.find({
    cityKey: { $in: [...demand.keys()] },
  }).lean();

  if (territories.length === 0) return result;

  const closersByCity = new Map<string, string[]>();
  for (const territory of territories) {
    const active = await activeCloserIds(territory.closers ?? []);
    if (active.length > 0) closersByCity.set(territory.cityKey, active);
  }

  const union = [...new Set([...closersByCity.values()].flat())];
  if (union.length === 0) return result;

  const measured = await measureLoads(union);
  const running = new Map(measured.map((entry) => [entry.closerId, entry.load]));

  for (const [cityKey, closerIds] of closersByCity) {
    const count = demand.get(cityKey) ?? 0;
    if (count === 0) continue;

    const loads = closerIds.map((closerId) => ({
      closerId,
      load: running.get(closerId) ?? 0,
    }));

    const picks = distribute({ loads, count });
    result.set(cityKey, picks);

    // Report des charges pour la ville suivante.
    for (const closerId of picks) {
      running.set(closerId, (running.get(closerId) ?? 0) + 1);
    }
  }

  return result;
}
```

- [ ] **Step 3 : Vérifier types et lint**

Run: `npx tsc --noEmit && npx eslint src/lib/territory-service.ts src/lib/models/territory.model.ts`
Expected: aucune erreur. Si Mongoose se plaint du typage de `.lean()`, annoter le retour comme le fait `src/app/api/users/[id]/route.ts:69-70`.

- [ ] **Step 4 : Commit**

```bash
git add src/lib/models/territory.model.ts src/lib/territory-service.ts
git commit -m "feat(territoires): Ajouter le modèle Territory et son service"
```

---

### Task 5 : API territoires

**Files:**
- Create: `src/app/api/territories/route.ts`
- Create: `src/app/api/territories/[id]/route.ts`

**Interfaces:**
- Consumes: `applyTerritory` et `validateClosers` de `@/lib/territory-service` (Task 4) ; `normalizeCity` de `@/lib/city` (Task 1) ; `getAuthSession`, `unauthorized`, `forbidden` de `@/lib/api-auth`.
- Produces: les quatre endpoints consommés par l'écran de Task 9. Forme de réponse de `POST`/`PUT` : `{ territory, assigned, perCloser }`.

- [ ] **Step 1 : Écrire la route de collection**

Créer `src/app/api/territories/route.ts` :

```ts
import { NextRequest, NextResponse } from "next/server";

import { forbidden, getAuthSession, unauthorized } from "@/lib/api-auth";
import { normalizeCity } from "@/lib/city";
import { connectDB } from "@/lib/db";
import { Prospect } from "@/lib/models/prospect.model";
import { Territory } from "@/lib/models/territory.model";
import { applyTerritory, validateClosers } from "@/lib/territory-service";

export async function GET() {
  const session = await getAuthSession();
  if (!session) return unauthorized();
  if (session.user.role !== "admin") return forbidden();

  await connectDB();

  const territories = await Territory.find()
    .sort({ city: 1 })
    .populate("closers", "name email")
    .lean();

  // Deux agrégations au total, quel que soit le nombre de territoires.
  const keys = territories.map((territory) => territory.cityKey);

  const [totals, unassigned] = await Promise.all([
    Prospect.aggregate<{ _id: string; n: number }>([
      { $match: { "address.cityKey": { $in: keys } } },
      { $group: { _id: "$address.cityKey", n: { $sum: 1 } } },
    ]),
    Prospect.aggregate<{ _id: string; n: number }>([
      { $match: { "address.cityKey": { $in: keys }, assignedTo: null } },
      { $group: { _id: "$address.cityKey", n: { $sum: 1 } } },
    ]),
  ]);

  const totalByCity = new Map(totals.map((row) => [row._id, row.n]));
  const unassignedByCity = new Map(unassigned.map((row) => [row._id, row.n]));

  return NextResponse.json({
    territories: territories.map((territory) => ({
      ...territory,
      prospectCount: totalByCity.get(territory.cityKey) ?? 0,
      unassignedCount: unassignedByCity.get(territory.cityKey) ?? 0,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();
  if (session.user.role !== "admin") return forbidden();

  await connectDB();

  const body = await req.json();
  const city = typeof body.city === "string" ? body.city.trim() : "";

  if (city === "") {
    return NextResponse.json({ error: "Ville requise" }, { status: 400 });
  }

  const closers = await validateClosers(body.closers ?? []);
  if (closers === null) {
    return NextResponse.json(
      { error: "Closer inexistant, inactif ou de rôle incorrect" },
      { status: 400 }
    );
  }

  const cityKey = normalizeCity(city);

  const existing = await Territory.findOne({ cityKey }).lean();
  if (existing) {
    return NextResponse.json(
      { error: "Un territoire existe déjà pour cette ville" },
      { status: 409 }
    );
  }

  const territory = await Territory.create({
    city,
    cityKey,
    closers,
    createdBy: session.user.id,
  });

  const { assigned, perCloser } = await applyTerritory(
    territory._id.toString(),
    session.user.id
  );

  return NextResponse.json({ territory, assigned, perCloser }, { status: 201 });
}
```

- [ ] **Step 2 : Écrire la route d'élément**

Créer `src/app/api/territories/[id]/route.ts` :

```ts
import { NextRequest, NextResponse } from "next/server";

import { forbidden, getAuthSession, unauthorized } from "@/lib/api-auth";
import { connectDB } from "@/lib/db";
import { Territory } from "@/lib/models/territory.model";
import { applyTerritory, validateClosers } from "@/lib/territory-service";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();
  if (session.user.role !== "admin") return forbidden();

  await connectDB();

  const { id } = await params;
  const body = await req.json();

  const closers = await validateClosers(body.closers ?? []);
  if (closers === null) {
    return NextResponse.json(
      { error: "Closer inexistant, inactif ou de rôle incorrect" },
      { status: 400 }
    );
  }

  // Retirer un closer ne retire aucune attribution existante : ses prospects
  // restent les siens, seule la répartition future change.
  const territory = await Territory.findByIdAndUpdate(
    id,
    { closers },
    { new: true }
  ).populate("closers", "name email");

  if (!territory) {
    return NextResponse.json({ error: "Territoire introuvable" }, { status: 404 });
  }

  const { assigned, perCloser } = await applyTerritory(id, session.user.id);

  return NextResponse.json({ territory, assigned, perCloser });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();
  if (session.user.role !== "admin") return forbidden();

  await connectDB();

  const { id } = await params;
  const deleted = await Territory.findByIdAndDelete(id);

  if (!deleted) {
    return NextResponse.json({ error: "Territoire introuvable" }, { status: 404 });
  }

  // La règle disparaît, les attributions déjà faites sont conservées.
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3 : Vérifier types et lint**

Run: `npx tsc --noEmit && npx eslint "src/app/api/territories/route.ts" "src/app/api/territories/[id]/route.ts"`
Expected: aucune erreur.

- [ ] **Step 4 : Commit**

```bash
git add "src/app/api/territories"
git commit -m "feat(territoires): Ajouter l'API CRUD des territoires"
```

---

### Task 6 : Attribution automatique à l'import et à la création

**Files:**
- Modify: `src/app/api/prospects/import/route.ts` (`processProspectImportBatch`, `POST`)
- Modify: `src/app/api/prospects/route.ts` (`POST`)

**Interfaces:**
- Consumes: `resolveAssignmentsByCity` de `@/lib/territory-service` (Task 4) ; `address.cityKey` (Task 3).
- Produces: aucun nouvel export. Effet observable : les prospects importés sur une ville sous territoire arrivent avec `assignedTo` renseigné.

- [ ] **Step 1 : Attribuer pendant l'import**

Dans `src/app/api/prospects/import/route.ts`, ajouter aux imports :

```ts
import { resolveAssignmentsByCity } from "@/lib/territory-service";
```

Remplacer la signature et le corps de `processProspectImportBatch` par :

```ts
/**
 * Extrait la clé de ville d'un prospect importé, ou null si absente.
 */
function cityKeyOf(data: ProspectImportData): string | null {
  const key = (data.address as Record<string, unknown> | undefined)?.cityKey;
  return typeof key === "string" && key !== "" ? key : null;
}

/**
 * Processes a batch of prospect records, detecting duplicates and tracking import metrics.
 * Sequential awaits preserve database query ordering.
 *
 * Les prospects dont la ville est couverte par un territoire reçoivent un
 * closer. La répartition est calculée en amont de la boucle, à partir d'une
 * seule mesure de charge pour tout le lot.
 */
async function processProspectImportBatch(
  prospectData: ReadonlyArray<ProspectImportData>,
  batchId: string
): Promise<{
  readonly imported: number;
  readonly duplicates: number;
  readonly errors: number;
  readonly autoAssigned: number;
}> {
  let imported = 0;
  let duplicates = 0;
  let errors = 0;
  let autoAssigned = 0;

  const assignmentsByCity = await resolveAssignmentsByCity(
    prospectData.map(cityKeyOf).filter((key) => key !== null)
  );

  for (const data of prospectData) {
    try {
      const isDuplicate = await findDuplicateByNameAndCity(
        String(data.name),
        String(data.address?.city || "")
      );

      if (isDuplicate) {
        duplicates++;
        continue;
      }

      const cityKey = cityKeyOf(data);
      const queue = cityKey ? assignmentsByCity.get(cityKey) : undefined;
      const assignedTo = queue?.shift() ?? null;

      await createProspectWithBatch({ ...data, assignedTo }, batchId);
      imported++;
      if (assignedTo) autoAssigned++;
    } catch {
      errors++;
    }
  }

  return { imported, duplicates, errors, autoAssigned };
}
```

> Note : `queue.shift()` consomme la file au fil des créations. Les doublons
> ignorés ne consomment pas de place, donc la répartition reste équilibrée
> même quand une partie du fichier est rejetée.

- [ ] **Step 2 : Remonter le compteur dans la réponse**

Dans le même fichier, dans `POST`, remplacer :

```ts
  const batchId = `import_${Date.now()}`;
  const { imported, duplicates, errors } = await processProspectImportBatch(
    prospectData,
    batchId
  );
```

par :

```ts
  const batchId = `import_${Date.now()}`;
  const { imported, duplicates, errors, autoAssigned } =
    await processProspectImportBatch(prospectData, batchId);
```

Puis remplacer le `return` final :

```ts
  return NextResponse.json({
    imported,
    duplicates,
    errors,
    batchId,
  });
```

par :

```ts
  return NextResponse.json({
    imported,
    duplicates,
    errors,
    autoAssigned,
    batchId,
  });
```

- [ ] **Step 3 : Mentionner les attributions dans l'activité d'import**

Dans `createImportActivityRecord`, ajouter `autoAssigned` aux options et au
contenu. Remplacer la fonction entière par :

```ts
/**
 * Creates an activity record documenting the import batch.
 */
async function createImportActivityRecord(opts: {
  readonly userId: string;
  readonly batchId: string;
  readonly imported: number;
  readonly duplicates: number;
  readonly errors: number;
  readonly autoAssigned: number;
}): Promise<void> {
  const firstProspect = await Prospect.findOne({ importBatch: opts.batchId });
  if (firstProspect) {
    const assignmentNote =
      opts.autoAssigned > 0
        ? `, dont ${opts.autoAssigned} attribués par territoire`
        : "";

    await Activity.create({
      prospectId: firstProspect._id,
      userId: opts.userId,
      type: "import",
      content: `Import de ${opts.imported} prospects${assignmentNote} (lot: ${opts.batchId})`,
      metadata: {
        batchId: opts.batchId,
        imported: opts.imported,
        duplicates: opts.duplicates,
        errors: opts.errors,
        autoAssigned: opts.autoAssigned,
      },
    });
  }
}
```

Et dans `POST`, passer le compteur :

```ts
    await createImportActivityRecord({
      userId: session.user.id,
      batchId,
      imported,
      duplicates,
      errors,
      autoAssigned,
    });
```

- [ ] **Step 4 : Attribuer à la création manuelle**

Dans `src/app/api/prospects/route.ts`, compléter l'import de Task 3 :

```ts
import { resolveAssignmentsByCity } from "@/lib/territory-service";
```

Puis remplacer, dans `POST` :

```ts
  const prospect = await Prospect.create(withCityKey(body));
```

par :

```ts
  const payload = withCityKey(body);

  /**
   * Résout le closer d'un territoire pour ce prospect.
   * Le territoire ne s'applique qu'à défaut : une attribution explicite gagne.
   */
  async function resolveTerritoryAssignee(): Promise<string | null> {
    if (payload.assignedTo) return null;

    const cityKey = (payload.address as Record<string, unknown> | undefined)
      ?.cityKey;
    if (typeof cityKey !== "string" || cityKey === "") return null;

    const assignments = await resolveAssignmentsByCity([cityKey]);
    return assignments.get(cityKey)?.[0] ?? null;
  }

  const territoryAssignee = await resolveTerritoryAssignee();

  const prospect = await Prospect.create(
    territoryAssignee ? { ...payload, assignedTo: territoryAssignee } : payload
  );
```

- [ ] **Step 5 : Vérifier types et lint**

Run: `npx tsc --noEmit && npx eslint "src/app/api/prospects/import/route.ts" "src/app/api/prospects/route.ts"`
Expected: aucune erreur.

- [ ] **Step 6 : Commit**

```bash
git add "src/app/api/prospects/import/route.ts" "src/app/api/prospects/route.ts"
git commit -m "feat(territoires): Attribuer automatiquement les prospects importés"
```

---

### Task 7 : Purge des territoires à la suppression d'un utilisateur

**Files:**
- Modify: `src/app/api/users/[id]/route.ts` (`detachUserReferences`, lignes 219-251)

**Interfaces:**
- Consumes: `Territory` de `@/lib/models/territory.model` (Task 4).
- Produces: ajoute `territoriesUpdated: number` au `DeletionSummary` existant.

- [ ] **Step 1 : Retirer le compte des territoires**

Dans `src/app/api/users/[id]/route.ts`, ajouter aux imports :

```ts
import { Territory } from "@/lib/models/territory.model";
```

Dans `detachUserReferences`, avant le `return`, ajouter :

```ts
  // Sans ça, la répartition d'un territoire ciblerait un compte supprimé.
  // activeCloserIds filtrerait l'identifiant, mais la donnée resterait fausse
  // et l'interface afficherait un closer fantôme.
  const territories = await Territory.updateMany(
    { closers: userId },
    { $pull: { closers: userId } }
  );
```

Puis ajouter au `return` :

```ts
    territoriesUpdated: territories.modifiedCount,
```

- [ ] **Step 2 : Compléter le type `DeletionSummary`**

Dans le même fichier, ajouter à l'interface `DeletionSummary` :

```ts
  readonly territoriesUpdated: number;
```

- [ ] **Step 3 : Vérifier types et lint**

Run: `npx tsc --noEmit && npx eslint "src/app/api/users/[id]/route.ts"`
Expected: aucune erreur. Si le typecheck signale un champ manquant ailleurs, c'est que `DeletionSummary` est consommé plus loin dans le fichier : compléter aussi ce point d'usage.

- [ ] **Step 4 : Commit**

```bash
git add "src/app/api/users/[id]/route.ts"
git commit -m "fix(territoires): Retirer un compte supprimé de ses territoires"
```

---

### Task 8 : Filtre ville sur la liste des prospects

**Files:**
- Modify: `src/components/prospect-filters.tsx`
- Modify: `src/app/(dashboard)/prospects/page.tsx`

**Interfaces:**
- Consumes: le paramètre `city` déjà accepté par `GET /api/prospects` (`buildProspectFilter`, `src/app/api/prospects/route.ts:40`). Aucun changement serveur.
- Produces: `ProspectFiltersProps.onFilterChange` reçoit désormais `{ search, status, city }`.

- [ ] **Step 1 : Ajouter le champ ville au composant de filtres**

Dans `src/components/prospect-filters.tsx`, remplacer l'interface de props :

```ts
interface ProspectFiltersProps {
  onFilterChange: (filters: {
    search: string;
    status: ProspectStatus | "";
    city: string;
  }) => void;
  initialSearch?: string;
  initialStatus?: ProspectStatus | "";
  initialCity?: string;
  hideStatus?: boolean;
}
```

Remplacer la signature du composant :

```tsx
export function ProspectFilters({
  onFilterChange,
  initialSearch = "",
  initialStatus = "",
  initialCity = "",
  hideStatus = false,
}: ProspectFiltersProps) {
  const [search, setSearch] = useState(initialSearch);
  const [city, setCity] = useState(initialCity);
  const [activeStatus, setActiveStatus] = useState<ProspectStatus | "">(
    initialStatus
  );

  function handleSearchChange(value: string) {
    setSearch(value);
    onFilterChange({ search: value, status: activeStatus, city });
  }

  function handleCityChange(value: string) {
    setCity(value);
    onFilterChange({ search, status: activeStatus, city: value });
  }

  function handleStatusChange(status: ProspectStatus | "") {
    const newStatus = status === activeStatus ? "" : status;
    setActiveStatus(newStatus);
    onFilterChange({ search, status: newStatus, city });
  }
```

- [ ] **Step 2 : Rendre le champ ville**

Toujours dans `src/components/prospect-filters.tsx`, remplacer le bloc `{/* Search */}` par :

```tsx
      {/* Recherche et ville */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher un prospect..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10"
            data-test="prospect-search"
          />
        </div>
        <div className="relative w-full sm:w-56">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Ville"
            value={city}
            onChange={(e) => handleCityChange(e.target.value)}
            className="pl-10"
            data-test="prospect-city"
          />
        </div>
      </div>
```

Et compléter l'import d'icônes en tête de fichier :

```ts
import { MapPin, Search, X } from "lucide-react";
```

- [ ] **Step 3 : Câbler le paramètre dans la page**

Dans `src/app/(dashboard)/prospects/page.tsx`, quatre modifications.

Ajouter `city` à l'interface `ListFilters` (ligne 20-26) :

```ts
interface ListFilters {
  readonly search: string;
  readonly status: ProspectStatus | "";
  readonly city: string;
  readonly assignedTo: string;
  readonly rdvUpcoming: boolean;
  readonly paidMonth: boolean;
}
```

Ajouter la valeur initiale dans `useState<ListFilters>` (ligne 59-65), après la
ligne `status:` :

```ts
    city: searchParams.get("city") ?? "",
```

Ajouter le paramètre dans `fetchProspects` (ligne 68-84), après la ligne
`if (f.status)` :

```ts
    if (f.city) params.set("city", f.city);
```

Élargir la signature de `handleFilterChange` (ligne 99-101) :

```ts
  function handleFilterChange(
    newFilters: Readonly<{
      search: string;
      status: ProspectStatus | "";
      city: string;
    }>
  ) {
    updateFilters(newFilters);
  }
```

Enfin, passer la valeur initiale au composant (ligne 179-184) :

```tsx
      <ProspectFilters
        onFilterChange={handleFilterChange}
        initialSearch={filters.search}
        initialStatus={filters.status}
        initialCity={filters.city}
        hideStatus={session?.user?.role === "dev"}
      />
```

- [ ] **Step 4 : Vérifier en conditions réelles**

```bash
pnpm dev
```

Ouvrir `http://localhost:3003/prospects`, saisir une ville dans le nouveau
champ. Vérifier dans l'onglet Réseau que la requête porte bien `city=` et que
la liste se restreint. Vider le champ et vérifier que la liste complète revient.

> Le serveur de dev tourne sur le port **3003** (3000 est occupé par un autre
> projet).

- [ ] **Step 5 : Vérifier types et lint, puis commit**

```bash
npx tsc --noEmit && npx eslint src/components/prospect-filters.tsx "src/app/(dashboard)/prospects/page.tsx"
git add src/components/prospect-filters.tsx "src/app/(dashboard)/prospects/page.tsx"
git commit -m "feat(prospects): Exposer le filtre ville dans la liste"
```

---

### Task 9 : Écran d'administration des territoires

**Files:**
- Create: `src/components/ui/checkbox.tsx` (via CLI shadcn)
- Create: `src/app/(dashboard)/territoires/page.tsx`
- Modify: `src/components/sidebar.tsx` (tableau `navigation`, ligne 22-26 ; composant `Sidebar`)

**Interfaces:**
- Consumes: les endpoints de Task 5.
- Produces: la route `/territoires`, visible des seuls admins.

- [ ] **Step 1 : Installer le composant Checkbox**

```bash
npx shadcn@latest add checkbox
```

> Le CLI propose parfois de réécrire `globals.css`. **Refuser.** Vérifier
> ensuite `git diff src/app/globals.css` : le fichier doit être inchangé.

- [ ] **Step 2 : Ajouter l'entrée de sidebar réservée à l'admin**

Dans `src/components/sidebar.tsx`, remplacer le tableau `navigation` :

```ts
const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Prospects", href: "/prospects", icon: Users },
  { name: "Pipeline", href: "/pipeline", icon: Kanban },
];

const adminNavigation = [
  { name: "Territoires", href: "/territoires", icon: Map },
];
```

Compléter l'import d'icônes :

```ts
import {
  LayoutDashboard,
  Users,
  Kanban,
  Map,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
```

Puis, dans le composant `Sidebar`, juste après `const collapsed = useSidebarCollapsed();` :

```ts
  const visibleNavigation =
    session?.user?.role === "admin"
      ? [...navigation, ...adminNavigation]
      : navigation;
```

Et remplacer `{navigation.map((item) => (` par `{visibleNavigation.map((item) => (`.

- [ ] **Step 3 : Créer l'écran**

Créer `src/app/(dashboard)/territoires/page.tsx` :

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { MapPin, Plus, Trash2 } from "lucide-react";

import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface Closer {
  readonly _id: string;
  readonly name: string;
  readonly email: string;
}

interface Territory {
  readonly _id: string;
  readonly city: string;
  readonly cityKey: string;
  readonly closers: ReadonlyArray<Closer>;
  readonly prospectCount: number;
  readonly unassignedCount: number;
}

interface EditorState {
  readonly open: boolean;
  readonly territoryId: string | null;
  readonly city: string;
  readonly closerIds: ReadonlyArray<string>;
}

const CLOSED_EDITOR: EditorState = {
  open: false,
  territoryId: null,
  city: "",
  closerIds: [],
};

export default function TerritoiresPage() {
  const { data: session } = useSession();
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [closers, setClosers] = useState<Closer[]>([]);
  const [editor, setEditor] = useState<EditorState>(CLOSED_EDITOR);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const [territoriesRes, usersRes] = await Promise.all([
      fetch("/api/territories"),
      fetch("/api/users"),
    ]);

    if (!territoriesRes.ok) {
      setError("Impossible de charger les territoires");
      return;
    }

    const territoriesData = await territoriesRes.json();
    setTerritories(territoriesData.territories ?? []);

    if (usersRes.ok) {
      // GET /api/users retourne un tableau nu (src/app/api/users/route.ts:15),
      // pas un objet enveloppe.
      const users: ReadonlyArray<Closer & { role: string; isActive: boolean }> =
        await usersRes.json();

      setClosers(
        users.filter((user) => user.role === "closer" && user.isActive)
      );
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function toggleCloser(closerId: string) {
    setEditor((current) => ({
      ...current,
      closerIds: current.closerIds.includes(closerId)
        ? current.closerIds.filter((id) => id !== closerId)
        : [...current.closerIds, closerId],
    }));
  }

  async function handleSubmit() {
    setError("");

    const isEdit = editor.territoryId !== null;
    const res = await fetch(
      isEdit ? `/api/territories/${editor.territoryId}` : "/api/territories",
      {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city: editor.city, closers: editor.closerIds }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "Erreur lors de l'enregistrement");
      return;
    }

    setNotice(
      data.assigned > 0
        ? `${data.assigned} prospect${data.assigned > 1 ? "s" : ""} attribué${data.assigned > 1 ? "s" : ""}`
        : "Territoire enregistré, aucun prospect à attribuer"
    );
    setEditor(CLOSED_EDITOR);
    await load();
  }

  async function handleDelete(territory: Territory) {
    const confirmed = window.confirm(
      `Supprimer le territoire ${territory.city} ? Les attributions déjà faites sont conservées.`
    );
    if (!confirmed) return;

    const res = await fetch(`/api/territories/${territory._id}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      setError("Suppression impossible");
      return;
    }

    await load();
  }

  if (session?.user?.role !== "admin") {
    return (
      <>
        <Header title="Territoires" description="Réservé aux administrateurs" />
        <Card className="max-w-md mx-auto text-center py-12">
          <p className="text-muted-foreground">Accès refusé</p>
        </Card>
      </>
    );
  }

  return (
    <>
      <Header
        title="Territoires"
        description="Attribuez les villes à vos closers"
      />

      <div className="flex justify-end mb-4">
        <Button
          onClick={() => setEditor({ ...CLOSED_EDITOR, open: true })}
          data-test="territory-create"
        >
          <Plus className="h-4 w-4" />
          Nouveau territoire
        </Button>
      </div>

      {notice && <p className="text-sm text-green-600 mb-4">{notice}</p>}
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      <Card>
        {territories.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            Aucun territoire. Créez-en un pour répartir automatiquement les
            prospects d&apos;une ville.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Ville</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Closers</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Prospects</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Non attribués</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {territories.map((territory) => (
                  <tr key={territory._id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">
                      <span className="inline-flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        {territory.city}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {territory.closers.length === 0
                        ? "—"
                        : territory.closers.map((closer) => closer.name).join(", ")}
                    </td>
                    <td className="px-3 py-2">{territory.prospectCount}</td>
                    <td className="px-3 py-2">
                      {territory.unassignedCount > 0 ? (
                        <span className="text-orange-600">{territory.unassignedCount}</span>
                      ) : (
                        "0"
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setEditor({
                            open: true,
                            territoryId: territory._id,
                            city: territory.city,
                            closerIds: territory.closers.map((closer) => closer._id),
                          })
                        }
                      >
                        Modifier
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(territory)}
                        title="Supprimer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog
        open={editor.open}
        onOpenChange={(open) => !open && setEditor(CLOSED_EDITOR)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editor.territoryId ? "Modifier le territoire" : "Nouveau territoire"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Ville</label>
              <Input
                value={editor.city}
                onChange={(e) =>
                  setEditor((current) => ({ ...current, city: e.target.value }))
                }
                placeholder="Reims"
                // La ville identifie le territoire : la changer casserait le
                // rattachement des prospects déjà répartis.
                disabled={editor.territoryId !== null}
                data-test="territory-city"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Closers</label>
              {closers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucun closer actif.
                </p>
              ) : (
                <div className="space-y-2">
                  {closers.map((closer) => (
                    <label
                      key={closer._id}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <Checkbox
                        checked={editor.closerIds.includes(closer._id)}
                        onCheckedChange={() => toggleCloser(closer._id)}
                      />
                      <span className="text-sm">{closer.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              Les prospects déjà attribués ne sont jamais redistribués. Seuls
              les prospects sans closer sont répartis.
            </p>

            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setEditor(CLOSED_EDITOR)}>
                Annuler
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={editor.city.trim() === ""}
                data-test="territory-submit"
              >
                Enregistrer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 4 : Vérifier en conditions réelles**

```bash
pnpm dev
```

Sur `http://localhost:3003/territoires`, connecté en admin :

1. Créer un territoire sur une ville qui a des prospects non attribués, avec
   deux closers → le bandeau annonce le nombre attribué, la colonne
   « Non attribués » retombe à 0.
2. Rouvrir la fiche d'un prospect de cette ville → il porte bien un closer.
3. Vérifier qu'un prospect de cette ville **déjà attribué** avant l'opération
   a conservé son closer d'origine.
4. Importer un Excel sur cette ville → les nouvelles lignes arrivent réparties.
5. Supprimer le territoire → aucune attribution perdue.
6. Se connecter en closer → l'entrée « Territoires » est absente de la sidebar,
   et `/territoires` affiche « Accès refusé ».
7. Ouvrir la fiche d'un prospect attribué par le territoire → l'historique
   porte l'activité « Territoire {ville} : N prospects attribués ».

- [ ] **Step 5 : Vérifier types et lint, puis commit**

```bash
npx tsc --noEmit && npx eslint "src/app/(dashboard)/territoires/page.tsx" src/components/sidebar.tsx src/components/ui/checkbox.tsx
git add "src/app/(dashboard)/territoires" src/components/sidebar.tsx src/components/ui/checkbox.tsx
git commit -m "feat(territoires): Ajouter l'écran d'administration des territoires"
```

---

## Vérification finale

- [ ] `pnpm test` — tous les tests passent
- [ ] `npx tsc --noEmit` — aucune erreur
- [ ] `npx eslint src` — aucune erreur
- [ ] `pnpm build` — succès (c'est le seul gate du Dockerfile)
- [ ] Les six vérifications manuelles de la Task 9, Step 5
