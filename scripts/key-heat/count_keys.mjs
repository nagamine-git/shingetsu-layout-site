// かなコーパスを「新月配列」と「ローマ字入力（QWERTY）」の打鍵列に変換し、物理キーごとの打鍵回数を集計して
// src/data/keyHeat.json を書く。
//
//   node scripts/key-heat/count_keys.mjs <corpus.kana.txt>
//
// 新月配列:
// - 変換表は src/data/romantable.json（配布テーブルと同一）。かな → 打鍵列は「同じかなを出す最短の列」を採る。
// - トークン化は先頭 2 文字までの最長一致（しゃ・じゃ などの 2 かなエントリを優先）。
// - ー は ★p で数える（IME 既定の `-` でも打てるが、英字 3 行の外なので採らない）。
// ローマ字入力（QWERTY）:
// - 各かなに対して Google 日本語入力で有効な最短のローマ字（し=si、じゃ=ja、ふぁ=fa など）。
// - ん は次が母音・や行・な行・文末なら nn、それ以外は n。っ は次の子音を重ねる（次が母音なら xtu）。
// - ー は `-`（数字段）で、英字 3 行の外として別に数える。、。・ は , . /。
// どちらも集計はキーの押下回数。☆ ★ ゛ もそれぞれ 1 打として数える。
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
const physical = layout.layers[0].keys;
const kanaLegend = layout.layers[1].keys;

// ---------- 新月配列: かな → 最短の打鍵列 ----------
const shingetsuSeq = new Map();
for (const [seq, kana] of Object.entries(roman)) {
  if (kana === "ー" && seq === "-") continue; // ー は ★p で数える
  const cur = shingetsuSeq.get(kana);
  if (!cur || seq.length < cur.length || (seq.length === cur.length && seq < cur)) shingetsuSeq.set(kana, seq);
}

// ---------- ローマ字入力: かな → 最短のローマ字 ----------
const ROMAJI = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko", さ: "sa", し: "si", す: "su", せ: "se", そ: "so",
  た: "ta", ち: "ti", つ: "tu", て: "te", と: "to", な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "hu", へ: "he", ほ: "ho", ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo", ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro", わ: "wa", を: "wo",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go", ざ: "za", じ: "zi", ず: "zu", ぜ: "ze", ぞ: "zo",
  だ: "da", ぢ: "di", づ: "du", で: "de", ど: "do", ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po", ゔ: "vu",
  ぁ: "xa", ぃ: "xi", ぅ: "xu", ぇ: "xe", ぉ: "xo", ゃ: "xya", ゅ: "xyu", ょ: "xyo", ゎ: "xwa",
  きゃ: "kya", きゅ: "kyu", きょ: "kyo", しゃ: "sya", しゅ: "syu", しょ: "syo", ちゃ: "tya", ちゅ: "tyu", ちょ: "tyo",
  にゃ: "nya", にゅ: "nyu", にょ: "nyo", ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo", みゃ: "mya", みゅ: "myu", みょ: "myo",
  りゃ: "rya", りゅ: "ryu", りょ: "ryo", ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo", じゃ: "ja", じゅ: "ju", じょ: "jo",
  ぢゃ: "dya", ぢゅ: "dyu", ぢょ: "dyo", びゃ: "bya", びゅ: "byu", びょ: "byo", ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo",
  ふぁ: "fa", ふぃ: "fi", ふぇ: "fe", ふぉ: "fo", ふゅ: "fyu", てぃ: "thi", てゅ: "thu", でぃ: "dhi", でゅ: "dhu",
  うぃ: "wi", うぇ: "we", うぉ: "who", ゔぁ: "va", ゔぃ: "vi", ゔぇ: "ve", ゔぉ: "vo", しぇ: "sye", じぇ: "je", ちぇ: "tye",
  つぁ: "tsa", つぃ: "tsi", つぇ: "tse", つぉ: "tso", とぅ: "twu", どぅ: "dwu", いぇ: "ye",
  ー: "-", "、": ",", "。": ".", "・": "/",
};
const VOWEL_START = /^[aiueo]/;
function romajiTokens(text) {
  const out = [];
  for (let i = 0; i < text.length;) {
    const two = text.slice(i, i + 2), one = text[i];
    let kana = ROMAJI[two] ? two : ROMAJI[one] ? one : null;
    if (!kana && one !== "っ" && one !== "ん") { out.push({ kana: one, seq: null }); i += 1; continue; }
    if (one === "っ" || one === "ん") kana = one;
    out.push({ kana, seq: kana === "っ" || kana === "ん" ? null : ROMAJI[kana] });
    i += kana.length;
  }
  // っ と ん は次のトークンを見て決める
  for (let j = 0; j < out.length; j++) {
    const t = out[j];
    if (t.seq !== null) continue;
    const next = out[j + 1]?.seq ?? "";
    if (t.kana === "っ") t.seq = next && !VOWEL_START.test(next) && /^[a-z]/.test(next) && next[0] !== "n" ? next[0] : "xtu";
    else if (t.kana === "ん") t.seq = !next || VOWEL_START.test(next) || /^[yn]/.test(next) || !/^[a-z]/.test(next) ? "nn" : "n";
    else t.seq = "";
  }
  return out;
}

