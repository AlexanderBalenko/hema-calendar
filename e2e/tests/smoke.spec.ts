import { expect, test, type Page } from '@playwright/test';

/**
 * Смоук статического календаря: страницы открываются, ссылки ведут куда надо, фильтры
 * отбирают. Сервера у сайта нет — проверяем собранные файлы, отданные обычной раздачей
 * статики (scripts/e2e-smoke.sh).
 *
 * Тесты читают то, что в календаре есть сейчас, а не ждут конкретных турниров: «у нас всегда
 * есть Saber Meister» — это зависимость от данных, и однажды она ломается.
 */
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

async function monthTitle(page: Page): Promise<string> {
  return (await page.locator('h1').first().innerText()).trim();
}

test.describe('Календарь', () => {
  test('сетка месяца открывается и показывает текущий месяц', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load');

    // «Сегодня» календарь считает по Москве, а прогон может идти в UTC: в ночь на первое
    // число ожидания разъехались бы на месяц.
    const moscow = new Date(Date.now() + 3 * 60 * 60 * 1000);
    await expect(page.locator('h1').first()).toContainText(MONTHS[moscow.getUTCMonth()]);
    await expect(page.locator('h1').first()).toContainText(String(moscow.getUTCFullYear()));

    await expect(page.getByText('Пн', { exact: true })).toBeVisible();
    await expect(page.getByText('Вс', { exact: true })).toBeVisible();
    // Сегодняшнее число подсвечено ровно одно.
    await expect(page.locator('.bg-primary.rounded-full')).toHaveCount(1);
  });

  test('месяц листается ссылками и возвращается кнопкой «Сегодня»', async ({ page }) => {
    await page.goto('/');
    const start = await monthTitle(page);

    await page.getByLabel('Следующий месяц').click();
    await expect(page.locator('h1').first()).not.toHaveText(start);
    expect(page.url()).toContain('month=');

    await page.getByRole('link', { name: 'Сегодня' }).click();
    await expect(page.locator('h1').first()).toHaveText(start);
  });

  test('турнир открывается своей страницей, и она собрана заранее', async ({ page }) => {
    await page.goto('/?view=list&period=past');
    const first = page.locator('a[href*="/events/"]').first();
    const title = (await first.innerText()).trim();
    const href = await first.getAttribute('href');
    await first.click();

    await expect(page).toHaveURL(/\/events\//);
    await expect(page.locator('h1')).toHaveText(title);
    // Разметка страницы турнира готова на сборке, а не рисуется скриптом: без этого её не
    // найдёт поиск, ради которого страницы и делались статическими.
    const response = await page.request.get(href ?? '/');
    expect(await response.text()).toContain(title);
  });

  test('фильтр по оружию сужает список, «Сбросить» возвращает', async ({ page }) => {
    await page.goto('/?view=list&period=all');
    await page.getByRole('button', { name: /Фильтры/ }).click();

    const rows = page.locator('a[href*="/events/"]');
    const before = await rows.count();
    expect(before).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Сабля', exact: true }).click();
    await expect(rows).not.toHaveCount(before);
    expect(page.url()).toContain('weapons=saber');
    const filtered = await rows.count();
    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThan(before);

    await page.getByRole('button', { name: 'Сбросить' }).click();
    await expect(rows).toHaveCount(before);
  });

  test('фильтры переживают перезагрузку: ссылкой можно поделиться', async ({ page }) => {
    await page.goto('/?view=list&period=all&weapons=saber');
    const count = await page.locator('a[href*="/events/"]').count();
    expect(count).toBeGreaterThan(0);

    await page.reload();
    await expect(page.locator('a[href*="/events/"]')).toHaveCount(count);
    await expect(page.getByRole('button', { name: 'Сабля', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('прошедшие показываются от свежих к старым', async ({ page }) => {
    await page.goto('/?view=list&period=past');
    const dividers = await page.locator('h2').allInnerTexts();
    expect(dividers.length).toBeGreaterThan(1);

    const year = (text: string) => Number(text.trim().split(' ').pop());
    const index = (text: string) => MONTHS.findIndex((m) => text.toLowerCase().startsWith(m.toLowerCase()));
    const keys = dividers.map((d) => year(d) * 12 + index(d));
    expect(keys).toEqual([...keys].sort((a, b) => b - a));
  });

  test('адрес с мусором в параметрах не роняет страницу', async ({ page }) => {
    const response = await page.goto('/?month=2026-13&view=галерея&city=&weapons=,,');
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1').first()).toBeVisible();
  });
});

test.describe('Подача турнира', () => {
  test('страница объясняет оба пути: форму и правку данных', async ({ page }) => {
    await page.goto('/submit/');
    await expect(page.getByRole('heading', { name: 'Подать турнир' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'data/events' })).toBeVisible();
    // Регистрация не нужна — это обещание страницы, и оно должно на ней быть.
    await expect(page.getByText(/Регистрация не нужна/)).toBeVisible();
  });
});

test.describe('Для поисковика', () => {
  test('карта сайта перечисляет страницы турниров', async ({ page }) => {
    const response = await page.request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    const xml = await response.text();
    expect(xml).toContain('/events/');
    expect((xml.match(/<url>/g) ?? []).length).toBeGreaterThan(100);
  });
});
