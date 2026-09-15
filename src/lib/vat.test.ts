import { describe, expect, it } from "vitest";

import { htFromTtc, ttcFromHt } from "./vat";

// QONTO_VAT_RATE n'est pas posé sous vitest : taux par défaut de 20 %.
describe("htFromTtc", () => {
  it("retrouve le HT d'un montant TTC", () => {
    expect(htFromTtc(1200)).toBe(1000);
    expect(htFromTtc(2400)).toBe(2000);
  });

  it("arrondit au centime", () => {
    expect(htFromTtc(1000)).toBe(833.33);
  });

  it("inverse ttcFromHt", () => {
    expect(htFromTtc(ttcFromHt(1499.5))).toBe(1499.5);
  });
});
