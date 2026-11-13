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
    await page.goto('');
    await page.waitForLoadState('load');

    // Лента — вид по умолчанию, как в портале: недели строками, дни колонками.
    await expect(page.getByText('пн', { exact: true })).toBeVisible();
    await expect(page.getByText('воскресенье', { exact: true })).toBeVisible();
    await expect(page.locator('a[href*="/events/"]').first()).toBeVisible();
  });

  test('сетка месяца открывается и показывает текущий месяц', async ({ page }) => {
    await page.goto('?view=month');
    await page.waitForLoadState('load');

    // «Сегодня» календарь считает по Москве, а прогон может идти в UTC: в ночь на первое
    // число ожидания разъехались бы на месяц.
    const moscow = new Date(Date.now() + 3 * 60 * 60 * 1000);
    // Заголовка у сетки нет (как в портале — месяц показывает полоска), поэтому сверяем
    // выбранный месяц по ней.
    await expect(page.getByRole('link', { name: new RegExp(`^${MONTHS[moscow.getUTCMonth()]}`) }))
      .toHaveAttribute('aria-current', 'date');

    // Сегодняшнее число подсвечено ровно одно. Ищем ВНУТРИ main: снаружи, в подвале, живёт
    // переключатель темы, и его выбранная кнопка — такой же акцентный кружок. Селектор без
    // области видел два совпадения и уронил прогон на правке, которая к сетке месяца не
    // относится вовсе (08.11.2026). «Подсвечен один день» проверяется там, где дни и есть.
    await expect(page.locator('main .bg-primary.rounded-full')).toHaveCount(1);
  });

  test('полоска месяцев листает календарь', async ({ page }) => {
    await page.goto('?view=month');

    // Полоска — главная навигация календаря портала: месяц выбирается ссылкой с числом турниров.
    const march = page.getByRole('link', { name: /^Март/ });
    await expect(march).toBeVisible();
    await march.click();
    await page.waitForURL(/month=/);
    await expect(page.getByRole('link', { name: /^Март/ })).toHaveAttribute('aria-current', 'date');
  });

  // Полоска и лента связаны в обе стороны: листаешь — полоска идёт следом, выбираешь месяц —
  // лента переезжает к нему. Оба теста идут от ДЕКАБРЯ: окно в двенадцать недель от него
  // заведомо переваливает за Новый год, и видно не только смену месяца, но и смену года — а
  // месяц берётся от сегодняшнего дня, чтобы проверка не состарилась вместе с годом в коде.
  const december = () => {
    // «Сегодня» календарь считает по Москве, а прогон может идти в UTC.
    const year = new Date(Date.now() + 3 * 60 * 60 * 1000).getUTCFullYear();
    return { key: `${year}-12`, year, nextYear: year + 1 };
  };

  test('полоска идёт за прокруткой: подсвечены месяц и год, которые на экране', async ({ page }) => {
    const { key, nextYear } = december();
    await page.goto(`?month=${key}`);
    await page.waitForLoadState('load');

    await expect(page.getByRole('link', { name: new RegExp(`^Декабрь ${nextYear - 1}`) }))
      .toHaveAttribute('aria-current', 'date');

    // Подводим первую неделю января под липкий слой — и ждём, пока полоска это признает.
    // Прокручиваем на каждой попытке заново: первое же движение подтягивает недели прошлого,
    // они встают НАД видимой областью, и разовый расчёт промахнулся бы на их высоту.
    const january = `${nextYear}-01`;
    await expect.poll(async () => page.evaluate((month) => {
      const layer = document.querySelector('div.sticky.top-16')?.getBoundingClientRect().bottom;
      const week = document.querySelector(`main [data-month="${month}"]`);
      if (layer === undefined || !week) return 'января нет в ленте';
      window.scrollBy({ top: week.getBoundingClientRect().top - layer + 2, behavior: 'instant' });
      return document.querySelector('a[aria-current="date"]')?.getAttribute('aria-label') ?? 'ничего';
    }, january), 'подсвечен месяц, который под шапкой')
      // Год в полоске отдельно не спрашиваем: подписи месяцев несут ГОД, который она показывает,
      // и ссылка «Январь 2028» существует только тогда, когда год в полоске сменился на 2028.
      .toMatch(new RegExp(`^Январь ${nextYear}`));
  });

  test('месяц из полоски, уже загруженный в ленте, открывается прокруткой, а не заново', async ({ page }) => {
    // От января, пролистав ленту вниз: так март оказывается не в хвосте окна, а в середине —
    // туда можно переехать прокруткой, и перезапускать ленту незачем. Месяц берём того же года,
    // что и точка отсчёта: полоска показывает двенадцать месяцев ОДНОГО года.
    const { year } = december();
    await page.goto(`?month=${year}-01`);
    await page.waitForLoadState('load');

    const bars = page.locator('a[href*="/events/"]');
    const before = await bars.count();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(() => bars.count()).toBeGreaterThan(before);

    const march = `${year}-03`;
    await expect(page.locator(`main [data-month="${march}"]`).first()).toBeAttached();

    await page.getByRole('link', { name: new RegExp(`^Март ${year}`) }).click();

    // Лента не начиналась заново: точка отсчёта в адресе прежняя, а экран переехал к марту.
    // (Подтянутые прокруткой недели в адресе появиться могут — это не перезапуск ленты.)
    await expect.poll(() => new URL(page.url()).searchParams.get('month')).toBe(`${year}-01`);
    await expect.poll(async () => page.evaluate(() => {
      const layer = document.querySelector('div.sticky.top-16')?.getBoundingClientRect().bottom ?? 0;
      const weeks = Array.from(document.querySelectorAll('main [data-month]'));
      return weeks.find((week) => week.getBoundingClientRect().bottom > layer)
        ?.getAttribute('data-month') ?? null;
    }), 'под шапкой — выбранный месяц').toBe(march);
  });

  test('турнир открывается своей страницей, и она собрана заранее', async ({ page }) => {
    await page.goto('?view=list&period=past');
    const first = page.locator('a[href*="/events/"]').first();
    // В строке списка несколько колонок; название — во второй, после даты.
    //
    // Колонки берём ПРЯМЫМИ детьми ссылки, а название — прямым ребёнком колонки. Сквозная
    // нумерация span по всей строке разъезжается от любой вложенности: 11.11.2026 в колонку
    // даты легли две формы (короткая для телефона и полная), и `span` номер один стал скрытой
    // датой — тест сравнивал название страницы с пустой строкой.
    const title = (await first.locator('> span').nth(1).locator('> span').first().innerText()).trim();
    const href = await first.getAttribute('href');
    await first.click();

    await expect(page).toHaveURL(/\/events\//);
    await expect(page.locator('h1')).toHaveText(title);
    // Разметка страницы турнира готова на сборке, а не рисуется скриптом: без этого её не
    // найдёт поиск, ради которого страницы и делались статическими.
    //
    // Сверяем с ЭКРАНИРОВАННЫМ названием: в разметке кавычки и амперсанды живут сущностями, а
    // из браузера innerText отдаёт их символами. Поймано 09.11.2026, когда первым прошедшим
    // событием стал «Турнир: "Алга!"» — до него кавычек в названии не попадалось, и проверка
    // годами сравнивала строки, которые просто не могли разойтись.
    const escaped = title
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const response = await page.request.get(href ?? '/');
    expect(await response.text()).toContain(escaped);
  });

  test('фильтр по оружию сужает список и снимается «Сбросить»', async ({ page }) => {
    await page.goto('?view=list&period=all');
    const rows = page.locator('a[href*="/events/"]');
    const before = await rows.count();
    expect(before).toBeGreaterThan(0);

    // Оружие — мультиселект, как в портале: снимаем «Все» и отмечаем одну саблю.
    await page.getByTitle(/^Оружие/).click();
    // «Все» есть не только здесь — берём то, что внутри раскрытого списка оружия.
    const weaponPanel = page.locator('div.absolute').filter({ hasText: 'Сабля' }).first();
    await weaponPanel.getByText('Все', { exact: true }).click();
    await weaponPanel.getByText('Сабля', { exact: true }).click();

    await expect(page).toHaveURL(/weapons=saber/);
    const filtered = await rows.count();
    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThan(before);

    // Закрываем список оружия, как это делает человек: рабочая область сжата до 912px
    // (layout.tsx, CONTENT_WIDTH), строка фильтров переносится на два ряда, и раскрытая панель
    // накрывает второй ряд вместе со «Сбросить». Клик мимо открытой панели — не сценарий
    // пользователя, а артефакт теста: раньше он проходил только потому, что строка была одна.
    await page.getByTitle(/^Оружие/).click();
    await expect(weaponPanel).toBeHidden();

    await page.getByRole('button', { name: 'Сбросить' }).click();
    await expect(rows).toHaveCount(before);
  });

  test('лента подгружается прокруткой, а не кнопкой', async ({ page }) => {
    await page.goto('');
    await expect(page.getByRole('button', { name: 'Показать ещё' })).toHaveCount(0);

    const bars = page.locator('a[href*="/events/"]');
    const before = await bars.count();
    expect(before).toBeGreaterThan(0);

    // Прокрутка до низа ленты: сентинел попадает в поле зрения и окно растёт само.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page).toHaveURL(/weeks=\d+/);
    await expect.poll(() => bars.count()).toBeGreaterThan(before);
  });

  test('лента листается и вверх, в прошлое, не прыгая под руками', async ({ page }) => {
    await page.goto('');
    const bars = page.locator('a[href*="/events/"]');
    const before = await bars.count();

    // Шаг вниз нужен, чтобы верхний сентинел не сработал сам при загрузке: прошлое подгружается
    // по движению человека, а не до него.
    await page.evaluate(() => window.scrollBy(0, 400));
    // Мерим ОДНУ И ТУ ЖЕ плашку по её адресу: после подгрузки прошлого первой в разметке
    // окажется другая, более ранняя, и сравнение «первой с первой» ничего не проверяет.
    const probe = await page.evaluate(() => {
      const bar = document.querySelector('a[href*="/events/"]') as HTMLAnchorElement | null;
      return bar ? { href: bar.getAttribute('href'), top: Math.round(bar.getBoundingClientRect().top) } : null;
    });
    expect(probe).not.toBeNull();

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page).toHaveURL(/back=\d+/);
    await expect.poll(() => bars.count()).toBeGreaterThan(before);

    // Компенсация прокрутки. Плашку мерили при прокрутке 400, потом ушли в самый верх — без
    // подгрузки она оказалась бы на `top + 400`. Там же она должна остаться и после неё: новые
    // недели встали НАД видимой областью, а прокрутку на их высоту домотали.
    const after = await page.evaluate((href: string) => {
      const bar = document.querySelector(`a[href="${href}"]`);
      return {
        top: bar ? Math.round(bar.getBoundingClientRect().top) : null,
        scrollY: Math.round(window.scrollY),
      };
    }, probe!.href!);
    expect(after.top).not.toBeNull();
    expect(after.scrollY).toBeGreaterThan(0);
    expect(Math.abs((after.top ?? 0) - (probe!.top + 400))).toBeLessThan(200);
  });

  test('лента листается вверх прямо из самого верха, без разбега вниз', async ({ page }) => {
    // Соседний тест сперва делает шаг ВНИЗ, и потому не ловил эту беду: на самом верху колесо
    // вверх не рождает события scroll — прокручивать нечего, — а подгрузка прошлого ждала
    // именно его. Человек открывал календарь, крутил вверх, и не происходило ничего.
    await page.goto('');
    await page.waitForLoadState('load');
    const bars = page.locator('a[href*="/events/"]');
    const before = await bars.count();
    expect(before).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    await page.mouse.move(400, 300);
    await page.mouse.wheel(0, -600);

    await expect(page).toHaveURL(/back=\d+/);
    await expect.poll(() => bars.count()).toBeGreaterThan(before);
  });

  test('список подтягивает прошедшее прокруткой вверх, как лента', async ({ page }) => {
    await page.goto('?view=list');
    await page.waitForLoadState('load');
    const rows = page.locator('a[href*="/events/"]');
    const before = await rows.count();
    expect(before).toBeGreaterThan(0);

    await page.mouse.move(400, 300);
    await page.mouse.wheel(0, -600);

    await expect(page).toHaveURL(/back=\d+/);
    await expect.poll(() => rows.count()).toBeGreaterThan(before);
  });

  test('подтягивая прошлое, список не дёргается под руками', async ({ page }) => {
    // Компенсация прокрутки раньше считалась по ПРИРОСТУ ВЫСОТЫ страницы и промахивалась:
    // турнир прошлого с тем же днём начала, что у верхней видимой строки, садится ПОД ней, и
    // эта часть прироста выше якоря не встаёт. Замер на живой странице: 97px мимо из 995 на
    // первой же подгрузке, и так на каждой — заказчик назвал это «лютыми перескоками».
    await page.goto('?view=list');
    await page.waitForLoadState('load');
    const rows = page.locator('a[href*="/events/"]');
    const before = await rows.count();
    // Меряем не только верхнюю строку: прыгала как раз НЕ она. Компенсация держала якорь, а
    // подгруженный турнир садился под ним, и всё ниже уезжало на его высоту — замер на живой
    // странице: якорь −3px, следующие строки +93px.
    const probes = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('main a[href*="/events/"]'));
      const visible = all.filter((row) => {
        const box = row.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= window.innerHeight;
      });
      return [visible[0], visible[1], visible[visible.length - 1]]
        .filter(Boolean)
        .map((row) => ({ href: row.getAttribute('href'), top: Math.round(row.getBoundingClientRect().top) }));
    });
    expect(probes.length).toBeGreaterThan(1);

    await page.mouse.move(400, 300);
    await page.mouse.wheel(0, -600);
    await expect.poll(() => rows.count()).toBeGreaterThan(before);

    const shifts = await page.evaluate((list) => list.map((probe) => {
      const node = document.querySelector(`main a[href="${probe.href}"]`);
      return node ? Math.round(node.getBoundingClientRect().top) - probe.top : null;
    }), probes);
    for (const shift of shifts) {
      expect(shift, 'строка, которая была видна, осталась на месте').not.toBeNull();
      expect(Math.abs(shift ?? 0)).toBeLessThanOrEqual(24);
    }
  });

  test('подписи баров, доходящих до правого края, стоят на одной вертикали', async ({ page }) => {
    // Бар с аннексированным понедельником физически продлён на ширину хвоста, и его правый
    // текст дважды оказывался не там: сначала уезжал под хвостовую плашку и обрывался, потом
    // вставал на восемь пикселей правее соседних. Проверяем не код, а результат на экране.
    await page.goto('?month=2027-05');
    const edges = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('div.relative.grid'));
      const found: number[] = [];
      for (const row of rows) {
        const rowRight = row.getBoundingClientRect().right;
        for (const bar of Array.from(row.querySelectorAll('a[href*="/events/"]'))) {
          // Только те, что доходят до правого края строки: у коротких баров подпись и должна
          // кончаться раньше.
          if (bar.getBoundingClientRect().right < rowRight - 2) continue;
          const place = Array.from(bar.querySelectorAll('span')).filter((e) => e.children.length === 0 && e.textContent?.trim());
          const last = place[place.length - 1];
          if (last) found.push(Math.round(last.getBoundingClientRect().right));
        }
      }
      return found;
    });

    expect(edges.length).toBeGreaterThan(1);
    expect(Math.max(...edges) - Math.min(...edges)).toBeLessThanOrEqual(2);
  });

  test('при наведении подсвечивается весь бар, включая хвостовой понедельник', async ({ page }) => {
    // Хвост раньше был отдельной плашкой ПОВЕРХ бара: наведение красило бар, а хвост оставался
    // тёмным, и строка подсвечивалась не целиком (замечание заказчика 06.11.2026).
    await page.goto('?month=2027-05');
    const bar = page.locator('a[href*="fechtterra-longsword"]').first();

    const background = () => bar.evaluate((node) => getComputedStyle(node).backgroundColor);
    const idle = await background();
    await bar.hover();
    // Цвет меняется переходом (transition-colors, 150 мс), и сразу после наведения он ещё
    // прежний — ждём, а не читаем один раз.
    await expect.poll(background).not.toBe(idle);

    // В зоне хвоста — сам бар, а не наложенный поверх элемент: подсветка одного элемента
    // покрывает его целиком, лагать нечему.
    const sameElement = await bar.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const row = node.closest('.grid')!.getBoundingClientRect();
      return document.elementFromPoint(row.right + 12, box.top + box.height / 2) === node;
    });
    expect(sameElement).toBe(true);
  });

  test('глазик показывает неподходящие турниры неактивными и объясняет причину', async ({ page }) => {
    await page.goto('?view=list&period=all&weapons=saber');
    const rows = page.locator('a[href*="/events/"]');
    const onlySuitable = await rows.count();
    expect(onlySuitable).toBeGreaterThan(0);
    const suitable = new Set(await rows.evaluateAll((els) => els.map((e) => e.getAttribute('href'))));

    await page.getByTitle('Показывать неподходящие неактивными').click();
    await expect(page).toHaveURL(/showUnsuitable=1/);
    // Неподходящие не исчезли, а вернулись в список — и каждый говорит, чем не подошёл.
    expect(await rows.count()).toBeGreaterThan(onlySuitable);

    // Причина переехала из подсказки плашки в ховер-карточку (08.11.2026): по наведению не
    // должны спорить две всплывашки. Наводимся на строку, которой в отфильтрованном списке не
    // было, — она и есть неподходящая; искать её по классу значило бы привязаться к оформлению.
    const after = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    const unsuitable = after.find((href) => href && !suitable.has(href));
    expect(unsuitable).toBeTruthy();
    await page.locator(`a[href="${unsuitable}"]`).first().hover();
    await expect(page.getByRole('tooltip')).toContainText('Не подходит:');
  });

  test('тип отбирает выдачу и подписан на карточке, у турнира подписи нет', async ({ page }) => {
    // Пара сценариев обязательна: «фильтр по лагерям оставил лагеря» ничего не доказывает, пока
    // не видно, что без фильтра список шире, а турниры в него не попали.
    await page.goto('?view=list&period=all');
    const rows = page.locator('a[href*="/events/"]');
    const all = await rows.count();
    expect(all).toBeGreaterThan(0);

    await page.goto('?view=list&period=all&kinds=camp,festival');
    const picked = await rows.count();
    expect(picked).toBeGreaterThan(0);
    expect(picked).toBeLessThan(all);

    // Каждая оставшаяся строка подписана своим типом — и ни одна не подписана турниром.
    const words = await rows.evaluateAll((els) => els.map((e) => e.textContent ?? ''));
    expect(words.every((text) => /· (фестиваль|лагерь)/.test(text))).toBe(true);
    expect(words.some((text) => /· турнир/.test(text))).toBe(false);

    // А у турнира подписи нет вовсе: 403 строки со словом «турнир» были бы шумом.
    await page.goto('?view=list&period=all&kinds=tournament');
    const tournaments = await rows.evaluateAll((els) => els.map((e) => e.textContent ?? ''));
    expect(tournaments.length).toBeGreaterThan(0);
    expect(tournaments.some((text) => /· турнир/.test(text))).toBe(false);
  });

  test('фильтры переживают перезагрузку: ссылкой можно поделиться', async ({ page }) => {
    await page.goto('?view=list&period=all&weapons=saber');
    const count = await page.locator('a[href*="/events/"]').count();
    expect(count).toBeGreaterThan(0);

    await page.reload();
    await expect(page.locator('a[href*="/events/"]')).toHaveCount(count);
    // Активный фильтр виден в самой строке: триггер оружия перекрашивается акцентом.
    await expect(page.getByTitle(/^Оружие/)).toHaveClass(/text-primary/);
  });

  test('прошедшие показываются от свежих к старым', async ({ page }) => {
    await page.goto('?view=list&period=past');
    const dividers = await page.locator('h2').allInnerTexts();
    expect(dividers.length).toBeGreaterThan(1);

    const year = (text: string) => Number(text.trim().split(' ').pop());
    const index = (text: string) => MONTHS.findIndex((m) => text.toLowerCase().startsWith(m.toLowerCase()));
    const keys = dividers.map((d) => year(d) * 12 + index(d));
    expect(keys).toEqual([...keys].sort((a, b) => b - a));
  });

  test('адрес с мусором в параметрах не роняет страницу', async ({ page }) => {
    const response = await page.goto('?month=2026-13&view=галерея&city=&weapons=,,');
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1').first()).toBeVisible();
  });
});

