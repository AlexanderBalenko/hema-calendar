import Link from 'next/link';

import { fetchCalendar, type CalendarEvent } from '@/src/lib/api';

/**
 * Список турниров — первая, намеренно скучная страница каркаса: она доказывает, что цепочка
 * «база → API → страница» живая. Сетка месяца и лента недель переезжают из портала следующим
 * шагом, вместе с фильтрами.
 */
export const dynamic = 'force-dynamic';

function formatRange(startsAt: string, endsAt: string): string {
  const start = new Date(`${startsAt}T00:00:00Z`);
  const end = new Date(`${endsAt}T00:00:00Z`);
  const fmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  return startsAt === endsAt ? fmt.format(start) : `${fmt.format(start)} — ${fmt.format(end)}`;
}

function EventRow({ event }: { event: CalendarEvent }) {
  const place = [event.city, event.locationManual].filter(Boolean).join(', ');
  return (
    <li className="rounded-xl bg-card p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link href={`/events/${event.slug}`} className="text-base text-foreground hover:text-primary-light">
          {event.title}
        </Link>
        <span className="text-xs text-text-muted">{formatRange(event.startsAt, event.endsAt)}</span>
        {place && <span className="text-xs text-text-secondary">{place}</span>}
        {event.organizerName && <span className="ml-auto text-xs text-text-faint">{event.organizerName}</span>}
      </div>
      {event.nominations.length > 0 && (
        <p className="mt-1 text-xs text-text-muted">
          {event.nominations.map((n) => n.weapon).join(' · ')}
        </p>
      )}
    </li>
  );
}

export default async function HomePage() {
  const today = new Date().toISOString().slice(0, 10);
  let events: CalendarEvent[] = [];
  let error: string | null = null;

  try {
    events = await fetchCalendar({ from: today });
  } catch {
    // Пустая база и лежащий API для каркаса — обычное состояние: страница обязана открыться и
    // сказать об этом словами, а не пятисоткой.
    error = 'Не удалось получить список турниров: проверьте, что API поднят.';
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl text-foreground">Ближайшие турниры</h1>
      {error && <p className="rounded-xl bg-card p-4 text-sm text-danger">{error}</p>}
      {!error && events.length === 0 && (
        <p className="rounded-xl bg-card p-4 text-sm text-text-secondary">
          Пока ни одного турнира. Импорт с хемагона и из таблиц организаторов — следующий шаг.
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {events.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
      </ul>
    </div>
  );
}
