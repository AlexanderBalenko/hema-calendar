import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  addDays,
  dayNumber,
  formatDateRange,
  fromDayNumber,
  isPastEvent,
  layoutMonth,
  layoutRange,
  monthGridBounds,
  parseDate,
  shiftMonth,
  startOfWeek,
  weekdayIndex,
} from './month-layout.ts';

/** Все даты в тестах настоящие: ноябрь 2026 начинается с воскресенья — самый неудобный случай. */
describe('даты без Date', () => {
  it('разбирает дату и считает номер дня в обе стороны', () => {
    assert.deepEqual(parseDate('2026-11-05'), { year: 2026, month: 10, day: 5 });
    assert.equal(fromDayNumber(dayNumber('2026-11-05')), '2026-11-05');
    assert.equal(fromDayNumber(dayNumber('2024-02-29')), '2024-02-29');
    assert.equal(fromDayNumber(dayNumber('1970-01-01')), '1970-01-01');
    assert.equal(dayNumber('1970-01-01'), 0);
  });

  it('знает день недели: 2026-11-05 — четверг', () => {
    assert.equal(weekdayIndex('2026-11-05'), 3);
    assert.equal(weekdayIndex('2026-11-01'), 6, 'воскресенье — последний день недели');
    assert.equal(weekdayIndex('2026-10-26'), 0);
  });

  it('откатывается к понедельнику и шагает по дням через границу месяца', () => {
    assert.equal(startOfWeek('2026-11-01'), '2026-10-26');
    assert.equal(startOfWeek('2026-10-26'), '2026-10-26');
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  });

  it('прошедшее событие определяется по дате окончания, а не начала', () => {
    assert.equal(isPastEvent('2026-11-04', '2026-11-05'), true);
    assert.equal(isPastEvent('2026-11-05', '2026-11-05'), false, 'турнир идёт сегодня — не прошёл');
    assert.equal(isPastEvent('2026-11-07', '2026-11-05'), false);
  });

  it('подписывает диапазон по-русски', () => {
    assert.equal(formatDateRange('2026-11-03', '2026-11-03'), '3 ноября');
    assert.equal(formatDateRange('2026-11-03', '2026-11-05'), '3–5 ноября');
    assert.equal(formatDateRange('2026-11-29', '2026-12-02'), '29 ноября — 2 декабря');
    assert.equal(formatDateRange('2026-12-30', '2027-01-02'), '30 декабря 2026 — 2 января 2027');
  });

  it('с годом — для страницы турнира, куда приходят из поиска', () => {
    assert.equal(formatDateRange('2021-05-03', '2021-05-03', true), '3 мая 2021');
    assert.equal(formatDateRange('2021-05-03', '2021-05-05', true), '3–5 мая 2021');
    assert.equal(formatDateRange('2021-05-30', '2021-06-01', true), '30 мая — 1 июня 2021');
    assert.equal(formatDateRange('2020-12-31', '2021-01-01', true), '31 декабря 2020 — 1 января 2021');
  });

  it('сдвигает месяц, не роняя год', () => {
    assert.deepEqual(shiftMonth(2026, 11, 1), { year: 2027, month: 0 });
    assert.deepEqual(shiftMonth(2026, 0, -1), { year: 2025, month: 11 });
    assert.deepEqual(shiftMonth(2026, 0, -13), { year: 2024, month: 11 });
  });
});

describe('границы сетки месяца', () => {
  it('ноябрь 2026 (начинается в воскресенье) берёт хвост октября', () => {
    assert.deepEqual(monthGridBounds(2026, 10), { firstWeek: '2026-10-26', lastWeek: '2026-11-30' });
  });

  it('декабрь не уезжает в следующий год при вычислении последнего дня', () => {
    assert.deepEqual(monthGridBounds(2026, 11), { firstWeek: '2026-11-30', lastWeek: '2026-12-28' });
  });
});

const EVENT = (slug: string, startsAt: string, endsAt = startsAt) => ({ slug, startsAt, endsAt });

