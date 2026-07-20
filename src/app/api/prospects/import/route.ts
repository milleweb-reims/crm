import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Prospect } from "@/lib/models/prospect.model";
import { Activity } from "@/lib/models/activity.model";
import { getAuthSession, unauthorized } from "@/lib/api-auth";
import { emitCrmEvent } from "@/lib/events";

interface ProspectImportData extends Readonly<Record<string, unknown>> {
  readonly name?: unknown;
  readonly address?: Readonly<{ city?: unknown }>;
}

/**
 * Checks if a prospect with the given name and city already exists.
 */
async function findDuplicateByNameAndCity(
  name: string,
  city: string
): Promise<boolean> {
  const existing = await Prospect.findOne({
    name,
    "address.city": city || "",
  });
  return !!existing;
}

/**
 * Creates a new prospect record with the import batch identifier.
 */
async function createProspectWithBatch(
  data: ProspectImportData,
  batchId: string
): Promise<void> {
  await Prospect.create({
    ...data,
    importBatch: batchId,
  });
}

/**
 * Processes a batch of prospect records, detecting duplicates and tracking import metrics.
 * Sequential awaits preserve database query ordering.
 */
async function processProspectImportBatch(
  prospectData: ReadonlyArray<ProspectImportData>,
  batchId: string
): Promise<{ readonly imported: number; readonly duplicates: number; readonly errors: number }> {
  let imported = 0;
  let duplicates = 0;
  let errors = 0;

  for (const data of prospectData) {
    try {
      const isDuplicate = await findDuplicateByNameAndCity(
        String(data.name),
        String(data.address?.city || "")
      );

      if (isDuplicate) {
        duplicates++;
        continue;
      }

      await createProspectWithBatch(data, batchId);
      imported++;
    } catch {
      errors++;
    }
  }

  return { imported, duplicates, errors };
}

/**
 * Creates an activity record documenting the import batch.
 */
async function createImportActivityRecord(opts: {
  readonly userId: string;
  readonly batchId: string;
  readonly imported: number;
  readonly duplicates: number;
  readonly errors: number;
}): Promise<void> {
  const firstProspect = await Prospect.findOne({ importBatch: opts.batchId });
  if (firstProspect) {
    await Activity.create({
      prospectId: firstProspect._id,
      userId: opts.userId,
      type: "import",
      content: `Import de ${opts.imported} prospects (lot: ${opts.batchId})`,
      metadata: {
        batchId: opts.batchId,
        imported: opts.imported,
        duplicates: opts.duplicates,
        errors: opts.errors,
      },
    });
  }
}

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
  const { imported, duplicates, errors } = await processProspectImportBatch(
    prospectData,
    batchId
  );

  if (imported > 0) {
    await createImportActivityRecord({
      userId: session.user.id,
      batchId,
      imported,
      duplicates,
      errors,
    });
    emitCrmEvent({ type: "prospect:imported", userId: session.user.id, timestamp: Date.now() });
  }

  return NextResponse.json({
    imported,
    duplicates,
    errors,
    batchId,
  });
}
