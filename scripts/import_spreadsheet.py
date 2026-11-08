# -*- coding: utf-8 -*-
"""Импорт анонсов турниров из таблиц организаторов.

Три источника, один формат записи в файлы календаря:
  * Google-таблица организаторов — публичный CSV-экспорт (колонки «Город/Название/Дата
    начала/…»);
  * ответы формы заявок — та же Google-таблица с теми же колонками, но `--source submission`:
    по пометке видно, турнир прислали или нашли;
  * присланный график — .xlsx с матрицей номинаций по колонкам оружия.

    python scripts/import_spreadsheet.py --google <id> --gid <gid> --dry-run
    python scripts/import_spreadsheet.py --xlsx "C:\\путь\\Grafik.xlsx"

По умолчанию берутся ТОЛЬКО будущие строки. Причина прямая: прошлое календаря приезжает с
хемагона, и те же турниры из таблицы завелись бы вторыми записями под другими названиями —
ровно так портал однажды и задвоил воронежский турнир. Прошлое грузится только явным --with-past.
"""
import argparse
import csv
import datetime as dt
import io
import json
import pathlib
import re
import sys
import urllib.error
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from calendar_data import (DEFAULT_MIN_AGE, age_from_text, drop_age, links_for,  # noqa: E402
                           load_weapons, place_for)
from import_common import Importer  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MONTHS_EN = {m: i + 1 for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July", "August", "September",
     "October", "November", "December"])}

# Колонки номинаций в графике (вторая строка шапки) -> код оружия календаря.
XLSX_WEAPON_COLUMNS = {10: "longsword", 11: "saber", 12: "rapier", 13: "rapier", 14: "buckler"}

# Колонка, куда форма складывает заполненные блоки номинаций. Имя — контракт с
# scripts/google-form/create-form.gs (NOMINATIONS_COLUMN): переименуешь с одной стороны, и
# номинации перестанут доезжать молча. Свободная колонка «Номинации» остаётся рядом: в ней
# хвост, который в блоки не влез, и ею же пользуется таблица организаторов.
BLOCKS_COLUMN = "Номинации (конструктор)"

TEAM_MARKERS = ("ком", "команд")
BEGINNER_MARKERS = ("нов", "дет", "юнош")


def parse_date(value: str | None) -> str | None:
    value = (value or "").strip()
    if not value:
        return None
    match = re.match(r"(\d{1,2})\s+([A-Za-z]+)\s+(20\d\d)", value)
    if match and match.group(2) in MONTHS_EN:
        return f"{match.group(3)}-{MONTHS_EN[match.group(2)]:02d}-{int(match.group(1)):02d}"
    match = re.match(r"(\d{1,2})[./](\d{1,2})[./](20\d\d)", value)
    if match:
        return f"{match.group(3)}-{int(match.group(2)):02d}-{int(match.group(1)):02d}"
    match = re.match(r"(20\d\d)-(\d{2})-(\d{2})", value)
    return match.group(0) if match else None


def source_key(title: str, start: str) -> str:
    """Ключ записи: дата плюс нормализованное название. Таблицы не дают идентификаторов, а по
    одному названию турнир не узнать — в разных таблицах он пишется по-разному."""
    normalized = re.sub(r"[^a-zа-я0-9]+", "-", title.lower().replace("ё", "е")).strip("-")
    return f"{start}:{normalized[:80]}"


# Куски, которые сами по себе номинацией не являются: это уточнение к предыдущей («сабля, Ж»,
# «длинный меч (соло) общая»). Они приклеиваются к предыдущей номинации, а не заводят свою —
# иначе в календаре появляется «оружие» под названием «Ж».
QUALIFIER_WORDS = {
    "ж", "м", "жен", "муж", "женская", "мужская", "женский", "мужской",
    "общая", "общий", "общее", "соло", "пара", "парная", "ком", "команда", "командная",
    "новички", "дети", "детская", "юноши",
}


def is_qualifier(fragment: str) -> bool:
    """Уточнение к предыдущей номинации, а не своя номинация.

    Возрастная запись тоже уточнение: «сабля, 12-14 лет» — одна номинация с вилкой, а не сабля
    и загадочная номинация «12-14 лет» рядом. Поэтому возраст из куска снимается, и решает
    остаток: пусто — значит, был только возраст.
    """
    rest = drop_age(fragment)
    words = [w for w in re.split(r"[^а-яёa-z0-9]+", rest.lower()) if w]
    if not words:
        return rest.strip() != fragment.strip()
    return all(w in QUALIFIER_WORDS for w in words)


