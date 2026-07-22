import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Prospect } from "@/lib/models/prospect.model";
import { Activity } from "@/lib/models/activity.model";
import { getAuthSession, unauthorized } from "@/lib/api-auth";
import { emitCrmEvent } from "@/lib/events";
import {
  addOneMonthClamped,
  createSubscription,
  parseGcDate,
  toLocalDateString,
  GoCardlessError,
} from "@/lib/gocardless";
import { ttcFromHt } from "@/lib/vat";

/**
 * Rattrapage : crée l'abonnement GoCardless sur le mandat déjà signé quand la
 * création automatique du webhook a échoué. Idempotent via gcSubscriptionId.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  await connectDB();

  const { id } = await params;
  const prospect = await Prospect.findById(id);
  if (!prospect) {
    return NextResponse.json({ error: "Prospect introuvable" }, { status: 404 });
  }

  if (prospect.gcSubscriptionId) {
    return NextResponse.json({
      gcSubscriptionId: prospect.gcSubscriptionId,
      existing: true,
    });
  }

  if (!prospect.gcMandateId) {
    return NextResponse.json(
      { error: "Aucun mandat signé pour ce client" },
      { status: 400 }
    );
  }

  const amountHt = prospect.subscriptionAmount ?? 29;
  if (amountHt <= 0) {
    return NextResponse.json(
      { error: "Montant d'abonnement invalide — corrige-le d'abord" },
      { status: 400 }
    );
  }

  // Premier prélèvement un mois après la signature ; si cette date est déjà
  // passée (rattrapage tardif), GoCardless choisit la première date possible.
  const plannedStart = prospect.mandateSignedAt
    ? addOneMonthClamped(new Date(prospect.mandateSignedAt))
    : null;
  const startDate =
    plannedStart && plannedStart > new Date()
      ? toLocalDateString(plannedStart)
      : undefined;

  try {
    const { subscriptionId, startDate: scheduledStart } = await createSubscription({
      mandateId: prospect.gcMandateId,
      prospectId: prospect._id.toString(),
      prospectName: prospect.name,
      monthlyAmountHt: amountHt,
      startDate,
    });

    prospect.gcSubscriptionId = subscriptionId;
    prospect.subscriptionStartDate = scheduledStart ? parseGcDate(scheduledStart) : null;
    await prospect.save();

    await Activity.create({
      prospectId: prospect._id,
      userId: session.user.id,
      type: "payment",
      content: `🔁 Abonnement créé manuellement (${amountHt.toLocaleString("fr-FR")} € HT/mois — ${ttcFromHt(amountHt).toLocaleString("fr-FR")} € TTC)`,
      metadata: { subscriptionId, mandateId: prospect.gcMandateId, amount: amountHt },
    });

    emitCrmEvent({
      type: "prospect:updated",
      prospectId: prospect._id.toString(),
      userId: session.user.id,
      timestamp: Date.now(),
    });

    return NextResponse.json({
      gcSubscriptionId: subscriptionId,
      subscriptionStartDate: prospect.subscriptionStartDate,
      existing: false,
    });
  } catch (error) {
    console.error("Échec création manuelle de l'abonnement", { prospectId: id, error });
    if (
      error instanceof GoCardlessError &&
      (!error.status || error.status === 401)
    ) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(
      { error: "Échec de la création de l'abonnement GoCardless" },
      { status: 502 }
    );
  }
}
