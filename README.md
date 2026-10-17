# bukatsu-schedule

学校の予定・部活の予定・外部（競技団体など）の予定を 1 枚の月間表にまとめ、見せたい人に見せたい分だけ **閲覧リンク・Google カレンダー（ICS）・PDF** で配るためのツールです。先生・顧問・保護者が、ふだん配っている PDF や Google シートをそのまま元データにできます。

- **PDF・写真をそのまま取り込む**: 部の月間予定表（日 × 班の表）や学校の年間行事予定を AI が読み、確認してから反映。AI は 2 通り。アプリに読ませる（運営が Claude API の鍵を置いている場合）か、**いつもの ChatGPT・Gemini・Claude の画面に貼って返事を貼り戻す**（鍵も費用も不要）。
- **班をまたぐ予定・日をまたぐ予定・下書き**: 表では横に結合、配信では班ごとのカレンダーに。仮の予定は下書きにしておけば外に出ません。
- **見せ方を選ぶ**: カレンダー・班・期間を選んで、閲覧リンク、ICS（Google カレンダー等に購読）、PDF（A4 横/縦、A3）に。
- **版の違いが見える**: 新しい PDF を取り込むと、前の版からの追加・変更・取消が色で出て、連絡文もコピーできます。
- **生徒名は扱いません**: 取り込みの指示でも入力欄でも、生徒の氏名は対象外です。

## 試す・立てる

- 自分で立てる手順: [docs/self-hosting.md](docs/self-hosting.md)（Supabase 1 つ + Cloudflare Pages 1 つ。無料枠で可）
- データの扱い（保存場所・AI に送るもの・持ち出し・削除）: [docs/data-handling.md](docs/data-handling.md)
- 設計: [docs/plan.md](docs/plan.md)、画面の考え方: [docs/ux-redesign.md](docs/ux-redesign.md)

## 構成

| 場所 | 内容 |
|---|---|
| `apps/web` | 画面（Vite + React）と Cloudflare Pages Functions（`/ics` 配信、`/api/import` 取り込み） |
| `packages/core` | データモデル、正規化（種類判定・時刻抽出）、期間の畳み込み、ICS 生成、版差分、AI 読み取りの指示文とスキーマ |
| `packages/importers` | CLI 取り込み: 学校 PDF、部活 PDF、xlsx、CSV。`schools/<id>.yaml` で設定 |
| `supabase/migrations` | 専用スキーマ `bukatsu`（テーブル・RLS・RPC）。既存プロジェクトに同居できます |
| `schools/example.yaml` | CLI 取り込みの設定例 |
| `fixtures/` | Git 管理外。実物の予定表を置く場所（生徒名を含むことがあるので公開しない） |

## 開発

```bash
npm install
npm test                # core のテスト
npm run typecheck
npm run web:dev         # 画面（apps/web/.env.local に Supabase の接続先）
```

## ライセンス

MIT（[LICENSE](LICENSE)）。
