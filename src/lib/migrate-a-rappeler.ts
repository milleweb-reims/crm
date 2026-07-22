// Migration ponctuelle : les fiches garées en « En appel » (ancien sens :
// « appel passé ou rappel prévu ») deviennent « À rappeler », et leurs verrous
// fantômes (en_appel verrouille sans expiration) sont purgés. « En appel »
// reprend son sens strict : le closer est au téléphone, là, maintenant.
// Idempotent — relançable sans risque : ne touche que les fiches encore en_appel.

import mongoose from "mongoose";

import { Activity } from "./models/activity.model";
import { Prospect } from "./models/prospect.model";

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/crm-milleweb";

async function migrate() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connecté à MongoDB");

  const prospects = await Prospect.find({ status: "en_appel" }, { _id: 1 }).lean();

  if (prospects.length === 0) {
    console.log("Aucune fiche en « En appel » — rien à migrer");
    await mongoose.disconnect();
    return;
  }

  // Mise à jour fiche par fiche, re-filtrée sur le statut : une fiche qui a
  // bougé entre le find et l'update n'est ni migrée, ni journalisée.
  const migratedIds = [];
  for (const { _id } of prospects) {
    const { modifiedCount } = await Prospect.updateOne(
      { _id, status: "en_appel" },
      { status: "a_rappeler", lockedBy: null, lockedAt: null }
    );
    if (modifiedCount === 1) migratedIds.push(_id);
  }

  if (migratedIds.length === 0) {
    console.log("Aucune fiche encore en « En appel » — rien à migrer");
    await mongoose.disconnect();
    return;
  }

  // userId null → l'historique s'affiche comme « Système » (même convention
  // que la suppression de compte).
  await Activity.insertMany(
    migratedIds.map((prospectId) => ({
      prospectId,
      userId: null,
      type: "status_change",
      content: 'Statut changé de "en_appel" à "a_rappeler"',
      metadata: { from: "en_appel", to: "a_rappeler", migration: "a-rappeler" },
    }))
  );

  console.log(`${migratedIds.length} fiches migrées en « À rappeler », verrous purgés`);

  await mongoose.disconnect();
}

migrate().catch((error) => {
  console.error("Échec de la migration", error);
  process.exit(1);
});
