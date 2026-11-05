import Link from 'next/link';

import type { CalendarEvent } from '@/src/lib/data';
import { formatDateRange, layoutMonth, type MonthSegment, type MonthWeekLayout } from '@/src/lib/month-layout';
import { formatPlace } from '@/src/lib/text';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;

/**
 * Сетка месяца. Клиентского состояния здесь нет вовсе: сегменты — обычные ссылки, месяц
 * переключается ссылками же (фильтры живут в адресе), поэтому компонент серверный и в бандл не
 * попадает.
 *
 * Геометрия целиком приходит из `layoutMonth`; компонент только раскрашивает. Высота строки не
 * задаётся числом — её задаёт сетка ярусов, поэтому неделя с шестью турнирами просто вырастает.
 */
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
    // прокрутку, минимальная ширина подобрана так, чтобы в ячейку влезало название турнира.
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="min-w-[680px]">
        <div className="grid grid-cols-7 border-b border-border">
          {WEEKDAYS.map((label, i) => (
            <div
              key={label}
              className={`px-2 py-1 text-xs uppercase tracking-wide ${i >= 5 ? 'text-weekend' : 'text-text-muted'}`}
            >
              {label}
            </div>
          ))}
        </div>

        <div className="flex flex-col">
          {weeks.map((week) => (
            <WeekRow key={week.weekStart} week={week} today={today} />
          ))}
        </div>
      </div>
    </div>
  );
}

function WeekRow({ week, today }: { week: MonthWeekLayout<CalendarEvent>; today: string }) {
  return (
    <div className="relative min-h-[92px] border-b border-border last:border-b-0">
      {/* Фон: ячейки дней. Абсолютный слой, чтобы строка росла по числу ярусов, а ячейки
          тянулись на всю её высоту. */}
      <div aria-hidden className="absolute inset-0 grid grid-cols-7">
        {week.days.map((day) => (
          <div
            key={day.date}
            className={[
              'border-l border-border/60 px-2 py-1 first:border-l-0',
              day.isWeekend ? 'bg-background-secondary' : '',
              day.isCurrentMonth ? '' : 'opacity-40',
            ].join(' ')}
          >
            <span
              className={[
                'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs tabular-nums',
                day.isToday ? 'bg-primary font-medium text-primary-foreground' : '',
                !day.isToday && day.isPast ? 'text-text-faint' : '',
                !day.isToday && !day.isPast ? (day.isWeekend ? 'text-weekend' : 'text-text-secondary') : '',
              ].join(' ')}
            >
              {day.day}
            </span>
          </div>
        ))}
      </div>

      {/* Сегменты поверх фона. gridRow — ярус из раскладки, gridColumn — колонки дня: событие
          никогда не вылезает за свою неделю, многодневное приезжает отдельным сегментом в каждой
          строке со своими «продолжается слева/справа». */}
      <div className="relative grid grid-cols-7 gap-y-[3px] px-[3px] pb-2 pt-8">
        {week.segments.map((segment) => (
          <SegmentBar key={`${segment.event.slug}-${week.weekStart}`} segment={segment} today={today} />
        ))}
      </div>
    </div>
  );
}

function SegmentBar({ segment, today }: { segment: MonthSegment<CalendarEvent>; today: string }) {
  const { event } = segment;
  const isPast = event.endsAt < today;
  const place = formatPlace(event.city, event.locationManual);

  return (
    <Link
      href={`/events/${event.slug}`}
      title={`${event.title} · ${formatDateRange(event.startsAt, event.endsAt)}${place ? ` · ${place}` : ''}`}
      style={{ gridColumn: `${segment.startColumn + 1} / ${segment.endColumn + 2}`, gridRow: segment.lane + 1 }}
      className={[
        'truncate px-2 py-[3px] text-xs leading-tight transition-colors',
        // Прошедшее приглушено, но не до невидимости: на полупрозрачной заливке длинная плашка
        // через всю неделю читалась как тень, а не как турнир.
        isPast
          ? 'bg-border text-text-secondary hover:bg-border-light'
          : 'bg-primary/20 text-primary-light hover:bg-primary/35',
        // Обрезанный край — сигнал продолжения: с той стороны плашка остаётся прямоугольной.
        segment.continuesLeft ? 'rounded-l-none' : 'rounded-l-md',
        segment.continuesRight ? 'rounded-r-none' : 'rounded-r-md',
      ].join(' ')}
    >
      {segment.continuesLeft && <span aria-hidden className="mr-1 text-text-muted">‹</span>}
      {event.title}
    </Link>
  );
}
