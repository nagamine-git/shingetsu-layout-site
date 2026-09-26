import { benchmarkCorpus, curriculum, type Passage } from "../data/trainingCorpus";
import { codeToKey, comparableResults, freshProfile, keyLegend, mastery, median, priority, readProfile, rhythm, saveSession, selectPassages, suggestedStage, trainingStorageKey, TrainingRun, type TrainingMaterial, type TrainingMethod, type TrainingMode, type TrainingProfile, type TrainingResult } from "./training";
import { isLongMarkInput, matchesTrainingCharacter } from "./longMark";
import { TrainingAudio, type BgmPreset, type KeySound } from "./trainingAudio";
import { growthSeries, progressMilestones } from "./trainingProgress";
import { TrainingProgressView } from "./trainingProgressView";
import { bestKeystrokeRate, keystrokeRate } from "./trainingRate";
import { measureWeakShare, planMeasure, planSession, type MeasurePlan, type SessionPlan } from "./trainingPlan";
import { drillChanges, drillDuration, keyHeat, pairLabel, selectDrillPassages, sprintAdvice, sprintDuration, sprintTarget, weakTargets, type DrillTarget } from "./trainingDrill";
import layoutData from "../data/layout.json";
import type { TrainingSoundRecord } from "./training";

function element<ElementType extends HTMLElement = HTMLElement>(id: string): ElementType {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing training element: ${id}`);
  return found as ElementType;
}

const app = element("training-lab");
const stage = element("lab-stage");
const startButton = element<HTMLButtonElement>("lab-start");
const pauseButton = element<HTMLButtonElement>("lab-pause");
const methodSelect = element<HTMLSelectElement>("lab-method");
const levelSelect = element<HTMLSelectElement>("lab-level");
const durationSelect = element<HTMLSelectElement>("lab-duration");
const hintsSelect = element<HTMLSelectElement>("lab-hints");
const materialSelect = element<HTMLSelectElement>("lab-material");
const geometrySelect = element<HTMLSelectElement>("lab-geometry");
const imeInput = element<HTMLTextAreaElement>("lab-ime-input");
const keys = [...app.querySelectorAll<HTMLButtonElement>(".lab-key")];
const modeButtons = [...app.querySelectorAll<HTMLButtonElement>(".lab-modes [data-mode]")];
const names: Record<TrainingMode, string> = { learn: "習得", review: "復習", speed: "高速化", benchmark: "定点測定", ime: "IME実践", focus: "集中", drill: "弱点ドリル" };
const methodNames: Record<TrainingMethod, string> = { keyboard: "PC", touch: "タップ", ime: "IME" };
let profile: TrainingProfile = freshProfile();
let storageAvailable = true;
try { profile = readProfile(localStorage.getItem(trainingStorageKey)); } catch { storageAvailable = false; }
const requestedMode = new URLSearchParams(location.search).get("mode");
let mode: TrainingMode = requestedMode === "focus" || requestedMode === "drill" ? requestedMode : "learn";
let returnMode: TrainingMode = "learn";
let state: "ready" | "running" | "paused" | "done" | "rest" = "ready";
let run: TrainingRun;
let timer: ReturnType<typeof setInterval> | undefined;
let restTimer: ReturnType<typeof setInterval> | undefined;
let tokenEnteredAt = 0;
let manualHint = false;
let focus = "";
let nextFocus = "";
let pace = 0;
let drillTargets: DrillTarget[] = [];
// 「練習する」＝自動メニュー。手動でモードを選ぶと false
let auto = requestedMode !== "focus" && requestedMode !== "drill";
let plan: SessionPlan | undefined;
// 「測る」のループ中は true。Enter / Space で次の一本、Esc で同じ文をやり直す
let measuring = false;
let measurePlan: MeasurePlan | undefined;
let measureSeconds = 0;
const measureBreakSeconds = 20 * 60;
const autoButton = element<HTMLButtonElement>("lab-auto");
const measureButton = element<HTMLButtonElement>("lab-measure");
let composing = false;
let imeFinished = 0;
let imeValue = "";
let imeCorrect = 0;
let imeTotal = 0;
let restUntil = 0;
let lastHintRender = "";
let sessionSound: TrainingSoundRecord | undefined;
let previewTimer: ReturnType<typeof setTimeout> | undefined;
let previewGeneration = 0;
const sound = new TrainingAudio((message): void => {
  const messages: Record<string, string> = { enabled: "音を有効にしました。", muted: "消音中", suspended: "音を一時停止中。再開時に有効化してください。", unsupported: "音声再生に未対応です。無音で練習できます。", blocked: "音を再生できませんでした。もう一度有効化してください。", failed: "音を停止しました。練習は無音で続けられます。", "storage-unavailable": "音の設定を保存できません。この画面では利用できます。" };
  element("lab-sound-status").textContent = messages[message] ?? "音の状態が変わりました。";
  renderSound();
  trackSound();
});
const progressView = new TrainingProgressView(() => ({ profile, method: effectiveMethod(), signature: signature() }));

function renderSound(): void {
  element("lab-sound-label").textContent = sound.enabled ? "ON" : "OFF";
  element("lab-sound-toggle").textContent = sound.enabled ? "消音する" : "音を有効にする";
  element("lab-sound-toggle").setAttribute("aria-pressed", String(sound.enabled));
  element<HTMLSelectElement>("lab-bgm").value = sound.settings.bgm;
  element<HTMLSelectElement>("lab-se").value = sound.settings.se;
  for (const [id, value] of [["bgm", sound.settings.bgmVolume], ["se", sound.settings.seVolume]] as const) {
    element<HTMLInputElement>(`lab-${id}-volume`).value = String(Math.round(value * 100));
    element(`lab-${id}-value`).textContent = `${Math.round(value * 100)}%`;
  }
}

function cancelPreview(): void {
  previewGeneration += 1;
  clearTimeout(previewTimer);
}

function trackSound(): void {
  if (!sessionSound || (state !== "running" && state !== "paused")) return;
  const snapshot = sound.snapshot();
  sessionSound.changed ||= JSON.stringify(sessionSound.end) !== JSON.stringify(snapshot);
  sessionSound.end = snapshot;
}

function captureSound(): void {
  if (!sessionSound || !run.started) {
    const snapshot = sound.snapshot();
    sessionSound = { start: snapshot, end: snapshot, changed: false };
  } else trackSound();
}

methodSelect.value = matchMedia("(pointer: coarse)").matches ? "touch" : "keyboard";
if (mode === "focus") hintsSelect.value = "off";
if (new URLSearchParams(location.search).get("material") === "paragraph") materialSelect.value = "paragraph";

function method(): "keyboard" | "touch" { return methodSelect.value === "touch" ? "touch" : "keyboard"; }
function effectiveMethod(): TrainingMethod { return mode === "ime" ? "ime" : method(); }
// IME は入力方法。選ばれていればモードは常に ime（固定文 60 秒）、外れたら通常モードへ戻す
function syncMethod(): void {
  if (methodSelect.value === "ime") mode = "ime";
  else if (mode === "ime") mode = auto ? "learn" : "benchmark";
}
function applyPlan(): void {
  syncMethod();
  if (mode === "ime") { plan = undefined; return; }
  plan = planSession(profile, method(), Date.now(), materialSelect.value === "paragraph" ? "paragraph" : "short");
  mode = plan.mode;
  if (plan.duration) durationSelect.value = String(plan.duration);
  levelSelect.value = plan.mode === "learn" ? String(plan.stage) : "auto";
  hintsSelect.value = plan.hints;
}
function applyMeasure(): void {
  measurePlan = planMeasure(profile, methodSelect.value === "ime" ? "ime" : method(), Date.now());
  mode = measurePlan.mode;
  // 比較できるよう、別の文の回も 60 秒・語句短文・ガイドなしに揃える
  durationSelect.value = "60";
  materialSelect.value = "short";
  hintsSelect.value = "off";
}
function freshMeasure(): boolean { return measuring && measurePlan?.kind === "fresh"; }
function timed(): boolean { return mode === "speed" || mode === "benchmark" || mode === "ime" || mode === "focus" || mode === "drill"; }
function duration(): number { return mode === "speed" || mode === "focus" ? Number(durationSelect.value) : mode === "drill" ? drillDuration : timed() ? 60 : 0; }
// 高速化モードの 15 秒＝疾走（オーバースピード）。目標は自己ベスト +8%
function sprinting(): boolean { return mode === "speed" && duration() === sprintDuration; }
function level(): number { return timed() ? 5 : levelSelect.value === "auto" ? suggestedStage(profile[method()]) : Number(levelSelect.value); }
function material(): TrainingMaterial { return (mode === "focus" || mode === "speed") && materialSelect.value === "paragraph" ? "paragraph" : "short"; }
function signature(): string { return `${mode}:${effectiveMethod()}:${duration()}:${level()}:${material() === "paragraph" ? "paragraph:" : ""}${mode === "ime" && freshMeasure() ? "corpus:" : ""}v1${effectiveMethod() === "touch" ? "" : ":longmark-v1"}`; }
function status(message: string, quiet = false): void {
  element("lab-status").textContent = message;
  app.dataset.quietStatus = String(quiet);
}

function closeFocusSettings(): void {
  app.dataset.focusSettings = "false";
  element("lab-focus-settings").setAttribute("aria-expanded", "false");
}

function persist(): void {
  try { localStorage.setItem(trainingStorageKey, JSON.stringify(profile)); storageAvailable = true; } catch { storageAvailable = false; }
}

function lockSettings(locked: boolean): void {
  for (const control of [methodSelect, levelSelect, durationSelect, hintsSelect, materialSelect, geometrySelect, autoButton, measureButton, ...modeButtons]) control.disabled = locked;
  element<HTMLButtonElement>("lab-quest-start").disabled = locked;
  element<HTMLButtonElement>("lab-reset").disabled = locked;
  element<HTMLInputElement>("lab-import").disabled = locked;
  element<HTMLButtonElement>("lab-target-review").disabled = locked;
  element<HTMLButtonElement>("lab-focus-settings").disabled = locked;
}

function todaySeconds(): number {
  const today = new Date().toLocaleDateString("sv-SE");
  return profile.results.filter((result): boolean => result.method === effectiveMethod() && new Date(result.date).toLocaleDateString("sv-SE") === today)
    .reduce((total, result): number => total + result.duration, 0);
}

function renderDaily(): void {
  const seconds = todaySeconds() + (state === "running" || state === "paused" ? run.elapsed(performance.now()) / 1000 : 0);
  element("lab-today").textContent = `${Math.floor(seconds / 60)} / 10 分`;
  element<HTMLProgressElement>("lab-daily-progress").value = Math.min(600, seconds);
}

function renderHistory(): void {
  const input = effectiveMethod();
  const results = profile.results.filter((result): boolean => result.method === input);
  element("lab-history-summary").textContent = `${methodNames[input]}の記録 ${results.length}回 · 最新180回を端末内に保存`;
  const body = element("lab-history");
  body.replaceChildren();
  if (!results.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "最初の練習を終えると、ここに記録が残ります。";
    row.append(cell);
    body.append(row);
  }
  for (const result of results.slice(-8).reverse()) {
    const row = document.createElement("tr");
    const conditions = [result.interrupted ? "中断" : "完了", result.assisted ? "ガイドあり" : "ガイドなし", `${Math.round(result.duration)}秒`];
    if (result.method !== "touch") conditions.push(result.signature.endsWith(":longmark-v1") ? "長音互換" : "旧入力規則");
    conditions.push(!result.sound ? "音：旧記録・不明" : result.sound.changed ? "音：途中変更あり" : result.sound.start.failed ? "音：再生不可" : result.sound.start.enabled ? `音：${result.sound.start.bgm} / ${result.sound.start.se}` : "音：OFF");
    for (const text of [new Date(result.date).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }), `${names[result.mode]}${result.material === "paragraph" ? " / 文章" : ""} / ${methodNames[result.method]}`, `${Math.round(result.cpm)} ${result.method === "ime" ? "字" : "かな"}/分`, `${result.accuracy.toFixed(1)}%`, conditions.join(" · ")]) {
      const cell = document.createElement("td");
      cell.textContent = text;
      row.append(cell);
    }
    body.append(row);
  }
  const map = element("lab-skill-map");
  map.replaceChildren();
  for (const [stageIndex, course] of curriculum.entries()) {
    const group = document.createElement("div");
    const label = document.createElement("span");
    label.className = "lab-skill-label";
    label.textContent = `${stageIndex + 1} / ${course.name}`;
    group.append(label);
    for (const kana of Array.from(course.kana)) {
      const skill = profile[method()][kana];
      const item = document.createElement("span");
      const stable = mastery(skill);
      item.dataset.mastery = stable ? "stable" : skill ? "learning" : "new";
      item.textContent = `${kana} ${stable ? "○" : skill ? "◐" : "—"}`;
      item.title = `${kana}：${skill?.samples ?? 0}回${skill ? ` / ヒントなし正答 ${Math.round(skill.recent.reduce((total, value): number => total + value, 0) / Math.max(1, skill.recent.length) * 100)}% / ${Math.round(median(skill.latencies))}ms/打鍵` : ""}`;
      group.append(item);
    }
    map.append(group);
  }
  map.hidden = mode === "ime";
  renderHeatMap();
  const due = Object.entries(profile[method()]).filter(([kana, skill]): boolean => kana.length === 1 && skill.due <= Date.now()).length;
  element("lab-due").textContent = mode === "drill" ? (drillTargets.length ? drillTargets.map((target): string => `${target.label}（${target.reason}）`).join(" / ") : "記録が増えると、ここに狙う弱点が並びます。") : mode === "ime" ? "IME実践はかなの習熟判定に含めません。" : due ? `${due}文字が復習の時期。復習モードで思い出しましょう。` : "復習の期限は、練習を重ねるとここに表示します。";
  element("lab-storage-message").textContent = storageAvailable ? "成績はこのブラウザだけに保存。端末間の移動にはバックアップを使えます。" : "この環境では保存できません。練習は使えますが、閉じる前に記録を書き出してください。";
  renderDaily();
  progressView.render();
}

function hintsVisible(): boolean {
  if (mode === "benchmark" || mode === "ime") return false;
  if (manualHint) return true;
  if (hintsSelect.value === "on") return true;
  if (hintsSelect.value === "off") return false;
  const token = run.token;
  if (!token) return false;
  const stats = profile[method()];
  const experienced = Array.from(token.text).every((kana): boolean => (stats[kana]?.samples ?? 0) + run.samples.filter((sample): boolean => sample.text.includes(kana)).length >= 3);
  return !experienced || (state === "running" && performance.now() - tokenEnteredAt > 1800);
}

function renderHint(): void {
  const visible = hintsVisible();
  app.dataset.hintVisible = String(visible);
  if (visible && state === "running") run.hint();
  const renderKey = `${visible}:${run.passageIndex}:${run.tokenIndex}:${run.buffer}:${state}:${mode}:${method()}`;
  if (renderKey === lastHintRender) return;
  lastHintRender = renderKey;
  element("lab-keyboard").hidden = mode === "ime" || (method() === "keyboard" && !visible && (mode === "benchmark" || hintsSelect.value === "off"));
  const guide = element("lab-key-guide");
  guide.replaceChildren();
  if (visible && run.token) {
    const label = document.createElement("span");
    label.textContent = `${run.token.text} → `;
    guide.append(label);
    // ローマ字ではなく「そのキーが何を出すか」（★ / ☆ / か / が …）で示す。文字は PC のときだけ小さく添える
    for (const [index, key] of Array.from(run.guide).entries()) {
      const keycap = document.createElement("kbd");
      const legend = document.createElement("strong");
      legend.textContent = keyLegend(run.guide.slice(0, index), key) || key.toUpperCase();
      keycap.append(legend);
      if (method() === "keyboard") {
        const letter = document.createElement("small");
        letter.textContent = key.toUpperCase();
        keycap.append(letter);
      }
      keycap.dataset.state = index < run.buffer.length ? "done" : index === run.buffer.length ? "current" : "next";
      keycap.title = `${index + 1}打目：${key.toUpperCase()} キー`;
      guide.append(keycap);
    }
  } else guide.textContent = mode === "ime" ? "漢字・句読点まで、見たとおりに。" : mode === "benchmark" ? "ガイドなし / 定点測定" : "自分の指で、思い出してみよう。";
  for (const key of keys) {
    // 開始前（ready）から次のキーを光らせ、最初の一打の位置が分かるようにする
    const next = visible && (state === "running" || state === "ready") && run.nextKeys.includes(key.dataset.key ?? "");
    key.dataset.next = String(next);
    key.disabled = mode === "ime" || method() !== "touch" || state !== "running";
    const label = visible ? keyLegend(run.buffer, key.dataset.key ?? "") : "";
    const legend = key.querySelector("strong");
    if (legend) legend.textContent = label;
    key.setAttribute("aria-label", `${key.dataset.key?.toUpperCase()} キー${label ? `、${label}` : ""}`);
  }
}

function keepPromptCursorVisible(): void {
  if (material() !== "paragraph") return;
  const prompt = element("lab-prompt");
  const current = prompt.querySelector<HTMLElement>('[aria-current="true"]');
  if (!current || prompt.clientHeight === 0) return;
  const viewport = prompt.getBoundingClientRect();
  const cursor = current.getBoundingClientRect();
  if (cursor.top < viewport.top + 4 || cursor.bottom > viewport.bottom - 4) {
    prompt.scrollTo({ top: prompt.scrollTop + cursor.top - viewport.top - prompt.clientHeight / 3, behavior: "instant" });
  }
}

function renderPrompt(): void {
  if (run.complete) return;
  element("lab-meaning").textContent = run.passage.text;
  element("lab-topic").textContent = run.passage.topic;
  element("lab-counter").textContent = timed() ? `第${run.passageIndex + 1}${material() === "paragraph" ? "話" : "文"}` : `${run.passageIndex + 1} / ${run.passages.length}`;
  const nextPassage = run.passages[run.passageIndex + 1];
  element("lab-next").textContent = nextPassage ? `NEXT  ${material() === "paragraph" ? nextPassage.topic : nextPassage.text}` : "この文で、ひと区切り。";
  const prompt = element("lab-prompt");
  const scrollTop = prompt.scrollTop;
  prompt.replaceChildren();
  if (mode === "ime") {
    prompt.textContent = run.passage.reading;
    prompt.classList.add("lab-ime-reading");
  } else {
    prompt.classList.remove("lab-ime-reading");
    for (const [index, token] of run.tokens.entries()) {
      const span = document.createElement("span");
      span.textContent = token.text;
      span.dataset.state = index < run.tokenIndex ? "done" : index === run.tokenIndex ? "current" : "next";
      if (index === run.tokenIndex) span.setAttribute("aria-current", "true");
      prompt.append(span);
    }
  }
  prompt.scrollTo({ top: scrollTop, behavior: "instant" });
  keepPromptCursorVisible();
  renderHint();
}

function renderMetrics(): void {
  const now = performance.now();
  const seconds = run.elapsed(now) / 1000;
  const accuracy = mode === "ime" ? (imeTotal ? imeCorrect / imeTotal * 100 : 100) : run.accuracy;
  element("lab-cpm").textContent = seconds >= 1 ? String(Math.round(run.cpm(now))) : "—";
  element("lab-accuracy").textContent = (mode === "ime" ? imeTotal : run.attempts) ? `${accuracy.toFixed(1)}%` : "—";
  element("lab-errors").textContent = String(mode === "ime" ? imeTotal - imeCorrect : run.errors);
  element("lab-clock").textContent = state === "running" || state === "paused" ? timed() ? `${Math.max(0, duration() - Math.floor(seconds))} s` : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}` : state === "ready" ? mode === "focus" ? `${duration()} s` : "READY" : "COMPLETE";
  element<HTMLProgressElement>("lab-progress").value = timed() ? Math.min(100, seconds / duration() * 100) : run.completed / run.passages.reduce((total, passage): number => total + passage.reading.length, 0) * 100;
  element("lab-pace").textContent = pace && mode === "speed" ? `${sprinting() ? "目標" : "目安"} ${pace}かな/分 · ${seconds >= 1 ? `${Math.round(run.completed - pace * seconds / 60)}文字` : sprinting() ? "自己ベスト＋8%" : "過去の同条件中央値＋3%"}` : sprinting() ? "疾走の目標は、30〜120秒の自己ベストから作ります。" : mode === "ime" ? "変換後の文字で計測" : mode === "benchmark" ? "固定文 v1 / 60秒 / ガイドなし" : "正確さを保って、少しずつ。";
  renderDaily();
}

