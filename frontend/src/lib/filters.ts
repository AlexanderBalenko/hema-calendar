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
import type { CalendarEvent, Nomination } from './data.ts';
import { KIND_LABEL } from './kinds.ts';
import { addDays, monthGridBounds, parseDate } from './month-layout.ts';

/** Виды календаря: лента недель (как на портале — главный), сетка месяца, плотный список. */
export type ViewMode = 'ribbon' | 'month' | 'list';
/** Период для списка: будущие, прошедшие или весь календарь целиком. */
export type Period = 'future' | 'past' | 'all';
export type BeginnerFilter = 'all' | 'only' | 'hide';
/** Пол участника в фильтре. В портале он берётся из профиля; у нас аккаунтов нет — только ввод. */
export type ViewerGender = 'male' | 'female';

export type CalendarFilters = {
  view: ViewMode;
  /** 'YYYY-MM' — показываемый месяц (для вида «месяц»). */
  month: string;
  period: Period;
  /**
   * Типы мероприятий, та же тройка состояний. Отдельный фильтр, а не вкладка: искать, куда
   * поехать выступать, и искать, чему поучиться, — разные задачи, и показывать их вперемешку
   * без возможности разделить значит не решить ни одну.
   */
  kinds: string[] | null;
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
  /**
   * Возраст участника — отсекает номинации не по годам. В портале он берётся из даты рождения и
   * считается НА ДАТУ КАЖДОГО ТУРНИРА (между мартом и декабрём человек успевает стать старше);
   * у нас профиля нет, возраст вводится руками и потому одинаков для всего окна.
   */
  age: number | null;
  /** Пол участника; null — «любой», фильтр по полу не сужает выдачу. */
  gender: ViewerGender | null;
  /**
   * Считать ли смешанные номинации подходящими. Единственный тумблер, включённый по умолчанию:
   * для одних смешанная номинация — шанс побиться с сильными, для других она просто опасна.
   */
  mixed: boolean;
  /**
   * Глазик «неподходящие»: показывать турниры, не прошедшие фильтр, неактивными — вместо того
   * чтобы их скрывать. По умолчанию выключен, и это решение портала, проверенное на заказчике:
   * при «показывать» эффект фильтров не считывался — человек щёлкал чипы и не видел изменений.
   */
  showUnsuitable: boolean;
  /**
   * Сколько недель показано в ленте. Живёт в адресе, а не в памяти компонента: иначе «Показать
   * ещё» забывалось, стоило зайти в турнир и вернуться назад, — и ленту приходилось расхлопывать
   * заново (замечание заказчика 06.11.2026).
   */
  weeks: number;
  /**
   * Сколько недель показано ПЕРЕД началом выбранного месяца. Лента листается в обе стороны, и
   * прошлое — это рост влево от той же точки отсчёта (`month`), а не смена месяца: иначе
   * подгрузка вверх переставляла бы полоску месяцев под рукой.
   */
  back: number;
};

/** Недель в ленте сразу и шаг кнопки «Показать ещё». */
export const RIBBON_WEEKS = 12;
export const RIBBON_STEP = 8;
/** Предел роста окна: 10 лет недель — защита от `?weeks=100000` в правленой руками ссылке. */
export const MAX_RIBBON_WEEKS = 520;

/** Значения, которые в адрес не пишутся: по умолчанию ссылка на календарь — просто «/». */
const DEFAULT_VIEW: ViewMode = 'ribbon';
const DEFAULT_PERIOD: Period = 'future';

export type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/**
 * Список через запятую: пустые куски и дубли выбрасываем, порядок сохраняем. Параметра нет —
 * null («все»); `none` — пустой выбор («ничего»).
 *
 * Слово `none`, а не дефис, — как в портале («честный пустой мультиселект», `docs/slices/Events.md`
 * §3.5): «снято всё» и «параметр не отправлен» обязаны отличаться, и в чужой ссылке `weapons=none`
 * читается, а `weapons=-` выглядит опечаткой. Дефис из прежних ссылок понимаем по-прежнему.
 */
function list(value: string | string[] | undefined): string[] | null {
  const raw = Array.isArray(value) ? value.join(',') : (value ?? '');
  if (!raw.trim()) return null;
  if (raw.trim() === 'none' || raw.trim() === '-') return [];
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
    kinds: list(params.kinds),
    weapons: list(params.weapons),
    regions: list(params.regions),
    city: first(params.city).trim() || null,
    team: first(params.team) === '1',
    beginner: first(params.beginner) === 'only' ? 'only' : first(params.beginner) === 'hide' ? 'hide' : 'all',
    q: first(params.q).trim().slice(0, 100),
    age: parseAge(first(params.age)),
    gender: parseGender(first(params.gender)),
    // Смешанные подходят, пока их явно не выключили: умолчание пишется в адрес как `mixed=0`,
    // поэтому отсутствие параметра — это «да».
    mixed: first(params.mixed) !== '0',
    showUnsuitable: first(params.showUnsuitable) === '1',
    weeks: parseWeeks(first(params.weeks)),
    back: parseBack(first(params.back)),
  };
}

