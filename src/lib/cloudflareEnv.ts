// Cloudflare の env（binding 一式）を取り出す。`astro dev` では cloudflare:workers を読み込めないので、
// 静的 import ではなく try/catch 付きの動的 import にして、開発中は「binding なし」として扱う。
export async function loadCloudflareEnv(): Promise<unknown> {
  try {
    // 型定義は未導入（api/subscribe.ts などの静的 import も同じ警告が出る）
    // @ts-ignore
    return (await import("cloudflare:workers")).env;
  } catch {
    return undefined;
  }
}