function passages(): Passage[] {
  if (mode === "drill") return selectDrillPassages(profile, drillTargets, Math.random);
  if (freshMeasure()) {
    // 弱点を含む文は 3 割だけ（残り 7 割は得意な文）。IME は漢字を含む文章で変換まで
    if (mode === "ime") {
      const sentences = selectPassages(profile, "keyboard", "speed", level(), Date.now(), Math.random).filter((passage): boolean => passage.reading.length >= 10);
      return sentences.length ? sentences : [...benchmarkCorpus];
    }
    return drillTargets.length ? selectDrillPassages(profile, drillTargets, Math.random, 1 - measureWeakShare, 500) : selectPassages(profile, method(), "speed", level(), Date.now(), Math.random);
  }
  return selectPassages(profile, method(), mode, level(), Date.now(), Math.random, focus, material());
}

function prepare(retryPassages?: Passage[]): void {
  cancelPreview();
  sound.setActive(false);
  sessionSound = undefined;
  delete element("lab-result").dataset.celebrate;
  clearInterval(timer);
  clearInterval(restTimer);
  state = "ready";
  syncMethod();
  if (mode === "drill") drillTargets = weakTargets(profile, method(), Date.now());
  else if (measuring) drillTargets = measurePlan?.kind === "fresh" ? measurePlan.targets : [];
  run = new TrainingRun(retryPassages ?? passages());
  lastHintRender = "";
  manualHint = false;
  imeValue = "";
  imeFinished = 0;
  imeCorrect = 0;
  imeTotal = 0;
  composing = false;
  imeInput.value = "";
  imeInput.disabled = true;
  app.dataset.state = state;
  app.dataset.mode = mode;
  app.dataset.measuring = String(measuring);
  app.dataset.method = effectiveMethod();
  app.dataset.material = material();
  const prompt = element("lab-prompt");
  if (material() === "paragraph") {
    prompt.tabIndex = 0;
    prompt.setAttribute("role", "group");
  } else {
    prompt.removeAttribute("tabindex");
    prompt.removeAttribute("role");
  }
  document.body.dataset.trainingFocus = String(mode === "focus");
  element("lab-focus-toolbar").hidden = mode !== "focus";
  element("lab-focus-result").hidden = mode !== "focus";
  element("lab-focus-shortcut").hidden = mode !== "focus" || method() !== "keyboard";
  delete app.dataset.error;
  lockSettings(false);
  hintsSelect.disabled = mode === "benchmark";
  element("lab-stage-control").hidden = timed();
  element("lab-duration-control").hidden = mode !== "speed" && mode !== "focus";
  // 疾走（15 秒）は高速化モード専用。集中モードで選ばれていたら標準に戻す
  const sprintOption = durationSelect.querySelector<HTMLOptionElement>(`option[value="${sprintDuration}"]`);
  if (sprintOption) {
    sprintOption.hidden = mode !== "speed";
    sprintOption.disabled = mode !== "speed";
    if (mode !== "speed" && durationSelect.value === String(sprintDuration)) durationSelect.value = "60";
  }
  element("lab-material-control").hidden = mode !== "speed" && mode !== "focus";
  element("lab-hints-control").hidden = mode === "ime" || mode === "benchmark";
  element("lab-ime-area").hidden = mode !== "ime";
  element("lab-keyboard").hidden = mode === "ime";
  element("lab-result").hidden = true;
  element("lab-rest").hidden = true;
  element("lab-abandon").hidden = true;
  pauseButton.hidden = true;
  startButton.hidden = false;
  startButton.disabled = false;
  startButton.textContent = mode === "focus" ? `${duration()}秒、集中する ↗` : mode === "benchmark" ? "60秒の定点測定を始める ↗" : mode === "ime" ? "60秒の実入力を始める ↗" : mode === "drill" ? `${drillDuration}秒、弱点を狙う ↗` : sprinting() ? "15秒、限界を試す ↗" : "練習をはじめる ↗";
  element<HTMLButtonElement>("lab-show-hint").disabled = mode === "benchmark" || mode === "ime";
  for (const button of modeButtons) button.setAttribute("aria-pressed", String(!auto && button.dataset.mode === mode));
  autoButton.setAttribute("aria-pressed", String(auto));
  measureButton.setAttribute("aria-pressed", String(measuring));
  element("lab-manual-label").textContent = auto ? "" : `現在：${names[mode]}`;
  element("lab-auto-hint").textContent = mode === "ime" ? "IME で固定文 60 秒。変換後の文字で計測" : auto && plan ? `次：${plan.title}` : "記録から今日のメニューを自動で決めます";
  const currentStage = curriculum[level()];
  element("lab-plan-title").textContent = timed() ? names[mode] : `${level() + 1}. ${currentStage.name}`;
  element("lab-plan-description").textContent = mode === "learn" ? currentStage.detail : mode === "review" ? "未定着・遅い文字・復習時期の文字を含む語や文を多めに。得意な文字も混ぜます。" : mode === "focus" ? "短く打って、結果を振り返る。Enterで同じ条件の次の一本へ。" : mode === "speed" ? (sprinting() ? "自己ベスト+8%を目標に15秒だけ全力。上限を押し上げたら、60秒で正確さを取り戻す。" : "自然な文章で流れを作る。95%以上の正確さを保って、少しずつ速く。") : mode === "drill" ? (drillTargets.length ? "本人の中央値より遅いかな・2打鍵を自動で選び、それを含む文7割・得意な文3割で45秒。" : "弱点を選ぶには記録が足りません。習得・復習・高速化を数回重ねると、ここに狙いが出ます。今回は通常の短文で。") : mode === "benchmark" ? "学習用とは別の固定文。同じ入力方法・同じ60秒で、日を空けて測りましょう。" : "導入済みIMEで漢字変換まで。新月配列をオンにして、日本語入力へ切り替えてください。";
  element("lab-session-label").textContent = `${auto && mode !== "ime" ? "自動 · " : ""}${names[mode]} / ${timed() ? "CONTINUOUS FLOW" : "ADAPTIVE PRACTICE"}`;
  if (auto && plan && mode === plan.mode) {
    element("lab-plan-title").textContent = plan.title;
    element("lab-plan-description").textContent = plan.reason;
  }
  if (measuring && measurePlan) {
    element("lab-plan-title").textContent = measurePlan.title;
    element("lab-plan-description").textContent = measurePlan.reason;
    element("lab-session-label").textContent = `測る · ${measurePlan.kind === "anchor" ? "定点" : "別の文"} / 60秒`;
    startButton.textContent = measurePlan.kind === "anchor" ? "60秒の定点測定を始める ↗" : "60秒、別の文で測る ↗";
  }
  element("lab-measure-bar").hidden = true;
  element("lab-loop-growth").hidden = true;
  element("lab-cpm-label").textContent = mode === "ime" ? "変換後の文字 / 分" : "かな / 分";
  element("lab-accuracy-label").textContent = mode === "ime" ? "確定文の一致率" : "打鍵正確率";
  element("lab-errors-label").textContent = mode === "ime" ? "不一致文字" : "ミス打鍵";
  element("lab-focus").textContent = mode === "drill" && drillTargets.length ? `狙う：${drillTargets.map((target): string => target.label).join(" · ")}` : focus ? `「${focus}」を含む、別の文脈で復習。` : mode === "review" ? "覚えているか、ガイドなしで一度試そう。" : mode === "ime" ? "修正も変換も含めた、実際の入力速度。" : "速さより、迷わず正確に。";
  element("lab-input-help").textContent = mode === "ime" ? "新月配列と日本語IMEをオンに。お題の「ー」はハイフン系表記でも可。文が一致すると次へ。予測変換・貼り付けは使いません。" : method() === "touch" ? "画面のキーを順番にタップ。スマホで配置を覚える練習です。PCの記録とは別に保存します。" : "IMEとOS側の新月配列リマップはオフに。英数・QWERTY状態で、D/Kも順番に押します。長音「ー」はD→P、またはハイフンキーでも入力できます。";
  const comparison = comparableResults(profile, signature()).slice(-5);
  pace = sprinting() ? sprintTarget(profile, method(), material()) : comparison.length >= 3 ? Math.round(median(comparison.map((result): number => result.cpm)) * 1.03) : 0;
  status(mode === "focus" ? "最初の打鍵から計測。時間が来たら結果を確認し、Enterで次の一本へ。" : "開始すると、最初の入力から計測します。", true);
  renderPrompt();
  renderMetrics();
  renderHistory();
}

