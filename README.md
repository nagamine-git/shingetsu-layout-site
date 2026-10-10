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
| `MAIL_FROM` | 送信元アドレス。Resend で検証済みのドメインを使う（未設定なら確認の通知を省略） |
| `CONTACT_TO_EMAIL` | お問い合わせ通知の送信先メールアドレス |

## デプロイ

Cloudflare Pages に接続し、以下を設定する。

- **ビルドコマンド**: `pnpm build`
- **出力ディレクトリ**: `dist`
- **Node.js バージョン**: 22+
- **シークレット**: 上記環境変数を Cloudflare ダッシュボードまたは `wrangler secret put` で登録

## サイト構成

- `/` -- LP（新月配列の紹介、特徴、キーボード可視化、事前登録）
- `/practice` -- [新月タイピング](TRAINING.md)（語・短文による適応学習、間隔復習、高速化、定点測定、IME実践）
- `/blog` -- 記事一覧
- `/blog/[slug]` -- 記事詳細
- `/contact` -- お問い合わせフォーム

## グロース運用

### 匿名の利用申告

トップの「つかってます！」はボタンを押した自己申告だけを集計する。訪問カウンター、GA、ニュースレター登録とは独立し、実利用人数・アクティブユーザー数を意味しない。

- 既存の `COUNTER_DB`（D1 `shingetsu-counter`）の `usage_declarations` テーブルを使用。初回アクセスで空のテーブルを作成し、既存訪問件数や初期値を取り込まない。
- 押した時点でブラウザの localStorage に UUID を保存し、D1 はその SHA-256 と集計区分だけを永続保存する。IP、氏名、メール、User-Agent、時刻はこの機能では保存・ログ出力しない。通常の通信は既存の Cloudflare を経由し、サービス側の通常のログまで匿名化を保証するものではない。新しい解析イベントや外部サービスは追加しない。
- `(scope, token_hash)` の UNIQUE 制約で連打・同時送信・応答消失後の再送を同じ1件にする。ブラウザの保存不可時は送信を止める。端末・ブラウザ変更や保存データの削除、意図的な別キー生成までは防がない。
- `shingetsu-layout.com` / `www.shingetsu-layout.com` のみ `production`。Pages のプレビュー・pages.dev・localhost は `test` を使い画面にも試験用と表示する。試験件数は本番に混ざらない。本番で試験申告をしない。
- 読込・保存失敗は HTTP 503 / `count: null` とし、UI に確認不能を表示する。表示件数はサーバーの集計値だけを使う。
- 公開は既存の `.github/workflows/deploy.yml`（PR でテスト・ビルド・プレビュー、main マージで本番）。新規契約・認証・binding 追加は不要。ローカル確認は `pnpm build && pnpm test:usage`（一時ディレクトリのローカル D1 のみ）。

- [KPI ツリーと月・週・日 PDCA](GROWTH-OPERATIONS.md)
- [基準値・実験記録](GROWTH.md)
- `pnpm --silent growth:snapshot`: GitHub の Star・トラフィックを取得
- `bash scripts/growth-cycle.sh daily`: 取得と日次レビューを実行（週次は `weekly`、月次は `monthly`）

## 関連リポジトリ

- [nagamine-git/shingetsu-layout](https://github.com/nagamine-git/shingetsu-layout) -- 新月配列の定義データ・設定ファイル本体

## ライセンス

MIT
