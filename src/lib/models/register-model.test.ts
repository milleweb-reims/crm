import mongoose, { Schema } from "mongoose";
import { afterEach, describe, expect, it } from "vitest";

import { registerModel } from "./register-model";

const NAME = "GuardTestModel";

afterEach(() => {
  if (mongoose.models[NAME]) mongoose.deleteModel(NAME);
});

describe("registerModel", () => {
  it("reprend le schéma courant quand un champ est ajouté en cours de session", () => {
    // Premier import : le schéma ignore encore `cityKey`.
    registerModel(NAME, new Schema({ city: String }));

    // Rechargement à chaud après ajout du champ au schéma.
    const reloaded = registerModel(
      NAME,
      new Schema({ city: String, cityKey: String })
    );

    // Sans désenregistrement, Mongoose renverrait le modèle périmé et
    // supprimerait `cityKey` à l'écriture, silencieusement.
    expect(reloaded.schema.path("cityKey")).toBeDefined();
  });

  it("conserve la valeur du champ ajouté sur un document construit", () => {
    registerModel(NAME, new Schema({ city: String }));

    const Reloaded = registerModel(
      NAME,
      new Schema({ city: String, cityKey: String })
    );

    const doc = new Reloaded({ city: "Reims", cityKey: "reims" });

    expect(doc.get("cityKey")).toBe("reims");
  });

  it("retourne un modèle utilisable au premier enregistrement", () => {
    const model = registerModel(NAME, new Schema({ city: String }));

    expect(model.modelName).toBe(NAME);
  });
});
