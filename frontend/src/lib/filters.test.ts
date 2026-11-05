import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  filtersToQuery,
  filtersToSearch,
  hasActiveFilters,
  isInPeriod,
  monthKey,
  parseFilters,
  parseMonthKey,
  type CalendarFilters,
} from './filters.ts';

const TODAY = '2026-11-05';

describe('разбор адреса', () => {
  it('пустой адрес — месяц «сегодня», будущие, без фильтров', () => {
    assert.deepEqual(parseFilters({}, TODAY), {
      view: 'month',
      month: '2026-11',
      period: 'future',
      weapons: [],
      regions: [],
      cityId: null,
      team: false,
      beginner: false,
      q: '',
    });
  });

  it('читает всё, что умеет', () => {
    const filters = parseFilters({
      view: 'list',
      period: 'past',
      month: '2027-03',
      weapons: 'longsword,saber',
      regions: 'ЦФО,ЮФО',
      city: '42',
      team: '1',
      beginner: '1',
      q: '  Алга!  ',
    }, TODAY);
    assert.equal(filters.view, 'list');
    assert.equal(filters.period, 'past');
    assert.equal(filters.month, '2027-03');
    assert.deepEqual(filters.weapons, ['longsword', 'saber']);
    assert.deepEqual(filters.regions, ['ЦФО', 'ЮФО']);
    assert.equal(filters.cityId, 42);
    assert.equal(filters.team, true);
    assert.equal(filters.q, 'Алга!');
  });

  it('переживает мусор в параметрах: ссылку правят руками', () => {
    const filters = parseFilters({
      view: 'галерея',
      period: 'вчера',
      month: '2026-13',
      weapons: 'longsword,,longsword, saber ,',
      city: 'ноль',
      team: 'yes',
      q: 'x'.repeat(500),
    }, TODAY);
    assert.equal(filters.view, 'month', 'неизвестный вид — не повод падать');
    assert.equal(filters.period, 'future');
    assert.equal(filters.month, '2026-11', 'тринадцатого месяца не бывает');
    assert.deepEqual(filters.weapons, ['longsword', 'saber'], 'пустые куски и дубли выброшены');
    assert.equal(filters.cityId, null);
    assert.equal(filters.team, false, 'булев фильтр включается только значением «1»');
    assert.equal(filters.q.length, 100, 'длинный поиск обрезан');
  });

  it('берёт первое значение повторённого параметра', () => {
    assert.equal(parseFilters({ view: ['list', 'month'] }, TODAY).view, 'list');
    assert.deepEqual(parseFilters({ weapons: ['saber', 'rapier'] }, TODAY).weapons, ['saber', 'rapier']);
  });

  it('месяц 2026-13 и 1899-01 отбрасываются, 2026-01 принимается', () => {
    assert.deepEqual(parseMonthKey('2026-01', TODAY), { year: 2026, month: 0 });
    assert.deepEqual(parseMonthKey('1899-01', TODAY), { year: 2026, month: 10 });
    assert.deepEqual(parseMonthKey('', TODAY), { year: 2026, month: 10 });
    assert.equal(monthKey(2026, 0), '2026-01');
  });
});

describe('сборка адреса', () => {
  const base = parseFilters({}, TODAY);

  it('состояние по умолчанию — пустой адрес', () => {
    assert.equal(filtersToSearch(base, TODAY), '');
  });

  it('текущий месяц в адрес не пишется, другой — пишется', () => {
    assert.equal(filtersToSearch({ ...base, month: '2026-11' }, TODAY), '');
    assert.equal(filtersToSearch({ ...base, month: '2027-03' }, TODAY), '?month=2027-03');
  });

  it('период пишется только для списка: в сетке месяца он ничего не значит', () => {
    assert.equal(filtersToSearch({ ...base, period: 'past' }, TODAY), '');
    assert.equal(filtersToSearch({ ...base, view: 'list', period: 'past' }, TODAY), '?view=list&period=past');
  });

  it('туда и обратно: разбор собранного адреса даёт те же фильтры', () => {
    const filters: CalendarFilters = {
      view: 'list',
      month: '2027-03',
      period: 'all',
      weapons: ['saber'],
      regions: ['ЦФО'],
      cityId: 7,
      team: true,
      beginner: true,
      q: 'алга',
    };
    const search = filtersToSearch(filters, TODAY);
    const params = Object.fromEntries(new URLSearchParams(search.slice(1)));
    const parsed = parseFilters(params, TODAY);
    // Месяц в адрес не попал (вид — список), поэтому сравниваем всё остальное.
    assert.deepEqual({ ...parsed, month: filters.month }, filters);
  });

  it('активные фильтры считаются без вида, месяца и периода', () => {
    assert.equal(hasActiveFilters(base), false);
    assert.equal(hasActiveFilters({ ...base, view: 'list', period: 'all', month: '2020-01' }), false);
    assert.equal(hasActiveFilters({ ...base, cityId: 1 }), true);
    assert.equal(hasActiveFilters({ ...base, q: 'а' }), true);
  });
});

