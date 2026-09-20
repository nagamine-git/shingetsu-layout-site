# GitHub Star 獲得の検証記録

KPI ツリー・日次／週次／月次の運用は [GROWTH-OPERATIONS.md](GROWTH-OPERATIONS.md) を参照。

## 目標と基準値

- 対象: https://github.com/nagamine-git/shingetsu-layout
- 完了条件: GitHub API の `stargazerCount` が 101 以上。
- 2026-09-20 の初回確認: 3 Star。目標まで 98。
- 確認コマンド: `gh repo view nagamine-git/shingetsu-layout --json stargazerCount,url`
- Star は利用者本人の判断によるものとし、クリック数を Star 数として扱わない。

## 再計測

`pnpm --silent growth:snapshot` で取得日時・Star 数・残数と GitHub の閲覧、clone、参照元、人気ページを JSON 出力する。認証済みの `gh` が必要。トラフィック取得に失敗した項目は 0 ではなく `unavailable` として記録する。Star 数の取得失敗時はコマンド自体が失敗する。

GitHub のトラフィックは直近 14 日の集計。任意の保存先へ JSON を記録し、期間の重なった総数を足し合わせない。clone のユニーク数は利用者・インストール完了数ではない。自分のアクセスや自動処理も集計に含まれ得る。

2026-09-20 の公開前観測:

| 指標 | 数値 |
|---|---|
| 閲覧 | 33 |
| ユニーク閲覧 | 11 |
| clone | 13 |
| ユニーク clone | 13 |
| Google 参照 | 15 閲覧 / 6 ユニーク |
| GitHub 内参照 | 3 閲覧 / 1 ユニーク |
| Bing 参照 | 2 閲覧 / 1 ユニーク |

検索経由の訪問は確認できるが、母数が少なく、Star への転換率はこの集計だけでは算出できない。

## 実験 1: 体験後・記事読了後の GitHub 導線

2026-09-20: ユーザーがコミット・push・本番公開を「すべて承認」。この変更一式について承認待ちは解消。既存の未追跡 VideoDemo.astro は今回の変更対象に含めない。

本番反映確認: **2026-09-20 17:45:08 JST（08:45:08 UTC）**。この時刻を観測開始とする。PR #7、実装コミット `7359dec941d836990a7a71da992cd558dc9b18f8`、main のマージコミット `9b57670cc191a0dc7e7921e76c2e19be1efd0779`。GitHub Actions run `35500375456` が成功し、本番トップ・全10記事で CTA を各1個、トップの Windows 案内と llms.txt の変更を確認した。

- 初回判定は2026-09-27 17:45 JST以降（定例では9月28日週報）。9月21日週報は公開・取得状況の確認に限定する。
- 開始時の直近確認は3 Star。GAイベントの実受信・セッション集計は未確認のため、現時点ではStar純増とGitHubトラフィックを観測する。CTA転換率の判定はデータ取得後とする。
- Windows案内の修正も同時公開したため、Star増減をCTA単独の効果として解釈しない。

仮説: デモ体験や記事閲覧で関心を持った読者に、設定ファイルと任意の Star の案内を示すと、リポジトリ訪問が増える。

- 変更: LP のデモ直後とブログ記事末尾に共通の案内を追加。
- 計測: 既存の GA イベント処理で `github_star_cta_click` を送信。`location` に設置位置または記事 ID を記録。
- 状態: 本番公開確認済み・観測中。公開情報は上記を参照。
- 検証: `pnpm build` 成功。生成 HTML の LP と全 10 記事で CTA が各 1 個あり、対象リポジトリへのリンクが存在することを確認。`git diff --check` 成功。GA の実受信は未確認。
- 評価: 公開後 7 日を最初の観測期間とし、対象ページの閲覧数、CTA クリック、GitHub Star 純増を記録する。流入が少なければ効果を断定せず観測期間を延長。
- 注意: サイトのクリックと GitHub の Star は個人単位で結び付けられない。Star 増加を本変更だけの効果と断定しない。
- 次の判断: クリックが少なければ文言・設置位置、訪問が増えて Star が増えなければ README と導入体験を点検する。

## 次の改善候補

### 実験 2: Black Moon デザイン（2026-09-20）

- ユーザー指定により、既存文言を維持して黒月ベースのデザインへ更新。設計と検証は `DESIGN.md` を参照。
- 仮説: 視覚的な優先順位と操作性の改善により、配列の理解とデモ・導入への遷移を助ける。
- 公開準備済み。本番反映時刻はデプロイ履歴で確定する。
- 実験 1 の 7 日間が完了する前にデザインを変更するため、公開後を別区間として扱う。CTA 単独の効果とデザイン単独の効果は分離できない。
- 既存のイベント名と KPI ツリーを維持。GA 実受信と集計の接続ができるまでは転換率を推測しない。月・週・日 PDCA は公開境界を記録して観測する。

導入案内の追加修正（2026-09-20公開確認済み）: hazkey の上流 README と公式ドキュメントは Linux / Fcitx 5 向けで、サイトの Windows 向け案内と一致しなかった。Windows は本体リポジトリに存在する Google 日本語入力用 `shingetsu-romantable.txt` への案内に変更し、実機未検証・設定の退避と復元を明記。FAQ と日英 llms.txt も同期。配布ファイルへのクリックは `install_file_click` / `location=windows` で測定する。

- 上流: https://github.com/7ka-Hiira/hazkey
- 配布テーブル: https://github.com/nagamine-git/shingetsu-layout/blob/main/shingetsu-romantable.txt
- 生成元: https://github.com/nagamine-git/shingetsu-layout/blob/main/generate_romantable.py
- Google 日本語入力の設定: https://support.google.com/ime/japanese/answer/166764?hl=ja

1. 公開 README の v1.1.0 と比較記事の v8.6 の関係を確認し、前置／後置・30／32 キーの仕様説明を統一する。
2. 評価コード・データの所在を確認し、ベンチマークの再現手順と対象バージョンを明記する。
3. OS ごとの導入手順を実環境または上流ドキュメントで検証し、サイト内ガイドを作る。
4. Search Console・GA の実績が取得できる場合は、検索流入と導入イベントを比較する。

外部コミュニティへの投稿・メッセージ送信は、投稿先と内容について明示的な依頼がある場合に行う。
