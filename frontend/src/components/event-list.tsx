import Link from 'next/link';

import type { SelectedEvent } from '@/src/lib/filters';
import {
  eventBodyStyle,
  formatDateRange,
  MONTH_TITLES,
  parseDate,
  type EventBodyStyle,
} from '@/src/lib/month-layout';
import { formatOrganizers, formatPlace, weaponSummary } from '@/src/lib/text';
import { hoverProps } from './event-hover';
import { WeaponIcon } from './weapon-icon';

/**
 * Список турниров строками, как в календаре портала hema.ru
 * (slices/events/calendar-list-view.tsx): строка в 44px, дата в своей колонке справа, название,
 * оружие, место и организатор — каждый в своей. Плотно: за экран видно полтора десятка
 * турниров, а не четыре.
 *
 * Оружие — до четырёх пиктограмм, как в портале. У шести видов из десяти своей картинки нет
 * (в портале они приезжают из справочника, куда админ загружает SVG) — им достаются скрещённые
 * клинки, а названия словами остаются в подсказке по наведению.
 */
export function EventList({ events, today }: { events: SelectedEvent[]; today: string }) {
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

const BODY_CLASS: Record<EventBodyStyle, string> = {
  unsuitable: 'bg-card text-text-faint',
  pastUnsuitable: 'bg-calendar-pastUnsuitable text-calendar-pastUnsuitableText',
  past: 'bg-calendar-past text-calendar-pastText',
  normal: 'bg-calendar-bar text-foreground hover:bg-calendar-barHover',
};

const SECONDARY_CLASS: Record<EventBodyStyle, string> = {
  unsuitable: 'text-text-faint',
  pastUnsuitable: 'text-calendar-pastUnsuitableText',
  past: 'text-calendar-pastTextMuted',
  normal: 'text-text-secondary',
};

function EventRow({ event, today }: { event: SelectedEvent; today: string }) {
  const isPast = event.endsAt < today;
  const place = formatPlace(event.city, event.locationManual);
  const weapons = weaponSummary(event.nominations);
  // Пиктограммы — по порядку номинаций, без повторов: подряд идущие зачёты одного вида оружия
  // (личный и командный) не должны съесть все четыре места.
  const weaponCodes = [...new Set(event.nominations.map((n) => n.weaponCode).filter((c): c is string => !!c))];

  const style = eventBodyStyle(event.isSuitable, isPast);
  const row = BODY_CLASS[style];
  const secondary = SECONDARY_CLASS[style];

  return (
    <Link
      href={`/events/${event.slug}`}
      // Ховер-карточка вместо прежней подсказки «не подходит»: в ней и причина, и номинации.
      {...hoverProps(event)}
      className={`group relative flex min-h-11 items-center gap-2 rounded-md px-2 py-1 transition-colors ${row}`}
    >
      <span className={`w-28 shrink-0 text-right text-xs tabular-nums ${secondary}`}>
        {formatDateRange(event.startsAt, event.endsAt)}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{event.title}</span>
      {/* Колонки справа убираются по мере сужения экрана: на телефоне остаются дата и
          название, остальное есть на странице турнира. Подсказки со списком оружия здесь
          больше нет: по наведению на строку встаёт ховер-карточка с полным составом
          номинаций, и две всплывашки спорили бы. */}
      <span className={`hidden w-[170px] shrink-0 items-center gap-1 md:flex ${secondary}`}>
        {weaponCodes.slice(0, 4).map((code) => <WeaponIcon key={code} code={code} size={16} />)}
        {weaponCodes.length > 4 && <span className="text-[10px] leading-none">+{weaponCodes.length - 4}</span>}
        {/* Номинация без вида оружия (катана, триатлон) пиктограммы не имеет — для таких
            турниров в колонке остаётся прежний текст, иначе она выглядела бы пустой. */}
        {weaponCodes.length === 0 && <span className="truncate text-xs">{weapons.join(' · ')}</span>}
      </span>
      <span className={`hidden w-[130px] shrink-0 truncate text-xs sm:block ${secondary}`}>{place}</span>
      <span className={`hidden w-[140px] shrink-0 truncate text-xs lg:block ${secondary}`}>
        {formatOrganizers(event.organizerName, event.coOrganizers)}
      </span>
    </Link>
  );
}
