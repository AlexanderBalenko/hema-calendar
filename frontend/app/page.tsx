'use client';

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { CalendarGrid, CalendarWeekdayHeader, type GridEvent } from '@/src/components/calendar-ribbon';
import { CALENDAR_SEARCH_KEY } from '@/src/components/back-to-calendar';
import { EventList } from '@/src/components/event-list';
import { FilterBar } from '@/src/components/filter-bar';
import { MonthGrid } from '@/src/components/month-grid';
import { MonthStrip } from '@/src/components/month-strip';
import { BUILT_AT, DIRECTORIES, EVENTS } from '@/src/lib/data';
import {
  filtersToSearch,
  MAX_RIBBON_WEEKS,
  parseFilters,
  parseMonthKey,
  RIBBON_STEP,
  selectEvents,
  type CalendarFilters,
  type RawParams,
} from '@/src/lib/filters';
import { addDays, dayNumber, isPastEvent, layoutRange, startOfWeek, todayLocal } from '@/src/lib/month-layout';

/**
 * Календарь: лента недель (главный вид, как на портале), сетка месяца или список. Фильтры —
 * в адресе страницы.
 *
 * Страница клиентская, потому что сайт статический: один и тот же файл отдаётся на любой адрес
 * с параметрами, и разобрать их может только браузер. Данные при этом уже здесь — они вшиты в
 * сборку (см. src/lib/data.ts), так что ни фильтр, ни переключение месяца не ждут сети.
 */


export default function HomePage() {
  return (
    // useSearchParams требует границы ожидания: в статическую разметку попадает запасной
    // вариант — календарь без фильтров, и это ровно то, что нужно показать поисковику и
    // человеку, пришедшему по голой ссылке.
    <Suspense fallback={<Calendar params={{}} />}>
      <FromAddress />
    </Suspense>
  );
}

/**
 * Телефон ли это. На первом кадре всегда `false` — ровно то, что лежит в собранной разметке:
 * ширины экрана на сборке нет, и любой другой ответ разошёлся бы с ней при оживлении. На
 * телефоне вид подменяется сразу после гидратации.
 */
function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639.98px)');
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return phone;
}

function FromAddress() {
  const search = useSearchParams();
  const params = useMemo(() => Object.fromEntries(search.entries()) as RawParams, [search]);
  return <Calendar params={params} />;
}

