'use client';

import Link from 'next/link';
import { memo, useLayoutEffect, useRef, useState } from 'react';

import type { CalendarEvent } from '@/src/lib/data';
import { formatPlace } from '@/src/lib/text';
import {
  MAX_THREAD_LANES,
  MONTH_LABELS,
  MONTH_TITLES,
  TAIL_COLUMN,
  addDays,
  parseDate,
  type BarPlacement,
  type StripePlacement,
  type ThreadColor,
  type ThreadPlacement,
  type WeekLayout,
} from '@/src/lib/month-layout';

/**
 * Лента недель — главный вид календаря, перенесён из портала hema.ru
 * (slices/events/components/calendar-grid.tsx) вместе со всей геометрией: узкие будни, широкие
 * суббота и воскресенье, бары над уикендом, нити будничных событий снизу, аннексированный
 * понедельник-хвост.
 *
 * Чего здесь нет из портального и не будет: рельса «пойду»/«был», медалей, результатов, звезды
 * флагмана, иконок типа события и ховер-карточки с отметками — всё это про залогиненного
 * человека, которого календарь не знает. Поэтому и стилей тела плашки два, а не четыре:
 * обычное и прошедшее (в портале ещё два — «не подходит мне»).
 */

export type GridEvent = CalendarEvent & { isPast: boolean };

/** Стиль тела плашки: прошедшее «остывает» в графит, остальное — тёплая полоса календаря. */
type EventBodyStyle = 'normal' | 'past';

function eventBodyStyle(isPast: boolean): EventBodyStyle {
  return isPast ? 'past' : 'normal';
}

/**
 * Сетка недель календаря (docs/slices/Events.md §7). Вся геометрия посчитана заранее чистой
 * функцией lib/calendar-layout.ts — здесь только отрисовка: ярусы баров, полосы, нити-сноски.
 */

// Пн–пт узкие фиксированные (спека §7: ~32px), сб и вс широкие резиновые. Хвостовой КОЛОНКИ в
// шаблоне больше нет (фидбек третьей волны: «правая сторона рабочей области вверху не совпадает с
// правой стороной ленты»): раньше 8-я колонка съедала 44px справа, и правый край воскресенья не
// доходил до правого края контейнера, полоски месяцев и строки фильтров. Понедельник-хвост при
// аннексии рисуется отдельным absolute-элементом, ВЫСТУПАЮЩИМ за правую границу контейнера.
// Шапка дней недели (CalendarWeekdayHeader) использует ЭТОТ ЖЕ шаблон, иначе при ограниченной
// ширине контейнера заголовки разъезжаются с колонками.
export const GRID_TEMPLATE = 'repeat(5, 32px) 1fr 1fr';

/** Видимая ширина плашки дня (32px колонка минус margin 0 1px с обеих сторон) — тот же расчёт,
 *  что и у будних плашек ниже (day.column). Хвост использует её как эталон своей ширины. */
const DAY_TILE_WIDTH = 30;

/**
 * Ширина выступающего вправо понедельника-хвоста — РОВНО DAY_TILE_WIDTH + 1px (тот же зазор
 * left:'calc(100% + 1px)', что у плашки дня хвоста, см. её JSX ниже), не больше.
 *
 * Раньше здесь стояло 44px — «зона рельса» больше, чем сама видимая плашка. Рельс (29px,
 * CalendarRail) в обычной (не хвостовой) колонке НЕ добавляет ширины сверх плашки дня — он лежит
 * поверх правой части той же плашки (absolute right:0 внутри бара, чья ширина и есть ширина
 * плашки). В хвосте рельс живёт в TailPiece, а не в баре, и лишние 14px делали хвостовое тело
 * шире плашки дня-хвоста — правый край бара уезжал за правый край TailPiece/плашки дня (фидбог
 * заказчика на Level One: Chernozem, «плашка события заметно длиннее плашки дня-хвоста»; заодно
 * от лишнего запаса текст города/организатора визуально садился ближе к рельсу, чем в остальных
 * колонках). Теперь хвост — точный аналог обычной колонки: рельс перекрывает ту же ширину, что и
 * плашка дня, ничего сверх неё.
 */
const TAIL_WIDTH = DAY_TILE_WIDTH + 1;

/** Подписи шапки: будни сокращённо, уикенд — полным словом (как на макетах). */
const HEADER_LABELS = ['пн', 'вт', 'ср', 'чт', 'пт', 'суббота', 'воскресенье'];

