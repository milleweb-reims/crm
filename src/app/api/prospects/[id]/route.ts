import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Prospect } from "@/lib/models/prospect.model";
import { Activity } from "@/lib/models/activity.model";
import { User } from "@/lib/models/user.model";
import { getAuthSession, unauthorized } from "@/lib/api-auth";
import { emitCrmEvent } from "@/lib/events";
import { isLockActive } from "@/lib/lock";
import { sendEmail } from "@/lib/mailer";
import { normalizeCity } from "@/lib/city";
import { computeStatusChangeEffects } from "@/lib/prospect-status";
import type { UserRole } from "@/types";

interface RdvProspect {
  readonly _id: { toString(): string };
  readonly name: string;
  readonly rdvDate?: Date | string | null;
  readonly address?: { readonly city?: string };
  readonly website?: string;
}

interface ProspectDoc {
  readonly _id: { toString(): string };
  readonly status: string;
  readonly lockedBy?: { readonly _id: { toString(): string }; readonly name: string } | null;
  readonly lockedAt?: Date | null;
  readonly assignedTo?: { readonly _id: { toString(): string }; readonly name?: string } | null;
  readonly quoteAmount?: number | null;
  readonly subscriptionAmount?: number | null;
  readonly [key: string]: unknown;
}

interface AuthSession {
  readonly user: {
    readonly id: string;
    readonly role: UserRole;
  };
}

/**
 * Filters update body to only dev-allowed fields (site delivery tracking).
 * Devs cannot modify sales statuses or other fields.
 */
function pickDevAllowedFields(
  body: Record<string, unknown>
): Record<string, unknown> {
  const devAllowedFields = new Set(["devUrl", "deliveryStage", "deliveredDate"]);
  return Object.fromEntries(
    Object.entries(body).filter(([key]) => devAllowedFields.has(key))
  );
}

/**
 * Validates dev role restrictions: devs cannot change sales status or other fields.
 * Returns error response if validation fails, null if valid.
 */
function validateDevRoleRestrictions(
  body: Record<string, unknown>,
  existing: ProspectDoc
): NextResponse | null {
  if (body.status && body.status !== existing.status) {
    return NextResponse.json(
      { error: "Un dev ne peut pas modifier le statut d'un prospect" },
      { status: 403 }
    );
  }
  return null;
}

/**
 * Validates prospect lock status. Returns error response if locked by another user,
 * null if user can proceed. Lock applies to closers/non-admin; devs are exempt.
 */
function validateProspectNotLocked(
  existing: ProspectDoc,
  session: AuthSession
): NextResponse | null {
  if (
    existing.lockedBy &&
    existing.lockedBy._id.toString() !== session.user.id &&
    (isLockActive(existing.lockedAt) || existing.status === "en_appel") &&
    session.user.role !== "admin" &&
    session.user.role !== "dev"
  ) {
    return NextResponse.json(
      {
        error: `Fiche en cours de traitement par ${existing.lockedBy.name || "un autre utilisateur"}`,
        lockedBy: existing.lockedBy,
      },
      { status: 423 }
    );
  }
  return null;
}

/**
 * Pure: Determines what updates and activity to record for an assignedTo change.
 * Takes already-validated data.
 */
function computeAssignedToUpdate(options: {
  readonly body: Record<string, unknown>;
  readonly existing: ProspectDoc;
  readonly requestedAssigneeId: string | null;
  readonly assigneeName: string | null;
}): {
  readonly updates: Record<string, unknown>;
  readonly activityToRecord?: {
    readonly content: string;
    readonly metadata: Record<string, unknown>;
  };
} {
  const { body, existing, requestedAssigneeId, assigneeName } = options;
  const current = existing.assignedTo?._id?.toString() ?? null;

  if (requestedAssigneeId === current) {
    return {
      updates: Object.fromEntries(
        Object.entries(body).filter(([key]) => key !== "assignedTo")
      ),
    };
  }

  return {
    updates: { ...body, assignedTo: requestedAssigneeId },
    activityToRecord: {
      content: assigneeName
        ? `Prospect attribué à ${assigneeName}`
        : "Attribution retirée",
      metadata: { assignedTo: requestedAssigneeId },
    },
  };
}

/**
 * Processes assignedTo field changes. Admin-only for manual assignment changes.
 * Records activity log when assignment changes. Returns updated body and optional error.
 */