function start(): void {
  if (state === "rest") return;
  if (state === "done") { if (measuring) applyMeasure(); else if (auto) applyPlan(); prepare(); }
  if (state !== "ready") return;
  state = "running";
  cancelPreview();
  element<HTMLDetailsElement>("lab-sound-panel").open = false;
  sound.setActive(true);
  if (sound.enabled) void sound.enable();
  closeFocusSettings();
  app.dataset.state = state;
  tokenEnteredAt = performance.now();
  lockSettings(true);
  startButton.hidden = true;
  pauseButton.hidden = false;
  pauseButton.textContent = timed() ? "中断する" : "一時停止";
  element("lab-abandon").hidden = false;
  imeInput.disabled = mode !== "ime";
  status("最初の入力から計測。速さより、正確に。", true);
  renderHint();
  const input = mode === "ime" ? imeInput : stage;
  input.focus({ preventScroll: true });
  input.scrollIntoView({ block: "nearest", behavior: "instant" });
  timer = setInterval(tick, 100);
}

function tick(): void {
  if (state !== "running") return;
  const now = performance.now();
  if (timed() && run.started && run.elapsed(now) >= duration() * 1000) {
    finish(false, now - (run.elapsed(now) - duration() * 1000));
    return;
  }
  run.sampleTrace(now);
  renderMetrics();
  renderHint();
}

