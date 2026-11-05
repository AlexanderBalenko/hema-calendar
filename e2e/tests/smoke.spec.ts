import { expect, test } from '@playwright/test';

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

test.describe('Календарь', () => {
  test('лента недель открывается главным видом', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('load');

    // Лента — вид по умолчанию, как в портале: недели строками, дни колонками.
    await expect(page.getByText('пн', { exact: true })).toBeVisible();
    await expect(page.getByText('воскресенье', { exact: true })).toBeVisible();
    await expect(page.locator('a[href*="/events/"]').first()).toBeVisible();
  });

  test('сетка месяца открывается и показывает текущий месяц', async ({ page }) => {
    await page.goto('/?view=month');
    await page.waitForLoadState('load');

    // «Сегодня» календарь считает по Москве, а прогон может идти в UTC: в ночь на первое
    // число ожидания разъехались бы на месяц.
    const moscow = new Date(Date.now() + 3 * 60 * 60 * 1000);
    // Заголовка у сетки нет (как в портале — месяц показывает полоска), поэтому сверяем
    // выбранный месяц по ней.
    await expect(page.getByRole('link', { name: new RegExp(`^${MONTHS[moscow.getUTCMonth()]}`) }))
      .toHaveAttribute('aria-current', 'date');

    // Сегодняшнее число подсвечено ровно одно.
    await expect(page.locator('.bg-primary.rounded-full')).toHaveCount(1);
  });

  test('полоска месяцев листает календарь', async ({ page }) => {
    await page.goto('/?view=month');

    // Полоска — главная навигация календаря портала: месяц выбирается ссылкой с числом турниров.
    const march = page.getByRole('link', { name: /^Март/ });
    await expect(march).toBeVisible();
    await march.click();
    await page.waitForURL(/month=/);
    await expect(page.getByRole('link', { name: /^Март/ })).toHaveAttribute('aria-current', 'date');
  });

  test('турнир открывается своей страницей, и она собрана заранее', async ({ page }) => {
    await page.goto('/?view=list&period=past');
    const first = page.locator('a[href*="/events/"]').first();
    // В строке списка несколько колонок; название — вторая, после даты.
    const title = (await first.locator('span').nth(1).innerText()).trim();
    const href = await first.getAttribute('href');
    await first.click();

    await expect(page).toHaveURL(/\/events\//);
    await expect(page.locator('h1')).toHaveText(title);
    // Разметка страницы турнира готова на сборке, а не рисуется скриптом: без этого её не
    // найдёт поиск, ради которого страницы и делались статическими.
    const response = await page.request.get(href ?? '/');
    expect(await response.text()).toContain(title);
  });

  test('фильтр по оружию сужает список и снимается «Сбросить»', async ({ page }) => {
    await page.goto('/?view=list&period=all');
    const rows = page.locator('a[href*="/events/"]');
    const before = await rows.count();
    expect(before).toBeGreaterThan(0);

    // Оружие — мультиселект, как в портале: снимаем «Все» и отмечаем одну саблю.
    await page.getByTitle(/^Оружие/).click();
    // «Все» есть и в списке периода — берём то, что внутри раскрытого списка оружия.
    const weaponPanel = page.locator('div.absolute').filter({ hasText: 'Сабля' }).first();
    await weaponPanel.getByText('Все', { exact: true }).click();
    await weaponPanel.getByText('Сабля', { exact: true }).click();

    await expect(page).toHaveURL(/weapons=saber/);
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
    // Активный фильтр виден в самой строке: триггер оружия перекрашивается акцентом.
    await expect(page.getByTitle(/^Оружие/)).toHaveClass(/text-primary/);
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

test.describe('Собранные файлы', () => {
  test('картинки и стили страницы не битые', async ({ page }) => {
    // Прямая память о живом дефекте: логотип уехал на Pages с адресом без подкаталога и там
    // давал 404, а локальный смоук этого не видел — подкаталога у него не было. Теперь в CI
    // сайт собирается с подкаталогом, и эта проверка ловит любой адрес, промахнувшийся мимо.
    const broken: string[] = [];
    page.on('response', (response) => {
      if (response.status() >= 400) broken.push(`${response.status()} ${response.url()}`);
    });

    await page.goto('/');
    await page.waitForLoadState('load');

    const logo = page.locator('header img');
    await expect(logo).toBeVisible();
    expect(await logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    expect(broken).toEqual([]);
  });
});
