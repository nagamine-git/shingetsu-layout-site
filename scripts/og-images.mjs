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

/** 記事タイトルの文字サイズ。640px 幅・行送り 1.32 で、概要とタグを含めて脚部に届かない高さ (220px) に収める */
function titleSize(title) {
  const length = [...title].length;
  const band = length <= 10 ? 84 : length <= 16 ? 72 : 62;
  for (let size = band; size > 40; size -= 2) {
    const lines = Math.ceil((length * size * 1.05) / 640);
    if (lines * size * 1.32 <= 220) return size;
  }
  return 40;
}

function page({ eyebrow, title, titleSize: size, subtitle, description, tags = [], brand = true, hero = false }) {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8" />
<style>
@font-face { font-family: "Shingetsu Mincho"; src: ${mincho}; font-weight: 500; }
@font-face { font-family: "Noto Sans JP"; src: ${sans}; font-weight: 100 900; }
* { box-sizing: border-box; }
html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
body { position: relative; background: #090a0c; color: #f1ede5; font-family: "Noto Sans JP", sans-serif; font-feature-settings: "palt"; }
.ground { position: absolute; inset: 0; background: radial-gradient(ellipse 70% 90% at 82% 46%, #26303d80, transparent 60%), radial-gradient(ellipse at 10% 110%, #15181c, transparent 55%), linear-gradient(180deg, #0b0c0f, #08090b); }
.mist { position: absolute; width: 1500px; height: 1000px; left: 400px; top: -200px; opacity: .38; }
.mist.back { left: 260px; top: -80px; opacity: .16; transform: scaleX(-1); }
.sky { position: absolute; right: -120px; top: 48%; width: 540px; height: 540px; margin-top: -270px; }
.corona { position: absolute; inset: -190px; border-radius: 50%; background: conic-gradient(from 0deg, #d9e3f000 0deg, #d9e3f03a 7deg, #d9e3f000 14deg, #d9e3f000 33deg, #d9e3f052 41deg, #d9e3f000 49deg, #d9e3f000 78deg, #d9e3f030 86deg, #d9e3f000 95deg, #d9e3f000 122deg, #d9e3f048 131deg, #d9e3f000 141deg, #d9e3f000 168deg, #d9e3f02c 176deg, #d9e3f000 185deg, #d9e3f000 212deg, #d9e3f044 221deg, #d9e3f000 231deg, #d9e3f000 256deg, #d9e3f036 264deg, #d9e3f000 273deg, #d9e3f000 300deg, #d9e3f04c 309deg, #d9e3f000 319deg, #d9e3f000 345deg, #d9e3f030 352deg, #d9e3f000 360deg); mask: radial-gradient(circle, transparent 35%, #000 38%, #000 46%, transparent 68%); -webkit-mask: radial-gradient(circle, transparent 35%, #000 38%, #000 46%, transparent 68%); filter: blur(14px); }
.halo { position: absolute; inset: -110px; border-radius: 50%; background: radial-gradient(circle, transparent 41%, #e2e8f19c 42.5%, #cfdaea55 48%, #aabdd826 58%, transparent 70%); filter: blur(10px); }
.moon { position: absolute; inset: 0; border-radius: 50%; background: #000; box-shadow: 0 0 0 1.5px #f2f5fa, 0 0 18px 3px #edf2fae0, 0 0 60px 16px #d3deee7a, 0 0 160px 50px #a9bfda33; }
.grain { position: absolute; inset: 0; opacity: .07; mix-blend-mode: screen; }
.copy { position: absolute; left: 88px; top: 84px; width: 640px; }
.eyebrow { display: flex; align-items: center; gap: 14px; margin: 0 0 ${hero ? 44 : 32}px; font-size: 14px; font-weight: 500; letter-spacing: .28em; color: #b3ada2; }
.eyebrow i { width: 6px; height: 6px; border-radius: 50%; background: #d7c29f; box-shadow: 0 0 14px #d7c29f90; }
.title { margin: 0; font-family: "Shingetsu Mincho", serif; font-weight: 500; font-size: ${size}px; line-height: 1.32; letter-spacing: .02em; text-wrap: balance; word-break: auto-phrase; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; text-shadow: 0 2px 30px #0009; }
.title.hero { font-size: 150px; line-height: 1; letter-spacing: .06em; }
.caption { margin: 14px 0 0 4px; font-size: 15px; letter-spacing: .34em; color: #aaa69f; }
.subtitle { margin: ${hero ? 40 : 28}px 0 0; font-family: "Shingetsu Mincho", serif; font-size: ${hero ? 34 : 24}px; line-height: 1.7; letter-spacing: .08em; color: #c9c6bf; text-wrap: balance; }
.subtitle strong { color: #f1ede5; font-weight: 500; }
.description { margin: 26px 0 0; width: 600px; font-size: 17px; line-height: 1.95; letter-spacing: .03em; color: #aeaba5; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; word-break: auto-phrase; }
.tags { display: flex; gap: 10px; margin-top: 26px; width: 640px; overflow: hidden; white-space: nowrap; }
.tags span { font-size: 13px; letter-spacing: .08em; color: #a3c8e1; padding: 6px 12px; border: 1px solid #658dab55; border-radius: 999px; background: #658dab14; }
.foot { position: absolute; left: 88px; width: 620px; bottom: 60px; display: flex; align-items: center; justify-content: space-between; border-top: 1px solid #e7ddcd29; padding-top: 26px; }
.brand { display: flex; align-items: center; gap: 16px; font-family: "Shingetsu Mincho", serif; font-size: 24px; letter-spacing: .18em; }
.brand svg { width: 30px; height: 30px; }
.brand small { display: block; font-family: "Noto Sans JP", sans-serif; font-size: 9px; letter-spacing: .22em; color: #aaa69f; margin-top: 2px; }
.url { font-size: 14px; letter-spacing: .2em; color: #9c978d; }
.keys { display: flex; gap: 5px; align-items: center; }
.keys i { display: block; width: 14px; height: 14px; border: 1px solid #b7c9d060; border-bottom-width: 2px; border-radius: 2px; background: #1b2026; }
.keys i.home { background: #233647; border-color: #6386a1; }
</style></head><body>
<div class="ground"></div>
<svg class="mist back" viewBox="0 0 1400 900" xmlns="http://www.w3.org/2000/svg"><use href="#cloud"/></svg>
<svg class="mist" viewBox="0 0 1400 900" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="c" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".0038 .0085" numOctaves="4" seed="24" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .64  0 0 0 0 .67  0 0 0 0 .71  1.7 0 0 0 -.42"/></filter>
    <radialGradient id="f" cx="55%" cy="50%"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <mask id="m"><rect width="1400" height="900" fill="url(#f)"/></mask>
    <g id="cloud"><rect width="1400" height="900" filter="url(#c)" mask="url(#m)"/></g>
  </defs>
  <use href="#cloud"/>
</svg>
<div class="sky"><div class="corona"></div><div class="halo"></div><div class="moon"></div></div>
<svg class="grain" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg"><filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="17" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="1200" height="630" filter="url(#g)"/></svg>
<div class="copy">
  <p class="eyebrow"><i></i>${escape(eyebrow)}</p>
  <h1 class="title${hero ? " hero" : ""}">${nowrapLatin(escape(title))}</h1>
  ${hero ? '<p class="caption">SHINGETSU LAYOUT</p>' : ""}
  ${subtitle ? `<p class="subtitle">${subtitle}</p>` : ""}
  ${description ? `<p class="description">${escape(description)}</p>` : ""}
  ${tags.length ? `<div class="tags">${tags.slice(0, 4).map((tag) => `<span>#${escape(tag)}</span>`).join("")}</div>` : ""}
</div>
${
  brand
    ? `<div class="foot">
  <div class="brand"><svg viewBox="0 0 640 640"><mask id="k"><circle cx="320" cy="320" r="300" fill="#fff"/><circle cx="275" cy="289" r="246" fill="#000"/></mask><circle cx="320" cy="320" r="300" fill="#090a0c"/><circle cx="320" cy="320" r="300" fill="#ece7dd" mask="url(#k)"/></svg><span>新月配列<small>SHINGETSU LAYOUT</small></span></div>
  <div class="url">shingetsu-layout.com</div>
</div>`
    : `<div class="foot"><div class="keys"><i></i><i></i><i class="home"></i><i class="home"></i><i class="home"></i><i class="home"></i><i></i><i></i><i></i><i></i><span class="url" style="margin-left:14px">30 KEYS / 3 LAYERS</span></div><div class="url">shingetsu-layout.com</div></div>`
}
<script>
  // 文節改行の結果に応じて、本文ブロックが脚部 (y=500) に届くまで見出しを縮める
  document.fonts.ready.then(() => {
    const copy = document.querySelector(".copy");
    const title = document.querySelector(".title");
    let size = parseFloat(getComputedStyle(title).fontSize);
    while (copy.getBoundingClientRect().bottom > 500 && size > 40) {
      size -= 2;
      title.style.fontSize = size + "px";
    }
  });
</script>
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
      subtitle: "いつものキーボードで<br />ローマ字の <strong>1.7 倍</strong>の効率を",
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
      description: data.description,
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