async function processAssignedToField(options: {
  readonly body: Record<string, unknown>;
  readonly existing: ProspectDoc;
  readonly session: AuthSession;
  readonly prospectId: string;
}): Promise<{ readonly updates: Record<string, unknown>; readonly errorResponse?: NextResponse }> {
  const { body, existing, session, prospectId } = options;

  if (!("assignedTo" in body)) {
    return { updates: body };
  }

  if (session.user.role !== "admin") {
    return {
      updates: body,
      errorResponse: NextResponse.json({ error: "Accès refusé" }, { status: 403 }),
    };
  }

  const requested = body.assignedTo || null;
  let assigneeName: string | null = null;

  if (requested) {
    const assignee = await User.findById(requested).select("name isActive");
    if (!assignee || !assignee.isActive) {
      return {
        updates: body,
        errorResponse: NextResponse.json(
          { error: "Utilisateur introuvable ou désactivé" },
          { status: 400 }
        ),
      };
    }
    assigneeName = assignee.name;
  }

  const { updates, activityToRecord } = computeAssignedToUpdate({
    body,
    existing,
    requestedAssigneeId: typeof requested === "string" ? requested : null,
    assigneeName,
  });

  if (activityToRecord) {
    await Activity.create({
      prospectId,
      userId: session.user.id,
      type: "note",
      ...activityToRecord,
    });
  }

  return { updates };
}

/**
 * Validates admin-only amount field changes (devis, abonnement).
 * Removes field from updates if no change or user lacks permission.
 */
function processAdminAmountField(options: {
  readonly body: Record<string, unknown>;
  readonly existing: ProspectDoc;
  readonly session: AuthSession;
  readonly field: "quoteAmount" | "subscriptionAmount";
  readonly errorMessage: string;
}): { readonly updates: Record<string, unknown>; readonly errorResponse?: NextResponse } {
  const { body, existing, session, field, errorMessage } = options;

  if (!(field in body)) {
    return { updates: body };
  }

  const requested = body[field] ?? null;
  const current = existing[field] ?? null;

  if (requested === current) {
    return {
      updates: Object.fromEntries(
        Object.entries(body).filter(([key]) => key !== field)
      ),
    };
  }

  // null = montant non défini ; sinon, exiger un nombre strictement positif
  // (un abonnement à 0 € ou négatif casserait le contrat côté GoCardless)
  if (
    requested !== null &&
    (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0)
  ) {
    return {
      updates: body,
      errorResponse: NextResponse.json(
        { error: "Montant invalide : nombre strictement positif attendu" },
        { status: 400 }
      ),
    };
  }

  if (session.user.role !== "admin") {
    return {
      updates: body,
      errorResponse: NextResponse.json(
        { error: errorMessage },
        { status: 403 }
      ),
    };
  }

  return { updates: body };
}

/**
 * Validates status transition rules. Prevents setting "payé" manually
 * (GoCardless webhook sets it) and blocks status changes on paid prospects
 * except by admins.
 */
function validateStatusTransition(options: {
  readonly updates: Record<string, unknown>;
  readonly existing: ProspectDoc;
  readonly session: AuthSession;
}): NextResponse | null {
  const { updates, existing, session } = options;

  if (!updates.status || updates.status === existing.status) {
    return null;
  }

  if (updates.status === "paye") {
    return NextResponse.json(
      { error: "Le statut « Payé » est posé automatiquement à la réception du paiement" },
      { status: 403 }
    );
  }

  if (existing.status === "paye" && session.user.role !== "admin") {
    return NextResponse.json(
      { error: "Fiche payée : le statut ne peut plus être modifié" },
      { status: 403 }
    );
  }

  return null;
}

/**
 * Applies status change side effects: auto-assignment to closer, lock on "en_appel",
 * activity logging, and conflict detection. Returns updated body with status effects.
 */
async function applyStatusChangeEffects(options: {
  readonly updates: Record<string, unknown>;
  readonly existing: ProspectDoc;
  readonly session: AuthSession;
  readonly prospectId: string;
}): Promise<{ readonly updates: Record<string, unknown>; readonly errorResponse?: NextResponse }> {
  const { updates, existing, session, prospectId } = options;

  if (!updates.status || updates.status === existing.status) {
    return { updates };
  }

  const { updates: effectsUpdate, conflictError, activityToRecord } = computeStatusChangeEffects({
    updates,
    existing,
    userId: session.user.id,
    userRole: session.user.role,
  });

  if (conflictError) {
    return {
      updates: effectsUpdate,
      errorResponse: NextResponse.json(
        {
          error: conflictError.message,
          assignedTo: {
            name: conflictError.assignedName,
            _id: existing.assignedTo?._id,
          },
        },
        { status: 409 }
      ),
    };
  }

  if (activityToRecord) {
    await Activity.create({
      prospectId,
      userId: session.user.id,
      type: "status_change",
      ...activityToRecord,
    });
  }

  return { updates: effectsUpdate };
}

/**
 * Sends notification when RDV date is set. Alerts admins and devs that
 * the website must be ready before the demo. Runs asynchronously in background.
 */
