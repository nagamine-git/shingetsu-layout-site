// 本番へは接続せず、ビルド成果物 + 一時ローカル D1 で申告を検証する。
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const base = "http://localhost:4400";
const persistence = await mkdtemp(join(tmpdir(), "shingetsu-usage-"));
const executablePath = process.env.E2E_BROWSER ?? ["chromium", "google-chrome-stable", "google-chrome"].map((name) => {
  try { return execFileSync("which", [name], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; }
}).find(Boolean);
const server = spawn("pnpm", ["exec", "wrangler", "pages", "dev", "dist", "--port", "4400", "--persist-to", persistence], {
  env: { ...process.env, WRANGLER_LOG_PATH: join(persistence, "wrangler.log") }, stdio: "ignore", detached: true,
});
let browser;
const check = (value, message) => { assert.ok(value, message); console.log(`✓ ${message}`); };
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`${base}/api/usage`)).ok) break; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const readCount = async () => (await (await fetch(`${base}/api/usage`)).json()).count;
  check(await readCount() === 0, "空のローカルD1から開始");
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  // 解析・Turnstile等へ試験アクセスを送らない。
  await context.route("**/*", (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const posts = [];
  page.on("request", (request) => { if (request.url().endsWith("/api/usage") && request.method() === "POST") posts.push(request.postData()); });
  await page.goto(base);
  const panel = page.locator("[data-usage-counter]");
  const button = page.locator("[data-usage-button]");
  const counter = page.locator("[data-usage-count]");
  await button.waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector("[data-usage-button]").disabled);
  check(await counter.textContent() === "自己申告 0 件", "サーバーの空集計だけを0件として表示");
  check(await readCount() === 0 && posts.length === 0, "閲覧で自己申告を増やさない");
  check(await page.evaluate(() => localStorage.getItem("shingetsu-usage-declaration-v1")) === null, "訪問時に申告キーを生成しない");
  check(await page.locator("[data-usage-scope]").isVisible(), "試験用の集計を明記");
  check(await button.getAttribute("aria-describedby") === "usage-note usage-privacy", "ボタンから件数の意味・匿名性の説明を参照");
  await button.focus();
  check(await button.evaluate((node) => getComputedStyle(node).outlineStyle) !== "none", "キーボードフォーカスが見える");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("[data-usage-button]").textContent === "申告済みです");
  check(await readCount() === 1 && posts.length === 1, "Enterの明示操作で1件だけ加算");
  await button.evaluate((node) => { for (let i = 0; i < 10; i++) node.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  check(await readCount() === 1 && posts.length === 1, "申告済みの連打を抑える");
  await page.reload();
  await page.waitForFunction(() => document.querySelector("[data-usage-button]").textContent === "申告済みです");
  check(await button.isDisabled() && await readCount() === 1, "再読込後も同じブラウザは申告済み");
  const sibling = await context.newPage();
  await sibling.goto(base);
  await sibling.waitForFunction(() => document.querySelector("[data-usage-button]").textContent === "申告済みです");
  check(await sibling.locator("[data-usage-button]").isDisabled(), "別タブも申告済みを共有");
  await sibling.close();

  // 完了した書込みの応答だけ消す。再送キーが同じでD1の件数が増えないこと。
  const retryContext = await browser.newContext();
  await retryContext.route("**/*", (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const retryPage = await retryContext.newPage();
  let lost = true;
  const tokens = [];
  await retryPage.route("**/api/usage", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    tokens.push(JSON.parse(route.request().postData()).token);
    if (lost) { lost = false; await route.fetch(); return route.abort(); }
    return route.continue();
  });
  await retryPage.goto(base);
  await retryPage.waitForFunction(() => !document.querySelector("[data-usage-button]").disabled);
  await retryPage.locator("[data-usage-button]").click();
  await retryPage.waitForFunction(() => document.querySelector("[data-usage-status]").textContent.includes("再送"));
  check(await retryPage.locator("[data-usage-count]").textContent() === "申告件数を確認できません", "応答消失時に架空の件数を表示しない");
  await retryPage.locator("[data-usage-button]").click();
  await retryPage.waitForFunction(() => document.querySelector("[data-usage-button]").textContent === "申告済みです");
  check(tokens.length === 2 && tokens[0] === tokens[1] && await readCount() === 2, "書込み済み・応答消失後の再送も同じ1件");
  await retryContext.close();

  const failContext = await browser.newContext();
  await failContext.route("**/*", (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const failPage = await failContext.newPage();
  await failPage.route("**/api/usage", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"count":null}' }));
  await failPage.goto(base);
  await failPage.waitForFunction(() => document.querySelector("[data-usage-count]").textContent === "申告件数を確認できません");
  check(await failPage.locator("[data-usage-button]").isDisabled(), "読込失敗時は0を出さず送信を停止");
  await failPage.unroute("**/api/usage");
  await failPage.locator("[data-usage-retry]").click();
  await failPage.waitForFunction(() => !document.querySelector("[data-usage-button]").disabled);
  check(await failPage.locator("[data-usage-count]").textContent() === "自己申告 2 件", "復旧時は集計を読み直せる");
  await failContext.close();

  const blocked = await browser.newContext();
  await blocked.route("**/*", (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await blocked.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error("storage blocked"); }; });
  const blockedPage = await blocked.newPage();
  await blockedPage.goto(base);
  await blockedPage.waitForFunction(() => !document.querySelector("[data-usage-button]").disabled);
  await blockedPage.locator("[data-usage-button]").click();
  check(await blockedPage.locator("[data-usage-status]").textContent().then((text) => text.includes("保存できない")) && await readCount() === 2, "保存不可時は理由を表示して送信しない");
  await blocked.close();

  // 実際のSQLite UNIQUE制約をworkerd上でも検証。
  const token = crypto.randomUUID();
  const responses = await Promise.all(Array.from({ length: 12 }, () => fetch(`${base}/api/usage`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ token }) })));
  check(responses.every((response) => response.ok) && await readCount() === 3, "実workerd+D1で12重の同時送信が1件");
  check((await fetch(`${base}/api/usage`, { method: "POST", headers: { origin: "https://example.com", "content-type": "application/json" }, body: JSON.stringify({ token: crypto.randomUUID() }) })).status === 403, "異なるOriginの送信を拒否");

  if (process.env.USAGE_EVIDENCE_DIR) await mkdir(process.env.USAGE_EVIDENCE_DIR, { recursive: true });
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await panel.evaluate((node) => ({ width: document.documentElement.clientWidth, right: node.getBoundingClientRect().right, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }));
    check(!layout.overflow && layout.right <= layout.width, `${width}pxで横溢れなし`);
    check(await button.evaluate((node) => node.getBoundingClientRect().height) >= 48, `${width}pxでボタンの高さ48px以上`);
    if (width === 390 && process.env.USAGE_EVIDENCE_DIR) await panel.screenshot({ path: join(process.env.USAGE_EVIDENCE_DIR, "usage-mobile.png") });
    if (width === 1280 && process.env.USAGE_EVIDENCE_DIR) await panel.screenshot({ path: join(process.env.USAGE_EVIDENCE_DIR, "usage-desktop.png") });
  }
  const nojs = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await nojs.newPage();
  await staticPage.goto(base);
  check(await staticPage.locator("#using-shingetsu noscript").isVisible() && await staticPage.locator("[data-usage-button]").isDisabled(), "JavaScript無効時も説明と代替案内を表示");
  await nojs.close();
  check(errors.length === 0, `新しいJSエラーなし (${errors.join(" | ")})`);
  console.log("利用申告E2E合格（試験データは一時ローカルD1のみ）");
} finally {
  await browser?.close();
  try { process.kill(-server.pid, "SIGTERM"); } catch { /* stopped */ }
  await rm(persistence, { recursive: true, force: true });
}
