import { Types } from "mongoose";
import { describe, expect, it } from "vitest";

import {
  closerCommission,
  holderIdOf,
  pickPricingUpdates,
  quoteAmountUpdate,
  resolveProspectPricing,
  validateQuoteAmount,
} from "./pricing";

const MOH = "6a5dc8ae6466fb9a3bcc088d";
const PAUL = "6a5dc8ae6466fb9a3bcc0999";

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

describe("validateQuoteAmount", () => {
  it("accepte le minimum de 1 000 € HT", () => {
    expect(validateQuoteAmount(1000)).toEqual({ amount: 1000 });
  });

  it("accepte tout montant au-dessus du minimum", () => {
    expect(validateQuoteAmount(2000)).toEqual({ amount: 2000 });
    expect(validateQuoteAmount(1499.5)).toEqual({ amount: 1499.5 });
  });

  it("refuse un prix sous le minimum", () => {
    expect(validateQuoteAmount(999.99)).toEqual({
      error: "Prix invalide : 1 000 € HT minimum",
    });
    expect(validateQuoteAmount(0)).toEqual({
      error: "Prix invalide : 1 000 € HT minimum",
    });
  });

  it("refuse une valeur non numérique", () => {
    // Un formulaire qui n'a pas converti sa saisie ne doit pas passer.
    expect(validateQuoteAmount("2000")).toEqual({
      error: "Prix invalide : 1 000 € HT minimum",
    });
    expect(validateQuoteAmount(Number.NaN)).toEqual({
      error: "Prix invalide : 1 000 € HT minimum",
    });
    expect(validateQuoteAmount(null)).toEqual({
      error: "Prix invalide : 1 000 € HT minimum",
    });
  });
});

describe("resolveProspectPricing — prix de création", () => {
  it("applique le prix posé sur la fiche", async () => {
    const db = holders({ [MOH]: { subscriptionAmount: 39 } });

    const pricing = await resolveProspectPricing(
      { quoteAmount: 2000, assignedTo: MOH },
      db.find
    );

    expect(pricing.quoteAmount).toBe(2000);
  });

  it("retombe sur le minimum quand la fiche n'a pas de prix", async () => {
    const db = holders({});

    const pricing = await resolveProspectPricing(
      { assignedTo: null },
      db.find
    );

    expect(pricing.quoteAmount).toBe(1000);
  });

  it("retombe sur le minimum quand la fiche porte un prix d'avant la règle", async () => {
    // Un document antérieur peut encore porter 500 : jamais sous 1 000 vers GoCardless.
    const db = holders({});

    const pricing = await resolveProspectPricing(
      { quoteAmount: 500, assignedTo: null },
      db.find
    );

    expect(pricing.quoteAmount).toBe(1000);
  });

  it("retombe sur le minimum quand le prix n'est pas numérique", async () => {
    const db = holders({});

    const pricing = await resolveProspectPricing(
      { quoteAmount: "2000", assignedTo: null },
      db.find
    );

    expect(pricing.quoteAmount).toBe(1000);
  });
});

describe("resolveProspectPricing — abonnement", () => {
  it("applique l'abonnement du détenteur de la fiche", async () => {
    const db = holders({ [MOH]: { subscriptionAmount: 39 } });

    const pricing = await resolveProspectPricing(
      { quoteAmount: 1000, assignedTo: MOH },
      db.find
    );

    expect(pricing.subscriptionAmount).toBe(39);
  });

  it("retombe sur l'abonnement par défaut si la fiche est libre", async () => {
    const db = holders({});

    const pricing = await resolveProspectPricing(
      { quoteAmount: 1000, assignedTo: null },
      db.find
    );

    expect(pricing.subscriptionAmount).toBe(29);
  });

  it("ne lit aucun compte quand la fiche est libre", async () => {
    const db = holders({});

    await resolveProspectPricing({ quoteAmount: 1000, assignedTo: null }, db.find);

    expect(db.calls).toEqual([]);
  });

  it("retombe sur l'abonnement par défaut si le compte a disparu", async () => {
    const db = holders({});

    const pricing = await resolveProspectPricing(
      { quoteAmount: 1000, assignedTo: MOH },
      db.find
    );

    expect(pricing.subscriptionAmount).toBe(29);
  });

  it("refuse un abonnement à zéro ou négatif", async () => {
    // Un montant nul transmis à GoCardless serait un prélèvement vide.
    const zero = holders({ [MOH]: { subscriptionAmount: 0 } });
    const negative = holders({ [MOH]: { subscriptionAmount: -5 } });

    expect(
      (await resolveProspectPricing({ assignedTo: MOH }, zero.find))
        .subscriptionAmount
    ).toBe(29);
    expect(
      (await resolveProspectPricing({ assignedTo: MOH }, negative.find))
        .subscriptionAmount
    ).toBe(29);
  });

  it("refuse un abonnement non numérique", async () => {
    const db = holders({ [MOH]: { subscriptionAmount: "39" } });

    const pricing = await resolveProspectPricing({ assignedTo: MOH }, db.find);

    expect(pricing.subscriptionAmount).toBe(29);
  });
});

