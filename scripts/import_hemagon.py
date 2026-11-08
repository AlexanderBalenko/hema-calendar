# -*- coding: utf-8 -*-
"""Импорт турниров с hemagon.com в файлы календаря (data/events).

Хемагон отдаёт ТОЛЬКО состоявшиеся турниры (анонсов в его API нет вовсе) — отсюда едет прошлое
календаря, а будущее приходит из таблиц организаторов (import_spreadsheet.py).

    python scripts/import_hemagon.py --dry-run
    python scripts/import_hemagon.py

Пишет и правит файлы в рабочей копии; дальше их показывает пул-реквест, и решает человек.
Повторный прогон не плодит дублей: своё узнаётся по паре «источник + ключ», где ключ —
idString хемагона. Поля, которых источник не дал, в файле остаются нетронутыми.
"""
import argparse
import json
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from calendar_data import DEFAULT_MIN_AGE, age_from_text, links_for  # noqa: E402
from import_common import Importer  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HEMAGON_LIST = "https://hemagon.com/api/tournaments?page={}"
HEMAGON_DETAIL = "https://hemagon.com/api/tournaments/{}"
HEMAGON_PAGE = "https://hemagon.com/tournament/{}"
# РФ и соседи, чьи турниры портал считает своими; остальное — не наша аудитория.
COUNTRIES = {"RU", "GE", "KZ"}

# Город у хемагона приходит по-английски. Словарь перенесён из портала вместе с граблями:
# «Sverdlovsky City District» — это Асбест (клуб «ЯАвтор»), а похожий «Sverdlovskiy District» —
# уже Екатеринбург (UHFC - Ural). Две близкие строки означают разные города, не слить.
CITY_EN_TO_RU = {
    "Almaty": "Алматы", "Asbest": "Асбест", "Astana": "Астана", "Barnaul": "Барнаул",
    "Chelyabinsk": "Челябинск", "Ivanovo": "Иваново", "Kazan": "Казань", "Khabarovsk": "Хабаровск",
    "Krasnodar": "Краснодар", "Krasnoyarsk": "Красноярск", "Moscow": "Москва",
    "Nizhny Novgorod": "Нижний Новгород", "Novosibirsk": "Новосибирск", "Omsk": "Омск",
    "Rostov-on-Don": "Ростов-на-Дону", "Ryazan": "Рязань", "Saint Petersburg": "Санкт-Петербург",
    "Samara": "Самара", "Sevastopol": "Севастополь", "Sochi": "Сочи",
    "Sverdlovsky City District": "Асбест", "Sverdlovskiy District": "Екатеринбург",
    "Tbilisi": "Тбилиси", "Tyumen": "Тюмень", "Vladivostok": "Владивосток", "Vologda": "Вологда",
    "Voronezh": "Воронеж", "Yaroslavl": "Ярославль", "Yekaterinburg": "Екатеринбург",
    "Pervouralsk": "Первоуральск",
    # «Kazbekovsky District» (Дагестан) намеренно НЕ переведён: какой это населённый пункт,
    # по данным хемагона не понять, а выдумывать город — хуже, чем оставить место строкой.
}

# weapon.title хемагона (EN) -> код оружия календаря. Дюссак хемагон пишет двумя способами, и без
# второго написания в портале терялись 13 номинаций.
#
# Внимание: название у хемагона СОСТАВНОЕ — «longsword - women», «sword & buckler - kids»,
# «rapier & dagger - advanced». Прямым поиском по словарю распознавалась только половина: 1062
# номинации из 2016 уехали в календарь строкой «longsword - women» и показывались в списке как
# отдельное «оружие». Разбор — в weapon_of(): сначала целиком, потом голова до « - », потом голова
# до «&» («longsword & rondel» — это длинный меч с рондельным кинжалом, а не отдельный вид).
WEAPON_EN_TO_CODE = {
    "longsword": "longsword", "rapier": "rapier", "rapier & dagger": "rapier",
    "smallsword": "rapier", "saber": "saber", "sabre": "saber", "messer": "messer",
    "montante": "montante", "sidesword": "sidesword", "spear": "spear", "dagger": "dagger",
    "dussack": "dussack", "dussak": "dussack",
    "sword & buckler": "buckler", "sword & buckler - open": "buckler", "sword and buckler": "buckler",
    "olympic epee": "sport-epee", "olympic foil": "sport-foil",
    "olympic saber": "sport-saber", "olympic sabre": "sport-saber",
}

TEAM_MARKERS = ("команд", "ком.", "team", "парн")
BEGINNER_MARKERS = ("нович", "начина", "beginner", "kids", "дет", "юнош")
# «woman» и «girls» обязательны: у хемагона 192 номинации названы «saber - woman», и без этого
# написания они уезжали мужскими. Женские маркеры проверяются ПЕРВЫМИ: в «women» сидит «men».
FEMALE_MARKERS = ("жен", "women", "woman", "female", "девуш", "girls")
MALE_MARKERS = ("муж", "men", "male", "boys")


def get_json(url: str, attempts: int = 3) -> dict:
    last = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "hema-calendar-import"})
            with urllib.request.urlopen(request, timeout=40) as response:
                return json.loads(response.read().decode())
        except Exception as error:  # сеть и 5xx — обычное дело, пробуем ещё раз
            last = error
            time.sleep(1.5 * (attempt + 1))
    raise SystemExit(f"хемагон не ответил: {url} — {last}")


def weapon_of(weapon_title: str) -> str | None:
    """Код оружия из составного названия хемагона; None — если вида нет в справочнике."""
    low = weapon_title.strip().lower()
    if not low:
        return None
    head = low.partition(" - ")[0].strip()
    for candidate in (low, head, head.split("&")[0].strip()):
        code = WEAPON_EN_TO_CODE.get(candidate)
        if code:
            return code
    return None


