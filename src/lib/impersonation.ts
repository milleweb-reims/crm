// Substitution d'identité : un admin peut « devenir » un autre compte, pour voir
// et faire exactement ce que ce compte voit et fait.
//
// La cible vit dans un cookie séparé du jeton de session, et non dans le JWT.
// Deux conséquences voulues :
//
//   1. Le droit de se substituer est réévalué à CHAQUE requête, à partir du rôle
//      relu en base par le callback `jwt`. Un admin rétrogradé ou désactivé perd
//      la substitution sur-le-champ, sans attendre l'expiration d'un jeton de
//      30 jours.
//   2. Le jeton de session reste celui du vrai compte. Arrêter la substitution
//      n'est donc jamais une reconnexion : on efface un cookie, c'est tout.
//
// Le cookie n'a pas besoin d'être signé. Il ne porte que des identifiants, et le
// serveur refuse de l'honorer si le compte réel n'est pas administrateur : le
// poser à la main ne donne aucun droit.

import { isValidObjectId } from "mongoose";
import { cookies } from "next/headers";

import { connectDB } from "./db";
import { User } from "./models/user.model";
import type { UserRole } from "@/types";

export const IMPERSONATION_COOKIE = "crm.impersonate";

/**
 * Le cookie porte `<idAuteur>:<idCible>`, et non la seule cible.
 *
 * Sans le préfixe, un cookie oublié survivrait à une déconnexion : le compte
 * suivant qui se connecte sur le même navigateur se retrouverait substitué à
 * quelqu'un dès l'ouverture, sans l'avoir demandé — sur un poste partagé,
 * exactement le genre de surprise qu'on ne veut pas dans un CRM. Lier la
 * substitution à son auteur rend le cookie inerte pour tout autre compte.
 */
function encodeTarget(adminId: string, targetId: string): string {
  return `${adminId}:${targetId}`;
}

/** Identité effective d'une requête : celle du compte substitué, le cas échéant. */
export interface EffectiveUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: UserRole;
}

interface TargetRow {
  readonly _id: unknown;
  readonly name: string;
  readonly email: string;
  readonly role: UserRole;
  readonly isActive: boolean;
}

/**
 * Lit l'identifiant de la cible, si le cookie a bien été posé par ce compte.
 *
 * Ne lève jamais : hors contexte de requête, sur une valeur malformée, ou sur un
 * cookie appartenant à un autre compte, on répond « pas de substitution » plutôt
 * que de casser la requête.
 */
async function readTargetId(realUserId: string): Promise<string | null> {
  try {
    const store = await cookies();
    const raw = store.get(IMPERSONATION_COOKIE)?.value ?? "";
    const [owner, targetId] = raw.split(":");

    if (owner !== realUserId) return null;

    return isValidObjectId(targetId) ? targetId! : null;
  } catch {
    return null;
  }
}

/**
 * Pose le cookie de substitution. À n'appeler que depuis un Route Handler :
 * `cookies().set` a besoin d'écrire dans la réponse.
 *
 * Pas de `maxAge` : cookie de session navigateur. Fermer le navigateur rend
 * l'admin à son propre compte, ce qui est le défaut sûr.
 *
 * @param adminId Compte réel qui demande la substitution
 * @param targetId Compte dont il prend l'identité
 */
export async function startImpersonation(
  adminId: string,
  targetId: string
): Promise<void> {
  const store = await cookies();
  store.set(IMPERSONATION_COOKIE, encodeTarget(adminId, targetId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

/** Efface le cookie de substitution. Toujours autorisé : rendre la main est sûr. */
export async function stopImpersonation(): Promise<void> {
  const store = await cookies();
  store.delete(IMPERSONATION_COOKIE);
}

/**
 * Résout le compte auquel le porteur du jeton s'est substitué.
 *
 * Retourne null — donc « pas de substitution », l'admin reste lui-même — dans
 * tous les cas douteux : rôle réel non administrateur, cookie absent ou
 * illisible, cible qui pointe sur soi-même, compte supprimé ou désactivé depuis
 * le début de la substitution.
 *
 * @param options.realUserId Identifiant du compte réellement authentifié
 * @param options.realRole Rôle relu en base pour ce compte
 */
export async function resolveImpersonatedUser(options: {
  readonly realUserId: string;
  readonly realRole: UserRole;
}): Promise<EffectiveUser | null> {
  if (options.realRole !== "admin") return null;

  const targetId = await readTargetId(options.realUserId);
  if (!targetId || targetId === options.realUserId) return null;

  try {
    await connectDB();

    const target = (await User.findById(targetId)
      .select("name email role isActive")
      .lean()) as TargetRow | null;

    // Compte disparu ou désactivé pendant la substitution : on rend l'admin à
    // son propre compte. Le cookie périmé sera écrasé au prochain démarrage.
    if (!target || !target.isActive) return null;

    return {
      id: String(target._id),
      name: target.name,
      email: target.email,
      role: target.role,
    };
  } catch (error) {
    // Base injoignable : mieux vaut un admin sur son propre compte que toutes
    // ses requêtes en erreur.
    console.error("Substitution : cible non résolue", { targetId, error });
    return null;
  }
}
