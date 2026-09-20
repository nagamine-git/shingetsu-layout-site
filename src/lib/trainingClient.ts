import { benchmarkCorpus, curriculum, type Passage } from "../data/trainingCorpus";
import { codeToKey, comparableResults, fingerHint, freshProfile, keyLegend, mastery, median, priority, readProfile, rhythm, saveSession, selectPassages, suggestedStage, trainingStorageKey, TrainingRun, type TrainingMethod, type TrainingMode, type TrainingProfile, type TrainingResult } from "./training";

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
const imeInput = element<HTMLTextAreaElement>("lab-ime-input");
const keys = [...app.querySelectorAll<HTMLButtonElement>(".lab-key")];
const modeButtons = [...app.querySelectorAll<HTMLButtonElement>("[data-mode]")];
const names: Record<TrainingMode, string> = { learn: "習得", review: "復習", speed: "高速化", benchmark: "定点測定", ime: "IME実践", focus: "集中" };
const methodNames: Record<TrainingMethod, string> = { keyboard: "PC", touch: "タップ", ime: "IME" };
let profile: TrainingProfile = freshProfile();
let storageAvailable = true;
try { profile = readProfile(localStorage.getItem(trainingStorageKey)); } catch { storageAvailable = false; }
let mode: TrainingMode = new URLSearchParams(location.search).get("mode") === "focus" ? "focus" : "learn";
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
let composing = false;
let imeFinished = 0;
let imeValue = "";
let imeCorrect = 0;
let imeTotal = 0;
let restUntil = 0;
let lastHintRender = "";

methodSelect.value = matchMedia("(pointer: coarse)").matches ? "touch" : "keyboard";
if (mode === "focus") hintsSelect.value = "off";

function method(): "keyboard" | "touch" { return methodSelect.value === "touch" ? "touch" : "keyboard"; }
function effectiveMethod(): TrainingMethod { return mode === "ime" ? "ime" : method(); }
function timed(): boolean { return mode === "speed" || mode === "benchmark" || mode === "ime" || mode === "focus"; }
function duration(): number { return mode === "speed" || mode === "focus" ? Number(durationSelect.value) : timed() ? 60 : 0; }
function level(): number { return timed() ? 5 : levelSelect.value === "auto" ? suggestedStage(profile[method()]) : Number(levelSelect.value); }
function signature(): string { return `${mode}:${effectiveMethod()}:${duration()}:${level()}:v1`; }
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
  for (const control of [methodSelect, levelSelect, durationSelect, hintsSelect, ...modeButtons]) control.disabled = locked;
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
    for (const text of [new Date(result.date).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }), `${names[result.mode]} / ${methodNames[result.method]}`, `${Math.round(result.cpm)} ${result.method === "ime" ? "字" : "かな"}/分`, `${result.accuracy.toFixed(1)}%`, conditions.join(" · ")]) {
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
  const due = Object.entries(profile[method()]).filter(([kana, skill]): boolean => kana.length === 1 && skill.due <= Date.now()).length;
  element("lab-due").textContent = mode === "ime" ? "IME実践はかなの習熟判定に含めません。" : due ? `${due}文字が復習の時期。復習モードで思い出しましょう。` : "復習の期限は、練習を重ねるとここに表示します。";
  element("lab-storage-message").textContent = storageAvailable ? "成績はこのブラウザだけに保存。端末間の移動にはバックアップを使えます。" : "この環境では保存できません。練習は使えますが、閉じる前に記録を書き出してください。";
  renderDaily();
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
    for (const [index, key] of Array.from(run.guide).entries()) {
      const keycap = document.createElement("kbd");
      keycap.textContent = key.toUpperCase();
      keycap.dataset.state = index < run.buffer.length ? "done" : index === run.buffer.length ? "current" : "next";
      guide.append(keycap);
    }
    if (method() === "keyboard") {
      const finger = document.createElement("span");
      finger.className = "lab-finger-hint";
      finger.textContent = `位置の目安：${fingerHint(run.guide[run.buffer.length] ?? "")}`;
      guide.append(finger);
    }
  } else guide.textContent = mode === "ime" ? "漢字・句読点まで、見たとおりに。" : mode === "benchmark" ? "ガイドなし / 定点測定" : "自分の指で、思い出してみよう。";
  for (const key of keys) {
    const next = visible && state === "running" && run.nextKeys.includes(key.dataset.key ?? "");
    key.dataset.next = String(next);
    key.disabled = mode === "ime" || method() !== "touch" || state !== "running";
    const label = visible ? keyLegend(run.buffer, key.dataset.key ?? "") : "";
    const legend = key.querySelector("strong");
    if (legend) legend.textContent = label;
    key.setAttribute("aria-label", `${key.dataset.key?.toUpperCase()} キー${label ? `、${label}` : ""}`);
  }
}

