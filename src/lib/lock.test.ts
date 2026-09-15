import { describe, expect, it } from "vitest";

import { getBindingReservationHolder } from "./lock";

const MARIE = { _id: "6a5dc8ae6466fb9a3bcc088d", name: "Marie Montel" };
const THOMAS_ID = "6a54d8b3b4715d6e7743f8ad";

describe("getBindingReservationHolder", () => {
  it("ne signale rien tant que la fiche est encore au statut Prospect", () => {
    expect(
      getBindingReservationHolder(
        { status: "prospect", assignedTo: MARIE },
        THOMAS_ID
      )
    ).toBeNull();
  });

  it("signale le closer d'un dossier entamé", () => {
    expect(
      getBindingReservationHolder(
        { status: "a_rappeler", assignedTo: MARIE },
        THOMAS_ID
      )
    ).toEqual(MARIE);
  });

  it("ne signale pas sa propre attribution", () => {
    expect(
      getBindingReservationHolder(
        { status: "rdv_demo", assignedTo: MARIE },
        MARIE._id
      )
    ).toBeNull();
  });

  it("ne signale rien sans attribution", () => {
    expect(
      getBindingReservationHolder({ status: "rdv_demo", assignedTo: null }, THOMAS_ID)
    ).toBeNull();
  });
});
