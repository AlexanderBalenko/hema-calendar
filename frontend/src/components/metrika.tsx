'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Яндекс.Метрика. Номер счётчика приходит переменной репозитория (`METRIKA_ID` → сборка →
 * `NEXT_PUBLIC_METRIKA_ID`), как и адрес формы заявок: в коде его нет, и без переменной счётчик
 * не грузится вовсе — ни скрипта, ни куки. Так же он и выключается, если понадобится.
 *
 * Вебвизор (запись действий посетителя) НЕ включён намеренно: календарь не хранит о читателе
 * ничего, и запись сеансов — первое, что этому противоречит. Включается одним флагом ниже, если
 * заказчик решит иначе.
 */
const ID = Number(process.env.NEXT_PUBLIC_METRIKA_ID ?? '') || 0;
const TAG = 'https://mc.yandex.ru/metrika/tag.js';

type Ym = ((id: number, action: string, ...rest: unknown[]) => void) & {
  a?: unknown[][];
  l?: number;
};

declare global {
  // eslint-disable-next-line no-var -- глобальная переменная счётчика, иначе её не объявить
  var ym: Ym | undefined;
}

export function Metrika() {
  const pathname = usePathname();
  const started = useRef(false);
  /** Путь, просмотр которого уже отправлен. null — счётчик ещё не стартовал. */
  const reported = useRef<string | null>(null);

  useEffect(() => {
    if (!ID || started.current) return;
    started.current = true;

    // Порядок как в официальной вставке: СНАЧАЛА заглушка-очередь, потом скрипт. Наоборот
    // нельзя — вызовы, сделанные до загрузки тега, потерялись бы.
    if (!window.ym) {
      const queue = ((...args: unknown[]) => {
        queue.a = queue.a || [];
        queue.a.push(args);
      }) as Ym;
      queue.l = Date.now();
      window.ym = queue;
    }
    if (!document.querySelector(`script[src="${TAG}"]`)) {
      const script = document.createElement('script');
      script.async = true;
      script.src = TAG;
      document.head.appendChild(script);
    }

    window.ym(ID, 'init', {
      defer: true,
      clickmap: true,
      trackLinks: true,
      accurateTrackBounce: true,
      webvisor: false,
    });
    // `defer: true` — первый просмотр шлём сами, в одном месте с остальными: иначе он уехал бы
    // дважды, счётчиком и нами.
    window.ym(ID, 'hit', window.location.href);
    reported.current = pathname;
  }, [pathname]);

  // Переходы внутри календаря документ не перезагружают, и счётчик их не видит. Шлём просмотр
  // на смену ПУТИ, а не адреса целиком: фильтры и развёрнутая лента живут в query-параметрах и
  // меняют адрес по нескольку раз в минуту — это одна и та же страница, и считать её заново
  // значило бы придумать себе посещаемость.
  useEffect(() => {
    if (!ID || reported.current === null || reported.current === pathname) return;
    reported.current = pathname;
    window.ym?.(ID, 'hit', window.location.href);
  }, [pathname]);

  return null;
}
