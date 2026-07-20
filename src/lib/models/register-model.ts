import mongoose, { type Schema } from "mongoose";

/**
 * Enregistre un modèle Mongoose en reprenant le schéma courant hors production.
 *
 * Next.js recharge les modules à chaud, mais Mongoose conserve le modèle déjà
 * compilé au premier import. Sans ce désenregistrement, une modification de
 * schéma en cours de session serait ignorée : le modèle périmé resterait en
 * place et supprimerait les champs nouveaux à l'écriture, en mode strict et
 * **sans lever d'erreur**. C'est exactement ce qui a fait perdre `cityKey` sur
 * 240 prospects importés après l'ajout du champ.
 *
 * En production le processus démarre à froid : il n'y a rien à désenregistrer,
 * et la garde ne s'applique pas.
 */
export function registerModel(name: string, schema: Schema) {
  if (process.env.NODE_ENV !== "production" && mongoose.models[name]) {
    mongoose.deleteModel(name);
  }

  return mongoose.models[name] ?? mongoose.model(name, schema);
}
