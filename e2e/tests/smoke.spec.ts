import { expect, test, type Page } from '@playwright/test';

/**
 * Смоук календаря. Проверяет не правила, а проводку: страница рисуется, ссылки ведут куда надо,
 * фильтр доезжает до сервера и обратно, заявка доходит до очереди модерации.
 *
 * Предусловие — поднятый стенд с данными (docker compose up -d, импорт прогнан). Тесты читают
 * текущее состояние, а не ждут конкретных турниров: «у стенда всегда есть Saber Meister» —
 * это зависимость от накопленных данных, и однажды она ломается.
 */
const ADMIN_KEY = process.env.E2E_ADMIN_KEY ?? 'dev-admin-key';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

async function monthTitle(page: Page): Promise<string> {
  return (await page.locator('h1').first().innerText()).trim();
}

test.describe('Публичный календарь', () => {
  test('сетка месяца открывается и показывает текущий месяц', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load');

    // «Сегодня» календарь считает по Москве (TZ контейнера фронта), а прогон может идти в UTC:
    // в ночь на первое число ожидания разъехались бы на месяц.
    const moscow = new Date(Date.now() + 3 * 60 * 60 * 1000);
    await expect(page.locator('h1').first()).toContainText(MONTHS[moscow.getUTCMonth()]);
    await expect(page.locator('h1').first()).toContainText(String(moscow.getUTCFullYear()));

    // Шапка дней недели — семь колонок, первая «Пн»: без неё это не календарь.
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

  test('турнир из сетки открывается своей страницей', async ({ page }) => {
    await page.goto('/?view=list&period=past');
    const first = page.locator('a[href^="/events/"]').first();
    const title = (await first.innerText()).trim();
    await first.click();

    await expect(page).toHaveURL(/\/events\//);
    await expect(page.locator('h1')).toHaveText(title);
    // На странице турнира нет и не должно быть результатов — сервис их не хранит.
    await expect(page.getByText('Результаты', { exact: true })).toHaveCount(0);
  });

  test('фильтр по оружию сужает список, «Сбросить» возвращает', async ({ page }) => {
    await page.goto('/?view=list&period=all');
    await page.getByRole('button', { name: /Фильтры/ }).click();

    const rows = page.locator('a[href^="/events/"]');
    const before = await rows.count();
    expect(before).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Сабля', exact: true }).click();
    await expect(page.locator('a[href^="/events/"]')).not.toHaveCount(before);
    expect(page.url()).toContain('weapons=saber');
    const filtered = await page.locator('a[href^="/events/"]').count();
    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThan(before);

    await page.getByRole('button', { name: 'Сбросить' }).click();
    await expect(page.locator('a[href^="/events/"]')).toHaveCount(before);
  });

  test('прошедшие показываются от свежих к старым', async ({ page }) => {
    await page.goto('/?view=list&period=past');
    const dividers = await page.locator('h2').allInnerTexts();
    expect(dividers.length).toBeGreaterThan(1);

    const year = (text: string) => Number(text.trim().split(' ').pop());
    const index = (text: string) => MONTHS.findIndex((m) => text.toLowerCase().startsWith(m.toLowerCase()));
    const keys = dividers.map((d) => year(d) * 12 + index(d));
    const sorted = [...keys].sort((a, b) => b - a);
    expect(keys).toEqual(sorted);
  });

  test('адрес с мусором в параметрах не роняет страницу', async ({ page }) => {
    const response = await page.goto('/?month=2026-13&view=галерея&city=ноль&weapons=,,');
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1').first()).toBeVisible();
  });
});

test.describe('Заявка и модерация', () => {
  test('заявка доходит до очереди модерации и отклоняется из неё', async ({ page }) => {
    const title = `Смоук-заявка ${Date.now()}`;

    await page.goto('/submit');
    await page.getByPlaceholder('Название турнира').fill(title);
    await page.getByLabel('Дата начала').fill('2027-12-11');
    await page.getByPlaceholder('Площадка и адрес').fill('Зал смоука');
    await page.getByPlaceholder('Ваш контакт для модератора').fill('telegram @smoke');

    // Номинация: без неё турнир не находится фильтрами, ради этого она в форме и появилась.
    await page.getByRole('button', { name: '+ Добавить номинацию' }).click();
    await page.getByRole('button', { name: 'Оружие' }).click();
    await page.getByRole('option').first().click();
    await page.getByRole('button', { name: 'Командная' }).click();

    await page.getByRole('button', { name: 'Отправить заявку' }).click();
    await expect(page.getByText('Заявка отправлена')).toBeVisible();

    // В публичном календаре её ещё нет.
    await page.goto(`/?view=list&period=all&q=${encodeURIComponent(title)}`);
    await expect(page.getByText(title)).toHaveCount(0);

    // А в очереди — есть, вместе с контактом заявителя.
    await page.goto('/moderation');
    await page.getByLabel('Ключ модератора').fill(ADMIN_KEY);
    await page.getByRole('button', { name: 'Войти' }).click();

    const card = page.locator('article').filter({ hasText: title });
    await expect(card).toBeVisible();
    await expect(card).toContainText('telegram @smoke');
    await expect(card).toContainText('команда');

    await card.getByRole('button', { name: 'Отклонить' }).click();
    await card.getByLabel('Причина отказа').fill('смоук-прогон');
    await card.getByRole('button', { name: 'Отклонить' }).click();
    await expect(page.locator('article').filter({ hasText: title })).toHaveCount(0);
  });

  test('без ключа очередь модерации не открывается', async ({ page }) => {
    await page.goto('/moderation');
    await expect(page.getByLabel('Ключ модератора')).toBeVisible();
    await expect(page.locator('article')).toHaveCount(0);

    await page.getByLabel('Ключ модератора').fill('wrong-key');
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByText('Ключ не подошёл.')).toBeVisible();
    await expect(page.locator('article')).toHaveCount(0);
  });

  test('ключ с кириллицей объясняет себя, а не притворяется поломкой сервиса', async ({ page }) => {
    // Заголовок HTTP не принимает не-latin1, и fetch падает ДО отправки. Экран обязан сказать
    // про ключ, иначе модератор будет чинить «упавший сервис», который работает.
    await page.goto('/moderation');
    await page.getByLabel('Ключ модератора').fill('ключ-кириллицей');
    await page.getByRole('button', { name: 'Войти' }).click();

    await expect(page.getByText(/нельзя передать заголовком/)).toBeVisible();
    await expect(page.getByText('Сервис недоступен.')).toHaveCount(0);
  });
});
