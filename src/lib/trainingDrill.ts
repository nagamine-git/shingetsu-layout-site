// 熟達者向けの「弱点ドリル」「疾走（オーバースピード）」「キー別の速度マップ」の純粋ロジック。
// DOM に触れないので vitest で検証する。UI は trainingClient.ts。
import { trainingCorpus, type Passage } from "../data/trainingCorpus";
import { median, priority, tokenize, type PairSample, type TokenSample, type TrainingMaterial, type TrainingProfile } from "./training";

export type DrillTargetKind = "kana" | "pair";
export interface DrillTarget {
  kind: DrillTargetKind;
  /** かな 1 文字、または QWERTY 物理キー 2 文字（例 "dk"） */
  id: string;
  /** 表示用（かなはそのまま、ペアは "D → K"） */
  label: string;
  /** 選定理由の短文 */
  reason: string;
  /** 選定時点の基準値（かな: ms/打鍵の中央値、ペア: 平均間隔 ms）。0 は未計測 */
  baseline: number;
}
export interface DrillChange { target: DrillTarget; before: number; after: number; samples: number; }

export const drillDuration = 45;
export const sprintDuration = 15;
/** 疾走の目標：同条件の自己ベストに対する上乗せ率 */
export const sprintBoost = 1.08;

export function pairLabel(pair: string): string {
  return Array.from(pair).join(" → ").toUpperCase();
}

/**
 * 直近の記録から「狙う価値のある」弱点を最大 `limit` 件選ぶ。
 * - かな：ヒントなし正答率が低い、または打鍵あたりの遅延が個人の中央値より大きい
 * - 2 打鍵：標本 4 以上で、個人の全ペア中央値の 1.5 倍以上遅い
 * 絶対値ではなく本人の中央値との相対で選ぶので、上級者でも常に「次の一手」が出る。
 */
export function weakTargets(profile: TrainingProfile, method: "keyboard" | "touch", now: number, limit = 6): DrillTarget[] {
  const stats = profile[method];
  const kanaEntries = Object.entries(stats).filter(([kana, skill]): boolean => kana.length === 1 && skill.samples >= 3 && skill.latencies.length >= 3);
  const personalLatency = median(kanaEntries.map(([, skill]): number => median(skill.latencies)));
  const kanaTargets = kanaEntries
    .map(([kana, skill]): DrillTarget & { score: number } => {
      const accuracy = skill.recent.length ? skill.recent.reduce((total, value): number => total + value, 0) / skill.recent.length : 1;
      const latency = median(skill.latencies);
      const slow = personalLatency > 0 ? latency / personalLatency : 1;
      const reason = accuracy < .9 ? `正答率 ${Math.round(accuracy * 100)}%` : slow >= 1.4 ? `自分の中央値の ${slow.toFixed(1)} 倍遅い` : "";
      return { kind: "kana", id: kana, label: kana, reason, baseline: Math.round(latency), score: priority(skill, now) + Math.max(0, slow - 1) * 3 };
    })
    .filter((target): boolean => target.reason !== "");
  const pairEntries = Object.entries(profile.pairs[method]).filter(([, stat]): boolean => stat.samples >= 4);
  const personalPair = median(pairEntries.map(([, stat]): number => stat.milliseconds));
  const pairTargets = pairEntries
    .map(([pair, stat]): DrillTarget & { score: number } => {
      const slow = personalPair > 0 ? stat.milliseconds / personalPair : 1;
      return { kind: "pair", id: pair, label: pairLabel(pair), reason: `平均 ${Math.round(stat.milliseconds)}ms · 中央値の ${slow.toFixed(1)} 倍`, baseline: Math.round(stat.milliseconds), score: Math.max(0, slow - 1) * 4 };
    })
    .filter((target): boolean => target.score >= 2); // 1.5 倍以上
  return [...kanaTargets, ...pairTargets]
    .sort((left, right): number => right.score - left.score)
    .slice(0, limit)
    .map(({ score: _score, ...target }): DrillTarget => target);
}

function containsTarget(passage: Passage, target: DrillTarget): boolean {
  if (target.kind === "kana") return passage.reading.includes(target.id);
  return tokenize(passage.reading).map((token): string => token.paths[0]).join("").includes(target.id);
}

/**
 * 弱点を含む文を高い比率で、得意な文も一定割合（interleave）混ぜて選ぶ。
 * 文脈干渉（Shea & Morgan 1979）の知見に沿い、弱点だけのブロック練習にはしない。
 */
