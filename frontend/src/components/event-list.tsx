import Link from 'next/link';

import type { SelectedEvent } from '@/src/lib/filters';
import {
  eventBodyStyle,
  formatDateRange,
  MONTH_TITLES,
  parseDate,
  type EventBodyStyle,
} from '@/src/lib/month-layout';
import { formatOrganizers, formatPlace, placeForDateColumn, weaponSummary } from '@/src/lib/text';
import { hoverProps } from './event-hover';
import { EventKindIcon, kindWord } from './event-kind';
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
  const placeShort = placeForDateColumn(event.city, event.cityShort, place);
  const weapons = weaponSummary(event.nominations);
  // Пиктограммы — по порядку номинаций, без повторов: подряд идущие номинации одного вида оружия
  // (личный и командный) не должны съесть все четыре места.
  // Дисциплины не-турнира идут сюда наравне с номинационными: для феста без турнира внутри
  // этот список — единственное, что о его оружии известно, и без него колонка стояла бы пустой
  // как раз у тех событий, ради которых типы и заводились.
  const weaponCodes = [...new Set([
    ...event.nominations.map((n) => n.weaponCode).filter((c): c is string => !!c),
    ...(event.weapons ?? []).map((w) => w.code),
  ])];

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
      {/* Колонка даты: на телефоне 60px вместо 112 и месяц тремя буквами (просьба заказчика
          11.11.2026). 60 — это замер, а не круглое число: самая длинная дата КОРОТКОЙ формы при
          11px — «19–20 дек», а стык месяцев («29 ноя — 2 дек», таких в данных 12 из 415) ложится
          в две строки и строку не раздувает (44px против 45). Событий, переходящих через год,
          в данных нет вовсе — на них колонку не закладываем.
          Обе формы в разметке, а переключает их класс: страница собирается заранее, ширины
          экрана на сборке нет, а узнавать её в браузере значило бы перерисовывать список после
          первой отрисовки. */}
      <span className={`w-[60px] shrink-0 text-right text-[11px] tabular-nums sm:w-28 sm:text-xs ${secondary}`}>
        <span className="sm:hidden">{formatDateRange(event.startsAt, event.endsAt, false, true)}</span>
        <span className="hidden sm:inline">{formatDateRange(event.startsAt, event.endsAt)}</span>
        {/* Город второй строкой под датой — только на телефоне (просьба заказчика 12.11.2026).
            До этого в списке на 375px места не было ВОВСЕ: своя колонка приходит только с `sm`,
            и до телефона из места не доезжало ничего. Здесь город не отнимает у названия ни
            точки — колонка даты и так 60px, а короткая форма («СПб», «Крд») укладывается в них
            с запасом. Сокращаются только длинные имена — те, что в колонку не влезают
            (`CITY_FITS_DATE_COLUMN`, замер по всем городам справочника): «Краснодар» и «Москва»
            стоят полностью, «Санкт-Петербург» и «Ростов-на-Дону» — формой из справочника (§5ж).
            У пяти событий из 415 города в справочнике нет (место задано строкой организатора) —
            там встаёт сама строка и режется по ширине колонки: обрывок «Алтайск…» говорит
            читателю больше, чем пустота. */}
        {placeShort && <span className="block truncate text-[10px] leading-tight sm:hidden">{placeShort}</span>}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <EventKindIcon kind={event.kind} />
        {/* Шрифт строки на телефоне мельче: у проекта свой масштаб (text-sm — это 16.7px,
            text-xs — 14.7), и в 375px на название оставалось меньше половины строки. */}
        <span className="truncate text-[14px] font-medium sm:text-sm">{event.title}</span>
        {kindWord(event.kind) && (
          <span className={`shrink-0 text-[11px] sm:text-xs ${secondary}`}>· {kindWord(event.kind)}</span>
        )}
      </span>
      {/* Колонки справа убираются по мере сужения экрана: на телефоне остаются название и
          колонка даты, в которой вторая строка — город (см. выше); остальное есть на странице
          турнира. Подсказки со списком оружия здесь
          больше нет: по наведению на строку встаёт ховер-карточка с полным составом
          номинаций, и две всплывашки спорили бы. */}
      {/* 96px, а не прежние 170: значки занимают максимум 76px (четыре штуки по 16 плюс
          промежутки), и сотня пикселей посреди строки стояла пустой, пока организатора резало
          у каждой четвёртой строки. 96 — это те же четыре значка плюс «+N» для пятого и
          дальше. Освободившиеся 74px отданы организатору (замечание заказчика 08.11.2026). */}
      <span className={`hidden w-24 shrink-0 items-center gap-1 md:flex ${secondary}`}>
        {weaponCodes.slice(0, 4).map((code) => <WeaponIcon key={code} code={code} size={16} />)}
        {weaponCodes.length > 4 && <span className="text-[10px] leading-none">+{weaponCodes.length - 4}</span>}
        {/* Номинация без вида оружия (катана, триатлон) пиктограммы не имеет — для таких
            турниров в колонке остаётся прежний текст, иначе она выглядела бы пустой. */}
        {weaponCodes.length === 0 && <span className="truncate text-xs">{weapons.join(' · ')}</span>}
      </span>
      <span className={`hidden w-[130px] shrink-0 truncate text-xs sm:block ${secondary}`}>{place}</span>
      {/* 214px — это 140 прежних плюс 74, отнятые у колонки оружия. Замер на живых данных:
          обрезанных названий клубов стало 7 из 53 вместо 14. Больше не даём: следующий кусок
          пришлось бы брать у НАЗВАНИЯ турнира, а оно важнее организатора и само режется у
          четырёх строк. */}
      <span className={`hidden w-[214px] shrink-0 truncate text-xs lg:block ${secondary}`}>
        {formatOrganizers(event.organizerName, event.coOrganizers)}
      </span>
    </Link>
  );
}