_WEAPON_CODES: dict[str, str] | None = None


def weapon_code(name: str) -> str | None:
    """Код вида оружия по названию из справочника календаря: конструктор формы присылает
    названия словами («Меч и баклер»), а в файле живёт код («buckler»)."""
    global _WEAPON_CODES
    if _WEAPON_CODES is None:
        _WEAPON_CODES = {str(w["name"]).strip().lower(): w["code"] for w in load_weapons()}
    return _WEAPON_CODES.get(str(name or "").strip().lower())


def age_number(value) -> int | None:
    """Число из поля возраста. Заявитель пишет в него что хочет («12», «12 лет», «с 12»), и
    ломать на этом заявку незачем — берём первое разумное число."""
    match = re.search(r"\d{1,3}", str(value or ""))
    if not match:
        return None
    age = int(match.group(0))
    return age if 0 < age < 120 else None


def nominations_from_blocks(text) -> list[dict]:
    """Номинации из конструктора формы: строка на номинацию, поля через «;» в твёрдом порядке —
    оружие; пол; возраст от; возраст до; особенности (см. create-form.gs, nominationsFromBlocks_).

    Разбор строгий, и это главная причина заводить конструктор: позиции полей известны, пол и
    возраст приезжают полями, и догадываться из текста («до 3 лет» — это стаж или возраст?)
    больше не нужно.

    Крайние случаи — без потерь: вид оружия, которого нет в справочнике, уезжает в `text`
    (номинация останется видна на странице турнира, просто мимо фильтра по оружию); возраст,
    указанный только сверху, идёт словами в заметку — поле `max_age` без `min_age` календарь
    запрещает (номинация без нижней границы считается взрослой, и в 18…max не попал бы никто).
    """
    result: list[dict] = []
    for line in str(text or "").splitlines():
        parts = [part.strip() for part in line.split(";")]
        if not parts or not parts[0]:
            continue  # пустой блок формы — не номинация

        code = weapon_code(parts[0])
        nomination: dict = {"weapon": code} if code else {"text": parts[0][:120]}

        gender = (parts[1] if len(parts) > 1 else "").lower()
        if gender.startswith(("жен", "девуш")):
            nomination["gender"] = "female"
        elif gender.startswith("муж"):
            nomination["gender"] = "male"

        min_age = age_number(parts[2] if len(parts) > 2 else None)
        max_age = age_number(parts[3] if len(parts) > 3 else None)
        if min_age is None and max_age is not None:
            nomination["notes"] = f"до {max_age} лет"
        else:
            set_age(nomination, min_age, max_age)

        features = (parts[4] if len(parts) > 4 else "").lower()
        if any(marker in features for marker in TEAM_MARKERS):
            nomination["team"] = True
        if any(marker in features for marker in BEGINNER_MARKERS):
            nomination["beginners"] = True
        result.append(nomination)
    return result


def set_age(nomination: dict, min_age: int | None, max_age: int | None) -> None:
    """Возрастная вилка в номинацию. Взрослые 18+ умолчание и в файл не пишутся (docs/Data.md
    §2): номинация без min_age и есть взрослая, и фильтр считает так же."""
    if min_age is None:
        return
    if max_age is not None or min_age != DEFAULT_MIN_AGE:
        nomination["min_age"] = min_age
    if max_age is not None:
        nomination["max_age"] = max_age


