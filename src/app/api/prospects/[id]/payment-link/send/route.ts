import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Prospect } from "@/lib/models/prospect.model";
import { Activity } from "@/lib/models/activity.model";
import { getAuthSession, unauthorized } from "@/lib/api-auth";
import { sendEmail } from "@/lib/mailer";

// Envoie le lien de paiement du prospect par email (au prospect).
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

  const to =
    prospect.email || prospect.emails?.individual || prospect.emails?.contact;
  if (!to) {
    return NextResponse.json(
      { error: "Ce prospect n'a pas d'adresse email" },
      { status: 400 }
    );
  }

  const amount = prospect.quoteAmount
    ? `${prospect.quoteAmount.toLocaleString("fr-FR")} €`
    : "";

  const sent = await sendEmail(
    to,
    `Votre lien de paiement — ${prospect.name}`,
    `<p>Bonjour,</p>
     <p>Comme convenu, voici votre lien de paiement sécurisé${amount ? ` d'un montant de <strong>${amount}</strong>` : ""} :</p>
     <p><a href="${prospect.paymentLink}">${prospect.paymentLink}</a></p>
     <p>Le paiement s'effectue directement depuis votre banque via GoCardless, notre prestataire de paiement.</p>
     <p>À très vite,<br/>L'équipe Milleweb</p>`
  );

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
