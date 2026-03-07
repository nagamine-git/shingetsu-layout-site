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

| 変数名 | 説明 |
|--------|------|
| `TURNSTILE_SITE_KEY` | Cloudflare Turnstile サイトキー |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile シークレットキー |
| `RESEND_API_KEY` | Resend API キー |
| `RESEND_SEGMENT_ID` | Resend Segment ID（サブスクライバー管理用） |
| `CONTACT_TO_EMAIL` | お問い合わせ通知の送信先メールアドレス |

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
