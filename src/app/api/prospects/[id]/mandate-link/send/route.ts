import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Prospect } from "@/lib/models/prospect.model";
import { Activity } from "@/lib/models/activity.model";
import { getAuthSession, unauthorized } from "@/lib/api-auth";
import { sendEmail } from "@/lib/mailer";
import { ttcFromHt } from "@/lib/vat";
import type { IProspect } from "@/types";

function getProspectEmail(prospect: IProspect): string | null {
  return prospect.email || prospect.emails?.individual || prospect.emails?.contact || null;
}

function buildMandateLinkEmail(mandateLink: string, monthlyTtc: string): string {
  return `<p>Bonjour,</p>
   <p>Comme convenu, voici votre lien pour mettre en place le mandat de prélèvement de votre abonnement mensuel de <strong>${monthlyTtc} TTC/mois</strong> (hébergement, maintenance et mises à jour de votre site) :</p>
   <p><a href="${mandateLink}">${mandateLink}</a></p>
   <p>La signature s'effectue en ligne de façon sécurisée via GoCardless, notre prestataire de paiement. Le premier prélèvement interviendra un mois après la signature.</p>
   <p>À très vite,<br/>L'équipe Milleweb</p>`;
}

/** Send the prospect's subscription mandate link via email. */
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

  if (!prospect.mandateLink) {
    return NextResponse.json(
      { error: "Génère d'abord le lien de mandat" },
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

  const monthlyTtc = `${ttcFromHt(prospect.subscriptionAmount ?? 29).toLocaleString("fr-FR")} €`;
  const html = buildMandateLinkEmail(prospect.mandateLink, monthlyTtc);

  const sent = await sendEmail({
    to,
    subject: `Votre mandat d'abonnement — ${prospect.name}`,
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
    content: `📧 Lien de mandat envoyé à ${to}`,
    metadata: { to, mandateLink: prospect.mandateLink },
  });

  return NextResponse.json({ success: true, to });
}
