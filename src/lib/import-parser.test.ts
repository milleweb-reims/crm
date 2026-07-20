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
