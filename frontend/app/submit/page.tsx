'use client';

import { useState } from 'react';

import { apiBase } from '@/src/lib/api';

/**
 * Заявка на турнир от кого угодно: входа в сервисе нет, поэтому форма — единственный способ
 * попасть в календарь помимо импорта. Поле «website» скрыто от человека и существует для ботов
 * (сервер молча отбрасывает заполненные), поэтому у него нет подписи и оно вне табуляции.
 *
 * Номинаций в первой версии формы нет намеренно: их проще уточнить модератору по ссылке, чем
 * заставлять заявителя заполнять таблицу оружия и возрастов.
 */
const FIELD = 'w-full rounded-lg border border-border-light bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary';

export default function SubmitPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
          locationManual: value('locationManual'),
          organizerName: value('organizerName'),
          externalUrl: value('externalUrl'),
          description: value('description'),
          contact: value('contact'),
          note: value('note'),
          website: value('website'),
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
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-3">
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
      <input name="locationManual" placeholder="Город и место проведения" className={FIELD} />
      <input name="organizerName" placeholder="Организатор: клуб или человек" className={FIELD} />
      <input name="externalUrl" placeholder="Ссылка на анонс или регистрацию" className={FIELD} />
      <textarea name="description" placeholder="Описание: номинации, формат, взнос" rows={4} className={FIELD} />
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
