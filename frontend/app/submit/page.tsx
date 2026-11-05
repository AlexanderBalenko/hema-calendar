import type { Metadata } from 'next';

/**
 * Подать турнир. Сайт статический — принять форму ему нечем, поэтому заявка уходит в
 * Google-форму, а раз в сутки сборщик превращает новые ответы в пул-реквест с файлом турнира
 * (docs/Data.md). Для заявителя это по-прежнему одна форма без регистрации; для календаря —
 * обычная правка данных, которую видно в истории.
 */
export const metadata: Metadata = {
  title: 'Подать турнир',
  description: 'Как добавить турнир в календарь HEMA: форма заявки или правка файла в репозитории.',
};

const FORM_URL = process.env.NEXT_PUBLIC_SUBMIT_FORM_URL ?? '';
const REPO_URL = 'https://github.com/AlexanderBalenko/hema-calendar';

export default function SubmitPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="font-display text-xl text-foreground">Подать турнир</h1>
      <p className="text-sm text-text-secondary">
        Регистрация не нужна. Заявку посмотрит человек — поэтому оставьте контакт, без него
        уточнить детали будет негде.
      </p>

      {FORM_URL ? (
        <a
          href={FORM_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="self-start rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          Заполнить форму заявки
        </a>
      ) : (
        <p className="rounded-xl bg-card p-4 text-sm text-text-secondary">
          Форма заявки ещё не подключена. Пока турнир можно добавить правкой данных в
          репозитории — см. ниже — или написать организаторам календаря через{' '}
          <a href={`${REPO_URL}/issues/new`} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
            issue на GitHub
          </a>.
        </p>
      )}

      <section className="flex flex-col gap-2 rounded-xl bg-card p-4">
        <h2 className="text-sm text-foreground">Если вы дружите с git</h2>
        <p className="text-sm text-text-secondary">
          Турниры лежат файлами в{' '}
          <a href={`${REPO_URL}/tree/main/data/events`} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
            data/events
          </a>
          : один турнир — один файл. Добавьте свой пул-реквестом, проверки прогонятся сами, а
          правку увидит человек. Так же исправляются опечатки в уже заведённых турнирах.
        </p>
      </section>

      <p className="text-xs text-text-faint">
        Календарь не хранит ни учётных записей, ни результатов турниров — только анонсы и
        прошедшие даты.
      </p>
    </div>
  );
}
