# -*- coding: utf-8 -*-
"""Залить справочники (города, оружие) в сервис календаря.

    python scripts/seed_directories.py --api http://localhost:8085 --key dev-admin-key

Идемпотентно: существующие записи обновляются, лишние не удаляются — на город может ссылаться
уже заведённый турнир.
"""
import argparse
import io
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
DATA = pathlib.Path(__file__).resolve().parent / "data" / "directories.json"


def main() -> None:
    parser = argparse.ArgumentParser(description="Загрузка справочников в календарь")
    parser.add_argument("--api", default=os.environ.get("CALENDAR_API", "http://localhost:8085"))
    # Ключ берётся из окружения, чтобы не светиться в истории команд.
    parser.add_argument("--key", default=os.environ.get("CALENDAR_ADMIN_KEY", "dev-admin-key"))
    parser.add_argument("--file", default=str(DATA))
    args = parser.parse_args()

    payload = json.loads(io.open(args.file, encoding="utf-8").read())
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{args.api.rstrip('/')}/api/admin/directories",
        data=body, method="PUT",
        headers={"Content-Type": "application/json", "X-Calendar-Admin-Key": args.key})

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            result = json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        raise SystemExit(f"сервис ответил {error.code}: {error.read().decode()[:200]}")

    print(f"города: новых {result['createdCities']}, всего {result['totalCities']}; "
          f"оружие: новых {result['createdWeapons']}")


if __name__ == "__main__":
    main()
