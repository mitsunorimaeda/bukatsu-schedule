import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// /api と /ics は Pages Functions（開発中は wrangler pages dev が 8788 番で受ける。画面の自動確認は FUNCTIONS_PORT で別の番号）
const fn = `http://127.0.0.1:${process.env.FUNCTIONS_PORT ?? '8788'}`;
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': fn,
      '/ics': fn,
    },
  },
});
