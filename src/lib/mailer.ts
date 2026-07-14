import nodemailer from "nodemailer";

// Envoi d'email via SMTP. Variables d'env requises :
// SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, ADMIN_EMAIL
export interface MailAttachment {
  filename: string;
  content: Buffer;
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  attachments?: MailAttachment[]
) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;

  if (!SMTP_HOST) {
    console.error("Mailer non configuré (SMTP_HOST manquant) — email non envoyé", {
      to,
      subject,
    });
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT) === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });

  try {
    await transporter.sendMail({
      from: MAIL_FROM || SMTP_USER,
      to,
      subject,
      html,
      attachments,
    });
    return true;
  } catch (error) {
    console.error("Échec envoi email", { to, subject, error });
    return false;
  }
}

export async function sendAdminEmail(subject: string, html: string) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    console.error("Mailer non configuré (ADMIN_EMAIL manquant) — email non envoyé", {
      subject,
    });
    return false;
  }
  return sendEmail(adminEmail, subject, html);
}
