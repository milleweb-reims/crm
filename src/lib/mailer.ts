import nodemailer from "nodemailer";

export interface MailAttachment {
  readonly filename: string;
  readonly content: Buffer;
}

export type SendEmailOptions = {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly attachments?: ReadonlyArray<MailAttachment>;
};

/**
 * Send email via SMTP.
 *
 * Requires environment variables:
 * - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, ADMIN_EMAIL
 */
export async function sendEmail(options: SendEmailOptions) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;

  if (!SMTP_HOST) {
    console.error("Mailer non configuré (SMTP_HOST manquant) — email non envoyé", {
      to: options.to,
      subject: options.subject,
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
      to: options.to,
      subject: options.subject,
      html: options.html,
      attachments: options.attachments ? [...options.attachments] : undefined,
    });
    return true;
  } catch (error) {
    console.error("Échec envoi email", { to: options.to, subject: options.subject, error });
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
  return sendEmail({ to: adminEmail, subject, html });
}
