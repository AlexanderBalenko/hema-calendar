'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { CalendarDays, LayoutList, MapPin, Rows3, Search, Sprout, Swords, UsersRound } from 'lucide-react';

import type { Directories } from '@/src/lib/data';
import {
  filtersToSearch,
  hasActiveFilters,
  type BeginnerFilter,
  type CalendarFilters,
  type Period,
  type ViewMode,
} from '@/src/lib/filters';
import { MultiDropdown } from './multi-dropdown';
import { Dropdown } from './select-arrow';
import { WeaponIcon } from './weapon-icon';

/**
 * Строка фильтров — как в календаре портала hema.ru (slices/events/calendar-filter-bar.tsx):
 * оружие и регионы свёрнуты в дропдауны-мультиселекты (чипов было слишком много и строка
 * распухала), номинации — тумблеры, всё одной высоты 32px с одинаковой рамкой.
 *
 * Чего здесь нет из портального: критериев УЧАСТНИКА (возраст, пол, смешанные номинации) и
 * «уведомлять о новых» — это про залогиненного человека, которого календарь не знает.
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
      className={`flex flex-wrap items-center gap-1.5 transition-opacity ${pending ? 'opacity-60' : ''}`}
    >
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

      {hasActiveFilters(filters) && (
        <button
          type="button"
          onClick={() => apply({ ...filters, weapons: null, regions: null, city: null, team: false, beginner: 'all', q: '' })}
          className="px-2 text-xs text-text-muted hover:text-primary"
        >
          Сбросить
        </button>
      )}

      {/* Виды — иконками справа, как в портале. */}
      <div className="ml-auto flex items-center gap-0.5">
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
  );
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
