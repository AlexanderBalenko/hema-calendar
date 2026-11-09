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
      kinds: null,
      weapons: null,
      regions: null,
      city: null,
      team: false,
      beginner: 'all',
      q: '',
      age: null,
      gender: null,
      mixed: true,
      showUnsuitable: false,
      weeks: 12,
      back: 0,
    });
  });

  it('развёрнутая лента читается из адреса и переживает мусор', () => {
    assert.equal(parseFilters({ weeks: '28' }, TODAY).weeks, 28);
    assert.equal(parseFilters({ weeks: '4' }, TODAY).weeks, 12, 'меньше начального окна не бывает');
    assert.equal(parseFilters({ weeks: '100000' }, TODAY).weeks, 520, 'рост окна ограничен');
    assert.equal(parseFilters({ weeks: 'много' }, TODAY).weeks, 12);
    assert.equal(parseFilters({ weeks: '12.5' }, TODAY).weeks, 12);
    assert.equal(parseFilters({ back: '16' }, TODAY).back, 16);
    assert.equal(parseFilters({ back: '-4' }, TODAY).back, 0, 'назад меньше нуля не листают');
    assert.equal(parseFilters({ back: '100000' }, TODAY).back, 520);
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
      age: '17',
      gender: 'Female',
      mixed: '0',
      showUnsuitable: '1',
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
    assert.equal(filters.age, 17);
    assert.equal(filters.gender, 'female', 'пол из портальной ссылки пишется с большой буквы');
    assert.equal(filters.mixed, false);
    assert.equal(filters.showUnsuitable, true);
  });

  it('возраст и пол переживают мусор: это тоже правят руками', () => {
    assert.equal(parseFilters({ age: '0' }, TODAY).age, null, 'нулевого возраста не бывает');
    assert.equal(parseFilters({ age: '121' }, TODAY).age, null);
    assert.equal(parseFilters({ age: 'семнадцать' }, TODAY).age, null);
    assert.equal(parseFilters({ age: '17.5' }, TODAY).age, null);
    assert.equal(parseFilters({ age: '17' }, TODAY).age, 17);
    assert.equal(parseFilters({ gender: 'другой' }, TODAY).gender, null,
      'нераспознанный пол — «любой»: молча урезать человеку календарь по мусору хуже всего');
    assert.equal(parseFilters({ mixed: 'нет' }, TODAY).mixed, true, 'смешанные выключает только «0»');
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
    assert.deepEqual(parseFilters({ weapons: 'none' }, TODAY).weapons, [], '«none» — ничего не выбрано');
    assert.deepEqual(parseFilters({ weapons: '-' }, TODAY).weapons, [], 'дефис из прежних ссылок — тоже');
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

  it('развёрнутая лента пишется в адрес, начальная — нет', () => {
    // Без этого развёрнутая лента забывалась, стоило зайти в турнир и вернуться назад.
    assert.equal(filtersToSearch({ ...base, weeks: 12, back: 0 }, TODAY), '');
    assert.equal(filtersToSearch({ ...base, weeks: 28 }, TODAY), '?weeks=28');
    assert.equal(filtersToSearch({ ...base, back: 16 }, TODAY), '?back=16', 'прошлое — своим параметром');
    assert.equal(filtersToSearch({ ...base, view: 'list', weeks: 28 }, TODAY), '?view=list',
      'ширина окна ленты в списке ничего не значит');
    // А вот подтянутое прошлое значит и в списке: он листается вверх так же, как лента, и
    // ссылкой с ним делятся так же.
    assert.equal(filtersToSearch({ ...base, view: 'list', back: 16 }, TODAY), '?view=list&back=16');
    assert.equal(filtersToSearch({ ...base, view: 'list', period: 'past', back: 16 }, TODAY),
      '?view=list&period=past', 'у «прошедших» прокрутка вверх смысла не имеет');
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
      kinds: ['camp'],
      weapons: ['saber'],
      regions: ['ЦФО'],
      city: 'Казань',
      team: true,
      beginner: 'only',
      q: 'алга',
      age: 17,
      gender: 'female',
      mixed: false,
      showUnsuitable: true,
      weeks: 12,
      back: 0,
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

  it('подтянутое прокруткой прошлое опускает нижнюю границу списка', () => {
    // Список листается вверх так же, как лента: `back` — недели прошлого, уже подтянутые
    // прокруткой. Без этого нижняя граница оставалась бы «сегодня», и вверх расти было бы некуда.
    assert.deepEqual(visibleRange({ ...base, view: 'list', period: 'future', back: 2 }, TODAY),
      { from: '2026-10-22', to: null }, 'две недели назад от 5 ноября');
    // На «прошедшие» и «все» прокрутка вверх не влияет: там и так всё прошлое.
    assert.deepEqual(visibleRange({ ...base, view: 'list', period: 'past', back: 2 }, TODAY),
      { from: null, to: TODAY });
  });
});

const event = (over: Partial<CalendarEvent> & { slug: string; startsAt: string }): CalendarEvent => ({
  title: over.slug,
  endsAt: over.startsAt,
  kind: 'tournament',
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
    assert.deepEqual(slugs({ beginner: 'hide' }), ['меч-москва'],
      'скрыть новичковые — убрать турнир, где новичковые ВСЕ номинации');
    assert.deepEqual(slugs({ weapons: ['saber', 'longsword'] }), ['сабля-казань', 'меч-москва'],
      'несколько видов оружия — это ИЛИ, а не И');
    assert.deepEqual(slugs({ weapons: [] }), [], 'снятый выбор показывает пустой календарь, а не всё');
  });

  it('«скрыть новичковые» оставляет турнир, где новичковая номинация лишь одна из нескольких', () => {
    const events = [
      event({
        slug: 'обе-номинации',
        startsAt: '2027-05-01',
        nominations: [nomination({ isBeginnerFriendly: true }), nomination()],
      }),
      event({ slug: 'только-новички', startsAt: '2027-05-02', nominations: [nomination({ isBeginnerFriendly: true })] }),
    ];
    const all = { ...base, view: 'list' as const, period: 'all' as const };
    assert.deepEqual(
      selectEvents(events, { ...all, beginner: 'hide' }, TODAY).map((e) => e.slug),
      ['обе-номинации'],
      'опытному бойцу турнир со взрослой номинацией подходит, даже если рядом есть новичковая',
    );
    assert.deepEqual(
      selectEvents(events, { ...all, beginner: 'only' }, TODAY).map((e) => e.slug),
      ['обе-номинации', 'только-новички'],
      '«только новички» — где такая номинация ЕСТЬ, а не где она единственная',
    );
  });

  it('турнир без номинаций проходит любой номинационный фильтр, но не фильтр региона', () => {
    const events = [
      event({ slug: 'без-номинаций', startsAt: '2027-05-01', macroRegion: 'Центр', nominations: [] }),
      event({ slug: 'с-саблей', startsAt: '2027-05-02', macroRegion: 'Центр', nominations: [nomination()] }),
    ];
    const all = { ...base, view: 'list' as const, period: 'all' as const };
    const slugs = (f: Partial<CalendarFilters>) => selectEvents(events, { ...all, ...f }, TODAY).map((e) => e.slug);

    // Лекция и лагерь без сетки — тоже турниры календаря: прятать по оружию то, у чего оружия не
    // заявлено, значит вычеркнуть их для всех, кто хоть раз тронул фильтр.
    assert.deepEqual(slugs({ weapons: ['rapier'] }), ['без-номинаций']);
    assert.deepEqual(slugs({ weapons: [] }), ['без-номинаций']);
    assert.deepEqual(slugs({ age: 30 }), ['без-номинаций', 'с-саблей']);
    assert.deepEqual(slugs({ age: 12 }), ['без-номинаций'],
      'у турнира без номинаций нет и возрастных рамок — в отличие от взрослой номинации рядом');
    assert.deepEqual(slugs({ team: true }), ['без-номинаций']);
    assert.deepEqual(slugs({ beginner: 'only' }), ['без-номинаций']);
    // Регион — свойство турнира, не номинации, и действует даже когда номинаций нет.
    assert.deepEqual(slugs({ regions: ['Урал'] }), []);
  });

  it('пригодность считается пересечением на уровне номинации — канонический пример спеки', () => {
    // Турнир со смешанной рапирой 16+ и мужским длинным мечом 18+.
    const events = [
      event({
        slug: 'рапира-и-меч',
        startsAt: '2027-05-01',
        nominations: [
          nomination({ weapon: 'Рапира', weaponCode: 'rapier', minAge: 16 }),
          nomination({ weapon: 'Длинный меч', weaponCode: 'longsword', gender: 'Male', minAge: 18 }),
        ],
      }),
    ];
    const all = { ...base, view: 'list' as const, period: 'all' as const };
    const count = (f: Partial<CalendarFilters>) => selectEvents(events, { ...all, ...f }, TODAY).length;

    assert.equal(count({ weapons: ['rapier', 'saber'], age: 17, gender: 'male' }), 1, 'парню 17 рапира подходит');
    assert.equal(count({ weapons: ['rapier', 'saber'], age: 19, gender: 'female' }), 1, 'девушке 19 — тоже');
    assert.equal(count({ weapons: ['saber', 'longsword'], age: 17, gender: 'male' }), 0,
      'меч есть, но ему 18+ — а рапира под фильтр оружия не попала');
    assert.equal(count({ weapons: ['saber', 'longsword'], age: 19, gender: 'female' }), 0,
      'меч по возрасту подходит, но он мужской');
    assert.equal(count({ weapons: ['saber', 'longsword'], age: 19, gender: 'male' }), 1);
  });

  it('номинация без указанного возраста — взрослая, 18+', () => {
    // Так в портале: MinAge — поле обязательное со значением по умолчанию 18, состояния «возраст
    // не указан» там нет. У нас возраст проставлен у одной номинации из десяти, и без этого
    // правила двенадцатилетнему подходил бы весь календарь.
    const events = [
      event({ slug: 'взрослый', startsAt: '2027-05-01', nominations: [nomination()] }),
      event({ slug: 'юношеский', startsAt: '2027-05-02', nominations: [nomination({ minAge: 12, maxAge: 17 })] }),
      event({ slug: 'с-14', startsAt: '2027-05-03', nominations: [nomination({ minAge: 14 })] }),
    ];
    const all = { ...base, view: 'list' as const, period: 'all' as const };
    const slugs = (f: Partial<CalendarFilters>) => selectEvents(events, { ...all, ...f }, TODAY).map((e) => e.slug);

    assert.deepEqual(slugs({ age: 12 }), ['юношеский'], 'двенадцатилетнему взрослый турнир не подходит');
    assert.deepEqual(slugs({ age: 16 }), ['юношеский', 'с-14']);
    assert.deepEqual(slugs({ age: 18 }), ['взрослый', 'с-14'], 'в юношеский с верхней границей 17 уже поздно');
    assert.deepEqual(slugs({}), ['взрослый', 'юношеский', 'с-14'], 'без указанного возраста не отсекаем ничего');
  });

  it('тумблер «смешанные» — часть проверки пола', () => {
    const events = [
      event({ slug: 'только-смешанная', startsAt: '2027-05-01', nominations: [nomination()] }),
      event({
        slug: 'есть-женская',
        startsAt: '2027-05-02',
        nominations: [nomination(), nomination({ gender: 'Female' })],
      }),
    ];
    const all = { ...base, view: 'list' as const, period: 'all' as const };
    const slugs = (f: Partial<CalendarFilters>) => selectEvents(events, { ...all, ...f }, TODAY).map((e) => e.slug);

    assert.deepEqual(slugs({ gender: 'female' }), ['только-смешанная', 'есть-женская'],
      'смешанная номинация подходит женщине, пока тумблер включён');
    assert.deepEqual(slugs({ gender: 'female', mixed: false }), ['есть-женская'],
      'выключили смешанные — остался турнир с отдельной женской номинацией');
    assert.deepEqual(slugs({ mixed: false }), ['есть-женская'],
      'тумблер работает и без указанного пола: это выбор фильтра, а не свойство человека');
  });

  it('глазик показывает неподходящие неактивными, а не скрывает их', () => {
    const events = [
      event({ slug: 'сабля', startsAt: '2027-05-01', nominations: [nomination()] }),
      event({
        slug: 'меч',
        startsAt: '2027-05-02',
        nominations: [nomination({ weapon: 'Длинный меч', weaponCode: 'longsword' })],
      }),
    ];
    const all = { ...base, view: 'list' as const, period: 'all' as const, weapons: ['saber'] };

    assert.deepEqual(selectEvents(events, all, TODAY).map((e) => e.slug), ['сабля'],
      'по умолчанию неподходящее скрыто: иначе эффект фильтра не считывается');

    const shown = selectEvents(events, { ...all, showUnsuitable: true }, TODAY);
    assert.deepEqual(shown.map((e) => [e.slug, e.isSuitable, e.unsuitableReason]), [
      ['сабля', true, null],
      ['меч', false, 'нет выбранного оружия'],
    ]);
  });

  it('причина «не подходит» — сужающимся каскадом: оружие, потом пол, потом возраст', () => {
    const reason = (over: Partial<CalendarEvent>, f: Partial<CalendarFilters>) => selectEvents(
      [event({ slug: 'т', startsAt: '2027-05-01', macroRegion: 'Центр', ...over })],
      { ...base, view: 'list', period: 'all', showUnsuitable: true, ...f },
      TODAY,
    )[0]?.unsuitableReason;

    const saberOnly = { nominations: [nomination({ gender: 'Male' as const, minAge: 18 })] };
    assert.equal(reason(saberOnly, { weapons: ['rapier'] }), 'нет выбранного оружия');
    assert.equal(reason(saberOnly, { weapons: ['saber'], gender: 'female' }), 'нет номинаций вашего пола');
    assert.equal(reason(saberOnly, { weapons: ['saber'], gender: 'male', age: 15 }),
      'возраст не попадает в номинации', 'пол подошёл — говорим уже про возраст');
    assert.equal(reason({ nominations: [nomination()] }, { mixed: false }), 'только смешанные номинации');
    assert.equal(reason(saberOnly, { team: true }), 'нет командной номинации');
    assert.equal(reason(saberOnly, { regions: ['Урал'] }), 'не ваш регион: Центр');
    assert.equal(reason({ macroRegion: null, nominations: [nomination()] }, { regions: ['Урал'] }),
      'не указан регион', 'молча прятать событие без региона нельзя — человек должен видеть, почему');
    assert.equal(reason(saberOnly, { regions: [] }), 'регион не выбран');
  });

  it('оружие считается объединением номинаций и заявленных дисциплин', () => {
    // Фест без турнира внутри: номинаций нет, и список дисциплин — единственное, что о его
    // оружии известно. Пара проверок обязательна: без второй первая ничего не доказывает —
    // событие проходило бы фильтр и при полностью сломанном правиле.
    const fest = {
      slug: 'фест', startsAt: '2027-05-01', kind: 'camp' as const,
      weapons: [{ name: 'Сабля', code: 'saber' }, { name: 'Рапира', code: 'rapier' }],
    };
    const pick = (f: Partial<CalendarFilters>) =>
      selectEvents([event(fest)], { ...base, view: 'list', period: 'all', ...f }, TODAY).length;

    assert.equal(pick({ weapons: ['saber'] }), 1, 'сабля заявлена — фест в выдаче');
    assert.equal(pick({ weapons: ['longsword'] }), 0, 'длинного меча в программе нет — фест уходит');
    assert.equal(pick({ weapons: null }), 1, 'фильтр снят — фест на месте');

    // Фест с турниром внутри: оружие турнира подходит так же, как заявленное в программе.
    const withInner = { ...fest, nominations: [nomination({ weaponCode: 'longsword' })] };
    assert.equal(
      selectEvents([event(withInner)], { ...base, view: 'list', period: 'all', weapons: ['longsword'] }, TODAY).length,
      1, 'оружие турнира внутри феста тоже считается');
  });

  it('событие без заявленного оружия проходит любой фильтр по оружию', () => {
    // Правило портала: прятать по оружию то, у чего оружия не заявлено вовсе, значит
    // вычёркивать лекции и анонсы без программы для всех, кто хоть раз тронул фильтр.
    const bare = event({ slug: 'лекция', startsAt: '2027-05-01', kind: 'lecture' });
    assert.equal(
      selectEvents([bare], { ...base, view: 'list', period: 'all', weapons: ['longsword'] }, TODAY).length,
      1);
  });

  it('онлайн проходит любой фильтр по региону, офлайн без региона — нет', () => {
    const online = event({ slug: 'онлайн', startsAt: '2027-05-01', kind: 'lecture', online: true });
    const offline = event({ slug: 'офлайн', startsAt: '2027-05-01', kind: 'lecture' });
    const pick = (item: CalendarEvent) =>
      selectEvents([item], { ...base, view: 'list', period: 'all', regions: ['Урал'] }, TODAY).length;

    assert.equal(pick(online), 1, 'онлайн равно доступен откуда угодно');
    assert.equal(pick(offline), 0, 'а офлайн без региона в фильтр по региону не попадает');
  });

  it('фильтр по типу отбирает и отсекает', () => {
    const items = [
      event({ slug: 'турнир', startsAt: '2027-05-01' }),
      event({ slug: 'лагерь', startsAt: '2027-05-02', kind: 'camp' }),
    ];
    const picked = (kinds: string[] | null) =>
      selectEvents(items, { ...base, view: 'list', period: 'all', kinds }, TODAY).map((e) => e.slug);

    assert.deepEqual(picked(['camp']), ['лагерь']);
    assert.deepEqual(picked(null), ['турнир', 'лагерь'], 'фильтр снят — видно всё');
    assert.deepEqual(picked([]), [], 'снято всё — пусто, как у оружия и региона');
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
