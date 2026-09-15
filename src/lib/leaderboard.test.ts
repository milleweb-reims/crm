import { describe, expect, it } from "vitest";

import { hasSales } from "./leaderboard";

type Entry = { sales: number; rdv?: number };

describe("hasSales", () => {
  it("est faux sans aucune entrée", () => {
    expect(hasSales([])).toBe(false);
  });

  it("est faux quand les closers n'ont que des RDV", () => {
    const entries: Entry[] = [{ sales: 0, rdv: 3 }, { sales: 0, rdv: 1 }];
    expect(hasSales(entries)).toBe(false);
  });

  it("est vrai dès qu'un closer a une vente", () => {
    const entries: Entry[] = [{ sales: 0, rdv: 3 }, { sales: 1 }];
    expect(hasSales(entries)).toBe(true);
  });
});
