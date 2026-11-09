import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import full from '@/src/generated/events.json';
import type { CalendarEvent } from '@/src/lib/data';
import { formatDateRange } from '@/src/lib/month-layout';
import { formatOrganizers, formatPlace } from '@/src/lib/text';
import { BackToCalendar } from '@/src/components/back-to-calendar';
import { EventKindIcon, kindWord } from '@/src/components/event-kind';

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
  const organizers = formatOrganizers(event.organizerName, event.coOrganizers);
  return {
    title: `${event.title} — ${formatDateRange(event.startsAt, event.endsAt, true)}`,
    description: [place, organizers].filter(Boolean).join(' · ') || undefined,
  };
}

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = find(slug);
  if (!event) notFound();

  const place = formatPlace(event.city, event.locationManual);
  const organizers = formatOrganizers(event.organizerName, event.coOrganizers);

  return (
    <article className="flex flex-col gap-4">
      <BackToCalendar />

      <header className="flex flex-col gap-1">
        <h1 className="flex items-start gap-2 font-display text-2xl text-foreground">
          <EventKindIcon kind={event.kind} className="mt-2 size-4 shrink-0 text-primary" />
          <span>{event.title}</span>
        </h1>
        <p className="text-sm text-text-secondary">
          {formatDateRange(event.startsAt, event.endsAt, true)}
          {kindWord(event.kind) && ` · ${kindWord(event.kind)}`}
          {event.online && ' · онлайн'}
          {place && ` · ${place}`}
          {event.macroRegion && <span className="text-text-muted"> · {event.macroRegion}</span>}
        </p>
        {organizers && (
          <p className="text-sm text-text-muted">
            {(event.coOrganizers?.length ?? 0) > 0 ? 'Организаторы' : 'Организатор'}: {organizers}
          </p>
        )}
      </header>

      {event.description && (
        <p className="whitespace-pre-line rounded-xl bg-card p-4 text-sm text-text-secondary">{event.description}</p>
      )}

      {/* Дисциплины — у не-турниров: зачётов у них нет, и список оружия единственное, что
          говорит, чем там занимаются. У турнира это поле пустое по модели. */}
      {(event.weapons?.length ?? 0) > 0 && (
        <section className="rounded-xl bg-card p-4">
          <h2 className="mb-2 text-sm text-text-muted">Дисциплины</h2>
          <p className="text-sm text-foreground">
            {event.weapons!.map((weapon) => weapon.name).join(' · ')}
          </p>
        </section>
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
                  {n.isTeam && ' · командная'}
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

      {/* Две разные ссылки, а не одна «внешняя»: анонс у организатора рассказывает про турнир,
          карточка хемагона показывает сетку, номинации и участников. Раньше карточка приезжала
          в то же поле и подписывалась «страницей организатора», хотя это не она. */}
      {(event.externalUrl || event.hemagonUrl) && (
        <div className="flex flex-wrap gap-4">
          {event.externalUrl && (
            <a href={event.externalUrl} target="_blank" rel="noreferrer noopener" className="text-sm text-primary hover:underline">
              Анонс у организатора
            </a>
          )}
          {event.hemagonUrl && (
            <a href={event.hemagonUrl} target="_blank" rel="noreferrer noopener" className="text-sm text-primary hover:underline">
              Турнир на Хемагоне
            </a>
          )}
        </div>
      )}

      {/* Результатов здесь нет и не будет: календарь их не хранит (docs/Calendar.md §2). */}
    </article>
  );
}
