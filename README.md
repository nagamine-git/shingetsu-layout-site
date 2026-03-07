# shingetsu-layout-site

[新月配列 (Shingetsu Layout)](https://github.com/nagamine-git/shingetsu-layout) を紹介する LP & Webメディア。

## 技術スタック

| カテゴリ | 技術 |
|---------|------|
| フレームワーク | Astro 6 (beta) |
| ホスティング | Cloudflare Pages + Workers |
| スタイリング | Tailwind CSS v4（`@tailwindcss/vite`） |
| フォーム保護 | Cloudflare Turnstile (Managed mode) |
| メール配信 | Resend (Segments API + Contact Properties) |
| フォント | Google Fonts CDN（Noto Sans JP） |
| 言語 | TypeScript (strict) |
| パッケージマネージャ | pnpm |

## セットアップ

```bash
pnpm install
cp .env.example .env
# .env に各種キーを設定
pnpm dev
```

## 環境変数

| 変数名 | スコープ | 説明 |
|--------|---------|------|
| `PUBLIC_TURNSTILE_SITE_KEY` | ビルド時（公開） | Cloudflare Turnstile サイトキー（クライアント HTML に埋め込まれる） |
| `TURNSTILE_SECRET_KEY` | ランタイム（秘匿） | Cloudflare Turnstile シークレットキー |
| `RESEND_API_KEY` | ランタイム（秘匿） | Resend API キー |
| `RESEND_SEGMENT_ID` | ランタイム（秘匿） | Resend Segment ID（サブスクライバー管理用） |
| `CONTACT_TO_EMAIL` | ランタイム（秘匿） | お問い合わせ通知の送信先メールアドレス |

> `PUBLIC_` 接頭辞の変数は `import.meta.env` でビルド時にアクセスする。それ以外は `import { env } from 'cloudflare:workers'` でランタイムにアクセスする。

## デプロイ

Cloudflare Pages に接続し、以下を設定する。

- **ビルドコマンド**: `pnpm build`
- **出力ディレクトリ**: `dist`
- **Node.js バージョン**: 22+
- **シークレット**: 上記環境変数を Cloudflare ダッシュボードまたは `wrangler secret put` で登録

## サイト構成

- `/` -- LP（新月配列の紹介、特徴、キーボード可視化、事前登録）
- `/blog` -- 記事一覧
- `/blog/[slug]` -- 記事詳細
- `/contact` -- お問い合わせフォーム

## 関連リポジトリ

- [nagamine-git/shingetsu-layout](https://github.com/nagamine-git/shingetsu-layout) -- 新月配列の定義データ・設定ファイル本体

## ライセンス

MIT
