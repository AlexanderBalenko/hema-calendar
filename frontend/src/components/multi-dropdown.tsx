'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Checkbox } from './checkbox';

export type MultiDropdownOption = { value: string; label: string; icon?: ReactNode };

/**
 * Мультиселект в виде дропдауна — родной брат `Dropdown` (select-arrow.tsx): та же кнопка-триггер,
 * та же раскрывающаяся панель, тот же клик-вне. Отличие одно: внутри не радиокнопки, а строки с
 * нашим `Checkbox`, и выбранных может быть много.
 *
 * Зачем отдельный компонент, а не ряд чипов: в строке фильтров календаря чипы оружия (6+) и
 * регионов (7) занимали две строки и «распухали» при добавлении новых видов оружия — заказчик
 * попросил свернуть их в дропдауны (спека §5, пересмотр 2026-08-05). Кнопка сама рассказывает
 * состояние выбора: «Оружие: все» / «Оружие: сабля, рапира» / «Оружие: 4 из 6».
 */
export function MultiDropdown({
  label,
  options,
  value,
  onChange,
  className = '',
  allLabel = 'все',
  emptyLabel = 'ничего',
  icon,
  renderValue,
}: {
  /** Подпись слева на кнопке — она же заменяет внешний лейбл кластера. */
  label: string;
  options: MultiDropdownOption[];
  value: string[];
  onChange: (value: string[]) => void;
  className?: string;
  allLabel?: string;
  emptyLabel?: string;
  /** Иконка-предметник слева на кнопке (Swords у оружия, MapPin у региона). */
  icon?: ReactNode;
  /**
   * Своя отрисовка «что выбрано» в триггере. Нужна оружию: заказчик просил показывать там
   * пиктограммы выбранных видов, а не перечисление названий. Регионы отрисовкой не пользуются и
   * остаются текстом — поэтому это проп, а не ветка внутри компонента.
   */
  renderValue?: (ctx: { selected: MultiDropdownOption[]; all: boolean; total: number }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const selectedSet = new Set(value);
  const selected = options.filter((o) => selectedSet.has(o.value));
  const all = options.length > 0 && selected.length === options.length;

  // Названия показываем, пока их два: три уже не влезают в компактную строку фильтров, и «3 из 6»
  // читается быстрее длинного перечисления.
  const summary = all
    ? allLabel
    : selected.length === 0
      ? emptyLabel
      : selected.length <= 2
        ? selected.map((o) => o.label).join(', ')
        : `${selected.length} из ${options.length}`;

  const toggle = (optionValue: string) => {
    onChange(selectedSet.has(optionValue) ? value.filter((v) => v !== optionValue) : [...value, optionValue]);
  };

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={`${label}: ${summary}`}
        // Высота 32px и text-xs — компактная строка фильтров календаря (фидбек «неоправданно
        // высокие элементы»); тот же размер у ToggleChip и AgeChip рядом.
        className={`flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs ring-1 ring-inset transition-colors ${
          all
            ? 'bg-background text-text-secondary ring-border-light hover:text-foreground'
            : 'bg-primary/15 text-primary ring-primary/40'
        } ${className}`}
      >
        {icon}
        {renderValue ? (
          renderValue({ selected, all, total: options.length })
        ) : (
          <span className="truncate">{summary}</span>
        )}
        <ChevronDown className={`size-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {/* w-max у панели: она шире своей кнопки, и без него упиралась в min-w-[200px], а длинные
          названия («Спортивная шпага» с пиктограммой) вылезали — к вертикальной полосе прокрутки
          добавлялась горизонтальная. Ширину ограничиваем экраном, а не кнопкой. */}
      {open && (
        <div className="thin-scroll absolute left-0 top-[calc(100%+4px)] z-40 max-h-72 w-max min-w-[200px] max-w-[min(20rem,90vw)] overflow-y-auto rounded-lg bg-card p-1 shadow-lg ring-1 ring-inset ring-border-light">
          {options.length === 0 && <p className="px-2 py-1.5 text-sm text-text-muted">Нет вариантов</p>}

          {options.length > 0 && (
            <>
              {/* «Все» одной строкой — иначе снять/вернуть полный набор стоит семи кликов. */}
              <Checkbox
                checked={all}
                onChange={(checked) => onChange(checked ? options.map((o) => o.value) : [])}
                label={<span className="text-sm text-text-secondary">Все</span>}
                className="w-full rounded-md px-2 py-1.5 hover:bg-background-secondary"
              />
              <span className="my-1 block h-px bg-border" aria-hidden="true" />
            </>
          )}

          {options.map((o) => (
            <Checkbox
              key={o.value}
              checked={selectedSet.has(o.value)}
              onChange={() => toggle(o.value)}
              label={
                <span className="flex items-center gap-2 whitespace-nowrap text-sm text-foreground">
                  {o.icon}
                  {o.label}
                </span>
              }
              className="w-full rounded-md px-2 py-1.5 hover:bg-background-secondary"
            />
          ))}
        </div>
      )}
    </div>
  );
}
