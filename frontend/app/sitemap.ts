import type { MetadataRoute } from 'next';

import { EVENTS } from '@/src/lib/data';

/**
 * Карта сайта: страницы турниров — то, ради чего календарь вообще ищут в поиске («Saber
 * Meister 2026»). Их триста с лишним, и без карты поисковик нашёл бы только те, на которые
 * есть ссылка с текущего месяца.
 *
 * Адрес сайта задаётся сборке: на Pages он один, на своём домене другой, а в карте нужны
 * абсолютные ссылки.
 */
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://alexanderbalenko.github.io/hema-calendar';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE}/submit/`, changeFrequency: 'yearly', priority: 0.3 },
    ...EVENTS.map((event) => ({
      url: `${SITE}/events/${event.slug}/`,
      // Прошедший турнир уже не изменится, будущий могут уточнить.
      changeFrequency: (event.endsAt < new Date().toISOString().slice(0, 10) ? 'yearly' : 'weekly') as 'yearly' | 'weekly',
      priority: 0.6,
    })),
  ];
}
