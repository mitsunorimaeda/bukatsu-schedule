/**
 * 画面の通し確認（ローカル専用）。
 *  前提: ローカル Supabase が動いている（apps/web/.dev.vars の SUPABASE_URL が 127.0.0.1）
 *  動かし方: npm run e2e
 * 普段の開発サーバー（5177 / 8788）とぶつからないよう、5179 / 8789 で立てる。
 * AI の鍵は偽物に差し替えるので、テストで Claude API の料金はかからない。
 */
import { defineConfig } from '@playwright/test';

const WEB = 5179;
const FN = 8789;

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: `http://localhost:${WEB}`,
    channel: 'chrome',
    headless: true,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    viewport: { width: 1280, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  outputDir: 'e2e/.results',
  webServer: [
    {
      // Functions は dist を配るので先にビルドする。鍵は偽物に差し替え
      command: `npm run build -w apps/web && cd apps/web && npx wrangler pages dev dist --port ${FN} --binding ANTHROPIC_API_KEY=e2e-dummy-not-a-key`,
      port: FN,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `FUNCTIONS_PORT=${FN} npm run dev -w apps/web -- --port ${WEB} --strictPort`,
      port: WEB,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
