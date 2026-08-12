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
import { prospectPricing } from "@/lib/pricing-service";
import { ttcFromHt } from "@/lib/vat";

/**
 * Génère le lien de paiement GoCardless du prospect.
 *
 * Le montant est le tarif de création du closer qui DÉTIENT la fiche, et non
 * celui de l'appelant : un admin qui génère le lien d'une fiche de Moh applique
 * le tarif de Moh.
 *
 * Idempotent : si un lien existe déjà, il est renvoyé tel quel, sauf si
 * { regenerate: true } est passé (l'ancienne billing request est alors annulée).
 * Un lien déjà émis porte définitivement son montant : GoCardless le fige à la
 * création de la billing request, un changement de tarif ne l'affecte pas.
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

  // Toujours strictement positif : la résolution retombe sur le tarif par défaut
  // plutôt que de rendre un montant inexploitable.
  const { quoteAmount } = await prospectPricing(prospect.assignedTo);

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
      quoteAmount,
    });

    prospect.gcBillingRequestId = billingRequestId;
    prospect.paymentLink = url;
    prospect.paymentLinkCreatedAt = new Date();
    await prospect.save();

    await Activity.create({
      prospectId: prospect._id,
      userId: session.user.id,
      type: "payment",
      // L'activité est la seule trace durable du montant demandé : la fiche ne
      // stocke aucun prix, et le tarif du closer peut changer ensuite.
      content: `🔗 Lien de paiement généré (${quoteAmount.toLocaleString("fr-FR")} € HT — ${ttcFromHt(quoteAmount).toLocaleString("fr-FR")} € TTC)`,
      metadata: { billingRequestId, amount: quoteAmount, regenerate: !!regenerate },
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