function renderPrompt(): void {
  if (run.complete) return;
  element("lab-meaning").textContent = run.passage.text;
  element("lab-topic").textContent = run.passage.topic;
  element("lab-counter").textContent = timed() ? `第${run.passageIndex + 1}文` : `${run.passageIndex + 1} / ${run.passages.length}`;
  element("lab-next").textContent = run.passages[run.passageIndex + 1] ? `NEXT  ${run.passages[run.passageIndex + 1].text}` : "この文で、ひと区切り。";
  const prompt = element("lab-prompt");
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
  element("lab-pace").textContent = pace && mode === "speed" ? `目安 ${pace}かな/分 · ${seconds >= 1 ? `${Math.round(run.completed - pace * seconds / 60)}文字` : "過去の同条件中央値＋3%"}` : mode === "ime" ? "変換後の文字で計測" : mode === "benchmark" ? "固定文 v1 / 60秒 / ガイドなし" : "正確さを保って、少しずつ。";
  renderDaily();
}

function passages(): Passage[] { return selectPassages(profile, method(), mode, level(), Date.now(), Math.random, focus); }

function prepare(retryPassages?: Passage[]): void {
  clearInterval(timer);
  clearInterval(restTimer);
  state = "ready";
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
  app.dataset.method = effectiveMethod();
  document.body.dataset.trainingFocus = String(mode === "focus");
  element("lab-focus-toolbar").hidden = mode !== "focus";
  element("lab-focus-result").hidden = mode !== "focus";
  element("lab-focus-shortcut").hidden = mode !== "focus" || method() !== "keyboard";
  delete app.dataset.error;
  lockSettings(false);
  methodSelect.disabled = mode === "ime";
  hintsSelect.disabled = mode === "benchmark";
  element("lab-stage-control").hidden = timed();
  element("lab-duration-control").hidden = mode !== "speed" && mode !== "focus";
  element("lab-hints-control").hidden = mode === "ime" || mode === "benchmark";
  element("lab-ime-area").hidden = mode !== "ime";
  element("lab-keyboard").hidden = mode === "ime";
  element("lab-result").hidden = true;
  element("lab-rest").hidden = true;
  element("lab-abandon").hidden = true;
  pauseButton.hidden = true;
  startButton.hidden = false;
  startButton.disabled = false;
  startButton.textContent = mode === "focus" ? `${duration()}秒、集中する ↗` : mode === "benchmark" ? "60秒の定点測定を始める ↗" : mode === "ime" ? "60秒の実入力を始める ↗" : "練習をはじめる ↗";
  element<HTMLButtonElement>("lab-show-hint").disabled = mode === "benchmark" || mode === "ime";
  for (const button of modeButtons) button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  const currentStage = curriculum[level()];
  element("lab-plan-title").textContent = timed() ? names[mode] : `${level() + 1}. ${currentStage.name}`;
  element("lab-plan-description").textContent = mode === "learn" ? currentStage.detail : mode === "review" ? "未定着・遅い文字・復習時期の文字を含む語や文を多めに。得意な文字も混ぜます。" : mode === "focus" ? "短く打って、結果を振り返る。Enterで同じ条件の次の一本へ。" : mode === "speed" ? "自然な文章で流れを作る。95%以上の正確さを保って、少しずつ速く。" : mode === "benchmark" ? "学習用とは別の固定文。同じ入力方法・同じ60秒で、日を空けて測りましょう。" : "導入済みIMEで漢字変換まで。新月配列をオンにして、日本語入力へ切り替えてください。";
  element("lab-session-label").textContent = `${names[mode]} / ${timed() ? "CONTINUOUS FLOW" : "ADAPTIVE PRACTICE"}`;
  element("lab-cpm-label").textContent = mode === "ime" ? "変換後の文字 / 分" : "かな / 分";
  element("lab-accuracy-label").textContent = mode === "ime" ? "確定文の一致率" : "打鍵正確率";
  element("lab-errors-label").textContent = mode === "ime" ? "不一致文字" : "ミス打鍵";
  element("lab-focus").textContent = focus ? `「${focus}」を含む、別の文脈で復習。` : mode === "review" ? "覚えているか、ガイドなしで一度試そう。" : mode === "ime" ? "修正も変換も含めた、実際の入力速度。" : "速さより、迷わず正確に。";
  element("lab-input-help").textContent = mode === "ime" ? "新月配列と日本語IMEをオンに。漢字・句読点まで一致すると次の文へ。予測変換・貼り付けは使いません。" : method() === "touch" ? "画面のキーを順番にタップ。スマホで配置を覚える練習です。PCの記録とは別に保存します。" : "IMEとOS側の新月配列リマップはオフに。英数・QWERTY状態で、D/Kも順番に押します。";
  const comparison = comparableResults(profile, signature()).slice(-5);
  pace = comparison.length >= 3 ? Math.round(median(comparison.map((result): number => result.cpm)) * 1.03) : 0;
  status(mode === "focus" ? "最初の打鍵から計測。時間が来たら結果を確認し、Enterで次の一本へ。" : "開始すると、最初の入力から計測します。");
  renderPrompt();
  renderMetrics();
  renderHistory();
}

