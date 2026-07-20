// Rattrapage ponctuel : renseigne address.cityKey sur les prospects créés
// avant l'introduction du champ. Idempotent — relançable sans risque.

import mongoose from "mongoose";

import { normalizeCity } from "./city";
import { Prospect } from "./models/prospect.model";

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/crm-milleweb";

async function backfill() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connecté à MongoDB");

  const prospects = await Prospect.find({}, { "address.city": 1, "address.cityKey": 1 }).lean();

  const operations = prospects
    .map((prospect) => {
      const city = prospect.address?.city;
      if (typeof city !== "string" || city.trim() === "") return null;

      const expected = normalizeCity(city);
      if (prospect.address?.cityKey === expected) return null;

      return {
        updateOne: {
          filter: { _id: prospect._id },
          update: { $set: { "address.cityKey": expected } },
        },
      };
    })
    .filter((operation) => operation !== null);

  if (operations.length === 0) {
    console.log(`${prospects.length} prospects examinés, aucun à corriger`);
    await mongoose.disconnect();
    return;
  }

  const { modifiedCount } = await Prospect.bulkWrite(operations);
  console.log(`${prospects.length} prospects examinés, ${modifiedCount} mis à jour`);

  await mongoose.disconnect();
}

backfill().catch((error) => {
  console.error("Échec du rattrapage", error);
  process.exit(1);
});
