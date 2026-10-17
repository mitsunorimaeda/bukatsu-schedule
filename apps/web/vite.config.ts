import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// /api と /ics は Pages Functions（開発中は wrangler pages dev が 8788 番で受ける）
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8788',
      '/ics': 'http://127.0.0.1:8788',
    },
  },
});