function start(): void {
  if (state === "rest") return;
  if (state === "done") prepare();
  if (state !== "ready") return;
  state = "running";
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
  if (timed()) { finish(true); return; }
  run.pause(performance.now());
  state = "paused";
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
  app.dataset.state = state;
  pauseButton.textContent = "一時停止";
  status("練習を再開しました。");
  stage.focus({ preventScroll: true });
  renderHint();
}

function extend(): void {
  if (timed() && run.passages.length - run.passageIndex <= 2) run.append(mode === "speed" || mode === "focus" ? passages() : benchmarkCorpus);
}

function feed(key: string): void {
  if (state !== "running" || mode === "ime") return;
  const now = performance.now();
  if (timed() && run.elapsed(now) >= duration() * 1000) { tick(); return; }
  extend();
  const previousPassage = run.passageIndex;
  const wasError = app.dataset.error === "true";
  const before = `${run.passageIndex}:${run.tokenIndex}`;
  const correct = run.press(key, now);
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
  element<HTMLButtonElement>("lab-target-review").hidden = !nextFocus || mode === "ime";
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
  startButton.textContent = "次の練習へ ↗";
  lockSettings(false);
  methodSelect.disabled = mode === "ime";
  hintsSelect.disabled = mode === "benchmark";
  const seconds = run.elapsed(now) / 1000;
  if (!run.started || seconds < .001) { prepare(); status("入力前に終了しました。記録は保存していません。"); return; }
  const result: TrainingResult = { date: new Date().toISOString(), mode, method: effectiveMethod(), duration: seconds, stage: level(), cpm: run.cpm(now), accuracy: mode === "ime" ? (imeTotal ? imeCorrect / imeTotal * 100 : 0) : run.accuracy, kana: run.completed, attempts: mode === "ime" ? imeTotal : run.attempts, errors: mode === "ime" ? imeTotal - imeCorrect : run.errors, interrupted: run.interrupted, assisted: run.assisted, signature: signature() };
  const previous = comparableResults(profile, result.signature);
  const previousBest = Math.max(0, ...previous.map((entry): number => entry.cpm));
  saveSession(profile, result, run.assessmentSamples, run.pairs, run.passages.slice(0, run.passageIndex).map((passage): string => passage.id));
  persist();
  if (!showResult) return;
  const comparable = comparableResults(profile, result.signature).includes(result);
  element("lab-result-tag").textContent = interrupted ? "中断 · 参考記録" : comparable && result.cpm > previousBest ? "同条件での自己ベスト" : result.assisted ? "ガイドあり · 学習記録" : comparable ? "比較可能な記録" : "参考記録";
  element("lab-result-summary").textContent = `${Math.round(result.cpm)} ${mode === "ime" ? "変換後の文字" : "かな"}/分 · ${mode === "ime" ? "一致率" : "打鍵正確率"} ${result.accuracy.toFixed(1)}% · ${result.kana}文字 · ${Math.round(seconds)}秒。${method() === "touch" && mode !== "ime" ? "タップの記録です。PC速度とは比較しません。" : ""}`;
  element("lab-result-title").textContent = interrupted ? "ここで、ひと区切り。" : "一歩、指に馴染んだ。";
  element("lab-advice-title").textContent = mode === "ime" ? "実際の仕事へ、つなげよう。" : result.accuracy < 95 ? "少し速度を落とし、正確に。" : result.assisted ? "次は、ガイドを少し減らす。" : "別の文でも、同じように。";
  element("lab-advice").textContent = mode === "ime" ? "変換の修正時間も含めた結果です。候補の選択で迷った語は、実際に使う文の中で試しましょう。" : result.accuracy < 95 ? "まずミスした文字を含む短文を復習。正確さが戻ってから、高速化へ進みましょう。" : result.assisted ? "ガイドを見ずに思い出す練習へ。自動ガイドは、迷ったときや誤打時にだけ戻ります。" : "今できたことが、明日もできるか。日を空けた復習と定点測定で確かめましょう。速さは正確さを保てる範囲で。";
  renderAnalysis();
  element("lab-focus-cpm").textContent = String(Math.round(result.cpm));
  element("lab-focus-accuracy").textContent = `${result.accuracy.toFixed(1)}%`;
  element("lab-focus-summary").textContent = `${result.kana}文字 · ${Math.round(seconds)}秒 · ${methodNames[result.method]}${result.method === "touch" ? "（PC速度とは比較しません）" : ""}`;
  element("lab-focus-tip").textContent = `${element("lab-advice-title").textContent}${nextFocus ? ` 次は「${/[a-z;]/.test(nextFocus) ? Array.from(nextFocus).join(" → ").toUpperCase() : nextFocus}」を意識して。` : ""}`;
  element("lab-focus-storage").textContent = storageAvailable ? "この端末に保存しました。履歴は「モード選択」から。" : "この環境では記録を保存できません。「モード選択」から記録を書き出してください。";
  drawChart();
  renderHint();
  renderMetrics();
  renderHistory();
  const resultPanel = element("lab-result");
  resultPanel.hidden = false;
  status(interrupted ? "中断記録として保存しました。自己ベストには含めません。" : "練習が終わりました。結果と次の一手を確認できます。");
  if ((!interrupted || mode === "focus") && !document.hidden) { resultPanel.focus({ preventScroll: true }); resultPanel.scrollIntoView({ block: "nearest" }); }
  if (!interrupted && mode !== "focus") beginRest();
}

