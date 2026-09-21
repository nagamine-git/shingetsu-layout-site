import romanData from "../data/romantable.json";
import { benchmarkCorpus, curriculum, trainingCorpus, type Passage } from "../data/trainingCorpus";
import { trainingParagraphs } from "../data/trainingParagraphs";
import { isLongMarkInput } from "./longMark";

export type TrainingMode = "learn" | "review" | "speed" | "benchmark" | "ime" | "focus";
export type TrainingMethod = "keyboard" | "touch" | "ime";
export type TrainingMaterial = "short" | "paragraph";
export interface TrainingToken { text: string; paths: string[]; }
export interface Skill {
  samples: number;
  recent: number[];
  latencies: number[];
  due: number;
  last: number;
  streak: number;
}
export interface PairSkill { samples: number; milliseconds: number; }
export interface TrainingSoundState {
  bgm: "off" | "eclipse" | "still" | "orbit";
  se: "off" | "felt" | "tactile" | "glass";
  bgmVolume: number;
  seVolume: number;
  enabled: boolean;
  failed: boolean;
}
export interface TrainingSoundRecord { start: TrainingSoundState; end: TrainingSoundState; changed: boolean; }
export interface TrainingResult {
  date: string;
  mode: TrainingMode;
  method: TrainingMethod;
  material: TrainingMaterial;
  duration: number;
  stage: number;
  cpm: number;
  accuracy: number;
  kana: number;
  attempts: number;
  errors: number;
  interrupted: boolean;
  assisted: boolean;
  signature: string;
  sound?: TrainingSoundRecord;
}
export interface TrainingProfile {
  version: 1;
  keyboard: Record<string, Skill>;
  touch: Record<string, Skill>;
  pairs: { keyboard: Record<string, PairSkill>; touch: Record<string, PairSkill> };
  results: TrainingResult[];
  recent: string[];
}
export interface TokenSample { text: string; milliseconds: number; strokes: number; errors: number; hinted: boolean; }
export interface PairSample { pair: string; milliseconds: number; }

const mappings = Object.entries(romanData.table).sort(([leftKeys, leftText], [rightKeys, rightText]): number =>
  rightText.length - leftText.length || leftKeys.length - rightKeys.length || leftKeys.localeCompare(rightKeys));
const encodingCache = new Map<string, string[]>();
const day = 86_400_000;
export const trainingStorageKey = "shingetsu-training-v1";

export function keyLegend(prefix: string, key: string): string {
  const table: Readonly<Record<string, string>> = romanData.table;
  return table[prefix + key] ?? (prefix ? "·" : key === "d" ? "★" : key === "k" ? "☆" : "·");
}

export function fingerHint(key: string): string {
  const groups = [
    ["qaz", "左小指"], ["wsx", "左薬指"], ["edc", "左中指"], ["rftgvb", "左人差し指"],
    ["yhnujm", "右人差し指"], ["ik,", "右中指"], ["ol.", "右薬指"], ["p;/[]", "右小指"],
  ];
  return groups.find(([keys]): boolean => keys.includes(key))?.[1] ?? "";
}

export function encodings(text: string): string[] {
  if (!text) return [""];
  const saved = encodingCache.get(text);
  if (saved) return saved;
  const paths = mappings.filter(([, kana]): boolean => text.startsWith(kana))
    .flatMap(([sequence, kana]): string[] => encodings(text.slice(kana.length)).map((suffix): string => sequence + suffix));
  const result = [...new Set(paths)].sort((left, right): number => left.length - right.length || left.localeCompare(right));
  encodingCache.set(text, result);
  return result;
}

export function tokenize(reading: string): TrainingToken[] {
  const result: TrainingToken[] = [];
  let remaining = reading.normalize("NFC");
  while (remaining) {
    const match = mappings.find(([, kana]): boolean => remaining.startsWith(kana));
    if (!match) throw new Error(`Unsupported training text: ${remaining}`);
    const text = match[1];
    result.push({ text, paths: text === "ー" ? [...encodings(text), "-"] : encodings(text) });
    remaining = remaining.slice(text.length);
  }
  return result;
}

