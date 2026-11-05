import Link from 'next/link';

import type { CalendarEvent } from '@/src/lib/data';
import {
  formatDateRange,
  layoutMonth,
  MONTH_LABELS,
  type MonthDayCell,
  type MonthSegment,
  type MonthWeekLayout,
} from '@/src/lib/month-layout';
import { formatPlace } from '@/src/lib/text';

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
  events: CalendarEvent[];
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

function WeekRow({ week, today }: { week: MonthWeekLayout<CalendarEvent>; today: string }) {
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

function Segment({ segment, today }: { segment: MonthSegment<CalendarEvent>; today: string }) {
  const { event } = segment;
  const isPast = event.endsAt < today;
  const place = formatPlace(event.city, event.locationManual);
  const width = (segment.endColumn - segment.startColumn + 1) / 7;

  return (
    <Link
      href={`/events/${event.slug}`}
      title={`${event.title} · ${formatDateRange(event.startsAt, event.endsAt)}${place ? ` · ${place}` : ''}`}
      className={[
        'absolute flex items-center overflow-hidden px-1.5 text-[11px] transition-colors',
        // Обрезанный край — сигнал продолжения: с той стороны полоса остаётся прямоугольной.
        segment.continuesLeft ? 'rounded-l-none' : 'rounded-l-[4px]',
        segment.continuesRight ? 'rounded-r-none' : 'rounded-r-[4px]',
        isPast
          ? 'bg-calendar-past text-calendar-pastText'
          : 'bg-calendar-bar text-foreground hover:bg-calendar-barHover',
      ].join(' ')}
      style={{
        left: `calc(${(segment.startColumn / 7) * 100}% + 2px)`,
        width: `calc(${width * 100}% - 4px)`,
        top: 24 + segment.lane * LANE_STEP,
        height: SEGMENT_HEIGHT,
      }}
    >
      <span className="truncate">{event.title}</span>
    </Link>
  );
}
