import { defineConfig } from '@playwright/test';

/**
 * Браузерный смоук — верхний, самый тонкий слой: только то, что рождается в настоящем браузере
 * (сетка рисуется, ссылки ведут, форма отправляется). Правила и права проверены http-тестами
 * бэкенда, раскладка и разбор адреса — юнит-тестами фронта; дублировать их здесь незачем.
 *
 * Браузер — системный chromium образа zenika/alpine-chrome:with-node: свой Playwright не качает
 * (в alpine он и не поставится).
 */
export default defineConfig({
  testDir: './tests',
  // 60 секунд, а не 30: ПЕРВАЯ навигация из контейнера в host.docker.internal на Windows
  // разрешается долго (DNS и маршрут прогреваются), и только на ней тест упирался в таймаут.
  timeout: 60_000,
  // Стенд живой, а не стерильный: одиночный таймаут пересборки страницы — не дефект.
  retries: 1,
  // Машина слабая (7,7 ГБ, рядом крутится портал) — не душим стенд параллельными вкладками.
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://host.docker.internal:3001',
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium-browser',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
    viewport: { width: 1280, height: 900 },
  },
});
