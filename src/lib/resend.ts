interface EmailPayload {
  from: string;
  to: string | string[];
  replyTo?: string;
  subject: string;
  html: string;
}

interface ContactPayload {
  email: string;
  /** 任意。指定したときだけセグメントに追加する（Resend の API ではセグメントは必須ではない） */
  segmentId?: string;
}

/** Resend からのエラー。上流のステータスを保持し、呼び出し側が原因を切り分けられるようにする。 */
export class ResendError extends Error {
  readonly status: number;
  constructor(path: string, status: number, body: string) {
    super(`Resend API error (${path}): ${status} ${body}`);
    this.name = "ResendError";
    this.status = status;
  }
}

async function resendPost(apiKey: string, path: string, body: unknown): Promise<void> {
  const res = await fetch(`https://api.resend.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ResendError(path, res.status, await res.text());
}

export function sendEmail(apiKey: string, payload: EmailPayload): Promise<void> {
  return resendPost(apiKey, "/emails", payload);
}

/**
 * POST /contacts。必須は email のみ。
 * セグメントは `segments: [{ id }]` の配列で渡す（旧実装の `segment_id` は現行 API に存在しない）。
 * https://resend.com/docs/api-reference/contacts/create-contact
 */
export function createContact(apiKey: string, payload: ContactPayload): Promise<void> {
  return resendPost(apiKey, "/contacts", {
    email: payload.email,
    ...(payload.segmentId ? { segments: [{ id: payload.segmentId }] } : {}),
  });
}
