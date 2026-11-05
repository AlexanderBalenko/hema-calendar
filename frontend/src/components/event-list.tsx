import Link from 'next/link';

import type { CalendarEvent } from '@/src/lib/api';
import { formatDateRange, MONTH_TITLES, parseDate } from '@/src/lib/month-layout';
import { formatPlace, weaponSummary } from '@/src/lib/text';

/**
 * Список турниров с разделителями месяцев. Оружие в строке — распознанные виды без повторов:
 * у турнира бывает двадцать номинаций на пять видов оружия, и перечислять их все в строке
 * списка — шум.
 */
export function EventList({ events, today }: { events: CalendarEvent[]; today: string }) {
  let lastMonth = '';

  return (
    <ul className="flex flex-col gap-2">
      {events.map((event) => {
        const { year, month } = parseDate(event.startsAt);
        const key = `${year}-${month}`;
        const divider = key === lastMonth ? null : `${MONTH_TITLES[month]} ${year}`;
        lastMonth = key;

        return (
          <li key={event.id} className="flex flex-col gap-2">
            {divider && (
              <h2 className="mt-2 border-b border-border pb-1 text-xs uppercase tracking-wide text-text-muted">
                {divider}
              </h2>
            )}
            <EventRow event={event} today={today} />
          </li>
        );
      })}
    </ul>
  );
}

function EventRow({ event, today }: { event: CalendarEvent; today: string }) {
  const isPast = event.endsAt < today;
  const place = formatPlace(event.city, event.locationManual);
  const weapons = weaponSummary(event.nominations);
  const shown = weapons.slice(0, 6);

  return (
    <div className={`rounded-xl bg-card p-4 ${isPast ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="w-32 shrink-0 text-xs tabular-nums text-text-muted">
          {formatDateRange(event.startsAt, event.endsAt)}
        </span>
        <Link href={`/events/${event.slug}`} className="text-base text-foreground hover:text-primary-light">
          {event.title}
        </Link>
        {place && <span className="text-xs text-text-secondary">{place}</span>}
        {event.organizerName && <span className="ml-auto text-xs text-text-faint">{event.organizerName}</span>}
      </div>
      {shown.length > 0 && (
        <p className="mt-1 text-xs text-text-muted">
          {shown.join(' · ')}
          {weapons.length > shown.length && <span className="text-text-faint"> + ещё {weapons.length - shown.length}</span>}
          {event.nominations.some((n) => n.isTeam) && <span className="text-text-faint"> · командные</span>}
          {event.nominations.some((n) => n.isBeginnerFriendly) && <span className="text-text-faint"> · новички</span>}
        </p>
      )}
    </div>
  );
}
