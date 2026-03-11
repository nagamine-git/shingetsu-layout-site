export const prerender = false;

import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { verifyTurnstile } from "../../lib/turnstile";
import { createContact, sendEmail } from "../../lib/resend";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_TYPES = ["newsletter", "preregister"] as const;
type SubscribeType = (typeof VALID_TYPES)[number];

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400 });
  }

  const { email, type, turnstileToken } = body as Record<string, unknown>;

  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return new Response(JSON.stringify({ error: "invalid_email" }), { status: 400 });
  }
  if (typeof type !== "string" || !(VALID_TYPES as readonly string[]).includes(type)) {
    return new Response(JSON.stringify({ error: "invalid_type" }), { status: 400 });
  }
  if (typeof turnstileToken !== "string" || !turnstileToken) {
    return new Response(JSON.stringify({ error: "missing_token" }), { status: 400 });
  }

  const cfEnv = env as Record<string, string>;
  const secretKey = cfEnv["TURNSTILE_SECRET_KEY"] ?? "";
  const resendApiKey = cfEnv["RESEND_API_KEY"] ?? "";
  const segmentId = cfEnv["RESEND_SEGMENT_ID"] ?? "";

  const valid = await verifyTurnstile(turnstileToken, secretKey);
  if (!valid) {
    return new Response(JSON.stringify({ error: "verification_failed" }), { status: 403 });
  }

  try {
    await createContact(resendApiKey, {
      email,
      segmentId,
      properties: {
        type: type as SubscribeType,
        subscribed_at: new Date().toISOString(),
      },
    });

    await sendEmail(resendApiKey, {
      from: "noreply@shingetsu.dev",
      to: email,
      subject: "【新月配列】登録完了のご確認",
      html: `<p>新月配列への登録が完了しました。</p><p>最新情報をお届けします。</p>`,
    });
  } catch (err) {
    console.error("Subscribe error:", err);
    return new Response(JSON.stringify({ error: "server_error" }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