function parseWeeks(raw: string): number {
  const weeks = Number(raw.trim());
  if (!Number.isInteger(weeks) || weeks < RIBBON_WEEKS) return RIBBON_WEEKS;
  return Math.min(weeks, MAX_RIBBON_WEEKS);
}

function parseBack(raw: string): number {
  const back = Number(raw.trim());
  if (!Number.isInteger(back) || back < 0) return 0;
  return Math.min(back, MAX_RIBBON_WEEKS);
}

/** Возраст из адреса: 1–120, всё остальное (в том числе «0» и «abc») — «не указан». */
function parseAge(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  const age = Number(text);
  return age >= 1 && age <= 120 ? age : null;
}

function parseGender(raw: string): ViewerGender | null {
  const text = raw.trim().toLowerCase();
  return text === 'male' ? 'male' : text === 'female' ? 'female' : null;
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
  if (filters.kinds) params.set('kinds', filters.kinds.join(',') || 'none');
  if (filters.weapons) params.set('weapons', filters.weapons.join(',') || 'none');
  if (filters.regions) params.set('regions', filters.regions.join(',') || 'none');
  if (filters.city) params.set('city', filters.city);
  if (filters.team) params.set('team', '1');
  if (filters.beginner !== 'all') params.set('beginner', filters.beginner);
  if (filters.q) params.set('q', filters.q);
  if (filters.age !== null) params.set('age', String(filters.age));
  if (filters.gender) params.set('gender', filters.gender);
  if (!filters.mixed) params.set('mixed', '0');
  if (filters.showUnsuitable) params.set('showUnsuitable', '1');
  // Развёрнутая лента остаётся в адресе — и в ссылке, которой делятся, тоже: она про то, что
  // человек сейчас видит.
  if (filters.view === 'ribbon' && filters.weeks !== RIBBON_WEEKS) params.set('weeks', String(filters.weeks));
  // `back` пишется и для списка: подтянутое прошлое — часть того, что человек видит, и ссылкой
  // этим делятся так же, как развёрнутой лентой.
  if (filters.back > 0 && (filters.view === 'ribbon'
    || (filters.view === 'list' && filters.period === 'future'))) {
    params.set('back', String(filters.back));
  }

  const search = params.toString();
  return search ? `?${search}` : '';
}

/** Есть ли хоть один фильтр по существу (вид, месяц, период и глазик фильтрами не считаются). */
export function hasActiveFilters(filters: CalendarFilters): boolean {
  return filters.kinds !== null || filters.weapons !== null || filters.regions !== null
    || filters.city !== null || filters.team || filters.beginner !== 'all' || filters.q.length > 0
    || hasPersonalFilters(filters);
}

/**
 * Критерии участника заданы руками. Нужны строке фильтров: в свёрнутом аккордеоне этих контролов
 * не видно, и без точки-индикатора у стрелки их влияние на выдачу выглядело бы необъяснимым.
 */
export function hasPersonalFilters(filters: CalendarFilters): boolean {
  return filters.age !== null || filters.gender !== null || !filters.mixed;
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
  // Список листается в прошлое так же, как лента (решение заказчика 08.11.2026): `back` — это
  // сколько недель прошлого человек уже подтянул прокруткой вверх. Ноль — только будущее, как
  // и было; переключатель периода при этом никуда не делся и по-прежнему даёт «только
  // прошедшие» одним движением.
  if (filters.period === 'future') {
    return { from: filters.back > 0 ? addDays(today, -filters.back * 7) : today, to: null };
  }
  // «Прошедшие» — то, что ЗАКОНЧИЛОСЬ раньше сегодня: турнир, который идёт прямо сейчас,
  // прошедшим называть нельзя.
  if (filters.period === 'past') return { from: null, to: today };
  return { from: null, to: null };
}

const fold = (value: string) => value.toLowerCase().replace(/ё/g, 'е');

