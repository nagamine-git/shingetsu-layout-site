// フッターのカウンター表示用の純関数（桁区切りとカウントアップ）。

const grouping = new Intl.NumberFormat("en-US");

export function formatCount(count: number): string {
  return grouping.format(count);
}

/** 経過時間から 0〜1 の進み具合へ。最初は速く、終わりに向けてゆっくり止まる */
export function countUpProgress(elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1;
  const t = Math.min(Math.max(elapsedMs / durationMs, 0), 1);
  return 1 - (1 - t) ** 3;
}

export function countUpValue(progress: number, target: number): number {
  return Math.round(target * progress);
}
