/**
 * Раскладка сетки месяца: чистая функция без DOM и React — на вход месяц и события, на выход
 * готовая геометрия (ячейки дней, сегменты событий, ярусы). Компонент только рисует результат.
 *
 * Перенесено из портала (frontend/src/slices/events/lib/calendar-layout.ts), оставлена ТОЛЬКО
 * сетка месяца. Лента недель с барами над уикендом, нитями будничных событий и аннексированным
 * понедельником — отдельная механика портала, где у события есть «подходит мне» и отметка
 * «пойду»; календарю без залогиненного человека она не нужна, и тащить её сюда значило бы
 * перенести самый сложный код ради вида, которого в сервисе нет.
 *
 * Даты внутри — строки 'YYYY-MM-DD' (лексикографическое сравнение = хронологическое) и целые
 * «дневные номера». Date не используется ни для арифметики, ни для сравнений: иначе часовой пояс
 * незаметно сдвигает событие на сутки на границе месяца.
 */

export type LayoutEvent = {
  /** Устойчивый опознаватель: у календаря это слаг, он же имя файла и адрес страницы. */
  slug: string;
  /** Дата или ISO datetime — используется только календарный день. */
  startsAt: string;
  endsAt: string;
};

// ---------------------------------------------------------------------------
// Дата как строка + «дневной номер» (дни от 1970-01-01), без Date и часовых поясов.
// ---------------------------------------------------------------------------

export function parseDate(value: string): { year: number; month: number; day: number } {
  const iso = value.slice(0, 10);
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) - 1, day: Number(iso.slice(8, 10)) };
}

/** Номер дня (proleptic Gregorian, дни от эпохи) — чистая арифметика, без Date. */
export function dayNumber(value: string): number {
  const { year, month, day } = parseDate(value);
  return toDayNumber(year, month, day);
}

