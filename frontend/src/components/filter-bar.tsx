'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  CalendarClock, CalendarDays, ChevronDown, Eye, EyeOff, LayoutList, MapPin, Rows3, Search, Sprout,
  Swords, UsersRound,
} from 'lucide-react';

import type { Directories } from '@/src/lib/data';
import {
  filtersToSearch,
  hasActiveFilters,
  hasPersonalFilters,
  type BeginnerFilter,
  type CalendarFilters,
  type Period,
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

const PERIOD_LABELS: Record<Period, string> = { future: 'Будущие', past: 'Прошедшие', all: 'Все' };
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

  const apply = (next: CalendarFilters) => {
    startTransition(() => router.push(`${pathname}${filtersToSearch(next, today)}`, { scroll: false }));
  };

  const allWeapons = directories.weapons.map((w) => w.code);
  const allRegions = directories.macroRegions;
  // null значит «все»: пока выбор не сделан, фильтр ничего не отсекает и в адрес не пишется.
  const selectedWeapons = filters.weapons ?? allWeapons;
  const selectedRegions = filters.regions ?? allRegions;

  return (
    <div
      aria-busy={pending}
      className={`flex flex-col gap-1.5 transition-opacity ${pending ? 'opacity-60' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
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

      {/* Период имеет смысл только у списка: лента и сетка листаются месяцами. */}
      {filters.view === 'list' && (
        <Dropdown
          value={filters.period}
          onChange={(value) => apply({ ...filters, period: value as Period })}
          ariaLabel="Период"
          trigger={<span className="truncate">{PERIOD_LABELS[filters.period]}</span>}
          options={(['future', 'past', 'all'] as Period[]).map((value) => ({ value, label: PERIOD_LABELS[value] }))}
          className={`${FILTER_CONTROL_CLASS} ${filters.period !== 'future' ? ACTIVE_CLASS : IDLE_CLASS}`}
        />
      )}

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

      {hasActiveFilters(filters) && (
        <button
          type="button"
          onClick={() => apply({
            ...filters,
            weapons: null, regions: null, city: null, team: false, beginner: 'all', q: '',
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
      <div className="ml-auto flex items-center gap-0.5">
        <button
          type="button"
          aria-pressed={filters.showUnsuitable}
          onClick={() => apply({ ...filters, showUnsuitable: !filters.showUnsuitable })}
          title={filters.showUnsuitable ? 'Скрывать неподходящие турниры' : 'Показывать неподходящие турниры неактивными'}
          aria-label={filters.showUnsuitable ? 'Скрывать неподходящие турниры' : 'Показывать неподходящие турниры неактивными'}
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
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                active ? 'bg-primary/15 text-primary' : 'text-text-muted hover:bg-card hover:text-foreground'
              }`}
            >
              <Icon className="size-4" aria-hidden="true" />
            </button>
          );
        })}
      </div>
      </div>

      {personalOpen && (
        <div className="flex flex-wrap items-center gap-1.5">
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

          {/* «Смешанные» — единственный тумблер, включённый по умолчанию: для одних смешанный
              зачёт шанс побиться с сильными, для других он просто опасен. Стоит вплотную к полу —
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
    <span className={`${FILTER_CONTROL_CLASS} w-48 ${value ? ACTIVE_CLASS : IDLE_CLASS}`}>
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
