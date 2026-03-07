# AGENTS.md -- AI エージェント共通規約

本ドキュメントは、すべての AI エージェント（Cursor, Claude Code, GitHub Copilot 等）が本プロジェクトで遵守すべき規約を定義する。

---

## プロジェクト概要

新月配列（Shingetsu Layout）を紹介する LP & Webメディア。Astro 6 + Cloudflare Pages/Workers で構築する。
仕様の詳細は `SPEC.md` を参照すること。

## ビルド・開発コマンド

```bash
pnpm install          # 依存パッケージインストール
pnpm dev              # 開発サーバー起動（workerd ローカル実行）
pnpm build            # 本番ビルド
pnpm preview          # ビルド成果物のプレビュー
pnpm check            # astro check（型チェック）
pnpm lint             # ESLint
pnpm format           # Prettier
```

## 技術スタック

- Astro 6 (beta) + `@astrojs/cloudflare` v13.x
- Tailwind CSS v4（`@tailwindcss/vite` で統合、`@astrojs/tailwind` は使用しない）
- TypeScript (strict mode)
- Cloudflare Turnstile (Managed mode) + Resend (Segments API)
- pnpm
- Node.js 22+

## コーディング規約

### TypeScript

- `strict: true` を維持する
- `any` は原則禁止。型が不明な場合は `unknown` + 型ガードを使う
- 関数の戻り値型は明示する

### Astro コンポーネント

- UI コンポーネントは `.astro` ファイルで記述する
- React / Vue / Svelte 等のフレームワーク island は使用しない
- クライアントサイド JS が必要な場合は `<script>` タグ内に vanilla TS を記述する
- `client:*` ディレクティブ（React island 等）は禁止

### スタイリング

- Tailwind CSS v4 のユーティリティクラスを優先する
- カスタム CSS は `src/styles/global.css` に集約する
- `global.css` では `@import "tailwindcss"` + `@theme { }` で構成する（旧 `@tailwind` ディレクティブは不使用）
- `tailwind.config.js` は不要（v4 では CSS 内 `@theme` で設定）
- インラインスタイルは原則禁止

### ファイル命名

- コンポーネント: PascalCase（`Hero.astro`, `SubscribeForm.astro`）
- ユーティリティ: camelCase（`turnstile.ts`, `resend.ts`）
- ページ: kebab-case または Astro のルーティング規約に従う

## Astro 6 固有の注意事項

### Cloudflare バインディング

`Astro.locals.runtime` は Astro 6 で**削除済み**。以下の新 API を使用する。

| 旧 API（使用禁止） | 新 API |
|---|---|
| `Astro.locals.runtime.env` | `import { env } from 'cloudflare:workers'` |
| `Astro.locals.runtime.cf` | `Astro.request.cf` |
| `Astro.locals.runtime.ctx` | `Astro.locals.cfContext` |

middleware でバインディングにアクセスする場合、prerender 時は undefined になるため optional chaining を使用すること。

### レンダリングモード

`output: 'hybrid'` は Astro 6 で廃止済み。アダプタ装着時のデフォルトが prerender であり、SSR が必要なルートに `export const prerender = false` を記述する。

### Content Layer API

- コレクション定義は `src/content.config.ts`（`src/content/config.ts` は非推奨でエラーになる）
- `entry.slug` → `entry.id`、`entry.render()` → `render(entry)` from `astro:content`
- Zod 4 を使用（例: `z.string().email()` → `z.email()`）
- 詳細は `SPEC.md` セクション 4.1 を参照

### その他の制約

- workerd 上の prerender では Node.js ネイティブモジュール（sharp 等）が動作しない
- Cloudflare adapter に不安定な挙動がある場合は [GitHub Issues](https://github.com/withastro/astro/issues) を確認する

## セキュリティ

- シークレット（API キー等）は `.env` に格納し、`.gitignore` に含める
- コード内へのシークレットのハードコードは禁止
- 本番環境のシークレットは `wrangler secret put` で管理する
- Turnstile トークンは必ずサーバーサイドで検証する（クライアントサイドのみの検証は不可）
- ユーザー入力は API ルート内で必ずバリデーションする

## ディレクトリ構造と責務

`SPEC.md` セクション 5 を参照。主要な責務のみ以下に記載する。

| ディレクトリ | 責務 |
|-------------|------|
| `src/pages/api/` | Cloudflare Workers で実行される API エンドポイント（`prerender = false`） |
| `src/content.config.ts` | Content Layer API のスキーマ定義（プロジェクトルート `src/` 直下） |
| `src/lib/` | ユーティリティ関数（Turnstile 検証、Resend クライアント等） |
| `src/data/` | 静的データ（キーボード配列 JSON 等） |

## コミット規約

Conventional Commits に従う。

- `feat:` 新機能
- `fix:` バグ修正
- `docs:` ドキュメントのみの変更
- `style:` コードの意味に影響しない変更（空白、フォーマット等）
- `refactor:` バグ修正でも機能追加でもないコード変更
- `chore:` ビルドプロセスや補助ツールの変更