function pause(): void {
  if (state !== "running") return;
  cancelPreview();
  if (timed()) { finish(true); return; }
  run.pause(performance.now());
  state = "paused";
  sound.setActive(false);
  app.dataset.state = state;
  pauseButton.textContent = "練習を再開";
  status("一時停止中。再開ボタンで戻れます。休んだ時間は計測しません。");
  renderHint();
}

function resume(): void {
  if (state !== "paused") return;
  run.resume(performance.now());
  tokenEnteredAt = performance.now();
  state = "running";
  sound.setActive(true);
  if (sound.enabled) void sound.enable();
  app.dataset.state = state;
  pauseButton.textContent = "一時停止";
  status("練習を再開しました。");
  stage.focus({ preventScroll: true });
  renderHint();
}

function extend(): void {
  if (timed() && run.passages.length - run.passageIndex <= 2) run.append(mode === "speed" || mode === "focus" || mode === "drill" || freshMeasure() ? passages() : benchmarkCorpus);
}

function feed(key: string): void {
  if (state !== "running" || mode === "ime") return;
  const now = performance.now();
  if (timed() && run.elapsed(now) >= duration() * 1000) { tick(); return; }
  extend();
  const previousPassage = run.passageIndex;
  const wasError = app.dataset.error === "true";
  const before = `${run.passageIndex}:${run.tokenIndex}`;
  captureSound();
  const correct = run.press(key, now);
  sound.key(correct);
  app.dataset.error = String(!correct);
  if (!correct) {
    status(mode === "benchmark" || hintsSelect.value === "off" ? "違うキーです。現在のかなから続けてください。" : `違うキーです。次は ${run.nextKeys.map((entry): string => entry.toUpperCase()).join(" または ")}。`);
    if (hintsSelect.value !== "off") manualHint = true;
  } else if (before !== `${run.passageIndex}:${run.tokenIndex}`) {
    tokenEnteredAt = now;
    manualHint = false;
  }
  if (run.complete) { finish(false, now); return; }
  if (run.passageIndex !== previousPassage) status(`次の課題：${run.passage.text}。読みは「${run.passage.reading}」。`, true);
  else if (correct && wasError) status("正しいキーです。そのまま続けましょう。", true);
  renderPrompt();
  renderMetrics();
}

