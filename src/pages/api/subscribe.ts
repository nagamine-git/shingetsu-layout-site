export const prerender = false;

import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { verifyTurnstile } from "../../lib/turnstile";
import { ResendError, createContact, sendEmail } from "../../lib/resend";
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
  const segmentId = cfEnv["RESEND_SEGMENT_ID"] ?? "";
  const mailFrom = cfEnv["MAIL_FROM"] ?? "";

  // 未設定のまま Resend を叩くと 401/422 になって原因が分かりにくいので、先に切り分ける
  if (!resendApiKey || !segmentId) {
    console.error("Subscribe not configured:", { hasApiKey: !!resendApiKey, hasSegmentId: !!segmentId });
    return jsonRes({ error: "not_configured" }, 503);
  }

  // 購読の本体はコンタクト作成。ここが失敗したときだけ登録失敗として扱う
  try {
    await createContact(resendApiKey, {
      email,
      segmentId,
      properties: { type: type as SubscribeType, subscribed_at: new Date().toISOString() },
    });
  } catch (err) {
    const status = err instanceof ResendError ? err.status : 0;
    console.error("Subscribe contact error:", err);
    return jsonRes({ error: "server_error", stage: "contact", status }, 500);
  }

  // 確認の通知は補助的な位置づけ。送信元ドメインが未検証などで失敗しても購読自体は成立しているので、
  // 登録失敗として扱わず ok を返す（mailSent で区別できるようにする）
  if (!mailFrom) {
    console.warn("MAIL_FROM is not set; skipping the confirmation notice");
    return jsonRes({ ok: true, mailSent: false }, 200);
  }
  try {
    await sendEmail(resendApiKey, {
      from: mailFrom,
      to: email,
      subject: "【新月配列】登録完了のご確認",
      html: `<p>新月配列への登録が完了しました。</p><p>最新情報をお届けします。</p>`,
    });
  } catch (err) {
    console.error("Subscribe confirmation failed (subscription kept):", err);
    return jsonRes({ ok: true, mailSent: false }, 200);
  }

  return jsonRes({ ok: true, mailSent: true }, 200);
};
