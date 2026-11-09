# -*- coding: utf-8 -*-
"""
Перенос календаря из базы портала hema.ru — ИСТОЧНИКА ПРАВДЫ (решение заказчика 06.11.2026:
«голден сорс — это наша база, мы её долго выглаживали»).

Чем это отличается от прочих импортов: `import_hemagon.py` и `import_spreadsheet.py` приносят
турниры из внешних источников и неизбежно ошибаются — хемагон, например, отдаёт АВТОРА записи,
и в организаторах календаря оказывались «Анастасия Смирнова» и «Организатор Фехтерры» вместо
клубов. В портале те же турниры разметили руками: клуб-организатор, со-организаторы, город,
номинации. Поэтому здесь перенос в одну сторону — портал переписывает файлы целиком.

Запуск (нужна поднятая база портала):

    docker start hemaportal-postgres-1
    python scripts/import_portal.py --dry-run        # показать, что изменится
    python scripts/import_portal.py                  # записать

Чтения из базы делает psql внутри контейнера — драйвера postgres на машине нет, а тащить
зависимость ради одного запроса раз в месяц незачем. Готовую выгрузку можно передать файлом:
`--from-json export.json` (так же работает на машине без докера).
"""
import argparse
import datetime as dt
import json
import pathlib
import re
import subprocess
import sys

from calendar_data import (DEFAULT_TYPE, EVENTS, ROOT, event_files, load_events, place_for,
                           save_event, titles_look_alike)

# Выгрузка одним запросом: событие со всем, что календарь умеет показать. Поля вроде правил,
# цен и постера в портале заполнены у единиц событий (проверено 06.11.2026: регистрация у 3,
# правила у 1, постер у 1) — ради них заводить поля в YAML нечего, вернёмся, когда наполнятся.
QUERY = r"""
select coalesce(json_agg(x order by x.starts, x.slug), '[]'::json)::text from (
  select
    e."Slug"                                   as slug,
    e."Title"                                  as title,
    to_char(e."StartsAt", 'YYYY-MM-DD')        as starts,
    to_char(e."EndsAt",   'YYYY-MM-DD')        as ends,
    ct."Name"                                  as city,
    nullif(btrim(coalesce(e."LocationVenue", e."LocationManual", '')), '') as place,
    coalesce(nullif(btrim(cl."ShortName"), ''), cl."Name")                 as organizer,
    (select json_agg(coalesce(nullif(btrim(c2."ShortName"), ''), c2."Name") order by c2."Name")
       from event_co_organizers co join clubs c2 on c2."Id" = co."ClubId"
      where co."EventId" = e."Id")             as co_organizers,
    nullif(btrim(coalesce(e."Description", '')), '')                       as description,
    e."Type"                                   as type,
    e."IsOnline"                               as online,
    e."MacroRegionOverride"                    as region,
    -- Дисциплины события (event_weapons). У турнира портал держит в них копию оружия номинаций
    -- (EventsService.ResolveWeaponIds), поэтому в файл они уедут только у не-турниров: иначе в
    -- календаре появился бы второй источник правды о том же.
    (select json_agg(w."Code" order by w."Code")
       from event_weapons ew join weapons w on w."Id" = ew."WeaponId"
      where ew."EventId" = e."Id")             as weapons,
    nullif(btrim(coalesce(e."ExternalUrl", '')), '')                       as url,
    nullif(btrim(coalesce(e."HemagonUrl", '')), '')                        as hemagon_url,
    (select json_agg(json_build_object(
              'weapon', w."Code", 'gender', n."Gender", 'min_age', n."MinAge",
              'max_age', n."MaxAge", 'team', n."IsTeam", 'beginners', n."IsBeginnerFriendly",
              'notes', n."Notes")
            order by n."SortOrder", n."Id")
       from event_nominations n join weapons w on w."Id" = n."WeaponId"
      where n."EventId" = e."Id")              as nominations
  from events e
  left join cities ct on ct."Id" = e."CityId"
  left join clubs  cl on cl."Id" = e."CreatorClubId"
  -- Та же область видимости, что у самого портала (EventRepository.Scoped + календарный
  -- фильтр): опубликовано, не снято с публикации, в календаре, утверждено. Без проверки
  -- публикации в календарь уехал бы отменённый турнир — «Кубок Севера 2026» сняли 06.11.2026,
  -- а проекция его показывала.
  where e."InCalendar" and e."CalendarStatus" = 2
    and e."PublishedAt" is not null and e."UnpublishedAt" is null
) x;
"""

