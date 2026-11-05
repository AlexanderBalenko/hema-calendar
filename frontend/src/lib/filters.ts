/**
 * Состояние фильтров живёт В АДРЕСЕ СТРАНИЦЫ, а не в памяти компонента и не в localStorage.
 * Причина не в красоте: в сервисе нет учётных записей, сохранять подборку некуда и некому, а
 * отфильтрованный календарь люди присылают друг другу ссылкой. Отсюда же требование к разбору —
 * он обязан переживать любой мусор в параметрах: ссылку правят руками.
 *
 * Модуль чистый (без React и next/navigation) — он же покрыт юнит-тестами.
 */
import type { CalendarQuery } from './api.ts';
import { addDays, dayNumber, fromDayNumber, monthGridBounds, parseDate } from './month-layout.ts';

export type ViewMode = 'month' | 'list';
/** Период для списка: будущие, прошедшие или весь календарь целиком. */
export type Period = 'future' | 'past' | 'all';

export type CalendarFilters = {
  view: ViewMode;
  /** 'YYYY-MM' — показываемый месяц (для вида «месяц»). */
  month: string;
  period: Period;
  /** Коды оружия. */
  weapons: string[];
  /** Названия макрорегионов. */
  regions: string[];
  cityId: number | null;
  team: boolean;
  beginner: boolean;
  q: string;
};

/** Значения, которые в адрес не пишутся: по умолчанию ссылка на календарь — просто «/». */
const DEFAULT_VIEW: ViewMode = 'month';
const DEFAULT_PERIOD: Period = 'future';

export type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/** Список через запятую: пустые куски и дубли выбрасываем, порядок сохраняем. */
function list(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(',') : (value ?? '');
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const item = part.trim();
    if (item) seen.add(item);
  }
  return [...seen];
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * Разбор 'YYYY-MM'. Мусор (в том числе «2026-13») не роняет страницу и не рисует пустой календарь
 * тринадцатого месяца — отдаёт месяц «сегодня».
 */
export function parseMonthKey(value: string, today: string): { year: number; month: number } {
  const fallback = parseDate(today);
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!match) return { year: fallback.year, month: fallback.month };
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  if (month < 0 || month > 11 || year < 1970 || year > 2999) return { year: fallback.year, month: fallback.month };
  return { year, month };
}

export function parseFilters(params: RawParams, today: string): CalendarFilters {
  const periodRaw = first(params.period);
  const cityRaw = Number(first(params.city));
  const { year, month } = parseMonthKey(first(params.month), today);

  return {
    view: first(params.view) === 'list' ? 'list' : 'month',
    month: monthKey(year, month),
    period: periodRaw === 'past' || periodRaw === 'all' ? periodRaw : DEFAULT_PERIOD,
    weapons: list(params.weapons),
    regions: list(params.regions),
    cityId: Number.isInteger(cityRaw) && cityRaw > 0 ? cityRaw : null,
    team: first(params.team) === '1',
    beginner: first(params.beginner) === '1',
    q: first(params.q).trim().slice(0, 100),
  };
}

/** Адрес для этих фильтров: '' для состояния по умолчанию, иначе '?…'. */
export function filtersToSearch(filters: CalendarFilters, today: string): string {
  const params = new URLSearchParams();
  const now = parseDate(today);

  if (filters.view !== DEFAULT_VIEW) params.set('view', filters.view);
  // Месяц пишется в адрес только если он не текущий: ссылка «вот календарь» не должна
  // замораживать посетителя в том месяце, когда её составили.
  if (filters.view === 'month' && filters.month !== monthKey(now.year, now.month)) params.set('month', filters.month);
  if (filters.view === 'list' && filters.period !== DEFAULT_PERIOD) params.set('period', filters.period);
  if (filters.weapons.length) params.set('weapons', filters.weapons.join(','));
  if (filters.regions.length) params.set('regions', filters.regions.join(','));
  if (filters.cityId) params.set('city', String(filters.cityId));
  if (filters.team) params.set('team', '1');
  if (filters.beginner) params.set('beginner', '1');
  if (filters.q) params.set('q', filters.q);

  const search = params.toString();
  return search ? `?${search}` : '';
}

/** Есть ли хоть один фильтр по существу (вид, месяц и период фильтрами не считаются). */
export function hasActiveFilters(filters: CalendarFilters): boolean {
  return filters.weapons.length > 0 || filters.regions.length > 0 || filters.cityId !== null
    || filters.team || filters.beginner || filters.q.length > 0;
}

/**
 * Запрос к API. Границы дат берутся из вида, а не из фильтров: месяц грузит ровно свою сетку
 * (вместе с хвостами соседних месяцев — иначе многодневный турнир с 30 октября не нарисуется в
 * первой строке ноября), а список — выбранный период.
 */
export function filtersToQuery(filters: CalendarFilters, today: string): CalendarQuery {
  const base: CalendarQuery = {
    weapons: filters.weapons.length ? filters.weapons : undefined,
    regions: filters.regions.length ? filters.regions : undefined,
    cityId: filters.cityId ?? undefined,
    team: filters.team || undefined,
    beginner: filters.beginner || undefined,
    q: filters.q || undefined,
  };

  if (filters.view === 'month') {
    const { year, month } = parseMonthKey(filters.month, today);
    const { firstWeek, lastWeek } = monthGridBounds(year, month);
    return { ...base, from: firstWeek, to: addDays(lastWeek, 6) };
  }

  if (filters.period === 'future') return { ...base, from: today };
  if (filters.period === 'past') return { ...base, to: fromDayNumber(dayNumber(today) - 1) };
  return base;
}

/**
 * Добор по периоду на клиенте. Параметры `from`/`to` у API — пересечение с диапазоном, а не
 * «начался в нём»: турнир, который идёт прямо сейчас, попадает и в `to=вчера`. В «прошедших» ему
 * не место — он не прошёл, он идёт. Поэтому список после запроса ещё раз просеивается.
 */
export function isInPeriod(event: { startsAt: string; endsAt: string }, period: Period, today: string): boolean {
  if (period === 'past') return event.endsAt < today;
  if (period === 'future') return event.endsAt >= today;
  return true;
}