export function freshProfile(): TrainingProfile {
  return { version: 1, keyboard: {}, touch: {}, pairs: { keyboard: {}, touch: {} }, results: [], recent: [] };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function number(value: unknown, maximum = 1_000_000_000_000_000): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum;
}

function soundState(value: unknown): TrainingSoundState | undefined {
  if (!record(value) || !["off", "eclipse", "still", "orbit"].includes(String(value.bgm)) || !["off", "felt", "tactile", "glass"].includes(String(value.se))) return;
  if (!number(value.bgmVolume, 1) || !number(value.seVolume, 1) || typeof value.enabled !== "boolean" || typeof value.failed !== "boolean") return;
  return { bgm: value.bgm as TrainingSoundState["bgm"], se: value.se as TrainingSoundState["se"], bgmVolume: value.bgmVolume, seVolume: value.seVolume, enabled: value.enabled, failed: value.failed };
}

function soundRecord(value: unknown): TrainingSoundRecord | undefined {
  if (!record(value) || typeof value.changed !== "boolean") return;
  const start = soundState(value.start);
  const end = soundState(value.end);
  return start && end ? { start, end, changed: value.changed } : undefined;
}

const skillNames = new Set([...trainingCorpus, ...benchmarkCorpus].flatMap((passage): string[] =>
  tokenize(passage.reading).flatMap((token): string[] => [token.text, ...Array.from(token.text)])));

export function readProfile(raw: string | null): TrainingProfile {
  const profile = freshProfile();
  if (!raw || raw.length > 600_000) return profile;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!record(parsed) || parsed.version !== 1) return profile;
    for (const method of ["keyboard", "touch"] as const) {
      const skills = parsed[method];
      if (record(skills)) {
        for (const name of skillNames) {
          const skill = skills[name];
          if (!record(skill) || !number(skill.samples, 1e8) || !number(skill.last) || !number(skill.due) || !number(skill.streak, 100)) continue;
          if (!Array.isArray(skill.recent) || !skill.recent.every((value): boolean => value === 0 || value === 1)) continue;
          if (!Array.isArray(skill.latencies) || !skill.latencies.every((value): boolean => number(value, 60_000))) continue;
          profile[method][name] = { samples: Math.floor(skill.samples), recent: skill.recent.slice(-20), latencies: skill.latencies.slice(-20), last: skill.last, due: skill.due, streak: skill.streak };
        }
      }
      const pairs = record(parsed.pairs) ? parsed.pairs[method] : null;
      if (record(pairs)) {
        for (const [pair, stat] of Object.entries(pairs).slice(0, 1500)) {
          if (/^[a-z;,./\[\]]{2}$/.test(pair) && record(stat) && number(stat.samples, 1e8) && number(stat.milliseconds, 60_000)) {
            profile.pairs[method][pair] = { samples: stat.samples, milliseconds: stat.milliseconds };
          }
        }
      }
    }
    if (Array.isArray(parsed.results)) {
      for (const entry of parsed.results.slice(-180)) {
        if (!record(entry) || typeof entry.date !== "string" || entry.date.length > 40 || !Number.isFinite(Date.parse(entry.date))) continue;
        if (!["learn", "review", "speed", "benchmark", "ime", "focus"].includes(String(entry.mode)) || !["keyboard", "touch", "ime"].includes(String(entry.method))) continue;
        if (!number(entry.cpm, 100_000) || !number(entry.accuracy, 100) || !number(entry.duration, 7200) || !number(entry.stage, 5)) continue;
        if (!number(entry.kana, 100_000) || !number(entry.attempts, 1e7) || !number(entry.errors, entry.attempts)) continue;
        if (typeof entry.interrupted !== "boolean" || typeof entry.assisted !== "boolean" || typeof entry.signature !== "string" || entry.signature.length > 100) continue;
        if (entry.material !== undefined && entry.material !== "short" && entry.material !== "paragraph") continue;
        profile.results.push({ date: entry.date, mode: entry.mode as TrainingMode, method: entry.method as TrainingMethod, material: entry.material ?? "short", duration: entry.duration, stage: entry.stage, cpm: entry.cpm, accuracy: entry.accuracy, kana: entry.kana, attempts: entry.attempts, errors: entry.errors, interrupted: entry.interrupted, assisted: entry.assisted, signature: entry.signature, sound: soundRecord(entry.sound) });
      }
    }
    if (Array.isArray(parsed.recent)) profile.recent = parsed.recent.filter((value): value is string => typeof value === "string" && (trainingCorpus.some((passage): boolean => passage.id === value) || trainingParagraphs.some((passage): boolean => passage.id === value))).slice(-30);
  } catch { return profile; }
  return profile;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right): number => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function mastery(skill: Skill | undefined): boolean {
  if (!skill || skill.recent.length < 6 || skill.latencies.length < 3) return false;
  return skill.recent.reduce((total, value): number => total + value, 0) / skill.recent.length >= .95 && median(skill.latencies) <= 1500;
}

