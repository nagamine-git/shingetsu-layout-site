#!/usr/bin/env bash
set -euo pipefail
umask 077

cycle="${1:-daily}"
case "$cycle" in
  daily|weekly|monthly) ;;
  *) printf 'Expected daily, weekly or monthly\n' >&2; exit 2 ;;
esac

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
mkdir -p .growth/snapshots .growth/reports .growth/runs
exec 9>.growth/cycle.lock
flock -w 60 9
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$cycle-$$"
snapshot=".growth/snapshots/$run_id.json"
run_dir=".growth/runs/$run_id"
report=".growth/reports/$run_id.md"
mkdir "$run_dir"
node scripts/growth-snapshot.mjs > "$run_dir/snapshot.tmp"
mv "$run_dir/snapshot.tmp" "$snapshot"
git status --short > "$run_dir/git-status.txt"
git rev-parse HEAD > "$run_dir/local-head.txt"
if curl --max-time 45 -fsSL https://shingetsu-layout.com/ -o "$run_dir/home.html"; then
  printf 'Homepage fetched successfully; inspect HTML for deployed changes.\n' > "$run_dir/site-status.txt"
else
  printf 'Homepage fetch failed; deployment state unknown.\n' > "$run_dir/site-status.txt"
fi

if node --input-type=module - "$snapshot" <<'JS'
import { readFileSync } from 'node:fs';
const snapshot = JSON.parse(readFileSync(process.argv[2], 'utf8'));
process.exit(Number.isInteger(snapshot.stars) && snapshot.stars >= 101 ? 0 : 1);
JS
then
  printf '# 目標達成確認\n\nGitHub APIで101 Star以上を確認。証拠: %s\n' "$snapshot" > "$report"
else
  {
    printf '新月配列の %s PDCAレビューを日本語で実施してください。\n' "$cycle"
    printf 'GROWTH-OPERATIONS.md と GROWTH.md を読み、定義・周期・判断基準を守ってください。\n'
    printf '今回の証拠: %s と %s。過去の .growth/reports/ と .growth/snapshots/ から該当期間を参照してください。\n' "$snapshot" "$run_dir"
    printf '初回や欠測では比較不能と明記。公開HTMLとローカル変更を区別し、未公開施策の効果を主張しないでください。\n'
    printf '以前の次アクションの実施状況を確認し、P/D/C/Aと次の1件・担当・期限を示してください。\n'
    printf '読み取り専用です。ファイル変更、commit/push、公開、外部投稿、他サービスの更新、追加ジョブの起動は禁止。実施していない作業を実施済みと書かないでください。\n'
    printf '最終回答をレポート本文にしてください。最大120行。必要なローカル証拠を優先し、10分以内に終えてください。\n'
  } | timeout 900 codex exec --sandbox read-only --ephemeral --color never -C "$project_root" -o "$run_dir/report.tmp" - > "$run_dir/codex.log" 2>&1
  test -s "$run_dir/report.tmp"
  mv "$run_dir/report.tmp" "$report"
fi
cp "$report" ".growth/latest-$cycle.md.tmp"
mv ".growth/latest-$cycle.md.tmp" ".growth/latest-$cycle.md"
printf 'Report: %s/%s\n' "$project_root" "$report"
