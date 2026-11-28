import nodemailer from "nodemailer";

type SmtpConfiguration = { host: string; port: number; user: string; password: string };
type MailMessage = { from: string; to: string; subject: string; text: string };

export async function sendSmtpMail(config: SmtpConfiguration, message: MailMessage) {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: config.port !== 465,
    tls: { minVersion: "TLSv1.2" },
    auth: { user: config.user, pass: config.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false
  });
  try {
    const result = await transport.sendMail(message);
    if (!result.accepted?.length) throw new Error("Mail delivery was not accepted.");
  } finally {
    transport.close();
  }
}
