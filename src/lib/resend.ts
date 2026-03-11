interface EmailPayload {
  from: string;
  to: string | string[];
  replyTo?: string;
  subject: string;
  html: string;
}

export async function sendEmail(apiKey: string, payload: EmailPayload): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Resend API error: ${res.status} ${error}`);
  }
}

interface ContactPayload {
  email: string;
  segmentId: string;
  properties: Record<string, string>;
}

export async function createContact(apiKey: string, payload: ContactPayload): Promise<void> {
  const res = await fetch("https://api.resend.com/contacts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: payload.email,
      segment_id: payload.segmentId,
      properties: payload.properties,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Resend contacts API error: ${res.status} ${error}`);
  }
}
