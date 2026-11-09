'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import type { CalendarEvent } from '@/src/lib/data';
import { formatOrganizers, formatPlace } from '@/src/lib/text';
import { EventKindIcon, kindWord } from './event-kind';

/**
 * Карточка турнира по наведению (просьба заказчика 08.11.2026): название, город, организатор и
 * номинации списком. До неё узнать состав номинаций можно было, только открыв страницу турнира,
 * — а это главное, что спрашивают у календаря глазами: «есть ли там сабля для женщин».
 *
 * Данные берутся из той же записи, что рисует плашку: номинации лежат в указателе
 * (`calendar.json`), который и так целиком уезжает в браузер. Ни запроса, ни лишнего веса.
 *
 * Карточка рисуется ПОРТАЛОМ в body и позиционируется fixed. Иначе никак: плашка в ленте имеет
 * `overflow-hidden` (подписи обрезаются по её краю), и вложенная карточка обрезалась бы вместе
 * с ними.
 *
 * Состояние — один модульный «кто сейчас под курсором» вместо контекста: вид прокидывал бы
 * обработчики через три уровня вложенных компонентов, а слушатель здесь ровно один.
 */

type HoverEvent = CalendarEvent & { isSuitable?: boolean; unsuitableReason?: string | null };

type Shown = { event: HoverEvent; rect: DOMRect };

const GENDER_LABEL: Record<string, string> = { Any: 'общая', Male: 'мужская', Female: 'женская' };

/**
 * Сколько номинаций показываем целиком. У двух турниров в данных их 21 и 23 — такой список
 * закрыл бы пол-экрана; за полным составом человек идёт на страницу турнира.
 */
const LIMIT = 12;
const WIDTH = 300;
const GAP = 8;

const listeners = new Set<(value: Shown | null) => void>();

function publish(value: Shown | null) {
  listeners.forEach((notify) => notify(value));
}

/**
 * Обработчики для кликабельной плашки турнира. Рассчитаны на любой из видов — лента, сетка
 * месяца, список: прямоугольник берётся у самого элемента, а не у курсора, чтобы карточка
 * вставала под плашкой, а не прыгала за мышью.
 */
export function hoverProps(event: HoverEvent) {
  const show = (e: React.SyntheticEvent<HTMLElement>) =>
    publish({ event, rect: e.currentTarget.getBoundingClientRect() });
  const hide = () => publish(null);
  // onFocus/onBlur — та же карточка с клавиатуры: по плашкам ходят табом, и состав номинаций
  // не должен быть доступен только мышью.
  return { onMouseEnter: show, onMouseLeave: hide, onFocus: show, onBlur: hide };
}

/** Слой карточки. Монтируется один раз на весь сайт — в layout. */
export function EventHoverCard() {
  const [shown, setShown] = useState<Shown | null>(null);
  // Порталу нужен document, которого нет на сборке: до монтирования не рисуем ничего.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    listeners.add(setShown);
    return () => {
      listeners.delete(setShown);
    };
  }, []);

  useEffect(() => {
    if (!shown) return;
    // Прямоугольник снят один раз, а карточка стоит fixed: при прокрутке она отвязалась бы от
    // плашки и повисла посреди экрана. Прячем — наведение всё равно уже не на плашке.
    const hide = () => publish(null);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [shown]);

  if (!mounted || !shown) return null;
  return createPortal(<Card event={shown.event} rect={shown.rect} />, document.body);
}

function Card({ event, rect }: Shown) {
  const place = formatPlace(event.city, event.locationManual);
  const organizers = formatOrganizers(event.organizerName, event.coOrganizers);
  const noms = event.nominations ?? [];
  const visible = noms.slice(0, LIMIT);
  const rest = noms.length - visible.length;
  const declared = event.weapons ?? [];
  const subtitle = [kindWord(event.kind), event.online ? 'онлайн' : null].filter(Boolean).join(', ');

  // Высота считается, а не измеряется: карточку надо поставить до первой отрисовки, иначе она
  // мигнёт внизу и перепрыгнет наверх. Строки здесь одинаковой высоты, и прикидка точна.
  const lines = visible.length + (rest > 0 ? 1 : 0);
  const height = 58 + (noms.length > 0 ? 26 + lines * 18 : 0)
    + (declared.length > 0 ? 26 + 18 : 0) + (event.unsuitableReason ? 18 : 0);
  const left = Math.min(Math.max(GAP, rect.left), window.innerWidth - WIDTH - GAP);
  const below = rect.bottom + GAP;
  const top = below + height > window.innerHeight - GAP
    ? Math.max(GAP, rect.top - GAP - height)
    : below;

  return (
    <div
      // pointer-events-none: карточка висит под плашкой и попадала бы под курсор при движении
      // вниз — плашка теряла бы наведение, и карточка мигала бы.
      className="pointer-events-none fixed z-50 rounded-xl border border-border-light bg-card p-3 text-xs shadow-xl"
      style={{ left, top, width: WIDTH }}
      role="tooltip"
    >
      <div className="flex items-start gap-1.5 text-sm font-medium leading-snug text-foreground">
        <EventKindIcon kind={event.kind} className="mt-1 size-3 shrink-0 text-primary" />
        <span className="min-w-0">{event.title}</span>
      </div>
      {/* Тип стоит в строке места, а не своей: «лагерь · Алтайский край» — одна строка вместо
          двух, и читается как ответ на вопрос «что и где». У онлайна места нет, и строка
          становится «лекция · онлайн». */}
      {(place || subtitle) && (
        <div className="mt-0.5 text-text-muted">{[subtitle, place].filter(Boolean).join(' · ')}</div>
      )}
      {organizers && <div className="text-text-muted">{organizers}</div>}
      {/* Причина «не подходит» переехала сюда из подсказки плашки: по наведению не должны
          спорить две всплывашки. */}
      {event.unsuitableReason && (
        <div className="mt-1 text-text-faint">Не подходит: {event.unsuitableReason}</div>
      )}

      {/* Дисциплины не-турнира: у феста или лагеря зачётов нет, и это единственное, что о его
          оружии известно. Одной строкой — списков у них по две-три позиции. */}
      {declared.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <div className="mb-1 text-[11px] text-text-faint">Дисциплины</div>
          <div className="leading-snug text-foreground">
            {declared.map((weapon) => weapon.name).join(' · ')}
          </div>
        </div>
      )}

      {noms.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <div className="mb-1 text-[11px] text-text-faint">Номинации</div>
          <ul className="flex flex-col">
            {visible.map((n, i) => (
              <li key={`${n.weapon}-${i}`} className="leading-snug text-foreground">
                {n.weapon}
                <span className="text-text-muted">
                  {` · ${GENDER_LABEL[n.gender] ?? n.gender}`}
                  {n.isTeam && ' · командная'}
                  {n.isBeginnerFriendly && ' · новички'}
                  {n.minAge != null && ` · от ${n.minAge}`}
                  {n.maxAge != null && ` до ${n.maxAge}`}
                </span>
              </li>
            ))}
          </ul>
          {rest > 0 && <div className="mt-0.5 text-text-faint">и ещё {rest}</div>}
        </div>
      )}
    </div>
  );
}
