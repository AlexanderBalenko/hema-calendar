'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  CalendarClock, CalendarDays, ChevronDown, Eye, EyeOff, LayoutList, Lock, MapPin, Rows3, Search,
  SlidersHorizontal, Sprout, Swords, Tag, Unlock, UsersRound,
} from 'lucide-react';

import { KIND_LABEL, type Directories } from '@/src/lib/data';
import {
  countActiveFilters,
  filtersToSearch,
  hasActiveFilters,
  hasPersonalFilters,
  type BeginnerFilter,
  type CalendarFilters,
  type ViewerGender,
  type ViewMode,
} from '@/src/lib/filters';
import { MultiDropdown } from './multi-dropdown';
import { Dropdown } from './select-arrow';
import { Mars, Venus, VenusAndMars } from './gender-icons';
import { WeaponIcon } from './weapon-icon';

/**
 * Строка фильтров — как в календаре портала hema.ru (slices/events/calendar-filter-bar.tsx):
 * оружие и регионы свёрнуты в дропдауны-мультиселекты (чипов было слишком много и строка
 * распухала), номинации — тумблеры, всё одной высоты 32px с одинаковой рамкой.
 *
 * Строка — аккордеон, как в портале: критерии турнира (оружие, регион, номинации) видны всегда,
 * критерии УЧАСТНИКА (возраст, пол, смешанные) уезжают за стрелку с точкой-индикатором. В портале
 * они приезжают из профиля и переопределяются руками; у нас аккаунтов нет, поэтому только руками —
 * и в браузере, ничего никуда не отправляя.
 *
 * Чего здесь нет из портального: «уведомлять о новых» и сохранённого фильтра — это про
 * залогиненного человека, которого календарь не знает.
 *
 * Своего состояния строка почти не держит: любое переключение — новый адрес страницы, а
 * перерисовка идёт из уже загруженных данных. Исключение — поля ввода: им нужен локальный
 * текст, иначе каждая буква уезжала бы в историю браузера.
 */
export const FILTER_CONTROL_CLASS =
  'flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-xs ring-1 ring-inset transition-colors';

const ACTIVE_CLASS = 'bg-primary/15 text-primary ring-primary/40';
const IDLE_CLASS = 'bg-background text-text-secondary ring-border-light hover:text-foreground';

/**
 * Телефонная шапка сворачивается сама (просьба заказчика 12.11.2026, docs/Calendar.md §5к).
 *
 * COLLAPSE_AT — за сколько точек прокрутки фильтры уезжают и за сколько возвращаются. Число одно
 * на оба направления: состояние считается ОТ ПОЛОЖЕНИЯ прокрутки, а не от её направления. Шапка,
 * выскакивающая от каждого движения вверх посреди ленты, — ровно то, на что заказчик и жаловался.
 *
 * KEEP_OPEN_SLACK — насколько можно шевелить страницу после того, как фильтры раскрыты кнопкой,
 * прежде чем они снова уедут. Без запаса первое же касание прокрутки закрывало бы только что
 * раскрытую панель.
 */
const COLLAPSE_AT = 40;
const KEEP_OPEN_SLACK = 80;
/** Замок — выбор устройства, а не ссылки: в адресе ему не место, он ничего не отбирает. */
const PIN_KEY = 'hema-calendar:filters-pinned';

const VIEW_ICON: Record<ViewMode, typeof Rows3> = { ribbon: Rows3, month: CalendarDays, list: LayoutList };
const VIEW_LABEL: Record<ViewMode, string> = { ribbon: 'Лента недель', month: 'Месяц', list: 'Список' };

