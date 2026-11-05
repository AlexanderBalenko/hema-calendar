'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { EventList } from '@/src/components/event-list';
import { FilterBar } from '@/src/components/filter-bar';
import { MonthGrid } from '@/src/components/month-grid';
import { MonthNav } from '@/src/components/month-nav';
import { BUILT_AT, DIRECTORIES, EVENTS } from '@/src/lib/data';
import { parseFilters, parseMonthKey, selectEvents, type RawParams } from '@/src/lib/filters';
import { todayLocal } from '@/src/lib/month-layout';

/**
 * Календарь: сетка месяца или список, фильтры — в адресе страницы.
 *
 * Страница клиентская, потому что сайт статический: один и тот же файл отдаётся на любой адрес
 * с параметрами, и разобрать их может только браузер. Данные при этом уже здесь — они вшиты в
 * сборку (см. src/lib/data.ts), так что ни фильтр, ни переключение месяца не ждут сети.
 */
export default function HomePage() {
  return (
    // useSearchParams требует границы ожидания: в статической сборке в разметку попадает
    // запасной вариант — календарь текущего месяца без фильтров, и это ровно то, что нужно
    // показать поисковику и человеку, пришедшему по голой ссылке.
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

  const filters = parseFilters(params, today);
  const { year, month } = parseMonthKey(filters.month, today);
  const events = useMemo(() => selectEvents(EVENTS, filters, today),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- фильтры пересобираются из адреса
    [params, today]);

  return (
    <div className="flex flex-col gap-4">
      {filters.view === 'month'
        ? <MonthNav filters={filters} today={today} />
        : <h1 className="font-display text-xl text-foreground">Турниры</h1>}

      <FilterBar filters={filters} directories={DIRECTORIES} today={today} />

      {filters.view === 'month' && (
        <>
          <MonthGrid year={year} month={month} events={events} today={today} />
          {events.length === 0 && (
            <p className="text-sm text-text-muted">
              В этом месяце турниров нет{filters.weapons.length || filters.regions.length || filters.city || filters.q
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
