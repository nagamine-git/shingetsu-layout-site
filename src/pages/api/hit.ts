export const prerender = false;

import type { APIRoute } from "astro";
import { jsonRes } from "../../lib/api";
import { loadCloudflareEnv } from "../../lib/cloudflareEnv";
import { counterReply, getCounterDb } from "../../lib/visitorCounter";

// 訪問を 1 回数えて、累計を返す。COUNTER_DB が未設定なら { count: null }（UI はカウンターごと隠す）
export const POST: APIRoute = async () => {
  const { status, body, cacheControl } = await counterReply("hit", getCounterDb(await loadCloudflareEnv()));
  return jsonRes(body, status, { "content-type": "application/json", "cache-control": cacheControl });
};