function Calendar({ params }: { params: RawParams }) {
  // На сборке «сегодня» — день сборки данных; в браузере пересчитываем по часам читателя.
  // Так разметка со сборки совпадает с первым кадром гидратации, а подсветка дня сразу после
  // неё становится настоящей.
  const [today, setToday] = useState(BUILT_AT);
  useEffect(() => setToday(todayLocal()), []);

  // Куда возвращаться со страницы турнира: адрес календаря со всеми фильтрами и развёрнутой
  // лентой. Пишется при каждом изменении адреса; читает его `BackToCalendar`.
  useEffect(() => {
    try {
      window.sessionStorage.setItem(CALENDAR_SEARCH_KEY, window.location.search);
    } catch {
      // приватный режим — ссылка «ко всем турнирам» просто сработает как обычная
    }
  }, [params]);
  const router = useRouter();
  const pathname = usePathname();
  const requestedWeeks = useRef(0);
  const requestedBack = useRef(0);

  // На телефоне календарь показывается ТОЛЬКО списком (решение заказчика 12.11.2026): лента
  // недель и сетка месяца на 375px нечитаемы — ленте на название турнира остаётся треть ширины,
  // а в клетке месяца не помещается ничего, кроме числа. Вид подменяется только на отрисовке;
  // разбор адреса не трогаем, и та же ссылка, открытая на компьютере, снова покажет ленту.
  const phone = useIsPhone();
  const parsed = parseFilters(params, today);
  const filters = phone && parsed.view !== 'list' ? { ...parsed, view: 'list' as const } : parsed;
  const { year, month } = parseMonthKey(filters.month, today);

  // Вид — отдельной зависимостью: это единственное, что меняется БЕЗ изменения адреса, потому
  // что подмена ленты списком на телефоне (выше) включается уже после гидратации. Без него
  // первый, ленточный просчёт — а у ленты границ по датам нет, она считает окно сама —
  // доставался списку как есть, и телефон открывал календарь всем архивом с декабря 2019-го
  // (поймано на живом сайте 12.11.2026).
  const events = useMemo(() => selectEvents(EVENTS, filters, today),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- остальное состояние приходит из адреса
    [params, today, filters.view]);
  // Для полоски месяцев — те же фильтры, но без ограничения по датам: она показывает, в каких
  // месяцах года турниры вообще есть.
  const inYear = useMemo(() => selectEvents(EVENTS, { ...filters, view: 'list', period: 'all' }, today),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- то же состояние из адреса
    [params, today]);

  // Лента растёт в обе стороны от одной точки отсчёта — недели, в которой начинается выбранный
  // месяц. Именно от неё, а не от текущего края окна: иначе подгрузка вверх меняла бы смысл
  // параметров в адресе на каждом шаге.
  const anchorWeek = startOfWeek(`${filters.month}-01`);
  const ribbonFrom = addDays(anchorWeek, -filters.back * 7);
  const ribbonTo = addDays(anchorWeek, filters.weeks * 7 - 1);

  // Вверх, в прошлое, растут оба вида — и лента, и список (решение заказчика 08.11.2026).
  // Нижняя граница у них считается по-разному: лента живёт неделями от якорной, список — просто
  // «сегодня минус подтянутые недели», недель у списка нет. Один и тот же параметр `back`
  // означает в обоих случаях одно: сколько прошлого уже подтянуто прокруткой.
  const growsBack = filters.view === 'ribbon'
    || (filters.view === 'list' && filters.period === 'future');
  const backFrom = filters.view === 'ribbon'
    ? ribbonFrom
    : (filters.back > 0 ? addDays(today, -filters.back * 7) : today);
  const weeks = useMemo(() => {
    if (filters.view !== 'ribbon') return [];
    const inWindow: GridEvent[] = inYear
      .filter((event) => event.endsAt >= ribbonFrom && event.startsAt <= ribbonTo)
      .map((event) => ({ ...event, isPast: isPastEvent(event.endsAt, today) }));
    return layoutRange(ribbonFrom, ribbonTo, inWindow);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- окно и фильтры приходят из адреса
  }, [inYear, ribbonFrom, ribbonTo, filters.view, today]);

  // Ближайшие турниры за краями окна: до них лента и дотягивается. Пустых недель за последним
  // турниром не рисуем — расти в пустоту некуда и незачем.
  const nextStart = useMemo(
    () => inYear.find((event) => event.endsAt > ribbonTo)?.startsAt ?? null,
    [inYear, ribbonTo],
  );
  const prevStart = useMemo(() => {
    let found: string | null = null;
    for (const event of inYear) {
      if (event.endsAt >= backFrom) break;
      found = event.startsAt;
    }
    return found;
  }, [inYear, backFrom]);

  const isRibbon = filters.view === 'ribbon';
  const canGrow = isRibbon && nextStart !== null && filters.weeks < MAX_RIBBON_WEEKS;
  const canGrowBack = growsBack && prevStart !== null && filters.back < MAX_RIBBON_WEEKS;

  const grow = (patch: Partial<CalendarFilters>) =>
    router.replace(`${pathname}${filtersToSearch({ ...filters, ...patch }, today)}`, { scroll: false });

  // Новая точка отсчёта — новая лента, и счётчики «сколько недель уже просили» начинают с нуля:
  // они относились к ПРЕЖНЕЙ ленте. Без сброса свежая лента первым же шагом дотягивалась до
  // прежнего края — замер 10.11.2026: полистав 2027-й, выбираем в полоске декабрь 2027, и лента
  // мгновенно подтягивает 56 недель прошлого и увозит экран в февраль вместо декабря, куда ткнули.
  useEffect(() => {
    requestedWeeks.current = 0;
    requestedBack.current = 0;
  }, [filters.month]);

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !canGrow) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      // Шаг — восемь недель, но если ближайший турнир дальше, дотягиваемся сразу до него:
      // иначе прокрутка ползла бы пустыми неделями по восемь за раз.
      const step = Math.max(filters.weeks, requestedWeeks.current) + RIBBON_STEP;
      const reach = nextStart === null ? step
        : Math.ceil((dayNumber(nextStart) - dayNumber(anchorWeek) + 1) / 7) + 1;
      const next = Math.min(Math.max(step, reach), MAX_RIBBON_WEEKS);
      if (next <= requestedWeeks.current) return;
      requestedWeeks.current = next;
      grow({ weeks: next });
    }, { rootMargin: '600px' });
    observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- состояние целиком приходит из адреса
  }, [canGrow, nextStart, anchorWeek, params, today]);

  // Липкий слой (фильтры, полоска месяцев, шапка дней) накрывает верх ленты, и всё, что про
  // «подо что уехало» и «куда поставить», считается от его НИЗА, а не от верха экрана.
  const stickyRef = useRef<HTMLDivElement>(null);
  /**
   * Низ липкого слоя в ПРИЛИПШЕМ положении: его собственный `top` из стилей плюс высота.
   *
   * Не текущий `getBoundingClientRect().bottom` — тот врёт дважды. На самом верху страницы слой
   * ещё не прилип и стоит на 25px ниже. А сразу после программной прокрутки браузер пересчитывает
   * липкое положение не в том же такте: замер 10.11.2026 — синхронный промер после `scrollBy`
   * отдавал низ на 17px ниже настоящего, и перенос к месяцу не доезжал ровно на эту разницу
   * (под шапкой оставался хвост предыдущей недели, а полоска называла предыдущий месяц).
   * Высота слоя от прокрутки не зависит, поэтому так расчёт устойчив.
   */
  const headerBottom = () => {
    const node = stickyRef.current;
    if (!node) return 0;
    return parseFloat(getComputedStyle(node).top || '0') + node.getBoundingClientRect().height;
  };

  // --- вверх, в прошлое ----------------------------------------------------------------------
  // Подгрузка сверху добавляет содержимое НАД видимой областью, и браузер уезжает вместе с ним.
  // Поэтому перед ростом запоминаем ЯКОРЬ — верхнюю видимую строку и её место на экране, — а
  // сразу после отрисовки возвращаем её туда же.
  //
  // Якорь, а не прирост высоты страницы: прирост обманывает. Часть подгруженного встаёт НИЖЕ
  // того, на что человек смотрит, — турнир прошлого с тем же днём начала, что у первой видимой
  // строки, садится под ней, — и на эту разницу страницу дёргало при каждой подгрузке (замечание
  // заказчика 08.11.2026 про «лютые перескоки»; замер в списке: 97px мимо из 995).
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const scrollAnchor = useRef<{ key: string; top: number } | null>(null);

  /**
   * Верхняя видимая строка и её место на экране — то, что обязано остаться на месте.
   *
   * Строка НЕДЕЛИ, а не только плашка турнира: в пустом куске календаря плашек на экране может
   * не быть вовсе, и тогда якоря не находилось, компенсация молча не срабатывала, а лента
   * прыгала на всю высоту подгруженного. Замер 10.11.2026: выбрал в полоске сентябрь 2027 —
   * месяц почти пустой, — и экран тут же уехал в июль. В списке недель нет, там якорем
   * по-прежнему строка турнира; порядок в выборке документный, поэтому в ленте первой находится
   * неделя, а внутри неё — плашка, если неделя уже наполовину уехала под шапку.
   *
   * Место запоминаем ОТНОСИТЕЛЬНО НИЗА ЛИПКОГО СЛОЯ (`headerBottom`), а не верха экрана: слой
   * тоже умеет переезжать, и, померив от верха экрана, мы возвращали строку на прежнее место —
   * а шапка к тому времени поднималась, и из-под неё выглядывал остаток предыдущей недели.
   * Этого хватало, чтобы полоска назвала предыдущий месяц: выбрали сентябрь — она пишет «Август».
   */
  const rememberScrollAnchor = () => {
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>('main [data-month], main a[href*="/events/"]'));
    const node = rows.find((row) => row.getBoundingClientRect().top >= 0) ?? rows[0];
    const key = node?.id ? `#${node.id}` : node?.getAttribute('href');
    scrollAnchor.current = key ? { key, top: node.getBoundingClientRect().top - headerBottom() } : null;
  };
  // Верхний сентинел в начале ленты виден сразу при загрузке, и без этой задержки лента
  // подгружала бы прошлое сама, до единого движения человека.
  //
  // Ждём ЖЕСТ, а не событие прокрутки. На самом верху страницы колесо вверх события `scroll` не
  // рождает — прокручивать нечего, — и лента молчала в ответ на единственное движение, которым
  // прошлое и просят: человек открыл календарь, крутанул вверх, ничего не произошло (замечание
  // заказчика 08.11.2026). Замер на живой странице: пять щелчков колеса вверх при scrollY = 0
  // дают 0 событий `scroll` и 1 событие `wheel`.
  //
  // Клавиатура — только навигационные клавиши: на этой же странице стоит поле поиска, и от
  // набора текста лента лезть в прошлое не должна.
  const [movedOnce, setMovedOnce] = useState(false);
  useEffect(() => {
    if (movedOnce) return;
    const arm = () => setMovedOnce(true);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'PageUp' || event.key === 'Home' || event.key === 'ArrowUp') arm();
    };
    const options = { passive: true } as const;
    window.addEventListener('scroll', arm, options);
    window.addEventListener('wheel', arm, options);
    window.addEventListener('touchmove', arm, options);
    window.addEventListener('keydown', onKey, options);
    return () => {
      window.removeEventListener('scroll', arm);
      window.removeEventListener('wheel', arm);
      window.removeEventListener('touchmove', arm);
      window.removeEventListener('keydown', onKey);
    };
  }, [movedOnce]);

  useEffect(() => {
    const node = topSentinelRef.current;
    if (!node || !canGrowBack || !movedOnce) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      const step = Math.max(filters.back, requestedBack.current) + RIBBON_STEP;
      // Шаг — восемь недель, но если ближайший турнир в прошлом дальше, дотягиваемся сразу до
      // него: иначе прокрутка ползла бы пустыми неделями. У списка отсчёт от сегодня, а не от
      // якорной недели: недель у него нет, и «back» он понимает буквально — столько-то дней
      // прошлого назад.
      const reach = prevStart === null ? step
        : isRibbon
          ? (dayNumber(anchorWeek) - dayNumber(startOfWeek(prevStart))) / 7
          : Math.ceil((dayNumber(today) - dayNumber(prevStart)) / 7) + 1;
      const next = Math.min(Math.max(step, reach), MAX_RIBBON_WEEKS);
      if (next <= requestedBack.current) return;
      requestedBack.current = next;
      rememberScrollAnchor();
      grow({ back: next });
    }, { rootMargin: '600px' });
    observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- состояние целиком приходит из адреса
  }, [canGrowBack, prevStart, anchorWeek, params, today, movedOnce]);

  useLayoutEffect(() => {
    const anchor = scrollAnchor.current;
    scrollAnchor.current = null;
    if (!anchor) return;
    const node = anchor.key.startsWith('#')
      ? document.getElementById(anchor.key.slice(1))
      : document.querySelector(`main a[href="${anchor.key}"]`);
    if (!node) return;
    // Доматываем ровно на то, насколько уехал ЯКОРЬ, и до кадра (useLayoutEffect) — иначе
    // человек успевает увидеть скачок.
    const delta = node.getBoundingClientRect().top - (headerBottom() + anchor.top);
    if (delta !== 0) window.scrollBy({ top: delta, behavior: 'instant' as ScrollBehavior });
  }, [filters.back]);

  // --- полоска месяцев и лента: связь в обе стороны (решение заказчика 10.11.2026) -------------
  //
  // Лента длинная и листается прокруткой, а полоска показывала месяц ИЗ АДРЕСА — точку, с которой
  // лента начата. Человек уезжал прокруткой в март, а полоска продолжала подсвечивать ноябрь и
  // считать турниры прошлого года: главный навигатор календаря врал о том, где человек стоит.
  //
  // Теперь подсвеченный месяц и год — те, что на экране. Адрес при этом НЕ переписывается: от
  // месяца в адресе отмеряны оба края загруженного окна (`back` недель назад, `weeks` вперёд), и
  // сдвиг точки отсчёта на ходу либо обрезал бы уже загруженное, либо двигал бы ленту под руками.
  // Адрес — откуда лента начата, полоска — где человек сейчас.
  const [visibleMonth, setVisibleMonth] = useState<string | null>(null);
  /** Подсказка для поиска: прокрутка идёт шагами, и соседняя неделя почти всегда та же или рядом. */
  const probe = useRef(0);
  /** Месяц, до которого надо доехать, когда ленте пришлось начаться заново (см. `scrollToMonth`). */
  const pendingPick = useRef<string | null>(null);

  useEffect(() => {
    if (!isRibbon) {
      setVisibleMonth(null);
      return;
    }
    const read = () => {
      const weekNodes = document.querySelectorAll<HTMLElement>('main [data-month]');
      if (!stickyRef.current || weekNodes.length === 0) return;
      // Видимый месяц — у первой недели, которая ещё не уехала под липкий слой. Высота слоя
      // меряется, а не задана числом: строка фильтров переносится по словам, и на узком экране
      // слой вдвое выше, чем на широком.
      const limit = headerBottom();
      let i = Math.min(Math.max(probe.current, 0), weekNodes.length - 1);
      while (i < weekNodes.length - 1 && weekNodes[i].getBoundingClientRect().bottom <= limit) i += 1;
      while (i > 0 && weekNodes[i - 1].getBoundingClientRect().bottom > limit) i -= 1;
      probe.current = i;
      const key = weekNodes[i].dataset.month;
      if (key) setVisibleMonth(key);
    };
    // Читаем прямо в обработчике, без requestAnimationFrame. Кадр — ненадёжный таймер:
    // браузер придерживает его, когда страница не на переднем плане, и подсветка начинает
    // отставать от прокрутки на секунды (замер во встроенной панели просмотра: один кадр за
    // 500 мс при `visibilityState === 'visible'`). Чтение дешёвое — подсказка `probe` держит
    // его в двух-трёх промерах, а раскладка на прокрутке и так свежая.
    read();
    // Лента перерисовалась — самое время доехать до месяца, выбранного в полоске, если ради него
    // ей пришлось начаться заново (`scrollToMonth`). Разметка уже новая: месяц в ней есть.
    const pending = pendingPick.current;
    pendingPick.current = null;
    if (pending && jumpToMonth(pending)) read();

    window.addEventListener('scroll', read, { passive: true });
    window.addEventListener('resize', read);
    return () => {
      window.removeEventListener('scroll', read);
      window.removeEventListener('resize', read);
    };
    // weeks — чтобы перечитать после подгрузки: недель в разметке стало больше.
  }, [isRibbon, weeks]);

  /** Поставить месяц под шапку, если он есть в разметке и его туда вообще можно поднять. */
  const jumpToMonth = (key: string) => {
    const node = document.querySelector<HTMLElement>(`main [data-month="${key}"]`);
    if (!node || !stickyRef.current) return false;
    // Последние недели окна под шапку не поднимаются: ниже них содержимого нет, и прокрутка
    // упирается в конец страницы. Экран тогда остаётся на месяц выше выбранного — это не
    // переезд внутри ленты, а повод начать её заново с выбранного месяца (вернём `false`).
    const target = window.scrollY + node.getBoundingClientRect().top - headerBottom();
    if (target > document.documentElement.scrollHeight - window.innerHeight + 1) return false;
    // Переносим СРАЗУ, без плавной прокрутки. Плавная здесь не доезжала: пока она шла, лента
    // успевала подтянуть прошлое, а подгрузка сверху доматывает прокрутку мгновенным
    // `scrollBy` — и он обрывает плавную на полпути. Замер 10.11.2026 на живой странице: выбор
    // марта из января оставлял экран в январе, подтянув заодно восемь ненужных недель прошлого.
    // Мгновенный перенос этого не допускает вовсе: к моменту, когда сработает наблюдатель
    // верхнего края, экран уже далеко от него.
    //
    // Несколько проходов, а не один: липкий слой на самом верху страницы ЕЩЁ НЕ ПРИЛИП — он
    // стоит в потоке на 25px ниже, чем прилипнув (замер там же), и расчёт по его низу до
    // переноса промахивается ровно на эту разницу: экран уезжал к февралю вместо марта.
    // Второй промер делается уже с прилипшим слоем и попадает точно.
    for (let pass = 0; pass < 3; pass += 1) {
      const delta = node.getBoundingClientRect().top - headerBottom();
      if (Math.abs(delta) < 1) break;
      window.scrollBy({ top: delta, behavior: 'instant' as ScrollBehavior });
    }
    return true;
  };

  /**
   * Обратная сторона связи: выбранный в полоске месяц уже загружен — переносим к нему экран, а
   * не начинаем ленту заново. Возвращает `true`, если справились сами и переход по ссылке не
   * нужен. Месяца в окне нет (или это не лента) — `false`, и ссылка открывается как прежде.
   *
   * Но доехать до выбранного месяца — всё равно наша забота: начавшись заново, лента тут же
   * тянет прошлое, и экран оставался ВЫШЕ выбранного месяца (замер 10.11.2026: выбрали сентябрь
   * 2027 — под шапкой остаток августовской недели, и полоска честно писала «Август»). Поэтому
   * запоминаем месяц и доезжаем, как только появится его разметка.
   */
  const scrollToMonth = (key: string) => {
    if (!isRibbon) return false;
    if (jumpToMonth(key)) return true;
    pendingPick.current = key;
    return false;
  };

  // Что показывает полоска: видимый месяц, пока листаем ленту, иначе — месяц из адреса.
  const shown = parseMonthKey(visibleMonth ?? filters.month, today);

  return (
    <div className="flex flex-col gap-4">
      {/* Заголовок есть, но не нарисован: навигация по месяцам — полоска, как в портале, а
          заголовок нужен поисковику и читалке экрана. */}
      <h1 className="sr-only">Календарь мероприятий HEMA</h1>

      {/* Фильтры, полоска месяцев и шапка дней — один липкий слой, как в портале: двумя
          независимыми sticky они наезжают друг на друга, потому что высота строки фильтров
          переменная (она переносится по словам). */}
      <div
        ref={stickyRef}
        className="sticky top-16 z-30 -mx-4 flex flex-col gap-2 bg-background px-4 pb-2 pt-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
      >
        <FilterBar filters={filters} directories={DIRECTORIES} today={today} count={events.length} />
        {filters.view !== 'list' && (
          <MonthStrip
            filters={filters}
            events={inYear}
            today={today}
            at={shown}
            onPick={scrollToMonth}
          />
        )}
        {filters.view === 'ribbon' && <CalendarWeekdayHeader />}
      </div>

      {filters.view === 'ribbon' && (
        <>
          {/* Сентинел прошлого: лента листается и вверх. Строка «раньше турниров нет» нужна,
              чтобы край ленты не выглядел оборванным. */}
          <div ref={topSentinelRef} aria-hidden="true" className="h-1" />
          {!canGrowBack && weeks.length > 0 && (
            <p className="self-center py-2 text-xs text-text-faint">Раньше ничего нет</p>
          )}
          <CalendarGrid weeks={weeks} currentWeek={startOfWeek(today)} today={today} />
          {/* Лента растёт прокруткой, а не кнопкой (решение заказчика 06.11.2026): сентинел
              внизу, подгрузка за 600px до него — так следующие недели готовы раньше, чем до них
              доскроллили, и рывка не видно. Кнопки больше нет, поэтому важно, что окно всё
              равно дотягивается до ближайшего турнира: иначе у узкого фильтра (один город)
              человек упирался бы в пустоту без способа заглянуть дальше. */}
          <div ref={sentinelRef} aria-hidden="true" className="h-1" />
          {!canGrow && weeks.length > 0 && (
            <p className="self-center py-2 text-xs text-text-faint">Дальше ничего нет</p>
          )}
        </>
      )}

      {filters.view === 'month' && (
        <>
          <MonthGrid year={year} month={month} events={events} today={today} />
          {events.length === 0 && (
            <p className="text-sm text-text-muted">
              В этом месяце ничего нет{filters.weapons || filters.regions || filters.city || filters.q
                ? ' — по выбранным фильтрам'
                : ''}.
            </p>
          )}
        </>
      )}

      {filters.view === 'list' && (
        events.length === 0
          ? <p className="rounded-xl bg-card p-4 text-sm text-text-secondary">Ничего не нашлось. Попробуйте снять часть фильтров.</p>
          : (
            <>
              {/* Тот же сентинел прошлого, что и у ленты: список открывается будущим, а
                  прошедшее подтягивается прокруткой вверх. Переключатель периода остался —
                  им спрашивают «покажи только прошедшие», а это другой вопрос. */}
              {growsBack && <div ref={topSentinelRef} aria-hidden="true" className="h-1" />}
              {growsBack && !canGrowBack && (
                <p className="self-center py-2 text-xs text-text-faint">Раньше ничего нет</p>
              )}
              <EventList events={events} today={today} />
            </>
          )
      )}
    </div>
  );
}