export function suggestedStage(stats: Record<string, Skill>): number {
  for (let stage = 0; stage < curriculum.length - 1; stage += 1) {
    const chars = Array.from(curriculum[stage].kana);
    if (chars.filter((kana): boolean => mastery(stats[kana])).length / chars.length < .8) return stage;
  }
  return curriculum.length - 1;
}

export function priority(skill: Skill | undefined, now: number): number {
  if (!skill) return 3;
  const accuracy = skill.recent.length ? skill.recent.reduce((total, value): number => total + value, 0) / skill.recent.length : 0;
  return 1 + (1 - accuracy) * 6 + Math.min(3, median(skill.latencies) / 1200) + (skill.due <= now ? 3 : 0);
}

export function selectPassages(profile: TrainingProfile, method: "keyboard" | "touch", mode: TrainingMode, stage: number, now: number, random: () => number = Math.random, focus = "", material: TrainingMaterial = "short"): Passage[] {
  if (mode === "benchmark" || mode === "ime") return [...benchmarkCorpus];
  const stats = profile[method];
  const continuous = mode === "speed" || mode === "focus";
  const paragraphs = continuous && material === "paragraph";
  const pool = paragraphs ? trainingParagraphs : trainingCorpus.filter((passage): boolean => (continuous ? passage.stage >= 2 : passage.stage <= stage));
  const selected: Passage[] = [];
  let size = 0;
  const maxChars = paragraphs ? 900 : continuous ? 500 : stage < 2 ? 36 : 75;
  while (size < maxChars && selected.length < (continuous ? 30 : 14)) {
    const choices = pool.filter((passage): boolean => !selected.some((item): boolean => item.id === passage.id));
    if (!choices.length) break;
    const weighted = choices.map((passage): { passage: Passage; weight: number } => {
      const characters = [...new Set(Array.from(passage.reading))];
      const weakness = characters.reduce((total, kana): number => total + priority(stats[kana], now), 0) / characters.length;
      const hasNew = characters.some((kana): boolean => curriculum[stage].kana.includes(kana));
      const focusMatch = focus && (passage.reading.includes(focus) || tokenize(passage.reading).map((token): string => token.paths[0]).join("").includes(focus));
      return { passage, weight: (continuous ? 1 : weakness) * (hasNew ? 2 : 1) * (profile.recent.includes(passage.id) ? .18 : 1) * (focusMatch ? 12 : 1) };
    });
    let needle = Math.max(0, Math.min(.999999, random())) * weighted.reduce((total, item): number => total + item.weight, 0);
    const next = weighted.find((item): boolean => (needle -= item.weight) < 0)?.passage ?? weighted[0].passage;
    selected.push(next);
    size += next.reading.length;
  }
  return selected;
}

