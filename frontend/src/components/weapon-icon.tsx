import { Swords } from 'lucide-react';

/**
 * Пиктограмма вида оружия — те же файлы, что в портале (public/weapon-icon-*.png).
 *
 * Картинка рисуется МАСКОЙ, а не изображением: все четыре файла одноцветные, поэтому силуэт
 * заливается currentColor и следует акценту темы — ровно как в портале. Остальные виды
 * (мессер, копьё, спортивные) своих иконок там берут из справочника, куда админ загружает SVG;
 * у календаря справочника нет, и для них честная заглушка — скрещённые клинки.
 */
const WITH_ICON = new Set(['longsword', 'saber', 'rapier', 'buckler']);

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export function WeaponIcon({ code, size = 18, className }: { code: string; size?: number; className?: string }) {
  const wrapper = `inline-flex shrink-0 items-center justify-center text-primary ${className ?? ''}`;

  if (!WITH_ICON.has(code)) {
    return (
      <span className={wrapper} style={{ width: size, height: size }} aria-hidden>
        <Swords style={{ width: size * 0.8, height: size * 0.8 }} />
      </span>
    );
  }

  return (
    <span className={wrapper} style={{ width: size, height: size }} aria-hidden>
      <span
        style={{
          width: size,
          height: size,
          backgroundColor: 'currentColor',
          WebkitMaskImage: `url(${BASE_PATH}/weapon-icon-${code}.png)`,
          maskImage: `url(${BASE_PATH}/weapon-icon-${code}.png)`,
          WebkitMaskSize: 'contain',
          maskSize: 'contain',
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
          maskPosition: 'center',
        }}
      />
    </span>
  );
}
