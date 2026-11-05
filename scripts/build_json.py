# -*- coding: utf-8 -*-
"""Сборка данных сайта из YAML: `data/` → `frontend/src/generated/calendar.json`.

Формат на выходе — ровно тот, что фронт уже умеет читать от API (CalendarEvent, Directories):
так сетка месяца, фильтры и страницы турниров не знают, что источник сменился, и их не
пришлось переписывать.

    python scripts/build_json.py

Файл собирается на каждой сборке и в репозиторий не едет (frontend/src/generated в .gitignore):
две копии одних и тех же данных рано или поздно разойдутся.
"""
import argparse
import datetime as dt
import io
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from calendar_data import ROOT, load_cities, load_events, load_weapons, validate  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

GENERATED = ROOT / "frontend" / "src" / "generated"
GENDER_OUT = {"any": "Any", "male": "Male", "female": "Female"}


def iso(value) -> str:
    return value.isoformat() if isinstance(value, dt.date) else str(value)


def main() -> None:
    parser = argparse.ArgumentParser(description="Сборка calendar.json из YAML")
    parser.add_argument("--out", default=str(GENERATED), help="каталог для собранных файлов")
    args = parser.parse_args()

    events, cities, weapons = load_events(), load_cities(), load_weapons()
    problems = [text for level, text in validate(events, cities, weapons) if level == "error"]
    if problems:
        for text in problems:
            print(f"  [ошибка] {text}")
        raise SystemExit("данные не прошли проверку — сборка остановлена")

    city_by_name = {c["name"].lower(): c for c in cities}
    weapon_by_code = {w["code"]: w for w in weapons}

    out_events = []
    for event in events:
        city = city_by_name.get(str(event.get("city") or "").lower())
        nominations = []
        for nomination in event.get("nominations") or []:
            code = nomination.get("weapon")
            weapon = weapon_by_code.get(code) if code else None
            nominations.append({
                "weapon": weapon["name"] if weapon else (nomination.get("text") or ""),
                "weaponCode": code if weapon else None,
                "gender": GENDER_OUT.get(nomination.get("gender", "any"), "Any"),
                "minAge": nomination.get("min_age"),
                "maxAge": nomination.get("max_age"),
                "isTeam": bool(nomination.get("team")),
                "isBeginnerFriendly": bool(nomination.get("beginners")),
                "notes": nomination.get("notes"),
            })

        out_events.append({
            # Слаг и есть опознаватель: отдельного id в файлах нет и не нужно.
            "id": event["slug"],
            "slug": event["slug"],
            "title": str(event["title"]).strip(),
            "startsAt": iso(event["starts"]),
            "endsAt": iso(event.get("ends", event["starts"])),
            "city": city["name"] if city else None,
            "macroRegion": city["region"] if city else None,
            "countryCode": city.get("country", "RU") if city else None,
            "locationManual": event.get("place"),
            "organizerName": event.get("organizer"),
            "externalUrl": event.get("url"),
            "description": event.get("description"),
            "nominations": nominations,
        })

    # Справочники для фильтров: только то, что реально встречается в календаре. Список из 195
    # городов, где турниров не было никогда, фильтру не нужен — он его только раздувает.
    used_cities = {e["city"] for e in out_events if e["city"]}
    used_codes = {n["weaponCode"] for e in out_events for n in e["nominations"] if n["weaponCode"]}
    directories = {
        "weapons": [{"id": i, "name": w["name"], "code": w["code"]}
                    for i, w in enumerate(weapons, 1) if w["code"] in used_codes],
        "cities": [{"id": i, "name": c["name"], "macroRegion": c["region"],
                    "countryCode": c.get("country", "RU")}
                   for i, c in enumerate(cities, 1) if c["name"] in used_cities],
        "macroRegions": sorted({c["region"] for c in cities if c["name"] in used_cities}),
    }

    built_at = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
    out_dir = pathlib.Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    def write(name: str, payload) -> None:
        path = out_dir / name
        io.open(path, "w", encoding="utf-8", newline="\n").write(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        print(f"  {path.relative_to(ROOT)}: {path.stat().st_size / 1024:.0f} КБ")

    # Два файла, и это не дубль, а разделение по цене доставки. Лёгкий уезжает в браузер
    # целиком (сетка и фильтры работают без единого запроса), и описания с заметками в нём
    # утроили бы вес: 100 КБ сжатого против 24. Полный читает сборка страниц турниров —
    # серверный компонент, его импорт в браузер не попадает вовсе.
    index_events = []
    for event in out_events:
        slim = {k: v for k, v in event.items() if k not in ("description", "id")}
        slim["nominations"] = [{k: v for k, v in n.items() if k != "notes"}
                               for n in event["nominations"]]
        index_events.append(slim)

    print(f"турниров {len(out_events)}, городов в фильтре {len(directories['cities'])}, "
          f"видов оружия {len(directories['weapons'])}")
    write("calendar.json", {"events": index_events, "directories": directories, "builtAt": built_at})
    write("events.json", {"events": out_events, "builtAt": built_at})


if __name__ == "__main__":
    main()
