import { Types } from "mongoose";
import { describe, expect, it } from "vitest";

import {
  holderIdOf,
  pickPricingUpdates,
  resolveProspectPricing,
} from "./pricing";

const MOH = "6a5dc8ae6466fb9a3bcc088d";

/**
 * Lecture de compte factice — une vraie fonction, pas un mock : les tests
 * portent sur ce que résout `resolveProspectPricing`, jamais sur des appels.
 * `calls` sert uniquement à vérifier qu'aucune lecture n'est tentée en vain.
 */
function holders(byId: Readonly<Record<string, unknown>>) {
  const calls: string[] = [];
  return {
    calls,
    find: async (holderId: string) => {
      calls.push(holderId);
      return (byId[holderId] ?? null) as never;
    },
  };
}

describe("holderIdOf", () => {
  it("lit l'identifiant d'un ObjectId brut", () => {
    const id = new Types.ObjectId();
    expect(holderIdOf(id)).toBe(id.toString());
  });

  it("lit l'identifiant d'un document peuplé", () => {
    // `populate("assignedTo", ...)` remplace l'ObjectId par le document.
    const id = new Types.ObjectId();
    expect(holderIdOf({ _id: id, name: "Moh" })).toBe(id.toString());
  });

  it("accepte une chaîne déjà normalisée", () => {
    expect(holderIdOf("6a5dc8ae6466fb9a3bcc088d")).toBe(
      "6a5dc8ae6466fb9a3bcc088d"
    );
  });

  it("rend null sur une fiche non attribuée", () => {
    expect(holderIdOf(null)).toBeNull();
    expect(holderIdOf(undefined)).toBeNull();
  });

  it("rend null sur une valeur qui n'est pas un identifiant", () => {
    expect(holderIdOf("pas-un-objectid")).toBeNull();
    expect(holderIdOf({})).toBeNull();
    expect(holderIdOf(42)).toBeNull();
  });
});

describe("resolveProspectPricing", () => {
  it("applique les tarifs du détenteur de la fiche", async () => {
    const db = holders({ [MOH]: { quoteAmount: 690, subscriptionAmount: 39 } });

    expect(await resolveProspectPricing(MOH, db.find)).toEqual({
      quoteAmount: 690,
      subscriptionAmount: 39,
    });
  });

  it("retombe sur les tarifs par défaut si la fiche n'est attribuée à personne", async () => {
    const db = holders({});

    expect(await resolveProspectPricing(null, db.find)).toEqual({
      quoteAmount: 500,
      subscriptionAmount: 29,
    });
  });

  it("ne lit aucun compte quand la fiche est libre", async () => {
    const db = holders({});

    await resolveProspectPricing(null, db.find);

    expect(db.calls).toEqual([]);
  });

  it("retombe sur les tarifs par défaut si le compte a disparu", async () => {
    const db = holders({});

    expect(await resolveProspectPricing(MOH, db.find)).toEqual({
      quoteAmount: 500,
      subscriptionAmount: 29,
    });
  });
});

describe("resolveProspectPricing — tarifs inexploitables", () => {
  it("retombe sur les défauts quand le compte n'a aucun tarif", async () => {
    const db = holders({ [MOH]: {} });

    expect(await resolveProspectPricing(MOH, db.find)).toEqual({
      quoteAmount: 500,
      subscriptionAmount: 29,
    });
  });

  it("refuse un tarif à zéro", async () => {
    // Un montant nul transmis à GoCardless serait un prélèvement vide.
    const db = holders({ [MOH]: { quoteAmount: 0, subscriptionAmount: 0 } });

    expect(await resolveProspectPricing(MOH, db.find)).toEqual({
      quoteAmount: 500,
      subscriptionAmount: 29,
    });
  });

  it("refuse un tarif négatif", async () => {
    const db = holders({ [MOH]: { quoteAmount: -100, subscriptionAmount: -5 } });

    expect(await resolveProspectPricing(MOH, db.find)).toEqual({
      quoteAmount: 500,
      subscriptionAmount: 29,
    });
  });

  it("refuse un tarif non numérique", async () => {
    const db = holders({
      [MOH]: { quoteAmount: "690", subscriptionAmount: null },
    });

    expect(await resolveProspectPricing(MOH, db.find)).toEqual({
      quoteAmount: 500,
      subscriptionAmount: 29,
    });
  });

  it("traite les deux tarifs séparément", async () => {
    // Création configurée, abonnement laissé vide : seul le second retombe.
    const db = holders({ [MOH]: { quoteAmount: 690 } });

    expect(await resolveProspectPricing(MOH, db.find)).toEqual({
      quoteAmount: 690,
      subscriptionAmount: 29,
    });
  });
});

describe("pickPricingUpdates", () => {
  it("ne retient rien quand aucun tarif n'est envoyé", () => {
    expect(pickPricingUpdates({ name: "Moh" })).toEqual({ updates: {} });
  });

  it("retient un tarif de création valide", () => {
    expect(pickPricingUpdates({ quoteAmount: 690 })).toEqual({
      updates: { quoteAmount: 690 },
    });
  });

  it("retient les deux tarifs", () => {
    expect(
      pickPricingUpdates({ quoteAmount: 690, subscriptionAmount: 39 })
    ).toEqual({ updates: { quoteAmount: 690, subscriptionAmount: 39 } });
  });

  it("ignore les champs qui ne sont pas des tarifs", () => {
    expect(
      pickPricingUpdates({ quoteAmount: 690, role: "admin", isActive: false })
    ).toEqual({ updates: { quoteAmount: 690 } });
  });

  it("refuse un tarif à zéro", () => {
    expect(pickPricingUpdates({ quoteAmount: 0 })).toEqual({
      error: "Montant invalide : nombre strictement positif attendu",
    });
  });

  it("refuse un tarif négatif", () => {
    expect(pickPricingUpdates({ subscriptionAmount: -5 })).toEqual({
      error: "Montant invalide : nombre strictement positif attendu",
    });
  });

  it("refuse un tarif envoyé en chaîne", () => {
    // Un formulaire qui n'a pas converti sa saisie ne doit pas passer.
    expect(pickPricingUpdates({ quoteAmount: "690" })).toEqual({
      error: "Montant invalide : nombre strictement positif attendu",
    });
  });

  it("refuse un tarif non fini", () => {
    expect(pickPricingUpdates({ quoteAmount: Number.NaN })).toEqual({
      error: "Montant invalide : nombre strictement positif attendu",
    });
  });
});
