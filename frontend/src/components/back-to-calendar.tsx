'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

/** Где человек оставил календарь: адрес со всеми фильтрами и развёрнутой лентой. */
export const CALENDAR_SEARCH_KEY = 'hema-calendar:search';

/**
 * «← ко всем турнирам» со страницы турнира.
 *
 * Зачем сложнее обычной ссылки: состояние календаря живёт в адресе (фильтры, месяц, сколько
 * недель развёрнуто), а ссылка на голый «/» его стирала — развёрнутую ленту приходилось
 * расхлопывать заново (замечание заказчика 06.11.2026). Поэтому календарь при каждом изменении
 * адреса кладёт его в `sessionStorage`, а эта ссылка его оттуда достаёт.
 *
 * Шаг назад предпочтительнее перехода по сохранённому адресу: браузер вместе с ним возвращает и
 * позицию прокрутки. `document.referrer` для этого не годится — при переходе внутри приложения
 * он не меняется и остаётся пустым (проверено 06.11.2026: ссылка молча вела на «/»).
 *
 * Зашли сразу на страницу турнира — из поиска или по присланной ссылке: сохранённого адреса
 * нет, и ссылка работает как обычная, ведёт на календарь.
 */
export function BackToCalendar() {
  const router = useRouter();

  return (
    <Link
      href="/"
      className="text-xs text-text-muted hover:text-primary"
      onClick={(event) => {
        // Открытие в новой вкладке и средней кнопкой не перехватываем — это осознанный выбор.
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        let saved: string | null = null;
        try {
          saved = window.sessionStorage.getItem(CALENDAR_SEARCH_KEY);
        } catch {
          return; // приватный режим или запрет хранилища — обычная ссылка не хуже
        }
        if (saved === null) return;
        event.preventDefault();
        if (window.history.length > 1) router.back();
        else router.push(`/${saved}`);
      }}
    >
      ← ко всем турнирам
    </Link>
  );
}
