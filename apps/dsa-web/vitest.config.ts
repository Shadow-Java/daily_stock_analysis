import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
    exclude: [...configDefaults.exclude, 'e2e/**', 'playwright.config.ts'],
    // jsdom 环境在这台机器上启动/回收很慢（单文件 environment 可达 ~40s），
    // 并行 worker 一多就互相抢占，导致大量 5s 默认超时。放宽超时并限制 worker 数。
    testTimeout: 20000,
    maxWorkers: 4,
  },
});
