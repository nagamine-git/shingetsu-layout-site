import { describe, expect, it } from "vitest";
import { GA_MEASUREMENT_ID, initAnalytics, isProductionHost } from "../analytics";

function fakeEnvironment() {
  const appended: Array<{ src?: string; async?: boolean }> = [];
  const win = { dataLayer: undefined } as unknown as Parameters<typeof initAnalytics>[1];
  const doc = {
    head: { appendChild: (node: { src?: string; async?: boolean }) => appended.push(node) },
    createElement: () => ({}) as { src?: string; async?: boolean },
  } as unknown as Parameters<typeof initAnalytics>[2];
  return { win, doc, appended };
}

describe("isProductionHost", () => {
  it("accepts the production host and its www alias", () => {
    expect(isProductionHost("shingetsu-layout.com")).toBe(true);
    expect(isProductionHost("www.shingetsu-layout.com")).toBe(true);
  });

  it("rejects local, preview and look-alike hosts", () => {
    for (const host of [
      "localhost",
      "127.0.0.1",
      "shingetsu-layout-site.pages.dev",
      "abc123.shingetsu-layout-site.pages.dev",
      "shingetsu-layout.com.evil.example",
      "evilshingetsu-layout.com",
      "",
    ]) {
      expect(isProductionHost(host), host).toBe(false);
    }
  });
});

describe("initAnalytics", () => {
  it("does nothing off production: no gtag, no dataLayer, no external script", () => {
    for (const host of ["localhost", "127.0.0.1", "foo.pages.dev"]) {
      const { win, doc, appended } = fakeEnvironment();
      expect(initAnalytics(host, win, doc)).toBe(false);
      expect(appended).toEqual([]);
      expect(win.gtag).toBeUndefined();
      expect(win.dataLayer).toBeUndefined();
    }
  });

  it("on production queues js/config and injects gtag.js once", () => {
    const { win, doc, appended } = fakeEnvironment();
    expect(initAnalytics("shingetsu-layout.com", win, doc)).toBe(true);
    expect(appended).toHaveLength(1);
    expect(appended[0]?.src).toBe(`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`);
    expect(appended[0]?.async).toBe(true);
    const queued = win.dataLayer.map((entry) => Array.from(entry as ArrayLike<unknown>));
    expect(queued[0]?.[0]).toBe("js");
    expect(queued[1]).toEqual(["config", GA_MEASUREMENT_ID]);
  });
});
