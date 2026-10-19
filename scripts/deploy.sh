#!/usr/bin/env bash
# 配信: 型チェック → 計算部分のテスト → 画面の通し確認（ローカル）→ ビルド → Cloudflare Pages
# どれかが失敗したら配信しない。
#   scripts/deploy.sh             本番（bukatsu-schedule）
#   SKIP_E2E=1 scripts/deploy.sh  画面の通し確認を飛ばす（ローカル Supabase が動かないときだけ。理由を記録すること）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PROJECT="${PAGES_PROJECT:-bukatsu-schedule}"

echo "== 型チェック"
node_modules/.bin/tsc -p apps/web/tsconfig.app.json --noEmit
echo "== 計算部分のテスト"
node --import tsx --test packages/core/src/core.test.ts
if [ "${SKIP_E2E:-}" = "1" ]; then
  echo "!! 画面の通し確認を飛ばします（SKIP_E2E=1）"
else
  echo "== 画面の通し確認（ローカル Supabase）"
  npx playwright test
fi
echo "== ビルドと配信（$PROJECT）"
(cd apps/web && npm run build && npx wrangler pages deploy dist --project-name "$PROJECT" --branch main)