/**
 * Номинация без указанного нижнего возраста — взрослая, 18+. Так в портале: `MinAge` там поле
 * ОБЯЗАТЕЛЬНОЕ со значением по умолчанию 18 (`docs/slices/Events.md` §2), то есть состояния
 * «возраст не указан» в природе нет — есть «обычный взрослый турнир». Для нас это не мелочь:
 * из 2024 номинаций календаря возраст проставлен у 210, и считать остальные «подходящими кому
 * угодно» означало бы звать двенадцатилетнего на взрослый турнир.
 *
 * Обратная сторона: `max_age` без `min_age` стал бы пустым диапазоном (18…17), поэтому такую
 * пару `scripts/validate_data.py` не пропускает.
 */
export const DEFAULT_MIN_AGE = 18;

/** Результат проверки «подходит ли турнир»: причина нужна, только когда не подходит. */
export type Suitability = { suitable: boolean; reason: string | null };

const SUITABLE: Suitability = { suitable: true, reason: null };
const unfit = (reason: string): Suitability => ({ suitable: false, reason });

/**
 * Подходит ли турнир под фильтр — порт чистой функции портала `CalendarSuitability.Evaluate`
 * (backend/.../Events/CalendarSuitability.cs), включая формулировки причин. Главное правило:
 * **пересечение на уровне номинации** — турнир подходит, если есть ХОТЯ БЫ ОДНА номинация,
 * подходящая по оружию, возрасту и полу СРАЗУ. Канонический пример из спеки: турнир со смешанной
 * рапирой 16+ и мужским длинным мечом 18+ проходит фильтр «рапира + сабля» и для парня 17, и для
 * девушки 19, но фильтр «сабля + длинный меч» не проходит ни для кого — потому что единственная
 * подходящая по оружию номинация им не по возрасту и не по полу.
 *
 * Причина возвращается словами и сужающимся каскадом (оружие → пол → возраст): слитое «возраст,
 * пол или оружие» не подсказывает, что поменять в фильтре. Каскад, а не три независимые проверки:
 * «нет номинаций вашего пола» осмысленно ровно про те номинации, что прошли фильтр оружия.
 */
export function evaluateSuitability(event: CalendarEvent, filters: CalendarFilters): Suitability {
  // Тип — свойство самого события, как и регион: проверяется до номинационных критериев и
  // действует на событие без номинаций тоже.
  if (filters.kinds) {
    if (filters.kinds.length === 0) return unfit('тип не выбран');
    if (!filters.kinds.includes(event.kind)) return unfit(`не тот тип: ${KIND_LABEL[event.kind]}`);
  }

  // Регион — свойство турнира, а не номинации, поэтому проверяется до всего остального и
  // действует даже на турнир без номинаций.
  if (filters.regions) {
    if (filters.regions.length === 0) return unfit('регион не выбран');
    // Онлайн проходит ЛЮБОЙ фильтр по региону: он равно доступен откуда угодно. Это то же
    // правило, что у события без заявленного оружия ниже, — «не привязано» значит «подходит
    // всем», а не «не подходит никому».
    if (!event.online) {
      if (!event.macroRegion) return unfit('не указан регион');
      if (!filters.regions.includes(event.macroRegion)) return unfit(`не ваш регион: ${event.macroRegion}`);
    }
  }

  // Дисциплины, заявленные списком. Оружие события — объединение этого списка и номинаций
  // (`docs/EventTypes.md` §4): у турнира список пуст по модели и проверка его не касается, а у
  // феста или лагеря без турнира внутри номинаций нет, и список — единственное, что о его
  // оружии известно. Без этой проверки вышло бы наоборот: чем лучше заполнен фест, тем хуже он
  // фильтруется — ведь номинаций у него нет, и он проскакивал бы любой фильтр по оружию.
  const declared = event.weapons ?? [];
  if (filters.weapons && declared.length > 0) {
    const chosen = filters.weapons;
    const inNominations = event.nominations.some(
      (n) => n.weaponCode !== null && chosen.includes(n.weaponCode));
    if (!declared.some((w) => chosen.includes(w.code)) && !inNominations) {
      return unfit('нет выбранного оружия');
    }
  }

  // Событие без номинаций (лекция, лагерь без программы, анонс без сетки) проходит ВСЕ
  // номинационные критерии — и оружие, и личные, и тумблеры. Так в портале: прятать по оружию
  // то, у чего оружия не заявлено вовсе, значит вычёркивать такие события из календаря для всех,
  // кто хоть раз тронул фильтр. (Словесная спека §3.5 утверждает обратное — расхождение в её
  // пользу считаю опечаткой: код портала и его тесты говорят это.) Заявленный список оружия
  // этой поблажки больше не получает: его проверили выше.
  if (event.nominations.length === 0) return SUITABLE;

  const weapons = filters.weapons;
  const matchesWeapon = (n: Nomination) =>
    weapons === null || (n.weaponCode !== null && weapons.includes(n.weaponCode));
  const matchesAge = (n: Nomination) => filters.age === null
    || (filters.age >= (n.minAge ?? DEFAULT_MIN_AGE) && (n.maxAge === null || filters.age <= n.maxAge));
  // Тумблер «смешанные» — часть проверки пола: кто не хочет биться в смешанной номинации, тому
  // смешанная номинация не подходит ровно так же, как мужская — женщине. Работает и когда пол не
  // указан: это выбор фильтра, а не свойство человека.
  const matchesGender = (n: Nomination) => (filters.mixed || n.gender !== 'Any')
    && (filters.gender === null || n.gender === 'Any'
      || (n.gender === 'Male' && filters.gender === 'male')
      || (n.gender === 'Female' && filters.gender === 'female'));

  if (!event.nominations.some((n) => matchesWeapon(n) && matchesAge(n) && matchesGender(n))) {
    const byWeapon = event.nominations.filter(matchesWeapon);
    if (byWeapon.length === 0) return unfit('нет выбранного оружия');
    const byGender = byWeapon.filter(matchesGender);
    if (byGender.length === 0) {
      return !filters.mixed && byWeapon.every((n) => n.gender === 'Any')
        ? unfit('только смешанные номинации')
        : unfit('нет номинаций вашего пола');
    }
    if (!byGender.some(matchesAge)) return unfit('возраст не попадает в номинации');
    // Сюда не попасть: иначе номинация подошла бы целиком. Страховка, чтобы при правке условий
    // выше осталась хоть какая-то причина вместо пустой.
    return unfit('нет подходящей номинации');
  }

  // Тумблеры «командные» и «новички» — существование номинации с флагом, ОТДЕЛЬНО от пересечения
  // по личным критериям выше: иначе взрослый турнир с одной новичковой номинацией не по твоему
  // оружию скрылся бы как «целиком новичковый».
  if (filters.team && !event.nominations.some((n) => n.isTeam)) return unfit('нет командной номинации');
  if (filters.beginner === 'only' && !event.nominations.some((n) => n.isBeginnerFriendly)) {
    return unfit('нет номинации для начинающих');
  }
  if (filters.beginner === 'hide' && event.nominations.every((n) => n.isBeginnerFriendly)) {
    return unfit('только новичковая программа');
  }

  return SUITABLE;
}

