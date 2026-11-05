# -*- coding: utf-8 -*-
"""Импорт турниров с hemagon.com в календарь.

Хемагон отдаёт ТОЛЬКО состоявшиеся турниры (анонсов в его API нет вовсе) — отсюда едет прошлое
календаря, а будущее приходит из таблиц организаторов (import_spreadsheet.py).

    python scripts/import_hemagon.py --dry-run
    python scripts/import_hemagon.py --api http://localhost:8085 --key dev-admin-key

Повторный прогон не плодит дублей: сервис узнаёт свои записи по паре «источник + ключ», где
ключ — idString хемагона.
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

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
AGE_RANGE = re.compile(r"(\d{1,2})\s*[-–—]\s*(\d{1,2})\s*(?:лет|года|год)?")
AGE_PLUS = re.compile(r"(\d{1,2})\s*\+")


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

        min_age = max_age = None
        match = AGE_RANGE.search(low)
        if match:
            min_age, max_age = int(match.group(1)), int(match.group(2))
        else:
            match = AGE_PLUS.search(low)
            if match:
                min_age = int(match.group(1))

        if any(marker in low for marker in FEMALE_MARKERS):
            gender = "Female"
        elif any(marker in low for marker in MALE_MARKERS):
            gender = "Male"
        else:
            gender = "Any"

        result.append({
            "weaponCode": code,
            # Нераспознанное оружие не выбрасываем: пишем словами, как в источнике, — иначе
            # номинация исчезает молча и турнир выглядит пустым.
            "weaponText": None if code else (weapon_raw or title or None),
            "gender": gender,
            "minAge": min_age,
            "maxAge": max_age,
            "isTeam": any(marker in low for marker in TEAM_MARKERS),
            "isBeginnerFriendly": any(marker in low for marker in BEGINNER_MARKERS),
            # Категория из названия оружия («longsword - advanced») остаётся в заметке: сам код
            # оружия её не хранит, а для человека это половина смысла номинации.
            "notes": title or (weapon_raw if " - " in weapon_raw else None),
        })
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Импорт турниров с хемагона")
    parser.add_argument("--api", default=os.environ.get("CALENDAR_API", "http://localhost:8085"))
    parser.add_argument("--key", default=os.environ.get("CALENDAR_ADMIN_KEY", "dev-admin-key"))
    parser.add_argument("--dry-run", action="store_true", help="только разбор, без записи")
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

    batch, skipped_country, skipped_test, unknown_cities = [], 0, 0, set()
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

        batch.append({
            "source": "Hemagon",
            "sourceKey": item["idString"],
            "title": (item.get("title") or "").strip(),
            "startsAt": start,
            "endsAt": end,
            "cityName": city_ru or city_en or None,
            "organizerName": (author or "").strip() or None,
            "externalUrl": link or HEMAGON_PAGE.format(item["idString"]),
            "description": (detail.get("description") or "").strip() or None,
            "nominations": nominations_of(detail),
        })

    print(f"к загрузке: {len(batch)}; пропущено по стране: {skipped_country}, тестовых: {skipped_test}")
    if unknown_cities:
        print(f"[внимание] города без перевода (поедут строкой): {sorted(unknown_cities)}")

    if args.dry_run:
        for event in batch[:10]:
            print("  ", event["startsAt"], "|", event["title"][:40], "|", event["cityName"], "|", len(event["nominations"]), "номинаций")
        print("(dry-run: ничего не записано)")
        return

    sent = {"created": 0, "updated": 0, "skipped": 0}
    warnings = []
    for start in range(0, len(batch), 100):
        chunk = batch[start:start + 100]
        request = urllib.request.Request(
            f"{args.api.rstrip('/')}/api/admin/events/import",
            data=json.dumps(chunk, ensure_ascii=False).encode("utf-8"), method="POST",
            headers={"Content-Type": "application/json", "X-Calendar-Admin-Key": args.key})
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                result = json.loads(response.read().decode())
        except urllib.error.HTTPError as error:
            raise SystemExit(f"сервис ответил {error.code}: {error.read().decode()[:300]}")
        for field in sent:
            sent[field] += result[field]
        warnings.extend(result["warnings"])

    print(f"создано {sent['created']}, обновлено {sent['updated']}, пропущено {sent['skipped']}")
    for warning in warnings[:20]:
        print("  ", warning)
    if len(warnings) > 20:
        print(f"   … ещё {len(warnings) - 20}")


if __name__ == "__main__":
    main()