# Пол номинации в портале: Male = 0, Female = 1, Mixed = 2 (NominationGender.cs). «Общий» зачёт
# портал хранит двумя строками — мужской и женский, а не одной смешанной.
GENDER = {0: "male", 1: "female", 2: "any"}

# Типы события (EventType.cs). В общий календарь портал пускает не всё: хозяйственные форматы
# (экзамен, уборка) отсекает карта аудиторий, открытые тренировки и дни открытых дверей —
# отдельный запрет. Чего нет в этой карте, то в календаре и не появится; неизвестное значение
# станет «другим» и будет видно в проверке данных.
TYPE = {0: "other", 1: "lecture", 2: "seminar", 6: "tournament", 7: "festival", 10: "camp"}

# Макрорегионы (MacroRegion.cs). Берём ЧИСЛО, а не подпись портала: подписи у нас и у него
# разошлись бы на первой же правке — портал отдаёт «зарубежье» со строчной, справочник
# календаря знает «Зарубежье», и на строковом сравнении регион молча перестал бы совпадать.
REGION = {
    1: "Центр", 2: "Север европейской части", 3: "Юг европейской части", 4: "Урал",
    5: "Сибирь", 6: "Дальний Восток", 7: "Зарубежье", 8: "Поволжье",
}

# Пометки в заметке номинации — наследство разметки портала: «hemagon: Длинный меч "открытый" -
# Мужчины» (1462 номинации), «VK: …», «исходный текст: …». Приставка говорит, ОТКУДА строка, и
# читателю календаря не нужна, а вот сама строка — нужна: в ней уточнение вроде «открытый»,
# «новички», «Ренессанс», которого больше нигде нет. Поэтому приставку срезаем, текст оставляем.
NOTE_PREFIXES = ("hemagon:", "vk:", "исходный текст:")
# А это записка разметчику целиком, показывать её нечего.
NOTE_NOISE = ("не распознано",)

DEFAULT_MIN_AGE = 18


def fetch(container: str) -> list[dict]:
    """Выгрузка из базы портала через psql в контейнере."""
    result = subprocess.run(
        ["docker", "exec", "-i", container, "psql", "-U", "hema", "-d", "hema", "-t", "-A", "-f", "-"],
        input=QUERY, capture_output=True, text=True, encoding="utf-8",
    )
    if result.returncode != 0:
        raise SystemExit(f"psql не отдал данные (код {result.returncode}):\n{result.stderr.strip()}")
    return json.loads(result.stdout.strip() or "[]")


def nomination_of(raw: dict) -> dict | None:
    """Номинация портала → номинация календаря. Умолчания не пишем (docs/Data.md)."""
    if not raw.get("weapon"):
        return None
    out: dict = {"weapon": raw["weapon"]}
    gender = GENDER.get(raw.get("gender"), "any")
    if gender != "any":
        out["gender"] = gender
    low, high = raw.get("min_age"), raw.get("max_age")
    # 18 без верхней границы — это и есть умолчание календаря, писать его незачем. А вот вместе
    # с max_age нижнюю границу пишем всегда: без неё диапазон читался бы как 18…max.
    if high is not None:
        out["min_age"] = low if low is not None else DEFAULT_MIN_AGE
        out["max_age"] = high
    elif low is not None and low != DEFAULT_MIN_AGE:
        out["min_age"] = low
    if raw.get("team"):
        out["team"] = True
    if raw.get("beginners"):
        out["beginners"] = True
    out_notes = clean_note(raw.get("notes"))
    if out_notes:
        out["notes"] = out_notes
    return out


def clean_note(raw: str | None) -> str | None:
    """Заметка номинации без служебной приставки источника; записка разметчику — на выброс."""
    note = (raw or "").strip()
    if not note or any(note.lower().startswith(noise) for noise in NOTE_NOISE):
        return None
    for prefix in NOTE_PREFIXES:
        if note.lower().startswith(prefix):
            note = note[len(prefix):].strip()
            break
    return note or None


