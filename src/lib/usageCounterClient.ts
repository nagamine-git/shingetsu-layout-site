const STORAGE_KEY = "shingetsu-usage-declaration-v1";
const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
interface Declaration { token: string; done: boolean }
interface UsageReply { count: number; scope: "production" | "test"; recorded?: boolean }

function readDeclaration(): Declaration | undefined {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return undefined;
  const saved: unknown = JSON.parse(raw);
  if (!saved || typeof saved !== "object") throw new Error("Invalid saved declaration");
  const { token, done } = saved as Partial<Declaration>;
  if (typeof token !== "string" || !TOKEN_RE.test(token) || typeof done !== "boolean") throw new Error("Invalid saved declaration");
  return { token, done };
}

async function requestUsage(token?: string): Promise<UsageReply> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch("/api/usage", {
      method: token ? "POST" : "GET",
      headers: token ? { "content-type": "application/json" } : undefined,
      body: token ? JSON.stringify({ token }) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Usage counter unavailable");
    const data = await response.json() as Partial<UsageReply>;
    if (typeof data.count !== "number" || !Number.isSafeInteger(data.count) || data.count < 0 || !["production", "test"].includes(data.scope ?? "") || (token && data.recorded !== true)) throw new Error("Invalid usage reply");
    return data as UsageReply;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function initUsageCounter(root: HTMLElement): Promise<void> {
  const button = root.querySelector<HTMLButtonElement>("[data-usage-button]");
  const retry = root.querySelector<HTMLButtonElement>("[data-usage-retry]");
  const count = root.querySelector<HTMLElement>("[data-usage-count]");
  const status = root.querySelector<HTMLElement>("[data-usage-status]");
  const scope = root.querySelector<HTMLElement>("[data-usage-scope]");
  if (!button || !retry || !count || !status || !scope) return;
  let saved: Declaration | undefined;
  let available = false;
  let busy = false;
  let storageFailed = false;
  const restore = (): void => {
    try { saved = readDeclaration(); } catch { storageFailed = true; }
  };
  const updateButton = (): void => {
    button.disabled = busy || !available || storageFailed || saved?.done === true;
    button.textContent = busy ? "送信中…" : saved?.done ? "申告済みです" : "つかってます！";
    if (storageFailed) status.textContent = "ブラウザに申告キーを保存できないため、送信できません。保存を許可してから再読み込みしてください。";
    else if (saved?.done) status.textContent = "ありがとうございます。このブラウザからの申告を受け付けました。";
  };
  const show = (data: UsageReply): void => {
    count.textContent = `自己申告 ${data.count.toLocaleString("ja-JP")} 件`;
    scope.hidden = data.scope !== "test";
  };
  const load = async (): Promise<void> => {
    retry.disabled = true;
    try {
      show(await requestUsage());
      available = true;
      retry.hidden = true;
    } catch {
      count.textContent = "申告件数を確認できません";
      available = false;
      retry.hidden = false;
    } finally {
      retry.disabled = false;
      updateButton();
    }
  };
  restore();
  retry.addEventListener("click", () => { void load(); });
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    restore();
    updateButton();
  });
  button.addEventListener("click", async () => {
    if (button.disabled || busy) return;
    // 保存を先に完了させ、応答が失われても同じキーで再送する。
    try {
      restore();
      if (saved?.done || storageFailed) { updateButton(); return; }
      saved ??= { token: crypto.randomUUID(), done: false };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      storageFailed = true;
      updateButton();
      return;
    }
    busy = true;
    status.textContent = "申告を送信しています…";
    updateButton();
    try {
      const data = await requestUsage(saved.token);
      show(data);
      saved.done = true;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch { /* キーは送信前に保存済み。再送時も D1 が重複を防ぐ。 */ }
      retry.hidden = true;
    } catch {
      count.textContent = "申告件数を確認できません";
      status.textContent = "送信結果を確認できませんでした。もう一度押すと、同じ申告を再送します。";
      retry.hidden = false;
    } finally {
      busy = false;
      updateButton();
    }
  });
  await load();
}
