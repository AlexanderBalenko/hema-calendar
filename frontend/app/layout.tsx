import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Календарь турниров HEMA',
  description: 'Турниры по историческому фехтованию: прошедшие и будущие, с фильтрами по оружию, региону и датам.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <header className="border-b border-border">
          <div className="mx-auto flex max-w-6xl items-baseline gap-3 px-4 py-4">
            <a href="/" className="font-display text-lg text-primary">Календарь HEMA</a>
            <span className="text-xs text-text-muted">турниры по историческому фехтованию</span>
            <a href="/submit" className="ml-auto text-sm text-primary hover:underline">Подать турнир</a>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
