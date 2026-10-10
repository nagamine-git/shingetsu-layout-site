export const prerender = false;

import type { APIRoute } from "astro";
import { loadCloudflareEnv } from "../../lib/cloudflareEnv";
import { getCounterDb } from "../../lib/visitorCounter";
import { usageReply } from "../../lib/usageCounter";

const handle: APIRoute = async ({ request }) => usageReply(request, getCounterDb(await loadCloudflareEnv()));
export const GET = handle;
export const POST = handle;
