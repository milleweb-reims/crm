import { describe, expect, it } from "vitest";

import {
  computeStatusChangeEffects,
  type ClaimableProspect,
} from "./prospect-status";

const MOH = "6a5dc8ae6466fb9a3bcc088d";
const PAUL = "6a54d8b3b4715d6e7743f8ad";

function user(id: string, name: string) {
  return { _id: { toString: () => id }, name };
}

function prospect(overrides: Partial<ClaimableProspect> = {}): ClaimableProspect {
  return { status: "prospect", lockedBy: null, assignedTo: null, ...overrides };
}

describe("computeStatusChangeEffects — prise d'une fiche non entamée", () => {
  it("attribue au closer une fiche libre qu'il entame", () => {
    const { updates, conflictError } = computeStatusChangeEffects({
      updates: { status: "en_appel" },
      existing: prospect(),
      userId: MOH,
      userRole: "closer",
    });

    expect(conflictError).toBeUndefined();
    expect(updates.assignedTo).toBe(MOH);
  });

  it("attribue au closer une fiche que le territoire avait suggérée à un autre", () => {
    // Le cas Reims : le stock avait été pré-réparti à Paul, Moh arrive sur la
    // ville. Tant que la fiche n'a pas été appelée, elle est prenable.
    const { updates, conflictError } = computeStatusChangeEffects({
      updates: { status: "en_appel" },
      existing: prospect({ assignedTo: user(PAUL, "Paul") }),
      userId: MOH,
      userRole: "closer",
    });

    expect(conflictError).toBeUndefined();
    expect(updates.assignedTo).toBe(MOH);
  });

  it("pose le verrou en passant « en appel »", () => {
    const { updates } = computeStatusChangeEffects({
      updates: { status: "en_appel" },
      existing: prospect(),
      userId: MOH,
      userRole: "closer",
    });

    expect(updates.lockedBy).toBe(MOH);
    expect(updates.lockedAt).toBeInstanceOf(Date);
  });
});

describe("computeStatusChangeEffects — dossiers entamés", () => {
  it("refuse la fiche déjà appelée d'un autre closer", () => {
    const { conflictError } = computeStatusChangeEffects({
      updates: { status: "rdv" },
      existing: prospect({
        status: "a_rappeler",
        assignedTo: user(PAUL, "Paul"),
      }),
      userId: MOH,
      userRole: "closer",
    });

    expect(conflictError?.message).toBe("Ce prospect est déjà pris par Paul");
  });

  it("laisse le closer avancer son propre dossier sans le réattribuer", () => {
    const { updates, conflictError } = computeStatusChangeEffects({
      updates: { status: "lien_envoye" },
      existing: prospect({ status: "rdv", assignedTo: user(MOH, "Moh") }),
      userId: MOH,
      userRole: "closer",
    });

    expect(conflictError).toBeUndefined();
    expect(updates.assignedTo).toBeUndefined();
  });

  it("laisse passer celui qui tient le verrou", () => {
    const { conflictError } = computeStatusChangeEffects({
      updates: { status: "rdv" },
      existing: prospect({
        status: "en_appel",
        assignedTo: user(PAUL, "Paul"),
        lockedBy: user(MOH, "Moh"),
      }),
      userId: MOH,
      userRole: "closer",
    });

    expect(conflictError).toBeUndefined();
  });

  it("libère le verrou en passant « à rappeler »", () => {
    const { updates } = computeStatusChangeEffects({
      updates: { status: "a_rappeler" },
      existing: prospect({
        status: "en_appel",
        assignedTo: user(MOH, "Moh"),
        lockedBy: user(MOH, "Moh"),
      }),
      userId: MOH,
      userRole: "closer",
    });

    expect(updates.lockedBy).toBeNull();
    expect(updates.lockedAt).toBeNull();
  });
});

describe("computeStatusChangeEffects — admin", () => {
  it("prend une fiche libre", () => {
    const { updates } = computeStatusChangeEffects({
      updates: { status: "en_appel" },
      existing: prospect(),
      userId: PAUL,
      userRole: "admin",
    });

    expect(updates.assignedTo).toBe(PAUL);
  });

  it("ne dépossède pas le closer d'une fiche non entamée", () => {
    // Un admin qui teste un appel ne doit pas retirer la fiche à son closer —
    // a fortiori pendant une substitution d'identité.
    const { updates, conflictError } = computeStatusChangeEffects({
      updates: { status: "en_appel" },
      existing: prospect({ assignedTo: user(MOH, "Moh") }),
      userId: PAUL,
      userRole: "admin",
    });

    expect(conflictError).toBeUndefined();
    expect(updates.assignedTo).toBeUndefined();
  });

  it("passe outre le dossier entamé d'un closer sans conflit", () => {
    const { conflictError } = computeStatusChangeEffects({
      updates: { status: "rdv" },
      existing: prospect({ status: "a_rappeler", assignedTo: user(MOH, "Moh") }),
      userId: PAUL,
      userRole: "admin",
    });

    expect(conflictError).toBeUndefined();
  });
});

describe("computeStatusChangeEffects — dev", () => {
  it("ne prend jamais la fiche", () => {
    const { updates } = computeStatusChangeEffects({
      updates: { deliveryStage: "en_cours" },
      existing: prospect(),
      userId: PAUL,
      userRole: "dev",
    });

    expect(updates.assignedTo).toBeUndefined();
  });
});
