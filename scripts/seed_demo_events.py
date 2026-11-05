# -*- coding: utf-8 -*-
"""Демо-турниры для пустого стенда и для CI.

Настоящие данные приезжают импортом с хемагона и из таблиц организаторов, но им нужны сеть и
живые источники. Чтобы свежеподнятый стенд (и прогон смоука в CI) не был пустым, здесь лежит
маленький набор правдоподобных турниров: прошлые и будущие, в разных городах, с номинациями на
разное оружие — ровно то, что нужно сетке месяца и фильтрам.

    python scripts/seed_demo_events.py --api http://localhost:8085 --key dev-admin-key

Идемпотентно: ключ источника фиксированный, повторный прогон обновляет те же записи. Даты
считаются от сегодняшнего дня, поэтому набор не протухает.
"""
import argparse
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# (сдвиг в днях от сегодня, длительность, название, город, организатор, номинации)
DEMO = [
    (-120, 1, "Осенний клинок", "Москва", "Клуб «Сталь»",
     [("longsword", "Any", False, False), ("saber", "Female", False, False)]),
    (-60, 2, "Кубок Поволжья", "Казань", "Дружина «Рысь»",
     [("saber", "Any", True, False), ("rapier", "Any", False, False)]),
    (-21, 1, "Первый шаг: турнир для начинающих", "Санкт-Петербург", "Школа «Фехтбух»",
     [("longsword", "Any", False, True)]),
    (-3, 1, "Зимняя рапира", "Екатеринбург", "UHFC",
     [("rapier", "Male", False, False), ("rapier", "Female", False, False)]),
    (2, 1, "Открытый турнир «Меч и баклер»", "Новосибирск", "Клуб «Северный ветер»",
     [("buckler", "Any", False, False)]),
    (9, 2, "Большой турнир выходного дня", "Москва", "Клуб «Сталь»",
     [("longsword", "Any", False, False), ("saber", "Any", True, False), ("rapier", "Any", False, True)]),
    (16, 1, "Сабельная лига", "Краснодар", "КИФ «Эфес»",
     [("saber", "Any", False, False)]),
    (30, 3, "Межрегиональный фестиваль", "Казань", "Федерация",
     [("longsword", "Any", False, False), ("messer", "Any", False, False), ("spear", "Any", True, False)]),
    (45, 1, "Турнир новичков", "Воронеж", "Клуб «Антарес»",
     [("longsword", "Any", False, True), ("saber", "Any", False, True)]),
]


def build(today: dt.date) -> list[dict]:
    batch = []
    for index, (offset, length, title, city, organizer, nominations) in enumerate(DEMO):
        start = today + dt.timedelta(days=offset)
        batch.append({
            "source": "Spreadsheet",
            # Ключ не зависит от даты: иначе каждый прогон в новый день заводил бы новые записи.
            "sourceKey": f"demo-{index:02d}",
            "title": title,
            "startsAt": start.isoformat(),
            "endsAt": (start + dt.timedelta(days=length - 1)).isoformat(),
            "cityName": city,
            "locationManual": None,
            "organizerName": organizer,
            "externalUrl": None,
            "description": "Демонстрационный турнир: данные для стенда, не настоящее событие.",
            "nominations": [{
                "weaponCode": code,
                "weaponText": None,
                "gender": gender,
                "minAge": None, "maxAge": None,
                "isTeam": team,
                "isBeginnerFriendly": beginner,
                "notes": None,
            } for code, gender, team, beginner in nominations],
        })
    return batch


def main() -> None:
    parser = argparse.ArgumentParser(description="Демо-турниры для стенда")
    parser.add_argument("--api", default=os.environ.get("CALENDAR_API", "http://localhost:8085"))
    parser.add_argument("--key", default=os.environ.get("CALENDAR_ADMIN_KEY", "dev-admin-key"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    batch = build(dt.date.today())
    if args.dry_run:
        for event in batch:
            print("  ", event["startsAt"], "|", event["title"], "|", event["cityName"])
        return

    request = urllib.request.Request(
        f"{args.api.rstrip('/')}/api/admin/events/import",
        data=json.dumps(batch, ensure_ascii=False).encode("utf-8"), method="POST",
        headers={"Content-Type": "application/json", "X-Calendar-Admin-Key": args.key})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            result = json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        raise SystemExit(f"сервис ответил {error.code}: {error.read().decode()[:300]}")

    print(f"создано {result['created']}, обновлено {result['updated']}, пропущено {result['skipped']}")
    for warning in result["warnings"][:10]:
        print("  ", warning)


if __name__ == "__main__":
    main()
