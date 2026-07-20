import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Prospect } from "@/lib/models/prospect.model";
import { Activity } from "@/lib/models/activity.model";
import { getAuthSession, unauthorized } from "@/lib/api-auth";
import { emitCrmEvent } from "@/lib/events";
import { withCityKey } from "@/lib/city";
import { resolveAssignmentsByCity } from "@/lib/territory-service";

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
 * Applies withCityKey server-side to guarantee address.cityKey is always derived,
 * ensuring the territory-scoping invariant holds regardless of client version.
 */
async function createProspectWithBatch(
  data: ProspectImportData,
  batchId: string
): Promise<void> {
  const prospectData = withCityKey({
    ...data,
    importBatch: batchId,
  });
  await Prospect.create(prospectData);
}

/**
 * Extrait la clé de ville d'un prospect importé, ou null si absente.
 */
function cityKeyOf(data: ProspectImportData): string | null {
  const key = (data.address as Record<string, unknown> | undefined)?.cityKey;
  return typeof key === "string" && key !== "" ? key : null;
}

/**
 * Processes a batch of prospect records, detecting duplicates and tracking import metrics.
 * Sequential awaits preserve database query ordering.
 *
 * Les prospects dont la ville est couverte par un territoire reçoivent un
 * closer. La répartition est calculée en amont de la boucle, à partir d'une
 * seule mesure de charge pour tout le lot.
 */
async function processProspectImportBatch(
  prospectData: ReadonlyArray<ProspectImportData>,
  batchId: string
): Promise<{
  readonly imported: number;
  readonly duplicates: number;
  readonly errors: number;
  readonly autoAssigned: number;
}> {
  let imported = 0;
  let duplicates = 0;
  let errors = 0;
  let autoAssigned = 0;

  const assignmentsByCity = await resolveAssignmentsByCity(
    prospectData.map(cityKeyOf).filter((key) => key !== null)
  );

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

      const cityKey = cityKeyOf(data);
      const queue = cityKey ? assignmentsByCity.get(cityKey) : undefined;
      const assignedTo = queue?.shift() ?? null;

      await createProspectWithBatch({ ...data, assignedTo }, batchId);
      imported++;
      if (assignedTo) autoAssigned++;
    } catch {
      errors++;
    }
  }

  return { imported, duplicates, errors, autoAssigned };
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
  readonly autoAssigned: number;
}): Promise<void> {
  const firstProspect = await Prospect.findOne({ importBatch: opts.batchId });
  if (firstProspect) {
    const assignmentNote =
      opts.autoAssigned > 0
        ? `, dont ${opts.autoAssigned} attribués par territoire`
        : "";

    await Activity.create({
      prospectId: firstProspect._id,
      userId: opts.userId,
      type: "import",
      content: `Import de ${opts.imported} prospects${assignmentNote} (lot: ${opts.batchId})`,
      metadata: {
        batchId: opts.batchId,
        imported: opts.imported,
        duplicates: opts.duplicates,
        errors: opts.errors,
        autoAssigned: opts.autoAssigned,
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
  const { imported, duplicates, errors, autoAssigned } =
    await processProspectImportBatch(prospectData, batchId);

  if (imported > 0) {
    await createImportActivityRecord({
      userId: session.user.id,
      batchId,
      imported,
      duplicates,
      errors,
      autoAssigned,
    });
    emitCrmEvent({ type: "prospect:imported", userId: session.user.id, timestamp: Date.now() });
  }

  return NextResponse.json({
    imported,
    duplicates,
    errors,
    autoAssigned,
    batchId,
  });
}
