'use client';

import { useState } from 'react';

import { apiBase, type Directories } from '@/src/lib/api';
import { CityPicker, Dropdown, Segmented, Toggle } from './controls';

/**
 * Заявка на турнир от кого угодно: входа в сервисе нет, поэтому форма — единственный способ
 * попасть в календарь помимо импорта.
 *
 * Номинации здесь не ради полноты, а ради фильтров: по оружию, командности и «для новичков»
 * календарь фильтруют, и без них одобренная заявка не находится ничем, кроме названия. Поле
 * «website» скрыто от человека и существует для ботов (сервер молча отбрасывает заполненные).
 */
const FIELD = 'w-full rounded-lg border border-border-light bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary';

type Gender = 'Any' | 'Male' | 'Female';

type NominationDraft = {
  key: number;
  weaponId: number | null;
  /** Выбрано «Другое…» — оружия нет в справочнике, человек пишет его словами. */
  other: boolean;
  weaponText: string;
  gender: Gender;
  minAge: string;
  maxAge: string;
  isTeam: boolean;
  isBeginnerFriendly: boolean;
};

const EMPTY: Omit<NominationDraft, 'key'> = {
  weaponId: null, other: false, weaponText: '', gender: 'Any', minAge: '', maxAge: '',
  isTeam: false, isBeginnerFriendly: false,
};

const OTHER_WEAPON = -1;

