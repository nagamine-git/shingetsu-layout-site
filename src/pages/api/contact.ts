export const prerender = false;

import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { verifyTurnstile } from "../../lib/turnstile";
import { sendEmail } from "../../lib/resend";
import { EMAIL_RE, jsonRes } from "../../lib/api";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonRes({ error: "invalid_json" }, 400);
  }

  const { name, email, message, turnstileToken } = body as Record<string, unknown>;

  if (typeof name !== "string" || name.length < 1 || name.length > 100)
    return jsonRes({ error: "invalid_name" }, 400);
  if (typeof email !== "string" || !EMAIL_RE.test(email))
    return jsonRes({ error: "invalid_email" }, 400);
  if (typeof message !== "string" || message.length < 1 || message.length > 5000)
    return jsonRes({ error: "invalid_message" }, 400);
  if (typeof turnstileToken !== "string" || !turnstileToken)
    return jsonRes({ error: "missing_token" }, 400);

  const cfEnv = env as Record<string, string>;
  const valid = await verifyTurnstile(turnstileToken, cfEnv["TURNSTILE_SECRET_KEY"] ?? "");
  if (!valid) return jsonRes({ error: "verification_failed" }, 403);

  const resendApiKey = cfEnv["RESEND_API_KEY"] ?? "";
  try {
    await sendEmail(resendApiKey, {
      from: "noreply@shingetsu.dev",
      to: cfEnv["CONTACT_TO_EMAIL"] ?? "",
      replyTo: email,
      subject: `【お問い合わせ】${name} 様より`,
      html: `<p><strong>名前:</strong> ${esc(name)}</p><p><strong>メール:</strong> ${esc(email)}</p><p><strong>内容:</strong></p><pre>${esc(message)}</pre>`,
    });
    await sendEmail(resendApiKey, {
      from: "noreply@shingetsu.dev",
      to: email,
      subject: "【新月配列】お問い合わせを受け付けました",
      html: `<p>${name} 様</p><p>お問い合わせありがとうございます。2〜3 営業日以内にご返信いたします。</p>`,
    });
  } catch (err) {
    console.error("Contact error:", err);
    return jsonRes({ error: "server_error" }, 500);
  }

  return jsonRes({ ok: true }, 200);
};
