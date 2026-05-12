import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Electron prod 模式下 renderer 走 file:// 协议加载 dist/index.html;
  // 默认 base '/' 会被解析成根目录而非 dist/ → 资源全 404 → 黑屏。
  // './' 让所有 asset 引用变成相对路径,file:// 也能找到。
  base: './',
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