function renderAnalysis(): void {
  const weak = element("lab-weak-list");
  const pairList = element("lab-pair-list");
  weak.replaceChildren();
  pairList.replaceChildren();
  const stats = profile[method()];
  const score = (kana: string): number => {
    const samples = run.assessmentSamples.filter((sample): boolean => sample.text === kana);
    return priority(stats[kana], Date.now()) + samples.reduce((total, sample): number => total + sample.errors * 10 + (sample.hinted ? 2 : 0), 0)
      + median(samples.filter((sample): boolean => sample.milliseconds > 0).map((sample): number => sample.milliseconds / sample.strokes)) / 1200;
  };
  const candidates = [...new Set(run.assessmentSamples.map((sample): string => sample.text))].sort((left, right): number => score(right) - score(left)).slice(0, 4);
  for (const kana of candidates) {
    const samples = run.assessmentSamples.filter((sample): boolean => sample.text === kana);
    const mistakes = samples.reduce((total, sample): number => total + sample.errors, 0);
    const item = document.createElement("li");
    item.textContent = `「${kana}」 ${samples.length}回 · ${mistakes}ミス · ${samples.some((sample): boolean => sample.hinted) ? "ガイド使用" : "自力"}`;
    weak.append(item);
  }
  const pairStats = profile.pairs[method()];
  const slow = Object.entries(pairStats).filter(([, stat]): boolean => stat.samples >= 4).sort(([, left], [, right]): number => right.milliseconds - left.milliseconds).slice(0, 4);
  for (const [pair, stat] of slow) {
    const item = document.createElement("li");
    item.textContent = `${Array.from(pair).join(" → ").toUpperCase()}  ${Math.round(stat.milliseconds)}ms · ${stat.samples}標本`;
    pairList.append(item);
  }
  if (!candidates.length || mode === "ime") weak.textContent = mode === "ime" ? "IME内の物理打鍵は採点しません。" : "完了した文字がまだありません。";
  if (!slow.length || mode === "ime") pairList.textContent = mode === "ime" ? "変換後の文章の一致を評価します。" : "4標本以上の組み合わせが集まると表示します。";
  nextFocus = candidates.find((kana): boolean => run.assessmentSamples.some((sample): boolean => sample.text === kana && (sample.errors > 0 || sample.hinted))) ?? slow[0]?.[0] ?? candidates[0] ?? "";
  element<HTMLButtonElement>("lab-target-review").hidden = !nextFocus || mode === "ime" || measuring;
}

function renderDrillReport(): void {
  const report = element("lab-drill-report");
  const list = element("lab-drill-list");
  report.hidden = (mode !== "drill" && !freshMeasure()) || !drillTargets.length;
  if (report.hidden) return;
  list.replaceChildren();
  const changes = drillChanges(drillTargets, run.assessmentSamples, run.pairs);
  let faster = 0;
  for (const change of changes) {
    const item = document.createElement("li");
    const measured = change.samples > 0 && change.after > 0;
    item.dataset.trend = !measured || !change.before ? "none" : change.after <= change.before * .95 ? "faster" : change.after >= change.before * 1.05 ? "slower" : "same";
    if (item.dataset.trend === "faster") faster += 1;
    const name = document.createElement("strong");
    name.textContent = change.target.label;
    const value = document.createElement("span");
    value.textContent = measured ? `${change.before}ms → ${change.after}ms · ${change.samples}標本` : "この回は標本なし";
    item.append(name, value);
    list.append(item);
  }
  if (changes.length && freshMeasure()) {
    element("lab-advice-title").textContent = faster >= Math.ceil(changes.length / 2) ? "混ぜた弱点が、速くなってきた。" : "混ぜた弱点は、まだ遅い。";
    element("lab-advice").textContent = "この回は弱点を含む文を3割だけ混ぜました。1回で決めず、次の一本・数日後も同じ文字が残るかを見ます。弱点は記録から自動で選び直します。";
  } else if (changes.length) {
    element("lab-advice-title").textContent = faster >= Math.ceil(changes.length / 2) ? "狙いどおり。日を空けて、もう一度。" : "まだ遅い。同じ弱点を、別の文で。";
    element("lab-advice").textContent = faster >= Math.ceil(changes.length / 2) ? "半数以上の弱点が速くなりました。1回の改善は一時的なこともあるので、明日以降の弱点ドリルで同じ項目が消えているかを確かめましょう。" : "弱点は本人比で選び直されます。もう一本の弱点ドリルか、遅い2打鍵を意識しながらの高速化60秒で、指の順序を身体に入れましょう。";
  }
}

function renderHeatMap(): void {
  const map = element("lab-heat-map");
  map.replaceChildren();
  const heats = new Map(keyHeat(profile.pairs[method()]).map((heat): [string, typeof heat] => [heat.key, heat]));
  for (const row of layoutData.layers[0].keys) {
    const line = document.createElement("div");
    line.className = "keyboard-row";
    for (const key of row) {
      const heat = heats.get(key);
      const cell = document.createElement("span");
      const measured = heat !== undefined && heat.level >= 0;
      cell.dataset.heat = measured ? "measured" : "none";
      cell.style.setProperty("--heat", measured ? heat.level.toFixed(2) : "0");
      const label = document.createElement("small");
      label.textContent = measured ? `${heat.milliseconds}ms` : "—";
      cell.append(key.toUpperCase(), label);
      cell.title = measured ? `${key.toUpperCase()}：このキーへ移る平均 ${heat.milliseconds}ms · ${heat.samples}標本` : `${key.toUpperCase()}：3標本未満`;
      line.append(cell);
    }
    map.append(line);
  }
  const measured = [...heats.values()].filter((heat): boolean => heat.level >= 0);
  map.hidden = mode === "ime";
  element("lab-heat-note").textContent = mode === "ime" ? "IME実践では物理打鍵を記録しません。" : measured.length ? `濃いほど遅い。3標本未満のキーは灰色。いちばん遅いキーは ${[...measured].sort((left, right): number => right.milliseconds - left.milliseconds).slice(0, 3).map((heat): string => `${heat.key.toUpperCase()} ${heat.milliseconds}ms`).join("、")}。` : "PC・タップで練習すると、キーごとの打鍵間隔がここに表示されます。";
}

function drawChart(): void {
  const values = run.trace;
  const max = Math.max(20, ...values.map((value): number => value.cpm));
  const end = Math.max(1, run.elapsed(performance.now()) / 1000);
  const path = values.map((value, index): string => `${index ? "L" : "M"}${(35 + value.second / end * 585).toFixed(1)},${(140 - value.cpm / max * 120).toFixed(1)}`).join(" ");
  document.getElementById("lab-chart-line")?.setAttribute("d", path);
  element("lab-chart-max").textContent = String(Math.round(max));
  element("lab-chart-end").textContent = `${Math.round(end)}秒`;
  const rhythmValue = rhythm(run.intervals);
  element("lab-chart-note").textContent = mode === "ime" ? "縦軸：変換後の文字/分 · 横軸：経過秒。未確定の変換は含みません。" : `縦軸：かな/分 · 横軸：経過秒。累積平均。リズム ${rhythmValue === null ? "—（10標本未満）" : `${rhythmValue}/100（独自参考値）`}。`;
}

