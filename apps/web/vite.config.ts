import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': process.env.VITE_API_TARGET ?? 'http://127.0.0.1:3000', '/socket.io': { target: process.env.VITE_API_TARGET ?? 'http://127.0.0.1:3000', changeOrigin: false, ws: true } } },
  test: { environment: 'jsdom', setupFiles: './src/test/setup.ts', restoreMocks: true },
});
