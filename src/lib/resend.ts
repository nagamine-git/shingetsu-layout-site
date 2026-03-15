interface EmailPayload {
  from: string;
  to: string | string[];
  replyTo?: string;
  subject: string;
  html: string;
}

interface ContactPayload {
  email: string;
  segmentId: string;
  properties: Record<string, string>;
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
  if (!res.ok) {
    throw new Error(`Resend API error (${path}): ${res.status} ${await res.text()}`);
  }
}

export function sendEmail(apiKey: string, payload: EmailPayload): Promise<void> {
  return resendPost(apiKey, "/emails", payload);
}

export function createContact(apiKey: string, payload: ContactPayload): Promise<void> {
  return resendPost(apiKey, "/contacts", {
    email: payload.email,
    segment_id: payload.segmentId,
    properties: payload.properties,
  });
}
