// OGP 画像ジェネレーター
//
// 使い方: pnpm og:build
// 出力: public/og/*.png (1200x630)
//
// サイトと同じフォント・配色・月のモチーフで、トップ / 練習室 / ブログ一覧 / 各記事の
// OGP 画像を静的に生成し、リポジトリにコミットする方針。ビルド時に外部依存を増やさない。
// レンダリングにはローカルの Chromium (headless) を使う。
// 記事を追加・改題したら再実行すること。

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public/og");
const work = path.join(tmpdir(), "shingetsu-og");
const browser =
  process.env.OG_BROWSER ??
  ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"].find((name) => {
    try {
      execFileSync("which", [name], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  });
if (!browser) {
  console.error("Chromium が見つかりません。OG_BROWSER=<path> で指定してください。");
  process.exit(1);
}

const font = (file) =>
  `url(data:font/woff2;base64,${readFileSync(path.join(root, "public/fonts", file)).toString("base64")}) format("woff2")`;
const mincho = font("shippori-mincho-medium.woff2");
const sans = font("noto-sans-jp.woff2");

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** 記事 frontmatter の最小パーサー（title / description / publishedAt / tags / draft のみ） */
function frontmatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const data = {};
  if (!match) return data;
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^(\w+):\s*(.*)$/);
    if (!pair) continue;
    const [, key, raw] = pair;
    let value = raw.trim();
    if (value.startsWith("[") || value.startsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.replace(/^"|"$/g, "");
      }
    } else if (value === "true" || value === "false") value = value === "true";
    data[key] = value;
  }
  return data;
}

/** 英数字とハイフンの連なり（2-263 など）は途中で折り返さない */
const nowrapLatin = (html) =>
  html.replace(/[A-Za-z0-9][A-Za-z0-9.\-]*[A-Za-z0-9]/g, (token) =>
    token.includes("-") ? `<span style="white-space:nowrap">${token}</span>` : token,
  );

function titleSize(title) {
  const length = [...title].length;
  const band = length <= 10 ? 84 : length <= 16 ? 72 : length <= 26 ? 62 : 54;
  // 640px 幅で 3 行以内に収まる上限（全角換算）
  return Math.max(40, Math.min(band, Math.floor(1900 / length)));
}

