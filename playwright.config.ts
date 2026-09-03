import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 90000,
  retries: 0,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:5182',
    headless: true,
    viewport: { width: 1280, height: 900 },
  },
  reporter: [['list']],
});
