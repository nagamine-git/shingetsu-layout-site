export const prerender = false;

import type { APIRoute } from "astro";
import { jsonRes } from "../../lib/api";
import { loadCloudflareEnv } from "../../lib/cloudflareEnv";
import { counterReply, getCounterDb } from "../../lib/visitorCounter";

// 加算せずに累計だけ返す。COUNTER_DB が未設定なら { count: null }
export const GET: APIRoute = async () => {
  const { status, body, cacheControl } = await counterReply("count", getCounterDb(await loadCloudflareEnv()));
  return jsonRes(body, status, { "content-type": "application/json", "cache-control": cacheControl });
};
