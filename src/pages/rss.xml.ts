import { statSync } from "node:fs";
import path from "node:path";
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";

// 読みもの RSS 2.0。依存を増やさず手書きで生成する（Base.astro の <link rel="alternate"> から参照）。
const site = "https://shingetsu-layout.com";

const escape = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

export const GET: APIRoute = async () => {
  const posts = (await getCollection("blog", ({ data }) => !data.draft)).sort(
    (a, b) => b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf(),
  );
  const latest = posts[0]?.data.updatedAt ?? posts[0]?.data.publishedAt ?? new Date();
  const items = posts
    .map((post) => {
      const url = `${site}/blog/${post.id}/`;
      let enclosure = "";
      try {
        const size = statSync(path.join(process.cwd(), "public/og/blog", `${post.id}.png`)).size;
        enclosure = `\n      <enclosure url="${site}/og/blog/${post.id}.png" type="image/png" length="${size}" />`;
      } catch {
        // OGP 画像が未生成なら enclosure を省く
      }
      return `    <item>
      <title>${escape(post.data.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${post.data.publishedAt.toUTCString()}</pubDate>
      <description>${escape(post.data.description)}</description>
${post.data.tags.map((tag) => `      <category>${escape(tag)}</category>`).join("\n")}${enclosure}
    </item>`;
    })
    .join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>新月配列 読みもの</title>
    <link>${site}/blog/</link>
    <atom:link href="${site}/rss.xml" rel="self" type="application/rss+xml" />
    <description>新月配列の設計・比較・習得についての技術記事とベンチマーク</description>
    <language>ja</language>
    <lastBuildDate>${latest.toUTCString()}</lastBuildDate>
    <image>
      <url>${site}/icons/icon-512.png</url>
      <title>新月配列 読みもの</title>
      <link>${site}/blog/</link>
    </image>
${items}
  </channel>
</rss>
`;
  return new Response(body, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
};
