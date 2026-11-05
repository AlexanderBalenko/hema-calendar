import { defineConfig } from '@playwright/test';

/**
 * Браузерный смоук — верхний, самый тонкий слой: только то, что рождается в настоящем браузере
 * (сетка рисуется, ссылки ведут, фильтр переживает перезагрузку). Отбор и раскладку проверяют
 * юнит-тесты, данные — проверка YAML; дублировать их здесь незачем.
 *
 * Сайт статический, поэтому смоук сам поднимает раздачу собранных файлов: ни стенда, ни базы,
 * ни сети до хоста — всё внутри одного контейнера. Браузер — системный chromium образа
 * zenika/alpine-chrome:with-node (свой Playwright не качает, в alpine он и не поставится).
 */
const PORT = Number(process.env.E2E_PORT ?? 3002);

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 1,
  workers: 1,
  reporter: [['list']],
  webServer: {
    command: `node static-server.mjs ${process.env.E2E_SITE ?? '../frontend/out'} ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium-browser',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
    viewport: { width: 1280, height: 900 },
  },
});
