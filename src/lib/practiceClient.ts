import { emptyHistory, kanaSequences, makeLesson, parseHistory, PracticeSession, practiceModes, type InputMethod, type PracticeHistory, type PracticeMode } from "./practice";

function element<ElementType extends HTMLElement>(id: string): ElementType {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing practice element: ${id}`);
  return found as ElementType;
}

const app = element("practice-app");
const stage = element("practice-stage");
const modeSelect = element<HTMLSelectElement>("practice-mode");
const startButton = element<HTMLButtonElement>("practice-start");
const restartButton = element<HTMLButtonElement>("practice-restart");
const status = element("practice-status");
const result = element("practice-result");
const keys = Array.from(app.querySelectorAll<HTMLButtonElement>(".practice-key"));
const validKeys = new Set(keys.map((key): string => key.dataset.key ?? ""));
const storageKey = "shingetsu-practice-v1";
let history: PracticeHistory = emptyHistory();
let storageAvailable = true;
try { history = parseHistory(localStorage.getItem(storageKey)); } catch { storageAvailable = false; }
let mode: PracticeMode = "home";
let method: InputMethod = matchMedia("(pointer: coarse)").matches ? "touch" : "keyboard";
let session = new PracticeSession(makeLesson(mode, history[method]));
let active = false;
let timer: ReturnType<typeof setInterval> | undefined;

function stopClock(): void {
  session.pause(performance.now());
  clearInterval(timer);
  timer = undefined;
}

function showHistory(): void {
  const results = history.results.filter((entry): boolean => entry.method === method);
  const recent = results.at(-1);
  element("practice-history").textContent = recent
    ? `直近${results.length}回を保存 · 前回の正確率 ${recent.accuracy}%（${method === "keyboard" ? "PC" : "タップ"}）`
    : "まだ記録はありません。20文字からはじめましょう。";
  const weak = Object.entries(history[method]).filter(([, stat]): boolean => stat.errors > 0)
    .sort(([, left], [, right]): number => right.errors / right.attempts - left.errors / left.attempts).slice(0, 5);
  element("practice-weak").textContent = !recent
    ? "20文字を完了すると、復習候補が見つかります。"
    : weak.length
    ? `復習候補：${weak.map(([kana]): string => kana).join("・")}。「苦手を復習」で重点的に出題します。`
    : "記録のある文字にミスはありません。未練習の文字にも進んでみましょう。";
  element("practice-storage").textContent = storageAvailable
    ? "成績はこのブラウザだけに保存。アカウント不要。他の端末とは同期しません。削除操作はこの練習の記録だけが対象です。"
    : "この環境では成績を保存できません。練習は使えますが、ページを閉じると記録は失われます。";
}

function renderMetrics(): void {
  element("practice-accuracy").textContent = session.attempts ? `${session.accuracy}%` : "—";
  element("practice-speed").textContent = session.milliseconds(performance.now()) >= 1000 ? String(session.cpm(performance.now())) : "—";
  element("practice-errors").textContent = String(session.errors);
}

function render(): void {
  element("practice-current").textContent = session.complete ? "完" : session.kana;
  element("practice-counter").textContent = `${String(session.index).padStart(2, "0")} / 20`;
  element<HTMLProgressElement>("practice-progress").value = session.index;
  const guide = element("practice-guide");
  guide.replaceChildren();
  for (const [index, key] of Array.from(session.sequence).entries()) {
    if (index > 0) { const arrow = document.createElement("span"); arrow.textContent = "→"; arrow.setAttribute("aria-hidden", "true"); guide.append(arrow); }
    const keycap = document.createElement("kbd");
    keycap.textContent = key.toUpperCase();
    keycap.dataset.state = index < session.stroke ? "done" : index === session.stroke ? "current" : "pending";
    if (index === session.stroke) keycap.setAttribute("aria-current", "step");
    guide.append(keycap);
  }
  const prompt = element("practice-prompt");
  prompt.replaceChildren();
  session.lesson.forEach((kana, index): void => {
    const character = document.createElement("span");
    character.textContent = kana;
    character.dataset.state = index < session.index ? "done" : index === session.index ? "current" : "pending";
    if (index === session.index) character.setAttribute("aria-current", "true");
    prompt.append(character);
  });
  for (const key of keys) {
    key.dataset.next = String(active && key.dataset.key === session.nextKey);
    key.disabled = method !== "touch" || !active;
  }
  renderMetrics();
}

function prepare(): void {
  stopClock();
  active = false;
  session = new PracticeSession(makeLesson(mode, history[method]));
  app.dataset.state = "ready";
  result.hidden = true;
  restartButton.hidden = true;
  startButton.hidden = false;
  startButton.textContent = "練習を開始 ↗";
  element("practice-description").textContent = practiceModes.find((entry): boolean => entry.id === mode)?.description ?? "";
  element("practice-help").textContent = method === "keyboard"
    ? "IMEをオフにして英数入力に。開始後、この枠内で表示の順にキーを押してください。"
    : "開始後、光るキーを順番にタップ。PCの練習記録とは別に保存します。";
  status.textContent = "準備ができたら、練習を開始。";
  showHistory();
  render();
}

function finish(): void {
  stopClock();
  active = false;
  app.dataset.state = "complete";
  for (const [kana, stat] of Object.entries(session.stats)) {
    const saved = history[method][kana] ??= { attempts: 0, errors: 0 };
    saved.attempts += stat.attempts;
    saved.errors += stat.errors;
  }
  history.results.push({ date: new Date().toISOString(), mode, method, accuracy: session.accuracy, cpm: session.cpm(performance.now()) });
  history.results = history.results.slice(-20);
  try { localStorage.setItem(storageKey, JSON.stringify(history)); storageAvailable = true; } catch { storageAvailable = false; }
  const missed = Object.entries(session.stats).filter(([, stat]): boolean => stat.errors > 0).map(([kana]): string => kana);
  element("practice-summary").textContent = `正確率 ${session.accuracy}% · ${session.errors}ミス。${missed.length ? `次は ${missed.join("・")} を復習しましょう。` : "ミスなしです。次の20文字、または次の段階へ。"}`;
  status.textContent = "20文字の練習が完了しました。";
  result.hidden = false;
  startButton.hidden = false;
  startButton.textContent = "次の20文字へ ↗";
  restartButton.hidden = true;
  showHistory();
  render();
  result.focus({ preventScroll: true });
  result.scrollIntoView({ block: "nearest" });
  window.track?.("practice_complete", { mode, input_method: method });
}

function feed(key: string): void {
  if (!active || !validKeys.has(key)) return;
  const previousKana = session.kana;
  const correct = session.press(key, performance.now());
  app.dataset.state = correct ? "active" : "error";
  status.textContent = correct
    ? (previousKana !== session.kana ? `${previousKana}、できました。` : "次のキーへ。")
    : `違うキーです。${session.nextKey.toUpperCase()} を押してください。`;
  if (session.complete) { finish(); return; }
  if (timer === undefined) timer = setInterval(renderMetrics, 1000);
  render();
}

function start(): void {
  stopClock();
  session = new PracticeSession(makeLesson(mode, history[method]));
  active = true;
  app.dataset.state = "active";
  result.hidden = true;
  startButton.hidden = true;
  restartButton.hidden = false;
  status.textContent = "最初の打鍵から計測します。";
  render();
  stage.focus({ preventScroll: true });
  stage.scrollIntoView({ block: "start" });
  window.track?.("practice_start", { mode, input_method: method });
}

startButton.addEventListener("click", start);
restartButton.addEventListener("click", start);
modeSelect.addEventListener("change", (): void => {
  mode = practiceModes.find((entry): boolean => entry.id === modeSelect.value)?.id ?? "home";
  prepare();
});
for (const radio of app.querySelectorAll<HTMLInputElement>('input[name="practice-method"]')) {
  radio.checked = radio.value === method;
  radio.addEventListener("change", (): void => { method = radio.value === "touch" ? "touch" : "keyboard"; prepare(); });
}
stage.addEventListener("keydown", (event): void => {
  if (event.target !== stage || event.ctrlKey || event.metaKey || event.altKey || event.repeat || !active || method !== "keyboard") return;
  if (event.isComposing || event.key === "Process" || event.key === "Dead" || /[^\x00-\x7f]/.test(event.key)) {
    status.textContent = "IMEをオフにして、英数入力へ切り替えてください。";
    return;
  }
  if (event.key === " " || event.key === "Backspace") { event.preventDefault(); status.textContent = "確定・削除は不要です。ガイドのキーを押してください。"; return; }
  const key = event.code.startsWith("Key") ? event.code.slice(3).toLowerCase() : ({ Semicolon: ";", Comma: ",", Period: ".", Slash: "/" } as Record<string, string>)[event.code];
  if (key && validKeys.has(key)) { event.preventDefault(); feed(key); }
});
for (const key of keys) key.addEventListener("click", (): void => {
  if (method !== "touch") return;
  feed(key.dataset.key ?? "");
  if (active) stage.focus({ preventScroll: true });
});
stage.addEventListener("blur", (): void => {
  stopClock();
  if (active) status.textContent = "一時停止中。次の入力から再開します。";
});
window.addEventListener("blur", stopClock);
document.addEventListener("visibilitychange", (): void => { if (document.hidden) stopClock(); });
element("practice-delete").addEventListener("click", (): void => {
  if (!window.confirm("このブラウザの新月練習記録を削除しますか？")) return;
  history = emptyHistory();
  try { localStorage.removeItem(storageKey); storageAvailable = true; } catch { storageAvailable = false; }
  prepare();
  status.textContent = "練習記録を削除しました。";
});

if (practiceModes.some((entry): boolean => Array.from(entry.kana).some((kana): boolean => !kanaSequences.has(kana)))) {
  throw new Error("Practice contains an unsupported kana");
}
prepare();
app.hidden = false;