function page({ eyebrow, title, titleSize: size, subtitle, tags = [], brand = true, hero = false }) {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8" />
<style>
@font-face { font-family: "Shingetsu Mincho"; src: ${mincho}; font-weight: 500; }
@font-face { font-family: "Noto Sans JP"; src: ${sans}; font-weight: 100 900; }
* { box-sizing: border-box; }
html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
body { position: relative; background: #090a0c; color: #f1ede5; font-family: "Noto Sans JP", sans-serif; font-feature-settings: "palt"; }
.ground { position: absolute; inset: 0; background: radial-gradient(ellipse at 84% 44%, #222a3466, transparent 52%), radial-gradient(ellipse at 20% 110%, #16191d, transparent 50%); }
.clouds { position: absolute; width: 1400px; height: 900px; left: 300px; top: -140px; opacity: .3; }
.moon { position: absolute; right: -120px; top: 48%; width: 540px; height: 540px; margin-top: -270px; border-radius: 50%; background: #000; box-shadow: 0 0 0 1.5px #eef2f8, 0 0 22px 4px #e8eef8cc, 0 0 70px 20px #cfdbec66, 0 0 190px 60px #a9bfda33; }
.moon::after { content: ""; position: absolute; inset: -1.5px; border-radius: 50%; background: radial-gradient(circle at 24% 18%, #ffffffb3, transparent 24%); opacity: .55; mask: radial-gradient(circle, transparent 98.4%, #000 98.8%); -webkit-mask: radial-gradient(circle, transparent 98.4%, #000 98.8%); }
.copy { position: absolute; left: 88px; top: 84px; width: 640px; }
.eyebrow { display: flex; align-items: center; gap: 14px; margin: 0 0 ${hero ? 44 : 34}px; font-size: 14px; font-weight: 500; letter-spacing: .28em; color: #b3ada2; }
.eyebrow i { width: 6px; height: 6px; border-radius: 50%; background: #d7c29f; box-shadow: 0 0 14px #d7c29f90; }
.title { margin: 0; font-family: "Shingetsu Mincho", serif; font-weight: 500; font-size: ${size}px; line-height: 1.32; letter-spacing: .02em; text-wrap: balance; word-break: auto-phrase; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; }
.title.hero { font-size: 150px; line-height: 1; letter-spacing: .06em; }
.caption { margin: 14px 0 0 4px; font-size: 15px; letter-spacing: .34em; color: #aaa69f; }
.subtitle { margin: ${hero ? 40 : 28}px 0 0; font-family: "Shingetsu Mincho", serif; font-size: ${hero ? 34 : 24}px; line-height: 1.7; letter-spacing: .08em; color: #c9c6bf; text-wrap: balance; }
.subtitle strong { color: #f1ede5; font-weight: 500; }
.tags { position: absolute; left: 88px; bottom: 160px; display: flex; gap: 10px; flex-wrap: wrap; width: 640px; }
.tags span { font-size: 13px; letter-spacing: .08em; color: #a3c8e1; padding: 6px 12px; border: 1px solid #658dab55; border-radius: 999px; background: #658dab14; }
.foot { position: absolute; left: 88px; width: 620px; bottom: 60px; display: flex; align-items: center; justify-content: space-between; border-top: 1px solid #e7ddcd29; padding-top: 26px; }
.brand { display: flex; align-items: center; gap: 16px; font-family: "Shingetsu Mincho", serif; font-size: 24px; letter-spacing: .18em; }
.brand svg { width: 30px; height: 30px; }
.brand small { display: block; font-family: "Noto Sans JP", sans-serif; font-size: 9px; letter-spacing: .22em; color: #aaa69f; margin-top: 2px; }
.url { font-size: 14px; letter-spacing: .2em; color: #9c978d; }
</style></head><body>
<div class="ground"></div>
<svg class="clouds" viewBox="0 0 1400 900" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="c" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".0045 .009" numOctaves="3" seed="24" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .62  0 0 0 0 .64  0 0 0 0 .67  1.5 0 0 0 -.35"/></filter>
    <radialGradient id="f"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#fff" stop-opacity=".8"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <mask id="m"><rect width="1400" height="900" fill="url(#f)"/></mask>
  </defs>
  <rect width="1400" height="900" filter="url(#c)" mask="url(#m)"/>
</svg>
<div class="moon"></div>
<div class="copy">
  <p class="eyebrow"><i></i>${escape(eyebrow)}</p>
  <h1 class="title${hero ? " hero" : ""}">${nowrapLatin(escape(title))}</h1>
  ${hero ? '<p class="caption">SHINGETSU LAYOUT</p>' : ""}
  ${subtitle ? `<p class="subtitle">${subtitle}</p>` : ""}
</div>
${tags.length ? `<div class="tags">${tags.slice(0, 5).map((tag) => `<span>#${escape(tag)}</span>`).join("")}</div>` : ""}
${
  brand
    ? `<div class="foot">
  <div class="brand"><svg viewBox="0 0 640 640"><mask id="k"><circle cx="320" cy="320" r="300" fill="#fff"/><circle cx="275" cy="289" r="246" fill="#000"/></mask><circle cx="320" cy="320" r="300" fill="#090a0c"/><circle cx="320" cy="320" r="300" fill="#ece7dd" mask="url(#k)"/></svg><span>新月配列<small>SHINGETSU LAYOUT</small></span></div>
  <div class="url">shingetsu-layout.com</div>
</div>`
    : `<div class="foot"><div class="url">30 KEYS / 3 LAYERS</div><div class="url">shingetsu-layout.com</div></div>`
}
</body></html>`;
}

const jobs = [
  {
    file: "home.png",
    html: page({
      eyebrow: "日本語 かな配列",
      title: "新月配列",
      hero: true,
      brand: false,
      subtitle: "最小かつ<strong>最高効率</strong>の<br />PCキーボード用かな配列",
    }),
  },
  {
    file: "practice.png",
    html: page({
      eyebrow: "PRACTICE ROOM",
      title: "新月タイピング",
      titleSize: 84,
      subtitle: "習得から高速化まで、<br />新月配列の練習室",
    }),
  },
  {
    file: "blog.png",
    html: page({
      eyebrow: "BLOG",
      title: "読みもの",
      titleSize: 84,
      subtitle: "新月配列の設計・比較・習得についての<br />技術記事とベンチマーク",
    }),
  },
];

const blogDir = path.join(root, "src/content/blog");
for (const entry of readdirSync(blogDir)) {
  if (!entry.endsWith(".md")) continue;
  const data = frontmatter(readFileSync(path.join(blogDir, entry), "utf8"));
  if (data.draft || !data.title) continue;
  const date = data.publishedAt ? String(data.publishedAt).replaceAll("-", ".") : "";
  jobs.push({
    file: `blog/${entry.replace(/\.md$/, "")}.png`,
    html: page({
      eyebrow: `読みもの${date ? ` — ${date}` : ""}`,
      title: data.title,
      titleSize: titleSize(data.title),
      tags: Array.isArray(data.tags) ? data.tags : [],
    }),
  });
}

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
mkdirSync(path.join(outDir, "blog"), { recursive: true });

for (const job of jobs) {
  const source = path.join(work, job.file.replace(/[\\/]/g, "_") + ".html");
  const target = path.join(outDir, job.file);
  writeFileSync(source, job.html);
  execFileSync(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--window-size=1200,630",
      "--virtual-time-budget=3000",
      `--screenshot=${target}`,
      `file://${source}`,
    ],
    { stdio: "ignore" },
  );
  if (!existsSync(target)) throw new Error(`生成失敗: ${job.file}`);
  console.log(`✓ og/${job.file}`);
}
rmSync(work, { recursive: true, force: true });