/**
 * Шапка дней недели. Живёт не внутри ленты, а третьим слоем общего липкого контейнера
 * (calendar-page.tsx: фильтры → полоска месяцев → дни), поэтому вынесена отдельным компонентом.
 */
export function CalendarWeekdayHeader() {
  return (
    <div className="grid h-5 items-center bg-background" style={{ gridTemplateColumns: GRID_TEMPLATE }}>
      {HEADER_LABELS.map((label, i) => (
        <span
          key={label}
          className={`px-1.5 text-[11px] leading-none ${i >= 5 ? 'text-calendar-weekend' : 'text-text-muted'}`}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

/**
 * Высота яруса. Выросла с 44 до 56 вместе с двухэтажным содержимым бара (фидбек: «сильно
 * обрезаются названия и города»): слева название в две строки, справа город и организатор.
 * Плашки дней тянутся на всю высоту строки, поэтому отдельно их подгонять не нужно.
 */
const LANE_HEIGHT = 56;

/**
 * Нить (спека §7, макеты). Чисто будничное событие не может стать баром — над буднями нет места, —
 * поэтому оно уезжает карточкой в зону сносок ПОД строкой недели, а связь с днями держит градиент:
 * от цвета обычной плашки дня вниз к цвету события, насыщаясь к цветной верхней кромке карточки.
 *
 * Геометрия зоны сносок — грид с ДВУМЯ строками на ярус: «пробег градиента» и сама карточка. Тогда
 * градиент нижней нити просто растягивается от верха зоны до своей карточки, проходя ЗА карточками
 * верхних ярусов и оставаясь видимым в зазорах — ровно как на макете.
 *
 * Цвета — палитра металлов; в hex, а не классами Tailwind, потому что уходят в linear-gradient.
 */
const THREAD_HEX: Record<ThreadColor, string> = {
  gold: '#c9a84c',
  bronze: '#b0764a',
  silver: '#c3c7ce',
  steel: '#8e8474',
};
/**
 * Цвет плашки дня — стартовая точка градиента. Берётся ТОКЕНОМ, а не хексом: литерал был цветом
 * тёмной темы, и на пергаменте нить начиналась угольным столбом посреди светлой сетки (жалоба
 * заказчика 21.08.2026). В `linear-gradient` токен обязан идти обёрнутым в `rgb()` — переменные
 * палитры хранят каналы, а не цвет (CLAUDE.md).
 */
const PLATE_COLOR = 'rgb(var(--c-card))';
/**
 * Высота «пробега» градиента над карточкой яруса. Галтели (вогнутая сверху и раструб снизу) были
 * откачены по требованию заказчика 2026-08-05 («красиво не получается — пиксели и градиент кривой»):
 * столб теперь прямой, от низа плашек дня до цветной кромки карточки. Уменьшена с 28 до 14
 * (фидбек, п.5 — «нити компактнее»): столб остаётся читаемой выноской, но не растягивает строку
 * недели. Высота самой карточки нити (THREAD_CARD_HEIGHT) не трогается.
 */
const THREAD_GRADIENT_HEIGHT = 14;
// Двухэтажная карточка нити (название + даты слева, город + организатор справа) — как у баров.
const THREAD_CARD_HEIGHT = 44;
/** Ширина карточки-нити — примерно колонка «сб» (спека §7). */
/** Горизонтальный отступ и столба, и карточки — они обязаны начинаться на одном пикселе. */
const THREAD_INSET = 1;

/** Цвет графита прошедших подходящих событий (colors.calendar.past в tailwind.config) — конец
 *  градиента столба нити у past-события ведёт сюда, а не в цветной металл (иначе цветной столб
 *  торчал бы над серой карточкой, спека §11). */
const PAST_COLOR = 'rgb(var(--cal-past))';


function threadHex(color: ThreadColor | null, style: EventBodyStyle): string {
  if (style === 'past') return PAST_COLOR;
  // Металлы нити — по-прежнему литералы: это смысловой код (золото/бронза/серебро/сталь), он
  // одинаков в любой теме. Запасной цвет без металла — токен рамки, он темы слушается.
  return color ? THREAD_HEX[color] : 'rgb(var(--c-border-light))';
}

/** «6.08» — дата из `today` ('YYYY-MM-DD'), без года, для подписи у линии «мы здесь» (п.8). */
function todayShortLabel(today: string): string {
  const [, m, d] = today.split('-').map(Number);
  return `${d}.${String(m).padStart(2, '0')}`;
}

function eventDayRange(event: GridEvent): string {
  const start = event.startsAt.slice(0, 10);
  const end = event.endsAt.slice(0, 10);
  const [, sm, sd] = start.split('-').map(Number);
  const [, em, ed] = end.split('-').map(Number);
  if (start === end) return `${sd} ${MONTH_LABELS[sm - 1]}`;
  if (sm === em) return `${sd}–${ed} ${MONTH_LABELS[em - 1]}`;
  return `${sd} ${MONTH_LABELS[sm - 1]} – ${ed} ${MONTH_LABELS[em - 1]}`;
}


/**
 * Грейскейл прошедшего ПОДХОДЯЩЕГО события (пересмотр 2026-08-06, матрица §11): тело — обесцвеченный
 * графит (не «выключенный» фон дня, как у неподходящего — это разные коды), основной текст читаемый.
 */
const PAST_CLASS = 'bg-calendar-past text-calendar-pastText ring-1 ring-inset ring-border-light/20';

/**
 * Прошедшее НЕподходящее (пересмотр 2026-08-07, 4-й стиль тела §11): те же тона светлоты/контраста,
 * что у MUTED_CLASS выше (тот же ring, тот же приглушённый код), но обесцвеченные — обычное
 * bg-card/text-faint тёплые, а этот стиль нейтрально-серый той же яркости (см. tailwind.config,
 * calendar.pastUnsuitable/pastUnsuitableText).
 */

const BODY_CLASS: Record<EventBodyStyle, string> = {
  past: PAST_CLASS,
  normal: 'bg-calendar-bar text-foreground hover:bg-calendar-barHover',
};

/** Цвет вторичного текста (город/организатор) на теле плашки — past ведёт в свой тусклый тон, чтобы
 *  не сливаться с читаемым pastText основной строки. */
const SECONDARY_TEXT_CLASS: Record<EventBodyStyle, string> = {
  past: 'text-calendar-pastTextMuted',
  normal: 'text-text-secondary',
};
/** Типы, у которых есть своя иконка (п.6) — Tournament (дефолт) и прочее в календаре без иконки. */
const TERTIARY_TEXT_CLASS: Record<EventBodyStyle, string> = {
  past: 'text-calendar-pastTextMuted',
  // Организатор на ЦВЕТНОЙ плашке — text-secondary, а не text-muted: плашка (--cal-bar) светлее
  // фона страницы, и на светлой теме muted давал 4.27 при пороге 4.5. На тёмной теме плашка
  // темнее фона, и secondary там читается не хуже прежнего muted.
  normal: 'text-text-secondary',
};


/**
 * Общая обёртка кликабельного блока события — бар, полоса и нить ведут на /events/{slug}.
 * Причина «не подходит» больше не живёт отдельным тултипом: она стала строкой ховер-карточки
 * события, чтобы по наведению не спорили две всплывашки.
 */
function EventBlock({
  event,
  className,
  style,
  children,
}: {
  event: GridEvent;
  className: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <Link href={`/events/${event.slug}`} className={`group relative ${className}`} style={style}>
      {children}
    </Link>
  );
}


/** Однострочная подпись — для полос лагерей (там двухэтажность не нужна). */
function EventLabel({ event, style }: { event: GridEvent; style: EventBodyStyle }) {
  return (
    <span className="flex w-full min-w-0 items-center gap-1 overflow-hidden">
      <span className={`truncate font-medium ${style === 'past' ? 'text-calendar-pastText' : 'text-foreground'}`}>
        {event.title}
      </span>
      <span className={`hidden items-center gap-1 truncate sm:flex ${SECONDARY_TEXT_CLASS[style]}`}>
        · {formatPlace(event.city, event.locationManual)}
      </span>
    </span>
  );
}

/** Полоса (многонедельное событие): однострочная подпись во всю ширину. */
function StripeContent({ stripe }: { stripe: StripePlacement<GridEvent> }) {
  const style = eventBodyStyle(stripe.event.isPast);
  return (
    <span className="flex w-full min-w-0 items-center">
      <EventLabel event={stripe.event} style={style} />
    </span>
  );
}

/**
 * Содержимое бара (фидбек: «город по правому краю, ниже короткое название организатора, слева
 * название турнира на две строки»). Название режется по двум строкам, а не по одной — самая частая
 * жалоба была именно на обрезанные названия.
 */
function BarContent({ event }: { event: GridEvent }) {
  const style = eventBodyStyle(event.isPast);
  const titleRef = useRef<HTMLSpanElement>(null);
  // Название заняло одну строку → показываем дату второй строкой; заняло две — без даты.
  // Измеряем после layout, не дёргая видимую разметку.
  const [singleLine, setSingleLine] = useState(false);
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const measure = () => {
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 16;
      setSingleLine(el.scrollHeight <= lineHeight * 1.5);
    };
    measure();
    // Шрифт догружается ПОСЛЕ первого замера, и строка, измеренная системным шрифтом как
    // однострочная, на самом деле переносится. Без повторного замера дата оставалась на
    // плашке двухстрочных названий.
    if (typeof document !== 'undefined' && 'fonts' in document) {
      document.fonts.ready.then(measure).catch(() => {});
    }
  }, [event.title]);

  const place = formatPlace(event.city, event.locationManual);
  return (
    <span className="flex w-full min-w-0 items-center gap-1.5 overflow-hidden">
      <span className="flex min-w-0 flex-1 items-start gap-1">
        <span className="flex min-w-0 flex-col leading-tight">
          <span
            ref={titleRef}
            className={`line-clamp-2 break-words font-medium leading-tight ${
              style === 'past' ? 'text-calendar-pastText' : 'text-foreground'
            }`}
          >
            {event.title}
          </span>
          {singleLine && <span className={`truncate text-[10px] ${SECONDARY_TEXT_CLASS[style]}`}>{eventDayRange(event)}</span>}
        </span>
      </span>

      <span className="flex min-w-0 shrink flex-col items-end text-right leading-tight">
        {place && <span className={`w-full truncate ${SECONDARY_TEXT_CLASS[style]}`}>{place}</span>}
        {event.organizerName && (
          <span className={`w-full truncate text-[10px] ${TERTIARY_TEXT_CLASS[style]}`}>{event.organizerName}</span>
        )}
      </span>
    </span>
  );
}

function Bar({
  bar,
  continuationColor = null,
}: {
  bar: BarPlacement<GridEvent>;
  /** Металл нити следующей строки — кромкой сверху; null, если событие здесь и кончается. */
  continuationColor?: ThreadColor | null;
}) {
  const { event } = bar;
  const style = eventBodyStyle(event.isPast);
  // Аннексированный понедельник живёт за правым краем контейнера — сам бар в сетке доходит до
  // воскресенья, а «хвост» дорисовывается отдельным элементом (см. TailPiece).
  const annexed = bar.endColumn === TAIL_COLUMN;
  return (
    <EventBlock
      event={event}
      className={[
        // overflow-hidden теперь можно (комментарий устарел — ховер-карточка давно в
        // createPortal и overflow строки её не обрежет): круглим угол под рельс аккуратно.
        // Аннексированный пн — исключение: его блок физически продлевается в зону хвоста (см.
        // style ниже), overflow остаётся visible, иначе продлённая часть обрезалась бы по границе
        // воскресенья.
        `z-10 flex items-center ${annexed ? '' : 'overflow-hidden'} px-2 text-xs transition-colors`,
        'rounded-md',
        bar.continuesLeft ? 'rounded-l-none' : '',
        // Аннексированный пн — НЕ rounded-r-none (было раньше): бар физически продлён вплотную
        // под хвост (TailPiece, тот же style/цвет), и его правый край совпадает с правым краем
        // хвоста. Квадратный угол бара торчал острым уголком именно там, где скруглённый угол
        // хвоста открывает то, что под ним (геометрия покруглений не совпадала — фидбек, п.7а).
        // У бара тот же rounded-md, тот же цвет — угол совпадает с хвостом и шва не видно.
        // Квадратный — только ВЕРХНИЙ правый угол: это и есть знак «событие продолжается», он же
        // держит нить-продолжение вдоль верхней кромки. Нижний правый остаётся скруглённым
        // (уточнение заказчика 27.10.2026: квадратный низ выглядел неаккуратно).
        bar.continuesRight && !annexed ? 'rounded-tr-none' : '',
        BODY_CLASS[style],
      ].join(' ')}
      style={{
        // Нить-продолжение — кромкой СВЕРХУ (уточнение заказчика 27.10.2026): border идёт по
        // border-radius, поэтому плашка остаётся скруглённой, а линия читается как та же нить,
        // которой событие нарисовано в следующей строке.
        ...(continuationColor ? { borderTop: `2px solid ${threadHex(continuationColor, style)}` } : null),
        gridColumn: annexed ? `${bar.startColumn + 1} / -1` : `${bar.startColumn + 1} / ${bar.endColumn + 2}`,
        gridRow: bar.lane + 1,
        // Правый отступ 1px (margin-right) у обычного бара — от него плашка не доходит до линии
        // грида на 1px, и в зазор проглядывал фон строки. У аннексированного бара этот зазор
        // приходился ровно на стык с TailPiece — однопиксельная вертикальная линия-разрез (фидбек
        // заказчика, п.3б). У аннексированных правый отступ убран, а сам блок физически продлён на
        // TAIL_WIDTH (calc(100% + …)) — тогда его правый край совпадает с левым краем TailPiece
        // (тот тоже стоит вплотную, left: 100% контейнера) без зазора, а вторичный текст
        // (город/организатор), выровненный по правому краю СВОЕГО контейнера, естественно съезжает
        // к настоящему концу плашки — хвосту, а не к границе воскресенья (фидбек, п.3а).
        margin: annexed ? '2px 0 2px 1px' : '2px 1px',
        minWidth: 0,
        // -1px: margin-left:1px сдвигает бокс вправо, не уменьшая ширину, посчитанную от %
        // (containing block — область грида, margin своего элемента на неё не влияет) — без
        // поправки правый край на 1px перехлёстывал скруглённый край хвоста (TailPiece).
        ...(annexed ? { width: `calc(100% + ${TAIL_WIDTH - 1}px)` } : {}),
      }}
    >
      <BarContent event={event} />
    </EventBlock>
  );
}

/**
 * Понедельник-хвост: продолжение бара ЗА правой границей рабочей области. Именно так заказчик и
 * попросил — «расширим сб и вс; понедельник-хвост пусть вылезает вправо за границы», чтобы правый
 * край воскресенья совпал с правым краем строки фильтров и полоски месяцев.
 */
function TailPiece({ bar }: { bar: BarPlacement<GridEvent> }) {
  const style = eventBodyStyle(bar.event.isPast);
  return (
    <Link
      href={`/events/${bar.event.slug}`}
      aria-hidden="true"
      tabIndex={-1}
      className={['absolute z-20 rounded-r-md', BODY_CLASS[style]].join(' ')}
      style={{
        left: '100%',
        width: TAIL_WIDTH,
        top: bar.lane * LANE_HEIGHT + 2,
        height: LANE_HEIGHT - 4,
      }}
    />
  );
}

/**
 * Зона сносок под строкой недели: сначала градиентные столбы (по одному на нить, ровно над её
 * днями), поверх — карточки нитей с цветной верхней кромкой.
 *
 * Галтелей у столба НЕТ и заводить их снова не надо: radial-gradient-уголки (вогнутый сверху,
 * раструб снизу) откатаны 2026-08-05 — заказчик забраковал их как «пиксели и кривой градиент».
 * Столб прямой: плашки дней без нижнего скругления → градиентный столб → кромка карточки.
 *
 * z-index: чем ВЫШЕ ярус, тем больше — градиенты и карточки верхних ярусов перекрывают градиенты
 * нижних (иначе длинный столб нижней нити пересекал бы карточку верхней).
 */
function ThreadCardContent({ event }: { event: GridEvent }) {
  const style = eventBodyStyle(event.isPast);
  const place = formatPlace(event.city, event.locationManual);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="flex min-w-0 items-center gap-1">
          <span className={`truncate font-medium ${style === 'past' ? 'text-calendar-pastText' : 'text-foreground'}`}>
            {event.title}
          </span>
        </span>
        <span className={`truncate text-[11px] ${SECONDARY_TEXT_CLASS[style]}`}>{eventDayRange(event)}</span>
      </span>

      <span className="flex min-w-0 shrink flex-col items-end text-right leading-tight">
        {place && <span className={`w-full truncate ${SECONDARY_TEXT_CLASS[style]}`}>{place}</span>}
        {event.organizerName && (
          <span className={`w-full truncate text-[10px] ${TERTIARY_TEXT_CLASS[style]}`}>{event.organizerName}</span>
        )}
      </span>
    </span>
  );
}

function ThreadZone({ threads, today }: { threads: ThreadPlacement<GridEvent>[]; today: string }) {
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: GRID_TEMPLATE,
        gridTemplateRows: threads.map(() => `${THREAD_GRADIENT_HEIGHT}px ${THREAD_CARD_HEIGHT}px`).join(' '),
      }}
    >
      {threads.map((thread) => {
        const { event } = thread;
        const style = eventBodyStyle(event.isPast);
        const color = threadHex(thread.color, style);
        // Градиент занимает ровно дни события и тянется от плашек вниз до кромки своей карточки:
        // строки 1 … 2*lane+1 включительно.
        const cardRow = thread.lane * 2 + 2;
        const z = (MAX_THREAD_LANES - thread.lane) * 2;
        return (
          <div key={`t-${event.slug}`} className="contents">
            <div
              aria-hidden="true"
              className="relative"
              style={{
                gridColumn: `${thread.startColumn + 1} / ${thread.endColumn + 2}`,
                gridRow: `1 / ${cardRow}`,
                marginLeft: THREAD_INSET,
                marginRight: THREAD_INSET,
                zIndex: z,
                // Градиент — про СВЯЗЬ дней с карточкой, а не про соответствие фильтру: он остаётся
                // и у прошедших/неподходящих нитей (фидбек, п.4 — «пропали градиентные столбы у
                // прошедших»). У past-события столб ведёт в тот же грейскейл, что и карточка (см.
                // threadHex выше) — иначе цветной столб торчал бы над серой карточкой (спека §11).
                background: `linear-gradient(to bottom, ${PLATE_COLOR}, ${color})`,
              }}
            />

            <EventBlock
              event={event}
              className={[
                'flex items-center gap-3 overflow-hidden rounded-md rounded-t-none px-2 py-1 text-xs',
                style === 'normal' ? 'bg-card text-foreground' : BODY_CLASS[style],
              ].join(' ')}
              style={{
                // Двухэтажная раскладка как у баров (фидбек: слева название и даты под ним, справа
                // город и организатор), а ширина — по контенту, не на всю строку.
                gridColumn: `${thread.startColumn + 1} / -1`,
                gridRow: cardRow,
                justifySelf: 'start',
                width: 'fit-content',
                maxWidth: '100%',
                // Тот же отступ, что у столба: заказчик заметил расхождение в несколько пикселей
                // между левым краем градиента и левым краем карточки.
                marginLeft: THREAD_INSET,
                marginRight: THREAD_INSET,
                zIndex: z + 1,
                borderTop: `2px solid ${color}`,
              }}
            >
              <ThreadCardContent event={event} />
            </EventBlock>
          </div>
        );
      })}
    </div>
  );
}