// ---------- 集計 ----------
function tally(pairs) {
  // pairs: iterable of [kanaLength, seq]
  const counts = new Map(); let tokens = 0, presses = 0, skipped = 0;
  for (const [len, seq] of pairs) {
    if (!seq) { skipped += 1; continue; }
    for (const k of seq) { counts.set(k, (counts.get(k) ?? 0) + 1); presses += 1; }
    tokens += len;
  }
  return { counts, tokens, presses, skipped };
}
function* shingetsuPairs(text) {
  for (let i = 0; i < text.length;) {
    const two = text.slice(i, i + 2), one = text[i];
    const hit = shingetsuSeq.has(two) ? two : shingetsuSeq.has(one) ? one : null;
    if (!hit) { yield [0, ""]; i += 1; continue; }
    yield [[...hit].length, shingetsuSeq.get(hit)];
    i += hit.length;
  }
}
function* qwertyPairs(text) {
  for (const t of romajiTokens(text)) yield [t.seq ? [...t.kana].length : 0, t.seq];
}

function summarize(label, legend, t) {
  const keys = [];
  for (let r = 0; r < physical.length; r++) for (let c = 0; c < physical[r].length; c++) {
    const id = physical[r][c];
    keys.push({ id, row: r, col: c, label: legend(id, r, c), presses: t.counts.get(id) ?? 0 });
  }
  const grid = new Set(keys.map((k) => k.id));
  const outside = [...t.counts].filter(([id]) => !grid.has(id)).map(([id, n]) => ({ id, presses: n, share: n / t.presses }));
  for (const k of keys) k.share = k.presses / t.presses;
  [...keys].sort((a, b) => b.presses - a.presses).forEach((k, i) => { k.rank = i + 1; });
  const ranked = [...keys].sort((a, b) => a.rank - b.rank);
  return {
    label,
    tokens: t.tokens, presses: t.presses, pressesPerKana: t.presses / t.tokens, skippedChars: t.skipped,
    homeRowShare: keys.filter((k) => k.row === 1).reduce((s, k) => s + k.presses, 0) / t.presses,
    top3: ranked.slice(0, 3).map((k) => ({ id: k.id, label: k.label, share: k.share })),
    top3Share: ranked.slice(0, 3).reduce((s, k) => s + k.share, 0),
    outsideGrid: outside,
    keys,
  };
}

const s = summarize("新月配列", (id, r, c) => kanaLegend[r][c], tally(shingetsuPairs(corpus)));
const q = summarize("ローマ字入力（QWERTY）", (id) => (/^[a-z]$/.test(id) ? id.toUpperCase() : id), tally(qwertyPairs(corpus)));
const sharedMaxShare = Math.max(...s.keys.map((k) => k.share), ...q.keys.map((k) => k.share));

const out = {
  generatedAt: new Date().toISOString().slice(0, 10),
  corpus: {
    name: "青空文庫『こころ』『坊っちゃん』（夏目漱石）",
    works: [
      { title: "こころ", url: "https://www.aozora.gr.jp/cards/000148/card773.html" },
      { title: "坊っちゃん", url: "https://www.aozora.gr.jp/cards/000148/card752.html" },
    ],
    kana: s.tokens,
    conversion: "MeCab（unidic-lite）の仮名素性で読みに変換。ひらがな・ー・、。のみを残す",
    builder: "scripts/key-heat/build_corpus.py",
  },
  method: {
    shingetsu: "src/data/romantable.json のかな → 最短打鍵列。先頭 2 文字までの最長一致。ー は ★p。☆★゛ も 1 打",
    qwerty: "各かなに Google 日本語入力で有効な最短のローマ字（し=si、じゃ=ja）。ん は次が母音・や行・な行・文末なら nn、他は n。っ は次の子音を重ねる。ー は - で数字段",
  },
  counter: "scripts/key-heat/count_keys.mjs",
  sharedMaxShare,
  modes: { shingetsu: s, qwerty: q },
};
const dest = path.join(root, "src/data/keyHeat.json");
writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
for (const m of [s, q]) {
  console.log(`${m.label}: kana ${m.tokens} / presses ${m.presses} / per kana ${m.pressesPerKana.toFixed(3)} / home row ${(m.homeRowShare * 100).toFixed(1)}% / top3 ${(m.top3Share * 100).toFixed(1)}% (${m.top3.map((k) => k.label).join(" ")}) / skipped ${m.skippedChars} / outside ${JSON.stringify(m.outsideGrid)}`);
}
console.log(`shared max ${(sharedMaxShare * 100).toFixed(1)}% -> wrote ${dest}`);
