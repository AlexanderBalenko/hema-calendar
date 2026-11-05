'use client';

import { Check } from 'lucide-react';
import { useId, type MouseEvent, type ReactNode } from 'react';

/**
 * Полностью кастомный чекбокс — замена нативному <input type="checkbox">. Нативная галочка
 * красится браузером в свой синий цвет с квадратной рамкой независимо от темы сайта (тот же класс
 * проблем, что у <select> и <input type="date">, см. select-arrow.tsx/date-picker.tsx) —
 * appearance-none частично лечит только квадрат/рамку, но не сам цвет галочки везде одинаково
 * кроссбраузерно, поэтому здесь целиком своя разметка.
 *
 * Подпись лежит РЯДОМ с кнопкой-квадратом, а не внутри неё, и связана через aria-labelledby
 * (ревизия 03.09.2026, 9.1). Раньше подпись рендерилась внутри <button>: у чекбокса согласия
 * там оказывалась ссылка на политику — интерактивное внутри интерактивного, и клик по ссылке
 * заодно переключал согласие. Клик по подписи по-прежнему переключает (как у нативного label),
 * клик по ссылке внутри подписи — нет.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  ariaLabel,
  disabled = false,
  className = '',
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  /** Имя для вспомогательных технологий, когда видимой подписи нет (чекбокс в строке таблицы). */
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const labelId = useId();

  const toggle = (e: MouseEvent<HTMLElement>) => {
    if (disabled) return;
    // Ссылка внутри подписи — самостоятельное действие, не переключение.
    if ((e.target as HTMLElement).closest('a')) return;
    onChange(!checked);
  };

  return (
    <span
      onClick={toggle}
      className={`inline-flex select-none items-center gap-1.5 text-left ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      } ${className}`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-labelledby={label ? labelId : undefined}
        aria-label={label ? undefined : ariaLabel}
        disabled={disabled}
        className={`flex size-4 shrink-0 items-center justify-center rounded transition-colors ${
          checked ? 'bg-primary' : 'bg-background ring-1 ring-inset ring-border-light'
        }`}
      >
        {checked && <Check className="size-3 text-primary-foreground" strokeWidth={3} aria-hidden="true" />}
      </button>
      {label && <span id={labelId}>{label}</span>}
    </span>
  );
}
