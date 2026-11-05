'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { CalendarGrid, CalendarWeekdayHeader, type GridEvent } from '@/src/components/calendar-ribbon';
import { EventList } from '@/src/components/event-list';
import { FilterBar } from '@/src/components/filter-bar';
import { MonthGrid } from '@/src/components/month-grid';
import { MonthStrip } from '@/src/components/month-strip';
import { BUILT_AT, DIRECTORIES, EVENTS } from '@/src/lib/data';
import { parseFilters, parseMonthKey, selectEvents, type RawParams } from '@/src/lib/filters';
import { addDays, isPastEvent, layoutRange, startOfWeek, todayLocal } from '@/src/lib/month-layout';

/**
 * Календарь: лента недель (главный вид, как на портале), сетка месяца или список. Фильтры —
 * в адресе страницы.
 *
 * Страница клиентская, потому что сайт статический: один и тот же файл отдаётся на любой адрес
 * с параметрами, и разобрать их может только браузер. Данные при этом уже здесь — они вшиты в
 * сборку (см. src/lib/data.ts), так что ни фильтр, ни переключение месяца не ждут сети.
 */

/** Сколько недель ленты показываем сразу и сколько добавляет кнопка «Показать ещё». */
const RIBBON_WEEKS = 12;
const RIBBON_STEP = 8;

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
  const [extraWeeks, setExtraWeeks] = useState(0);

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

  // Лента: окно недель от начала выбранного месяца. Портал подгружает недели бесконечной
  // прокруткой с сервера; здесь все данные уже в браузере, поэтому окно просто растёт кнопкой.
  const ribbonFrom = startOfWeek(`${filters.month}-01`);
  const ribbonTo = addDays(ribbonFrom, (RIBBON_WEEKS + extraWeeks) * 7 - 1);
  const weeks = useMemo(() => {
    if (filters.view !== 'ribbon') return [];
    const inWindow: GridEvent[] = inYear
      .filter((event) => event.endsAt >= ribbonFrom && event.startsAt <= ribbonTo)
      .map((event) => ({ ...event, isPast: isPastEvent(event.endsAt, today) }));
    return layoutRange(ribbonFrom, ribbonTo, inWindow);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- окно и фильтры приходят из адреса
  }, [inYear, ribbonFrom, ribbonTo, filters.view, today]);

  // Смена месяца или фильтров начинает окно ленты заново: иначе «показать ещё» тянулось бы с
  // прошлого просмотра.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setExtraWeeks(0), [filters.month, params]);

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
          <CalendarGrid weeks={weeks} currentWeek={startOfWeek(today)} today={today} />
          <button
            type="button"
            onClick={() => setExtraWeeks((value) => value + RIBBON_STEP)}
            className="self-center rounded-lg border border-border px-4 py-2 text-sm text-text-secondary hover:border-border-light hover:text-foreground"
          >
            Показать ещё
          </button>
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