async function notifySiteToBuild(prospect: RdvProspect, closerName?: string | null) {
  const team = await User.find({
    role: { $in: ["admin", "dev"] },
    isActive: true,
  }).select("email");
  const recipients = [
    ...new Set(
      [...team.map((u: { email: string }) => u.email), process.env.ADMIN_EMAIL || ""].filter(
        Boolean,
      ),
    ),
  ].join(", ");

  const rdvLabel = prospect.rdvDate
    ? new Date(prospect.rdvDate).toLocaleString("fr-FR", {
        dateStyle: "full",
        timeStyle: "short",
        timeZone: "Europe/Paris",
      })
    : "date à confirmer";

  await sendEmail({
    to: recipients,
    subject: `🌐 Site à faire — ${prospect.name} (RDV le ${rdvLabel})`,
    html: `<h2>Un RDV a été fixé : le site doit être prêt pour la démo</h2>
     <p><strong>Prospect :</strong> ${prospect.name}${prospect.address?.city ? ` (${prospect.address.city})` : ""}</p>
     <p><strong>RDV :</strong> ${rdvLabel}</p>
     ${closerName ? `<p><strong>Closer :</strong> ${closerName}</p>` : ""}
     <p><a href="${process.env.NEXTAUTH_URL || ""}/prospects/${prospect._id.toString()}">Voir la fiche prospect</a> — le « Prompt Claude Design » y est disponible pour générer le site.</p>`,
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  await connectDB();

  const { id } = await params;
  const prospect = await Prospect.findById(id)
    .populate("assignedTo", "name email role")
    .populate("lockedBy", "name")
    .lean();

  if (!prospect) {
    return NextResponse.json(
      { error: "Prospect introuvable" },
      { status: 404 }
    );
  }

  return NextResponse.json(prospect);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  await connectDB();

  const { id } = await params;
  let updates = await req.json() as Record<string, unknown>;

  const existing = await Prospect.findById(id)
    .populate("assignedTo", "name email role")
    .populate("lockedBy", "name");
  if (!existing) {
    return NextResponse.json(
      { error: "Prospect introuvable" },
      { status: 404 }
    );
  }

  if (session.user.role === "dev") {
    const devValidationError = validateDevRoleRestrictions(updates, existing);
    if (devValidationError) return devValidationError;
    updates = pickDevAllowedFields(updates);
  }

  const lockError = validateProspectNotLocked(existing, session);
  if (lockError) return lockError;

  const assignedToResult = await processAssignedToField({
    body: updates,
    existing,
    session,
    prospectId: id,
  });
  if (assignedToResult.errorResponse) return assignedToResult.errorResponse;
  updates = assignedToResult.updates;

  const quoteAmountResult = processAdminAmountField({
    body: updates,
    existing,
    session,
    field: "quoteAmount",
    errorMessage: "Seul un admin peut modifier le montant du devis",
  });
  if (quoteAmountResult.errorResponse) return quoteAmountResult.errorResponse;
  updates = quoteAmountResult.updates;

  const subscriptionAmountResult = processAdminAmountField({
    body: updates,
    existing,
    session,
    field: "subscriptionAmount",
    errorMessage: "Seul un admin peut modifier le montant de l'abonnement",
  });
  if (subscriptionAmountResult.errorResponse) return subscriptionAmountResult.errorResponse;
  updates = subscriptionAmountResult.updates;

  const statusError = validateStatusTransition({ updates, existing, session });
  if (statusError) return statusError;

  const statusResult = await applyStatusChangeEffects({ updates, existing, session, prospectId: id });
  if (statusResult.errorResponse) return statusResult.errorResponse;
  updates = statusResult.updates;

  // Recalculer address.cityKey si address.city a changé.
  // Garantit que le rattachement territorial reste cohérent après modification.
  const hasAddressUpdate = updates.address && typeof updates.address === "object";
  if (hasAddressUpdate) {
    const newAddressData = updates.address as Record<string, unknown>;
    const newCity = newAddressData.city;
    const oldCity = (existing.address as Record<string, unknown> | undefined)?.city;

    // Redériver la clé seulement si la ville a changé vers une valeur valide.
    // N'écrase pas une clé existante si la ville reste inchangée ou manquante.
    if (
      newCity !== oldCity &&
      typeof newCity === "string" &&
      newCity.trim() !== ""
    ) {
      updates = {
        ...updates,
        address: {
          ...(updates.address as Record<string, unknown>),
          cityKey: normalizeCity(newCity),
        },
      };
    }
  }

  const prospect = await Prospect.findByIdAndUpdate(id, updates, {
    new: true,
    runValidators: true,
  })
    .populate("assignedTo", "name email role")
    .populate("lockedBy", "name")
    .lean();

  emitCrmEvent({
    type: "prospect:updated",
    prospectId: id,
    userId: session.user.id,
    timestamp: Date.now(),
  });

  if (
    updates.status === "rdv" &&
    existing.status !== "rdv" &&
    prospect
  ) {
    notifySiteToBuild(prospect as unknown as RdvProspect, session.user.name).catch(
      (error) => console.error("Échec notification site à faire", { id, error })
    );
  }

  return NextResponse.json(prospect);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  await connectDB();

  const { id } = await params;
  const prospect = await Prospect.findByIdAndDelete(id);

  if (!prospect) {
    return NextResponse.json(
      { error: "Prospect introuvable" },
      { status: 404 }
    );
  }

  await Activity.deleteMany({ prospectId: id });

  emitCrmEvent({ type: "prospect:deleted", prospectId: id, userId: session.user.id, timestamp: Date.now() });

  return NextResponse.json({ success: true });
}
