import Link from 'next/link';

import {
  filtersToSearch,
  monthKey,
  RIBBON_WEEKS,
  parseMonthKey,
  type CalendarFilters,
  type SelectedEvent,
} from '@/src/lib/filters';
import { MONTH_TITLES, parseDate } from '@/src/lib/month-layout';

/**
 * Полоска месяцев со счётчиками — главная навигация календаря портала hema.ru
 * (slices/events/calendar-month-strip.tsx): год, двенадцать месяцев, под каждым столбик и
 * число турниров. По ней сразу видно, где в году густо, а где пусто, — стрелками «вперёд-назад»
 * это не узнать.
 *
 * Счётчики считаются по ТЕКУЩИМ фильтрам, но без ограничения по датам: включил саблю — видно,
 * в каких месяцах сабля вообще есть.
 *
 * Месяцы — ссылки, а не кнопки: сайт статический, состояние живёт в адресе, и ссылку можно
 * открыть в новой вкладке или отдать поисковику.
 */
const MAX_BAR_HEIGHT = 14;

export function MonthStrip({
  filters,
  events,
  today,
}: {
  filters: CalendarFilters;
  /** Турниры, отобранные фильтрами без учёта дат; неподходящие приезжают, когда включён глазик. */
  events: SelectedEvent[];
  today: string;
}) {
  const { year, month } = parseMonthKey(filters.month, today);

  const counts = Array.from({ length: 12 }, () => 0);
  let inYear = 0;
  for (const event of events) {
    // Счётчики считают только ПОДХОДЯЩЕЕ, даже когда неподходящее показано: иначе включённый
    // глазик возвращал бы числа как без фильтров, и полоска перестала бы отвечать на вопрос
    // «где в году густо для МЕНЯ».
    if (!event.isSuitable) continue;
    const date = parseDate(event.startsAt);
    if (date.year !== year) continue;
    counts[date.month] += 1;
    inYear += 1;
  }
  const max = Math.max(1, ...counts);

  // Выбор месяца начинает ленту заново: развёрнутое окно прошлого и будущего относится к
  // ПРЕЖНЕЙ точке отсчёта, и тащить его в другой месяц значит показать человеку совсем не то,
  // куда он ткнул.
  const fresh = { weeks: RIBBON_WEEKS, back: 0 };
  const yearLink = (delta: number) =>
    `/${filtersToSearch({ ...filters, ...fresh, month: monthKey(year + delta, month) }, today)}`;

  return (
    <div className="flex items-center gap-2 rounded-xl bg-background-secondary px-2 py-1.5">
      <div className="flex shrink-0 items-center gap-1">
        <Link
          href={yearLink(-1)}
          aria-label={`${year - 1} год`}
          className="rounded-md px-1 text-sm text-text-muted hover:bg-card hover:text-foreground"
        >
          ‹
        </Link>
        <span className="flex flex-col items-center leading-none">
          <span className="text-sm font-medium text-foreground tabular-nums">{year}</span>
          <span className="text-[10px] text-text-faint tabular-nums">{inYear}</span>
        </span>
        <Link
          href={yearLink(1)}
          aria-label={`${year + 1} год`}
          className="rounded-md px-1 text-sm text-text-muted hover:bg-card hover:text-foreground"
        >
          ›
        </Link>
      </div>

      <div className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
        {MONTH_TITLES.map((title, index) => {
          const isCurrent = index === month;
          const isEmpty = counts[index] === 0;
          return (
            <Link
              key={title}
              href={`/${filtersToSearch({ ...filters, ...fresh, month: monthKey(year, index) }, today)}`}
              aria-current={isCurrent ? 'date' : undefined}
              aria-label={`${title} ${year}, турниров: ${counts[index]}`}
              className={[
                'flex shrink-0 flex-col items-center gap-0.5 rounded-md px-2 py-0.5 text-xs transition-colors',
                isCurrent ? 'bg-card text-foreground' : 'text-text-secondary hover:bg-card',
              ].join(' ')}
            >
              <span
                aria-hidden
                className={`leading-none ${
                  isCurrent ? 'font-medium text-foreground' : isEmpty ? 'text-text-faint' : 'text-text-secondary'
                }`}
              >
                {title.slice(0, 3).toLowerCase()}
              </span>
              <span aria-hidden className="flex items-end gap-1 leading-none" style={{ height: MAX_BAR_HEIGHT }}>
                <span
                  className="w-1 rounded-sm bg-text-faint"
                  style={{ height: isEmpty ? 2 : Math.max(3, Math.round((counts[index] / max) * MAX_BAR_HEIGHT)) }}
                />
                {counts[index] > 0 && <span className="text-[10px] text-text-secondary tabular-nums">{counts[index]}</span>}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
