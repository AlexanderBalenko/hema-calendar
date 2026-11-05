'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export type DropdownOption = { value: string; label: string };

/**
 * Полностью кастомный выпадающий список — замена нативному <select>. У нативного select
 * закрытая рамка стилизуется через appearance-none, но раскрытый попап (список опций) браузер
 * рисует сам, вне зависимости от color-scheme/CSS сайта: белый фон, острые углы, синяя подсветка —
 * мимо цветовой гаммы портала и не лечится ничем, кроме полного отказа от нативного попапа.
 * Здесь и закрытая кнопка, и раскрывающаяся панель — обычная разметка, оформленная так же, как
 * остальные попапы приложения (см. GroupPicker/NavSearch).
 */
export function Dropdown({
  value,
  onChange,
  options,
  placeholder,
  className = '',
  disabled = false,
  block = false,
  icon,
  trigger,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Иконка-предметник слева от подписи внутри кнопки (пол в строке фильтров календаря). */
  icon?: React.ReactNode;
  /**
   * Своя разметка триггера ВМЕСТО однострочной подписи выбранной опции. Нужна там, где закрытая
   * кнопка не однострочный текст: пикер года в полоске месяцев (год сверху, число событий снизу —
   * ровно как у кнопок месяцев рядом). Стрелка и вся механика открытия/click-outside общие —
   * заводить второй дропдаун ради двух строк было бы копией click-outside-логики на стороне.
   */
  trigger?: React.ReactNode;
  /** Имя контрола для скринридера — там, где видимая подпись триггера не называет сам фильтр
   *  (например, «все» у дропдауна «Новички» без контекста не читается). */
  ariaLabel?: string;
  /** true — растянуться на всю ширину родителя (для колонок грида/форм). Дефолт — inline-block
   * по содержимому: у inline-block ширина считается от текста выбранной опции, и в узкой колонке
   * длинная опция вылезает за границу — блочный режим прижимает кнопку к колонке, а truncate
   * внутри уже честно режет текст. */
  block?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  /**
   * Раскрытая панель шире кнопки (она подстраивается под самую длинную опцию) и прижата к ЛЕВОМУ
   * краю кнопки — у кнопки в правой половине экрана это выносит панель за границу окна и даёт
   * горизонтальную прокрутку всей странице. Баг-репорт 27.08.2026: селектор занятия на телефоне
   * распирал экран на 26 px при раскрытии.
   *
   * Пришлось мерить, а не решать классом: сколько места справа — знает только рантайм, а
   * `max-width` в CSS ограничивает ширину, но не мешает панели начинаться там, откуда она уже не
   * помещается.
   */
  const [panelShift, setPanelShift] = useState(0);

  useLayoutEffect(() => {
    if (!open || !panelRef.current) {
      setPanelShift(0);
      return;
    }
    const panel = panelRef.current.getBoundingClientRect();
    const host = ref.current?.getBoundingClientRect();
    if (!host) return;
    // Сдвиг, а не бинарное «прижать вправо»: у кнопки не у правого края панель, прижатая к её
    // правому краю, вылезла бы уже СЛЕВА (host.right − ширина панели < 0) — зеркальная ловушка,
    // найденная валидацией 28.08.2026. Считаем смещение от левого края кнопки и клампим обеими
    // сторонами экрана с запасом 8 px: «впритык» читается как обрезанное.
    const vw = document.documentElement.clientWidth;
    const wanted = Math.min(0, vw - 8 - (host.left + panel.width));
    setPanelShift(Math.max(wanted, 8 - host.left));
  }, [open, options.length]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={`relative ${block ? 'block' : 'inline-block'}`}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60 ${block ? 'w-full' : ''} ${className}`}
      >
        {icon}
        {/* min-w-0 рядом с truncate обязателен: у flex-элемента min-width по умолчанию auto, то
            есть равен min-content, а white-space:nowrap из truncate делает min-content равным
            ПОЛНОЙ ширине текста. Без этого кнопка не ужимается, и длинная опция распирает строку —
            многоточие не появляется никогда. */}
        {trigger ?? <span className="min-w-0 truncate">{selected?.label ?? placeholder ?? ''}</span>}
        <ChevronDown className={`size-3.5 shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={panelRef}
          style={panelShift !== 0 ? { left: panelShift } : undefined}
          className="absolute left-0 top-[calc(100%+4px)] z-20 max-h-64 min-w-full max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg bg-card p-1 shadow-lg ring-1 ring-inset ring-border-light"
        >
          {options.length === 0 && <p className="px-2 py-1.5 text-sm text-text-muted">Нет вариантов</p>}
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              // Перенос по словам, а не nowrap: панель ограничена шириной экрана, и неразрывная
              // строка внутри неё просто уезжала бы под край — название группы стало бы нечитаемым.
              className={`block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-background-secondary ${
                o.value === value ? 'text-primary' : 'text-foreground'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
