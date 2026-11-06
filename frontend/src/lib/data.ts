/**
 * Данные календаря. Источник — YAML-файлы репозитория (`data/`), собранные в JSON скриптом
 * `scripts/build_json.py` на каждой сборке. Сервера у календаря нет: сайт статический, и всё,
 * что он показывает, лежит рядом с ним.
 *
 * Лёгкий указатель (`calendar.json`) уезжает в браузер целиком — сетка месяца и фильтры
 * работают без единого запроса. Полный набор с описаниями (`events.json`) читают только
 * серверные компоненты на сборке страниц турниров, в браузер он не попадает.
 */
import calendar from '@/src/generated/calendar.json';

export type Nomination = {
  weapon: string;
  weaponCode: string | null;
  gender: 'Any' | 'Male' | 'Female';
  minAge: number | null;
  maxAge: number | null;
  isTeam: boolean;
  isBeginnerFriendly: boolean;
  /** Только в полном наборе: в указателе заметок нет, они втрое утяжеляли его. */
  notes?: string | null;
};

export type CalendarEvent = {
  slug: string;
  title: string;
  startsAt: string;
  endsAt: string;
  city: string | null;
  macroRegion: string | null;
  countryCode: string | null;
  locationManual: string | null;
  organizerName: string | null;
  /** Со-организаторы: турнир часто делают два клуба вместе. Поля нет у большинства турниров. */
  coOrganizers?: string[];
  externalUrl: string | null;
  /** Карточка турнира на хемагоне. Только в полном наборе: указателю она не нужна. */
  hemagonUrl?: string | null;
  description?: string | null;
  nominations: Nomination[];
};

export type Directories = {
  weapons: { id: number; name: string; code: string }[];
  cities: { id: number; name: string; macroRegion: string; countryCode: string }[];
  macroRegions: string[];
};

type CalendarFile = { events: CalendarEvent[]; directories: Directories; builtAt: string };

const file = calendar as unknown as CalendarFile;

export const EVENTS: CalendarEvent[] = file.events;
export const DIRECTORIES: Directories = file.directories;
/** День последней сборки данных — показываем в подвале, чтобы было видно свежесть календаря. */
export const BUILT_AT: string = file.builtAt;
