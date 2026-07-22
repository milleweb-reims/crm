import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Prospect } from "@/lib/models/prospect.model";
import { Activity } from "@/lib/models/activity.model";
import { getAuthSession, unauthorized } from "@/lib/api-auth";
import { emitCrmEvent } from "@/lib/events";
import {
  createProspectMandateLink,
  cancelBillingRequest,
  GoCardlessError,
} from "@/lib/gocardless";
import { ttcFromHt } from "@/lib/vat";

/**
 * Génère le lien de mandat GoCardless de l'abonnement mensuel du prospect.
 * Idempotent : si un lien existe déjà, il est renvoyé tel quel, sauf si
 * { regenerate: true } est passé (l'ancienne billing request est alors annulée
 * et le mandat précédent oublié).
 */
export async function POST(
  req: NextRequest,
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
    return NextResponse.json(
      { error: "L'abonnement est déjà actif pour ce client" },
      { status: 400 }
    );
  }

  const amountHt = prospect.subscriptionAmount ?? 29;
  if (amountHt <= 0) {
    return NextResponse.json(
      { error: "Montant d'abonnement invalide — corrige-le avant de générer le lien" },
      { status: 400 }
    );
  }

  const { regenerate } = await req
    .json()
    .catch(() => ({ regenerate: false }));

  if (prospect.mandateLink && !regenerate) {
    return NextResponse.json({
      mandateLink: prospect.mandateLink,
      mandateLinkCreatedAt: prospect.mandateLinkCreatedAt,
      existing: true,
    });
  }

  if (regenerate && prospect.gcMandateBillingRequestId) {
    await cancelBillingRequest(prospect.gcMandateBillingRequestId);
  }

  try {
    const { billingRequestId, url } = await createProspectMandateLink({
      id: prospect._id.toString(),
      name: prospect.name,
      email: prospect.email || prospect.emails?.individual || prospect.emails?.contact,
    });

    prospect.gcMandateBillingRequestId = billingRequestId;
    prospect.mandateLink = url;
    prospect.mandateLinkCreatedAt = new Date();
    if (regenerate) {
      prospect.gcMandateId = null;
      prospect.mandateSignedAt = null;
    }
    await prospect.save();

    await Activity.create({
      prospectId: prospect._id,
      userId: session.user.id,
      type: "payment",
      content: `🔗 Lien de mandat généré (abonnement ${amountHt.toLocaleString("fr-FR")} € HT/mois — ${ttcFromHt(amountHt).toLocaleString("fr-FR")} € TTC prélevés)`,
      metadata: { billingRequestId, amount: amountHt, regenerate: !!regenerate },
    });

    emitCrmEvent({
      type: "prospect:updated",
      prospectId: prospect._id.toString(),
      userId: session.user.id,
      timestamp: Date.now(),
    });

    return NextResponse.json({
      mandateLink: url,
      mandateLinkCreatedAt: prospect.mandateLinkCreatedAt,
      existing: false,
    });
  } catch (error) {
    console.error("Échec génération lien de mandat", { prospectId: id, error });
    if (
      error instanceof GoCardlessError &&
      (!error.status || error.status === 401)
    ) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(
      { error: "Échec de la génération du lien de mandat GoCardless" },
      { status: 502 }
    );
  }
}
