import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Prospect } from "@/lib/models/prospect.model";
import { Activity } from "@/lib/models/activity.model";
import { User } from "@/lib/models/user.model";
import { getAuthSession, unauthorized } from "@/lib/api-auth";
import { emitCrmEvent } from "@/lib/events";
import { isLockActive } from "@/lib/lock";
import { sendEmail } from "@/lib/mailer";

interface RdvProspect {
  _id: { toString(): string };
  name: string;
  rdvDate?: Date | string | null;
  address?: { city?: string };
  website?: string;
}

// Prévient l'admin et les devs qu'un site est à construire avant le RDV
async function notifySiteToBuild(prospect: RdvProspect, closerName?: string | null) {
  const team = await User.find({
    role: { $in: ["admin", "dev"] },
    isActive: true,
  }).select("email");
  const recipients = [
    ...team.map((u: { email: string }) => u.email),
    process.env.ADMIN_EMAIL || "",
  ]
    .filter(Boolean)
    .join(", ");

  const rdvLabel = prospect.rdvDate
    ? new Date(prospect.rdvDate).toLocaleString("fr-FR", {
        dateStyle: "full",
        timeStyle: "short",
        timeZone: "Europe/Paris",
      })
    : "date à confirmer";

  await sendEmail(
    recipients,
    `🌐 Site à faire — ${prospect.name} (RDV le ${rdvLabel})`,
    `<h2>Un RDV a été fixé : le site doit être prêt pour la démo</h2>
     <p><strong>Prospect :</strong> ${prospect.name}${prospect.address?.city ? ` (${prospect.address.city})` : ""}</p>
     <p><strong>RDV :</strong> ${rdvLabel}</p>
     ${closerName ? `<p><strong>Closer :</strong> ${closerName}</p>` : ""}
     <p><a href="${process.env.NEXTAUTH_URL || ""}/prospects/${prospect._id.toString()}">Voir la fiche prospect</a> — le « Prompt Claude Design » y est disponible pour générer le site.</p>`
  );
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
  const body = await req.json();

  const existing = await Prospect.findById(id)
    .populate("assignedTo", "name email role")
    .populate("lockedBy", "name");
  if (!existing) {
    return NextResponse.json(
      { error: "Prospect introuvable" },
      { status: 404 }
    );
  }

  // Fiche verrouillée par un autre utilisateur : pas de modification possible
  // (le statut "en_appel" verrouille sans expiration)
  if (
    existing.lockedBy &&
    existing.lockedBy._id.toString() !== session.user.id &&
    (isLockActive(existing.lockedAt) || existing.status === "en_appel") &&
    session.user.role !== "admin"
  ) {
    return NextResponse.json(
      {
        error: `Fiche en cours de traitement par ${existing.lockedBy.name || "un autre utilisateur"}`,
        lockedBy: existing.lockedBy,
      },
      { status: 423 }
    );
  }

  // Attribution manuelle (champ envoyé par le client) : admin uniquement.
  // L'auto-assignation au changement de statut (plus bas) reste ouverte aux closers.
  if ("assignedTo" in body) {
    const requested = body.assignedTo || null;
    const current = existing.assignedTo?._id?.toString() ?? null;

    if (requested === current) {
      delete body.assignedTo;
    } else {
      if (session.user.role !== "admin") {
        return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
      }

      let assigneeName: string | null = null;
      if (requested) {
        const assignee = await User.findById(requested).select("name isActive");
        if (!assignee || !assignee.isActive) {
          return NextResponse.json(
            { error: "Utilisateur introuvable ou désactivé" },
            { status: 400 }
          );
        }
        assigneeName = assignee.name;
      }
      body.assignedTo = requested;

      await Activity.create({
        prospectId: id,
        userId: session.user.id,
        type: "note",
        content: assigneeName
          ? `Prospect attribué à ${assigneeName}`
          : "Attribution retirée",
        metadata: { assignedTo: requested },
      });
    }
  }

  // Le montant du devis est fixé par un admin uniquement : ni un closer ni
  // un dev ne peuvent le définir ou le modifier.
  if ("quoteAmount" in body && session.user.role !== "admin") {
    const requested = body.quoteAmount ?? null;
    const current = existing.quoteAmount ?? null;
    if (requested !== current) {
      return NextResponse.json(
        { error: "Seul un admin peut modifier le montant du devis" },
        { status: 403 }
      );
    }
    delete body.quoteAmount;
  }

  // Le statut « payé » est géré par le webhook GoCardless : on ne le pose
  // pas à la main, et une fiche payée ne change plus de statut (sauf admin
  // pour corriger une erreur).
  if (body.status && body.status !== existing.status) {
    if (body.status === "paye") {
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
  }

  // Auto-assign on status change (closer takes a prospect)
  if (body.status && body.status !== existing.status) {
    const isCloserOrAdmin = session.user.role === "closer" || session.user.role === "admin";

    // If prospect is being moved out of "prospect" status, auto-assign
    if (existing.status === "prospect" && isCloserOrAdmin && !existing.assignedTo) {
      body.assignedTo = session.user.id;
    }

    // Conflict check: if already assigned to another user, reject —
    // sauf si l'utilisateur détient le verrou (il a « pris » la fiche)
    const holdsLock =
      existing.lockedBy &&
      existing.lockedBy._id.toString() === session.user.id;
    if (
      !holdsLock &&
      existing.assignedTo &&
      existing.assignedTo._id.toString() !== session.user.id &&
      session.user.role !== "admin"
    ) {
      const assignedName = existing.assignedTo.name || "un autre utilisateur";
      return NextResponse.json(
        {
          error: `Ce prospect est déjà pris par ${assignedName}`,
          assignedTo: existing.assignedTo,
        },
        { status: 409 }
      );
    }

    // Passer "en appel" verrouille immédiatement la fiche pour ce closer
    if (body.status === "en_appel") {
      body.lockedBy = session.user.id;
      body.lockedAt = new Date();
    }

    await Activity.create({
      prospectId: id,
      userId: session.user.id,
      type: "status_change",
      content: `Statut changé de "${existing.status}" à "${body.status}"`,
      metadata: { from: existing.status, to: body.status },
    });
  }

  const prospect = await Prospect.findByIdAndUpdate(id, body, {
    new: true,
    runValidators: true,
  })
    .populate("assignedTo", "name email role")
    .populate("lockedBy", "name")
    .lean();

  emitCrmEvent({ type: "prospect:updated", prospectId: id, userId: session.user.id, timestamp: Date.now() });

  // RDV posé = un site à construire avant la démo → prévenir l'admin et les
  // devs. Envoi en tâche de fond : la réponse ne doit pas attendre le SMTP.
  if (body.status === "rdv" && existing.status !== "rdv" && prospect) {
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

  // Clean up related data
  await Activity.deleteMany({ prospectId: id });

  emitCrmEvent({ type: "prospect:deleted", prospectId: id, userId: session.user.id, timestamp: Date.now() });

  return NextResponse.json({ success: true });
}
