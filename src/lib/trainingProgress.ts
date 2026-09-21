import type { TrainingResult } from "./training";

export interface GrowthPoint {
  result: TrainingResult;
  median: number | null;
  eligible: boolean;
}

export interface ProgressMilestone {
  id: string;
  title: string;
  description: string;
  earned: boolean;
}

export interface WeeklyActivity {
  days: number;
  sessions: number;
  seconds: number;
}

function validSession(result: TrainingResult): boolean {
  return !result.interrupted && result.duration >= 15 && result.kana >= 10;
}

function eligibleResult(result: TrainingResult): boolean {
  return validSession(result) && !result.assisted && result.accuracy >= 95;
}

function localDay(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right): number => left - right);
  return sorted[2];
}

export function growthSeries(
  results: TrainingResult[],
  signature: string,
  days: 7 | 30 | 0,
  now = Date.now(),
): GrowthPoint[] {
  if (!Number.isFinite(now)) return [];
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (days > 0) start.setDate(start.getDate() - days + 1);

  const matching = results
    .map(
      (
        result,
        index,
      ): { result: TrainingResult; index: number; timestamp: number } => ({
        result,
        index,
        timestamp: Date.parse(result.date),
      }),
    )
    .filter(
      ({ result, timestamp }): boolean =>
        result.signature === signature &&
        Number.isFinite(timestamp) &&
        timestamp <= now &&
        (days === 0 || timestamp >= start.getTime()),
    )
    .sort(
      (left, right): number =>
        left.timestamp - right.timestamp || left.index - right.index,
    );

  const eligibleCpms: number[] = [];
  return matching.map(({ result }): GrowthPoint => {
    const eligible = eligibleResult(result);
    if (!eligible) return { result, median: null, eligible };
    eligibleCpms.push(result.cpm);
    return {
      result,
      median: eligibleCpms.length >= 5 ? median(eligibleCpms.slice(-5)) : null,
      eligible,
    };
  });
}

export function progressMilestones(
  results: TrainingResult[],
): ProgressMilestone[] {
  const validResults = results.filter(validSession);
  const accurateResults = validResults.filter(eligibleResult);
  const accurateDays = new Set(
    accurateResults
      .map((result): number => Date.parse(result.date))
      .filter(Number.isFinite)
      .map(localDay),
  );

  return [
    {
      id: "first-session",
      title: "はじめの練習",
      description: "保存中の直近180件で、15秒以上・10かな以上の練習を完了。",
      earned: validResults.length > 0,
    },
    {
      id: "accurate-session",
      title: "正確に練習",
      description:
        "保存中の直近180件で、ガイドなし・正確率95%以上の条件を達成。",
      earned: accurateResults.length > 0,
    },
    {
      id: "returned-session",
      title: "別の日にも練習",
      description:
        "保存中の直近180件で、条件を満たす正確な練習を別々の日に記録。",
      earned: accurateDays.size >= 2,
    },
    {
      id: "paragraph-session",
      title: "文章で練習",
      description: "保存中の直近180件で、文章を15秒以上・10かな以上練習。",
      earned: validResults.some(
        (result): boolean => result.material === "paragraph",
      ),
    },
    {
      id: "review-session",
      title: "復習を実践",
      description:
        "保存中の直近180件で、復習モードを15秒以上・10かな以上練習。",
      earned: validResults.some((result): boolean => result.mode === "review"),
    },
  ];
}

export function weeklyActivity(
  results: TrainingResult[],
  now = Date.now(),
): WeeklyActivity {
  if (!Number.isFinite(now)) return { days: 0, sessions: 0, seconds: 0 };
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));

  const sessions = results
    .map((result): { result: TrainingResult; timestamp: number } => ({
      result,
      timestamp: Date.parse(result.date),
    }))
    .filter(
      ({ result, timestamp }): boolean =>
        Number.isFinite(timestamp) &&
        timestamp >= monday.getTime() &&
        timestamp <= now &&
        validSession(result),
    );

  return {
    days: new Set(sessions.map(({ timestamp }): string => localDay(timestamp)))
      .size,
    sessions: sessions.length,
    seconds: sessions.reduce(
      (total, { result }): number => total + result.duration,
      0,
    ),
  };
}