function retry(): void {
  if (mode !== "focus" || state !== "done") return;
  start();
}

function restart(): void {
  if (mode !== "focus" || (state !== "ready" && state !== "running" && state !== "done")) return;
  const retryPassages = [...run.passages];
  if (state === "running") finish(true, performance.now(), false);
  prepare(retryPassages);
  start();
  status("同じ課題を最初から。次の打鍵から計測します。", true);
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
  run.start(performance.now());
  if (run.elapsed(performance.now()) >= 60_000) { tick(); return; }
  imeValue = value;
  const target = Array.from(run.passage.text);
  const characters = Array.from(value);
  let prefix = 0;
  while (prefix < characters.length && characters[prefix] === target[prefix]) prefix += 1;
  imeCorrect = imeFinished + prefix;
  imeTotal = imeFinished + characters.length;
  run.completed = imeCorrect;
  app.dataset.error = String(prefix < characters.length);
  if (prefix < characters.length) status(`${prefix + 1}文字目が一致しません。変換やBackspaceで修正してください。`);
  if (value === run.passage.text) {
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

startButton.addEventListener("click", start);
element("lab-retry").addEventListener("click", retry);
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
  mode = button.dataset.mode as TrainingMode;
  focus = "";
  hintsSelect.value = mode === "speed" || mode === "benchmark" || mode === "focus" ? "off" : "auto";
  closeFocusSettings();
  prepare();
  if (mode === "focus") { startButton.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: "instant" }); }
});
for (const control of [methodSelect, levelSelect, durationSelect, hintsSelect]) control.addEventListener("change", (): void => { focus = ""; prepare(); });
element("lab-target-review").addEventListener("click", (): void => {
  const previousLevel = level();
  mode = "review";
  levelSelect.value = String(previousLevel);
  hintsSelect.value = "auto";
  focus = nextFocus;
  prepare();
  startButton.focus();
  startButton.scrollIntoView({ block: "nearest" });
});

