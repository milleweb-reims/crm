import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Prospect } from "@/lib/models/prospect.model";
import { getAuthSession, unauthorized, forbidden } from "@/lib/api-auth";
import { getQontoInvoicePdf } from "@/lib/qonto";
import { generateInvoice } from "@/lib/invoicing";

// Télécharge le PDF de la facture Qonto du prospect.
// Si le PDF n'est pas (encore) disponible, redirige vers la page Qonto de la
// facture en secours.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  await connectDB();

  const { id } = await params;
  const prospect = await Prospect.findById(id).select(
    "qontoInvoiceId qontoInvoiceUrl"
  );
  if (!prospect) {
    return NextResponse.json({ error: "Prospect introuvable" }, { status: 404 });
  }
  if (!prospect.qontoInvoiceId) {
    return NextResponse.json(
      { error: "Aucune facture Qonto pour ce prospect" },
      { status: 404 }
    );
  }

  const pdf = await getQontoInvoicePdf(prospect.qontoInvoiceId);
  if (!pdf) {
    if (prospect.qontoInvoiceUrl) {
      return NextResponse.redirect(prospect.qontoInvoiceUrl);
    }
    return NextResponse.json(
      { error: "PDF de la facture indisponible — réessaie dans un instant" },
      { status: 502 }
    );
  }

  return new NextResponse(new Uint8Array(pdf.content), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pdf.filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

// Rattrapage manuel (admin) : génère la facture Qonto d'un prospect payé
// dont la génération automatique a échoué (webhook). Idempotent : refuse si
// une facture existe déjà.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();
  if (session.user.role !== "admin") return forbidden();

  await connectDB();

  const { id } = await params;
  const prospect = await Prospect.findById(id);
  if (!prospect) {
    return NextResponse.json({ error: "Prospect introuvable" }, { status: 404 });
  }
  if (prospect.qontoInvoiceId) {
    return NextResponse.json(
      { error: "Une facture existe déjà pour ce prospect" },
      { status: 409 }
    );
  }
  if (!prospect.paidAt || !prospect.paidAmount) {
    return NextResponse.json(
      { error: "Ce prospect n'a pas de paiement enregistré" },
      { status: 400 }
    );
  }

  const invoice = await generateInvoice(prospect, null);
  if (!invoice) {
    return NextResponse.json(
      { error: "Échec de la génération de la facture Qonto — voir les logs serveur" },
      { status: 502 }
    );
  }

  return NextResponse.json({
    qontoInvoiceId: invoice.id,
    qontoInvoiceNumber: invoice.number ?? null,
    qontoInvoiceUrl: invoice.invoiceUrl ?? null,
  });
}
