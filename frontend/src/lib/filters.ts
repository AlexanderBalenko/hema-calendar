/**
 * Состояние фильтров живёт В АДРЕСЕ СТРАНИЦЫ, а не в памяти компонента и не в localStorage.
 * Причина не в красоте: в сервисе нет учётных записей, сохранять подборку некуда и некому, а
 * отфильтрованный календарь люди присылают друг другу ссылкой. Отсюда же требование к разбору —
 * он обязан переживать любой мусор в параметрах: ссылку правят руками.
 *
 * Отбор турниров тоже здесь: данных у календаря нет на сервере, они целиком в браузере, и
 * фильтрация — обычная работа со списком, а не запрос. Модуль чистый (без React), он же покрыт
 * юнит-тестами.
 */
import type { CalendarEvent } from './data.ts';
import { addDays, monthGridBounds, parseDate } from './month-layout.ts';

/** Виды календаря: лента недель (как на портале — главный), сетка месяца, плотный список. */
export type ViewMode = 'ribbon' | 'month' | 'list';
/** Период для списка: будущие, прошедшие или весь календарь целиком. */
export type Period = 'future' | 'past' | 'all';
export type BeginnerFilter = 'all' | 'only' | 'hide';

export type CalendarFilters = {
  view: ViewMode;
  /** 'YYYY-MM' — показываемый месяц (для вида «месяц»). */
  month: string;
  period: Period;
  /**
   * Коды оружия: null — «все» (фильтр ничего не отсекает), пустой список — «ничего не
   * выбрано» (как в портале: сняв галочку «Все», человек видит пустой календарь, а не весь).
   */
  weapons: string[] | null;
  /** Названия макрорегионов, та же тройка состояний. */
  regions: string[] | null;
  /** Название города, а не номер: номер зависел бы от порядка сборки справочника, и
   *  сохранённая ссылка после обновления данных показывала бы другой город. */
  city: string | null;
  team: boolean;
  /** Как в портале: показывать все, только новичковые или скрыть их. */
  beginner: BeginnerFilter;
  q: string;
};

/** Значения, которые в адрес не пишутся: по умолчанию ссылка на календарь — просто «/». */
const DEFAULT_VIEW: ViewMode = 'ribbon';
const DEFAULT_PERIOD: Period = 'future';

export type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/**
 * Список через запятую: пустые куски и дубли выбрасываем, порядок сохраняем. Параметра нет —
 * null («все»); одинокий дефис — пустой выбор («ничего»).
 */
function list(value: string | string[] | undefined): string[] | null {
  const raw = Array.isArray(value) ? value.join(',') : (value ?? '');
  if (!raw.trim()) return null;
  if (raw.trim() === '-') return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const item = part.trim();
    if (item) seen.add(item);
  }
  return seen.size ? [...seen] : null;
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
  const { year, month } = parseMonthKey(first(params.month), today);

  return {
    view: first(params.view) === 'list' ? 'list' : first(params.view) === 'month' ? 'month' : DEFAULT_VIEW,
    month: monthKey(year, month),
    period: periodRaw === 'past' || periodRaw === 'all' ? periodRaw : DEFAULT_PERIOD,
    weapons: list(params.weapons),
    regions: list(params.regions),
    city: first(params.city).trim() || null,
    team: first(params.team) === '1',
    beginner: first(params.beginner) === 'only' ? 'only' : first(params.beginner) === 'hide' ? 'hide' : 'all',
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
  if (filters.view !== 'list' && filters.month !== monthKey(now.year, now.month)) params.set('month', filters.month);
  if (filters.view === 'list' && filters.period !== DEFAULT_PERIOD) params.set('period', filters.period);
  if (filters.weapons) params.set('weapons', filters.weapons.join(',') || '-');
  if (filters.regions) params.set('regions', filters.regions.join(',') || '-');
  if (filters.city) params.set('city', filters.city);
  if (filters.team) params.set('team', '1');
  if (filters.beginner !== 'all') params.set('beginner', filters.beginner);
  if (filters.q) params.set('q', filters.q);

  const search = params.toString();
  return search ? `?${search}` : '';
}

