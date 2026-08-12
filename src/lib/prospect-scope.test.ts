import { describe, expect, it } from "vitest";

import { buildProspectFilter, type ProspectFilterParams } from "./prospect-scope";

const ME = "6a5dc8ae6466fb9a3bcc088d";
const OTHER = "6a54d8b3b4715d6e7743f8ad";

function params(
  overrides: Partial<ProspectFilterParams> = {}
): ProspectFilterParams {
  return {
    userRole: "closer",
    userId: ME,
    territoryCityKeys: [],
    ...overrides,
  };
}

describe("buildProspectFilter — closer", () => {
  it("voit les prospects de ses villes et les siens", () => {
    const filter = buildProspectFilter(
      params({ territoryCityKeys: ["reims", "nancy"] })
    );

    expect(filter).toEqual({
      $or: [
        { assignedTo: ME },
        { "address.cityKey": { $in: ["reims", "nancy"] } },
      ],
    });
  });

  it("sans territoire, se limite à ses attributions", () => {
    // Un closer sans ville ne découvre pas le CRM entier.
    expect(buildProspectFilter(params())).toEqual({ assignedTo: ME });
  });

  it("conserve la portée quand une recherche apporte son propre $or", () => {
    // Le piège que `intersect` existe pour éviter : un spread écraserait l'un
    // des deux $or, et la portée disparaîtrait sans erreur.
    const filter = buildProspectFilter(
      params({ territoryCityKeys: ["reims"], search: "boulangerie" })
    ) as { $and: ReadonlyArray<Record<string, unknown>> };

    expect(filter.$and).toHaveLength(2);
    expect(filter.$and[0]!.$or).toHaveLength(4);
    expect(filter.$and[1]).toEqual({
      $or: [{ assignedTo: ME }, { "address.cityKey": { $in: ["reims"] } }],
    });
  });

  it("n'élargit pas la portée quand assignedTo cible un autre closer", () => {
    // La portée reste intersectée : le filtre demandé restreint, il n'ouvre pas.
    const filter = buildProspectFilter(
      params({ territoryCityKeys: ["reims"], assignedTo: OTHER })
    ) as { $and: ReadonlyArray<Record<string, unknown>> };

    expect(filter.$and).toEqual([
      { assignedTo: OTHER },
      { $or: [{ assignedTo: ME }, { "address.cityKey": { $in: ["reims"] } }] },
    ]);
  });

  it("croise statut demandé et portée", () => {
    const filter = buildProspectFilter(
      params({ territoryCityKeys: ["reims"], status: "rdv" })
    ) as { $and: ReadonlyArray<Record<string, unknown>> };

    expect(filter.$and).toEqual([
      { status: "rdv" },
      { $or: [{ assignedTo: ME }, { "address.cityKey": { $in: ["reims"] } }] },
    ]);
  });
});

describe("buildProspectFilter — dev", () => {
  it("se limite aux fiches à livrer, sans URL de site", () => {
    expect(buildProspectFilter(params({ userRole: "dev" }))).toEqual({
      $and: [
        { status: { $in: ["rdv", "paye"] } },
        { $or: [{ devUrl: null }, { devUrl: "" }] },
      ],
    });
  });

  it("garde toutes les fiches vendues sur le tableau de livraison", () => {
    expect(
      buildProspectFilter(params({ userRole: "dev", view: "delivery" }))
    ).toEqual({ status: { $in: ["rdv", "paye"] } });
  });

  it("intersecte le statut demandé au lieu de l'écraser", () => {
    // L'ancienne fusion par spread remplaçait `status: "rdv"` par la liste
    // complète : un dev filtrant sur « RDV Démo » recevait aussi les payés.
    const filter = buildProspectFilter(
      params({ userRole: "dev", view: "delivery", status: "rdv" })
    );

    expect(filter).toEqual({
      $and: [{ status: "rdv" }, { status: { $in: ["rdv", "paye"] } }],
    });
  });
});

describe("buildProspectFilter — admin", () => {
  it("ne subit aucune restriction de portée", () => {
    expect(buildProspectFilter(params({ userRole: "admin" }))).toEqual({});
  });

  it("applique les filtres demandés tels quels", () => {
    expect(
      buildProspectFilter(
        params({ userRole: "admin", status: "paye", assignedTo: OTHER })
      )
    ).toEqual({ status: "paye", assignedTo: OTHER });
  });
});