stage.addEventListener("keydown", (event): void => {
  if (event.target !== stage || state !== "running" || mode === "ime" || method() !== "keyboard" || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
  if (event.key === "Escape") {
    if (mode !== "focus") { event.preventDefault(); pause(); }
    return;
  }
  if (event.key === "Tab") return;
  if (event.isComposing || event.key === "Process" || event.key === "Dead" || /[^\x00-\x7f]/.test(event.key)) {
    status("シミュレーターではIMEとOSのキー変換をオフにしてください。導入済みIMEで打つ場合は「IME実践」へ。");
    return;
  }
  if (event.key === " " || event.key === "Backspace" || event.key === "Enter") {
    event.preventDefault();
    status("確定・削除は不要です。現在のかなから続けてください。");
    return;
  }
  const key = codeToKey(event.code) ?? (event.key.length === 1 ? event.key.toLowerCase() : undefined);
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
  run.start(performance.now());
});
imeInput.addEventListener("compositionend", (): void => { composing = false; queueMicrotask(processIme); });
imeInput.addEventListener("input", processIme);
imeInput.addEventListener("keydown", (event): void => { if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); pause(); } });
for (const type of ["paste", "drop"] as const) imeInput.addEventListener(type, (event): void => { event.preventDefault(); status("実入力の計測なので、貼り付け・ドロップは使わず入力してください。"); });
imeInput.addEventListener("beforeinput", (event): void => {
  if (event.inputType === "insertFromPaste" || event.inputType === "insertFromDrop") { event.preventDefault(); status("貼り付けは計測対象外です。"); }
});
for (const input of [stage, imeInput]) input.addEventListener("blur", (event): void => {
  const next = event.relatedTarget;
  if (next instanceof Element && (next.closest(".lab-key") || ["lab-pause", "lab-abandon", "lab-show-hint", "lab-focus-exit"].includes(next.id))) return;
  if (state === "running") pause();
});
window.addEventListener("blur", (): void => { if (state === "running") pause(); });
document.addEventListener("visibilitychange", (): void => { if (document.hidden && state === "running") pause(); });

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

prepare();
app.hidden = false;
