import { NextRequest, NextResponse } from "next/server";

import { forbidden, getAuthSession, unauthorized } from "@/lib/api-auth";
import { normalizeCity } from "@/lib/city";
import { connectDB } from "@/lib/db";
import { Prospect } from "@/lib/models/prospect.model";
import { Territory } from "@/lib/models/territory.model";
import { applyTerritory, validateClosers } from "@/lib/territory-service";

export async function GET() {
  const session = await getAuthSession();
  if (!session) return unauthorized();
  if (session.user.role !== "admin") return forbidden();

  await connectDB();

  const territories = await Territory.find()
    .sort({ city: 1 })
    .populate("closers", "name email")
    .lean();

  // Deux agrégations au total, quel que soit le nombre de territoires.
  const keys = territories.map((territory) => territory.cityKey);

  const [totals, unassigned] = await Promise.all([
    Prospect.aggregate<{ _id: string; n: number }>([
      { $match: { "address.cityKey": { $in: keys } } },
      { $group: { _id: "$address.cityKey", n: { $sum: 1 } } },
    ]),
    Prospect.aggregate<{ _id: string; n: number }>([
      { $match: { "address.cityKey": { $in: keys }, assignedTo: null } },
      { $group: { _id: "$address.cityKey", n: { $sum: 1 } } },
    ]),
  ]);

  const totalByCity = new Map(totals.map((row) => [row._id, row.n]));
  const unassignedByCity = new Map(unassigned.map((row) => [row._id, row.n]));

  return NextResponse.json({
    territories: territories.map((territory) => ({
      ...territory,
      prospectCount: totalByCity.get(territory.cityKey) ?? 0,
      unassignedCount: unassignedByCity.get(territory.cityKey) ?? 0,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();
  if (session.user.role !== "admin") return forbidden();

  await connectDB();

  const body = await req.json();
  const city = typeof body.city === "string" ? body.city.trim() : "";

  if (city === "") {
    return NextResponse.json({ error: "Ville requise" }, { status: 400 });
  }

  const closers = await validateClosers(body.closers ?? []);
  if (closers === null) {
    return NextResponse.json(
      { error: "Closer inexistant, inactif ou de rôle incorrect" },
      { status: 400 }
    );
  }

  const cityKey = normalizeCity(city);

  const existing = await Territory.findOne({ cityKey }).lean();
  if (existing) {
    return NextResponse.json(
      { error: "Un territoire existe déjà pour cette ville" },
      { status: 409 }
    );
  }

  const territory = await Territory.create({
    city,
    cityKey,
    closers,
    createdBy: session.user.id,
  });

  const { assigned, perCloser } = await applyTerritory(
    territory._id.toString(),
    session.user.id
  );

  return NextResponse.json({ territory, assigned, perCloser }, { status: 201 });
}
