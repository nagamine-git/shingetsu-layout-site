// GA4 の読み込み。本番ホストでだけ gtag.js を挿入し、localhost・*.pages.dev・E2E では外部リクエストも出さない。
export const GA_MEASUREMENT_ID = "G-DDY9QM5CXR";

const PRODUCTION_HOSTS: readonly string[] = ["shingetsu-layout.com", "www.shingetsu-layout.com"];

export function isProductionHost(hostname: string): boolean {
  return PRODUCTION_HOSTS.includes(hostname);
}

interface AnalyticsWindow {
  dataLayer: unknown[];
  gtag: (...args: unknown[]) => void;
}

interface AnalyticsDocument {
  head: { appendChild: (node: unknown) => unknown };
  createElement: (tag: "script") => { src: string; async: boolean };
}

/** 本番ホストなら GA を初期化して true、それ以外は何もせず false。 */
export function initAnalytics(hostname: string, win: AnalyticsWindow, doc: AnalyticsDocument): boolean {
  if (!isProductionHost(hostname)) return false;

  win.dataLayer = win.dataLayer || [];
  // gtag.js は arguments オブジェクトそのものを dataLayer で受け取るので、配列に包まず arguments を積む
  win.gtag = function (): void {
    win.dataLayer.push(arguments);
  };
  win.gtag("js", new Date());
  win.gtag("config", GA_MEASUREMENT_ID);

  const script = doc.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  doc.head.appendChild(script);
  return true;
}
