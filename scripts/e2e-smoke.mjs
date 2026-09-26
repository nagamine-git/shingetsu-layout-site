// E2E スモークテスト（テストピラミッドの最上段・少数）
//
// 使い方: pnpm test:e2e   （ローカルの Chromium を使う。E2E_BROWSER=<path> で指定可）
// 開発サーバーを 4399 番で起動し、以下を実機ブラウザで確認する:
//   1. トップ: JS エラーなし・月の描画 (WebGL or SVG) が初期化される
//   2. 練習室: 記録を仕込んだ状態で弱点ドリルが弱点を選び、45 秒走らせずとも打鍵→中断→結果が出る
//   3. 練習室: 高速化 15 秒（疾走）の目標が自己ベスト +8% で表示される
//   4. 練習室: 「測る」のループ（定点 → Enter で別の文 → Esc で同じ文 → Space で次）。時計は早送り
// 細かい採点ロジックは vitest（src/lib/__tests__）で担保する。
import { spawn, execFileSync } from "node:child_process";
import { chromium } from "playwright-core";

const port = 4399;
const base = `http://localhost:${port}`;
const browserPath =
  process.env.E2E_BROWSER ??
  ["chromium", "google-chrome-stable", "google-chrome", "chromium-browser"].map((name) => {
    try { return execFileSync("which", [name], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; }
  }).find(Boolean);
if (!browserPath) { console.error("Chromium が見つかりません。E2E_BROWSER=<path> を指定してください。"); process.exit(1); }

const dev = spawn("pnpm", ["dev", "--port", String(port)], { stdio: "ignore", detached: true });
dev.on("error", (error) => { console.error(`開発サーバーを起動できません: ${error.message}`); process.exit(1); });
const stop = () => { try { process.kill(-dev.pid, "SIGTERM"); } catch { /* already gone */ } };
process.on("exit", stop);
for (let attempt = 0; attempt < 60; attempt += 1) {
  try { if ((await fetch(`${base}/practice/`)).ok) break; } catch { /* not yet */ }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); console.log(`${condition ? "✓" : "✗"} ${message}`); };

