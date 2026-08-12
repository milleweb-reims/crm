// Accès base pour les territoires. La logique de répartition elle-même vit
// dans territory-balance.ts, sans dépendance à Mongoose, pour rester testable.

import { isValidObjectId, Types } from "mongoose";

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
 * Villes (clés normalisées) des territoires où l'utilisateur est closer.
 * C'est la portée de visibilité d'un closer : il voit les prospects de ses
 * villes, qu'ils lui soient attribués ou non.
 */
export async function closerCityKeys(userId: string): Promise<string[]> {
  if (!isValidObjectId(userId)) return [];

  const territories = await Territory.find(
    { closers: userId },
    { cityKey: 1 }
  ).lean();

  return territories.map((territory) => territory.cityKey);
}

/**
 * Mesure la charge d'appels en attente de chaque closer.
 * Portée volontairement globale : on compte toutes villes confondues, pour
 * refléter la bande passante réelle du closer et non l'équilibre d'une ville.
 * Une seule agrégation, quel que soit le nombre de prospects à répartir.
 *
 * `assignedTo` est comparé à des ObjectId construits explicitement : contrairement
 * à `find`, **une agrégation ne passe pas par le casting du schéma**. Comparé à
 * des chaînes, le `$match` ne ramenait aucune ligne — toutes les charges étaient
 * donc mesurées à zéro, et « attribuer au closer le moins chargé » revenait à
 * servir le plus petit identifiant.
 */
export async function measureLoads(closerIds: string[]): Promise<CloserLoad[]> {
  if (closerIds.length === 0) return [];

  const objectIds = closerIds
    .filter(isValidObjectId)
    .map((closerId) => new Types.ObjectId(closerId));

  if (objectIds.length === 0) {
    return closerIds.map((closerId) => ({ closerId, load: 0 }));
  }

  const rows = await Prospect.aggregate<{ _id: unknown; n: number }>([
    { $match: { assignedTo: { $in: objectIds }, status: "prospect" } },
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

  // Regroupement des prospects par closer désigné.
  const idsByCloser = picks.reduce<Map<string, unknown[]>>((acc, closerId, index) => {
    const current = acc.get(closerId) ?? [];
    return acc.set(closerId, [...current, prospects[index]!._id]);
  }, new Map());

  // Une écriture par closer plutôt qu'un bulkWrite global : chaque updateMany
  // retourne son propre modifiedCount, donc le détail par closer est exact par
  // construction. Le déduire de `picks` rapporterait l'intention et non le
  // réel — un prospect attribué entre-temps par un autre écrivain serait
  // compté à tort. Quelques requêtes de plus sur une opération admin peu
  // fréquente, contre un audit qui ne ment pas.
  const written = await Promise.all(
    [...idsByCloser].map(async ([closerId, ids]) => {
      // Le filtre reprend `assignedTo: null` : si un autre écrivain a attribué
      // ce prospect entre-temps, il est ignoré au lieu d'être écrasé.
      const { modifiedCount } = await Prospect.updateMany(
        { _id: { $in: ids }, assignedTo: null },
        { $set: { assignedTo: closerId } }
      );
      return [closerId, modifiedCount] as const;
    })
  );

  const perCloser = Object.fromEntries(written.filter(([, count]) => count > 0));
  const modifiedCount = written.reduce((total, [, count]) => total + count, 0);

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
 * Reprend aux closers les prospects d'une ville qui n'ont pas encore été
 * travaillés, et les remet à l'état non attribué.
 *
 * Seul le statut `"prospect"` est concerné : un dossier ayant avancé (appel
 * passé, rendez-vous pris, lien envoyé, payé) reste à son closer. C'est ce qui
 * rend l'action sûre — elle corrige une erreur d'attribution sans jamais
 * casser un dossier en cours.
 */
export async function releaseTerritory(
  territoryId: string,
  userId: string
): Promise<{ released: number }> {
  const territory = await Territory.findById(territoryId).lean();
  if (!territory) return { released: 0 };

  const { modifiedCount } = await Prospect.updateMany(
    {
      "address.cityKey": territory.cityKey,
      status: "prospect",
      assignedTo: { $ne: null },
    },
    { $set: { assignedTo: null } }
  );

  if (modifiedCount > 0) {
    const firstProspect = await Prospect.findOne({
      "address.cityKey": territory.cityKey,
    });

    if (firstProspect) {
      await Activity.create({
        prospectId: firstProspect._id,
        userId,
        type: "note",
        content: `Territoire ${territory.city} : ${modifiedCount} prospects libérés`,
        metadata: { territoryId, city: territory.city, released: modifiedCount },
      });
    }

    emitCrmEvent({ type: "prospect:updated", userId, timestamp: Date.now() });
  }

  return { released: modifiedCount };
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
