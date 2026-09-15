import mongoose, { Schema, type InferSchemaType } from "mongoose";

import { registerModel } from "./register-model";

const userSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ["admin", "closer", "dev"],
      default: "closer",
      required: true,
    },
    avatar: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
    // Abonnement mensuel pratiqué par ce compte, en euros HT. Posé sur tous les
    // comptes et pas seulement les closers : un admin peut aussi détenir une
    // fiche, et la résolution n'a ainsi aucun cas particulier à traiter. Le prix
    // de création, lui, se fixe sur chaque fiche.
    subscriptionAmount: { type: Number, default: 29 },
  },
  { timestamps: true }
);

export type UserDocument = InferSchemaType<typeof userSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const User =
  registerModel("User", userSchema);