/** Турнир с приговором фильтра: неподходящие остаются в выдаче, когда включён глазик. */
export type SelectedEvent = CalendarEvent & { isSuitable: boolean; unsuitableReason: string | null };

/**
 * Отбор турниров по фильтрам. Раньше это делал SQL на сервере; правила сохранены один в один,
 * включая главное: даты сравниваются ПЕРЕСЕЧЕНИЕМ с отрезком, а не попаданием начала в него —
 * турнир, который идёт через границу месяца, обязан быть виден в обоих.
 *
 * Два разных вида отсева, и путать их нельзя. Отрезок дат, город и поиск по тексту **скрывают**:
 * турнир не в том месяце или не в том городе показывать незачем. Критерии участника (оружие,
 * регион, возраст, пол, смешанные, командные, новички) решают **пригодность**: не подошедший
 * турнир скрывается только при выключенном глазике, иначе остаётся в сетке неактивным и с
 * причиной — «почему мне это не подходит» человеку полезнее, чем молча опустевший календарь.
 */
export function selectEvents(
  events: readonly CalendarEvent[],
  filters: CalendarFilters,
  today: string,
): SelectedEvent[] {
  const { from, to } = visibleRange(filters, today);
  const needle = fold(filters.q);
  const city = filters.city ? fold(filters.city) : null;

  const selected: SelectedEvent[] = [];
  for (const event of events) {
    if (from && event.endsAt < from) continue;
    if (to && event.startsAt > to) continue;
    // «Прошедшие» просеиваются по концу, а не по началу: иначе идущий сейчас турнир попадает
    // и в будущие, и в прошедшие сразу.
    if (filters.view === 'list' && filters.period === 'past' && event.endsAt >= today) continue;

    if (city && fold(event.city ?? '') !== city) continue;
    if (needle) {
      const haystack = `${event.title} ${event.organizerName ?? ''} ${(event.coOrganizers ?? []).join(' ')}`;
      if (!fold(haystack).includes(needle)) continue;
    }

    const { suitable, reason } = evaluateSuitability(event, filters);
    if (!suitable && !filters.showUnsuitable) continue;
    selected.push({ ...event, isSuitable: suitable, unsuitableReason: reason });
  }

  // Прошедшее читают от свежего к старому: 2020 год в начале списка никому не нужен.
  if (filters.view === 'list' && filters.period === 'past') return selected.reverse();
  return selected;
}
