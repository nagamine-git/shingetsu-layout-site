// 「練習する」ボタンの自動メニュー。記録から次の 1 ブロックだけを決める純粋関数。
// 学習者にモードを選ばせない設計（自己調整は弱点だけの練習や再読を選びがち: Kornell & Bjork 2008）。
// 優先順位: 段階が残る人は習得（復習期限がたまれば 1 ブロック挟む）→ 復習期限 → 弱点ドリル → 高速化（60秒 ⇄ 疾走15秒）。
import { curriculum } from "../data/trainingCorpus";
import { comparableResults, suggestedStage, type TrainingMaterial, type TrainingMethod, type TrainingMode, type TrainingProfile, type TrainingResult } from "./training";
import { drillDuration, sprintDuration, sprintTarget, weakTargets, type DrillTarget } from "./trainingDrill";

export interface SessionPlan {
  mode: TrainingMode;
  /** 時間制ブロックの秒数。習得・復習は 0 */
  duration: number;
  /** 習得の段階（0 始まり）。他は最終段階 */
  stage: number;
  hints: "auto" | "off";
  material: TrainingMaterial;
  /** 見出し（例「復習 · ことばで想起」） */
  title: string;
  /** なぜこのメニューかの一文 */
  reason: string;
  targets: DrillTarget[];
}

const lastStage = curriculum.length - 1;

function lastBlock(profile: TrainingProfile, method: "keyboard" | "touch"): TrainingResult | undefined {
  return [...profile.results].reverse().find((result): boolean => result.method === method && result.mode !== "benchmark");
}

function isSprint(result: TrainingResult | undefined): boolean {
  return result?.mode === "speed" && Number(result.signature.split(":")[2]) === sprintDuration;
}

export function planSession(profile: TrainingProfile, method: "keyboard" | "touch", now: number, material: TrainingMaterial = "short"): SessionPlan {
  const stats = profile[method];
  const due = Object.entries(stats).filter(([kana, skill]): boolean => kana.length === 1 && skill.due <= now).length;
  const last = lastBlock(profile, method);
  const stage = suggestedStage(stats);
  const base = { stage: lastStage, material, targets: [] as DrillTarget[] };

  if (stage < lastStage) {
    if (due >= 3 && last?.mode !== "review") {
      return { ...base, mode: "review", duration: 0, hints: "off", title: "復習 · ことばで想起", reason: `${due}文字が復習の時期。ヒントなしで思い出してから、次の段階へ。` };
    }
    return { ...base, mode: "learn", duration: 0, stage, hints: "auto", title: `習得 · ${stage + 1}. ${curriculum[stage].name}`, reason: `この段階の文字がまだ安定していません。${curriculum[stage].detail}` };
  }

  if (due >= 1 && last?.mode !== "review") {
    return { ...base, mode: "review", duration: 0, hints: "off", title: "復習 · ことばで想起", reason: `${due}文字が復習の時期。日を空けて思い出せるかが、定着の証拠です。` };
  }

  const targets = weakTargets(profile, method, now);
  if (targets.length && last?.mode !== "drill") {
    return { ...base, mode: "drill", duration: drillDuration, hints: "off", targets, title: "弱点ドリル · 狙い撃つ", reason: `本人比で遅い ${targets.map((target): string => target.label).join(" · ")} を含む文を7割、得意な文を3割。` };
  }

  const consolidation = comparableResults(profile, `speed:${method}:60:${lastStage}:${material === "paragraph" ? "paragraph:" : ""}v1${method === "touch" ? "" : ":longmark-v1"}`);
  const latest = consolidation.at(-1);
  const target = sprintTarget(profile, method, material);
  if (last && !isSprint(last) && latest && latest.accuracy >= 96 && target > 0 && last.mode === "speed" && last.date === latest.date) {
    return { ...base, mode: "speed", duration: sprintDuration, hints: "off", title: "疾走 · 15秒で上限を押す", reason: `直前の60秒が正確率 ${latest.accuracy.toFixed(1)}%。目標 ${target} かな/分（自己ベスト+8%）で15秒だけ全力。` };
  }
  if (last && isSprint(last)) {
    return { ...base, mode: "speed", duration: 60, hints: "off", title: "定着 · 60秒", reason: last.accuracy < 90 ? `疾走の正確率 ${last.accuracy.toFixed(1)}%。速さを少し戻して、正確さを先に。` : "疾走で押し上げた速さを、60秒・正確率97%以上で保てるか。" };
  }
  return { ...base, mode: "speed", duration: 60, hints: "off", title: "高速化 · 60秒", reason: latest ? "正確率95%以上を保って、自然な文で少しずつ速く。" : "まず60秒の比較できる記録を作ります。正確率95%以上・ヒントなしが基準。" };
}

// 「測る」のループ。上級者が Enter だけで 60 秒をくり返し、測るたびに伸びる設計。
// - その日の最初の 1 本だけ固定文（定点）。同じ文を何度も打つと文を覚えて速くなり、実力の比較にならないため
// - 2 本目以降は直近に打っていない文で 60 秒。本人比の弱点を含む文を 3 割だけ混ぜる（文脈干渉: Shea & Morgan 1979）
// 1 日 1 本・3 割は製品上のヒューリスティックで、最適値の実証ではない。
export const measureWeakShare = .3;

export interface MeasurePlan {
  kind: "anchor" | "fresh";
  mode: TrainingMode;
  title: string;
  reason: string;
  targets: DrillTarget[];
}

export function fixedSignature(method: TrainingMethod): string {
  return `${method === "ime" ? "ime" : "benchmark"}:${method}:60:${lastStage}:v1${method === "touch" ? "" : ":longmark-v1"}`;
}

export function planMeasure(profile: TrainingProfile, method: TrainingMethod, now: number): MeasurePlan {
  const today = new Date(now).toDateString();
  const anchored = profile.results.some((result): boolean => result.signature === fixedSignature(method) && !result.interrupted && new Date(result.date).toDateString() === today);
  const learning = method !== "ime" && suggestedStage(profile[method]) < lastStage ? "まだ習得中の文字があります。覚える段階は「練習する」がおすすめ。" : "";
  if (!anchored) {
    return { kind: "anchor", mode: method === "ime" ? "ime" : "benchmark", targets: [], title: "定点 · 今日の1本目", reason: `${learning}昨日までと同じ固定文で、今日の実力を1回だけ測ります。` };
  }
  const targets = method === "ime" ? [] : weakTargets(profile, method, now);
  return { kind: "fresh", mode: method === "ime" ? "ime" : "speed", targets, title: "別の文 · 60秒", reason: `${learning}直近に打っていない文で60秒。固定文を覚えるのではなく、どの文でも速く。` };
}
