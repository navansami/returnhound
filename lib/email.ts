import { Resend } from "resend";

export type EmailResult = { ok: true } | { ok: false; error: string };

/** Send an email through Resend. No-op error when the API key is missing. */
export async function sendEmail(opts: { to: string | string[]; subject: string; html: string }): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set." };

  const from = process.env.EMAIL_FROM ?? "ReturnHound Lost & Found <hello@returnhound.xyz>";
  const resend = new Resend(apiKey);
  const res = await resend.emails.send({ from, to: Array.isArray(opts.to) ? opts.to : [opts.to], subject: opts.subject, html: opts.html });
  if (res.error) {
    // Log so failures are visible in Vercel function logs — the auth flows
    // intentionally don't fail the request when email can't be sent.
    console.error("[email] send failed", { from, to: opts.to, error: res.error });
    return { ok: false, error: res.error.message };
  }
  console.log("[email] sent", { from, to: opts.to, id: res.data?.id });
  return { ok: true };
}

/** Shared layout for transactional (auth) emails. Reports build their own document. */
export function emailLayout(opts: { title: string; body: string }): string {
  return `<!doctype html>
<html>
<body style="margin:0;padding:24px;background:#f6f6f4;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
    <div style="background:#18181b;color:#fff;padding:16px 24px;font-size:16px;font-weight:600">ReturnHound Lost &amp; Found</div>
    <div style="padding:24px">
      <h1 style="font-size:18px;margin:0 0 12px">${opts.title}</h1>
      <div style="font-size:14px;line-height:1.6">${opts.body}</div>
    </div>
  </div>
</body>
</html>`;
}
