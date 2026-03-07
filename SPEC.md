# SPEC.md -- 新月配列サイト仕様書

本ドキュメントは shingetsu-layout-site の実装を生成するためのマスターソースである。
機能の「何を」「なぜ」を定義し、「どのように」は実装フェーズに委ねる。

---

## 1. プロジェクト定義

| 項目 | 内容 |
|------|------|
| 目的 | 新月配列（Shingetsu Layout）の認知拡大とユーザー獲得 |
| 対象 | 日本語入力の効率化に関心があるユーザー、自作キーボード愛好家 |
| 言語 | 日本語のみ（将来の i18n 拡張余地は設計上残す） |
| 出力モード | Astro デフォルト（prerender）。API ルートのみ `export const prerender = false` で SSR |

## 2. サイト構成

### 2.1 LP (`/`)

シングルページ構成。上から下へスクロールする1カラムレイアウト。

| セクション | 内容 | レンダリング |
|-----------|------|------------|
| Hero | タグライン「最小かつ最高効率のPCキーボード用かな配列」+ メインビジュアル (SVG) | prerender |
| Features | 3カード: 1キー統合 / 最小打鍵数 / 3層構造 | prerender |
| LayerDemo | 3層構造のインタラクティブ図解。レイヤー切替ボタンで Layer 0/1/2 の文字配置を可視化 | prerender + client JS |
| KeyboardViz | SVGベースのキーボード可視化。`shingetsu_analyzer.json` のデータを TypeScript に移植してレンダリング | prerender + client JS |
| GetStarted | インストール手順（macOS: Karabiner / Windows・Linux: hazkey） | prerender |
| Subscribe | ニュースレター購読 + 事前登録フォーム（Turnstile Managed mode 保護） | prerender + client JS |

### 2.2 Blog (`/blog`, `/blog/[slug]`)

| 項目 | 内容 |
|------|------|
| コンテンツ管理 | Astro Content Layer API（`src/content/blog/*.md`、loader: `glob()` 使用） |
| 一覧ページ | 公開日降順、タグフィルタリング |
| 記事ページ | Markdown レンダリング、OGP meta 自動生成 |
| レンダリング | 全ページ prerender |

### 2.3 Contact (`/contact`)

| 項目 | 内容 |
|------|------|
| フォーム項目 | 名前 (name)、メールアドレス (email)、本文 (message) |
| 保護 | Cloudflare Turnstile（Managed mode） |
| 送信後 | 成功/失敗メッセージを同一ページ内に表示 |

## 3. API 仕様

全 API ルートは Cloudflare Workers 上で実行される。
環境変数・バインディングは `import { env } from 'cloudflare:workers'` でアクセスする。

> **注意:** `TURNSTILE_SITE_KEY` は prerender されるクライアント HTML に埋め込む必要があるため、`cloudflare:workers` ではなく `import.meta.env.PUBLIC_TURNSTILE_SITE_KEY` でビルド時に参照する。`TURNSTILE_SECRET_KEY` 等のサーバー専用シークレットのみ `cloudflare:workers` を使用する。

### 3.1 `POST /api/subscribe`

**リクエスト:**

```json
{
  "email": "user@example.com",
  "type": "newsletter",
  "turnstileToken": "..."
}
```

> `type` は `"newsletter"` または `"preregister"` のいずれか。

**処理フロー:**

1. Turnstile トークン検証（`POST https://challenges.cloudflare.com/turnstile/v0/siteverify`）
2. 検証失敗 → `403 { error: "verification_failed" }`
3. email バリデーション（形式チェック）
4. Resend Contact Properties で `type` プロパティを付与し、コンタクト作成
5. Resend で確認メール送信（登録完了の通知）
6. 成功 → `200 { ok: true }`

**エラーレスポンス:**

| ステータス | 条件 |
|-----------|------|
| 400 | email 形式不正、type 不正、turnstileToken 欠損 |
| 403 | Turnstile 検証失敗 |
| 429 | レート制限超過（Cloudflare Rate Limiting: 5 req/min/IP） |
| 500 | Resend API エラー |

### 3.2 `POST /api/contact`

**リクエスト:**

```json
{
  "name": "山田太郎",
  "email": "user@example.com",
  "message": "新月配列について質問があります。",
  "turnstileToken": "..."
}
```

**処理フロー:**

1. Turnstile トークン検証
2. 検証失敗 → `403 { error: "verification_failed" }`
3. 入力バリデーション（name: 1-100文字、email: 形式チェック、message: 1-5000文字）
4. Resend でオーナー宛に通知メール送信（From: noreply@ドメイン、Reply-To: 送信者 email）
5. Resend で送信者宛に受領確認メール送信
6. 成功 → `200 { ok: true }`

**エラーレスポンス:**

| ステータス | 条件 |
|-----------|------|
| 400 | バリデーション失敗 |
| 403 | Turnstile 検証失敗 |
| 429 | レート制限超過（Cloudflare Rate Limiting: 3 req/min/IP） |
| 500 | Resend API エラー |

## 4. データモデル

### 4.1 Blog 記事 frontmatter

Content Layer API で `src/content.config.ts` に Zod 4 スキーマを定義する。

```yaml
title: "記事タイトル"         # 必須、string
description: "記事の概要"     # 必須、string、OGP description に使用
publishedAt: 2026-03-07       # 必須、date
updatedAt: 2026-03-08         # 任意、date
tags: ["配列設計", "効率化"]  # 任意、string[]
draft: false                  # 任意、boolean、デフォルト false
```