export function updateSkills(stats: Record<string, Skill>, samples: TokenSample[], now: number): void {
  const grouped = new Map<string, TokenSample[]>();
  for (const sample of samples) {
    for (const kana of new Set([sample.text, ...Array.from(sample.text)])) {
      const items = grouped.get(kana) ?? [];
      items.push(sample);
      grouped.set(kana, items);
    }
  }
  for (const [kana, items] of grouped) {
    const skill = stats[kana] ??= { samples: 0, recent: [], latencies: [], last: 0, due: 0, streak: 0 };
    const retrieval = items.every((sample): boolean => sample.errors === 0 && !sample.hinted);
    const due = skill.due <= now;
    for (const sample of items) {
      skill.samples += 1;
      if (sample.errors > 0 || !sample.hinted) skill.recent.push(sample.errors === 0 ? 1 : 0);
      if (sample.milliseconds > 0 && !sample.hinted && sample.errors === 0) skill.latencies.push(Math.min(60_000, sample.milliseconds / sample.strokes));
    }
    skill.recent = skill.recent.slice(-20);
    skill.latencies = skill.latencies.slice(-20);
    if (!retrieval) { skill.streak = 0; skill.due = now + 10 * 60_000; }
    else if (due) {
      skill.streak = Math.min(4, skill.streak + 1);
      skill.due = now + [1, 3, 7, 14][skill.streak - 1] * day;
    }
    skill.last = now;
  }
}

export function saveSession(profile: TrainingProfile, result: TrainingResult, samples: TokenSample[], pairs: PairSample[], passageIds: string[]): void {
  profile.results.push(result);
  profile.results = profile.results.slice(-180);
  if (result.method !== "ime" && result.mode !== "benchmark") {
    updateSkills(profile[result.method], samples, Date.parse(result.date));
    for (const sample of pairs) {
      const stat = profile.pairs[result.method][sample.pair] ??= { samples: 0, milliseconds: sample.milliseconds };
      stat.samples += 1;
      stat.milliseconds += (sample.milliseconds - stat.milliseconds) * .2;
    }
    profile.recent = [...profile.recent, ...passageIds].slice(-30);
  }
}

export class TrainingRun {
  passages: Passage[];
  tokens: TrainingToken[];
  passageIndex = 0;
  tokenIndex = 0;
  buffer = "";
  completed = 0;
  attempts = 0;
  errors = 0;
  samples: TokenSample[] = [];
  pairs: PairSample[] = [];
  intervals: number[] = [];
  trace: { second: number; cpm: number }[] = [];
  interrupted = false;
  assisted = false;
  private startTime: number | null = null;
  private pausedAt: number | null = null;
  private pausedTotal = 0;
  private tokenStart: number | null = null;
  private tokenErrors = 0;
  private hinted = false;
  private previousKey = "";
  private previousAt: number | null = null;

  constructor(passages: Passage[]) {
    if (!passages.length) throw new Error("Training requires a passage");
    this.passages = [...passages];
    this.tokens = tokenize(passages[0].reading);
  }
  get passage(): Passage { return this.passages[this.passageIndex]; }
  get token(): TrainingToken | undefined { return this.tokens[this.tokenIndex]; }
  get complete(): boolean { return this.passageIndex >= this.passages.length; }
  get started(): boolean { return this.startTime !== null; }
  get accuracy(): number { return this.attempts ? (this.attempts - this.errors) / this.attempts * 100 : 100; }
  get nextKeys(): string[] { return [...new Set(this.token?.paths.filter((sequence): boolean => sequence.startsWith(this.buffer)).map((sequence): string => sequence[this.buffer.length]) ?? [])]; }
  get guide(): string { return this.token?.paths.find((sequence): boolean => sequence.startsWith(this.buffer)) ?? ""; }
  get assessmentSamples(): TokenSample[] {
    return this.token && this.tokenErrors > 0
      ? [...this.samples, { text: this.token.text, milliseconds: 0, strokes: Math.max(1, this.buffer.length), errors: this.tokenErrors, hinted: this.hinted }]
      : this.samples;
  }

