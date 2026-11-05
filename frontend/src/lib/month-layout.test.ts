import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  addDays,
  dayNumber,
  formatDateRange,
  fromDayNumber,
  isPastEvent,
  layoutMonth,
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