const browser = await chromium.launch({ executablePath: browserPath, headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  context.on("page", (page) => { page.on("pageerror", (error) => errors.push(String(error))); });

  // 1. トップ
  const home = await context.newPage();
  await home.goto(`${base}/`, { waitUntil: "load" });
  await home.waitForTimeout(1600);
  const moon = await home.evaluate(() => ({ renderer: document.querySelector(".eclipse")?.dataset.renderer ?? "svg", state: document.querySelector(".hero-art")?.dataset.state }));
  check(["webgl", "svg"].includes(moon.renderer), `トップ: 月の描画が初期化 (${moon.renderer})`);
  check(moon.state !== undefined, `トップ: 月の状態が公開されている (${moon.state})`);
  await home.close();

  // 2. 弱点ドリル
  const lab = await context.newPage();
  await lab.addInitScript(() => {
    if (localStorage.getItem("e2e-seeded")) return;
    localStorage.setItem("e2e-seeded", "1");
    const skill = (latency, accuracy = 1) => ({ samples: 10, recent: Array.from({ length: 10 }, (_, index) => (index / 10 < accuracy ? 1 : 0)), latencies: Array(5).fill(latency), last: 0, due: Date.now() + 1e10, streak: 0 });
    const keyboard = {};
    for (const kana of "はかとたくうきこしいんのなるすてさけにつっそりょあおえまもられをわよみや") keyboard[kana] = skill(300);
    keyboard["こ"] = skill(700);
    const pairs = { as: { samples: 6, milliseconds: 200 }, sd: { samples: 6, milliseconds: 200 }, jk: { samples: 6, milliseconds: 200 }, dk: { samples: 6, milliseconds: 380 } };
    const results = [{ date: new Date().toISOString(), mode: "speed", method: "keyboard", material: "short", duration: 60, stage: 5, cpm: 200, accuracy: 97, kana: 200, attempts: 210, errors: 6, interrupted: false, assisted: false, signature: "speed:keyboard:60:5:v1:longmark-v1" }];
    localStorage.setItem("shingetsu-training-v1", JSON.stringify({ version: 1, keyboard, touch: {}, pairs: { keyboard: pairs, touch: {} }, results, recent: [] }));
  });
  await lab.goto(`${base}/practice/?mode=drill`, { waitUntil: "load" });
  await lab.waitForTimeout(800);
  const focus = await lab.locator("#lab-focus").textContent();
  check(focus.includes("こ") && focus.includes("D → K"), `ドリル: 弱点を選定 (${focus})`);
  await lab.selectOption("#lab-hints", "off");
  await lab.click("#lab-start");
  await lab.waitForTimeout(200);
  const typed = await lab.evaluate(async () => {
    const training = await import("/src/lib/training.ts");
    const stage = document.getElementById("lab-stage");
    stage.focus();
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const codeOf = (key) => (/[a-z]/.test(key) ? `Key${key.toUpperCase()}` : { ";": "Semicolon", ",": "Comma", ".": "Period", "/": "Slash", "[": "BracketLeft", "]": "BracketRight", "-": "Minus" }[key]);
    const prompt = document.getElementById("lab-prompt").textContent.trim();
    let strokes = 0;
    for (const token of training.tokenize(prompt)) for (const key of token.paths[0]) {
      await sleep(70);
      stage.dispatchEvent(new KeyboardEvent("keydown", { key, code: codeOf(key), bubbles: true }));
      strokes += 1;
    }
    await sleep(200);
    return { strokes, accuracy: document.getElementById("lab-accuracy").textContent, completed: document.getElementById("lab-counter").textContent };
  });
  check(typed.strokes > 0 && typed.accuracy === "100.0%", `ドリル: 経路どおりの打鍵で正確率 100% (${typed.strokes}打)`);
  await lab.click("#lab-pause"); // 時間制なので中断＝終了
  await lab.waitForTimeout(500);
  const result = await lab.evaluate(() => ({ hidden: document.getElementById("lab-result").hidden, reportHidden: document.getElementById("lab-drill-report").hidden, rows: document.querySelectorAll("#lab-drill-list li").length, history: document.querySelector("#lab-history tr")?.textContent ?? "" }));
  check(!result.hidden, "ドリル: 中断後に結果パネルが出る");
  check(!result.reportHidden && result.rows >= 2, `ドリル: 弱点の変化レポート (${result.rows}件)`);
  check(result.history.includes("弱点ドリル"), "ドリル: 履歴に保存される");
  await lab.click("#lab-rest-skip").catch(() => {});

  // 3. 疾走（手動メニューは details 内）
  await lab.click("#lab-manual summary");
  await lab.click('.lab-modes [data-mode="speed"]');
  await lab.selectOption("#lab-duration", "15");
  await lab.waitForTimeout(200);
  const pace = await lab.locator("#lab-pace").textContent();
  check(pace.includes("216"), `疾走: 目標が自己ベスト+8% (${pace})`);
  const heat = await lab.locator('#lab-heat-map span[data-heat="measured"]').count();
  check(heat >= 1, `速度マップ: 計測済みキーを表示 (${heat}キー)`);

  // 4. 練習する（自動）と 測る
  await lab.click("#lab-auto");
  await lab.waitForTimeout(400);
  const autoState = await lab.evaluate(() => ({ state: document.getElementById("training-lab").dataset.state, label: document.getElementById("lab-session-label").textContent, title: document.getElementById("lab-plan-title").textContent }));
  check(autoState.state === "running" && autoState.label.startsWith("自動"), `自動メニュー: 1 タップで開始 (${autoState.title})`);
  const stopRun = () => lab.evaluate(() => { for (const id of ["lab-pause", "lab-abandon", "lab-rest-skip"]) { const button = document.getElementById(id); if (button && !button.hidden && !button.disabled) button.click(); } });
  await stopRun();
  await lab.waitForTimeout(400);
  await lab.click("#lab-measure");
  await lab.waitForTimeout(400);
  const measureState = await lab.evaluate(() => ({ state: document.getElementById("training-lab").dataset.state, mode: document.getElementById("training-lab").dataset.mode }));
  check(measureState.state === "running" && measureState.mode === "benchmark", "測る: 固定文の定点測定が始まる");
  await stopRun();

  // 5. 測るのループ（時計を早送りして 60 秒を再現）: 定点 → Enter で別の文 → Esc で同じ文 → 弱点の変化 → Space で次
  const loop = await context.newPage();
  await loop.clock.install();
  await loop.goto(`${base}/practice/`, { waitUntil: "load" });
  await loop.clock.runFor(800);
  const snapshot = () => loop.evaluate(() => ({
    state: document.getElementById("training-lab").dataset.state,
    mode: document.getElementById("training-lab").dataset.mode,
    label: document.getElementById("lab-session-label").textContent,
    prompt: document.getElementById("lab-prompt").textContent.trim(),
    next: document.getElementById("lab-measure-next").hidden ? "" : document.getElementById("lab-measure-next").textContent,
    tag: document.getElementById("lab-result-tag").textContent,
    rest: !document.getElementById("lab-rest").hidden,
    report: !document.getElementById("lab-drill-report").hidden,
    atc: document.getElementById("lab-atc").hidden ? "" : document.getElementById("lab-atc").textContent,
    growth: document.getElementById("lab-loop-growth").hidden ? 0 : document.querySelectorAll("#lab-loop-chart circle").length,
  }));
  const typeOne = () => loop.evaluate(async () => {
    const training = await import("/src/lib/training.ts");
    const stage = document.getElementById("lab-stage");
    const key = training.tokenize(document.getElementById("lab-prompt").textContent.trim())[0].paths[0][0];
    stage.dispatchEvent(new KeyboardEvent("keydown", { key, code: /[a-z]/.test(key) ? `Key${key.toUpperCase()}` : "Semicolon", bubbles: true }));
  });
  await loop.click("#lab-measure");
  await loop.clock.runFor(300);
  let view = await snapshot();
  check(view.state === "running" && view.mode === "benchmark" && view.label.includes("定点"), `測るループ: その日の最初は定点 (${view.label})`);
  await typeOne();
  await loop.clock.runFor(61_000);
  view = await snapshot();
  check(view.state === "done" && !view.rest && view.tag.startsWith("定点"), `測るループ: 60秒で結果、休憩の強制なし (${view.tag})`);
  check(view.next.includes("別の文") && view.next.includes("Enter"), "測るループ: 次の一本と操作を案内");
  check(/指の速さ [\d.]+打\/秒/.test(view.atc) && view.atc.includes("ATC換算の目安") && view.atc.includes("かな系3位"), `ATC 換算: 打/秒と表彰ラインまでの差 (${view.atc.slice(0, 60)}…)`);
  await loop.keyboard.press("Enter");
  await loop.clock.runFor(300);
  view = await snapshot();
  check(view.state === "running" && view.mode === "speed" && view.label.includes("別の文"), `測るループ: Enter で別の文の60秒 (${view.label})`);
  const firstPrompt = view.prompt;
  await typeOne();
  await loop.keyboard.press("Escape");
  await loop.clock.runFor(300);
  view = await snapshot();
  check(view.state === "running" && view.prompt === firstPrompt, "測るループ: Esc で同じ文を最初から");
  await typeOne();
  await loop.clock.runFor(61_000);
  view = await snapshot();
  check(view.state === "done" && view.report, "測るループ: 混ぜた弱点の変化を結果に表示");
  check(view.growth >= 2, `測るループ: 回ごとの成長曲線 (${view.growth}回分)`);
  await loop.keyboard.press(" ");
  await loop.clock.runFor(300);
  view = await snapshot();
  check(view.state === "running" && view.mode === "speed", "測るループ: Space でも次の一本");
  await loop.close();

  check(errors.length === 0, `JS エラーなし${errors.length ? `: ${errors.join(" | ")}` : ""}`);
} finally {
  await browser.close();
  stop();
}
if (failures.length) { console.error(`\n${failures.length} 件失敗`); process.exit(1); }
console.log("\nスモークテスト合格");
