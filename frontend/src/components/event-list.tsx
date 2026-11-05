import Link from 'next/link';

import type { CalendarEvent } from '@/src/lib/data';
import { formatDateRange, MONTH_TITLES, parseDate } from '@/src/lib/month-layout';
import { formatPlace, weaponSummary } from '@/src/lib/text';

/**
 * Список турниров строками, как в календаре портала hema.ru
 * (slices/events/calendar-list-view.tsx): строка в 44px, дата в своей колонке справа, название,
 * оружие, место и организатор — каждый в своей. Плотно: за экран видно полтора десятка
 * турниров, а не четыре.
 *
 * Отличие от портального, вынужденное: там виды оружия показаны иконками из его справочника
 * (админ загружает SVG), здесь их взять неоткуда — оружие словами.
 */
export function EventList({ events, today }: { events: CalendarEvent[]; today: string }) {
  let lastMonth = '';

  return (
    <div className="flex flex-col gap-1">
      {events.map((event) => {
        const { year, month } = parseDate(event.startsAt);
        const key = `${year}-${month}`;
        const divider = key === lastMonth ? null : `${MONTH_TITLES[month]} ${year}`;
        lastMonth = key;

        return (
          <div key={event.slug} className="flex flex-col gap-1">
            {divider && (
              // Липкий заголовок месяца — под шапкой (64px): при прокрутке длинного списка
              // видно, какой месяц читаешь.
              <h2 className="sticky top-16 z-10 bg-background px-2 pb-1 pt-3 text-xs uppercase tracking-wide text-text-muted">
                {divider}
              </h2>
            )}
            <EventRow event={event} today={today} />
          </div>
        );
      })}
    </div>
  );
}

function EventRow({ event, today }: { event: CalendarEvent; today: string }) {
  const isPast = event.endsAt < today;
  const place = formatPlace(event.city, event.locationManual);
  const weapons = weaponSummary(event.nominations);

  const row = isPast
    ? 'bg-calendar-past text-calendar-pastText'
    : 'bg-calendar-bar text-foreground hover:bg-calendar-barHover';
  const secondary = isPast ? 'text-calendar-pastTextMuted' : 'text-text-secondary';

  return (
    <Link
      href={`/events/${event.slug}`}
      className={`group relative flex min-h-11 items-center gap-2 rounded-md px-2 py-1 transition-colors ${row}`}
    >
      <span className={`w-28 shrink-0 text-right text-xs tabular-nums ${secondary}`}>
        {formatDateRange(event.startsAt, event.endsAt)}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{event.title}</span>
      {/* Колонки справа убираются по мере сужения экрана: на телефоне остаются дата и
          название, остальное есть на странице турнира. */}
      <span className={`hidden w-[170px] shrink-0 truncate text-xs md:block ${secondary}`}>
        {weapons.join(' · ')}
      </span>
      <span className={`hidden w-[130px] shrink-0 truncate text-xs sm:block ${secondary}`}>{place}</span>
      <span className={`hidden w-[140px] shrink-0 truncate text-xs lg:block ${secondary}`}>
        {event.organizerName}
      </span>
    </Link>
  );
}
