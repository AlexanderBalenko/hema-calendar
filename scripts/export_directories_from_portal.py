# -*- coding: utf-8 -*-
"""Разовая выгрузка справочников городов и оружия из базы портала в scripts/data/directories.json.

Запускается на машине, где поднят стенд портала, и только чтобы наполнить новый сервис первый
раз. Дальше справочники живут здесь: календарь не ходит в портал ни за чем.

    python scripts/export_directories_from_portal.py
"""
import io
import json
import pathlib
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
PORTAL = pathlib.Path(r"C:\Users\Xupypr\source\repos\HemaPortal")
OUT = pathlib.Path(__file__).resolve().parent / "data" / "directories.json"

# Макрорегион в портале — номер enum у субъекта РФ (MacroRegionNames.Of). Календарю он нужен
# готовой строкой: фильтр работает по названию, а номер читался бы как магическая константа.
MACRO_REGIONS = {
    "1": "Центр",
    "2": "Север европейской части",
    "3": "Юг европейской части",
    "4": "Урал",
    "5": "Сибирь",
    "6": "Дальний Восток",
    "7": "Зарубежье",
    "8": "Поволжье",
}

CITIES_SQL = (
    'select c."Name", coalesce(fs."MacroRegion"::text, \'\'), coalesce(co."Code", \'RU\') '
    'from cities c '
    'left join federal_subjects fs on fs."Id" = c."FederalSubjectId" '
    'left join countries co on co."Id" = c."CountryId" '
    'where c."IsActive" order by c."Name";'
)
WEAPONS_SQL = 'select "Name", "Code" from weapons order by "Name";'


def psql(sql: str) -> list[list[str]]:
    result = subprocess.run(
        ["docker", "compose", "exec", "-T", "postgres", "psql", "-U", "hema", "-d", "hema",
         "-t", "-A", "-F", "\t", "-c", sql],
        capture_output=True, encoding="utf-8", errors="replace", cwd=PORTAL)
    if result.returncode:
        raise SystemExit(f"psql не ответил: {result.stderr[:300]}")
    return [line.split("\t") for line in result.stdout.splitlines() if line.strip()]


cities = [
    {
        "name": name.strip(),
        "macroRegion": MACRO_REGIONS.get((region or "").strip(), "Прочее"),
        "countryCode": (country or "RU").strip().upper() or "RU",
    }
    for name, region, country in psql(CITIES_SQL)
]

weapons = [
    {"name": name.strip(), "code": code.strip().lower(), "sortOrder": i}
    for i, (name, code) in enumerate(psql(WEAPONS_SQL))
]

OUT.parent.mkdir(parents=True, exist_ok=True)
io.open(OUT, "w", encoding="utf-8").write(json.dumps({"cities": cities, "weapons": weapons}, ensure_ascii=False, indent=1))
print(f"городов {len(cities)}, оружия {len(weapons)} → {OUT}")
