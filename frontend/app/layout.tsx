import type { Metadata } from 'next';
import Link from 'next/link';

import { BUILT_AT, EVENTS } from '@/src/lib/data';
import { formatDateRange } from '@/src/lib/month-layout';
import './globals.css';

export const metadata: Metadata = {
  title: 'Календарь турниров HEMA',
  description: 'Турниры по историческому фехтованию: прошедшие и будущие, с фильтрами по оружию, региону и датам.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="flex min-h-screen flex-col bg-background text-foreground antialiased">
        <header className="border-b border-border">
          <div className="mx-auto flex max-w-6xl items-baseline gap-3 px-4 py-4">
            <Link href="/" className="font-display text-lg text-primary">Календарь HEMA</Link>
            <span className="hidden text-xs text-text-muted sm:inline">турниры по историческому фехтованию</span>
            <Link href="/submit" className="ml-auto text-sm text-primary hover:underline">Подать турнир</Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>

        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-6xl flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-4 text-xs text-text-faint">
            {/* Свежесть данных видно сразу: календарь собирается из файлов репозитория, и
                «когда он последний раз обновлялся» — честный и важный для читателя факт. */}
            <span>{EVENTS.length} турниров, данные от {formatDateRange(BUILT_AT, BUILT_AT, true)}</span>
            <a
              href="https://github.com/AlexanderBalenko/hema-calendar"
              target="_blank"
              rel="noreferrer noopener"
              className="hover:text-primary"
            >
              исходники и данные на GitHub
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
