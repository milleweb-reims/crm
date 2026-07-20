import { describe, expect, it } from "vitest";

import { normalizeCity, withCityKey } from "./city";

describe("normalizeCity", () => {
  it("met en minuscules", () => {
    expect(normalizeCity("REIMS")).toBe("reims");
  });

  it("supprime les accents", () => {
    expect(normalizeCity("Épernay")).toBe("epernay");
  });

  it("fait converger les graphies accentuée et non accentuée", () => {
    expect(normalizeCity("Épernay")).toBe(normalizeCity("Epernay"));
  });

  it("rogne les espaces de bord", () => {
    expect(normalizeCity("  Reims  ")).toBe("reims");
  });

  it("normalise les espaces internes", () => {
    expect(normalizeCity("Vitry   le   François")).toBe("vitry le francois");
  });

  it("conserve les traits d'union", () => {
    expect(normalizeCity("Saint-Étienne")).toBe("saint-etienne");
  });

  it("accepte la chaîne vide", () => {
    expect(normalizeCity("")).toBe("");
  });
});

describe("withCityKey", () => {
  it("dérive la clé depuis address.city", () => {
    const result = withCityKey({ name: "X", address: { city: "Épernay" } });
    expect((result.address as Record<string, unknown>).cityKey).toBe("epernay");
  });

  it("conserve les autres champs de l'adresse", () => {
    const result = withCityKey({
      address: { city: "Reims", postalCode: "51100" },
    });
    expect(result.address).toEqual({
      city: "Reims",
      postalCode: "51100",
      cityKey: "reims",
    });
  });

  it("ne mute pas l'objet d'origine", () => {
    const original = { address: { city: "Reims" } };
    withCityKey(original);
    expect(original.address).toEqual({ city: "Reims" });
  });

  it("laisse le prospect intact sans adresse", () => {
    const input = { name: "X" };
    expect(withCityKey(input)).toEqual({ name: "X" });
  });

  it("laisse le prospect intact quand la ville est vide", () => {
    const input = { address: { city: "   " } };
    expect(withCityKey(input)).toEqual({ address: { city: "   " } });
  });
});