function finish(interrupted: boolean, now = performance.now(), showResult = true): void {
  if (state !== "running" && state !== "paused") return;
  cancelPreview();
  trackSound();
  const resultSound = sessionSound;
  sound.setActive(false);
  clearInterval(timer);
  run.interrupted ||= interrupted;
  run.sampleTrace(now);
  run.pause(now);
  state = "done";
  app.dataset.state = state;
  imeInput.disabled = true;
  composing = false;
  pauseButton.hidden = true;
  element("lab-abandon").hidden = true;
  startButton.hidden = false;
  startButton.textContent = measuring ? "次の一本へ ↗" : "次の練習へ ↗";
  lockSettings(false);
  hintsSelect.disabled = mode === "benchmark";
  const seconds = run.elapsed(now) / 1000;
  if (!run.started || seconds < .001) { prepare(); status("入力前に終了しました。記録は保存していません。"); return; }
  const result: TrainingResult = { date: new Date().toISOString(), mode, method: effectiveMethod(), material: material(), duration: seconds, stage: level(), cpm: run.cpm(now), accuracy: mode === "ime" ? (imeTotal ? imeCorrect / imeTotal * 100 : 0) : run.accuracy, kana: run.completed, attempts: mode === "ime" ? imeTotal : run.attempts, errors: mode === "ime" ? imeTotal - imeCorrect : run.errors, interrupted: run.interrupted, assisted: run.assisted, signature: signature() };
  result.sound = resultSound;
  const priorMilestones = new Set(progressMilestones(profile.results.filter((entry): boolean => entry.method === result.method)).filter((milestone): boolean => milestone.earned).map((milestone): string => milestone.id));
  const previous = comparableResults(profile, result.signature);
  const previousBest = Math.max(0, ...previous.map((entry): number => entry.cpm));
  saveSession(profile, result, run.assessmentSamples, run.pairs, run.passages.slice(0, run.passageIndex + (material() === "paragraph" ? 1 : 0)).map((passage): string => passage.id));
  persist();
  if (!showResult) return;
  const comparable = comparableResults(profile, result.signature).includes(result);
  const newMilestones = progressMilestones(profile.results.filter((entry): boolean => entry.method === result.method)).filter((milestone): boolean => milestone.earned && !priorMilestones.has(milestone.id));
  const milestoneMessage = element("lab-result-milestone");
  milestoneMessage.hidden = !newMilestones.length;
  milestoneMessage.textContent = newMilestones.length ? `新しいしるし：${newMilestones.map((milestone): string => milestone.title).join(" / ")}` : "";
  const recent = previous.slice(-5);
  const difference = result.cpm - median(recent.map((entry): number => entry.cpm));
  element("lab-result-growth").textContent = comparable && recent.length >= 5 ? `前の同条件5回の中央値より ${difference >= 0 ? "+" : ""}${Math.round(difference)}${mode === "ime" ? "字" : "かな"}/分。音条件は混在。積み重ねは成長グラフで。` : comparable ? `比較できる記録が${previous.length + 1}回に。5回揃うと、いつものペースが見えてきます。` : "この結果も履歴に残ります。自己ベストの比較には、ガイドなし・正確率95%以上などの条件があります。";
  const celebrate = !interrupted && (newMilestones.length > 0 || (comparable && previous.length > 0 && result.cpm > previousBest));
  element("lab-result").dataset.celebrate = String(celebrate);
  if (celebrate && !document.hidden) sound.celebrate();
  element("lab-result-tag").textContent = interrupted ? "中断 · 参考記録" : comparable && result.cpm > previousBest ? "同条件での自己ベスト" : result.assisted ? "ガイドあり · 学習記録" : comparable ? "比較可能な記録" : "参考記録";
  element("lab-result-summary").textContent = `${Math.round(result.cpm)} ${mode === "ime" ? "変換後の文字" : "かな"}/分 · ${mode === "ime" ? "一致率" : "打鍵正確率"} ${result.accuracy.toFixed(1)}% · ${result.kana}文字 · ${Math.round(seconds)}秒。${method() === "touch" && mode !== "ime" ? "タップの記録です。PC速度とは比較しません。" : ""}`;
  element("lab-result-title").textContent = interrupted ? "ここで、ひと区切り。" : "一歩、指に馴染んだ。";
  element("lab-advice-title").textContent = mode === "ime" ? "実際の仕事へ、つなげよう。" : result.accuracy < 95 ? "少し速度を落とし、正確に。" : result.assisted ? "次は、ガイドを少し減らす。" : "別の文でも、同じように。";
  element("lab-advice").textContent = mode === "ime" ? "変換の修正時間も含めた結果です。候補の選択で迷った語は、実際に使う文の中で試しましょう。" : result.accuracy < 95 ? "まずミスした文字を含む短文を復習。正確さが戻ってから、高速化へ進みましょう。" : result.assisted ? "ガイドを見ずに思い出す練習へ。自動ガイドは、迷ったときや誤打時にだけ戻ります。" : "今できたことが、明日もできるか。日を空けた復習と定点測定で確かめましょう。速さは正確さを保てる範囲で。";
  if (sprinting()) {
    const advice = sprintAdvice(result.cpm, result.accuracy, pace);
    element("lab-advice-title").textContent = advice.title;
    element("lab-advice").textContent = advice.body;
  }
  renderDrillReport();
  renderAnalysis();
  element("lab-focus-cpm").textContent = String(Math.round(result.cpm));
  element("lab-focus-accuracy").textContent = `${result.accuracy.toFixed(1)}%`;
  element("lab-focus-summary").textContent = `${result.kana}文字 · ${Math.round(seconds)}秒${result.material === "paragraph" ? " · 文章" : ""} · ${methodNames[result.method]}${result.method === "touch" ? "（PC速度とは比較しません）" : ""}`;
  element("lab-focus-tip").textContent = `${element("lab-advice-title").textContent}${nextFocus ? ` 次は「${/[a-z;]/.test(nextFocus) ? pairLabel(nextFocus) : nextFocus}」を意識して。` : ""}`;
  element("lab-focus-storage").textContent = storageAvailable ? "この端末に保存しました。履歴は「モード選択」から。" : "この環境では記録を保存できません。「モード選択」から記録を書き出してください。";
  drawChart();
  renderHint();
  renderMetrics();
  renderHistory();
  const resultPanel = element("lab-result");
  resultPanel.hidden = false;
  status(interrupted ? "中断記録として保存しました。自己ベストには含めません。" : "練習が終わりました。結果と次の一手を確認できます。");
  if (measuring && !document.hidden) {
    // ループ中は結果を画面の上に出す（下までスクロールさせない）。フォーカスを置き、Enter / Space ですぐ次へ
    window.scrollTo({ top: 0, behavior: "instant" });
    resultPanel.focus({ preventScroll: true });
  } else if ((!interrupted || mode === "focus") && !document.hidden) { resultPanel.focus({ preventScroll: true }); resultPanel.scrollIntoView({ block: "nearest" }); }
  renderRate(result);
  if (measuring) { renderMeasureNext(result, interrupted); renderLoopGrowth(result); }
  if (!interrupted && mode !== "focus" && !measuring) beginRest();
}

function retry(): void {
  if (mode !== "focus" || state !== "done") return;
  start();
}

function restart(): void {
  if ((mode !== "focus" && !measuring) || (state !== "ready" && state !== "running" && state !== "done")) return;
  const retryPassages = [...run.passages];
  if (state === "running") finish(true, performance.now(), false);
  prepare(retryPassages);
  start();
  status("同じ課題を最初から。次の打鍵から計測します。", true);
}

// 指の速さ（打/秒）。IME は物理打鍵を記録しないので、タップは PC と比べないので出さない
function renderRate(result: TrainingResult): void {
  const line = element("lab-rate");
  line.hidden = !timed() || result.method !== "keyboard" || result.duration < 15;
  if (line.hidden) return;
  const best = bestKeystrokeRate(profile, "keyboard");
  const main = document.createElement("strong");
  main.textContent = `指の速さ ${keystrokeRate(result).toFixed(1)}打/秒${best > 0 ? `（自己ベスト ${best.toFixed(1)}）` : ""}`;
  const note = document.createElement("small");
  note.textContent = "ミスも含めた押下回数 ÷ 秒。";
  line.replaceChildren(main, note);
}

// ループの成長曲線。横軸は時刻ではなく回数（数分おきに回しても点が潰れない）。同じ条件の直近30回
function renderLoopGrowth(result: TrainingResult): void {
  const figure = element("lab-loop-growth");
  const points = growthSeries(profile.results, result.signature, 0).slice(-30);
  figure.hidden = points.length < 2;
  if (figure.hidden) return;
  const svg = element("lab-loop-chart");
  const ns = "http://www.w3.org/2000/svg";
  const values = points.map((point): number => point.result.cpm);
  const low = Math.max(0, Math.floor(Math.min(...values) * .9 / 10) * 10);
  const high = Math.max(low + 10, Math.ceil(Math.max(...values) * 1.05 / 10) * 10);
  const x = (index: number): number => 44 + index * 580 / Math.max(1, points.length - 1);
  const y = (value: number): number => 128 - (value - low) / (high - low) * 112;
  const node = (name: string, attributes: Record<string, string | number>, text = ""): SVGElement => {
    const created = document.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attributes)) created.setAttribute(key, String(value));
    if (text) created.textContent = text;
    return created;
  };
  const children: SVGElement[] = [
    node("path", { class: "lab-chart-grid", d: "M44 16V128H624" }),
    node("text", { x: 38, y: 20, "text-anchor": "end" }, String(high)),
    node("text", { x: 38, y: 131, "text-anchor": "end" }, String(low)),
    node("text", { x: 44, y: 146 }, `${points.length}回前`),
    node("text", { x: 624, y: 146, "text-anchor": "end" }, "今回"),
  ];
  const medians = points.map((point, index): string => point.median === null ? "" : `${x(index).toFixed(1)},${y(point.median).toFixed(1)}`).filter(Boolean);
  if (medians.length >= 2) children.push(node("polyline", { class: "lab-loop-median", points: medians.join(" ") }));
  points.forEach((point, index): void => {
    children.push(node("circle", { class: point.eligible ? "lab-loop-dot" : "lab-loop-dot lab-loop-dot-muted", cx: x(index).toFixed(1), cy: y(point.result.cpm).toFixed(1), r: index === points.length - 1 ? 5 : 3.5 }));
  });
  svg.replaceChildren(...children);
  const latestMedian = [...points].reverse().find((point): boolean => point.median !== null)?.median ?? null;
  const unit = result.method === "ime" ? "字" : "かな";
  svg.setAttribute("aria-label", `同じ条件の直近${points.length}回の入力速度。今回 ${Math.round(result.cpm)}${unit}/分${latestMedian === null ? "" : `、直近5回の中央値 ${Math.round(latestMedian)}${unit}/分`}。`);
  element("lab-loop-growth-title").textContent = `成長曲線 · ${measurePlan?.kind === "anchor" ? "定点（固定文）" : "別の文・60秒"}の直近${points.length}回`;
  element("lab-loop-growth-note").textContent = `● 比較できる記録　○ ガイドあり・正確率95%未満・中断など　線：直近5回の中央値（比較できる記録が5回そろうと出ます）。縦軸は${unit}/分。`;
}