/** Есть ли хоть один фильтр по существу (вид, месяц и период фильтрами не считаются). */
export function hasActiveFilters(filters: CalendarFilters): boolean {
  return filters.weapons !== null || filters.regions !== null || filters.city !== null
    || filters.team || filters.beginner !== 'all' || filters.q.length > 0;
}

/** Границы показываемого отрезка: сетка месяца грузит и хвосты соседних месяцев, иначе
 *  многодневный турнир с 30 октября не нарисуется в первой строке ноября. */
export function visibleRange(filters: CalendarFilters, today: string): { from: string | null; to: string | null } {
  // Лента листается в браузере (сколько недель показано — состояние экрана), поэтому отрезок
  // для неё считает сама страница: здесь границ нет.
  if (filters.view === 'ribbon') return { from: null, to: null };
  if (filters.view === 'month') {
    const { year, month } = parseMonthKey(filters.month, today);
    const { firstWeek, lastWeek } = monthGridBounds(year, month);
    return { from: firstWeek, to: addDays(lastWeek, 6) };
  }
  if (filters.period === 'future') return { from: today, to: null };
  // «Прошедшие» — то, что ЗАКОНЧИЛОСЬ раньше сегодня: турнир, который идёт прямо сейчас,
  // прошедшим называть нельзя.
  if (filters.period === 'past') return { from: null, to: today };
  return { from: null, to: null };
}

const fold = (value: string) => value.toLowerCase().replace(/ё/g, 'е');

/**
 * Отбор турниров по фильтрам. Раньше это делал SQL на сервере; правила сохранены один в один,
 * включая главное: даты сравниваются ПЕРЕСЕЧЕНИЕМ с отрезком, а не попаданием начала в него —
 * турнир, который идёт через границу месяца, обязан быть виден в обоих.
 */
export function selectEvents(
  events: readonly CalendarEvent[],
  filters: CalendarFilters,
  today: string,
): CalendarEvent[] {
  const { from, to } = visibleRange(filters, today);
  const needle = fold(filters.q);
  const weapons = filters.weapons === null ? null : new Set(filters.weapons);
  const regions = filters.regions === null ? null : new Set(filters.regions);
  const city = filters.city ? fold(filters.city) : null;

  const selected = events.filter((event) => {
    if (from && event.endsAt < from) return false;
    if (to && event.startsAt > to) return false;
    // «Прошедшие» просеиваются по концу, а не по началу: иначе идущий сейчас турнир попадает
    // и в будущие, и в прошедшие сразу.
    if (filters.view === 'list' && filters.period === 'past' && event.endsAt >= today) return false;

    if (city && fold(event.city ?? '') !== city) return false;
    // Пустой выбор — это «ничего», а не «всё»: сняв галочку «Все», человек видит пустой
    // календарь, и это честнее, чем молча вернуть ему всё обратно.
    if (regions && !regions.has(event.macroRegion ?? '')) return false;
    if (weapons && !event.nominations.some((n) => n.weaponCode && weapons.has(n.weaponCode))) return false;
    if (filters.team && !event.nominations.some((n) => n.isTeam)) return false;
    if (filters.beginner === 'only' && !event.nominations.some((n) => n.isBeginnerFriendly)) return false;
    // «Скрыть новичковые» убирает турниры, где новичковые номинации ЕСТЬ: так в портале —
    // опытному бойцу не нужен турнир, собранный под новичков.
    if (filters.beginner === 'hide' && event.nominations.some((n) => n.isBeginnerFriendly)) return false;
    if (needle) {
      const haystack = `${event.title} ${event.organizerName ?? ''}`;
      if (!fold(haystack).includes(needle)) return false;
    }
    return true;
  });

  // Прошедшее читают от свежего к старому: 2020 год в начале списка никому не нужен.
  if (filters.view === 'list' && filters.period === 'past') return selected.reverse();
  return selected;
}
