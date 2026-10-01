export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function jsonRes(body: Record<string, unknown>, status: number, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers });
}
