import { EventList } from '@/src/components/event-list';
import { FilterBar } from '@/src/components/filter-bar';
import { MonthGrid } from '@/src/components/month-grid';
import { MonthNav } from '@/src/components/month-nav';
import { fetchCalendar, fetchDirectories, type CalendarEvent, type Directories } from '@/src/lib/api';
import {
  filtersToQuery,
  isInPeriod,
  parseFilters,
  parseMonthKey,
  type RawParams,
} from '@/src/lib/filters';
import { todayLocal } from '@/src/lib/month-layout';

/**
 * Календарь: сетка месяца или список, фильтры — в адресе страницы (учётных записей в сервисе нет,
 * сохранять подборку некуда, зато ссылкой с фильтрами можно поделиться).
 */
export const dynamic = 'force-dynamic';

const EMPTY_DIRECTORIES: Directories = { weapons: [], cities: [], macroRegions: [] };

export default async function HomePage({ searchParams }: { searchParams: Promise<RawParams> }) {
  // «Сегодня» считается на сервере, поэтому у контейнера фронта задан TZ=Europe/Moscow: под UTC
  // вечером по Москве сетка подсвечивала бы вчерашний день.
  const today = todayLocal();
  const filters = parseFilters(await searchParams, today);
  const { year, month } = parseMonthKey(filters.month, today);

  const [calendar, directories] = await Promise.allSettled([
    fetchCalendar(filtersToQuery(filters, today)),
    fetchDirectories(),
  ]);

  const error = calendar.status === 'rejected'
    ? 'Не удалось получить турниры: API не ответил.'
    : null;
  let events: CalendarEvent[] = calendar.status === 'fulfilled' ? calendar.value : [];
  if (filters.view === 'list') {
    events = events.filter((event) => isInPeriod(event, filters.period, today));
    // Прошедшее читают от свежего к старому: 2020 год в начале списка никому не нужен.
    if (filters.period === 'past') events = [...events].reverse();
  }

  return (
    <div className="flex flex-col gap-4">
      {filters.view === 'month'
        ? <MonthNav filters={filters} today={today} />
        : <h1 className="font-display text-xl text-foreground">Турниры</h1>}

      <FilterBar
        filters={filters}
        directories={directories.status === 'fulfilled' ? directories.value : EMPTY_DIRECTORIES}
        today={today}
      />

      {error && <p className="rounded-xl bg-card p-4 text-sm text-danger">{error}</p>}

      {!error && filters.view === 'month' && (
        <>
          <MonthGrid year={year} month={month} events={events} today={today} />
          {events.length === 0 && (
            <p className="text-sm text-text-muted">
              В этом месяце турниров нет{filters.weapons.length || filters.regions.length || filters.cityId || filters.q
                ? ' — по выбранным фильтрам'
                : ''}.
            </p>
          )}
        </>
      )}

      {!error && filters.view === 'list' && (
        events.length === 0
          ? <p className="rounded-xl bg-card p-4 text-sm text-text-secondary">Ничего не нашлось. Попробуйте снять часть фильтров.</p>
          : <EventList events={events} today={today} />
      )}
    </div>
  );
}