function renderMeasureNext(result: TrainingResult, interrupted: boolean): void {
  if (!interrupted) measureSeconds += result.duration;
  const upcoming = planMeasure(profile, methodSelect.value === "ime" ? "ime" : method(), Date.now());
  const line = element("lab-measure-next");
  element("lab-measure-bar").hidden = false;
  // 休憩は強制しない（結果を見ている間が休み）。長く続いたら短い休止を勧める（OSHA）
  const rest = measureSeconds >= measureBreakSeconds ? "20分続きました。1〜2分、手を離して肩の力を抜きましょう。痛み・しびれがあれば今日はここまで。 " : "";
  line.textContent = `${rest}次：${upcoming.title}。Enter か Space で始まり、最初の打鍵から計測。Esc で同じ文をもう一度。`;
  if (measurePlan?.kind === "anchor" && !interrupted) element("lab-result-tag").textContent = `定点 · ${element("lab-result-tag").textContent}`;
}

function startMeasure(): void {
  if (state === "running" || state === "paused") return;
  clearInterval(restTimer);
  restTimer = undefined;
  element("lab-rest").hidden = true;
  if (!measuring) measureSeconds = 0;
  measuring = true;
  auto = false;
  focus = "";
  closeFocusSettings();
  applyMeasure();
  prepare();
  start();
}

function leaveMeasure(): void {
  measuring = false;
  measurePlan = undefined;
  app.dataset.measuring = "false";
}

function endRest(): void {
  clearInterval(restTimer);
  restTimer = undefined;
  if (state !== "rest") return;
  state = "done";
  app.dataset.state = state;
  startButton.disabled = false;
  startButton.textContent = "次の練習へ ↗";
  element("lab-rest").hidden = true;
}

function beginRest(): void {
  state = "rest";
  app.dataset.state = state;
  restUntil = Date.now() + 20_000;
  startButton.disabled = true;
  element("lab-rest").hidden = false;
  const update = (): void => {
    const remaining = Math.max(0, Math.ceil((restUntil - Date.now()) / 1000));
    element("lab-rest-text").textContent = `あと${remaining}秒を目安に、手を離して一息。痛みやしびれがあれば、今日はここで終了しましょう。`;
    if (remaining === 0) endRest();
  };
  update();
  restTimer = setInterval(update, 250);
}

function processIme(): void {
  if (state !== "running" || mode !== "ime" || composing) return;
  const value = imeInput.value.normalize("NFC");
  if (value === imeValue) return;
  captureSound();
  run.start(performance.now());
  if (run.elapsed(performance.now()) >= 60_000) { tick(); return; }
  imeValue = value;
  const target = Array.from(run.passage.text.normalize("NFC"));
  const characters = Array.from(value);
  let prefix = 0;
  while (prefix < characters.length && prefix < target.length && matchesTrainingCharacter(characters[prefix], target[prefix])) prefix += 1;
  imeCorrect = imeFinished + prefix;
  imeTotal = imeFinished + characters.length;
  run.completed = imeCorrect;
  app.dataset.error = String(prefix < characters.length);
  sound.key(prefix === characters.length);
  if (prefix < characters.length) status(`${prefix + 1}文字目が一致しません。変換やBackspaceで修正してください。`);
  if (prefix === target.length && characters.length === target.length) {
    imeFinished += target.length;
    extend();
    run.passageIndex += 1;
    imeInput.value = "";
    imeValue = "";
    status("文が一致しました。次の文へ。");
    renderPrompt();
  }
  renderMetrics();
}

element("lab-sound-toggle").addEventListener("click", async (): Promise<void> => {
  cancelPreview();
  if (sound.enabled) sound.mute();
  else {
    await sound.enable();
    sound.setActive(state === "running");
    if (sound.settings.bgm === "off" && sound.settings.se === "off") element("lab-sound-status").textContent = "音のアトリエでBGM・打鍵音を選んでください。";
  }
  trackSound();
  renderSound();
  if (state === "running") (mode === "ime" ? imeInput : stage).focus({ preventScroll: true });
});
element<HTMLSelectElement>("lab-bgm").addEventListener("change", (event): void => {
  sound.configure({ bgm: (event.target as HTMLSelectElement).value as BgmPreset });
  trackSound();
  renderSound();
});
element<HTMLSelectElement>("lab-se").addEventListener("change", (event): void => {
  sound.configure({ se: (event.target as HTMLSelectElement).value as KeySound });
  trackSound();
  renderSound();
});
for (const id of ["bgm", "se"] as const) element<HTMLInputElement>(`lab-${id}-volume`).addEventListener("input", (event): void => {
  const volume = Number((event.target as HTMLInputElement).value) / 100;
  sound.configure(id === "bgm" ? { bgmVolume: volume } : { seVolume: volume });
  trackSound();
  renderSound();
});
element("lab-sound-preview").addEventListener("click", async (): Promise<void> => {
  cancelPreview();
  const generation = previewGeneration;
  if (!await sound.enable() || generation !== previewGeneration) return;
  sound.setActive(true);
  sound.key(true);
  trackSound();
  renderSound();
  previewTimer = setTimeout((): void => sound.setActive(state === "running"), 3000);
});
element("lab-quest-start").addEventListener("click", (): void => {
  if (state === "running" || state === "paused") return;
  auto = false;
  if (mode !== "ime") mode = element("lab-quest-start").dataset.quest === "drill" ? "drill" : "review";
  focus = "";
  hintsSelect.value = "auto";
  prepare();
  start();
});
document.addEventListener("pointerdown", (event): void => {
  if (event.target instanceof Element && !event.target.closest(".lab-soundbar")) element<HTMLDetailsElement>("lab-sound-panel").open = false;
});
element("lab-sound-panel").addEventListener("keydown", (event): void => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  element<HTMLDetailsElement>("lab-sound-panel").open = false;
  element("lab-sound-panel").querySelector("summary")?.focus();
});
window.addEventListener("pagehide", (): void => { cancelPreview(); sound.mute(); });
renderSound();