// React.memo: недель в ленте десятки, а их пропсы стабильны между не касающимися их рендерами
// (weeks мемоизирован в calendar-page — при рендере из-за скролла/visibleYear ссылки те же).
const WeekRow = memo(function WeekRow({ week, isCurrent, today }: { week: WeekLayout<GridEvent>; isCurrent: boolean; today: string }) {
  const laneRows = Math.max(1, week.laneCount);
  const hasContent = week.bars.length > 0 || week.stripes.length > 0;

  // Дни, над которыми начинается нить: их плашки уходят в градиент прямыми — без нижнего
  // скругления (спека §7). Иначе между плашкой и градиентом оставался светлый уголок.
  const threadedColumns = new Set<number>();
  for (const thread of week.threads)
    for (let c = thread.startColumn; c <= thread.endColumn; c++) threadedColumns.add(c);

  return (
    <div className="flex flex-col gap-1">
      {week.stripes.map((stripe) => (
        <EventBlock
          key={stripe.event.slug}
          event={stripe.event}
          className={[
            'flex items-center overflow-hidden rounded-md px-2 py-1 text-xs',
            stripe.continuesLeft ? 'rounded-l-none' : '',
            stripe.continuesRight ? 'rounded-r-none' : '',
            BODY_CLASS[eventBodyStyle(stripe.event.isPast)],
          ].join(' ')}
        >
          <StripeContent stripe={stripe} />
        </EventBlock>
      ))}

      {/* Строка недели и зона сносок — вплотную, без зазора: градиент нити должен продолжать
          плашку дня, а не начинаться в четырёх пикселях под ней. */}
      <div className="flex flex-col">
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: GRID_TEMPLATE,
            gridAutoRows: `${LANE_HEIGHT}px`,
            minHeight: hasContent ? laneRows * LANE_HEIGHT : LANE_HEIGHT,
            // position:relative БЕЗ z-index не создаёт свой stacking context (спецификация CSS2.1) —
            // z-index:-1 у линии «мы здесь» ниже уходил в КОРНЕВОЙ stacking context страницы и мог
            // проваливаться под совершенно посторонний контент, а не только под плашки СВОЕЙ строки
            // (баг «шампур не рендерится», фидбек п.8). z-index:0 здесь замыкает контекст на уровне
            // строки недели — линия гарантированно ложится под собственные плашки и бары и не зависит
            // от остальной страницы.
            zIndex: 0,
          }}
        >
          {/* «Мы здесь»: тонкая сквозная линия по вертикальному центру текущей недели. Шире рабочей
              области (торчит по 24px в обе стороны) и лежит ПОД плашками и барами — они непрозрачны,
              поэтому линия видна только в зазорах между колонками и по бокам ленты («шашлык»).
              Рисуется ПЕРВОЙ в DOM: у плашек z-index не задан, и порядок документа решает всё. */}
          {isCurrent && (
            <>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute h-0.5 bg-foreground/70"
                // z-index: -1, а не 0. Позиционированный элемент с z-index: 0 рисуется ПОЗЖЕ
                // непозиционированных плашек дней (шаг 8 против шага 4 в порядке отрисовки CSS) и
                // лёг бы поверх них; отрицательный уводит линию под плашки, но выше фона страницы.
                style={{ left: -24, right: -24, top: '50%', marginTop: -1, zIndex: -1 }}
              />
              {/* Подписи шампура — обе на ЛЕВОМ конце, за границей области (пересмотр 2026-08-06):
                  «сегодня» над линией, дата «Д.ММ» под линией; справа больше ничего нет. Дата —
                  из `today` (посчитана на сервере), не Date.now(): SSR и гидратация обязаны совпасть,
                  а локальные часы браузера гостя могут расходиться с сервером. */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute text-right leading-none text-[10px] text-text-muted"
                style={{ right: 'calc(100% + 28px)', bottom: '50%', marginBottom: 2 }}
              >
                сегодня
              </span>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute text-right leading-none text-[10px] text-text-muted"
                style={{ right: 'calc(100% + 28px)', top: '50%', marginTop: 2 }}
              >
                {todayShortLabel(today)}
              </span>
            </>
          )}

          {/* Плашки дней — фоновый слой на всю высоту строки: в неделе с событиями пустые дни
              растягиваются вместе с остальными (спека §7), иначе выглядели бы обрезанными. */}
          {week.days.map((day) => (
            <div
              key={day.date}
              className={[
                'rounded-md',
                // День под нитью — плашка полной насыщенности (она же стартовый цвет градиента)
                // и без нижнего скругления: снизу она продолжается нитью.
                threadedColumns.has(day.column)
                  ? 'rounded-b-none bg-card'
                  : day.isWeekend
                    ? 'bg-card'
                    // Будние плашки — непрозрачный тон вместо bg-card/60 (фидбек, п.2): полупрозрачность
                    // просвечивала фон под собой, отчего плашка казалась «грязной». background-secondary
                    // (#1c1811) — тот же самый визуальный тон, что и computed-бленд bg-card/60 поверх
                    // bg-background, но одним непрозрачным цветом.
                    : 'bg-background-secondary',
              ].join(' ')}
              style={{ gridColumn: day.column + 1, gridRow: `1 / ${laneRows + 1}`, margin: '0 1px' }}
            >
              <span
                className={[
                  'block px-1.5 pt-1 text-[11px] leading-none',
                  // Будние числа — text-secondary: на плашке дня muted всё ещё терялся.
                  day.isWeekend ? 'text-calendar-weekend' : 'text-text-secondary',
                ].join(' ')}
              >
                {/* Месяц у 1-го числа — всегда; у ПЕРВОГО дня строки — когда строка открывает
                    новый месяц (monthDivider), а её начало ещё в старом: под заголовком «Август»
                    числа 28–31 без подписи читались как августовские (баг-репорт 31.08.2026). */}
                {day.day === 1 || (week.monthDivider && day.column === 0 && week.days[0].date === day.date)
                  ? `${day.day} ${MONTH_LABELS[day.month].slice(0, 3)}`
                  : day.day}
              </span>
            </div>
          ))}

          {/* Плашка дня в зоне хвоста (волна «быстрые правки» 2026-08-06, п.3в): если в строке есть
              аннексированный понедельник, хвост висел над пустотой — без своей ячейки дня. Дата —
              понедельник СЛЕДУЮЩЕЙ недели (weekStart + 7); в её собственной строке этот же
              понедельник дублируется как первый день недели — заказчик такое дублирование явно
              разрешил («будут дубликаты — не страшно, зато понятно»). Стиль — как у обычного буднего
              дня (bg-background-secondary), сам понедельник буднего дня. */}
          {week.bars.some((bar) => bar.endColumn === TAIL_COLUMN) &&
            (() => {
              const tailDate = addDays(week.weekStart, 7);
              const { day, month } = parseDate(tailDate);
              return (
                <div
                  aria-hidden="true"
                  className="absolute rounded-md bg-background-secondary"
                  // Плашка дня в хвостовой зоне — DAY_TILE_WIDTH (тот же видимый размер, что у
                  // будних плашек: их 32px колонка минус margin 0 1px, см. day.column выше).
                  // TAIL_WIDTH = DAY_TILE_WIDTH + 1 ровно из расчёта, чтобы правый край тела бара
                  // и TailPiece (см. Bar/TailPiece выше) совпадал с правым краем ЭТОЙ плашки —
                  // отступ слева 1px здесь и есть та единица разницы.
                  style={{ left: 'calc(100% + 1px)', width: DAY_TILE_WIDTH, top: 0, height: laneRows * LANE_HEIGHT }}
                >
                  <span className="block px-1.5 pt-1 text-[11px] leading-none text-text-secondary">
                    {day === 1 ? `${day} ${MONTH_LABELS[month].slice(0, 3)}` : day}
                  </span>
                </div>
              );
            })()}

          {week.bars.map((bar) => (
            <Bar
              key={bar.event.slug}
              bar={bar}
              // Нить-продолжение: событие уходит в следующую строку и рисуется там нитью — бар
              // носит её цвет верхней кромкой, чтобы два сегмента читались как одно событие.
              continuationColor={week.continuations.find((c) => c.event.slug === bar.event.slug)?.color ?? null}
            />
          ))}

          {week.bars
            .filter((bar) => bar.endColumn === TAIL_COLUMN)
            .map((bar) => (
              <TailPiece key={`tail-${bar.event.slug}`} bar={bar} />
            ))}
        </div>

        {week.threads.length > 0 && <ThreadZone threads={week.threads} today={today} />}
      </div>

      {/* Пятая и дальше нить — деградация в список, а не падение раскладки (спека §7). */}
      {week.overflowThreads.length > 0 && (
        <ul className="flex flex-col gap-0.5 pl-1 text-xs text-text-secondary">
          {week.overflowThreads.map((event) => (
            <li key={event.slug}>
              <Link href={`/events/${event.slug}`} className="hover:text-foreground">
                {eventDayRange(event)} · {event.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

export function CalendarGrid({
  weeks,
  currentWeek,
  today,
}: {
  weeks: WeekLayout<GridEvent>[];
  /** Понедельник текущей недели — по нему рисуется сквозная линия «мы здесь». */
  currentWeek?: string;
  /** Сегодняшняя дата 'YYYY-MM-DD' — состояние рельса зависит от прошедшести события. */
  today: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* Шапка колонок живёт в липком слое страницы (CalendarWeekdayHeader), здесь её нет. */}
      {weeks.map((week) => {
        // Якорь месяца для полоски-навигатора. Тот же критерий, что у разделителя (layoutRange):
        // неделя принадлежит месяцу своего 1-го числа, если оно в неё попало, иначе — месяцу
        // понедельника. Разъехавшись, якорь и заголовок увозили полоску на строку выше нужной.
        const anchorDay = week.days.find((d) => d.day === 1) ?? week.days[0];
        return (
          <div
            key={week.weekStart}
            id={`calendar-week-${week.weekStart}`}
            data-month={`${anchorDay.year}-${anchorDay.month}`}
            className="flex flex-col gap-3 scroll-mt-24"
          >
            {week.monthDivider && (
              <div
                id={`calendar-month-${week.monthDivider.year}-${week.monthDivider.month}`}
                className="flex items-center gap-3 pt-2 scroll-mt-24"
              >
                <span className="font-heading text-lg font-semibold text-foreground">
                  {MONTH_TITLES[week.monthDivider.month]} {week.monthDivider.year}
                </span>
                <span className="h-px flex-1 bg-primary/30" />
              </div>
            )}
            <WeekRow week={week} isCurrent={week.weekStart === currentWeek} today={today} />
          </div>
        );
      })}
    </div>
  );
}
