# Календарь турниров HEMA

[![CI](https://github.com/AlexanderBalenko/hema-calendar/actions/workflows/ci.yml/badge.svg)](https://github.com/AlexanderBalenko/hema-calendar/actions/workflows/ci.yml)
[![Pages](https://github.com/AlexanderBalenko/hema-calendar/actions/workflows/pages.yml/badge.svg)](https://github.com/AlexanderBalenko/hema-calendar/actions/workflows/pages.yml)

Календарь турниров по историческому фехтованию: прошедшие и будущие, с фильтрами по оружию,
региону, городу и датам. Сайт — статический, **сервера у него нет вовсе**.

Турниры лежат файлами в этом репозитории (`data/events/`), сайт собирается из них и
публикуется на GitHub Pages. Отсюда всё остальное: база не нужна, правки видны в истории git,
а модерация — это обычное обсуждение пул-реквеста.

Чего здесь нет намеренно: учётных записей и входа, клубов, результатов турниров и медалей,
личных отметок «пойду/интересно». Календарь не знает, кто его читает, и не хранит ничьих
персональных данных.

## Состав

| Каталог | Что это |
|---|---|
| `data/` | **Источник правды**: турниры по файлу на турнир, справочники городов и оружия. Формат — `docs/Data.md`. |
| `frontend/` | Next.js 14, статическая сборка (`output: 'export'`). Сетка месяца, фильтры, страницы турниров. |
| `scripts/` | Проверка данных, сборка JSON для сайта, импорты из внешних источников. |
| `e2e/` | Браузерный смоук против собранного сайта. |
| `docs/` | Решения и правила — `docs/Calendar.md`, формат данных — `docs/Data.md`. |

## Запуск

```bash
pip install pyyaml
python scripts/build_json.py          # data/*.yaml → frontend/src/generated/*.json
cd frontend && npm ci && npm run dev  # http://localhost:3000
```

Сборка статики — `npm run build`, результат в `frontend/out`; посмотреть его можно любой
раздачей статики, например `python -m http.server 3003` из этого каталога.

## Данные

Один турнир — один файл, имя файла и есть адрес страницы:

```yaml
# data/events/2026/2026-11-07-saber-meister.yaml
title: Saber Meister
starts: 2026-11-07
city: Калуга
organizer: Расфехтовки
url: https://vk.com/sabermeister
nominations:
  - weapon: saber
    gender: female
```

Полный формат и правила — `docs/Data.md`. Проверка:

```bash
python scripts/validate_data.py            # ошибки ломают прогон
python scripts/validate_data.py --strict   # и предупреждения тоже
```

Это тот самый гейт, которым раньше была очередь модерации: пул-реквест с кривым файлом не
вливается.

## Как добавить турнир

- **Формой.** Кнопка «Подать турнир» на сайте ведёт в Google-форму; раз в сутки импорт
  превращает новые ответы в пул-реквест. Заявителю не нужны ни аккаунт GitHub, ни git.
- **Пул-реквестом.** Добавить файл в `data/events/<год>/` — хоть прямо в вебе GitHub.
- **Импортом.** `scripts/import_hemagon.py` (прошедшие турниры) и
  `scripts/import_spreadsheet.py` (анонсы из таблиц) пишут те же файлы; по расписанию их
  запускает `.github/workflows/import.yml` и открывает пул-реквест с найденным.

Повторный прогон любого импорта не плодит дублей: своё он узнаёт по паре «источник + ключ», а
чужое похожее — по сверке «тот же день, то же место, похожее название».

## Тесты

```bash
python scripts/validate_data.py        # данные

# юнит-тесты фронта (раскладка месяца, разбор адреса, отбор турниров)
docker run --rm -v "$(pwd)/frontend:/app" -w /app node:22-alpine \
  node --experimental-strip-types --test "src/**/*.test.ts"

# браузерный смоук по собранному сайту (нужен frontend/out)
sh scripts/e2e-smoke.sh
```

Полный прогон на каждый push делает `.github/workflows/ci.yml`; публикация
(`.github/workflows/pages.yml`) не стартует без его зелёного результата.

## Публикация

GitHub Pages, сборка и выкладка — в Actions. Адрес не зашит в код: подкаталог и домен workflow
берёт из настроек Pages, поэтому тот же репозиторий работает и на `*.github.io`, и на своём
домене (`calendar.hema.ru`), когда на него направят CNAME.

## Чего ещё нет

- писем заявителю: контакт нужен, чтобы с ним связался человек;
- карты турниров и подписки на фильтр — обсуждалось, не решено.
