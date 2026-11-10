'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';

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
 *
 * Связь с лентой двусторонняя (решение заказчика 10.11.2026). Полоска показывает не тот месяц,
 * с которого лента начата, а тот, который человек СЕЙЧАС видит: `at` приезжает из страницы, она
 * следит за прокруткой. В обратную сторону — `onPick`: если выбранный месяц в ленте уже
 * загружен, страница прокручивает к нему и говорит об этом «да», и переход по ссылке не нужен.
 */
const MAX_BAR_HEIGHT = 14;

export function MonthStrip({
  filters,
  events,
  today,
  at,
  onPick,
}: {
  filters: CalendarFilters;
  /** Турниры, отобранные фильтрами без учёта дат; неподходящие приезжают, когда включён глазик. */
  events: SelectedEvent[];
  today: string;
  /** Что показывать подсвеченным: видимый на экране месяц. Нет — показываем месяц из адреса. */
  at?: { year: number; month: number };
  /** Прокрутить к месяцу внутри уже загруженной ленты. Вернула `true` — ссылку не открываем. */
  onPick?: (key: string) => boolean;
}) {
  const fromAddress = parseMonthKey(filters.month, today);
  const { year, month } = at ?? fromAddress;

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

  /** Щелчок по месяцу или по году: сперва пробуем прокрутить, и только иначе уходим по ссылке. */
  const pick = (event: { preventDefault: () => void }, key: string) => {
    if (onPick?.(key)) event.preventDefault();
  };

  // На узком экране двенадцать месяцев в строку не влезают, полоска прокручивается боком — и
  // подсвеченный месяц уезжает за край ровно тогда, когда он и нужен. Подтягиваем его к центру
  // сами.
  //
  // Двигаем scrollLeft САМОЙ полоски, а не scrollIntoView: тот уводит и страницу по вертикали, а
  // здесь вертикалью распоряжается человек — он как раз листает ленту, за которой полоска и
  // следует. Прокрутка в ответ на прокрутку увела бы календарь из-под руки.
  const scroller = useRef<HTMLDivElement>(null);
  const active = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const box = scroller.current;
    const node = active.current;
    if (!box || !node) return;
    const boxBox = box.getBoundingClientRect();
    const nodeBox = node.getBoundingClientRect();
    const center = box.scrollLeft + (nodeBox.left - boxBox.left) - (boxBox.width - nodeBox.width) / 2;
    const target = Math.max(0, Math.min(center, box.scrollWidth - box.clientWidth));
    // На широком экране прокручивать нечего: scrollWidth равен clientWidth, цель всегда 0.
    if (Math.abs(target - box.scrollLeft) > 1) box.scrollTo({ left: target, behavior: 'smooth' });
  }, [year, month]);

  return (
    <div className="flex items-center gap-2 rounded-xl bg-background-secondary px-2 py-1.5">
      <div className="flex shrink-0 items-center gap-1">
        <Link
          href={yearLink(-1)}
          onClick={(event) => pick(event, monthKey(year - 1, month))}
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
          onClick={(event) => pick(event, monthKey(year + 1, month))}
          aria-label={`${year + 1} год`}
          className="rounded-md px-1 text-sm text-text-muted hover:bg-card hover:text-foreground"
        >
          ›
        </Link>
      </div>

      <div ref={scroller} className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
        {MONTH_TITLES.map((title, index) => {
          const isCurrent = index === month;
          const isEmpty = counts[index] === 0;
          return (
            <Link
              key={title}
              ref={isCurrent ? active : undefined}
              href={`/${filtersToSearch({ ...filters, ...fresh, month: monthKey(year, index) }, today)}`}
              onClick={(event) => pick(event, monthKey(year, index))}
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
