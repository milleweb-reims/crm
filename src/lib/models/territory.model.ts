import mongoose, { Schema } from "mongoose";

import { registerModel } from "./register-model";

// Un territoire attribue une ville à un ou plusieurs closers. L'index unique
// sur cityKey garantit qu'une ville n'a qu'un seul territoire, donc qu'aucune
// ambiguïté de rattachement n'est possible à l'import.
const territorySchema = new Schema(
  {
    // Forme affichée, telle que saisie par l'admin : « Reims ».
    city: { type: String, required: true },
    // normalizeCity(city) — clé de rattachement, minuscules et sans accents.
    cityKey: { type: String, required: true, unique: true },
    closers: [{ type: Schema.Types.ObjectId, ref: "User" }],
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export const Territory =
  registerModel("Territory", territorySchema);
