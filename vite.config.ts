import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    headers: {
      'Service-Worker-Allowed': '/',
      // dev 阶段禁缓存
      'Cache-Control': 'no-store, must-revalidate',
    },
    proxy: {
      // 前端 fetch /api/* 全部打到 Hono 后端
      // 后端持有 system prompt + API key,前端不接触 secrets
      '/api': {
        target: 'http://localhost:5174',
        changeOrigin: true,
      },
    },
  },
});
