import { describe, expect, it } from "vitest";

import { distribute } from "./territory-balance";

describe("distribute", () => {
  it("alterne quand les charges sont égales", () => {
    const result = distribute({
      loads: [
        { closerId: "a", load: 0 },
        { closerId: "b", load: 0 },
      ],
      count: 4,
    });
    expect(result).toEqual(["a", "b", "a", "b"]);
  });

  it("comble le retard avant d'alterner", () => {
    // a est déjà à 5, b à 2 : b encaisse trois prospects pour rattraper,
    // puis l'égalité est départagée par identifiant croissant.
    const result = distribute({
      loads: [
        { closerId: "a", load: 5 },
        { closerId: "b", load: 2 },
      ],
      count: 4,
    });
    expect(result).toEqual(["b", "b", "b", "a"]);
  });

  it("donne tout au closer unique", () => {
    const result = distribute({
      loads: [{ closerId: "a", load: 12 }],
      count: 3,
    });
    expect(result).toEqual(["a", "a", "a"]);
  });

  it("sert deux fois le même closer quand il est nettement en retard", () => {
    // b est à 1, c à 2 : b encaisse le premier, ce qui l'amène à égalité avec c,
    // puis l'identifiant croissant lui donne aussi le second. c reste à 2 et
    // deviendra le moins chargé pour le lot suivant.
    const result = distribute({
      loads: [
        { closerId: "a", load: 3 },
        { closerId: "b", load: 1 },
        { closerId: "c", load: 2 },
      ],
      count: 2,
    });
    expect(result).toEqual(["b", "b"]);
  });

  it("sert des closers distincts quand le lot est plus petit que l'équipe", () => {
    const result = distribute({
      loads: [
        { closerId: "a", load: 5 },
        { closerId: "b", load: 0 },
        { closerId: "c", load: 0 },
      ],
      count: 2,
    });
    expect(result).toEqual(["b", "c"]);
  });

  it("retourne un tableau vide sans closer", () => {
    expect(distribute({ loads: [], count: 5 })).toEqual([]);
  });

  it("retourne un tableau vide pour un lot nul", () => {
    expect(distribute({ loads: [{ closerId: "a", load: 0 }], count: 0 })).toEqual([]);
  });

  it("retourne un tableau vide pour un lot négatif", () => {
    expect(distribute({ loads: [{ closerId: "a", load: 0 }], count: -3 })).toEqual([]);
  });

  it("est déterministe", () => {
    const loads = [
      { closerId: "b", load: 4 },
      { closerId: "a", load: 4 },
      { closerId: "c", load: 1 },
    ];
    const first = distribute({ loads, count: 6 });
    const second = distribute({ loads, count: 6 });
    expect(first).toEqual(second);
  });

  it("ne mute pas les charges reçues", () => {
    const loads = [
      { closerId: "a", load: 0 },
      { closerId: "b", load: 0 },
    ];
    distribute({ loads, count: 4 });
    expect(loads).toEqual([
      { closerId: "a", load: 0 },
      { closerId: "b", load: 0 },
    ]);
  });
});
