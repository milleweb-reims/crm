import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Prospect } from "@/lib/models/prospect.model";
import { Activity } from "@/lib/models/activity.model";
import { getAuthSession, unauthorized } from "@/lib/api-auth";
import { emitCrmEvent } from "@/lib/events";

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  await connectDB();

  const { prospects: prospectData } = await req.json();

  if (!Array.isArray(prospectData) || prospectData.length === 0) {
    return NextResponse.json(
      { error: "Aucune donnée à importer" },
      { status: 400 }
    );
  }

  const batchId = `import_${Date.now()}`;
  let imported = 0;
  let duplicates = 0;
  let errors = 0;

  for (const data of prospectData) {
    try {
      // Check for duplicate by name + city
      const existing = await Prospect.findOne({
        name: data.name,
        "address.city": data.address?.city || "",
      });

      if (existing) {
        duplicates++;
        continue;
      }

      await Prospect.create({
        ...data,
        importBatch: batchId,
      });

      imported++;
    } catch {
      errors++;
    }
  }

  // Log import activity
  if (imported > 0) {
    // Create a system-level activity for tracking
    const firstProspect = await Prospect.findOne({ importBatch: batchId });
    if (firstProspect) {
      await Activity.create({
        prospectId: firstProspect._id,
        userId: session.user.id,
        type: "import",
        content: `Import de ${imported} prospects (lot: ${batchId})`,
        metadata: { batchId, imported, duplicates, errors },
      });
    }
  }

  if (imported > 0) {
    emitCrmEvent({ type: "prospect:imported", userId: session.user.id, timestamp: Date.now() });
  }

  return NextResponse.json({
    imported,
    duplicates,
    errors,
    batchId,
  });
}
