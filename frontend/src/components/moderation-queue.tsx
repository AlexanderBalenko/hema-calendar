'use client';

import { useCallback, useEffect, useState } from 'react';

import { apiBase } from '@/src/lib/api';
import { formatDateRange } from '@/src/lib/month-layout';
import { formatPlace } from '@/src/lib/text';

/**
 * Очередь модерации. Учётных записей в сервисе нет вовсе — модератор ходит с ключом из
 * окружения, и этот экран его просто спрашивает.
 *
 * Ключ живёт в sessionStorage, а не в localStorage: вкладку закрыли — ключ исчез. Это
 * сознательный компромисс между «вводить на каждое действие» и «оставить ключ от контактов
 * заявителей на чужом компьютере навсегда».
 */
const KEY_STORAGE = 'calendar_admin_key';

/**
 * Значение заголовка HTTP обязано укладываться в latin-1: на кириллическом ключе падает сам
 * fetch («String contains non ISO-8859-1 code point»), запрос даже не уходит, и экран честно
 * сообщал «сервис недоступен» — хотя недоступен был не сервис, а такой ключ. Проверяем до
 * отправки и говорим человеку правду. Поймано браузерным смоуком.
 */
const HEADER_SAFE = /^[\x20-\x7E]+$/;
const NOT_LATIN = 'В ключе есть символы, которые нельзя передать заголовком: допустимы латинские буквы, цифры и знаки препинания.';

type ModerationItem = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  city: string | null;
  locationManual: string | null;
  organizerName: string | null;
  externalUrl: string | null;
  description: string | null;
  submitterContact: string | null;
  submitterNote: string | null;
  source: string;
  createdAt: string;
  nominations: {
    weapon: string;
    gender: 'Any' | 'Male' | 'Female';
    minAge: number | null;
    maxAge: number | null;
    isTeam: boolean;
    isBeginnerFriendly: boolean;
    notes: string | null;
  }[];
};

const GENDER: Record<string, string> = { Any: 'общая', Male: 'мужская', Female: 'женская' };

