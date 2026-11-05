import Link from 'next/link';

import { filtersToSearch, monthKey, parseMonthKey, type CalendarFilters } from '@/src/lib/filters';
import { MONTH_TITLES, parseDate, shiftMonth } from '@/src/lib/month-layout';

/**
 * Переключение месяца — обычные ссылки, а не кнопки с обработчиками: адрес и так единственное
 * состояние календаря, а ссылку можно открыть в новой вкладке и отдать поисковику.
 */
export function MonthNav({ filters, today }: { filters: CalendarFilters; today: string }) {
  const { year, month } = parseMonthKey(filters.month, today);
  const now = parseDate(today);
  const isCurrentMonth = year === now.year && month === now.month;

  const link = (delta: number) => {
    const shifted = shiftMonth(year, month, delta);
    return filtersToSearch({ ...filters, month: monthKey(shifted.year, shifted.month) }, today);
  };

  return (
    <div className="flex items-center gap-2">
      <Link
        href={`/${link(-1)}`}
        aria-label="Предыдущий месяц"
        className="rounded-lg border border-border px-2 py-1 text-sm text-text-secondary hover:border-border-light hover:text-foreground"
      >
        ←
      </Link>
      <h1 className="font-display text-xl text-foreground">
        {MONTH_TITLES[month]} <span className="text-text-muted">{year}</span>
      </h1>
      <Link
        href={`/${link(1)}`}
        aria-label="Следующий месяц"
        className="rounded-lg border border-border px-2 py-1 text-sm text-text-secondary hover:border-border-light hover:text-foreground"
      >
        →
      </Link>
      {!isCurrentMonth && (
        <Link
          href={`/${filtersToSearch({ ...filters, month: monthKey(now.year, now.month) }, today)}`}
          className="text-sm text-primary hover:underline"
        >
          Сегодня
        </Link>
      )}
    </div>
  );
}
