import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Prospect } from "@/lib/models/prospect.model";
import { Activity } from "@/lib/models/activity.model";
import { getAuthSession, unauthorized } from "@/lib/api-auth";
import { emitCrmEvent } from "@/lib/events";
import { sendEmail } from "@/lib/mailer";

// Envoi d'un email libre au prospect depuis l'interface, avec l'adresse
// Milleweb (SMTP configuré). L'envoi est tracé dans l'activité de la fiche.

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

  const to =
    prospect.email || prospect.emails?.individual || prospect.emails?.contact;
  if (!to) {
    return NextResponse.json(
      { error: "Ce prospect n'a pas d'adresse email" },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const subject = String(body.subject || "").trim();
  const message = String(body.message || "").trim();
  if (!subject || !message) {
    return NextResponse.json(
      { error: "Objet et message requis" },
      { status: 400 }
    );
  }

  const sent = await sendEmail(
    to,
    subject,
    `<p>${escapeHtml(message).replace(/\n/g, "<br/>")}</p>
     <p>—<br/>${escapeHtml(session.user.name || "L'équipe Milleweb")}<br/>Milleweb</p>`
  );

  if (!sent) {
    return NextResponse.json(
      { error: "Échec de l'envoi (SMTP non configuré ou indisponible)" },
      { status: 502 }
    );
  }

  await Activity.create({
    prospectId: id,
    userId: session.user.id,
    type: "email",
    content: `📧 Email envoyé à ${to} — « ${subject} »\n\n${message}`,
    metadata: { to, subject },
  });

  emitCrmEvent({
    type: "prospect:updated",
    prospectId: id,
    userId: session.user.id,
    timestamp: Date.now(),
  });

  return NextResponse.json({ success: true, to });
}
