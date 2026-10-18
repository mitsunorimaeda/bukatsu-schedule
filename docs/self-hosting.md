# 自分で立てる（セルフホスト）

このアプリは **Supabase のプロジェクト 1 つ**と **Cloudflare Pages 1 つ**で動きます。学校・自治体・部のアカウントで立てれば、予定のデータも AI の鍵も自分の管理下に置けます。どちらも無料枠で始められます。

AI の鍵（Anthropic の API キー）は**無くても使えます**。鍵が無いサーバーでは、取り込み画面が自動で「自分の AI に読ませて貼り付ける」（ChatGPT・Gemini・Claude の画面を使う経路）だけになります。

## 1. Supabase

1. https://supabase.com でプロジェクトを作る（リージョンは Tokyo）。
2. SQL Editor で `supabase/migrations/` の 3 ファイルを日付順に実行する。専用スキーマ `bukatsu` だけを作ります（既存の `public` には触れません）。
3. PostgREST に `bukatsu` スキーマを公開する。SQL Editor で:
   ```sql
   alter role authenticator set pgrst.db_schemas = 'public, graphql_public, bukatsu';
   notify pgrst, 'reload config';
   ```
   （Project Settings → Data API → Exposed schemas に `bukatsu` を足しても同じ）
4. Authentication → Providers で Email を有効にする（マジックリンクだけでよければパスワードは不要）。
5. Project Settings → API Keys から、publishable（anon）キーと service_role キーを控える。

## 2. Cloudflare Pages

```bash
npm install
cp apps/web/.env.production.example apps/web/.env.production   # Supabase の URL と publishable キーを書く
cd apps/web && npm run build
npx wrangler login
npx wrangler pages project create <プロジェクト名>
npx wrangler pages deploy dist --project-name <プロジェクト名> --branch main
```

Pages の Settings → Variables and Secrets に、Production 向けの secret を置く（置いたら再デプロイ）:

| 名前 | 値 | 必須 |
|---|---|---|
| `SUPABASE_URL` | Supabase の URL | 必須 |
| `SUPABASE_ANON_KEY` | publishable キー | 必須 |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role キー（取り込み結果の保存に使う） | 必須 |
| `ANTHROPIC_API_KEY` | Claude API の鍵 | 任意。無ければ「自分の AI に読ませる」経路だけ |

## 2b. シートの自動更新（任意）

Google シート / CSV をつないだカレンダーを 1 時間ごとに見に行く仕組みは、Pages の `/api/sync` を外から叩く形です。

1. 合言葉を決めて（例: `openssl rand -hex 24`）、Pages の secret `SYNC_KEY` に置く（再デプロイ）。
2. 1 時間ごとに `POST https://<あなたの Pages>/api/sync` を `Authorization: Bearer <SYNC_KEY>` 付きで叩く。方法は何でもよい:
   - Cloudflare Workers の cron: `apps/sync-cron` をそのまま使う。`wrangler.toml` の `SYNC_URL` を自分の Pages に変え、`cd apps/sync-cron && npx wrangler secret put SYNC_KEY && npx wrangler deploy`
   - GitHub Actions の `schedule`、cron-job.org など
3. 動作確認は手で 1 回叩く: 返ってくる JSON に各カレンダーの結果（unchanged / applied / pending / error）が出ます。

叩かなければ自動更新は動かないだけで、他の機能に影響はありません。

## 3. ログインの戻り先

Supabase の Authentication → URL Configuration で、Site URL と Redirect URLs に Pages の URL（`https://<プロジェクト名>.pages.dev` と、独自ドメインがあればそれも）を登録する。

## 4. 動作確認

1. サイトを開き、メールでログイン → 「自分の予定表を作る」。
2. 「＋ カレンダー」で部を作り、表のマスをクリックして予定を 1 つ入れる。
3. 「共有・出力」で閲覧リンクと ICS の URL を作り、別のブラウザ（ログインしていない状態）で開けることを確認する。
4. 「PDF・シートを取り込む」→「自分の AI に読ませて貼り付ける」で、指示文をコピー → ChatGPT などに PDF と一緒に貼る → 返事を貼り戻す → 「確認して反映」。

## ローカル開発

`supabase start` でローカルの Supabase を立て（`supabase/config.toml` はポート 5434x）、`apps/web/.env.local` に `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` を書いて `npm run web:dev`。取り込み API をローカルで動かすには `apps/web/.dev.vars` に上の secret を書き、`npx wrangler pages dev public --port 8788` を別に起動します（Vite が `/api` と `/ics` をそこへ中継します）。

## データの扱い

[data-handling.md](data-handling.md) に、何をどこに保存し、誰が見られ、AI に何を送るかをまとめています。自分で立てた場合は「運営」があなたになります。
