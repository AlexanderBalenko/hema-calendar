'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import type { Directories } from '@/src/lib/api';
import { CityPicker, Segmented, Toggle } from './controls';
import {
  filtersToSearch,
  hasActiveFilters,
  type CalendarFilters,
  type Period,
  type ViewMode,
} from '@/src/lib/filters';

const PERIOD_LABELS: Record<Period, string> = { future: 'Будущие', past: 'Прошедшие', all: 'Весь календарь' };
const VIEW_LABELS: Record<ViewMode, string> = { month: 'Месяц', list: 'Список' };

/**
 * Полоска фильтров. Своего состояния почти не держит: любое переключение — это новый адрес
 * страницы, а список и сетку перерисовывает сервер. Исключение одно — поля ввода (поиск и город):
 * им нужен локальный текст, иначе каждая буква уезжала бы в историю браузера.
 */
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
  // Перерисовывает сервер, и на слабом стенде это секунда-две: без признака ожидания кажется,
  // что нажатие не сработало, и человек жмёт второй раз — то есть снимает только что
  // поставленный фильтр.
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(hasActiveFilters(filters));

  const apply = (next: CalendarFilters) => {
    startTransition(() => router.push(`${pathname}${filtersToSearch(next, today)}`, { scroll: false }));
  };

  const toggleIn = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  const activeCount = filters.weapons.length + filters.regions.length
    + (filters.cityId ? 1 : 0) + (filters.team ? 1 : 0) + (filters.beginner ? 1 : 0) + (filters.q ? 1 : 0);

  return (
    <div
      aria-busy={pending}
      className={`flex flex-col gap-3 rounded-xl bg-card p-3 transition-opacity ${pending ? 'opacity-60' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SearchField value={filters.q} onChange={(q) => apply({ ...filters, q })} />

        <Segmented
          options={(['month', 'list'] as ViewMode[]).map((value) => ({ value, label: VIEW_LABELS[value] }))}
          value={filters.view}
          onChange={(view) => apply({ ...filters, view })}
        />

        {filters.view === 'list' && (
          <Segmented
            options={(['future', 'past', 'all'] as Period[]).map((value) => ({ value, label: PERIOD_LABELS[value] }))}
            value={filters.period}
            onChange={(period) => apply({ ...filters, period })}
          />
        )}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="ml-auto rounded-lg border border-border px-3 py-1.5 text-sm text-text-secondary hover:border-border-light hover:text-foreground"
        >
          Фильтры{activeCount > 0 && <span className="ml-1 text-primary">· {activeCount}</span>}
        </button>
      </div>

      {open && (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <ChipGroup
            label="Оружие"
            options={directories.weapons.map((w) => ({ value: w.code, label: w.name }))}
            selected={filters.weapons}
            onToggle={(code) => apply({ ...filters, weapons: toggleIn(filters.weapons, code) })}
          />

          <ChipGroup
            label="Регион"
            options={directories.macroRegions.map((r) => ({ value: r, label: r }))}
            selected={filters.regions}
            onToggle={(region) => apply({ ...filters, regions: toggleIn(filters.regions, region) })}
          />

          <div className="flex flex-wrap items-center gap-2">
            <CityPicker
              cities={directories.cities}
              cityId={filters.cityId}
              onPick={(cityId) => apply({ ...filters, cityId })}
            />
            <Toggle
              label="Командные"
              active={filters.team}
              onClick={() => apply({ ...filters, team: !filters.team })}
            />
            <Toggle
              label="Для новичков"
              active={filters.beginner}
              onClick={() => apply({ ...filters, beginner: !filters.beginner })}
            />
            {hasActiveFilters(filters) && (
              <button
                type="button"
                onClick={() => apply({ ...filters, weapons: [], regions: [], cityId: null, team: false, beginner: false, q: '' })}
                className="ml-auto text-sm text-text-muted hover:text-primary"
              >
                Сбросить
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Поиск: локальный текст + отложенная отправка, иначе на каждую букву уходил бы запрос. */
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
    <input
      type="search"
      value={text}
      onChange={(e) => setText(e.target.value)}
      placeholder="Название или организатор"
      aria-label="Поиск по названию или организатору"
      className="min-w-[200px] flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-text-faint focus:border-primary focus:outline-none"
    />
  );
}

function ChipGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="w-16 shrink-0 text-xs uppercase tracking-wide text-text-muted">{label}</span>
      {options.map((option) => (
        <Toggle
          key={option.value}
          label={option.label}
          active={selected.includes(option.value)}
          onClick={() => onToggle(option.value)}
        />
      ))}
    </div>
  );
}