function toDayNumber(year: number, month: number, day: number): number {
  // Алгоритм Хауарда Хиннанта (days_from_civil).
  const y = month <= 1 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const m = month + 1;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromDayNumber(n: number): string {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 2 : mp - 10;
  const year = m <= 1 ? y + 1 : y;
  return `${String(year).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 0 = понедельник … 6 = воскресенье. */
export function weekdayIndex(value: string): number {
  // 1970-01-01 — четверг (индекс 3).
  return (((dayNumber(value) + 3) % 7) + 7) % 7;
}

/** Понедельник недели, в которую попадает дата. */
export function startOfWeek(value: string): string {
  return fromDayNumber(dayNumber(value) - weekdayIndex(value));
}

export function addDays(value: string, days: number): string {
  return fromDayNumber(dayNumber(value) + days);
}

/** Прошедшее событие: дата окончания раньше сегодняшней — сравнение по дневным номерам. */
/**
 * Стиль тела плашки турнира — матрица портала (§3.6), четыре комбинации isSuitable × isPast:
 *  - `unsuitable` — не подходит под фильтр, будущее: тело гаснет в цвет карточки, текст блёклый;
 *  - `pastUnsuitable` — не подходит И прошло: та же светлота, но без цветности;
 *  - `past` — подходит, но прошло: обесцвеченный графит, текст читаемый;
 *  - `normal` — подходит и не прошло: полный цвет.
 *
 * Чистая функция, а не порядок условий в компонентах: четыре случая кодируются явно, и их нельзя
 * перепутать, правя один из трёх видов. «Не подходит» главнее «прошло» — фильтр человек задал
 * сам, и ответ на него важнее времени.
 */
export type EventBodyStyle = 'unsuitable' | 'pastUnsuitable' | 'past' | 'normal';

export function eventBodyStyle(isSuitable: boolean, isPast: boolean): EventBodyStyle {
  if (!isSuitable) return isPast ? 'pastUnsuitable' : 'unsuitable';
  return isPast ? 'past' : 'normal';
}

export function isPastEvent(endsAt: string, todayIso: string): boolean {
  return dayNumber(endsAt) < dayNumber(todayIso);
}

/** Месяцы в родительном падеже — «3 ноября», а не «3 ноябрь». */
export const MONTH_LABELS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
] as const;

/** Месяцы в именительном — заголовок сетки «Ноябрь 2026». */
export const MONTH_TITLES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
] as const;

/**
 * Человеческая подпись диапазона: «3 ноября», «3–5 ноября», «29 ноября — 2 декабря».
 * Год по умолчанию не пишется — в сетке месяца и в списке с разделителями месяцев он и так
 * известен, а на странице турнира (куда приходят из поиска) нужен: `withYear`.
 *
 * `short` обрезает месяц до трёх букв («3 ноя») — просьба заказчика 11.11.2026 для вида списком
 * на телефоне: полный месяц держал под дату колонку в 112px из 343, и название турнира резалось
 * у каждой третьей строки. Обрезка ровно такая же, как у чисел в ленте (MONTH_LABELS.slice(0, 3)),
 * чтобы два вида одного календаря не сокращали месяц по-разному.
 */
export function formatDateRange(startsAt: string, endsAt: string, withYear = false, short = false): string {
  const from = parseDate(startsAt);
  const to = parseDate(endsAt);
  const month = (index: number) => (short ? MONTH_LABELS[index].slice(0, 3) : MONTH_LABELS[index]);
  const year = withYear ? ` ${to.year}` : '';
  if (from.year === to.year && from.month === to.month && from.day === to.day) {
    return `${from.day} ${month(from.month)}${year}`;
  }
  if (from.year === to.year && from.month === to.month) {
    return `${from.day}–${to.day} ${month(from.month)}${year}`;
  }
  // Разные годы — год у конца показываем всегда, иначе «29 декабря — 2 января» читается как
  // один год.
  const tail = from.year === to.year ? year : ` ${to.year}`;
  return `${from.day} ${month(from.month)}${from.year === to.year ? '' : ` ${from.year}`} — ${to.day} ${month(to.month)}${tail}`;
}

// ---------------------------------------------------------------------------
// Вид «Месяц»: сетка 7×N
// ---------------------------------------------------------------------------

type Classified<T extends LayoutEvent> = {
  event: T;
  start: number;
  end: number;
  /** Колонка первого/последнего дня события внутри недели (0..6). */
  firstColumn: number;
  lastColumn: number;
};

/** Стабильный тай-брейк: при полностью совпадающих датах порядок не должен зависеть от входа. */
function byId<T extends LayoutEvent>(a: Classified<T>, b: Classified<T>): number {
  return a.event.slug < b.event.slug ? -1 : a.event.slug > b.event.slug ? 1 : 0;
}

/**
 * Раньше начинается — выше; при равном начале КОРОЧЕ — выше, чтобы под коротким сегментом
 * осталось окошко с датой дня.
 */
function compareBars<T extends LayoutEvent>(a: Classified<T>, b: Classified<T>): number {
  return a.start - b.start || a.end - b.end || byId(a, b);
}

export type MonthDayCell = {
  /** 'YYYY-MM-DD'. */
  date: string;
  day: number;
  month: number;
  year: number;
  /** 0..6 — пн..вс, колонка в сетке месяца. */
  column: number;
  /** Число принадлежит показываемому месяцу (а не хвосту соседнего). */
  isCurrentMonth: boolean;
  isWeekend: boolean;
  /** День строго раньше `today` — прошедшие дни приглушаются. */
  isPast: boolean;
  isToday: boolean;
};

export type MonthSegment<T extends LayoutEvent = LayoutEvent> = {
  event: T;
  lane: number;
  /** Включительные границы колонок 0..6 в пределах ЭТОЙ строки-недели. */
  startColumn: number;
  endColumn: number;
  continuesLeft: boolean;
  continuesRight: boolean;
};

export type MonthWeekLayout<T extends LayoutEvent = LayoutEvent> = {
  weekStart: string;
  days: MonthDayCell[];
  segments: MonthSegment<T>[];
  laneCount: number;
};

/**
 * Первый и последний понедельник сетки месяца (первый может лежать в предыдущем месяце).
 * 42 дня (6 недель) сверху не режем и не добиваем: считаем ровно столько недель, сколько нужно
 * месяцу — обычно 5, иногда 6, а февраль, начавшийся с понедельника, укладывается в 4.
 */
export function monthGridBounds(year: number, month: number): { firstWeek: string; lastWeek: string } {
  const firstOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDayNum = month === 11
    ? dayNumber(`${year + 1}-01-01`) - 1
    : dayNumber(`${year}-${String(month + 2).padStart(2, '0')}-01`) - 1;
  return { firstWeek: startOfWeek(firstOfMonth), lastWeek: startOfWeek(fromDayNumber(lastDayNum)) };
}

/**
 * Раскладка месяца по неделям. Любое событие — полоса-сегмент через ячейки одной недели;
 * многодневное режется по границам недели на отдельные сегменты со своими `continuesLeft/Right`,
 * поэтому событие никогда не «высовывается» за строку (грабли портала: бар, уехавший вправо за
 * границу сетки, и его продолжение, начинавшееся со вторника).
 *
 * Ярусов без лимита: строка недели растёт по числу ярусов. Лимит «+ ещё N» в портале выпилили —
 * высота месяца и так гуляет, а спрятанное событие пользователь не находит.
 */
export function layoutMonth<T extends LayoutEvent>(
  year: number,
  month: number,
  events: readonly T[],
  today?: string,
): MonthWeekLayout<T>[] {
  const { firstWeek, lastWeek } = monthGridBounds(year, month);
  const first = dayNumber(firstWeek);
  const last = dayNumber(lastWeek);

  const weeks: MonthWeekLayout<T>[] = [];
  for (let n = first; n <= last; n += 7) {
    const monday = n;
    const sunday = n + 6;

    const days: MonthDayCell[] = [];
    for (let i = 0; i < 7; i++) {
      const date = fromDayNumber(monday + i);
      const { year: dy, month: dm, day: dd } = parseDate(date);
      days.push({
        date,
        day: dd,
        month: dm,
        year: dy,
        column: i,
        isCurrentMonth: dy === year && dm === month,
        isWeekend: i >= 5,
        isPast: !!today && date < today,
        isToday: date === today,
      });
    }

    const touching: Classified<T>[] = [];
    for (const event of events) {
      const start = dayNumber(event.startsAt);
      const end = Math.max(start, dayNumber(event.endsAt));
      if (end < monday || start > sunday) continue;
      touching.push({
        event,
        start,
        end,
        firstColumn: Math.max(0, start - monday),
        lastColumn: Math.min(6, end - monday),
      });
    }
    touching.sort(compareBars);

    const segments: MonthSegment<T>[] = [];
    const laneEnds: number[] = [];
    for (const item of touching) {
      let lane = laneEnds.findIndex((end) => end < item.firstColumn);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = item.lastColumn;
      segments.push({
        event: item.event,
        lane,
        startColumn: item.firstColumn,
        endColumn: item.lastColumn,
        continuesLeft: item.start < monday,
        continuesRight: item.end > sunday,
      });
    }

    weeks.push({
      weekStart: fromDayNumber(monday),
      days,
      segments,
      laneCount: segments.reduce((max, s) => Math.max(max, s.lane + 1), 0),
    });
  }

  return weeks;
}

/** Сегодня по локальной дате клиента (не UTC: иначе вечером 3-го подсвечивается 4-е). */
export function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Сдвиг месяца на N вперёд/назад — без Date, чтобы декабрь не уезжал в прошлый год. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}


// ---------------------------------------------------------------------------
// Лента недель — перенос из портала (slices/events/lib/calendar-layout.ts).
// Бары над уикендом, нити будничных событий, аннексированный понедельник: главный вид
// календаря портала, и выглядеть он должен так же. Праздников здесь нет (их список живёт
// в портальном API), признака «подходит мне» тоже — календарь не знает, кто его читает.
// ---------------------------------------------------------------------------

/** Колонка недели: 0..4 — пн..пт (узкие), 5 — сб, 6 — вс (широкие), 7 — хвостовая (пн-хвост). */
export const TAIL_COLUMN = 7;

export type BarPlacement<T extends LayoutEvent = LayoutEvent> = {
  event: T;
  /** Ярус (0 — верхний). */
  lane: number;
  /** Включительные границы колонок 0..7. */
  startColumn: number;
  endColumn: number;
  /** Событие началось раньше этой недели / кончается позже — рисуем «обрезанный» край. */
  continuesLeft: boolean;
  continuesRight: boolean;
};

/**
 * Нить-продолжение: событие нарисовано баром в ЭТОЙ строке, а в следующей продолжается нитью.
 * Рисуется тонкой линией по нижней кромке своих дней — тем же цветом, что нить следующей строки,
 * чтобы два сегмента читались как одно событие (решение заказчика 27.10.2026).
 */
export type BarContinuation<T extends LayoutEvent = LayoutEvent> = {
  event: T;
  startColumn: number;
  endColumn: number;
  color: ThreadColor;
};

export type StripePlacement<T extends LayoutEvent = LayoutEvent> = {
  event: T;
  lane: number;
  continuesLeft: boolean;
  continuesRight: boolean;
};

export type ThreadPlacement<T extends LayoutEvent = LayoutEvent> = {
  event: T;
  /** Ярус сносок вниз (0 — ближайший к строке недели). */
  lane: number;
  /** Колонка первого дня события в этой неделе (0..4). */
  startColumn: number;
  /** Последний день события в этой неделе — нужен для градиента плашек. */
  endColumn: number;
  /** Цвет из палитры металлов по порядку; null — нить ушла в деградацию (см. overflowThreads). */
  color: ThreadColor | null;
};

/** Палитра нитей — металлы (спека §7). Больше четырёх будничных событий в неделе не бывает. */
export type ThreadColor = 'gold' | 'bronze' | 'silver' | 'steel';
export const THREAD_COLORS: ThreadColor[] = ['gold', 'bronze', 'silver', 'steel'];
export const MAX_THREAD_LANES = THREAD_COLORS.length;

export type DayCell = {
  /** 'YYYY-MM-DD'. */
  date: string;
  day: number;
  month: number;
  year: number;
  /** 0..6 — пн..вс. */
  column: number;
  isWeekend: boolean;
};

export type WeekLayout<T extends LayoutEvent = LayoutEvent> = {
  /** Понедельник недели, 'YYYY-MM-DD'. */
  weekStart: string;
  days: DayCell[];
  stripes: StripePlacement<T>[];
  bars: BarPlacement<T>[];
  threads: ThreadPlacement<T>[];
  /** Нити-продолжения баров этой строки (цвет берётся у нити следующей, см. layoutRange). */
  continuations: BarContinuation<T>[];
  /** Нити сверх четырёх — не падаем, показываем простым списком под неделей. */
  overflowThreads: T[];
  /** Сколько ярусов занято барами (для высоты строки). */
  laneCount: number;
  /** Сколько ярусов сносок. */
  threadLaneCount: number;
  /** Подпись разделителя месяца ПЕРЕД этой неделей: [year, monthIndex] или null. */
  monthDivider: { year: number; month: number } | null;
};

/**
 * Нити (чисто будничные события): раньше начинается — выше; при равном начале ПОЗЖЕ
 * ЗАКАНЧИВАЕТСЯ — выше. Правило заказчика прямо противоположно барному, поэтому компараторы
 * разведены явно.
 */
function compareThreads<T extends LayoutEvent>(a: Classified<T>, b: Classified<T>): number {
  return a.start - b.start || b.end - a.end || byId(a, b);
}

function buildDays(weekStart: string): DayCell[] {
  const base = dayNumber(weekStart);
  const days: DayCell[] = [];
  for (let i = 0; i < 7; i++) {
    const date = fromDayNumber(base + i);
    const { year, month, day } = parseDate(date);
    days.push({ date, day, month, year, column: i, isWeekend: i >= 5 });
  }
  return days;
}

/**
 * Раскладка одной недели. `events` — все события, чей интервал пересекается с этой неделей
 * (лишние молча отфильтровываются, так что можно передавать и весь список окна).
 */
export function layoutWeek<T extends LayoutEvent>(
  weekStart: string,
  events: readonly T[],
): WeekLayout<T> {
  const monday = dayNumber(weekStart);
  const sunday = monday + 6;
  const nextMonday = monday + 7;

  const touching: Classified<T>[] = [];
  for (const event of events) {
    const start = dayNumber(event.startsAt);
    const end = Math.max(start, dayNumber(event.endsAt));
    if (end < monday || start > sunday) continue;
    touching.push({
      event,
      start,
      end,
      firstColumn: Math.max(0, start - monday),
      lastColumn: Math.min(6, end - monday),
    });
  }

  // Порядок баров и полос (уикенд-события). Раньше начинается — выше; при РАВНОМ начале КОРОЧЕ —
  // выше (пересмотр 2026-08-05: короткое событие сверху освобождает окошко под собой, и в нём видна
  // дата дня; раньше наверх шло длинное и дата пряталась). Жадная упаковка ниже не меняется —
  // экономия строк остаётся приоритетом. Стабильный тай-брейк по id — для детерминированности.
  // ВНИМАНИЕ: у НИТЕЙ правило другое, см. compareThreads ниже — комбинировать их нельзя.
  touching.sort(compareBars);

  const stripes: StripePlacement<T>[] = [];
  const bars: BarPlacement<T>[] = [];
  const threadCandidates: Classified<T>[] = [];

  for (const item of touching) {
    const coversWholeWeek = item.start <= monday && item.end >= sunday;
    const isLongerThanWeek = item.end - item.start + 1 >= 7;
    const touchesWeekend = item.lastColumn >= 5;

    if (coversWholeWeek && isLongerThanWeek) {
      stripes.push({
        event: item.event,
        lane: stripes.length,
        continuesLeft: item.start < monday,
        continuesRight: item.end > sunday,
      });
      continue;
    }

    if (touchesWeekend) {
      // Аннексия понедельника-хвоста: он живёт в 8-й колонке ЭТОЙ строки, а не в следующей неделе —
      // но ТОЛЬКО когда остаток ровно один день. Решение заказчика 27.10.2026: при остатке в два дня
      // и больше бар вылезал за правый край строки, а следующая неделя дорисовывала его со вторника,
      // и событие читалось как два разных. Длинный остаток честнее показать с понедельника.
      const annexesTail = item.end === nextMonday;
      bars.push({
        event: item.event,
        lane: 0, // проставится упаковкой ниже
        startColumn: item.firstColumn,
        endColumn: annexesTail ? TAIL_COLUMN : item.lastColumn,
        continuesLeft: item.start < monday,
        continuesRight: !annexesTail && item.end > sunday,
      });
      continue;
    }

    // Чисто будничное событие. Отдельный случай — событие, которое закончилось ровно в этот
    // понедельник, а началось в прошлой неделе на её уикенде: прошлая строка показала этот
    // понедельник аннексированным хвостом в 8-й колонке, и второй раз рисовать его нельзя.
    // Остаток длиннее одного дня прошлая строка больше не аннексирует (см. ветку баров выше),
    // поэтому он рисуется обычной нитью С ПОНЕДЕЛЬНИКА.
    const startedInPreviousWeek = item.start < monday && item.start > monday - 7;
    if (startedInPreviousWeek && item.end === monday) continue;
    threadCandidates.push(item);
  }

  packLanes(bars);

  // Порядок НИТЕЙ — свои правила (фидбек заказчика 2026-08-05), не те же, что у баров:
  //   • начинаются в один день → выше та, что ЗАКАНЧИВАЕТСЯ ПОЗЖЕ (длиннее сверху);
  //   • заканчиваются в один день → выше та, что начинается раньше;
  //   • просто накладываются → выше та, что начинается раньше.
  // Все три сводятся к «start по возрастанию, при равном start — end по УБЫВАНИЮ».
  threadCandidates.sort(compareThreads);

  const threads: ThreadPlacement<T>[] = [];
  const overflowThreads: T[] = [];
  for (const item of threadCandidates) {
    const lane = threads.length;
    if (lane >= MAX_THREAD_LANES) {
      overflowThreads.push(item.event);
      continue;
    }
    threads.push({
      event: item.event,
      lane,
      startColumn: item.firstColumn,
      endColumn: item.lastColumn,
      color: THREAD_COLORS[lane],
    });
  }

  return {
    weekStart,
    days: buildDays(weekStart),
    stripes,
    bars,
    threads,
    // Заполняется в layoutRange: цвет нити назначает СЛЕДУЮЩАЯ неделя, одной строки для этого мало.
    continuations: [],
    overflowThreads,
    laneCount: bars.reduce((max, bar) => Math.max(max, bar.lane + 1), 0),
    threadLaneCount: threads.length,
    monthDivider: null,
  };
}

/** Жадная упаковка ярусов как в Ганте: каждый бар — в самый верхний ярус без пересечения по дням. */
function packLanes<T extends LayoutEvent>(bars: BarPlacement<T>[]): void {
  const laneEnds: number[] = []; // последняя занятая колонка каждого яруса
  for (const bar of bars) {
    let lane = laneEnds.findIndex((end) => end < bar.startColumn);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(bar.endColumn);
    } else {
      laneEnds[lane] = bar.endColumn;
    }
    bar.lane = lane;
  }
}

/**
 * Лента недель от `from` до `to` (границы нормализуются к целым неделям).
 *
 * Границы месяцев НЕ режут недели: неделя остаётся целой, разделитель ставится МЕЖДУ строками.
 * Правило выбора строки (пересмотр 2026-08-05, решение заказчика «мне больше нравится, когда
 * 1 число месяца приходится на свой месяц»): разделитель — перед неделей, СОДЕРЖАЩЕЙ 1-е число
 * месяца, то есть переходная неделя уходит в новый месяц. Раньше это была первая целиком новая
 * неделя, и 1-е число оказывалось под заголовком предыдущего месяца.
 *
 * Исключение — самая первая строка окна: если 1-го числа в ней нет, она всё равно подписывается
 * (месяцем своего понедельника), иначе лента начиналась бы без заголовка вовсе.
 */
export function layoutRange<T extends LayoutEvent>(
  from: string,
  to: string,
  events: readonly T[],
  options: { firstDividerMonth?: { year: number; month: number } | null } = {},
): WeekLayout<T>[] {
  const first = dayNumber(startOfWeek(from));
  const last = dayNumber(startOfWeek(to));

  const weeks: WeekLayout<T>[] = [];
  let shown = options.firstDividerMonth ?? null;

  for (let n = first; n <= last; n += 7) {
    const weekStart = fromDayNumber(n);
    const week = layoutWeek(weekStart, events);
    const firstOfMonth = week.days.find((d) => d.day === 1);
    const candidate = firstOfMonth
      ? { year: firstOfMonth.year, month: firstOfMonth.month }
      : shown === null
        ? { year: week.days[0].year, month: week.days[0].month }
        : null;

    if (candidate && (shown === null || shown.year !== candidate.year || shown.month !== candidate.month)) {
      week.monthDivider = candidate;
      shown = candidate;
    }

    weeks.push(week);
  }

  // Нити-продолжения: проставляются после того, как все недели разложены, — цвет берётся у нити
  // следующей строки, иначе под баром и под его продолжением оказались бы разные металлы.
  for (let i = 0; i < weeks.length - 1; i++) {
    const nextThreads = weeks[i + 1].threads;
    for (const bar of weeks[i].bars) {
      if (!bar.continuesRight) continue;
      const thread = nextThreads.find((t) => t.event.slug === bar.event.slug);
      // Нить без цвета — та, что ушла в деградацию списком (overflowThreads): связывать не с чем.
      if (!thread || thread.color === null) continue;
      weeks[i].continuations.push({
        event: bar.event,
        startColumn: bar.startColumn,
        endColumn: Math.min(bar.endColumn, 6),
        color: thread.color,
      });
    }
  }

  return weeks;
}
