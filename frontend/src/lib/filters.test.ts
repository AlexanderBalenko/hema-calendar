import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  filtersToSearch,
  hasActiveFilters,
  monthKey,
  parseFilters,
  parseMonthKey,
  selectEvents,
  visibleRange,
  type CalendarFilters,
} from './filters.ts';
import type { CalendarEvent } from './data.ts';

const TODAY = '2026-11-05';

describe('разбор адреса', () => {
  it('пустой адрес — месяц «сегодня», будущие, без фильтров', () => {
    assert.deepEqual(parseFilters({}, TODAY), {
      view: 'ribbon',
      month: '2026-11',
      period: 'future',
      weapons: null,
      regions: null,
      city: null,
      team: false,
      beginner: 'all',
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
      city: 'Казань',
      team: '1',
      beginner: 'only',
      q: '  Алга!  ',
    }, TODAY);
    assert.equal(filters.view, 'list');
    assert.equal(filters.period, 'past');
    assert.equal(filters.month, '2027-03');
    assert.deepEqual(filters.weapons, ['longsword', 'saber']);
    assert.deepEqual(filters.regions, ['ЦФО', 'ЮФО']);
    assert.equal(filters.city, 'Казань');
    assert.equal(filters.team, true);
    assert.equal(filters.beginner, 'only');
    assert.equal(filters.q, 'Алга!');
  });

  it('переживает мусор в параметрах: ссылку правят руками', () => {
    const filters = parseFilters({
      view: 'галерея',
      period: 'вчера',
      month: '2026-13',
      weapons: 'longsword,,longsword, saber ,',
      city: '   ',
      team: 'yes',
      q: 'x'.repeat(500),
    }, TODAY);
    assert.equal(filters.view, 'ribbon', 'неизвестный вид — не повод падать, показываем ленту');
    assert.equal(filters.period, 'future');
    assert.equal(filters.month, '2026-11', 'тринадцатого месяца не бывает');
    assert.deepEqual(filters.weapons, ['longsword', 'saber'], 'пустые куски и дубли выброшены');
    assert.equal(parseFilters({ weapons: '' }, TODAY).weapons, null, 'пустой параметр — «все»');
    assert.deepEqual(parseFilters({ weapons: '-' }, TODAY).weapons, [], 'дефис — «ничего не выбрано»');
    assert.equal(filters.city, null);
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

  it('вид по умолчанию — лента, и в адрес он не пишется', () => {
    assert.equal(base.view, 'ribbon');
    assert.equal(filtersToSearch(base, TODAY), '');
    assert.equal(filtersToSearch({ ...base, view: 'month' }, TODAY), '?view=month');
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
      city: 'Казань',
      team: true,
      beginner: 'only',
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
    assert.equal(hasActiveFilters({ ...base, beginner: 'hide' }), true);
    assert.equal(hasActiveFilters({ ...base, weapons: [] }), true, 'пустой выбор — тоже фильтр');
    assert.equal(hasActiveFilters({ ...base, city: 'Казань' }), true);
    assert.equal(hasActiveFilters({ ...base, q: 'а' }), true);
  });
});

describe('видимый отрезок', () => {
  const base = parseFilters({}, TODAY);

  it('сетка месяца захватывает хвосты соседних месяцев', () => {
    // Ноябрь 2026 начинается в воскресенье: сетка идёт с 26 октября по 6 декабря.
    assert.deepEqual(visibleRange({ ...base, view: 'month', month: '2026-11' }, TODAY),
      { from: '2026-10-26', to: '2026-12-06' });
  });

  it('список: будущие — от сегодня, прошедшие — до сегодня, все — без границ', () => {
    assert.deepEqual(visibleRange({ ...base, view: 'list', period: 'future' }, TODAY), { from: TODAY, to: null });
    assert.deepEqual(visibleRange({ ...base, view: 'list', period: 'past' }, TODAY), { from: null, to: TODAY });
    assert.deepEqual(visibleRange({ ...base, view: 'list', period: 'all' }, TODAY), { from: null, to: null });
  });
});

const event = (over: Partial<CalendarEvent> & { slug: string; startsAt: string }): CalendarEvent => ({
  title: over.slug,
  endsAt: over.startsAt,
  city: null,
  macroRegion: null,
  countryCode: 'RU',
  locationManual: null,
  organizerName: null,
  externalUrl: null,
  nominations: [],
  ...over,
});

const nomination = (over: Partial<CalendarEvent['nominations'][number]> = {}) => ({
  weapon: 'Сабля',
  weaponCode: 'saber',
  gender: 'Any' as const,
  minAge: null,
  maxAge: null,
  isTeam: false,
  isBeginnerFriendly: false,
  ...over,
});

describe('отбор турниров', () => {
  const base = parseFilters({}, TODAY);

  it('сетка месяца берёт турнир, который идёт через её границу', () => {
    const events = [
      event({ slug: 'через-границу', startsAt: '2026-10-30', endsAt: '2026-11-02' }),
      event({ slug: 'раньше', startsAt: '2026-10-01', endsAt: '2026-10-02' }),
      event({ slug: 'позже', startsAt: '2027-01-10' }),
    ];
    const selected = selectEvents(events, { ...base, view: 'month', month: '2026-11' }, TODAY);
    assert.deepEqual(selected.map((e) => e.slug), ['через-границу']);
  });

  it('идущий сейчас турнир — будущий, но не прошедший', () => {
    const events = [event({ slug: 'идёт', startsAt: '2026-11-04', endsAt: '2026-11-06' })];
    assert.equal(selectEvents(events, { ...base, view: 'list', period: 'future' }, TODAY).length, 1);
    assert.equal(selectEvents(events, { ...base, view: 'list', period: 'past' }, TODAY).length, 0);
  });

  it('прошедшие идут от свежих к старым, будущие — от ближних к дальним', () => {
    const events = [
      event({ slug: 'давно', startsAt: '2020-05-30' }),
      event({ slug: 'недавно', startsAt: '2026-10-24' }),
      event({ slug: 'скоро', startsAt: '2026-11-14' }),
      event({ slug: 'нескоро', startsAt: '2027-03-13' }),
    ];
    assert.deepEqual(
      selectEvents(events, { ...base, view: 'list', period: 'past' }, TODAY).map((e) => e.slug),
      ['недавно', 'давно'],
    );
    assert.deepEqual(
      selectEvents(events, { ...base, view: 'list', period: 'future' }, TODAY).map((e) => e.slug),
      ['скоро', 'нескоро'],
    );
  });

  it('оружие, регион, город, команда и новички отбирают по существу', () => {
    const events = [
      event({
        slug: 'сабля-казань', startsAt: '2027-05-01', city: 'Казань', macroRegion: 'Поволжье',
        nominations: [nomination({ isBeginnerFriendly: true })],
      }),
      event({
        slug: 'меч-москва', startsAt: '2027-05-02', city: 'Москва', macroRegion: 'Центр',
        nominations: [nomination({ weapon: 'Длинный меч', weaponCode: 'longsword', isTeam: true })],
      }),
    ];
    const all = { ...base, view: 'list' as const, period: 'all' as const };
    const slugs = (f: Partial<CalendarFilters>) => selectEvents(events, { ...all, ...f }, TODAY).map((e) => e.slug);

    assert.deepEqual(slugs({}), ['сабля-казань', 'меч-москва'], 'без фильтров видно оба');
    assert.deepEqual(slugs({ weapons: ['saber'] }), ['сабля-казань']);
    assert.deepEqual(slugs({ regions: ['Центр'] }), ['меч-москва']);
    assert.deepEqual(slugs({ city: 'Казань' }), ['сабля-казань']);
    assert.deepEqual(slugs({ city: 'казань' }), ['сабля-казань'], 'город без учёта регистра');
    assert.deepEqual(slugs({ team: true }), ['меч-москва']);
    assert.deepEqual(slugs({ beginner: 'only' }), ['сабля-казань']);
    assert.deepEqual(slugs({ beginner: 'hide' }), ['меч-москва'], 'скрыть новичковые — убрать турниры с ними');
    assert.deepEqual(slugs({ weapons: ['saber', 'longsword'] }), ['сабля-казань', 'меч-москва'],
      'несколько видов оружия — это ИЛИ, а не И');
    assert.deepEqual(slugs({ weapons: [] }), [], 'снятый выбор показывает пустой календарь, а не всё');
  });

  it('поиск идёт по названию и организатору, без учёта регистра и ё', () => {
    const events = [
      event({ slug: 'по-названию', startsAt: '2027-06-01', title: 'Меч Ренессанса' }),
      event({ slug: 'по-организатору', startsAt: '2027-06-02', title: 'Кубок города', organizerName: 'Клуб «Ренессанс»' }),
      event({ slug: 'мимо', startsAt: '2027-06-03', title: 'Сабельная лига' }),
    ];
    const all = { ...base, view: 'list' as const, period: 'all' as const };
    assert.deepEqual(selectEvents(events, { ...all, q: 'ренессанс' }, TODAY).map((e) => e.slug),
      ['по-названию', 'по-организатору']);
    assert.deepEqual(selectEvents(events, { ...all, q: 'СабельнаЯ' }, TODAY).map((e) => e.slug), ['мимо']);
    assert.deepEqual(selectEvents(events, { ...all, q: 'ничего такого' }, TODAY), []);
  });

  it('нераспознанное оружие не ловится фильтром по коду', () => {
    const events = [event({
      slug: 'катана', startsAt: '2027-07-01',
      nominations: [nomination({ weapon: 'Катана', weaponCode: null })],
    })];
    const all = { ...base, view: 'list' as const, period: 'all' as const };
    assert.deepEqual(selectEvents(events, { ...all, weapons: ['saber'] }, TODAY), []);
    assert.equal(selectEvents(events, all, TODAY).length, 1, 'но сам турнир из календаря не пропадает');
  });
});