export function FilterBar({
  filters,
  directories,
  today,
}: {
  filters: CalendarFilters;
  directories: Directories;
  today: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  // Свёрнутый аккордеон с заданными критериями участника выглядел бы как необъяснимо урезанный
  // календарь, поэтому открыт, если по ссылке уже пришёл возраст, пол или снятые смешанные.
  const [personalOpen, setPersonalOpen] = useState(hasPersonalFilters(filters));

  // Свёрнута ли шапка. Начальное значение — «развёрнута», как на сервере: страница собирается
  // заранее, ширины экрана и прокрутки на сборке нет, и любое другое начальное состояние дало бы
  // расхождение с разметкой при оживлении.
  const [collapsed, setCollapsed] = useState(false);
  const [pinned, setPinned] = useState(false);
  // Положение прокрутки, от которого отсчитывается запас после раскрытия кнопкой
  // (см. KEEP_OPEN_SLACK). Берётся не в момент нажатия, а на первом же событии прокрутки после
  // него: раскрытая панель удлиняет страницу на 152 точки, и браузер сам подвигает прокрутку,
  // чтобы читатель остался на том же месте. Запомни мы положение до этой поправки — запас
  // оказался бы уже израсходован, и панель закрылась бы от первого касания.
  const openedAt = useRef<number | null>(null);
  const justOpened = useRef(false);

  useEffect(() => {
    // Приватный режим и запрет сторонних данных бросают прямо на чтении — замок не настолько
    // важен, чтобы из-за него падала строка фильтров.
    try {
      setPinned(window.localStorage.getItem(PIN_KEY) === '1');
    } catch {
      /* обойдёмся без памяти */
    }
  }, []);

  useEffect(() => {
    const phone = window.matchMedia('(max-width: 639.98px)');
    const update = () => {
      if (pinned || !phone.matches) {
        setCollapsed(false);
        return;
      }
      const y = window.scrollY;
      if (justOpened.current) {
        justOpened.current = false;
        openedAt.current = y;
        setCollapsed(false);
        return;
      }
      if (openedAt.current !== null) {
        if (y <= openedAt.current + KEEP_OPEN_SLACK) {
          setCollapsed(false);
          return;
        }
        openedAt.current = null;
      }
      // Короткую страницу не сворачиваем: свернувшись, она перестала бы прокручиваться, прокрутка
      // обнулилась бы, фильтры вернулись — и шапка задёргалась бы на месте.
      const scrollable = document.documentElement.scrollHeight > window.innerHeight + 200;
      setCollapsed(scrollable && y > COLLAPSE_AT);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [pinned]);

  const openFilters = () => {
    justOpened.current = true;
    openedAt.current = null;
    setCollapsed(false);
  };

  const togglePin = () => {
    setPinned((on) => {
      const next = !on;
      try {
        window.localStorage.setItem(PIN_KEY, next ? '1' : '0');
      } catch {
        /* обойдёмся без памяти */
      }
      return next;
    });
  };

  const activeCount = countActiveFilters(filters);

  const apply = (next: CalendarFilters) => {
    startTransition(() => router.push(`${pathname}${filtersToSearch(next, today)}`, { scroll: false }));
  };

  const allWeapons = directories.weapons.map((w) => w.code);
  const allRegions = directories.macroRegions;
  // null значит «все»: пока выбор не сделан, фильтр ничего не отсекает и в адрес не пишется.
  const allKinds = directories.kinds ?? [];

  const selectedWeapons = filters.weapons ?? allWeapons;
  const selectedRegions = filters.regions ?? allRegions;
  const selectedKinds = filters.kinds ?? allKinds;

  return (
    <div
      aria-busy={pending}
      className={`flex flex-col gap-1.5 transition-opacity ${pending ? 'opacity-60' : ''}`}
    >
      {/* Свёрнутая шапка — одна строка вместо 184 точек фильтров (липкий блок 283 → 131, замер
          12.11.2026). Цифра обязательна: без неё свёрнутая шапка прятала бы от читателя сам факт,
          что выдача отфильтрована, и пустой календарь выглядел бы поломкой. */}
      {collapsed && (
        <button
          type="button"
          onClick={openFilters}
          aria-expanded={false}
          className={`${FILTER_CONTROL_CLASS} self-start font-medium sm:hidden ${
            activeCount > 0 ? ACTIVE_CLASS : IDLE_CLASS
          }`}
        >
          <SlidersHorizontal className="size-3.5 shrink-0" aria-hidden="true" />
          Фильтры
          {activeCount > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {activeCount}
            </span>
          )}
          <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden="true" />
        </button>
      )}

      <div className={`${collapsed ? 'hidden sm:flex' : 'flex'} flex-wrap items-center gap-1.5`}>
      <MultiDropdown
        label="Оружие"
        icon={<Swords className="size-3.5 shrink-0" aria-hidden="true" />}
        options={directories.weapons.map((w) => ({
          value: w.code,
          label: w.name,
          icon: <WeaponIcon code={w.code} size={18} />,
        }))}
        value={selectedWeapons}
        onChange={(values) => apply({ ...filters, weapons: values.length === allWeapons.length ? null : values })}
        // Решение заказчика портала: «показывать не текст, а пиктограммку» — названия видов в
        // триггер не влезают и распухают строку на второй ряд.
        renderValue={({ selected, all }) =>
          all || selected.length === 0 ? (
            <span className="truncate">{all ? 'все' : 'ничего'}</span>
          ) : (
            <span className="flex items-center gap-0.5">
              {selected.slice(0, 5).map((option) => (
                <WeaponIcon key={option.value} code={option.value} size={14} />
              ))}
              {selected.length > 5 && <span className="leading-none">+{selected.length - 5}</span>}
            </span>
          )
        }
      />

      <MultiDropdown
        label="Регион"
        icon={<MapPin className="size-3.5 shrink-0" aria-hidden="true" />}
        options={allRegions.map((region) => ({ value: region, label: region }))}
        value={selectedRegions}
        onChange={(values) => apply({ ...filters, regions: values.length === allRegions.length ? null : values })}
      />

      <button
        type="button"
        aria-pressed={filters.team}
        onClick={() => apply({ ...filters, team: !filters.team })}
        className={`${FILTER_CONTROL_CLASS} font-medium ${filters.team ? ACTIVE_CLASS : IDLE_CLASS}`}
      >
        <UsersRound className="size-3.5 shrink-0" aria-hidden="true" />
        Командные
      </button>

      <Dropdown
        value={filters.beginner}
        onChange={(value) => apply({ ...filters, beginner: value as BeginnerFilter })}
        icon={<Sprout className="size-3.5 shrink-0" aria-hidden="true" />}
        ariaLabel="Новичковые номинации"
        trigger={
          <span className="truncate">
            Новички: {filters.beginner === 'only' ? 'только' : filters.beginner === 'hide' ? 'скрыть' : 'все'}
          </span>
        }
        options={[
          { value: 'all', label: 'Показывать все' },
          { value: 'only', label: 'Только новичковые' },
          { value: 'hide', label: 'Скрывать новичковые' },
        ]}
        className={`${FILTER_CONTROL_CLASS} ${filters.beginner !== 'all' ? ACTIVE_CLASS : IDLE_CLASS}`}
      />

      <CityFilter cities={directories.cities} city={filters.city} onPick={(city) => apply({ ...filters, city })} />

      <SearchField value={filters.q} onChange={(q) => apply({ ...filters, q })} />

      {/* Переключателя периода здесь больше нет (решение заказчика 08.11.2026): список
          открывается будущим и подтягивает прошедшее прокруткой вверх, как лента, — спрашивать
          об этом отдельным контролом стало незачем. Сам параметр `period` остался: он разбирается
          из адреса, и прежние ссылки на архив (`?view=list&period=past`) работают. */}

      {/* Стрелка аккордеона: за ней критерии участника. Точка-индикатор обязательна — без неё
          заданный в свёрнутом состоянии возраст необъяснимо режет выдачу. */}
      <button
        type="button"
        aria-expanded={personalOpen}
        onClick={() => setPersonalOpen((open) => !open)}
        title="Критерии участника: возраст, пол, смешанные номинации"
        aria-label="Критерии участника: возраст, пол, смешанные номинации"
        className={`${FILTER_CONTROL_CLASS} ${hasPersonalFilters(filters) ? ACTIVE_CLASS : IDLE_CLASS}`}
      >
        <ChevronDown
          className={`size-3.5 shrink-0 transition-transform ${personalOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
        Подходит мне
        {hasPersonalFilters(filters) && (
          <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
        )}
      </button>

      {/* Тип стоит ПОСЛЕ «Подходит мне» и потому переносится во второй ряд (решение заказчика
          09.11.2026 по макету). Первым в ряду он по смыслу правильнее — «что это вообще»
          спрашивают раньше, чем «каким оружием», — но сжал бы поле поиска с 534 до 398 px, а
          во втором ряду до иконок видов место всё равно пустует. Пока в календаре один тип,
          контрола нет вовсе: фильтр с единственным вариантом ничего не отбирает. */}
      {allKinds.length > 1 && (
        <MultiDropdown
          label="Тип"
          icon={<Tag className="size-3.5 shrink-0" aria-hidden="true" />}
          options={allKinds.map((kind) => ({ value: kind, label: KIND_LABEL[kind] }))}
          value={selectedKinds}
          onChange={(values) => apply({ ...filters, kinds: values.length === allKinds.length ? null : values })}
          // Своя подпись, а не общая «все»: рядом с «Подходит мне» голое «все» ничего не
          // сообщает, а в первом ряду слово «тип» подсказывает иконка-ярлык вместе с соседями.
          renderValue={({ selected, all }) => (
            <span className="truncate">
              {all ? 'Тип: всё'
                : selected.length === 0 ? 'Тип: ничего'
                : selected.length <= 2 ? selected.map((option) => option.label).join(', ')
                : `тип: ${selected.length} из ${allKinds.length}`}
            </span>
          )}
        />
      )}

      {hasActiveFilters(filters) && (
        <button
          type="button"
          onClick={() => apply({
            ...filters,
            kinds: null, weapons: null, regions: null, city: null, team: false, beginner: 'all', q: '',
            age: null, gender: null, mixed: true,
          })}
          className="px-2 text-xs text-text-muted hover:text-primary"
        >
          Сбросить
        </button>
      )}

      {/* Глазик и виды — одной группой справа: оба про показ, а не про отбор. В портале глазик
          живёт в полоске месяцев, но она у нас не показывается в виде «список», где он нужен
          ровно так же. */}
      {/* Замок и виды — одной строкой на телефоне: фильтры там сворачиваются прокруткой, и
          замок говорит «не прячь». `sm:contents` растворяет обёртку на десктопе, где этой строки
          нет вовсе и группа видов прижата вправо среди чипов, как была. */}
      <div className="flex w-full items-center gap-2 sm:contents">
        <button
          type="button"
          aria-pressed={pinned}
          onClick={togglePin}
          title={pinned ? 'Разрешить прятать фильтры при прокрутке' : 'Не прятать фильтры при прокрутке'}
          aria-label={pinned ? 'Разрешить прятать фильтры при прокрутке' : 'Не прятать фильтры при прокрутке'}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors sm:hidden ${
            pinned ? 'bg-primary/15 text-primary' : 'text-text-muted hover:bg-card hover:text-foreground'
          }`}
        >
          {pinned
            ? <Lock className="size-4" aria-hidden="true" />
            : <Unlock className="size-4" aria-hidden="true" />}
        </button>

      <div className="ml-auto flex items-center gap-0.5">
        <button
          type="button"
          aria-pressed={filters.showUnsuitable}
          onClick={() => apply({ ...filters, showUnsuitable: !filters.showUnsuitable })}
          title={filters.showUnsuitable ? 'Скрывать неподходящие' : 'Показывать неподходящие неактивными'}
          aria-label={filters.showUnsuitable ? 'Скрывать неподходящие' : 'Показывать неподходящие неактивными'}
          className={`mr-1 flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
            filters.showUnsuitable ? 'bg-primary/15 text-primary' : 'text-text-muted hover:bg-card hover:text-foreground'
          }`}
        >
          {filters.showUnsuitable
            ? <Eye className="size-4" aria-hidden="true" />
            : <EyeOff className="size-4" aria-hidden="true" />}
        </button>

        {(['ribbon', 'month', 'list'] as ViewMode[]).map((mode) => {
          const Icon = VIEW_ICON[mode];
          const active = filters.view === mode;
          return (
            <button
              key={mode}
              type="button"
              aria-pressed={active}
              title={VIEW_LABEL[mode]}
              aria-label={VIEW_LABEL[mode]}
              onClick={() => apply({ ...filters, view: mode })}
              // Лента и сетка месяца на телефоне не показываются вовсе (решение заказчика
              // 12.11.2026): выбирать там не из чего, и кнопка вела бы в вид, которого нет.
              className={`h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                mode === 'list' ? 'flex' : 'hidden sm:flex'
              } ${
                active ? 'bg-primary/15 text-primary' : 'text-text-muted hover:bg-card hover:text-foreground'
              }`}
            >
              <Icon className="size-4" aria-hidden="true" />
            </button>
          );
        })}
      </div>
      </div>
      </div>

      {personalOpen && (
        <div className={`${collapsed ? 'hidden sm:flex' : 'flex'} flex-wrap items-center gap-1.5`}>
          <AgeChip age={filters.age} onChange={(age) => apply({ ...filters, age })} />

          <Dropdown
            value={filters.gender ?? ''}
            onChange={(value) => apply({ ...filters, gender: value === '' ? null : (value as ViewerGender) })}
            icon={
              filters.gender === 'male' ? <Mars className="size-3.5 shrink-0" />
                : filters.gender === 'female' ? <Venus className="size-3.5 shrink-0" />
                  : (
                    <span className="flex shrink-0 items-center -space-x-1">
                      <Venus className="size-3.5" />
                      <Mars className="size-3.5" />
                    </span>
                  )
            }
            ariaLabel="Пол участника"
            trigger={
              <span className="truncate">
                {filters.gender === 'male' ? 'мужской' : filters.gender === 'female' ? 'женский' : 'любой пол'}
              </span>
            }
            options={[
              { value: '', label: 'Любой' },
              { value: 'male', label: 'Мужской' },
              { value: 'female', label: 'Женский' },
            ]}
            className={`${FILTER_CONTROL_CLASS} ${filters.gender ? ACTIVE_CLASS : IDLE_CLASS}`}
          />

          {/* «Смешанные» — единственный тумблер, включённый по умолчанию: для одних смешанная
              номинация — шанс побиться с сильными, для других она просто опасна. Стоит вплотную к полу —
              уточняет именно его. */}
          <button
            type="button"
            aria-pressed={filters.mixed}
            onClick={() => apply({ ...filters, mixed: !filters.mixed })}
            title="Считать смешанные номинации подходящими"
            className={`${FILTER_CONTROL_CLASS} font-medium ${filters.mixed ? ACTIVE_CLASS : IDLE_CLASS}`}
          >
            <VenusAndMars className="size-3.5 shrink-0" />
            Смешанные
          </button>

          <span className="px-1 text-xs text-text-faint">
            Возраст и пол никуда не отправляются — отбор идёт в браузере.
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Возраст — чип, который по клику превращается в поле. Так в портале: ввод нужен редко, а место в
 * строке дорого. Отправляется по уходу из поля и по Enter, иначе адрес менялся бы на каждую цифру.
 */
function AgeChip({ age, onChange }: { age: number | null; onChange: (age: number | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(age === null ? '' : String(age));

  if (editing) {
    return (
      <input
        type="number"
        min={1}
        max={120}
        autoFocus
        value={draft}
        placeholder="Возраст"
        aria-label="Возраст участника"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          const parsed = Number(draft);
          onChange(draft.trim() === '' || Number.isNaN(parsed) ? null : parsed);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        // Нативные стрелки-спиннеры красятся браузером и в тёмной теме выглядят чужеродно.
        className="h-8 w-20 shrink-0 rounded-lg bg-background px-2 text-xs text-foreground ring-1 ring-inset ring-primary/40 focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    );
  }

  return (
    <button
      type="button"
      title="Возраст участника — по нему отсекаются номинации не по годам"
      onClick={() => {
        setDraft(age === null ? '' : String(age));
        setEditing(true);
      }}
      className={`${FILTER_CONTROL_CLASS} ${age === null ? IDLE_CLASS : ACTIVE_CLASS}`}
    >
      <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
      {age === null ? 'Возраст' : `${age} ${plural(age, ['год', 'года', 'лет'])}`}
    </button>
  );
}

function plural(count: number, forms: [string, string, string]): string {
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  const mod10 = count % 10;
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

/** Поиск: локальный текст и отложенная отправка, иначе на каждую букву менялся бы адрес. */
function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(value);
  const committed = useRef(value);

  // Синхронизация с адресом: «Сбросить» и кнопка «назад» меняют value мимо этого поля.
  useEffect(() => {
    committed.current = value;
    setText(value);
  }, [value]);

  useEffect(() => {
    if (text === committed.current) return;
    const timer = setTimeout(() => {
      committed.current = text;
      onChange(text.trim());
    }, 400);
    return () => clearTimeout(timer);
  }, [text, onChange]);

  return (
    // Поиск забирает остаток строки фильтров (просьба заказчика 08.11.2026: «расширим на всю
    // ширину, а то некрасиво»). Своей ширины у него больше нет, но есть нижняя граница: при
    // прежних w-48 полю оставалось 156px, а плейсхолдер «Название или организатор» занимает
    // 192px — подпись обрезалась на ЛЮБОМ экране, и ровно по слогу («Название или орган»).
    // min-w-60 (240px) — это 204px под текст, то есть запас в 12px.
    <span
      className={`${FILTER_CONTROL_CLASS} min-w-60 flex-1 ${value ? ACTIVE_CLASS : IDLE_CLASS}`}
    >
      <Search className="size-3.5 shrink-0" aria-hidden="true" />
      <input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Название или организатор"
        aria-label="Поиск по названию или организатору"
        className="w-full bg-transparent text-xs text-foreground placeholder:text-text-faint focus:outline-none"
      />
    </span>
  );
}

/**
 * Город — поиском по справочнику: городов почти две сотни, выпадающий список такой длины
 * бесполезен. В портале этого фильтра нет (там хватает региона), но здесь он главный способ
 * спросить «что у нас в Казани».
 */
function CityFilter({
  cities,
  city,
  onPick,
}: {
  cities: Directories['cities'];
  city: string | null;
  onPick: (city: string | null) => void;
}) {
  const [text, setText] = useState('');
  const selected = city ? cities.find((c) => c.name === city) : undefined;

  if (selected) {
    return (
      <span className={`${FILTER_CONTROL_CLASS} ${ACTIVE_CLASS}`}>
        <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
        {selected.name}
        <button type="button" onClick={() => onPick(null)} aria-label={`Убрать фильтр по городу ${selected.name}`}>
          ×
        </button>
      </span>
    );
  }

  const needle = text.trim().toLowerCase();
  const matches = needle.length < 2 ? [] : cities.filter((c) => c.name.toLowerCase().includes(needle)).slice(0, 8);

  return (
    <div className="relative">
      <span className={`${FILTER_CONTROL_CLASS} w-32 ${IDLE_CLASS}`}>
        <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Город"
          aria-label="Фильтр по городу"
          className="w-full bg-transparent text-xs text-foreground placeholder:text-text-faint focus:outline-none"
        />
      </span>
      {matches.length > 0 && (
        <ul className="absolute z-30 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-lg">
          {matches.map((match) => (
            <li key={match.id}>
              <button
                type="button"
                onClick={() => {
                  setText('');
                  onPick(match.name);
                }}
                className="block w-full px-3 py-1 text-left text-xs text-text-secondary hover:bg-background-secondary hover:text-foreground"
              >
                {match.name}
                <span className="ml-2 text-[10px] text-text-faint">{match.macroRegion}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
