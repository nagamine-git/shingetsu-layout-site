// ATC（Alternative Typing Contest）の単位に寄せた結果の見方。
// ATC のスコアは「変換後の字/分」、大岡俊彦「【Alternative Typing Contest 2025】解説」(2025-11-29) は
// これに「秒打鍵数」を並べて比べている。練習室はかな/分で測るので、指の速さ（打/秒）と字/分の目安を足す。
import type { Passage } from "../data/trainingCorpus";
import type { TrainingMethod, TrainingProfile, TrainingResult } from "./training";

/** ATC 2025 のかな系 3 位（新下駄配列 236 字/分）。2026 の部門・表彰の規定は未発表なので参考線 */
export const atcKanaPodium = { year: 2025, score: 236 } as const;

const timedModes = new Set(["speed", "benchmark", "drill", "focus"]);

/** 打/秒。ミス打鍵も含めた押下回数（ATC の秒打鍵数も BS・書き直しを含む） */
export function keystrokeRate(result: Pick<TrainingResult, "attempts" | "duration">): number {
  return result.duration > 0 ? result.attempts / result.duration : 0;
}

/** 打った文の「漢字かな交じりの字数 ÷ 読みの字数」。かな/分を変換後の字/分に寄せる係数 */
export function conversionRatio(passages: Passage[]): number {
  const reading = passages.reduce((total, passage): number => total + Array.from(passage.reading).length, 0);
  const text = passages.reduce((total, passage): number => total + Array.from(passage.text).length, 0);
  return reading ? text / reading : 1;
}

/** かな/分 → 変換後の字/分の目安。変換・候補選択の時間を含まないので上限寄り */
export function atcEstimate(kanaPerMinute: number, ratio: number): number {
  return Math.round(kanaPerMinute * ratio);
}

/** 時間制・ガイドなし・正確率 95% 以上・15 秒以上の PC 記録での最高打/秒 */
export function bestKeystrokeRate(profile: TrainingProfile, method: Exclude<TrainingMethod, "ime">): number {
  return Math.max(0, ...profile.results
    .filter((result): boolean => result.method === method && timedModes.has(result.mode) && !result.interrupted && !result.assisted && result.accuracy >= 95 && result.duration >= 15)
    .map(keystrokeRate));
}

/** 参考線までの差の一文 */
export function podiumGap(score: number): string {
  const gap = atcKanaPodium.score - score;
  return gap > 0 ? `ATC ${atcKanaPodium.year} かな系3位（${atcKanaPodium.score}字/分）まで あと${gap}` : `ATC ${atcKanaPodium.year} かな系3位（${atcKanaPodium.score}字/分）に届いています`;
}
