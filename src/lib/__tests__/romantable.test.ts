import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import layoutData from "../../data/layout.json";
import romanData from "../../data/romantable.json";
import { kanaSequences } from "../practice";
import { encodings, keyLegend, tokenize } from "../training";

// fixtures/ は配布リポジトリ nagamine-git/shingetsu-layout の v2.0.0（新月配列 v9.0, fbdd1f8）のファイルの写し。
// 配布側を更新したら写しも更新する（兄弟ディレクトリに配布リポジトリがあれば、下の「写しが一致」のテストが差を知らせる）。
const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const rows = (text: string): string[][] => text.split("\n").filter(Boolean).map((line): string[] => line.split("\t"));

const aliasKeys = ["-", "kk", "dd"];
const completionKeys = [";k", "ck", "ek", "pk", "kwk", "rlk", "d;lk", "rli"];

/** hazkey 用 TSV の規則を「物理キー列 → 出力」にそろえる。☆=k ★=d ゛=l。かなを含む入力（かl など）は、そのかなの最短の列に置き換える */
function tsvRules(tsv: string): Map<string, string> {
  const virtual: Record<string, string> = { "☆": "k", "★": "d", "゛": "l" };
  // 全角記号の行は ; , / の別名なので数えない
  const entries = rows(tsv).map((cells): [string, string] => [cells[0], cells[cells.length - 1]]).filter(([input]): boolean => !/[；、・]/.test(input));
  const keysOf = new Map<string, string>();
  for (const [input, output] of entries) if (input.length === 1 && /^[\x21-\x7e]$/.test(input) && !(output in virtual)) keysOf.set(output, input);
  for (const [glyph, key] of Object.entries(virtual)) keysOf.set(glyph, key);
  const rules = new Map<string, string>();
  for (let changed = true; changed;) {
    changed = false;
    for (const [input, output] of entries) {
      const parts = Array.from(input).map((char): string | undefined => (/^[\x21-\x7e]$/.test(char) ? char : keysOf.get(char)));
      if (parts.includes(undefined)) continue;
      const keys = parts.join("");
      if (rules.get(keys) !== output) { rules.set(keys, output); changed = true; }
      const known = keysOf.get(output);
      if (!(output in virtual) && (known === undefined || keys.length < known.length)) { keysOf.set(output, keys); changed = true; }
    }
  }
  // 別名の行は「どの列の規則か」を持たない。最短の列を決める材料から外す
  for (const key of [...aliasKeys, "d", "k"]) rules.delete(key);
  return rules;
}

/** 規則（物理キー列 → 出力）を連結して target を作る、最短の物理キー列をすべて返す。作れなければ空 */
function shortestSequences(rules: ReadonlyMap<string, string>, target: string): string[] {
  const memo = new Map<number, string[]>();
  const solve = (position: number): string[] => {
    if (position === target.length) return [""];
    const saved = memo.get(position);
    if (saved) return saved;
    let best: string[] = [];
    let length = Infinity;
    for (const [keys, output] of rules) {
      if (!target.startsWith(output, position)) continue;
      for (const rest of solve(position + output.length)) {
        const candidate = keys + rest;
        if (candidate.length < length) { length = candidate.length; best = [candidate]; }
        else if (candidate.length === length && !best.includes(candidate)) best.push(candidate);
      }
    }
    memo.set(position, best);
    return best;
  };
  return solve(0);
}

