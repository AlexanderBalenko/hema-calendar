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

from import_common import Importer  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MONTHS_EN = {m: i + 1 for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July", "August", "September",
     "October", "November", "December"])}

# Колонки номинаций в графике (вторая строка шапки) -> код оружия календаря.
XLSX_WEAPON_COLUMNS = {10: "longsword", 11: "saber", 12: "rapier", 13: "rapier", 14: "buckler"}

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
    words = [w for w in re.split(r"[^а-яёa-z0-9]+", fragment.lower()) if w]
    return bool(words) and all(w in QUALIFIER_WORDS for w in words)


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
            if any(m in low for m in TEAM_MARKERS):
                previous["team"] = True
            if any(m in low for m in BEGINNER_MARKERS):
                previous["beginners"] = True
            previous["notes"] = f"{previous.get('notes', '')}, {fragment}".strip(", ")[:500]
            continue

        nomination: dict = {"weapon": code} if code else {"text": fragment[:120]}
        if gender:
            nomination["gender"] = gender
        if any(m in low for m in TEAM_MARKERS):
            nomination["team"] = True
        if any(m in low for m in BEGINNER_MARKERS):
            nomination["beginners"] = True
        if fragment and fragment != nomination.get("text"):
            nomination["notes"] = fragment[:500]
        result.append(nomination)
    return result


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
        rows.append({
            "title": title,
            "starts": start,
            "ends": parse_date(row.get("Дата завершения")) or start,
            "city": (row.get("Город") or "").strip() or None,
            "organizer": (row.get("Организатор") or "").strip() or None,
            "url": (row.get("Ссылка") or "").strip() or None,
            "place": (row.get("Адрес") or "").strip() or None,
            "nominations": nominations_from_text(row.get("Номинации") or ""),
        })
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
        importer.put(row, key)

    print(importer.report())
    if args.dry_run:
        print("(dry-run: файлы не тронуты)")


if __name__ == "__main__":
    main()
