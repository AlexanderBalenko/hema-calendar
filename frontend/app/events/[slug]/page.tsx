import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import full from '@/src/generated/events.json';
import type { CalendarEvent } from '@/src/lib/data';
import { formatDateRange } from '@/src/lib/month-layout';
import { formatPlace } from '@/src/lib/text';

/**
 * Страница турнира — статическая: на сборке их получается по одной на каждый турнир календаря.
 * Именно их находят поиском («Saber Meister 2026»), поэтому здесь полная разметка с датами и
 * местом, а не клиентская отрисовка.
 *
 * Полный набор с описаниями импортируется ЗДЕСЬ, в серверном компоненте: в браузер он не едет,
 * туда попадает только разметка этой страницы.
 */
const EVENTS = (full as unknown as { events: CalendarEvent[] }).events;

const GENDER_LABEL: Record<string, string> = { Any: 'общая', Male: 'мужская', Female: 'женская' };

function find(slug: string): CalendarEvent | undefined {
  return EVENTS.find((event) => event.slug === slug);
}

export function generateStaticParams() {
  return EVENTS.map((event) => ({ slug: event.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const event = find(slug);
  if (!event) return { title: 'Турнир не найден' };
  const place = formatPlace(event.city, event.locationManual);
  return {
    title: `${event.title} — ${formatDateRange(event.startsAt, event.endsAt, true)}`,
    description: [place, event.organizerName].filter(Boolean).join(' · ') || undefined,
  };
}

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = find(slug);
  if (!event) notFound();

  const place = formatPlace(event.city, event.locationManual);

  return (
    <article className="flex flex-col gap-4">
      <Link href="/" className="text-xs text-text-muted hover:text-primary">← ко всем турнирам</Link>

      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl text-foreground">{event.title}</h1>
        <p className="text-sm text-text-secondary">
          {formatDateRange(event.startsAt, event.endsAt, true)}
          {place && ` · ${place}`}
          {event.macroRegion && <span className="text-text-muted"> · {event.macroRegion}</span>}
        </p>
        {event.organizerName && <p className="text-sm text-text-muted">Организатор: {event.organizerName}</p>}
      </header>

      {event.description && (
        <p className="whitespace-pre-line rounded-xl bg-card p-4 text-sm text-text-secondary">{event.description}</p>
      )}

      {event.nominations.length > 0 && (
        <section className="rounded-xl bg-card p-4">
          <h2 className="mb-2 text-sm text-text-muted">Номинации</h2>
          <ul className="flex flex-col gap-1 text-sm text-foreground">
            {event.nominations.map((n, i) => (
              <li key={`${n.weapon}-${i}`}>
                {n.weapon}
                <span className="text-text-muted">
                  {` · ${GENDER_LABEL[n.gender] ?? n.gender}`}
                  {n.isTeam && ' · команда'}
                  {n.isBeginnerFriendly && ' · новички'}
                  {n.minAge != null && ` · от ${n.minAge}`}
                  {n.maxAge != null && ` до ${n.maxAge}`}
                </span>
                {n.notes && n.notes !== n.weapon && <span className="whitespace-pre-line text-text-faint"> — {n.notes}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {event.externalUrl && (
        <a href={event.externalUrl} target="_blank" rel="noreferrer noopener" className="text-sm text-primary hover:underline">
          Страница турнира у организатора
        </a>
      )}

      {/* Результатов здесь нет и не будет: календарь их не хранит (docs/Calendar.md §2). */}
    </article>
  );
}