describe("romantable.json (配布 v2.0.0 / 新月配列 v9.0)", () => {
  const distributed = rows(fixture("shingetsu-romantable.txt"));
  const { table, aliases, completions } = romanData as unknown as {
    table: Record<string, string>;
    aliases: Record<string, string>;
    completions: Record<string, { kana: string; next?: string }>;
  };

  it("carries all 144 rows of the distributed table, split by what each row is for", () => {
    expect(distributed).toHaveLength(144);
    const fromJson = [
      ...Object.entries(table).map(([input, output]): string[] => [input, output]),
      ...Object.entries(aliases).map(([input, output]): string[] => [input, output]),
      ...Object.entries(completions).map(([input, { kana, next }]): string[] => (next ? [input, kana, next] : [input, kana])),
    ];
    expect(fromJson).toHaveLength(144);
    const sorted = (list: string[][]): string[] => list.map((cells): string => cells.join("\t")).sort();
    expect(sorted(fromJson)).toEqual(sorted(distributed));
  });

  it("keeps the extra rules (-, kk, dd) and the IME completion rows out of the typing table", () => {
    expect(Object.keys(aliases).sort()).toEqual([...aliasKeys].sort());
    expect(Object.keys(completions).sort()).toEqual([...completionKeys].sort());
    // 3 列目（次の入力）を持つのは 7 行。rli は でぃ（rlil）の途中で止まらないための で＋い
    expect(Object.values(completions).filter((row): boolean => row.next !== undefined)).toHaveLength(7);
    for (const key of [...aliasKeys, ...completionKeys]) expect(table, key).not.toHaveProperty(key);
  });

  it("types every kana with the shortest sequence the distributed hazkey TSV defines", () => {
    const rules = tsvRules(fixture("shingetsu-ansi-qwerty.tsv"));
    // TSV の規則はすべて配布テーブルの本体の行にある（☆★ の前置キーの行を除く）
    for (const [keys, output] of rules) expect(table[keys], keys).toBe(output);
    const kana = [...new Set(Object.values(table))].filter((unit): boolean => unit !== "゜"); // ゜ 単独は TSV に行がない（ば＋゛ → ぱ の規則で打つ）
    expect(kana.length).toBeGreaterThan(120);
    for (const unit of kana) {
      const expected = shortestSequences(rules, unit);
      expect(expected.length, unit).toBeGreaterThan(0);
      expect(expected, unit).toContain(encodings(unit)[0]);
      if (Array.from(unit).length === 1) expect(expected, unit).toContain(kanaSequences.get(unit));
    }
  });

  it("does not let the extra rules or the completion rows change a shortest sequence", () => {
    // ー は ★p、も は ★k、ら は ☆d。- kk dd は同じ長さ以下だが、配列の列ではないので選ばれない
    expect(kanaSequences.get("ー")).toBe("dp");
    expect(kanaSequences.get("も")).toBe("dk");
    expect(kanaSequences.get("ら")).toBe("kd");
    expect(encodings("ら")[0]).toBe("kd");
    expect(encodings("も")).toEqual(["dk"]);
    // 補完行は「き＋次の入力 k」のような途中経過で、かな 1 単位の打ち方ではない
    expect(encodings("き")).toEqual([";"]);
    expect(tokenize("でい").map((token): string => token.text)).toEqual(["で", "い"]);
    const used = new Set(Array.from(new Set(Object.values(table))).flatMap((unit): string[] => encodings(unit)));
    for (const key of [...aliasKeys, ...completionKeys]) expect(used.has(key), key).toBe(false);
    // 長音の - は、これまでどおり 2 番目以降の経路として受け付ける
    expect(tokenize("ー")[0].paths).toEqual(["dp", "-"]);
  });

  it("types the ☆゛ shortcuts as 上から ょ・ゅ・ゃ in every column", () => {
    const columns: Record<string, string[]> = {
      ぴ: ["q", "a", "z"], び: ["w", "s", "x"], じ: ["e", "d", "c"], ぎ: ["r", "f", "v"],
      み: ["i", "k", ","], ち: ["p", ";", "/"],
    };
    for (const [base, keys] of Object.entries(columns)) {
      for (const [index, small] of ["ょ", "ゅ", "ゃ"].entries()) {
        const kana = base + small;
        expect(table[`kl${keys[index]}`], kana).toBe(kana);
        expect(encodings(kana)).toContain(`kl${keys[index]}`);
        expect(keyLegend("kl", keys[index]), kana).toBe(kana);
      }
    }
    // 人差し指の内側の列（t g b・y h n）と l には ☆゛ の短縮がない
    for (const key of ["t", "g", "b", "y", "h", "n", "l", "j", "u", "m", "o", "."]) {
      expect(table[`kl${key}`], key).toBeUndefined();
      expect(keyLegend("kl", key), key).toBe("·");
    }
  });

  it("draws every layer of layout.json from the table (Layer 3 is the v9.0 ☆゛ legend)", () => {
    const physical = layoutData.layers[0].keys;
    const legend = (id: number): string[][] => layoutData.layers[id].keys;
    for (const [row, keys] of physical.entries()) {
      for (const [column, key] of keys.entries()) {
        const one = legend(1)[row][column];
        if (one !== "★" && one !== "☆") expect(table[key], `Layer 1 ${key}`).toBe(one);
        const two = legend(2)[row][column];
        const shifted = [table[`k${key}`], table[`d${key}`]].filter((kana): boolean => kana !== undefined);
        if (two) expect(shifted, `Layer 2 ${key}`).toContain(two);
        else expect(shifted, `Layer 2 ${key}`).toEqual([]);
        const three = legend(3)[row][column];
        expect(table[`kl${key}`], `Layer 3 ${key}`).toBe(three || undefined);
      }
    }
    expect(legend(3).flat().filter(Boolean)).toHaveLength(18);
  });

  it("types でぃ・でゅ・ぢゃ as で＋ぃ・で＋ゅ・ぢ＋ゃ and has no ; on ☆゛l", () => {
    expect(encodings("でぃ")).toEqual(["rlil"]);
    expect(encodings("でゅ")[0]).toBe("rlkv");
    expect(encodings("ぢゃ")[0]).toBe("d;lkb");
    expect(Object.values(table)).not.toContain(";");
    expect(table["kll"]).toBeUndefined();
  });

  const sibling = new URL("../../../../shingetsu-layout/", import.meta.url);
  it.skipIf(!existsSync(new URL("shingetsu-romantable.txt", sibling)))("matches the fixtures to the sibling shingetsu-layout checkout", () => {
    for (const name of ["shingetsu-romantable.txt", "shingetsu-ansi-qwerty.tsv"]) {
      expect(fixture(name), name).toBe(readFileSync(new URL(name, sibling), "utf8"));
    }
  });
});
