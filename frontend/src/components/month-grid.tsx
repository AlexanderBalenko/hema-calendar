import Link from 'next/link';

import type { SelectedEvent } from '@/src/lib/filters';
import {
  eventBodyStyle,
  layoutMonth,
  MONTH_LABELS,
  type EventBodyStyle,
  type MonthDayCell,
  type MonthSegment,
  type MonthWeekLayout,
} from '@/src/lib/month-layout';
import { formatPlace } from '@/src/lib/text';
import { hoverProps } from './event-hover';
import { EventKindIcon } from './event-kind';

/**
 * Вид «Месяц»: один месяц на экран, семь равных колонок, полосы-сегменты вместо баров и нитей.
 * Отрисовка повторяет календарь портала hema.ru (slices/events/calendar-month-view.tsx) —
 * плашки дней без линеек, полосы поверх них абсолютом, числа кружками: календарь часть
 * портала, и выглядеть он должен так же.
 *
 * Чего здесь нет из портального: рельса состояний, звезды флагмана, иконок типа события и
 * всплывающей карточки — всё это про залогиненного человека и его отметки, которых у
 * календаря нет.
 *
 * Клиентского состояния нет: сегменты — обычные ссылки, месяц переключается ссылками же,
 * поэтому компонент серверный и в бандл не попадает.
 */
const SEGMENT_HEIGHT = 22;
const LANE_STEP = 24;
const WEEK_HEADER = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

export function MonthGrid({
  year,
  month,
  events,
  today,
}: {
  year: number;
  month: number;
  events: SelectedEvent[];
  today: string;
}) {
  const weeks = layoutMonth(year, month, events, today);

  return (
    // Семь колонок на телефоне нечитаемы, а прятать месяц целиком — хуже: даём горизонтальную
    // прокрутку, минимальная ширина подобрана так, чтобы в полосу влезало название турнира.
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="flex min-w-[680px] flex-col gap-1">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {WEEK_HEADER.map((label, i) => (
            <span
              key={label}
              className={`px-1.5 text-[11px] leading-none ${i >= 5 ? 'text-calendar-weekend' : 'text-text-muted'}`}
            >
              {label}
            </span>
          ))}
        </div>

        <div className="flex flex-col gap-1">
          {weeks.map((week) => (
            <WeekRow key={week.weekStart} week={week} today={today} />
          ))}
        </div>
      </div>
    </div>
  );
}

function WeekRow({ week, today }: { week: MonthWeekLayout<SelectedEvent>; today: string }) {
  // Высота строки растёт по числу ярусов: лимита «+ ещё N» нет намеренно — спрятанное событие
  // никто не находит.
  const height = week.laneCount === 0 ? 44 : 24 + week.laneCount * LANE_STEP + 8;

  return (
    <div className="relative grid gap-1" style={{ gridTemplateColumns: 'repeat(7, 1fr)', height }}>
      {week.days.map((day) => (
        <DayCell key={day.date} day={day} />
      ))}
      {week.segments.map((segment) => (
        <Segment key={`${segment.event.slug}-${week.weekStart}`} segment={segment} today={today} />
      ))}
    </div>
  );
}

/** Цвет плашки дня: будни — фон второго уровня, выходные — карточка, прошедшее — общий фон. */
function DayCell({ day }: { day: MonthDayCell }) {
  const background = day.isPast ? 'bg-background' : day.isWeekend ? 'bg-card' : 'bg-background-secondary';

  return (
    <div
      className={`relative rounded-md ${background} ${day.isToday ? 'ring-1 ring-primary/40' : ''}`}
      style={{ gridColumn: day.column + 1 }}
    >
      <span
        className={[
          'ml-1 mt-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] leading-none tabular-nums',
          day.isToday ? 'bg-primary text-primary-foreground' : '',
          !day.isToday && !day.isCurrentMonth ? 'text-text-faint' : '',
          !day.isToday && day.isCurrentMonth && day.isWeekend ? 'text-calendar-weekend' : '',
          !day.isToday && day.isCurrentMonth && !day.isWeekend ? 'text-text-secondary' : '',
        ].join(' ')}
      >
        {/* Первое число подписано месяцем: иначе на стыке месяцев не понять, где чей день. */}
        {day.day === 1 ? `${day.day} ${MONTH_LABELS[day.month].slice(0, 3)}` : day.day}
      </span>
    </div>
  );
}

/** Те же четыре стиля тела, что в ленте, но без рамки: полоса месяца всего 11px высотой. */
const BODY_CLASS: Record<EventBodyStyle, string> = {
  unsuitable: 'bg-card text-text-faint',
  pastUnsuitable: 'bg-calendar-pastUnsuitable text-calendar-pastUnsuitableText',
  past: 'bg-calendar-past text-calendar-pastText',
  normal: 'bg-calendar-bar text-foreground hover:bg-calendar-barHover',
};

function Segment({ segment, today }: { segment: MonthSegment<SelectedEvent>; today: string }) {
  const { event } = segment;
  const isPast = event.endsAt < today;
  const width = (segment.endColumn - segment.startColumn + 1) / 7;
  const place = event.city ?? formatPlace(event.city, event.locationManual);

  return (
    <Link
      href={`/events/${event.slug}`}
      // Прежняя подсказка (название, даты, место, причина «не подходит») заменена ховер-карточкой:
      // в ней то же самое плюс номинации, и она не ждёт секунду, как браузерный title.
      {...hoverProps(event)}
      className={[
        'absolute flex items-center overflow-hidden px-1.5 text-[11px] transition-colors',
        // Обрезанный край — сигнал продолжения: с той стороны полоса остаётся прямоугольной.
        segment.continuesLeft ? 'rounded-l-none' : 'rounded-l-[4px]',
        segment.continuesRight ? 'rounded-r-none' : 'rounded-r-[4px]',
        BODY_CLASS[eventBodyStyle(event.isSuitable, isPast)],
      ].join(' ')}
      style={{
        left: `calc(${(segment.startColumn / 7) * 100}% + 2px)`,
        width: `calc(${width * 100}% - 4px)`,
        top: 24 + segment.lane * LANE_STEP,
        height: SEGMENT_HEIGHT,
      }}
    >
      {/* В сетке только иконка: полоса однодневного события — 126px, и слову там не встать.
          Полностью тип виден в ховер-карточке и на странице события. */}
      <EventKindIcon kind={event.kind} className="mr-1 size-3 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{event.title}</span>
      {/* Город — только на полосах шире одного дня (просьба заказчика 08.11.2026: «чтобы и
          города было видно»). Замер сетки: однодневная полоса — 126px, и у трёх названий из
          семи там уже не хватает места; двухдневная — 257px, и после названия остаётся 81–205px,
          куда город встаёт свободно. На узкой он помещался бы только вместо названия, а название
          важнее: город всё равно есть в ховер-карточке. Берём сам город, а не место целиком:
          «Калуга, спортзал на такой-то» в полосе всё равно не прочесть. */}
      {segment.endColumn > segment.startColumn && place && (
        <span className="ml-1.5 max-w-[40%] shrink-0 truncate opacity-70">{place}</span>
      )}
    </Link>
  );
}
