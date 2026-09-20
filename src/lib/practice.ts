import romanData from "../data/romantable.json";

export type PracticeMode = "home" | "shift" | "voice" | "review";
export type InputMethod = "keyboard" | "touch";
export interface KanaStat { attempts: number; errors: number; }
export interface PracticeResult {
  date: string;
  mode: PracticeMode;
  method: InputMethod;
  accuracy: number;
  cpm: number;
}
export interface PracticeHistory {
  version: 1;
  keyboard: Record<string, KanaStat>;
  touch: Record<string, KanaStat>;
  results: PracticeResult[];
}

export const practiceModes: { id: PracticeMode; label: string; description: string; kana: string }[] = [
  { id: "home", label: "01 基本の8文字", description: "は・か・と・た・く・う・き・そ。まずは1打鍵のかなから。", kana: "はかとたくうきそ" },
  { id: "shift", label: "02 前置シフト", description: "★は D、☆は K。ガイドの順に1キーずつ押します。同時押しではありません。", kana: "あをられよまおもわちゆひほふめぬえみや" },
  { id: "voice", label: "03 濁点・半濁点", description: "かなの後に L で濁点。は → L → L で「ぱ」を練習します。", kana: "がぎぐげござじずぜぞだでどばぱ" },
  { id: "review", label: "04 苦手を復習", description: "同じ入力方法の記録から、ミス率の高い文字を多めに出題。未練習の文字も混ぜます。", kana: "" },
];

export const kanaSequences = new Map<string, string>();
for (const [sequence, kana] of Object.entries(romanData.table).sort(([left], [right]): number => left.length - right.length || left.localeCompare(right))) {
  if (Array.from(kana).length === 1 && !kanaSequences.has(kana)) kanaSequences.set(kana, sequence);
}
const allKana = Array.from(new Set(practiceModes.flatMap((mode): string[] => Array.from(mode.kana))));

export function emptyHistory(): PracticeHistory {
  return { version: 1, keyboard: {}, touch: {}, results: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedNumber(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum;
}

export function parseHistory(raw: string | null): PracticeHistory {
  const history = emptyHistory();
  if (!raw || raw.length > 100_000) return history;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1) return history;
    for (const method of ["keyboard", "touch"] as const) {
      const profile = parsed[method];
      if (!isRecord(profile)) continue;
      for (const kana of allKana) {
        const stat = profile[kana];
        if (isRecord(stat) && boundedNumber(stat.attempts, 10_000_000) && boundedNumber(stat.errors, stat.attempts)) {
          history[method][kana] = { attempts: Math.floor(stat.attempts), errors: Math.floor(stat.errors) };
        }
      }
    }
    if (Array.isArray(parsed.results)) {
      for (const result of parsed.results.slice(-20)) {
        if (!isRecord(result) || typeof result.date !== "string" || result.date.length > 40 || !Number.isFinite(Date.parse(result.date))) continue;
        if (!practiceModes.some((mode): boolean => mode.id === result.mode) || (result.method !== "keyboard" && result.method !== "touch")) continue;
        if (!boundedNumber(result.accuracy, 100) || !boundedNumber(result.cpm, 100_000)) continue;
        history.results.push({ date: result.date, mode: result.mode as PracticeMode, method: result.method, accuracy: result.accuracy, cpm: result.cpm });
      }
    }
  } catch { return history; }
  return history;
}

export function makeLesson(mode: PracticeMode, stats: Record<string, KanaStat>, random: () => number = Math.random): string[] {
  const pool = mode === "review" ? allKana : Array.from(practiceModes.find((entry): boolean => entry.id === mode)?.kana ?? practiceModes[0].kana);
  const lesson: string[] = [];
  for (let index = 0; index < 20; index += 1) {
    const choices = pool.filter((kana): boolean => kana !== lesson.at(-1) && kanaSequences.has(kana));
    const weights = choices.map((kana): number => {
      const stat = stats[kana];
      return mode === "review" ? 1 + (stat?.attempts ? 6 * stat.errors / stat.attempts : 1) : 1;
    });
    let threshold = random() * weights.reduce((total, weight): number => total + weight, 0);
    const choice = choices.find((_, choiceIndex): boolean => (threshold -= weights[choiceIndex]) < 0);
    lesson.push(choice ?? choices[choices.length - 1]);
  }
  return lesson;
}

export class PracticeSession {
  readonly lesson: string[];
  readonly stats: Record<string, KanaStat> = {};
  index = 0;
  stroke = 0;
  attempts = 0;
  errors = 0;
  private elapsed = 0;
  private resumedAt: number | null = null;

  constructor(lesson: string[]) { this.lesson = lesson; }
  get complete(): boolean { return this.index >= this.lesson.length; }
  get kana(): string { return this.lesson[this.index] ?? ""; }
  get sequence(): string { return kanaSequences.get(this.kana) ?? ""; }
  get nextKey(): string { return this.sequence[this.stroke] ?? ""; }
  get accuracy(): number { return this.attempts ? Math.round((this.attempts - this.errors) / this.attempts * 100) : 100; }

  milliseconds(now: number): number { return this.elapsed + (this.resumedAt === null ? 0 : Math.max(0, now - this.resumedAt)); }
  pause(now: number): void { this.elapsed = this.milliseconds(now); this.resumedAt = null; }

  press(key: string, now: number): boolean {
    if (this.complete) return false;
    if (this.resumedAt === null) this.resumedAt = now;
    const stat = this.stats[this.kana] ??= { attempts: 0, errors: 0 };
    this.attempts += 1;
    stat.attempts += 1;
    if (key !== this.nextKey) { this.errors += 1; stat.errors += 1; return false; }
    this.stroke += 1;
    if (this.stroke === this.sequence.length) { this.index += 1; this.stroke = 0; }
    if (this.complete) this.pause(now);
    return true;
  }

  cpm(now: number): number {
    const seconds = this.milliseconds(now) / 1000;
    return seconds >= 1 ? Math.round(this.index / seconds * 60) : 0;
  }
}