export function SubmitForm({ directories }: { directories: Directories }) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cityId, setCityId] = useState<number | null>(null);
  const [nominations, setNominations] = useState<NominationDraft[]>([]);

  const patch = (key: number, change: Partial<NominationDraft>) =>
    setNominations((list) => list.map((n) => (n.key === key ? { ...n, ...change } : n)));

  const weaponOptions = [
    ...directories.weapons.map((w) => ({ value: w.id, label: w.name })),
    { value: OTHER_WEAPON, label: 'Другое…' },
  ];

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const value = (name: string) => {
      const v = form.get(name);
      return typeof v === 'string' && v.trim() ? v.trim() : null;
    };

    const startsAt = value('startsAt');
    if (!value('title') || !startsAt) {
      setError('Название и дата начала обязательны.');
      return;
    }

    const age = (text: string) => {
      const n = Number(text);
      return text.trim() && Number.isInteger(n) && n > 0 && n < 120 ? n : null;
    };

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase()}/api/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: value('title'),
          startsAt,
          endsAt: value('endsAt'),
          cityId,
          locationManual: value('locationManual'),
          organizerName: value('organizerName'),
          externalUrl: value('externalUrl'),
          description: value('description'),
          contact: value('contact'),
          note: value('note'),
          website: value('website'),
          // Пустые строки не отправляем: номинация без оружия ничего не говорит ни фильтру,
          // ни модератору.
          nominations: nominations
            .filter((n) => n.weaponId !== null || n.weaponText.trim())
            .map((n) => ({
              weaponId: n.weaponId,
              weaponText: n.weaponId === null ? n.weaponText.trim() : null,
              gender: n.gender,
              minAge: age(n.minAge),
              maxAge: age(n.maxAge),
              isTeam: n.isTeam,
              isBeginnerFriendly: n.isBeginnerFriendly,
              notes: null,
            })),
        }),
      });
      if (res.status === 429) {
        setError('Слишком много заявок с этого адреса. Попробуйте через час.');
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Не удалось отправить заявку (ошибка ${res.status}).`);
        return;
      }
      setSent(true);
    } catch {
      setError('Сервис недоступен. Попробуйте позже.');
    } finally {
      setSaving(false);
    }
  };

  if (sent) {
    return (
      <div className="flex max-w-xl flex-col gap-3">
        <h1 className="font-display text-xl text-foreground">Заявка отправлена</h1>
        <p className="text-sm text-text-secondary">
          Турнир появится в календаре после проверки. Если в заявке что-то неясно, с вами свяжутся
          по оставленному контакту.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-3">
      <h1 className="font-display text-xl text-foreground">Подать турнир</h1>
      <p className="text-sm text-text-secondary">
        Регистрация не нужна. Заявку посмотрит модератор, поэтому оставьте контакт — без него
        уточнить детали будет негде.
      </p>

      <input name="title" placeholder="Название турнира" className={FIELD} required />
      <div className="flex gap-2">
        <input name="startsAt" type="date" aria-label="Дата начала" className={FIELD} required />
        <input name="endsAt" type="date" aria-label="Дата окончания" className={FIELD} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CityPicker cities={directories.cities} cityId={cityId} onPick={setCityId} />
        <input name="locationManual" placeholder="Площадка и адрес" className={`${FIELD} flex-1`} />
      </div>

      <input name="organizerName" placeholder="Организатор: клуб или человек" className={FIELD} />
      <input name="externalUrl" placeholder="Ссылка на анонс или регистрацию" className={FIELD} />
      <textarea name="description" placeholder="Описание: формат, взнос, регламент" rows={4} className={FIELD} />

      <section className="flex flex-col gap-2 rounded-xl bg-card p-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm text-foreground">Номинации</h2>
          <span className="text-xs text-text-muted">по ним турнир ищут в календаре</span>
        </div>

        {nominations.map((nomination) => (
          <div key={nomination.key} className="flex flex-wrap items-center gap-2 border-t border-border pt-2 first:border-t-0 first:pt-0">
            <Dropdown
              className="w-44"
              label="Оружие"
              placeholder="Оружие"
              value={nomination.other ? OTHER_WEAPON : nomination.weaponId}
              options={weaponOptions}
              onChange={(id) => patch(nomination.key, {
                other: id === OTHER_WEAPON,
                weaponId: id === OTHER_WEAPON ? null : id,
                weaponText: id === OTHER_WEAPON ? nomination.weaponText : '',
              })}
            />
            {nomination.other && (
              <input
                value={nomination.weaponText}
                onChange={(e) => patch(nomination.key, { weaponText: e.target.value })}
                placeholder="Какое оружие"
                aria-label="Оружие словами"
                className="w-40 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-text-faint focus:border-primary focus:outline-none"
              />
            )}
            <Segmented
              label="Пол"
              value={nomination.gender}
              onChange={(gender) => patch(nomination.key, { gender })}
              options={[
                { value: 'Any' as Gender, label: 'Общая' },
                { value: 'Male' as Gender, label: 'М' },
                { value: 'Female' as Gender, label: 'Ж' },
              ]}
            />
            <input
              value={nomination.minAge}
              onChange={(e) => patch(nomination.key, { minAge: e.target.value })}
              inputMode="numeric"
              placeholder="от"
              aria-label="Возраст от"
              className="w-16 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-text-faint focus:border-primary focus:outline-none"
            />
            <input
              value={nomination.maxAge}
              onChange={(e) => patch(nomination.key, { maxAge: e.target.value })}
              inputMode="numeric"
              placeholder="до"
              aria-label="Возраст до"
              className="w-16 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-text-faint focus:border-primary focus:outline-none"
            />
            <Toggle
              label="Командная"
              active={nomination.isTeam}
              onClick={() => patch(nomination.key, { isTeam: !nomination.isTeam })}
            />
            <Toggle
              label="Новички"
              active={nomination.isBeginnerFriendly}
              onClick={() => patch(nomination.key, { isBeginnerFriendly: !nomination.isBeginnerFriendly })}
            />
            <button
              type="button"
              onClick={() => setNominations((list) => list.filter((n) => n.key !== nomination.key))}
              aria-label="Убрать номинацию"
              className="ml-auto rounded-lg px-2 py-1 text-text-muted hover:text-danger"
            >
              ✕
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() => setNominations((list) => [...list, { ...EMPTY, key: Date.now() + list.length }])}
          className="self-start text-sm text-primary hover:underline"
        >
          + Добавить номинацию
        </button>
      </section>

      <input name="contact" placeholder="Ваш контакт для модератора" className={FIELD} />
      <input name="note" placeholder="Что сказать модератору (необязательно)" className={FIELD} />

      {/* Ловушка для ботов: человек этого поля не видит и не попадает в него табуляцией. */}
      <input
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />

      {error && <p className="text-sm text-danger">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className="self-start rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {saving ? 'Отправляем…' : 'Отправить заявку'}
      </button>
    </form>
  );
}