def event_of(raw: dict) -> dict:
    # Даты — объектами, а не строками: иначе YAML пишет их в кавычках, и файл, набранный руками,
    # отличается от файла импорта на пустом месте (docs/Data.md: «starts: 2026-11-07, без кавычек»).
    item = {"title": (raw["title"] or "").strip(), "starts": dt.date.fromisoformat(raw["starts"])}
    if raw.get("ends") and raw["ends"] != raw["starts"]:
        item["ends"] = dt.date.fromisoformat(raw["ends"])

    # Умолчание в файл не пишется — см. calendar_data.DEFAULT_TYPE.
    kind = TYPE.get(raw.get("type"), "other")
    if kind != DEFAULT_TYPE:
        item["type"] = kind

    # Перенос НОРМАЛИЗУЕТ, а не падает: ошибка на портальных данных остановила бы обновление
    # календаря целиком (проверка стоит гейтом перед пушем в main). Поэтому противоречивых
    # сочетаний он не производит вовсе — у онлайна не пишет места, при городе не пишет региона,
    # у турнира не пишет дисциплин.
    online = bool(raw.get("online"))
    if online:
        item["online"] = True
    elif raw.get("city"):
        item["city"] = raw["city"]
    else:
        # Площадку берём, только пока город неизвестен (calendar_data.place_for): адрес с улицей
        # и домом в календарь не уезжает.
        place = place_for(raw.get("place"), raw.get("city"))
        if place:
            item["place"] = place
        region = REGION.get(raw.get("region"))
        if region:
            item["region"] = region
    if raw.get("organizer"):
        item["organizer"] = raw["organizer"].strip()
    if raw.get("co_organizers"):
        item["co_organizers"] = [c.strip() for c in raw["co_organizers"] if (c or "").strip()]
    if raw.get("url"):
        item["url"] = raw["url"]
    if raw.get("hemagon_url"):
        item["hemagon_url"] = raw["hemagon_url"]
    if raw.get("description"):
        item["description"] = raw["description"]
    # Дисциплины — только у не-турниров: у турнира их несёт номинация, и список был бы копией.
    if kind != DEFAULT_TYPE and raw.get("weapons"):
        item["weapons"] = list(raw["weapons"])
    nominations = [n for n in (nomination_of(x) for x in (raw.get("nominations") or [])) if n]
    if nominations:
        item["nominations"] = nominations
    item["source"] = "portal"
    item["source_key"] = raw["slug"]
    return item


def split_links(item: dict) -> None:
    """Карточку хемагона — в `hemagon_url`, всё прочее (пост ВК, сайт турнира) — в `url`.

    Признак тот же, что у `calendar_data.links_for` (им раскладывают ссылки импорты заявок и
    хемагона), но поведение в крайнем случае разное, и это осознанно: links_for лишнюю
    не-хемагоновскую ссылку отдаёт в отчёт человеку, а здесь она остаётся на месте и валится на
    проверке данных. База портала — источник правды: ссылку, попавшую не в своё поле, надо
    чинить в ней, а молчаливое выбрасывание спрятало бы ошибку.
    """
    for field in ("url", "hemagon_url"):
        value = (item.get(field) or "").strip()
        if value and "hemagon." in value:
            item.pop(field, None)
            if not item.get("hemagon_url"):
                item["hemagon_url"] = value
    for field in ("url", "hemagon_url"):
        if not item.get(field):
            item.pop(field, None)


def norm_title(title: str) -> str:
    """Название для сверки: без регистра, ё и знаков. Для показа не годится — только сравнивать."""
    low = re.sub(r"[^0-9a-zа-яё]+", " ", title.lower().replace("ё", "е"))
    return " ".join(low.split())


