/// <reference types="astro/client" />

interface Window {
  dataLayer: unknown[];
  gtag: (...args: unknown[]) => void;
  /** AARRR 計測用の薄いラッパー（Base.astro で定義） */
  track: (name: string, params?: Record<string, unknown>) => void;
}
