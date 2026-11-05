# -*- coding: utf-8 -*-
"""Импорт анонсов турниров из таблиц организаторов.

Два источника, один формат записи в сервис:
  * Google-таблица — публичный CSV-экспорт (колонки «Город/Название/Дата начала/…»);
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
import os
import pathlib
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

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


def nominations_from_text(text: str) -> list[dict]:
    """Номинации из свободного текста Google-таблицы: «л, сабля, ком» и подобное."""
    if not text or text.strip() in ("", "(номинации не указаны)"):
        return []
    synonyms = [
        ("длинн", "longsword"), ("меч и баклер", "buckler"), ("баклер", "buckler"),
        ("рапир", "rapier"), ("сабл", "saber"), ("мессер", "messer"), ("дюссак", "dussack"),
        ("копь", "spear"), ("кинжал", "dagger"), ("монтанте", "montante"), ("сайдсворд", "sidesword"),
    ]
    result = []
    for part in re.split(r"[;,/]| и ", text):
        low = part.strip().lower()
        if not low:
            continue
        code = next((c for marker, c in synonyms if marker in low), None)
        result.append({
            "weaponCode": code,
            "weaponText": None if code else part.strip()[:120],
            "gender": "Female" if "жен" in low else "Male" if "муж" in low else "Any",
            "minAge": None, "maxAge": None,
            "isTeam": any(m in low for m in TEAM_MARKERS),
            "isBeginnerFriendly": any(m in low for m in BEGINNER_MARKERS),
            "notes": part.strip()[:500] or None,
        })
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
            "startsAt": start,
            "endsAt": parse_date(row.get("Дата завершения")) or start,
            "cityName": (row.get("Город") or "").strip() or None,
            "organizerName": (row.get("Организатор") or "").strip() or None,
            "externalUrl": (row.get("Ссылка") or "").strip() or None,
            "locationManual": (row.get("Адрес") or "").strip() or None,
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
            nominations.append({
                "weaponCode": code,
                "weaponText": None,
                "gender": "Any",
                "minAge": None, "maxAge": None,
                "isTeam": any(m in low for m in TEAM_MARKERS),
                "isBeginnerFriendly": any(m in low for m in BEGINNER_MARKERS),
                "notes": f"{kind or ''} {mark}".strip()[:500] or None,
            })
        rows.append({
            "title": str(title).strip(),
            "startsAt": start.date().isoformat(),
            "endsAt": (end.date() if isinstance(end, dt.datetime) else start.date()).isoformat(),
            "cityName": str(place or "").strip() or None,
            "organizerName": str(club or "").strip() or None,
            "externalUrl": None,
            "locationManual": None,
            "nominations": nominations,
        })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Импорт анонсов из таблиц организаторов")
    parser.add_argument("--api", default=os.environ.get("CALENDAR_API", "http://localhost:8085"))
    parser.add_argument("--key", default=os.environ.get("CALENDAR_ADMIN_KEY", "dev-admin-key"))
    parser.add_argument("--google", help="идентификатор Google-таблицы")
    parser.add_argument("--gid", default="0", help="лист таблицы")
    parser.add_argument("--xlsx", help="путь к .xlsx с графиком")
    parser.add_argument("--with-past", action="store_true", help="грузить и прошедшие строки")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.google and not args.xlsx:
        raise SystemExit("нужен --google <id> или --xlsx <путь>")

    rows = read_google(args.google, args.gid) if args.google else read_xlsx(args.xlsx)

    # Ручной список «это одно и то же»: автоматическое сравнение связывает названия только
    # похожие, а «турнир MwS» и «Меч ренессанса: Спор чести» не похожи ничем, кроме сути.
    skip_path = pathlib.Path(__file__).resolve().parent / "data" / "skip_keys.json"
    skip = json.loads(io.open(skip_path, encoding="utf-8").read()) if skip_path.exists() else {}
    today = dt.date.today().isoformat()
    future = [r for r in rows if args.with_past or r["startsAt"] >= today]
    print(f"строк в источнике: {len(rows)}; к загрузке: {len(future)}"
          f"{'' if args.with_past else ' (только будущие — прошлое приезжает с хемагона)'}")

    batch = []
    for row in future:
        key = source_key(row["title"], row["startsAt"])
        if key in skip:
            print(f"  пропускаю «{row['title']}»: {skip[key]}")
            continue
        batch.append(dict(row, source="Spreadsheet", sourceKey=key))

    if args.dry_run:
        for event in batch:
            print("  ", event["startsAt"], "|", event["title"][:40], "|", event["cityName"], "|",
                  len(event["nominations"]), "номинаций")
        print("(dry-run: ничего не записано)")
        return

    request = urllib.request.Request(
        f"{args.api.rstrip('/')}/api/admin/events/import",
        data=json.dumps(batch, ensure_ascii=False).encode("utf-8"), method="POST",
        headers={"Content-Type": "application/json", "X-Calendar-Admin-Key": args.key})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            result = json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        raise SystemExit(f"сервис ответил {error.code}: {error.read().decode()[:300]}")

    print(f"создано {result['created']}, обновлено {result['updated']}, пропущено {result['skipped']}")
    for warning in result["warnings"][:20]:
        print("  ", warning)


if __name__ == "__main__":
    main()