def nominations_of(detail: dict) -> list[dict]:
    result = []
    for nom in detail.get("nominations") or []:
        title = (nom.get("title") or "").strip()
        weapon_raw = ((nom.get("weapon") or {}).get("title") or "").strip()
        code = weapon_of(weapon_raw)
        # Категория (women / kids / team / advanced) живёт в том же названии оружия, поэтому
        # маркеры ищем и в нём, а не только в названии номинации.
        low = f"{title} {weapon_raw}".lower()

        # Возраст — общим правилом (calendar_data.age_from_text): оно требует, чтобы возраст
        # был назван словом, иначе расписание и годы из названия уезжают возрастной вилкой.
        min_age, max_age = age_from_text(low)

        if any(marker in low for marker in FEMALE_MARKERS):
            gender = "female"
        elif any(marker in low for marker in MALE_MARKERS):
            gender = "male"
        else:
            gender = "any"

        nomination: dict = {}
        if code:
            nomination["weapon"] = code
        else:
            # Нераспознанное оружие не выбрасываем: пишем словами, как в источнике, — иначе
            # номинация исчезает молча и турнир выглядит пустым.
            nomination["text"] = weapon_raw or title
        if gender != "any":
            nomination["gender"] = gender
        # 18 в файл не пишем: номинация без min_age и есть взрослая (docs/Data.md §2) — так же
        # поступает портальный перенос, и файлы от разных источников выглядят одинаково.
        if min_age is not None and (max_age is not None or min_age != DEFAULT_MIN_AGE):
            nomination["min_age"] = min_age
        if max_age is not None:
            nomination["max_age"] = max_age
        if any(marker in low for marker in TEAM_MARKERS):
            nomination["team"] = True
        if any(marker in low for marker in BEGINNER_MARKERS):
            nomination["beginners"] = True
        # Категория из названия оружия («longsword - advanced») остаётся в заметке: сам код
        # оружия её не хранит, а для человека это половина смысла номинации.
        notes = title or (weapon_raw if " - " in weapon_raw else "")
        if notes and notes != nomination.get("text"):
            nomination["notes"] = notes
        result.append(nomination)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Импорт турниров с хемагона в data/events")
    parser.add_argument("--dry-run", action="store_true", help="только разбор, без записи файлов")
    parser.add_argument("--pages", type=int, default=0, help="ограничить число страниц (для проверки)")
    args = parser.parse_args()

    print("Забираю список турниров с hemagon.com …")
    items, page = [], 1
    while True:
        data = get_json(HEMAGON_LIST.format(page))
        chunk = data.get("items") or []
        items.extend(chunk)
        total = data.get("count") or 0
        if not chunk or len(items) >= total or (args.pages and page >= args.pages):
            break
        page += 1
    print(f"всего в API: {len(items)}")

    importer = Importer("hemagon", dry_run=args.dry_run)
    skipped_country, skipped_test, unknown_cities = 0, 0, set()

    for item in items:
        # Страна — отдельным полем элемента списка: {"label": "Russia", "value": "RU"}.
        country = ((item.get("country") or {}).get("value") or "RU").upper()
        if country not in COUNTRIES:
            skipped_country += 1
            continue

        # idString иногда содержит не-ASCII (например «kak-zakal-ja-lasʹ-stalʹ») — адрес
        # обязательно кодировать, иначе urllib падает на кодеке ascii и импорт встаёт целиком.
        detail = get_json(HEMAGON_DETAIL.format(urllib.parse.quote(item["idString"], safe="")))
        # Тестовые карточки самого хемагона в чужой календарь не везём.
        if detail.get("test"):
            skipped_test += 1
            continue
        # Поля дат у хемагона называются dateStart/dateEnd (не startDate): на этом импорт
        # молча привёз ноль событий — все строки отсеивались как «без даты».
        start = (detail.get("dateStart") or item.get("dateStart") or "")[:10]
        end = (detail.get("dateEnd") or item.get("dateEnd") or "")[:10] or start
        if not start:
            continue

        city_en = ((item.get("city") or {}).get("label") or "").strip()
        city_ru = CITY_EN_TO_RU.get(city_en)
        if city_en and not city_ru:
            unknown_cities.add(city_en)

        author = (detail.get("author") or {}).get("name")
        link = (detail.get("link") or {}).get("url")
        # Своя карточка — в hemagon_url, а не в url: в поле анонса она подписывалась бы на сайте
        # «Анонсом у организатора», хотя это не он (docs/Calendar.md §3а). Третье значение
        # links_for здесь всегда пустое или второй адрес того же хемагона — он выводится из
        # idString, терять нечего.
        announce, hemagon_url, _ = links_for(link, HEMAGON_PAGE.format(item["idString"]))

        importer.put({
            "title": (item.get("title") or "").strip(),
            "starts": start,
            "ends": end,
            # Город — только из справочника: непереведённое название уходит в place, иначе
            # проверка данных справедливо скажет, что такого города у нас нет.
            "city": city_ru,
            "place": None if city_ru else (city_en or None),
            "organizer": (author or "").strip() or None,
            "url": announce,
            "hemagon_url": hemagon_url,
            "description": (detail.get("description") or "").strip() or None,
            "nominations": nominations_of(detail),
        }, item["idString"])

    print(f"пропущено по стране: {skipped_country}, тестовых: {skipped_test}")
    if unknown_cities:
        print(f"[внимание] городов нет в справочнике (поедут местом строкой): {sorted(unknown_cities)}")
    print(importer.report())
    if args.dry_run:
        print("(dry-run: файлы не тронуты)")


if __name__ == "__main__":
    main()