describe('layoutMonth', () => {
  it('раскладывает месяц по неделям и помечает чужие числа', () => {
    const weeks = layoutMonth(2026, 10, [], '2026-11-05');
    assert.equal(weeks.length, 6, 'ноябрь 2026 укладывается в шесть строк');
    assert.equal(weeks[0].weekStart, '2026-10-26');
    assert.equal(weeks[0].days.length, 7);
    assert.equal(weeks[0].days[0].date, '2026-10-26');
    assert.equal(weeks[0].days[0].isCurrentMonth, false, '26 октября — хвост соседнего месяца');
    assert.equal(weeks[0].days[6].isCurrentMonth, true, '1 ноября — своё число');
    assert.equal(weeks[0].days[5].isWeekend, true);
    assert.equal(weeks[0].days[4].isWeekend, false);
  });

  it('помечает сегодня и прошедшие дни', () => {
    const [week] = layoutMonth(2026, 10, [], '2026-11-05').slice(1);
    const today = week.days.find((d) => d.date === '2026-11-05');
    assert.ok(today);
    assert.equal(today.isToday, true);
    assert.equal(today.isPast, false, 'сегодня не прошедший день');
    assert.equal(week.days.find((d) => d.date === '2026-11-04')?.isPast, true);
    assert.equal(week.days.find((d) => d.date === '2026-11-06')?.isPast, false);
  });

  it('режет многодневное событие по границе недели и не высовывает его вправо', () => {
    // Главные грабли портала: бар уезжал за правый край сетки, а продолжение начиналось со вторника.
    const weeks = layoutMonth(2026, 10, [EVENT('a', '2026-10-28', '2026-11-03')], '2026-11-05');

    const firstWeek = weeks[0].segments;
    assert.equal(firstWeek.length, 1);
    assert.deepEqual(
      { ...firstWeek[0], event: firstWeek[0].event.slug },
      { event: 'a', lane: 0, startColumn: 2, endColumn: 6, continuesLeft: false, continuesRight: true },
    );

    const secondWeek = weeks[1].segments;
    assert.equal(secondWeek.length, 1);
    assert.deepEqual(
      { ...secondWeek[0], event: secondWeek[0].event.slug },
      { event: 'a', lane: 0, startColumn: 0, endColumn: 1, continuesLeft: true, continuesRight: false },
    );

    for (const week of weeks) {
      for (const segment of week.segments) {
        assert.ok(segment.startColumn >= 0 && segment.endColumn <= 6, 'сегмент не вылезает за неделю');
        assert.ok(segment.startColumn <= segment.endColumn);
      }
    }
  });

  it('не берёт события вне сетки и берёт те, что её задевают', () => {
    const weeks = layoutMonth(2026, 10, [
      EVENT('before', '2026-10-20', '2026-10-25'),
      EVENT('after', '2026-12-29'),
      EVENT('tail', '2026-10-25', '2026-10-26'),
    ], '2026-11-05');
    const ids = weeks.flatMap((w) => w.segments.map((s) => s.event.slug));
    assert.deepEqual(ids, ['tail'], 'октябрьский хвост виден, всё остальное — нет');
    assert.equal(weeks[0].segments[0].continuesLeft, true);
  });

  it('разводит пересекающиеся события по ярусам, а соседние держит на одном', () => {
    const weeks = layoutMonth(2026, 10, [
      EVENT('long', '2026-11-02', '2026-11-06'),
      EVENT('overlap', '2026-11-04', '2026-11-05'),
      EVENT('sunday', '2026-11-08'),
      EVENT('next', '2026-11-09'),
    ], '2026-11-05');

    const week = weeks[1];
    const lanes = Object.fromEntries(week.segments.map((s) => [s.event.slug, s.lane]));
    assert.equal(lanes.long, 0, 'раньше начинается — выше');
    assert.equal(lanes.overlap, 1, 'пересекается — следующий ярус');
    assert.equal(lanes.sunday, 0, 'не пересекается с первым — садится на тот же ярус, а не в новый');
    assert.equal(week.laneCount, 2, 'трёх событий в неделе хватает на два яруса');
    // 9 ноября — уже следующая строка-неделя, ярус снова нулевой.
    assert.equal(weeks[2].segments.find((s) => s.event.slug === 'next')?.lane, 0);
  });

  it('при равном начале короткое событие выше — под ним остаётся место для даты', () => {
    const weeks = layoutMonth(2026, 10, [
      EVENT('long', '2026-11-02', '2026-11-06'),
      EVENT('short', '2026-11-02'),
    ], '2026-11-05');
    const lanes = Object.fromEntries(weeks[1].segments.map((s) => [s.event.slug, s.lane]));
    assert.deepEqual(lanes, { short: 0, long: 1 });
  });

  it('порядок не зависит от порядка входа', () => {
    const events = [EVENT('b', '2026-11-03'), EVENT('a', '2026-11-03'), EVENT('c', '2026-11-03')];
    const direct = layoutMonth(2026, 10, events, '2026-11-05')[1].segments.map((s) => s.event.slug);
    const reversed = layoutMonth(2026, 10, [...events].reverse(), '2026-11-05')[1].segments.map((s) => s.event.slug);
    assert.deepEqual(direct, ['a', 'b', 'c']);
    assert.deepEqual(direct, reversed);
  });
});

/**
 * Лента недель: бар, полоса, нить. Правила тонкие и целиком переносились из портала, а до сих пор
 * их не проверял ни один тест — хотя именно в них легче всего ошибиться при правке соседнего кода.
 *
 * Декабрь 2026: 7 декабря — понедельник, 12-13 декабря — суббота и воскресенье.
 */
