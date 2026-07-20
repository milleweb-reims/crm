import { NextResponse } from "next/server";

import { forbidden, getAuthSession, unauthorized } from "@/lib/api-auth";
import { connectDB } from "@/lib/db";
import { Prospect } from "@/lib/models/prospect.model";
import { Territory } from "@/lib/models/territory.model";

interface CityRow {
  readonly _id: string;
  readonly city: string;
  readonly prospectCount: number;
  readonly unassignedCount: number;
}

/**
 * Liste les villes réellement présentes dans les prospects, pour que l'admin
 * choisisse un territoire dans ses données plutôt qu'en saisissant un nom au
 * jugé — une faute de frappe créerait un territoire rattaché à aucun prospect.
 */
export async function GET() {
  const session = await getAuthSession();
  if (!session) return unauthorized();
  if (session.user.role !== "admin") return forbidden();

  await connectDB();

  const rows = await Prospect.aggregate<CityRow>([
    // Un prospect sans clé de ville ne peut être rattaché à aucun territoire.
    { $match: { "address.cityKey": { $nin: ["", null] } } },
    // Premier regroupement par (clé, graphie) : plusieurs orthographes d'une
    // même ville coexistent dans un scrap Google Maps (« Reims », « REIMS »).
    {
      $group: {
        _id: { key: "$address.cityKey", label: "$address.city" },
        n: { $sum: 1 },
        unassigned: {
          $sum: { $cond: [{ $eq: ["$assignedTo", null] }, 1, 0] },
        },
      },
    },
    // Trier avant de refusionner fait remonter la graphie la plus fréquente,
    // qui sera celle affichée.
    { $sort: { n: -1 } },
    {
      $group: {
        _id: "$_id.key",
        city: { $first: "$_id.label" },
        prospectCount: { $sum: "$n" },
        unassignedCount: { $sum: "$unassigned" },
      },
    },
    { $sort: { prospectCount: -1 } },
  ]);

  const territories = await Territory.find({}, { cityKey: 1 }).lean();
  const covered = new Set(territories.map((territory) => territory.cityKey));

  return NextResponse.json({
    cities: rows.map((row) => ({
      cityKey: row._id,
      city: row.city,
      prospectCount: row.prospectCount,
      unassignedCount: row.unassignedCount,
      hasTerritory: covered.has(row._id),
    })),
  });
}