def nominations_from_text(text: str) -> list[dict]:
    """Номинации из свободного текста Google-таблицы: «л, сабля, ком» и подобное."""
    if not text or text.strip() in ("", "(номинации не указаны)"):
        return []
    synonyms = [
        # «Федершверт»/«федер» — тренировочный длинный меч: в таблицах им называют ту же
        # номинацию, и без синонима она уезжала текстом мимо фильтра по оружию.
        ("длинн", "longsword"), ("федер", "longsword"),
        ("меч и баклер", "buckler"), ("баклер", "buckler"),
        ("рапир", "rapier"), ("сабл", "saber"), ("мессер", "messer"), ("дюссак", "dussack"),
        ("копь", "spear"), ("кинжал", "dagger"), ("дага", "dagger"), ("монтанте", "montante"),
        ("сайдсворд", "sidesword"),
    ]
    # «Меч и баклер» — одно оружие, но разделитель « и » рвал его пополам и заводил номинацию
    # «меч». Склеиваем до разбора.
    guarded = re.sub(r"меч\s+и\s+баклер", "меч-и-баклер", text, flags=re.IGNORECASE)

    result: list[dict] = []
    # Перевод строки — такой же разделитель, как запятая: в таблицах три номинации часто
    # написаны в одной ячейке столбиком («Федершверт мужчины 18+⏎Рапира ренессанса 15+»), и
    # без этого они приезжали одной номинацией с трёхстрочной заметкой.
    for part in re.split(r"[;,/\n]| и ", guarded):
        fragment = part.strip().replace("меч-и-баклер", "меч и баклер")
        low = fragment.lower()
        if not low:
            continue

        # Возраст — то же правило, что у хемагона и портала: «сабля 12-14 лет», «рапира 18+».
        # Без слова «лет» и без плюса цифры возрастом не считаются (calendar_data.age_from_text).
        min_age, max_age = age_from_text(fragment)

        code = next((c for marker, c in synonyms if marker in low), None)
        # Сокращения таблицы: «л» — длинный меч (в шапке так и написано: «л, сабля, ком»).
        if code is None and low in ("л", "дм"):
            code = "longsword"
        # Пол пишут отдельной буквой («сабля Ж», «дага М.»), поэтому сравниваем слова
        # целиком: подстрока «м» нашлась бы в любом «мече», а «ж» — в «кинжале».
        words = [w for w in re.split(r"[^а-яёa-z0-9]+", low) if w]
        gender = ("female" if any(w == "ж" or w.startswith(("жен", "девуш")) for w in words)
                  else "male" if any(w == "м" or w.startswith("муж") for w in words) else None)

        if code is None and result and is_qualifier(fragment):
            previous = result[-1]
            if gender:
                previous["gender"] = gender
            if min_age is not None:
                set_age(previous, min_age, max_age)
            if any(m in low for m in TEAM_MARKERS):
                previous["team"] = True
            if any(m in low for m in BEGINNER_MARKERS):
                previous["beginners"] = True
            previous["notes"] = f"{previous.get('notes', '')}, {fragment}".strip(", ")[:500]
            continue

        nomination: dict = {"weapon": code} if code else {"text": fragment[:120]}
        if gender:
            nomination["gender"] = gender
        set_age(nomination, min_age, max_age)
        if any(m in low for m in TEAM_MARKERS):
            nomination["team"] = True
        if any(m in low for m in BEGINNER_MARKERS):
            nomination["beginners"] = True
        if fragment and fragment != nomination.get("text"):
            nomination["notes"] = fragment[:500]
        result.append(nomination)
    return result


def split_organizers(raw: str | None) -> list[str]:
    """Со-организаторы из одной ячейки формы. Разделители — запятая, точка с запятой, перенос
    строки и плюс: заявитель пишет как привык, и спорить с ним через форму негде. Одинокий «и»
    разделителем НЕ считается: «Щит и меч» — одно название, а не два клуба."""
    if not raw:
        return []
    parts = re.split(r"[,;\n+]+", str(raw))
    names, seen = [], set()
    for part in parts:
        name = part.strip(" \t.-—")
        if name and name.lower() not in seen:
            seen.add(name.lower())
            names.append(name)
    return names


def read_google(sheet_id: str, gid: str) -> list[dict]:
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "hema-calendar-import"}), timeout=60) as response:
        text = response.read().decode("utf-8")
    rows = []
    for row in csv.DictReader(io.StringIO(text)):
        start = parse_date(row.get("Дата начала"))
        title = (row.get("Название") or "").strip()
        if not start or not title:
            continue
        # Ссылок в заявке две — анонс и карточка хемагона, — но раскладывает их не графа, а
        # содержимое (calendar_data.links_for): заявитель путает графы в обе стороны. «Ссылка»
        # без уточнения — графа формы до разделения (06.11.2026): таблица, созданная прежней
        # версией скрипта, отдаёт ещё её.
        announce, hemagon, extra_link = links_for(
            row.get("Ссылка на анонс") or row.get("Ссылка"), row.get("Ссылка на хемагон"))
        item = {
            "title": title,
            "starts": start,
            "ends": parse_date(row.get("Дата завершения")) or start,
            "city": (row.get("Город") or "").strip() or None,
            "organizer": (row.get("Организатор") or "").strip() or None,
            "url": announce,
            "hemagon_url": hemagon,
            # Адрес из формы в календарь не уезжает: публикуется только город
            # (calendar_data.place_for). В листе заявок он остаётся — редактору он нужен,
            # читателю списка нет.
            "place": place_for(row.get("Адрес"), row.get("Город")),
            # Блоки конструктора и свободный хвост складываются: в блоках — то, что заявитель
            # выбрал полями, в «Номинациях» — что не влезло (экзотическое оружие, номинации
            # сверх десяти) и всё содержимое таблицы организаторов, где блоков нет вовсе.
            "nominations": (nominations_from_blocks(row.get(BLOCKS_COLUMN))
                            + nominations_from_text(row.get("Номинации") or "")),
        }
        # Третья ссылка в заявку не влезает: полей два. Запоминаем её служебной пометкой —
        # main() снимет её перед записью и скажет о ней человеку.
        if extra_link:
            item["_extra_link"] = extra_link
        # Пустое поле формы НЕ кладём ключом: повторный прогон затёр бы им список, дописанный
        # руками в пул-реквесте, — и делал бы это молча, на каждом ночном импорте.
        co_organizers = split_organizers(row.get("Со-организаторы"))
        if co_organizers:
            item["co_organizers"] = co_organizers
        rows.append(item)
    return rows