  start(now: number): void { if (this.startTime === null) this.startTime = now; }
  elapsed(now: number): number { return this.startTime === null ? 0 : Math.max(0, (this.pausedAt ?? now) - this.startTime - this.pausedTotal); }
  pause(now: number): void {
    if (this.pausedAt !== null || this.startTime === null) return;
    this.pausedAt = now;
    this.tokenStart = null;
    this.previousAt = null;
  }
  resume(now: number): void {
    if (this.pausedAt === null) return;
    this.pausedTotal += now - this.pausedAt;
    this.pausedAt = null;
  }
  hint(): void { this.hinted = true; this.assisted = true; }
  cpm(now: number): number { const elapsed = this.elapsed(now); return elapsed >= 1000 ? this.completed * 60000 / elapsed : 0; }
  sampleTrace(now: number): void {
    const second = Math.floor(this.elapsed(now) / 1000);
    if (second > 0 && this.trace.at(-1)?.second !== second) this.trace.push({ second, cpm: this.cpm(now) });
  }
  append(passages: Passage[]): void { this.passages.push(...passages); }

  press(key: string, now: number): boolean {
    if (this.complete || this.pausedAt !== null) return false;
    this.start(now);
    const token = this.token;
    if (!token) return false;
    if (token.text === "ー" && isLongMarkInput(key)) key = "-";
    this.attempts += 1;
    const candidate = this.buffer + key;
    if (!token.paths.some((sequence): boolean => sequence.startsWith(candidate))) {
      this.errors += 1;
      this.tokenErrors += 1;
      this.previousAt = null;
      return false;
    }
    if (this.previousAt !== null) {
      const interval = now - this.previousAt;
      if (interval > 0 && interval <= 10_000) {
        this.intervals.push(interval);
        const pair = this.previousKey + key;
        if (/^[a-z;,./\[\]]{2}$/.test(pair)) this.pairs.push({ pair, milliseconds: interval });
      }
    }
    this.previousAt = now;
    this.previousKey = key;
    this.buffer = candidate;
    if (!token.paths.includes(candidate)) return true;
    this.samples.push({ text: token.text, milliseconds: this.tokenStart === null ? 0 : now - this.tokenStart, strokes: candidate.length, errors: this.tokenErrors, hinted: this.hinted });
    this.completed += Array.from(token.text).length;
    this.tokenStart = now;
    this.tokenErrors = 0;
    this.hinted = false;
    this.buffer = "";
    this.tokenIndex += 1;
    if (this.tokenIndex >= this.tokens.length) {
      this.passageIndex += 1;
      this.tokenIndex = 0;
      this.tokens = this.complete ? [] : tokenize(this.passage.reading);
    }
    return true;
  }
}

export function codeToKey(code: string): string | undefined {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  return ({ Semicolon: ";", Comma: ",", Period: ".", Slash: "/", BracketLeft: "[", BracketRight: "]" } as Record<string, string>)[code];
}

export function rhythm(intervals: number[]): number | null {
  if (intervals.length < 10) return null;
  const mean = intervals.reduce((sum, interval): number => sum + interval, 0) / intervals.length;
  const deviation = Math.sqrt(intervals.reduce((sum, interval): number => sum + (interval - mean) ** 2, 0) / intervals.length);
  return Math.round(Math.max(0, 100 * (1 - deviation / mean)));
}

export function comparableResults(profile: TrainingProfile, signature: string): TrainingResult[] {
  return profile.results.filter((result): boolean => result.signature === signature && !result.interrupted && !result.assisted && result.accuracy >= 95 && result.duration >= 15 && result.kana >= 10);
}