describe('запрос к API', () => {
  const base = parseFilters({}, TODAY);

  it('сетка месяца грузит хвосты соседних месяцев', () => {
    const query = filtersToQuery({ ...base, month: '2026-11' }, TODAY);
    // Ноябрь 2026 начинается в воскресенье: сетка идёт с 26 октября по 6 декабря.
    assert.equal(query.from, '2026-10-26');
    assert.equal(query.to, '2026-12-06');
  });

  it('список: будущие — от сегодня, прошедшие — до вчера, все — без границ', () => {
    assert.deepEqual(filtersToQuery({ ...base, view: 'list', period: 'future' }, TODAY).from, TODAY);
    assert.equal(filtersToQuery({ ...base, view: 'list', period: 'future' }, TODAY).to, undefined);
    assert.equal(filtersToQuery({ ...base, view: 'list', period: 'past' }, TODAY).to, '2026-11-04');
    assert.equal(filtersToQuery({ ...base, view: 'list', period: 'past' }, TODAY).from, undefined);
    const all = filtersToQuery({ ...base, view: 'list', period: 'all' }, TODAY);
    assert.equal(all.from, undefined);
    assert.equal(all.to, undefined);
  });

  it('пустые фильтры не уезжают в запрос пустыми значениями', () => {
    const query = filtersToQuery({ ...base, view: 'list', period: 'all' }, TODAY);
    assert.deepEqual(query, {
      weapons: undefined, regions: undefined, cityId: undefined,
      team: undefined, beginner: undefined, q: undefined,
    });
  });

  it('заполненные фильтры уезжают как есть', () => {
    const query = filtersToQuery({
      ...base, view: 'list', period: 'all', weapons: ['saber'], regions: ['ЦФО'], cityId: 3, team: true, q: 'алга',
    }, TODAY);
    assert.deepEqual(query.weapons, ['saber']);
    assert.deepEqual(query.regions, ['ЦФО']);
    assert.equal(query.cityId, 3);
    assert.equal(query.team, true);
    assert.equal(query.beginner, undefined);
    assert.equal(query.q, 'алга');
  });
});

describe('добор по периоду', () => {
  it('идущий турнир не прошедший — он идёт', () => {
    // API отдаёт пересечение с диапазоном, поэтому турнир 4–6 ноября попадает и в «до вчера».
    assert.equal(isInPeriod({ startsAt: '2026-11-04', endsAt: '2026-11-06' }, 'past', TODAY), false);
    assert.equal(isInPeriod({ startsAt: '2026-11-04', endsAt: '2026-11-06' }, 'future', TODAY), true);
  });

  it('законченное — прошедшее, сегодняшнее — будущее', () => {
    assert.equal(isInPeriod({ startsAt: '2026-11-01', endsAt: '2026-11-04' }, 'past', TODAY), true);
    assert.equal(isInPeriod({ startsAt: '2026-11-05', endsAt: '2026-11-05' }, 'past', TODAY), false);
    assert.equal(isInPeriod({ startsAt: '2026-11-05', endsAt: '2026-11-05' }, 'future', TODAY), true);
  });

  it('весь календарь не просеивает ничего', () => {
    assert.equal(isInPeriod({ startsAt: '2020-01-01', endsAt: '2020-01-02' }, 'all', TODAY), true);
  });
});
