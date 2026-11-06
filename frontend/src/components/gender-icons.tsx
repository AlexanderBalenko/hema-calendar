/**
 * Значки пола в стиле lucide (штрих 2, круглые концы, viewBox 24) — перенесены из портала
 * (`shared/components/gender-icons.tsx`).
 *
 * Почему свои, а не из пакета: `Venus` / `Mars` / `VenusAndMars` появились в lucide-react только
 * после 0.474, а проект стоит на 0.469 — обновлять весь набор иконок ради трёх глифов дороже, чем
 * повторить их разметку (она в lucide под ISC и по сути состоит из окружности и стрелки/креста).
 * Как только пакет обновится, эти три компонента можно заменить импортом один в один.
 */
type IconProps = { className?: string; size?: number };

function base(size: number | undefined, className: string | undefined) {
  return {
    width: size ?? 24,
    height: size ?? 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
    focusable: 'false' as const,
  };
}

/** Женский знак — «зеркало Венеры». */
export function Venus({ className, size }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="9" r="6" />
      <path d="M12 15v7" />
      <path d="M9 19h6" />
    </svg>
  );
}

/** Мужской знак — «щит и копьё Марса». */
export function Mars({ className, size }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="10" cy="14" r="6" />
      <path d="M16 3h5v5" />
      <path d="m21 3-6.75 6.75" />
    </svg>
  );
}

/** Смешанная номинация — знаки Венеры и Марса на одном круге. */
export function VenusAndMars({ className, size }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="11" r="5" />
      <path d="M12 16v6" />
      <path d="M10 20h4" />
      <path d="M17 2h5v5" />
      <path d="m22 2-6.5 6.5" />
    </svg>
  );
}
