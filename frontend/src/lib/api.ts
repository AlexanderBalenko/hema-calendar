/**
 * Единственное место, где известен адрес API, и единственный разборщик ответа.
 *
 * Адрес НЕ зашивается в бандл на сборке: браузер ходит на СВОЙ origin («/api/…»), а фронт
 * переправляет запрос бэкенду (rewrite в next.config.mjs). Иначе образ, собранный с localhost,
 * с чужого компьютера ловит «не удалось соединиться» — грабли портала; а угадывание порта по
 * имени хоста привело к тому, что календарь на стенде стучался в API ПОРТАЛА (8080) и получал
 * 404 на очередь модерации.
 *
 * Серверный рендер ходит по внутреннему адресу контейнера — переменная API_URL.
 */
const INTERNAL_API_URL = process.env.API_URL ?? 'http://localhost:8080';

export function apiBase(): string {
  return typeof window === 'undefined' ? INTERNAL_API_URL : '';
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function handle<T>(res: Response): Promise<T> {
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    let message = `Ошибка ${res.status}`;
    try {
      const body = text ? (JSON.parse(text) as { error?: string }) : null;
      if (body?.error) message = body.error;
    } catch {
      // Тело не JSON — оставляем код ответа: текст сервера тут не обязателен.
    }
    throw new ApiError(res.status, message);
  }
  // Пустое тело — законный успех (204): не пытаемся его разбирать.
  return (text ? JSON.parse(text) : undefined) as T;
}

export type CalendarEvent = {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  endsAt: string;
  city: string | null;
  macroRegion: string | null;
  countryCode: string | null;
  locationManual: string | null;
  organizerName: string | null;
  externalUrl: string | null;
  nominations: Nomination[];
};

export type Nomination = {
  weapon: string;
  weaponCode: string | null;
  gender: 'Any' | 'Male' | 'Female';
  minAge: number | null;
  maxAge: number | null;
  isTeam: boolean;
  isBeginnerFriendly: boolean;
  notes: string | null;
};

export type Directories = {
  weapons: { id: number; name: string; code: string }[];
  cities: { id: number; name: string; macroRegion: string; countryCode: string }[];
  macroRegions: string[];
};

export type CalendarQuery = {
  from?: string;
  to?: string;
  weapons?: string[];
  regions?: string[];
  cityId?: number;
  team?: boolean;
  beginner?: boolean;
  q?: string;
};

export function calendarUrl(query: CalendarQuery, base = apiBase()): string {
  const params = new URLSearchParams();
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.weapons?.length) params.set('weapons', query.weapons.join(','));
  if (query.regions?.length) params.set('regions', query.regions.join(','));
  if (query.cityId) params.set('cityId', String(query.cityId));
  if (query.team) params.set('team', 'true');
  if (query.beginner) params.set('beginner', 'true');
  if (query.q) params.set('q', query.q);
  const search = params.toString();
  return `${base}/api/calendar${search ? `?${search}` : ''}`;
}

export async function fetchCalendar(query: CalendarQuery): Promise<CalendarEvent[]> {
  return handle<CalendarEvent[]>(await fetch(calendarUrl(query), { cache: 'no-store' }));
}

export async function fetchDirectories(): Promise<Directories> {
  return handle<Directories>(await fetch(`${apiBase()}/api/directories`, { cache: 'no-store' }));
}

export async function fetchEvent(slug: string): Promise<{ event: CalendarEvent; description: string | null } | null> {
  const res = await fetch(`${apiBase()}/api/calendar/events/${encodeURIComponent(slug)}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  return handle(res);
}
