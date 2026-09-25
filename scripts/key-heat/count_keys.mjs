// かなコーパスを新月配列の打鍵列に変換し、物理キーごとの打鍵回数を集計して src/data/keyHeat.json を書く。
//
//   node scripts/key-heat/count_keys.mjs <corpus.kana.txt>
//
// - 変換表は src/data/romantable.json（配布テーブルと同一）。かな → 打鍵列は「同じかなを出す最短の列」を採る。
// - トークン化は先頭 2 文字までの最長一致（しゃ・じゃ などの 2 かなエントリを優先）。
// - ー は ★p で数える（IME 既定の `-` でも打てるが、英字 3 行の外なので採らない）。
// - 集計はキーの押下回数。☆ ★ ゛ もそれぞれ 1 打として数える。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const corpusPath = process.argv[2];
if (!corpusPath) { console.error("usage: node scripts/key-heat/count_keys.mjs <corpus.kana.txt>"); process.exit(1); }

const roman = JSON.parse(readFileSync(path.join(root, "src/data/romantable.json"), "utf8")).table;
const layout = JSON.parse(readFileSync(path.join(root, "src/data/layout.json"), "utf8"));
const corpus = readFileSync(corpusPath, "utf8");

// かな → 最短の打鍵列
const seqOf = new Map();
for (const [seq, kana] of Object.entries(roman)) {
  if (kana === "ー" && seq === "-") continue; // ー は ★p で数える
  const cur = seqOf.get(kana);
  if (!cur || seq.length < cur.length || (seq.length === cur.length && seq < cur)) seqOf.set(kana, seq);
}

const counts = new Map();
let tokens = 0, presses = 0, skipped = 0;
for (let i = 0; i < corpus.length;) {
  const two = corpus.slice(i, i + 2), one = corpus[i];
  const hit = seqOf.has(two) ? two : seqOf.has(one) ? one : null;
  if (!hit) { skipped += 1; i += 1; continue; }
  for (const k of seqOf.get(hit)) { counts.set(k, (counts.get(k) ?? 0) + 1); presses += 1; }
  tokens += [...hit].length;
  i += hit.length;
}

const physical = layout.layers[0].keys, legend = layout.layers[1].keys;
const keys = [];
for (let r = 0; r < physical.length; r++) for (let c = 0; c < physical[r].length; c++) {
  const id = physical[r][c];
  keys.push({ id, row: r, col: c, kana: legend[r][c], presses: counts.get(id) ?? 0 });
}
const grid = new Set(keys.map((k) => k.id));
const outside = [...counts].filter(([id]) => !grid.has(id)).map(([id, n]) => ({ id, presses: n }));
const total = presses;
for (const k of keys) k.share = k.presses / total;
[...keys].sort((a, b) => b.presses - a.presses).forEach((k, i) => { k.rank = i + 1; });
const homeRow = keys.filter((k) => k.row === 1).reduce((s, k) => s + k.presses, 0) / total;
const shiftKeys = { "☆": counts.get("k") ?? 0, "★": counts.get("d") ?? 0, "゛": counts.get("l") ?? 0 };

const out = {
  generatedAt: new Date().toISOString().slice(0, 10),
  corpus: {
    name: "青空文庫『こころ』『坊っちゃん』（夏目漱石）",
    works: [
      { title: "こころ", url: "https://www.aozora.gr.jp/cards/000148/card773.html" },
      { title: "坊っちゃん", url: "https://www.aozora.gr.jp/cards/000148/card752.html" },
    ],
    kana: tokens,
    conversion: "MeCab（unidic-lite）の仮名素性で読みに変換。ひらがな・ー・、。のみを残す",
    builder: "scripts/key-heat/build_corpus.py",
  },
  method: "src/data/romantable.json のかな → 最短打鍵列。先頭 2 文字までの最長一致。ー は ★p。☆★゛ も 1 打",
  counter: "scripts/key-heat/count_keys.mjs",
  tokens, presses: total, pressesPerKana: total / tokens, skippedChars: skipped,
  homeRowShare: homeRow,
  shiftShare: Object.fromEntries(Object.entries(shiftKeys).map(([k, n]) => [k, n / total])),
  outsideGrid: outside,
  keys,
};
const dest = path.join(root, "src/data/keyHeat.json");
writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
console.log(`kana ${tokens} / presses ${total} / presses per kana ${(total / tokens).toFixed(3)} / home row ${(homeRow * 100).toFixed(1)}% / skipped ${skipped}`);
console.log("top 8:", [...keys].sort((a, b) => a.rank - b.rank).slice(0, 8).map((k) => `${k.kana || k.id}(${k.id}) ${(k.share * 100).toFixed(1)}%`).join("  "));
console.log("outside grid:", outside);
console.log(`wrote ${dest}`);