export function selectDrillPassages(profile: TrainingProfile, targets: DrillTarget[], random: () => number = Math.random, interleave = .3, maxChars = 420): Passage[] {
  const pool = trainingCorpus.filter((passage): boolean => passage.stage >= 1);
  const hits = new Map<string, number>(pool.map((passage): [string, number] => [passage.id, targets.filter((target): boolean => containsTarget(passage, target)).length]));
  const selected: Passage[] = [];
  let size = 0;
  while (size < maxChars && selected.length < 30) {
    const choices = pool.filter((passage): boolean => !selected.some((item): boolean => item.id === passage.id));
    if (!choices.length) break;
    // interleave の割合で「得意な文」の番にし、それ以外はターゲットを含む文だけから選ぶ
    const targeted = choices.some((passage): boolean => (hits.get(passage.id) ?? 0) > 0);
    const wantGeneral = !targeted || random() < interleave;
    const weighted = choices.map((passage): { passage: Passage; weight: number } => {
      const count = hits.get(passage.id) ?? 0;
      const weight = wantGeneral ? (count ? .15 : 1) : count;
      return { passage, weight: weight * (profile.recent.includes(passage.id) ? .3 : 1) };
    });
    let needle = Math.max(0, Math.min(.999999, random())) * weighted.reduce((total, item): number => total + item.weight, 0);
    const next = weighted.find((item): boolean => (needle -= item.weight) < 0)?.passage ?? weighted[0].passage;
    selected.push(next);
    size += next.reading.length;
  }
  return selected;
}

/** このセッションで各ターゲットがどう変わったか。after=0 は標本なし */
export function drillChanges(targets: DrillTarget[], samples: TokenSample[], pairs: PairSample[]): DrillChange[] {
  return targets.map((target): DrillChange => {
    if (target.kind === "kana") {
      const hits = samples.filter((sample): boolean => sample.text === target.id && sample.milliseconds > 0 && !sample.hinted && sample.errors === 0);
      return { target, before: target.baseline, after: Math.round(median(hits.map((sample): number => sample.milliseconds / sample.strokes))), samples: hits.length };
    }
    const hits = pairs.filter((sample): boolean => sample.pair === target.id);
    return { target, before: target.baseline, after: Math.round(median(hits.map((sample): number => sample.milliseconds))), samples: hits.length };
  });
}

/** 疾走の目標速度。高速化モードの比較可能な自己ベスト（秒数は問わない）× boost。記録がなければ 0 */
export function sprintTarget(profile: TrainingProfile, method: "keyboard" | "touch", material: TrainingMaterial, boost = sprintBoost): number {
  const best = Math.max(0, ...profile.results
    .filter((result): boolean => result.mode === "speed" && result.method === method && result.material === material && Number(result.signature.split(":")[2]) !== sprintDuration)
    .filter((result): boolean => !result.interrupted && !result.assisted && result.accuracy >= 95 && result.duration >= 15 && result.kana >= 10)
    .map((result): number => result.cpm));
  return best ? Math.round(best * boost) : 0;
}

/**
 * 疾走の結果に対する助言。速度上限を押し上げた後は、正確さを保つ通常時間の練習へ戻す。
 */
export function sprintAdvice(cpm: number, accuracy: number, target: number): { title: string; body: string } {
  if (!target) return { title: "まず基準をつくる。", body: "疾走の目標は、高速化モード（30・60・120秒）の自己ベストから作ります。先にそちらで比較可能な記録を残してください。" };
  if (accuracy < 90) return { title: "速すぎた。目標を少し下げる。", body: `正確率 ${accuracy.toFixed(1)}%。ミスの修正で速度も落ちます。目標の 9 割程度の速さで、正確率 95% を保てる上限を探しましょう。` };
  if (cpm >= target) return { title: "上限を押し上げた。次は定着へ。", body: `目標 ${target} かな/分を超えました。この速さを 60 秒・正確率 97% 以上で保てるかを高速化モードで確かめると、いつもの速度になります。` };
  return { title: "あと少し。同じ目標でもう一本。", body: `目標 ${target} かな/分に対して ${Math.round(cpm)}。15 秒なら集中が続きます。2〜3 本で届かなければ、遅い 2 打鍵を弱点ドリルで先に。` };
}

export interface KeyHeat { key: string; milliseconds: number; samples: number; /** 0（速い）〜 1（遅い）。標本不足は -1 */ level: number; }

/** 各キーへ入る 2 打鍵の平均間隔から、キー別の遅さを 0〜1 に正規化する（本人の中で相対評価） */
export function keyHeat(pairs: Record<string, { samples: number; milliseconds: number }>, minimumSamples = 3): KeyHeat[] {
  const byKey = new Map<string, { total: number; weight: number; samples: number }>();
  for (const [pair, stat] of Object.entries(pairs)) {
    if (stat.samples < 1) continue;
    const key = pair[1];
    const entry = byKey.get(key) ?? { total: 0, weight: 0, samples: 0 };
    entry.total += stat.milliseconds * stat.samples;
    entry.weight += stat.samples;
    entry.samples += stat.samples;
    byKey.set(key, entry);
  }
  const heats = [...byKey.entries()].map(([key, entry]): KeyHeat => ({ key, milliseconds: Math.round(entry.total / entry.weight), samples: entry.samples, level: -1 }));
  const valid = heats.filter((heat): boolean => heat.samples >= minimumSamples);
  const values = valid.map((heat): number => heat.milliseconds);
  const low = Math.min(...values);
  const high = Math.max(...values);
  for (const heat of valid) heat.level = high > low ? (heat.milliseconds - low) / (high - low) : 0;
  return heats.sort((left, right): number => left.key.localeCompare(right.key));
}