export function ModerationQueue() {
  const [key, setKey] = useState('');
  const [typed, setTyped] = useState('');
  const [items, setItems] = useState<ModerationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(KEY_STORAGE);
      if (saved) setKey(saved);
    } catch {
      // Приватный режим браузера запрещает хранилище — просто спросим ключ заново.
    }
  }, []);

  const load = useCallback(async (adminKey: string) => {
    setError(null);
    if (!HEADER_SAFE.test(adminKey)) {
      setError(NOT_LATIN);
      setItems(null);
      return;
    }
    try {
      const res = await fetch(`${apiBase()}/api/admin/submissions`, {
        headers: { 'X-Calendar-Admin-Key': adminKey },
        cache: 'no-store',
      });
      if (res.status === 401) {
        setError('Ключ не подошёл.');
        setItems(null);
        return;
      }
      if (res.status === 404) {
        setError('Очередь закрыта: в сервисе не задан ключ модератора (Admin__Key).');
        setItems(null);
        return;
      }
      if (!res.ok) {
        setError(`Сервис ответил ${res.status}.`);
        return;
      }
      setItems((await res.json()) as ModerationItem[]);
      try {
        sessionStorage.setItem(KEY_STORAGE, adminKey);
      } catch {
        // Не сохранился — работать это не мешает.
      }
    } catch {
      setError('Сервис недоступен.');
    }
  }, []);

  useEffect(() => {
    if (key) void load(key);
  }, [key, load]);

  const decide = async (id: string, decision: 'approve' | 'reject', reason: string | null = null) => {
    setBusy(id);
    try {
      const res = await fetch(`${apiBase()}/api/admin/submissions/${id}/${decision}`, {
        method: 'POST',
        headers: { 'X-Calendar-Admin-Key': key, 'Content-Type': 'application/json' },
        body: decision === 'reject' ? JSON.stringify({ reason }) : undefined,
      });
      if (!res.ok) {
        setError(`Не получилось: сервис ответил ${res.status}.`);
        return;
      }
      // Перечитываем очередь целиком, а не вычёркиваем строку: пока модератор думал, заявок
      // могло прибавиться, и «пусто» на экране при непустой очереди — худшее из состояний.
      await load(key);
    } finally {
      setBusy(null);
    }
  };

  if (!key) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (typed.trim()) setKey(typed.trim());
        }}
        className="flex max-w-sm flex-col gap-3"
      >
        <h1 className="font-display text-xl text-foreground">Очередь модерации</h1>
        <p className="text-sm text-text-secondary">Нужен ключ модератора — тот, что задан в окружении сервиса.</p>
        <input
          type="password"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Ключ"
          aria-label="Ключ модератора"
          className="rounded-lg border border-border-light bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <button type="submit" className="self-start rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
          Войти
        </button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3">
        <h1 className="font-display text-xl text-foreground">Очередь модерации</h1>
        {items && <span className="text-sm text-text-muted">{items.length} на проверке</span>}
        <button
          type="button"
          onClick={() => {
            try {
              sessionStorage.removeItem(KEY_STORAGE);
            } catch {
              // см. выше
            }
            setKey('');
            setItems(null);
          }}
          className="ml-auto text-sm text-text-muted hover:text-primary"
        >
          Забыть ключ
        </button>
      </div>

      {error && <p className="rounded-xl bg-card p-4 text-sm text-danger">{error}</p>}
      {items?.length === 0 && <p className="rounded-xl bg-card p-4 text-sm text-text-secondary">Заявок нет.</p>}

      {items?.map((item) => (
        <article key={item.id} className="flex flex-col gap-2 rounded-xl bg-card p-4">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 className="text-base text-foreground">{item.title}</h2>
            <span className="text-xs text-text-muted">{formatDateRange(item.startsAt, item.endsAt)}</span>
            <span className="text-xs text-text-secondary">{formatPlace(item.city, item.locationManual)}</span>
            <span className="ml-auto text-xs text-text-faint">
              подана {new Date(item.createdAt).toLocaleDateString('ru-RU')}
            </span>
          </div>

          {item.organizerName && <p className="text-sm text-text-secondary">Организатор: {item.organizerName}</p>}
          {item.description && <p className="whitespace-pre-line text-sm text-text-secondary">{item.description}</p>}
          {item.externalUrl && (
            <a href={item.externalUrl} target="_blank" rel="noreferrer noopener" className="text-sm text-primary hover:underline">
              {item.externalUrl}
            </a>
          )}

          {item.nominations.length > 0 && (
            <ul className="text-sm text-text-secondary">
              {item.nominations.map((n, i) => (
                <li key={`${n.weapon}-${i}`}>
                  {n.weapon}
                  <span className="text-text-muted">
                    {` · ${GENDER[n.gender] ?? n.gender}`}
                    {n.isTeam && ' · команда'}
                    {n.isBeginnerFriendly && ' · новички'}
                    {n.minAge != null && ` · от ${n.minAge}`}
                    {n.maxAge != null && ` до ${n.maxAge}`}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="rounded-lg bg-background-secondary p-2 text-sm">
            <p className="text-text-secondary">
              Контакт: {item.submitterContact ?? <span className="text-danger">не оставлен</span>}
            </p>
            {item.submitterNote && <p className="text-text-muted">Заметка: {item.submitterNote}</p>}
          </div>

          <Decision
            busy={busy === item.id}
            onApprove={() => decide(item.id, 'approve')}
            onReject={(reason) => decide(item.id, 'reject', reason)}
          />
        </article>
      ))}
    </div>
  );
}

/**
 * Решение по заявке. Причина отказа спрашивается строкой прямо в карточке, а не окном prompt():
 * системное окно блокирует страницу, выглядит чужеродно и не даёт передумать, не потеряв текст.
 */
function Decision({
  busy,
  onApprove,
  onReject,
}: {
  busy: boolean;
  onApprove: () => void;
  onReject: (reason: string | null) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  if (rejecting) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Причина отказа — её увидит только модератор"
          aria-label="Причина отказа"
          autoFocus
          className="min-w-[260px] flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-text-faint focus:border-danger focus:outline-none"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => onReject(reason.trim() || null)}
          className="rounded-lg border border-danger px-3 py-1.5 text-sm text-danger disabled:opacity-60"
        >
          Отклонить
        </button>
        <button
          type="button"
          onClick={() => setRejecting(false)}
          className="text-sm text-text-muted hover:text-foreground"
        >
          Отмена
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={onApprove}
        className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        Опубликовать
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => setRejecting(true)}
        className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-secondary hover:border-danger hover:text-danger disabled:opacity-60"
      >
        Отклонить
      </button>
    </div>
  );
}
