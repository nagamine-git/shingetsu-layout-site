// 指の速さ（打/秒）。かな/分は配列の打鍵数に左右されるので、指そのものの伸びは打/秒で見る。
import type { TrainingMethod, TrainingProfile, TrainingResult } from "./training";

const timedModes = new Set(["speed", "benchmark", "drill", "focus"]);

/** 打/秒。ミス打鍵も含めた押下回数 ÷ 秒 */
export function keystrokeRate(result: Pick<TrainingResult, "attempts" | "duration">): number {
  return result.duration > 0 ? result.attempts / result.duration : 0;
}

/** 時間制・ガイドなし・正確率 95% 以上・15 秒以上の記録での最高打/秒 */
export function bestKeystrokeRate(profile: TrainingProfile, method: Exclude<TrainingMethod, "ime">): number {
  return Math.max(0, ...profile.results
    .filter((result): boolean => result.method === method && timedModes.has(result.mode) && !result.interrupted && !result.assisted && result.accuracy >= 95 && result.duration >= 15)
    .map(keystrokeRate));
}
