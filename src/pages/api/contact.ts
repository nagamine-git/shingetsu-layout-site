export const prerender = false;

import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { verifyTurnstile } from "../../lib/turnstile";
import { sendEmail } from "../../lib/resend";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400 });
  }

  const { name, email, message, turnstileToken } = body as Record<string, unknown>;

  if (typeof name !== "string" || name.length < 1 || name.length > 100) {
    return new Response(JSON.stringify({ error: "invalid_name" }), { status: 400 });
  }
  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return new Response(JSON.stringify({ error: "invalid_email" }), { status: 400 });
  }
  if (typeof message !== "string" || message.length < 1 || message.length > 5000) {
    return new Response(JSON.stringify({ error: "invalid_message" }), { status: 400 });
  }
  if (typeof turnstileToken !== "string" || !turnstileToken) {
    return new Response(JSON.stringify({ error: "missing_token" }), { status: 400 });
  }

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const cfEnv = env as Record<string, string>;
  const secretKey = cfEnv["TURNSTILE_SECRET_KEY"] ?? "";
  const resendApiKey = cfEnv["RESEND_API_KEY"] ?? "";
  const contactToEmail = cfEnv["CONTACT_TO_EMAIL"] ?? "";

  const valid = await verifyTurnstile(turnstileToken, secretKey);
  if (!valid) {
    return new Response(JSON.stringify({ error: "verification_failed" }), { status: 403 });
  }

  try {
    await sendEmail(resendApiKey, {
      from: "noreply@shingetsu.dev",
      to: contactToEmail,
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
    return new Response(JSON.stringify({ error: "server_error" }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
