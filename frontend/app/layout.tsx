import type { Metadata } from 'next';
import Link from 'next/link';
import { Inter, Playfair_Display } from 'next/font/google';

import { EventHoverCard } from '@/src/components/event-hover';
import { ThemeSwitcher } from '@/src/components/theme-switcher';
import { BUILT_AT, EVENTS } from '@/src/lib/data';
import { formatDateRange } from '@/src/lib/month-layout';
import './globals.css';

/**
 * Шрифтовая пара портала: Playfair Display на заголовки, Inter на остальное. Без неё календарь
 * рисуется системным гротеском с Georgia в заголовках и рядом с hema.ru выглядит чужим.
 */
const inter = Inter({ variable: '--font-inter', subsets: ['latin', 'cyrillic'], display: 'swap' });
const playfair = Playfair_Display({
  variable: '--font-playfair',
  subsets: ['latin', 'cyrillic'],
  display: 'swap',
});

/**
 * Подкаталог сайта. На Pages календарь лежит в /hema-calendar, на своём домене — в корне.
 * Ссылки Next подставляет сам, а вот адрес картинки — нет: next/image с unoptimized отдаёт src
 * как есть, и логотип ломался на опубликованном сайте. Поэтому обычный <img> и явный префикс —
 * переменная подставляется на сборке, в разметку уезжает готовый адрес.
 */
const BASE_PATH = process.env.PAGES_BASE_PATH ?? '';

/**
 * Ширина рабочей области — одна константа на шапку, содержимое и подвал.
 *
 * Просьба заказчика 06.11.2026: «подсожмём немного календарь — уменьши на четверть ширину за
 * счёт сб и вс». 61rem (976px) минус отступы по бокам (lg:px-8, 2×32px) = 912px содержимого
 * вместо прежних 1216.
 *
 * Сжатие живёт ЗДЕСЬ, а не в GRID_TEMPLATE ленты, и это ровно то, о чём просили: будни в гриде
 * фиксированные (5×32px), резиновые только суббота и воскресенье — поэтому все 304px разницы
 * уходят из уикенда (колонка выходного с 528px до 376px), а будни не трогаются вовсе.
 *
 * Шапка и подвал держат ту же ширину тем же значением: ширина, разъехавшаяся с лентой, — уже
 * знакомый дефект (из-за него в ленте убрали хвостовую колонку, см. calendar-ribbon.tsx).
 *
 * Прежний класс полным именем в комментариях не называем: Tailwind сканирует и их, и упомянутый
 * класс уезжает в собранные стили мёртвым правилом.
 */
const CONTENT_WIDTH = 'max-w-[61rem]';

export const metadata: Metadata = {
  title: 'Календарь турниров HEMA',
  description: 'Турниры по историческому фехтованию: прошедшие и будущие, с фильтрами по оружию, региону и датам.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${inter.variable} ${playfair.variable}`}>
      <body className="flex min-h-screen flex-col bg-background font-sans antialiased">
        {/* Тема ставится ДО отрисовки содержимого (скрипт блокирует парсер): через useEffect
            выбравшие светлую видели бы вспышку тёмного на каждом переходе. Скрипт лежит ПЕРВЫМ
            УЗЛОМ ВНУТРИ body намеренно — ребёнком <html> его переносит в head сам Next, React на
            гидрации получает несовпадение детей и перерендеривает корень, смывая data-theme
            (прецедент портала). Значение сверяется с белым списком: в хранилище мог остаться и
            мусор, и тема портала, которой у календаря нет. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('hema_theme')==='light')document.documentElement.setAttribute('data-theme','light')}catch(e){}",
          }}
        />
        {/* Слой ховер-карточки турнира — один на весь сайт: она рисуется порталом в body,
            поэтому где её смонтировать, роли не играет, а дублировать по видам незачем. */}
        <EventHoverCard />
        {/* Шапка повторяет портальную: липкая, высотой 64px, с размытием под полупрозрачным
            фоном и тем же логотипом. */}
        <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-md">
          <div className={`mx-auto flex h-16 ${CONTENT_WIDTH} items-center gap-4 px-4 sm:px-6 lg:px-8`}>
            <Link href="/" aria-label="Календарь HEMA — на главную" className="shrink-0">
              {/* site-logo и --logo-url — крючок для светлой темы: там логотип перерисовывается
                  маской в цвете акцента (globals.css), потому что золото на пергаменте выцветает.
                  На тёмной теме класс не делает ничего — правило приходит только вместе с ней. */}
              <span
                className="site-logo inline-flex"
                style={{ '--logo-url': `url(${BASE_PATH}/logo-horizontal.png)` } as React.CSSProperties}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- см. BASE_PATH выше */}
                <img
                  src={`${BASE_PATH}/logo-horizontal.png`}
                  alt="HEMA.RU"
                  width={160}
                  height={32}
                  className="h-8 w-auto object-contain"
                />
              </span>
            </Link>
            {/* Сдвиг — на базовую линию слова «HEMA.RU» в логотипе. Картинка выровнена по центру
                строки, но слово внутри неё прижато к низу: над ним эмблема, которая выше. Из-за
                этого подписи шли выше логотипа и строка выглядела неряшливо.

                7px, а не круглые 8, — число из ЗАМЕРА РЕНДЕРА, а не из формулы: 8 поставили по
                вычисленной базовой линии, и заказчик увидел, что низ не сошёлся. На снимке шапки
                1:1 нижний край слова в логотипе лежит на 44.5, у заглавных в подписях при сдвиге
                8px — на 45.9, при 7px — на 44.7. Последняя строка с чернилами при 7px у логотипа
                и подписей одна и та же.

                Шрифт здесь фиксированный (16.67px и на 800, и на 1024), поэтому пиксельный сдвиг
                не разъедется по ширинам. Сдвигаем подписи, а не логотип: так весь блок — эмблема
                плюс строка — остаётся по центру шапки. */}
            <span className="hidden translate-y-[7px] text-sm text-text-muted sm:inline">
              Календарь турниров
            </span>
            <Link
              href="/submit"
              className="ml-auto translate-y-[7px] whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-foreground"
            >
              Анонсировать турнир
            </Link>
          </div>
        </header>

        <main className={`mx-auto w-full ${CONTENT_WIDTH} flex-1 px-4 py-6 sm:px-6 lg:px-8`}>{children}</main>

        <footer className="border-t border-border">
          <div className={`mx-auto flex ${CONTENT_WIDTH} flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-5 text-xs text-text-faint sm:px-6 lg:px-8`}>
            {/* Свежесть данных видно сразу: календарь собирается из файлов репозитория, и
                «когда он последний раз обновлялся» — честный и важный для читателя факт. */}
            <span>{EVENTS.length} турниров, данные от {formatDateRange(BUILT_AT, BUILT_AT, true)}</span>
            <a href="https://hema.ru" className="hover:text-primary">hema.ru</a>
            <a
              href="https://github.com/AlexanderBalenko/hema-calendar"
              target="_blank"
              rel="noreferrer noopener"
              className="hover:text-primary"
            >
              исходники и данные
            </a>
            {/* Переключатель темы — в подвале, как в портале: тема нужна прежде всего тем, кому
                «темновато», а в шапке календаря он отнимал бы место у фильтров. */}
            <div className="ml-auto self-center">
              <ThemeSwitcher />
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
