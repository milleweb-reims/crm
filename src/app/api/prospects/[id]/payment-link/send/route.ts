import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { prospectPricing } from "@/lib/pricing-service";
import { Prospect } from "@/lib/models/prospect.model";
import { Activity } from "@/lib/models/activity.model";
import { getAuthSession, unauthorized } from "@/lib/api-auth";
import { sendEmail } from "@/lib/mailer";
import type { IProspect } from "@/types";

function getProspectEmail(prospect: IProspect): string | null {
  return prospect.email || prospect.emails?.individual || prospect.emails?.contact || null;
}

function formatPaymentAmount(amount: number | undefined): string {
  return amount ? `${amount.toLocaleString("fr-FR")} €` : "";
}

function buildPaymentLinkEmail(paymentLink: string, formattedAmount: string): string {
  return `<p>Bonjour,</p>
   <p>Comme convenu, voici votre lien de paiement sécurisé${formattedAmount ? ` d'un montant de <strong>${formattedAmount}</strong>` : ""} :</p>
   <p><a href="${paymentLink}">${paymentLink}</a></p>
   <p>Le paiement s'effectue directement depuis votre banque via GoCardless, notre prestataire de paiement.</p>
   <p>À très vite,<br/>L'équipe Milleweb</p>`;
}

/** Send the prospect's payment link via email. */
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

  if (!prospect.paymentLink) {
    return NextResponse.json(
      { error: "Génère d'abord le lien de paiement" },
      { status: 400 }
    );
  }

  const to = getProspectEmail(prospect);
  if (!to) {
    return NextResponse.json(
      { error: "Ce prospect n'a pas d'adresse email" },
      { status: 400 }
    );
  }

  const { quoteAmount } = await prospectPricing(prospect);
  const amount = formatPaymentAmount(quoteAmount);
  const html = buildPaymentLinkEmail(prospect.paymentLink, amount);

  const sent = await sendEmail({
    to,
    subject: `Votre lien de paiement — ${prospect.name}`,
    html,
  });

  if (!sent) {
    return NextResponse.json(
      { error: "Échec de l'envoi de l'email (SMTP non configuré ?)" },
      { status: 502 }
    );
  }

  await Activity.create({
    prospectId: prospect._id,
    userId: session.user.id,
    type: "email",
    content: `📧 Lien de paiement envoyé à ${to}`,
    metadata: { to, paymentLink: prospect.paymentLink },
  });

  return NextResponse.json({ success: true, to });
}
