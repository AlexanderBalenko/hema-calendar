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

  const filters = parseFilters(params, today);
  const { year, month } = parseMonthKey(filters.month, today);

  const events = useMemo(() => selectEvents(EVENTS, filters, today),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- фильтры пересобираются из адреса
    [params, today]);
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
      if (event.endsAt >= ribbonFrom) break;
      found = event.startsAt;
    }
    return found;
  }, [inYear, ribbonFrom]);

  const isRibbon = filters.view === 'ribbon';
  const canGrow = isRibbon && nextStart !== null && filters.weeks < MAX_RIBBON_WEEKS;
  const canGrowBack = isRibbon && prevStart !== null && filters.back < MAX_RIBBON_WEEKS;

  const grow = (patch: Partial<CalendarFilters>) =>
    router.replace(`${pathname}${filtersToSearch({ ...filters, ...patch }, today)}`, { scroll: false });

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

  // --- вверх, в прошлое ----------------------------------------------------------------------
  // Подгрузка сверху добавляет содержимое НАД видимой областью, и браузер уезжает вместе с ним.
  // Поэтому перед ростом запоминаем высоту страницы, а сразу после отрисовки (до кадра, в
  // useLayoutEffect) доматываем на разницу: лента под курсором остаётся на месте.
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const heightBeforeGrow = useRef<number | null>(null);
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
      const reach = prevStart === null ? step
        : (dayNumber(anchorWeek) - dayNumber(startOfWeek(prevStart))) / 7;
      const next = Math.min(Math.max(step, reach), MAX_RIBBON_WEEKS);
      if (next <= requestedBack.current) return;
      requestedBack.current = next;
      heightBeforeGrow.current = document.documentElement.scrollHeight;
      grow({ back: next });
    }, { rootMargin: '600px' });
    observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- состояние целиком приходит из адреса
  }, [canGrowBack, prevStart, anchorWeek, params, today, movedOnce]);

  useLayoutEffect(() => {
    if (heightBeforeGrow.current === null) return;
    const delta = document.documentElement.scrollHeight - heightBeforeGrow.current;
    heightBeforeGrow.current = null;
    if (delta > 0) window.scrollBy({ top: delta, behavior: 'instant' as ScrollBehavior });
  }, [filters.back]);

  return (
    <div className="flex flex-col gap-4">
      {/* Заголовок есть, но не нарисован: навигация по месяцам — полоска, как в портале, а
          заголовок нужен поисковику и читалке экрана. */}
      <h1 className="sr-only">Календарь турниров HEMA</h1>

      {/* Фильтры, полоска месяцев и шапка дней — один липкий слой, как в портале: двумя
          независимыми sticky они наезжают друг на друга, потому что высота строки фильтров
          переменная (она переносится по словам). */}
      <div className="sticky top-16 z-30 -mx-4 flex flex-col gap-2 bg-background px-4 pb-2 pt-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <FilterBar filters={filters} directories={DIRECTORIES} today={today} />
        {filters.view !== 'list' && <MonthStrip filters={filters} events={inYear} today={today} />}
        {filters.view === 'ribbon' && <CalendarWeekdayHeader />}
      </div>

      {filters.view === 'ribbon' && (
        <>
          {/* Сентинел прошлого: лента листается и вверх. Строка «раньше турниров нет» нужна,
              чтобы край ленты не выглядел оборванным. */}
          <div ref={topSentinelRef} aria-hidden="true" className="h-1" />
          {!canGrowBack && weeks.length > 0 && (
            <p className="self-center py-2 text-xs text-text-faint">Раньше турниров нет</p>
          )}
          <CalendarGrid weeks={weeks} currentWeek={startOfWeek(today)} today={today} />
          {/* Лента растёт прокруткой, а не кнопкой (решение заказчика 06.11.2026): сентинел
              внизу, подгрузка за 600px до него — так следующие недели готовы раньше, чем до них
              доскроллили, и рывка не видно. Кнопки больше нет, поэтому важно, что окно всё
              равно дотягивается до ближайшего турнира: иначе у узкого фильтра (один город)
              человек упирался бы в пустоту без способа заглянуть дальше. */}
          <div ref={sentinelRef} aria-hidden="true" className="h-1" />
          {!canGrow && weeks.length > 0 && (
            <p className="self-center py-2 text-xs text-text-faint">Дальше турниров нет</p>
          )}
        </>
      )}

      {filters.view === 'month' && (
        <>
          <MonthGrid year={year} month={month} events={events} today={today} />
          {events.length === 0 && (
            <p className="text-sm text-text-muted">
              В этом месяце турниров нет{filters.weapons || filters.regions || filters.city || filters.q
                ? ' — по выбранным фильтрам'
                : ''}.
            </p>
          )}
        </>
      )}

      {filters.view === 'list' && (
        events.length === 0
          ? <p className="rounded-xl bg-card p-4 text-sm text-text-secondary">Ничего не нашлось. Попробуйте снять часть фильтров.</p>
          : <EventList events={events} today={today} />
      )}
    </div>
  );
}