startButton.addEventListener("click", start);
for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href="#lab-how"], a[href="#lab-evidence"]')) link.addEventListener("click", (): void => {
  const wrap = document.getElementById("lab-how") as HTMLDetailsElement | null;
  if (wrap) wrap.open = true;
});
autoButton.addEventListener("click", (): void => {
  if (state === "running" || state === "paused") return;
  leaveMeasure();
  auto = true;
  focus = "";
  closeFocusSettings();
  applyPlan();
  prepare();
  start();
});
// 測る: 固定文 60 秒（IME が選ばれていれば prepare 内で ime に切り替わる）
// 測る: その日の最初は固定文、以降は別の文で 60 秒をくり返す（IME が選ばれていれば IME で）
measureButton.addEventListener("click", (): void => {
  if (mode !== "focus") returnMode = mode;
  startMeasure();
});
// ループの操作。Tab はフォーカス移動に残す（キーボードだけで画面を操作できるように）
document.addEventListener("keydown", (event): void => {
  if (!measuring || event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.closest("input, select, textarea, summary, [contenteditable]")) return;
  if (event.key === "Escape" && (state === "running" || state === "done")) {
    event.preventDefault();
    restart();
    return;
  }
  if ((event.key === "Enter" || event.key === " ") && state === "done" && !target.closest("button, a")) {
    event.preventDefault();
    startMeasure();
  }
});
element("lab-retry").addEventListener("click", retry);
element("lab-measure-go").addEventListener("click", startMeasure);
document.addEventListener("keydown", (event): void => {
  if (mode !== "focus" || event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.closest("input, select, textarea, [contenteditable]")) return;
  if (event.key === "Escape") {
    if (target !== document.body && !target.closest(".lab-console, #lab-result")) return;
    event.preventDefault();
    restart();
    return;
  }
  if (state !== "done" || event.key !== "Enter" || target.closest("button, a")) return;
  if (target !== document.body && target !== stage && !element("lab-result").contains(target)) return;
  event.preventDefault();
  retry();
});
element("lab-focus-settings").addEventListener("click", (): void => {
  if (state === "running" || state === "paused") return;
  const open = app.dataset.focusSettings !== "true";
  app.dataset.focusSettings = String(open);
  element("lab-focus-settings").setAttribute("aria-expanded", String(open));
});
element("lab-focus-exit").addEventListener("click", (): void => {
  if (state === "running" || state === "paused") finish(true);
  mode = returnMode;
  focus = "";
  hintsSelect.value = mode === "speed" || mode === "benchmark" ? "off" : "auto";
  closeFocusSettings();
  prepare();
  modeButtons.find((button): boolean => button.dataset.mode === mode)?.focus();
});
pauseButton.addEventListener("click", (): void => { if (state === "paused") resume(); else pause(); });
element("lab-abandon").addEventListener("click", (): void => finish(true));
element("lab-rest-skip").addEventListener("click", endRest);
element("lab-show-hint").addEventListener("click", (): void => {
  manualHint = true;
  renderHint();
  if (state === "paused") resume();
  if (state === "running") stage.focus({ preventScroll: true });
});
for (const button of modeButtons) button.addEventListener("click", (): void => {
  if (mode !== "focus") returnMode = mode;
  leaveMeasure();
  auto = false;
  mode = button.dataset.mode as TrainingMode;
  focus = "";
  hintsSelect.value = mode === "speed" || mode === "benchmark" || mode === "focus" ? "off" : "auto";
  closeFocusSettings();
  prepare();
  if (mode === "focus") { startButton.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: "instant" }); }
});
for (const control of [methodSelect, levelSelect, durationSelect, hintsSelect, materialSelect]) control.addEventListener("change", (): void => {
  focus = "";
  // 入力方法・文章の種類が変わると自動メニューも変わる。秒数やヒントの手動調整は尊重する
  if (auto && (control === methodSelect || control === materialSelect)) applyPlan();
  if (measuring && control === methodSelect) applyMeasure();
  prepare();
});
element("lab-target-review").addEventListener("click", (): void => {
  const previousLevel = level();
  leaveMeasure();
  auto = false;
  mode = "review";
  levelSelect.value = String(previousLevel);
  hintsSelect.value = "auto";
  focus = nextFocus;
  prepare();
  startButton.focus();
  startButton.scrollIntoView({ block: "nearest" });
});

element("lab-prompt").addEventListener("keydown", (event): void => {
  if (material() !== "paragraph" || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"].includes(event.key)) return;
  const prompt = element("lab-prompt");
  const line = Number.parseFloat(getComputedStyle(prompt).lineHeight);
  const offsets: Record<string, number> = { ArrowDown: line, ArrowUp: -line, PageDown: prompt.clientHeight, PageUp: -prompt.clientHeight };
  const offset = offsets[event.key];
  const top = event.key === "Home" ? 0 : event.key === "End" ? prompt.scrollHeight : offset === undefined ? undefined : prompt.scrollTop + offset;
  if (top === undefined) return;
  event.preventDefault();
  prompt.scrollTo({ top, behavior: "instant" });
});

stage.addEventListener("keydown", (event): void => {
  if (event.defaultPrevented) return;
  if ((event.target !== stage && !(material() === "paragraph" && event.target === element("lab-prompt"))) || state !== "running" || mode === "ime" || method() !== "keyboard" || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
  if (event.key === "Escape") {
    if (mode !== "focus" && !measuring) { event.preventDefault(); pause(); }
    return;
  }
  if (event.key === "Tab") return;
  if (event.isComposing || event.keyCode === 229 || event.key === "Process" || event.key === "Dead" || (/[^\x00-\x7f]/.test(event.key) && !isLongMarkInput(event.key))) {
    status("シミュレーターではIMEとOSのキー変換をオフにしてください。導入済みIMEで打つ場合は「IME実践」へ。");
    return;
  }
  if (event.key === " " || event.key === "Backspace" || event.key === "Enter") {
    event.preventDefault();
    status("確定・削除は不要です。現在のかなから続けてください。");
    return;
  }
  const key = isLongMarkInput(event.key) ? "-" : codeToKey(event.code) ?? (event.key.length === 1 ? event.key.toLowerCase() : undefined);
  if (key) { event.preventDefault(); feed(key); }
});
for (const key of keys) {
  key.addEventListener("pointerdown", (event): void => { if (method() === "touch" && state === "running") event.preventDefault(); });
  key.addEventListener("click", (): void => {
    if (method() !== "touch") return;
    feed(key.dataset.key ?? "");
    if (state === "running") stage.focus({ preventScroll: true });
  });
}
imeInput.addEventListener("compositionstart", (): void => {
  if (state !== "running") return;
  composing = true;
  captureSound();
  run.start(performance.now());
});
imeInput.addEventListener("compositionend", (): void => { composing = false; queueMicrotask(processIme); });
imeInput.addEventListener("input", processIme);
imeInput.addEventListener("keydown", (event): void => { if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); pause(); } });
for (const type of ["paste", "drop"] as const) imeInput.addEventListener(type, (event): void => { event.preventDefault(); status("実入力の計測なので、貼り付け・ドロップは使わず入力してください。"); });
imeInput.addEventListener("beforeinput", (event): void => {
  if (event.inputType === "insertFromPaste" || event.inputType === "insertFromDrop") { event.preventDefault(); status("貼り付けは計測対象外です。"); }
});
for (const input of [stage, imeInput, element("lab-prompt")]) input.addEventListener("blur", (event): void => {
  const next = event.relatedTarget;
  if (material() === "paragraph" && (next === stage || next === element("lab-prompt"))) return;
  if (next instanceof Element && (next.closest(".lab-key, .lab-soundbar") || ["lab-pause", "lab-abandon", "lab-show-hint", "lab-focus-exit"].includes(next.id))) return;
  if (state === "running") pause();
});
window.addEventListener("blur", (): void => { if (state === "running") pause(); });
window.addEventListener("resize", keepPromptCursorVisible);
document.addEventListener("visibilitychange", (): void => { if (document.hidden) { cancelPreview(); if (state === "running") pause(); } });

element("lab-export").addEventListener("click", (): void => {
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `shingetsu-training-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout((): void => URL.revokeObjectURL(url), 1000);
});
element<HTMLInputElement>("lab-import").addEventListener("change", async (event): Promise<void> => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 600_000) throw new Error("size");
    const raw = await file.text();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("version" in parsed) || parsed.version !== 1 || !("results" in parsed) || !Array.isArray(parsed.results) || !("keyboard" in parsed) || !("touch" in parsed)) throw new Error("format");
    if (!window.confirm("現在の練習記録を、このバックアップで置き換えますか？")) return;
    profile = readProfile(raw);
    persist();
    prepare();
    element("lab-data-status").textContent = "記録を読み込みました。不正な値は除外しています。";
  } catch { element("lab-data-status").textContent = "読み込めませんでした。このツールから書き出した600KB以下のJSONを選んでください。"; }
  finally { input.value = ""; }
});
element("lab-reset").addEventListener("click", (): void => {
  if (!window.confirm("新月タイピングの記録を削除しますか？トップページの20文字練習の記録には影響しません。")) return;
  profile = freshProfile();
  try { localStorage.removeItem(trainingStorageKey); storageAvailable = true; } catch { storageAvailable = false; }
  focus = "";
  prepare();
  element("lab-data-status").textContent = "この練習の記録を削除しました。";
});

if (auto) applyPlan();
prepare();
app.hidden = false;