/**
 * Телефон — единственное место, где вид подменяется НЕ адресом, а шириной экрана, и подмена
 * включается уже после гидратации. Остальной смоук идёт на 1280 и этого не видит.
 */
test.describe('Телефон', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('календарь открывается ближайшими турнирами, а не архивом', async ({ page }) => {
    await page.goto('');
    await page.waitForLoadState('load');

    // Ленты на телефоне нет вовсе — её шапка дней недели самый верный признак.
    await expect(page.getByText('воскресенье', { exact: true })).toHaveCount(0);
    await expect(page.locator('a[href*="/events/"]').first()).toBeVisible();

    // Выдача, посчитанная для ленты, однажды досталась списку как есть: у ленты границ по
    // датам нет, она считает окно сама, — и телефон открывал календарь всем архивом с декабря
    // 2019-го (поймано на живом сайте 12.11.2026). Разделители месяцев — самый дешёвый
    // признак: ни одного раньше нынешнего месяца тут быть не может.
    const moscow = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const now = moscow.getUTCFullYear() * 12 + moscow.getUTCMonth();
    const key = (text: string) => Number(text.trim().split(' ').pop()) * 12
      + MONTHS.findIndex((m) => text.toLowerCase().startsWith(m.toLowerCase()));
    const dividers = await page.locator('main h2').allInnerTexts();
    expect(dividers.length).toBeGreaterThan(0);
    expect(Math.min(...dividers.map(key))).toBeGreaterThanOrEqual(now);
  });

  test('сужение окна до телефонного переводит ленту в список целиком', async ({ page }) => {
    // Тот же случай, но наверняка: страница открывается широкой (вид — лента, адрес разобран),
    // и только потом окно сужается. Загрузка сразу на 375 этого не ловит — там разбор адреса и
    // замер ширины наперегонки, и на локальной сборке разбор обычно успевает вторым, пересчитывая
    // выдачу заодно. На живом сайте успевал первым, и список получал ленточный просчёт: календарь
    // открывался архивом с декабря 2019-го (12.11.2026).
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('');
    await page.waitForLoadState('load');
    await expect(page.getByText('воскресенье', { exact: true })).toBeVisible();

    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByText('воскресенье', { exact: true })).toHaveCount(0);

    const moscow = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const now = moscow.getUTCFullYear() * 12 + moscow.getUTCMonth();
    const key = (text: string) => Number(text.trim().split(' ').pop()) * 12
      + MONTHS.findIndex((m) => text.toLowerCase().startsWith(m.toLowerCase()));
    const dividers = await page.locator('main h2').allInnerTexts();
    expect(dividers.length).toBeGreaterThan(0);
    expect(Math.min(...dividers.map(key))).toBeGreaterThanOrEqual(now);
  });

  test('ни один вид не предлагается: выбирать не из чего', async ({ page }) => {
    // Адрес ленты открывается списком: ссылка с компьютера не должна приводить телефон в вид,
    // которого на нём нет. Кнопок видов на телефоне нет вовсе — вид там один.
    await page.goto('?view=ribbon');
    await page.waitForLoadState('load');

    await expect(page.getByTitle('Лента недель')).toBeHidden();
    await expect(page.getByTitle('Месяц')).toBeHidden();
    await expect(page.getByTitle('Список')).toBeHidden();
    await expect(page.locator('a[href*="/events/"]').first()).toBeVisible();
  });

  test('фильтры живут в шторке, а не в строке', async ({ page }) => {
    await page.goto('');
    await page.waitForLoadState('load');

    // В строке фильтров нет: девять чипов в столбик съедали 400 точек из 812 (§5к).
    await expect(page.getByTitle(/^Оружие/)).toBeHidden();

    const chip = page.getByRole('button', { name: /Фильтры/ });
    await expect(chip).toBeVisible();
    await chip.click();

    const sheet = page.getByRole('dialog', { name: 'Фильтры' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTitle(/^Оружие/)).toBeVisible();
    await expect(sheet.getByTitle(/^Регион/)).toBeVisible();

    // Кнопка внизу называет размер выдачи: пока шторка открыта, списка не видно, и это
    // единственная обратная связь на выбор фильтра.
    const show = sheet.getByRole('button', { name: /Показать \d+ турнир|Ничего не нашлось/ });
    await expect(show).toBeVisible();
    await show.click();
    await expect(sheet).toBeHidden();
  });

  test('строка фильтров не уезжает при прокрутке', async ({ page }) => {
    // Прежняя шапка пряталась прокруткой, потому что занимала полэкрана; со шторкой прятать
    // нечего — одна строка остаётся на месте, и фильтры доступны в любой точке списка.
    await page.goto('');
    await page.waitForLoadState('load');

    const chip = page.getByRole('button', { name: /Фильтры/ });
    await expect(chip).toBeVisible();

    await page.mouse.move(187, 600);
    await page.mouse.wheel(0, 600);
    await expect(chip).toBeVisible();
  });
});

