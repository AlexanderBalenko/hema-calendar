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
 */
export function formatDateRange(startsAt: string, endsAt: string, withYear = false): string {
  const from = parseDate(startsAt);
  const to = parseDate(endsAt);
  const year = withYear ? ` ${to.year}` : '';
  if (from.year === to.year && from.month === to.month && from.day === to.day) {
    return `${from.day} ${MONTH_LABELS[from.month]}${year}`;
  }
  if (from.year === to.year && from.month === to.month) {
    return `${from.day}–${to.day} ${MONTH_LABELS[from.month]}${year}`;
  }
  // Разные годы — год у конца показываем всегда, иначе «29 декабря — 2 января» читается как
  // один год.
  const tail = from.year === to.year ? year : ` ${to.year}`;
  return `${from.day} ${MONTH_LABELS[from.month]}${from.year === to.year ? '' : ` ${from.year}`} — ${to.day} ${MONTH_LABELS[to.month]}${tail}`;
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
function bySlug<T extends LayoutEvent>(a: Classified<T>, b: Classified<T>): number {
  return a.event.slug < b.event.slug ? -1 : a.event.slug > b.event.slug ? 1 : 0;
}

/**
 * Раньше начинается — выше; при равном начале КОРОЧЕ — выше, чтобы под коротким сегментом
 * осталось окошко с датой дня.
 */
function compareSegments<T extends LayoutEvent>(a: Classified<T>, b: Classified<T>): number {
  return a.start - b.start || a.end - b.end || bySlug(a, b);
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
    touching.sort(compareSegments);

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