describe('layoutRange: бар, полоса и нить', () => {
  const week = (weeks: ReturnType<typeof layoutRange>, start: string) =>
    weeks.find((w) => w.weekStart === start)!;

  it('чисто будничное событие рисуется нитью, а не баром', () => {
    const weeks = layoutRange('2026-12-07', '2026-12-13', [EVENT('будни', '2026-12-08', '2026-12-10')]);
    const w = week(weeks, '2026-12-07');
    assert.equal(w.bars.length, 0, 'бара нет: событие не задевает уикенд');
    assert.deepEqual(w.threads.map((t) => [t.event.slug, t.startColumn, t.endColumn]), [['будни', 1, 3]]);
    assert.equal(w.threads[0].color, 'gold', 'первая нить недели — золото');
  });

  it('событие на уикенде рисуется баром', () => {
    const weeks = layoutRange('2026-12-07', '2026-12-13', [EVENT('уикенд', '2026-12-12', '2026-12-13')]);
    const w = week(weeks, '2026-12-07');
    assert.equal(w.threads.length, 0);
    assert.deepEqual(w.bars.map((b) => [b.startColumn, b.endColumn]), [[5, 6]]);
  });

  it('остаток в один понедельник бар аннексирует хвостом и нити не заводит', () => {
    // Воскресенье 13-е + понедельник 14-е: весь остаток — один день.
    const weeks = layoutRange('2026-12-07', '2026-12-20', [EVENT('вс-пн', '2026-12-13', '2026-12-14')]);
    const first = week(weeks, '2026-12-07');
    assert.equal(first.bars[0].endColumn, 7, 'понедельник живёт в хвостовой 8-й колонке этой же строки');
    assert.equal(first.bars[0].continuesRight, false, 'бар не «продолжается»: он уже показал остаток');
    assert.equal(week(weeks, '2026-12-14').threads.length, 0, 'второй раз тот же понедельник не рисуем');
  });

  it('остаток в два дня и больше уезжает нитью следующей недели — с понедельника', () => {
    // Решение заказчика 27.10.2026: турнир вс–вт раньше вылезал за правый край и дорисовывался
    // со вторника, читаясь как два разных события.
    const weeks = layoutRange('2026-12-07', '2026-12-20', [EVENT('вс-вт', '2026-12-13', '2026-12-15')]);
    const first = week(weeks, '2026-12-07');
    assert.equal(first.bars[0].endColumn, 6, 'хвост НЕ аннексирован: остаток длиннее одного дня');
    assert.equal(first.bars[0].continuesRight, true);

    const next = week(weeks, '2026-12-14');
    assert.deepEqual(next.threads.map((t) => [t.event.slug, t.startColumn, t.endColumn]), [['вс-вт', 0, 1]],
      'остаток рисуется нитью с понедельника, а не куском бара со вторника');

    // Нить-продолжение: бар первой недели носит кромку того же металла, что нить во второй.
    assert.deepEqual(first.continuations.map((c) => [c.event.slug, c.color]), [['вс-вт', next.threads[0].color]],
      'иначе два сегмента читаются как разные события');
  });

  it('нити упорядочены: длинная выше, и металлы идут по порядку', () => {
    const weeks = layoutRange('2026-12-07', '2026-12-13', [
      EVENT('короткая', '2026-12-08', '2026-12-08'),
      EVENT('длинная', '2026-12-08', '2026-12-10'),
    ]);
    const w = week(weeks, '2026-12-07');
    assert.deepEqual(w.threads.map((t) => [t.event.slug, t.color]), [
      ['длинная', 'gold'],
      ['короткая', 'bronze'],
    ], 'при равном начале выше та, что заканчивается позже, — у неё и первый металл');
  });

  it('нитей больше четырёх в неделю не рисуется — лишние уходят в overflow', () => {
    const weeks = layoutRange('2026-12-07', '2026-12-13',
      Array.from({ length: 6 }, (_, i) => EVENT(`н${i}`, '2026-12-08', '2026-12-09')));
    const w = week(weeks, '2026-12-07');
    assert.equal(w.threads.length, 4, 'металлов всего четыре');
    assert.equal(w.overflowThreads.length, 2, 'остальные не теряются, а считаются отдельно');
  });

  it('событие длиннее недели рисуется полосой во всю ширину', () => {
    const weeks = layoutRange('2026-12-07', '2026-12-20', [EVENT('лагерь', '2026-12-07', '2026-12-16')]);
    const first = week(weeks, '2026-12-07');
    assert.equal(first.stripes.length, 1);
    assert.equal(first.stripes[0].continuesRight, true);
    assert.equal(first.bars.length, 0, 'полоса вместо бара: неделя покрыта целиком');
  });
});