describe("closerCommission", () => {
  it("reverse au closer tout ce qui dépasse 1 000 € HT", () => {
    expect(closerCommission(2000)).toBe(1000);
    expect(closerCommission(1500)).toBe(500);
  });

  it("vaut zéro sur une vente au minimum", () => {
    expect(closerCommission(1000)).toBe(0);
  });

  it("ne descend jamais sous zéro", () => {
    // Une vente d'avant la règle (500 € HT) ne crée pas de dette.
    expect(closerCommission(500)).toBe(0);
  });

  it("arrondit au centime", () => {
    expect(closerCommission(1234.567)).toBe(234.57);
  });
});

describe("quoteAmountUpdate", () => {
  const admin = { id: PAUL, role: "admin" } as const;
  const moh = { id: MOH, role: "closer" } as const;
  const paul = { id: PAUL, role: "closer" } as const;
  const fiche = { status: "rdv", assignedTo: MOH } as const;

  it("ne touche à rien quand aucun prix n'est envoyé", () => {
    expect(
      quoteAmountUpdate({ body: { name: "Boulangerie" }, existing: fiche, user: paul })
    ).toEqual({ updates: { name: "Boulangerie" } });
  });

  it("laisse le détenteur fixer le prix de sa fiche", () => {
    expect(
      quoteAmountUpdate({ body: { quoteAmount: 2000 }, existing: fiche, user: moh })
    ).toEqual({ updates: { quoteAmount: 2000 } });
  });

  it("laisse un admin fixer le prix de n'importe quelle fiche", () => {
    expect(
      quoteAmountUpdate({ body: { quoteAmount: 2000 }, existing: fiche, user: admin })
    ).toEqual({ updates: { quoteAmount: 2000 } });
  });

  it("refuse à un closer le prix d'une fiche qu'il ne détient pas", () => {
    expect(
      quoteAmountUpdate({ body: { quoteAmount: 2000 }, existing: fiche, user: paul })
    ).toEqual({ error: "Seul le closer qui détient la fiche fixe son prix", status: 403 });
  });

  it("accepte le prix d'une fiche libre posé par un closer", () => {
    // Le statut « en appel » attribue la fiche à qui la prend : le prix suit.
    expect(
      quoteAmountUpdate({
        body: { quoteAmount: 2000 },
        existing: { status: "prospect", assignedTo: null },
        user: paul,
      })
    ).toEqual({ updates: { quoteAmount: 2000 } });
  });

  it("refuse de changer le prix d'une fiche déjà payée", () => {
    expect(
      quoteAmountUpdate({
        body: { quoteAmount: 2000 },
        existing: { status: "paye", assignedTo: MOH },
        user: admin,
      })
    ).toEqual({ error: "Fiche payée : le prix ne peut plus être modifié", status: 403 });
  });

  it("refuse un prix sous le minimum", () => {
    expect(
      quoteAmountUpdate({ body: { quoteAmount: 800 }, existing: fiche, user: moh })
    ).toEqual({ error: "Prix invalide : 1 000 € HT minimum", status: 400 });
  });

  it("lit le détenteur sous sa forme peuplée", () => {
    expect(
      quoteAmountUpdate({
        body: { quoteAmount: 2000 },
        existing: { status: "rdv", assignedTo: { _id: MOH, name: "Moh" } },
        user: moh,
      })
    ).toEqual({ updates: { quoteAmount: 2000 } });
  });
});

describe("pickPricingUpdates", () => {
  it("ne retient rien quand aucun tarif n'est envoyé", () => {
    expect(pickPricingUpdates({ name: "Moh" })).toEqual({ updates: {} });
  });

  it("retient un abonnement valide", () => {
    expect(pickPricingUpdates({ subscriptionAmount: 39 })).toEqual({
      updates: { subscriptionAmount: 39 },
    });
  });

  it("ignore le prix de création, qui n'est plus un tarif de compte", () => {
    expect(
      pickPricingUpdates({ quoteAmount: 2000, subscriptionAmount: 39 })
    ).toEqual({ updates: { subscriptionAmount: 39 } });
  });

  it("ignore les champs qui ne sont pas des tarifs", () => {
    expect(
      pickPricingUpdates({ subscriptionAmount: 39, role: "admin" })
    ).toEqual({ updates: { subscriptionAmount: 39 } });
  });

  it("refuse un abonnement à zéro ou négatif", () => {
    expect(pickPricingUpdates({ subscriptionAmount: 0 })).toEqual({
      error: "Montant invalide : nombre strictement positif attendu",
    });
    expect(pickPricingUpdates({ subscriptionAmount: -5 })).toEqual({
      error: "Montant invalide : nombre strictement positif attendu",
    });
  });

  it("refuse un abonnement envoyé en chaîne ou non fini", () => {
    expect(pickPricingUpdates({ subscriptionAmount: "39" })).toEqual({
      error: "Montant invalide : nombre strictement positif attendu",
    });
    expect(pickPricingUpdates({ subscriptionAmount: Number.NaN })).toEqual({
      error: "Montant invalide : nombre strictement positif attendu",
    });
  });
});
