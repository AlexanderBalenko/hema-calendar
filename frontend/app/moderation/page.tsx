import type { Metadata } from 'next';

import { ModerationQueue } from '@/src/components/moderation-queue';

/**
 * Страница модератора. Ссылок на неё с сайта нет намеренно: вход сюда — ключ, а не меню, и
 * пункт «модерация» в шапке публичного календаря только провоцировал бы перебор ключа.
 */
export const metadata: Metadata = {
  title: 'Очередь модерации',
  robots: { index: false, follow: false },
};

export default function ModerationPage() {
  return <ModerationQueue />;
}
