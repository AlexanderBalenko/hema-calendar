import Link from 'next/link';
import { notFound } from 'next/navigation';

import { fetchEvent } from '@/src/lib/api';
import { formatDateRange } from '@/src/lib/month-layout';
import { formatPlace } from '@/src/lib/text';

export const dynamic = 'force-dynamic';

const GENDER_LABEL: Record<string, string> = { Any: 'общая', Male: 'мужская', Female: 'женская' };

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await fetchEvent(slug).catch(() => null);
  if (!data) notFound();

  const { event, description } = data;
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

      {description && <p className="whitespace-pre-line rounded-xl bg-card p-4 text-sm text-text-secondary">{description}</p>}

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
                {n.notes && n.notes !== n.weapon && <span className="text-text-faint"> — {n.notes}</span>}
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

      {/* Результатов здесь нет и не будет: сервис их не хранит (docs/Calendar.md §2). */}
    </article>
  );
}
