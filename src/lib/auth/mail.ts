import { AuthError } from "./errors";

function configuration() {
  try {
    const app = new URL(process.env.AUTH_APP_URL || "");
    const local = process.env.NODE_ENV !== "production";
    const from = process.env.AUTH_MAIL_FROM?.trim();
    if ((app.protocol !== "https:" && !(local && app.protocol === "http:")) ||
        app.username || app.password || !from || /[\r\n]/.test(from)) throw new Error();
    const transport = process.env.AUTH_MAIL_TRANSPORT || (process.env.AUTH_MAIL_API_URL ? "http" : "smtp");
    if (transport === "smtp") {
      const host = process.env.AUTH_SMTP_HOST?.trim();
      const port = Number(process.env.AUTH_SMTP_PORT || "465");
      if (!host || /[\s/@?#:]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 ||
          !process.env.AUTH_SMTP_USER?.trim() || !process.env.AUTH_SMTP_PASSWORD?.trim()) throw new Error();
      return { transport, app, from, host, port, user: process.env.AUTH_SMTP_USER, password: process.env.AUTH_SMTP_PASSWORD } as const;
    }
    if (transport !== "http") throw new Error();
    const endpoint = new URL(process.env.AUTH_MAIL_API_URL || "");
    if ((endpoint.protocol !== "https:" && !(local && endpoint.protocol === "http:")) ||
        endpoint.username || endpoint.password || !process.env.AUTH_MAIL_API_KEY?.trim()) throw new Error();
    return { transport, endpoint, app, key: process.env.AUTH_MAIL_API_KEY, from } as const;
  } catch {
    throw new AuthError("邮件服务暂不可用，请稍后重试。", 503);
  }
}

export function assertAuthMailConfigured() {
  configuration();
}

// HTTP gateway contract: Bearer API key; JSON {from,to,subject,text}; any 2xx acknowledges delivery.
// Never return upstream bodies/errors: they can contain tokens, API keys or recipient addresses.
export async function sendAuthMail(email: string, token: string, purpose: "verify" | "reset") {
  const config = configuration();
  const link = new URL(purpose === "verify" ? "/verify-email" : "/reset-password", config.app);
  link.hash = new URLSearchParams({ token }).toString();
  const message = {
    from: config.from,
    to: email,
    subject: purpose === "verify" ? "验证邮箱" : "重设密码",
    text: `${purpose === "verify" ? "验证邮箱以完成注册" : "重设密码"}：${link.toString()}\n链接 30 分钟内有效，仅可使用一次。如非本人操作，请忽略此邮件。`
  };
  try {
    if (config.transport === "smtp") {
      const { sendSmtpMail } = await import("./smtp");
      await sendSmtpMail(config, message);
      return;
    }
    const response = await fetch(config.endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(message)
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error();
  } catch {
    throw new AuthError("邮件服务暂不可用，请稍后重试。", 503);
  }
}
