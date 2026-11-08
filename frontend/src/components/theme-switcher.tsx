'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Переключатель темы — перенос портального (просьба заказчика 08.11.2026). Тем у портала
 * четыре, календарю взяты две: тёмная по умолчанию и светлая-пергамент. Остальные две
 * (графит, махагон) — это ещё по одному блоку токенов в globals.css, если понадобятся.
 *
 * Живёт в подвале, как в портале: тема нужна прежде всего тем, кому «темновато», и спрятанный
 * в меню переключатель они не найдут, а в шапке календаря он отнимал бы место у фильтров.
 *
 * Сама тема — это атрибут data-theme на <html> плюс набор токенов в globals.css. Выбор
 * хранится в localStorage и ставится ДО первой отрисовки инлайн-скриптом в layout; здесь
 * только интерфейс поверх уже применённого значения.
 */
const THEME_KEY = 'hema_theme';

type Theme = 'dark' | 'light';

const THEMES: { value: Theme; label: string; icon: typeof Moon }[] = [
  { value: 'dark', label: 'Тёмная тема', icon: Moon },
  { value: 'light', label: 'Светлая тема', icon: Sun },
];

function savedTheme(): Theme {
  try {
    // Белый список тот же, что в инлайн-скрипте layout: в хранилище мог остаться и мусор, и
    // значение темы портала, которой у календаря нет.
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function ThemeSwitcher() {
  // До монтирования рисуем умолчание: серверная разметка про localStorage не знает, и чтение
  // темы прямо в useState дало бы расхождение гидрации.
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    setTheme(savedTheme());
  }, []);

  const apply = (next: Theme) => {
    setTheme(next);
    // Сначала сама тема, потом запоминание: падение localStorage (приватный режим) не должно
    // мешать переключению — тема применится к этой странице и просто не переживёт перехода.
    if (next === 'dark') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', next);
    try {
      if (next === 'dark') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      /* молча: см. выше */
    }
  };

  return (
    <div className="flex items-center gap-1 rounded-full border border-border-light p-0.5">
      {THEMES.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => apply(value)}
          aria-label={label}
          aria-pressed={theme === value}
          title={label}
          className={`flex size-6 items-center justify-center rounded-full transition-colors ${
            theme === value
              ? 'bg-primary text-primary-foreground'
              : 'text-text-faint hover:text-foreground'
          }`}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