def read_xlsx(path: str) -> list[dict]:
    import openpyxl  # ставится отдельно: нужен только этому источнику

    sheet = openpyxl.load_workbook(path, data_only=True)["турниры"]
    rows = []
    for raw in sheet.iter_rows(min_row=3, values_only=True):
        start, end, kind, title, _region, place, club = raw[1], raw[2], raw[3], raw[4], raw[5], raw[6], raw[7]
        if not isinstance(start, dt.datetime) or not title:
            continue
        nominations = []
        for column, code in XLSX_WEAPON_COLUMNS.items():
            mark = raw[column - 1]
            if mark in (None, ""):
                continue
            low = str(mark).strip().lower()
            nomination: dict = {"weapon": code}
            if any(m in low for m in TEAM_MARKERS):
                nomination["team"] = True
            if any(m in low for m in BEGINNER_MARKERS):
                nomination["beginners"] = True
            notes = f"{kind or ''} {mark}".strip()[:500]
            if notes:
                nomination["notes"] = notes
            nominations.append(nomination)
        rows.append({
            "title": str(title).strip(),
            "starts": start.date().isoformat(),
            "ends": (end.date() if isinstance(end, dt.datetime) else start.date()).isoformat(),
            "city": str(place or "").strip() or None,
            "organizer": str(club or "").strip() or None,
            "nominations": nominations,
        })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Импорт анонсов из таблиц организаторов в data/events")
    parser.add_argument("--google", help="идентификатор Google-таблицы")
    parser.add_argument("--gid", default="0", help="лист таблицы")
    parser.add_argument("--xlsx", help="путь к .xlsx с графиком")
    parser.add_argument("--with-past", action="store_true", help="брать и прошедшие строки")
    # Ответы формы заявок читаются тем же кодом: это та же таблица с теми же колонками.
    # Отличается только пометка источника — по ней видно, турнир прислали или нашли.
    parser.add_argument("--source", default="spreadsheet", choices=["spreadsheet", "submission"],
                        help="чем пометить записи в файлах")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.google and not args.xlsx:
        raise SystemExit("нужен --google <id> или --xlsx <путь>")

    rows = read_google(args.google, args.gid) if args.google else read_xlsx(args.xlsx)

    # Ручной список «это одно и то же»: автоматическое сравнение связывает похожие названия, а
    # «турнир MwS» и «Меч ренессанса: Спор чести» не похожи ничем, кроме сути.
    skip_path = pathlib.Path(__file__).resolve().parent / "data" / "skip_keys.json"
    skip = json.loads(io.open(skip_path, encoding="utf-8").read()) if skip_path.exists() else {}
    today = dt.date.today().isoformat()
    future = [r for r in rows if args.with_past or r["starts"] >= today]
    print(f"строк в источнике: {len(rows)}; к разбору: {len(future)}"
          f"{'' if args.with_past else ' (только будущие — прошлое приезжает с хемагона)'}")

    importer = Importer(args.source, dry_run=args.dry_run)
    for row in future:
        key = source_key(row["title"], row["starts"])
        if key in skip:
            print(f"  пропускаю «{row['title']}»: {skip[key]}")
            continue
        # Служебные пометки разбора в файл не уезжают: там разрешены только поля формата.
        extra_link = row.pop("_extra_link", None)
        importer.put(row, key)
        if extra_link:
            importer.warnings.append(
                f"«{row['title']}»: ссылка «{extra_link}» в файл не уехала — полей два, анонс и "
                f"карточка хемагона; выберите нужную на пул-реквесте")

    print(importer.report())
    if args.dry_run:
        print("(dry-run: файлы не тронуты)")


if __name__ == "__main__":
    main()
