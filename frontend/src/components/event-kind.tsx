import { BookOpen, CircleDot, GraduationCap, Sparkles, Tent } from 'lucide-react';

import { KIND_LABEL, type EventKind } from '@/src/lib/data';

/**
 * Тип мероприятия на карточке. Правило перенесено из портала (`EventKindIcon`) вместе с самими
 * иконками: **у турнира иконки нет вовсе**. Турниров 403 из 416, и значок «турнир» на каждой
 * карточке был бы элементом, который ничего не сообщает. Фестиваль — искра, лагерь — палатка;
 * семинару, лекции и прочему иконок в портале не было (в календарь они не попадали), их завели
 * здесь — шапочка, книга и точка.
 *
 * Цвет названия иконка не меняет: она говорит, ЧТО это, а не насколько это важно.
 */
const KIND_ICON: Partial<Record<EventKind, typeof Sparkles>> = {
  festival: Sparkles,
  camp: Tent,
  seminar: GraduationCap,
  lecture: BookOpen,
  other: CircleDot,
};

export function EventKindIcon({ kind, className = 'size-3 shrink-0 text-primary' }: {
  kind: EventKind;
  className?: string;
}) {
  const Icon = KIND_ICON[kind];
  if (!Icon) return null;
  return <Icon className={className} aria-hidden="true" />;
}

/**
 * Слово для строки под названием: «1–14 августа · лагерь». У турнира — null: подпись появляется
 * там, где меняет прочтение карточки, а «турнир» не меняет ничего.
 *
 * Иконка есть всегда, слово — там, где есть куда его поставить: лента показывает событие тремя
 * способами, и второй строки у полосы нет вовсе (`docs/EventTypes.md` §4а).
 */
export function kindWord(kind: EventKind): string | null {
  return kind === 'tournament' ? null : KIND_LABEL[kind];
}

/** Подпись со значком «· лагерь» для строки даты. Ничего не рисует у турнира. */
export function KindSuffix({ kind, className }: { kind: EventKind; className?: string }) {
  const word = kindWord(kind);
  if (!word) return null;
  return <span className={className}> · {word}</span>;
}
