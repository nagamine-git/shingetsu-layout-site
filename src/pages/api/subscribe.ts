export const prerender = false;

import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { verifyTurnstile } from "../../lib/turnstile";
import { createContact, sendEmail } from "../../lib/resend";
import { EMAIL_RE, jsonRes } from "../../lib/api";

const VALID_TYPES = ["newsletter", "preregister"] as const;
type SubscribeType = (typeof VALID_TYPES)[number];

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonRes({ error: "invalid_json" }, 400);
  }

  const { email, type, turnstileToken } = body as Record<string, unknown>;

  if (typeof email !== "string" || !EMAIL_RE.test(email))
    return jsonRes({ error: "invalid_email" }, 400);
  if (typeof type !== "string" || !(VALID_TYPES as readonly string[]).includes(type))
    return jsonRes({ error: "invalid_type" }, 400);
  if (typeof turnstileToken !== "string" || !turnstileToken)
    return jsonRes({ error: "missing_token" }, 400);

  const cfEnv = env as Record<string, string>;
  const valid = await verifyTurnstile(turnstileToken, cfEnv["TURNSTILE_SECRET_KEY"] ?? "");
  if (!valid) return jsonRes({ error: "verification_failed" }, 403);

  const resendApiKey = cfEnv["RESEND_API_KEY"] ?? "";
  try {
    await createContact(resendApiKey, {
      email,
      segmentId: cfEnv["RESEND_SEGMENT_ID"] ?? "",
      properties: { type: type as SubscribeType, subscribed_at: new Date().toISOString() },
    });
    await sendEmail(resendApiKey, {
      from: "noreply@shingetsu.dev",
      to: email,
      subject: "【新月配列】登録完了のご確認",
      html: `<p>新月配列への登録が完了しました。</p><p>最新情報をお届けします。</p>`,
    });
  } catch (err) {
    console.error("Subscribe error:", err);
    return jsonRes({ error: "server_error" }, 500);
  }

  return jsonRes({ ok: true }, 200);
};
