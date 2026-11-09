# -*- coding: utf-8 -*-
"""Проверка данных календаря. Этим гейтом турнир попадает в календарь: пул-реквест с кривым
файлом не вливается.

    python scripts/validate_data.py            # ошибки ломают прогон, предупреждения — нет
    python scripts/validate_data.py --strict   # и предупреждения тоже

Ошибка — то, что нельзя показывать людям: неизвестное поле, кривая дата, город не из
справочника, два турнира с одним ключом источника. Предупреждение — то, что решает человек:
источник не дал места, два файла похожи на один турнир.
"""
import argparse
import pathlib
import sys

# Соседний модуль импортируется явно: под `python -I` каталог скрипта в пути не появляется.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from calendar_data import DataError, load_cities, load_events, load_weapons, validate  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def main() -> int:
    parser = argparse.ArgumentParser(description="Проверка данных календаря")
    parser.add_argument("--strict", action="store_true", help="считать предупреждения ошибками")
    args = parser.parse_args()

    try:
        events, cities, weapons = load_events(), load_cities(), load_weapons()
    except DataError as error:
        print(f"[!] {error}")
        return 1

    problems = validate(events, cities, weapons)
    errors = [text for level, text in problems if level == "error"]
    warnings = [text for level, text in problems if level == "warning"]

    print(f"событий {len(events)}, городов {len(cities)}, видов оружия {len(weapons)}")
    for text in errors:
        print(f"  [ошибка] {text}")
    for text in warnings:
        print(f"  [внимание] {text}")

    if not problems:
        print("замечаний нет")
    else:
        print(f"ошибок {len(errors)}, предупреждений {len(warnings)}")

    return 1 if errors or (args.strict and warnings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
