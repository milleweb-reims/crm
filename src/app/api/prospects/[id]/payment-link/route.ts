import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Prospect } from "@/lib/models/prospect.model";
import { Activity } from "@/lib/models/activity.model";
import { getAuthSession, unauthorized } from "@/lib/api-auth";
import { emitCrmEvent } from "@/lib/events";
import {
  createProspectPaymentLink,
  cancelBillingRequest,
  GoCardlessError,
} from "@/lib/gocardless";
import { ttcFromHt } from "@/lib/vat";

/**
 * Génère le lien de paiement GoCardless du prospect (montant = quoteAmount).
 * Idempotent : si un lien existe déjà, il est renvoyé tel quel, sauf si
 * { regenerate: true } est passé (l'ancienne billing request est alors annulée).
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

  if (!prospect.quoteAmount || prospect.quoteAmount <= 0) {
    return NextResponse.json(
      { error: "Renseigne d'abord le montant du devis (quoteAmount)" },
      { status: 400 }
    );
  }

  const { regenerate } = await req
    .json()
    .catch(() => ({ regenerate: false }));

  if (prospect.paymentLink && !regenerate) {
    return NextResponse.json({
      paymentLink: prospect.paymentLink,
      paymentLinkCreatedAt: prospect.paymentLinkCreatedAt,
      existing: true,
    });
  }

  if (regenerate && prospect.gcBillingRequestId) {
    await cancelBillingRequest(prospect.gcBillingRequestId);
  }

  try {
    const { billingRequestId, url } = await createProspectPaymentLink({
      id: prospect._id.toString(),
      name: prospect.name,
      email: prospect.email || prospect.emails?.individual || prospect.emails?.contact,
      quoteAmount: prospect.quoteAmount,
    });

    prospect.gcBillingRequestId = billingRequestId;
    prospect.paymentLink = url;
    prospect.paymentLinkCreatedAt = new Date();
    await prospect.save();

    await Activity.create({
      prospectId: prospect._id,
      userId: session.user.id,
      type: "payment",
      content: `🔗 Lien de paiement généré (${prospect.quoteAmount.toLocaleString("fr-FR")} € HT — ${ttcFromHt(prospect.quoteAmount).toLocaleString("fr-FR")} € TTC)`,
      metadata: { billingRequestId, amount: prospect.quoteAmount, regenerate: !!regenerate },
    });

    emitCrmEvent({
      type: "prospect:updated",
      prospectId: prospect._id.toString(),
      userId: session.user.id,
      timestamp: Date.now(),
    });

    return NextResponse.json({
      paymentLink: url,
      paymentLinkCreatedAt: prospect.paymentLinkCreatedAt,
      existing: false,
    });
  } catch (error) {
    console.error("Échec génération lien de paiement", { prospectId: id, error });
    if (
      error instanceof GoCardlessError &&
      (!error.status || error.status === 401)
    ) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(
      { error: "Échec de la génération du lien de paiement GoCardless" },
      { status: 502 }
    );
  }
}
