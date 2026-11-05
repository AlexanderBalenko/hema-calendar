'use client';

import { useEffect, useRef, useState } from 'react';

type City = { id: number; name: string; macroRegion: string };

/**
 * Свои контролы вместо нативных: чекбоксы и селекты браузера в тёмной теме выглядят белыми
 * коробками и ломают вид страницы. Набор намеренно маленький — ровно то, что нужно календарю.
 */

export function Toggle({
  label,
  active,
  onClick,
  title,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm transition-colors ${
        active
          ? 'border-primary bg-primary/20 text-primary-light'
          : 'border-border text-text-secondary hover:border-border-light hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-border" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={`px-3 py-1.5 text-sm ${
            option.value === value
              ? 'bg-primary/20 text-primary-light'
              : 'text-text-secondary hover:bg-background-secondary hover:text-foreground'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Выпадающий список: кнопка со значением и список вариантов. Закрывается кликом мимо и Esc. */
export function Dropdown<T extends string | number>({
  value,
  options,
  onChange,
  placeholder = 'Выбрать',
  label,
  className = '',
}: {
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={box} className={`relative ${className}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-left text-sm text-foreground hover:border-border-light"
      >
        {current?.label ?? <span className="text-text-faint">{placeholder}</span>}
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full min-w-[180px] overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-lg"
        >
          {options.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`block w-full px-3 py-1 text-left text-sm hover:bg-background-secondary ${
                  option.value === value ? 'text-primary-light' : 'text-text-secondary hover:text-foreground'
                }`}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Город — поиском по справочнику, а не списком: городов почти двести, выпадающий список такой
 * длины бесполезен. Выбранный город показывается плашкой с крестиком.
 */
export function CityPicker({
  cities,
  cityId,
  onPick,
}: {
  cities: readonly City[];
  cityId: number | null;
  onPick: (cityId: number | null) => void;
}) {
  const [text, setText] = useState('');
  const selected = cityId ? cities.find((c) => c.id === cityId) : undefined;

  if (selected) {
    return (
      <span className="flex items-center gap-2 rounded-full border border-primary bg-primary/20 px-3 py-1 text-sm text-primary-light">
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
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Город"
        aria-label="Фильтр по городу"
        className="w-40 rounded-full border border-border bg-background px-3 py-1 text-sm text-foreground placeholder:text-text-faint focus:border-primary focus:outline-none"
      />
      {matches.length > 0 && (
        <ul className="absolute z-10 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-lg">
          {matches.map((city) => (
            <li key={city.id}>
              <button
                type="button"
                onClick={() => {
                  setText('');
                  onPick(city.id);
                }}
                className="block w-full px-3 py-1 text-left text-sm text-text-secondary hover:bg-background-secondary hover:text-foreground"
              >
                {city.name}
                <span className="ml-2 text-xs text-text-faint">{city.macroRegion}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