def find_near(events: list[dict], item: dict) -> dict | None:
    """Тот же турнир в прежних файлах, когда название или дата разошлись: источники датируют
    по-разному («Next Level, masters (ЮФО)» 14-15 ноября против «NEXT LEVEL MASTERS, ЮФО 2026»
    15-го) и называют по-своему."""
    starts = item["starts"]
    for other in events:
        try:
            other_starts = dt.date.fromisoformat(str(other.get("starts"))[:10])
        except ValueError:
            continue
        if abs((other_starts - starts).days) > 3:
            continue
        if titles_look_alike(item["title"], str(other.get("title") or "")):
            return other
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Перенос календаря из базы портала")
    parser.add_argument("--container", default="hemaportal-postgres-1", help="контейнер с базой портала")
    parser.add_argument("--from-json", help="готовая выгрузка вместо обращения к базе")
    parser.add_argument("--dry-run", action="store_true", help="показать, что изменится, и не писать")
    parser.add_argument("--keep-place", action="store_true", default=True,
                        help="сохранять площадку из текущего файла, если в портале её нет")
    args = parser.parse_args()

    rows = (json.loads(pathlib.Path(args.from_json).read_text(encoding="utf-8"))
            if args.from_json else fetch(args.container))
    print(f"из портала: {len(rows)} событий календаря")

    # Портал знает не всё: описание у него заполнено у ОДНОГО события из 377, площадка у шести,
    # ссылка у 313. У нас описания приехали из хемагона (271 турнир) и для читателя это главный
    # текст страницы. Поэтому перенос не «стирает начисто»: портал побеждает там, где у него
    # данные есть, а чего он не хранит — досыпаем из прежних файлов по совпадению турнира.
    existing = load_events()
    old_by_key = {str(e.get("source_key")): e for e in existing if e.get("source") == "portal"}
    old_by_title = {}
    for e in existing:
        old_by_title.setdefault((str(e.get("starts")), norm_title(str(e.get("title") or ""))), e)

    written, items, filled = [], [], {"description": 0, "place": 0, "url": 0, "hemagon_url": 0}
    for raw in rows:
        item = event_of(raw)
        old = old_by_key.get(raw["slug"]) or old_by_title.get((raw["starts"], norm_title(item["title"])))
        if old is None:
            old = find_near(existing, item)
        # Хемагон — отдельная ссылка, а не «анонс». И портал, и наши импорты клали карточку
        # соревнования в общее поле внешней ссылки (в портале — у 292 событий из 313), и читатель
        # видел бы «Анонс», ведущий на сетку. Разводим обе стороны ДО досыпки, иначе портальный
        # хемагон занимал бы место анонса и прежняя ссылка на ВК не доезжала.
        split_links(item)
        if old is not None:
            spare = {"description": old.get("description"), "place": old.get("place"),
                     "url": old.get("url"), "hemagon_url": old.get("hemagon_url")}
            split_links(spare)
            for field in ("description", "place", "url", "hemagon_url"):
                if not item.get(field) and spare.get(field):
                    item[field] = spare[field]
                    filled[field] += 1
        # То же правило и для досыпанной площадки: без него адрес, однажды попавший в файл,
        # возвращался бы в него на каждом переносе из прежней версии.
        if not place_for(item.get("place"), item.get("city")):
            item.pop("place", None)

        items.append(item)
        path = EVENTS / raw["starts"][:4] / f"{raw['slug']}.yaml"
        written.append(path)
        if not args.dry_run:
            save_event(path, item)

    keep = {p.resolve() for p in written}
    extra = [p for p in event_files() if p.resolve() not in keep]
    print(f"записано файлов: {len(written)}")
    print("досыпано из прежних файлов: " + ", ".join(f"{k} {v}" for k, v in filled.items()))
    print(f"со ссылкой на хемагон: {sum(1 for i in items if i.get('hemagon_url'))}, "
          f"с анонсом: {sum(1 for i in items if i.get('url'))}, "
          f"с описанием: {sum(1 for i in items if i.get('description'))}")
    print(f"лишних файлов (в портале таких турниров нет): {len(extra)}")
    for path in sorted(extra):
        print(f"  - {path.relative_to(ROOT)}")
    if not args.dry_run:
        for path in extra:
            path.unlink()
        for folder in sorted({p.parent for p in event_files()} | {EVENTS}):
            if folder.is_dir() and not any(folder.iterdir()):
                folder.rmdir()
    print("(dry-run: файлы не тронуты)" if args.dry_run else "готово")
    return 0


if __name__ == "__main__":
    sys.exit(main())
