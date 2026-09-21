// 「練習する」ボタンの自動メニュー。記録から次の 1 ブロックだけを決める純粋関数。
// 学習者にモードを選ばせない設計（自己調整は弱点だけの練習や再読を選びがち: Kornell & Bjork 2008）。
// 優先順位: 段階が残る人は習得（復習期限がたまれば 1 ブロック挟む）→ 復習期限 → 弱点ドリル → 高速化（60秒 ⇄ 疾走15秒）。
import { curriculum } from "../data/trainingCorpus";
import { comparableResults, suggestedStage, type TrainingMaterial, type TrainingMode, type TrainingProfile, type TrainingResult } from "./training";
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