Content Layer API の注意点:
- コレクション定義には `loader: glob({ pattern: "**/*.md", base: "src/content/blog" })` を使用
- 記事の取得は `getEntry()` / `getCollection()`、レンダリングは `render(entry)` from `astro:content`
- `entry.slug` ではなく `entry.id` を使用

### 4.2 Resend コンタクト管理

Resend Segments API + Contact Properties で管理する（Audiences API は deprecated）。

**事前定義が必要な Contact Properties:**

| Property key | type | fallbackValue | 用途 |
|-------------|------|---------------|------|
| `type` | string | `"newsletter"` | `"newsletter"` または `"preregister"` |
| `subscribed_at` | string | - | 登録日時（ISO 8601） |

**コンタクト作成例:**

```typescript
await resend.contacts.create({
  email: "user@example.com",
  customProperties: {
    type: "preregister",
    subscribed_at: new Date().toISOString(),
  },
  segmentIds: [{ id: env.RESEND_SEGMENT_ID }],
});
```

### 4.3 キーボード配列データ

元リポジトリの `shingetsu_analyzer.json` を権威データとする。Web用に `src/data/layout.json` へ必要なフィールドのみ抽出・変換して配置する。

**抽出対象:**
- `keys[][]`: キーID、legend（レイヤー別表示文字）、finger、size
- `conversion{}`: かな文字 → 打鍵シーケンス対応表

## 5. ディレクトリ構造（指針）

```
src/
├── layouts/
│   └── Base.astro            # 共通レイアウト (HTML head, header, footer)
├── components/               # Astro コンポーネント (.astro)
├── pages/
│   ├── index.astro           # LP
│   ├── blog/
│   │   ├── index.astro       # 記事一覧
│   │   └── [...slug].astro   # 記事詳細
│   ├── contact.astro
│   └── api/
│       ├── subscribe.ts      # POST /api/subscribe (prerender = false)
│       └── contact.ts        # POST /api/contact (prerender = false)
├── content/
│   └── blog/                 # Markdown 記事
├── content.config.ts         # Content Layer API スキーマ定義（プロジェクトルート src/ 直下）
├── lib/
│   ├── turnstile.ts          # Turnstile トークン検証ユーティリティ
│   └── resend.ts             # Resend クライアント初期化・ヘルパー
├── data/
│   └── layout.json           # shingetsu_analyzer.json から導出した配列データ
└── styles/
    └── global.css            # @import "tailwindcss" + @theme カスタマイズ
```

## 6. 非機能要件

| 項目 | 基準 |
|------|------|
| Lighthouse Performance | >= 95 |
| 初回読み込み JS | < 50KB（インライン `<script>` 最小化） |
| レスポンシブ | mobile-first、375px 〜 1440px |
| Turnstile | Managed mode |
| OGP | 全ページに title, description, og:image を出力 |
| OG画像 | 静的アセット（`public/og-default.png`, 1200x630）。v1 では全ページ共通 |
| アクセシビリティ | セマンティック HTML、キーボード操作可能なフォーム |
| フォント | Google Fonts CDN（Noto Sans JP）、preconnect + display=swap |
| Analytics | Cloudflare Web Analytics（Pages 連携で自動挿入） |

### 6.1 フォント最適化戦略

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap">
```

Google Fonts は日本語フォントを自動的に Unicode Range サブセット分割して配信するため、
self-host + 手動サブセット化と同等以上のパフォーマンスを得られる。

### 6.2 Tailwind CSS v4 統合

`@astrojs/tailwind`（v3 用）は使用しない。Vite プラグインで統合する。

```typescript
// astro.config.ts
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  vite: { plugins: [tailwindcss()] },
});
```

`src/styles/global.css`:
```css
@import "tailwindcss";

@theme {
  /* カスタムテーマ定義 */
}
```

### 6.3 Rate Limiting

Workers はリクエストごとにステートレスなアイソレートで実行されるため、インメモリの簡易チェックでは Rate Limiting が機能しない。
v1 では Cloudflare Dashboard の Rate Limiting Rule で制御し、コード側は 429 レスポンスの生成のみ担う。

| エンドポイント | 閾値 |
|---------------|------|
| `POST /api/subscribe` | 5 req/min/IP |
| `POST /api/contact` | 3 req/min/IP |

## 7. 受入基準

- [ ] LP の全セクションが正常にレンダリングされる
- [ ] LayerDemo でレイヤー 0/1/2 の切替が動作する
- [ ] KeyboardViz が `shingetsu_analyzer.json` のデータを正確に反映する
- [ ] `/api/subscribe` に有効なリクエスト → Resend Segment にコンタクト追加
- [ ] `/api/subscribe` に無効な Turnstile トークン → 403
- [ ] `/api/contact` に有効なリクエスト → オーナーに通知 + 送信者に受領確認
- [ ] `/api/contact` に無効な Turnstile トークン → 403
- [ ] Blog 記事 Markdown が正常にレンダリングされる
- [ ] Blog 一覧で draft: true の記事が非表示
- [ ] 全ページの OGP meta が正常に出力される
- [ ] Lighthouse Performance >= 95（LP）
- [ ] モバイル表示 (375px) でレイアウト崩れなし
- [ ] Cloudflare Web Analytics でページビューが記録される

## 8. 未決定事項

<!-- NEEDS_HUMAN_INPUT -->
- カスタムドメイン: 未定（仮: `shingetsu.dev`。確定後に Resend 送信元ドメインも設定）
