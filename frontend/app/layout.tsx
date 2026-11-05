import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Inter, Playfair_Display } from 'next/font/google';

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

export const metadata: Metadata = {
  title: 'Календарь турниров HEMA',
  description: 'Турниры по историческому фехтованию: прошедшие и будущие, с фильтрами по оружию, региону и датам.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${inter.variable} ${playfair.variable}`}>
      <body className="flex min-h-screen flex-col bg-background font-sans antialiased">
        {/* Шапка повторяет портальную: липкая, высотой 64px, с размытием под полупрозрачным
            фоном и тем же логотипом. */}
        <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
            <Link href="/" aria-label="Календарь HEMA — на главную" className="shrink-0">
              <Image
                src="/logo-horizontal.png"
                alt="HEMA.RU"
                width={160}
                height={32}
                priority
                className="h-8 w-auto object-contain"
              />
            </Link>
            <span className="hidden text-sm text-text-muted sm:inline">Календарь турниров</span>
            <Link
              href="/submit"
              className="ml-auto whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-foreground"
            >
              Подать турнир
            </Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>

        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-7xl flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-5 text-xs text-text-faint sm:px-6 lg:px-8">
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
          </div>
        </footer>
      </body>
    </html>
  );
}
