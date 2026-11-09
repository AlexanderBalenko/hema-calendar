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

from calendar_data import (DEFAULT_TYPE, ROOT, TYPE_ORDER, load_cities, load_events,  # noqa: E402
                           load_weapons, validate)

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

        # Дисциплины, заявленные списком: только у не-турниров (у турнира их несут номинации).
        declared = []
        for code in event.get("weapons") or []:
            weapon = weapon_by_code.get(code)
            if weapon:
                declared.append({"name": weapon["name"], "code": code})

        out_events.append({
            # Слаг и есть опознаватель: отдельного id в файлах нет и не нужно.
            "id": event["slug"],
            "slug": event["slug"],
            "title": str(event["title"]).strip(),
            "startsAt": iso(event["starts"]),
            "endsAt": iso(event.get("ends", event["starts"])),
            "city": city["name"] if city else None,
            # Макрорегион у события с городом выводится из справочника, у события с обобщённым
            # местом («Алтайский край», «Калужская область») берётся из поля region: из строки
            # его не вывести. Тот же приём, что у портального MacroRegionOverride.
            "macroRegion": city["region"] if city else event.get("region"),
            "countryCode": city.get("country", "RU") if city else None,
            "locationManual": event.get("place"),
            "organizerName": event.get("organizer"),
            # Со-организаторы едут и в указатель: по ним работает поиск в списке, а в ленте они
            # видны на странице турнира. Пустой список не пишем — он есть у подавляющего
            # большинства турниров и весил бы в указателе больше, чем значит.
            **({"coOrganizers": [str(name).strip() for name in event["co_organizers"]]}
               if event.get("co_organizers") else {}),
            "externalUrl": event.get("url"),
            "hemagonUrl": event.get("hemagon_url"),
            "description": event.get("description"),
            # Тип на проводе называется kind, а в файле type: так же, как place → locationManual
            # и organizer → organizerName. Имя взято у портального EventKindIcon, чтобы
            # одинаковое называлось одинаково в обоих проектах.
            "kind": event.get("type", DEFAULT_TYPE),
            # Дисциплины не-турнира. Пустой список не пишем вовсе — он есть у 97% событий и в
            # указателе весил бы больше, чем значит.
            **({"weapons": declared} if declared else {}),
            **({"online": True} if event.get("online") else {}),
            "nominations": nominations,
        })

    # Справочники для фильтров: только то, что реально встречается в календаре. Список из 195
    # городов, где турниров не было никогда, фильтру не нужен — он его только раздувает.
    used_cities = {e["city"] for e in out_events if e["city"]}

    def weapon_codes_of(event: dict) -> set[str]:
        """Оружие события — объединение номинаций и заявленных дисциплин. Ровно то же правило
        считает отбор на фронте (`filters.ts`): у турнира второе слагаемое пустое по модели, у
        феста без номинаций — первое."""
        codes = {n["weaponCode"] for n in event["nominations"] if n["weaponCode"]}
        return codes | {w["code"] for w in event.get("weapons") or []}

    used_codes = {code for e in out_events for code in weapon_codes_of(e)}

    # Порядок видов оружия в фильтре — по распространённости, а не по алфавиту: длинный меч,
    # сабля и рапира есть в сотнях турниров, кинжал и мессер — в единицах, и прокручивать до
    # сабли через дюссак с кинжалом человеку незачем. Считаем ТУРНИРЫ, а не номинации: турнир с
    # четырьмя сабельными зачётами — всё равно один турнир, где есть сабля.
    #
    # Порядок считается на сборке, а не проставляется руками в weapons.yaml: данные меняются
    # каждую ночь импортом, и список, который надо не забыть переставить, обязательно отстанет.
    # Поле `order` из справочника осталось тай-брейком на случай равного счёта — иначе виды с
    # одинаковым числом турниров менялись бы местами от сборки к сборке.
    events_with_weapon: dict[str, int] = {}
    for event in out_events:
        for code in weapon_codes_of(event):
            events_with_weapon[code] = events_with_weapon.get(code, 0) + 1
    by_popularity = sorted(
        (w for w in weapons if w["code"] in used_codes),
        key=lambda w: (-events_with_weapon.get(w["code"], 0), w.get("order", 0), w["name"]),
    )

    directories = {
        "weapons": [{"id": i, "name": w["name"], "code": w["code"]}
                    for i, w in enumerate(by_popularity, 1)],
        "cities": [{"id": i, "name": c["name"], "macroRegion": c["region"],
                    "countryCode": c.get("country", "RU")}
                   for i, c in enumerate(cities, 1) if c["name"] in used_cities],
        # Считаем по событиям, а не по городам: регион бывает и у события без города
        # (лагерь на загородной базе), и такой регион обязан быть в фильтре.
        "macroRegions": sorted({e["macroRegion"] for e in out_events if e["macroRegion"]}),
        # Типы — только встречающиеся, и в осмысленном порядке, а не по алфавиту. Пока в
        # календаре одни турниры, список из одного значения: фильтр с единственным вариантом
        # ничего не отбирает, и фронт его не рисует вовсе.
        "kinds": [kind for kind in TYPE_ORDER if kind in {e["kind"] for e in out_events}],
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
        # Ссылка на хемагон нужна только странице турнира — в указатель, который целиком едет
        # в браузер, её не кладём (377 ссылок это десятки килобайт на каждой загрузке).
        slim = {k: v for k, v in event.items() if k not in ("description", "id", "hemagonUrl")}
        slim["nominations"] = [{k: v for k, v in n.items() if k != "notes"}
                               for n in event["nominations"]]
        index_events.append(slim)

    print(f"событий {len(out_events)}, городов в фильтре {len(directories['cities'])}, "
          f"видов оружия {len(directories['weapons'])}")
    write("calendar.json", {"events": index_events, "directories": directories, "builtAt": built_at})
    write("events.json", {"events": out_events, "builtAt": built_at})


if __name__ == "__main__":
    main()