test.describe('Подача турнира', () => {
  test('страница объясняет оба пути: форму и правку данных', async ({ page }) => {
    await page.goto('submit/');
    await expect(page.getByRole('heading', { name: 'Анонсировать мероприятие' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'data/events' })).toBeVisible();
    // Регистрация не нужна — это обещание страницы, и оно должно на ней быть.
    await expect(page.getByText(/Регистрация не нужна/)).toBeVisible();
  });
});

test.describe('Для поисковика', () => {
  test('карта сайта перечисляет страницы турниров', async ({ page }) => {
    const response = await page.request.get('sitemap.xml');
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

    await page.goto('');
    await page.waitForLoadState('load');

    const logo = page.locator('header img');
    await expect(logo).toBeVisible();
    expect(await logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

    // Пиктограммы оружия рисуются CSS-маской, а не картинкой: битый адрес не даёт ни ошибки в
    // консоли, ни пустого <img> — иконка просто исчезает. Поэтому спрашиваем у страницы, какой
    // адрес она просит, и проверяем именно его: на Pages он уезжал в корень сайта мимо
    // подкаталога, и длинный меч пропадал.
    await page.getByTitle(/^Оружие/).click();
    const mask = await page
      .locator('span[style*="mask-image"]')
      .first()
      .evaluate((el) => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage);
    const maskUrl = /url\("?([^")]+)"?\)/.exec(mask ?? '')?.[1];
    expect(maskUrl, 'пиктограмма должна рисоваться маской').toBeTruthy();
    const icon = await page.request.get(maskUrl as string);
    expect(icon.status(), `пиктограмма должна отдаваться по ${maskUrl}`).toBe(200);

    expect(broken).toEqual([]);
  });
});
