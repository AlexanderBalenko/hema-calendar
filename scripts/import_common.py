# -*- coding: utf-8 -*-
"""Общее для импортов: как найти свою запись, как слить её с файлом и что сказать человеку.

Импорт больше ничего никуда не отправляет — он правит файлы в `data/events/`, а результат
уезжает пул-реквестом. Проверку этих файлов делает тот же гейт, что и для правок руками
(scripts/validate_data.py), поэтому здесь остаётся только слияние.
"""
from __future__ import annotations

import datetime as dt
import pathlib
import re

from calendar_data import ROOT, event_path, load_events, save_event, titles_look_alike

# Поля, которыми распоряжается источник: что он дал — то и записываем. Чего он не дал, в файле
# остаётся нетронутым: город, дописанный человеком к турниру, у которого источник места не
# знает, не должен пропадать на следующем прогоне.
SOURCE_FIELDS = ["title", "starts", "ends", "city", "place", "organizer", "co_organizers", "url",
                 "description", "nominations"]

TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z",
    "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r",
    "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "c", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}


def slugify(title: str) -> str:
    """Латинский слаг из названия: имя файла — это адрес страницы, и он должен читаться и
    копироваться без процентов."""
    transliterated = "".join(TRANSLIT.get(ch, ch) for ch in title.lower().strip())
    slug = re.sub(r"[^a-z0-9]+", "-", transliterated).strip("-")
    return slug[:60].strip("-") or "turnir"


def slug_with_year(title: str, starts: str) -> str:
    """Слаг с годом на конце — как в портале (`eleonora-2027`). Год нужен потому, что в имени
    файла даты больше нет: без него «Кубок Сибири» каждого сезона садился бы на один адрес, и
    второй получал бы приписку «-2», ничего не говорящую читателю."""
    body = slugify(title)
    year = starts[:4]
    return body if body.endswith(year) else f"{body}-{year}"


def as_date(value) -> dt.date:
    if isinstance(value, dt.date) and not isinstance(value, dt.datetime):
        return value
    return dt.date.fromisoformat(str(value)[:10])


class Importer:
    """Складывает турниры источника в файлы репозитория и считает, что получилось."""

    def __init__(self, source: str, dry_run: bool = False) -> None:
        self.source = source
        self.dry_run = dry_run
        self.created: list[str] = []
        self.updated: list[str] = []
        self.skipped: list[str] = []
        self.warnings: list[str] = []

        self.events = load_events()
        existing = self.events
        # Своё узнаём по паре «источник + ключ»: названия у источников разные, даты двигаются,
        # и только ключ держит запись на месте между прогонами.
        self.by_key = {str(e.get("source_key")): e for e in existing
                       if e.get("source") == source and e.get("source_key")}
        self.all_paths = {e["_path"] for e in existing}

    def put(self, item: dict, source_key: str) -> None:
        """Записать турнир источника. `item` — поля формата data/ (см. docs/Data.md)."""
        if not item.get("title") or not item.get("starts"):
            self.skipped.append(f"без названия или даты: {item}")
            return

        item = {k: v for k, v in item.items() if v not in (None, "", [], {})}
        item["starts"] = as_date(item["starts"])
        if item.get("ends"):
            item["ends"] = as_date(item["ends"])
            if item["ends"] < item["starts"]:
                self.skipped.append(f"«{item['title']}»: дата окончания раньше начала")
                return
            if item["ends"] == item["starts"]:
                del item["ends"]
        item["source"] = self.source
        item["source_key"] = source_key

        existing = self.by_key.get(source_key)
        if existing is None:
            # Защита от задвоения между источниками. Один турнир в хемагоне, Google-таблице и
            # графике называется по-разному («Алга!» / «Турнир: "Алга!"», «Level One: Кубань» /
            # «LEVEL ONE: KUBAN»), и ключ источника их не связывает. Поэтому перед заведением
            # НОВОГО файла смотрим, нет ли в тот же день и в том же месте турнира с похожим
            # названием. Найденный не сливаем молча — пропускаем и говорим человеку: два разных
            # турнира в один день в одном городе бывают (личный и командный зачёты).
            twin = self._twin(item)
            if twin is not None:
                self.skipped.append(
                    f"«{item['title']}» ({item['starts']}) похож на «{twin['title']}» "
                    f"({twin['_path']}) — не завожу второй записью")
                return

            body = slug_with_year(item["title"], item["starts"].isoformat())
            path = event_path(item["starts"].isoformat(), body)
            suffix = 2
            while str(path.relative_to(ROOT)).replace("\\", "/") in self.all_paths:
                path = event_path(item["starts"].isoformat(), f"{body}-{suffix}")
                suffix += 1
            if not self.dry_run:
                save_event(path, item)
            self.all_paths.add(str(path.relative_to(ROOT)).replace("\\", "/"))
            self.events.append({**item, "_path": str(path.relative_to(ROOT)).replace("\\", "/")})
            self.created.append(f"{item['starts']} {item['title']}")
            return

        path = ROOT / existing["_path"]
        merged = {k: v for k, v in existing.items() if not k.startswith("_") and k != "slug"}
        for field in SOURCE_FIELDS:
            if field in item:
                merged[field] = item[field]
            elif field == "ends":
                merged.pop("ends", None)
        merged["source"] = self.source
        merged["source_key"] = source_key

        if merged == {k: v for k, v in existing.items() if not k.startswith("_") and k != "slug"}:
            return  # ничего не изменилось — файл не трогаем, чтобы не плодить пустых правок
        if not self.dry_run:
            save_event(path, merged)
        self.updated.append(f"{existing['_path']}: {merged['title']}")

    def _twin(self, item: dict) -> dict | None:
        """Уже заведённый турнир тех же дней, в том же месте и с похожим названием.

        Окно в три дня, а не «ровно тот же день»: один турнир источники датируют по-разному —
        «Next Level, masters (ЮФО)» хемагона стоял 14-15 ноября, а «NEXT LEVEL MASTERS, ЮФО 2026»
        из таблицы — 15-го, и прежняя проверка «день в день» их не сравнивала, заведя второй файл.

        Эта же проверка защищает записи портала: он — источник правды (docs/Calendar.md §3а), и
        ночной импорт не вправе заводить рядом с его турниром свой, с автором хемагона вместо
        клуба-организатора."""
        starts = item["starts"]
        where = str(item.get("city") or item.get("place") or "").strip().lower()
        for other in self.events:
            try:
                other_starts = as_date(other.get("starts"))
            except (ValueError, TypeError):
                continue
            if abs((other_starts - starts).days) > 3:
                continue
            other_where = str(other.get("city") or other.get("place") or "").strip().lower()
            if where != other_where:
                continue
            if titles_look_alike(str(item["title"]), str(other.get("title") or "")):
                return other
        return None

    def report(self) -> str:
        lines = [f"создано {len(self.created)}, обновлено {len(self.updated)}, "
                 f"пропущено {len(self.skipped)}"]
        for title in self.created[:20]:
            lines.append(f"  + {title}")
        if len(self.created) > 20:
            lines.append(f"  … ещё {len(self.created) - 20}")
        for title in self.updated[:10]:
            lines.append(f"  ~ {title}")
        if len(self.updated) > 10:
            lines.append(f"  … ещё {len(self.updated) - 10}")
        for text in self.skipped[:10] + self.warnings[:10]:
            lines.append(f"  [!] {text}")
        return "\n".join(lines)


def changed_paths() -> list[str]:
    """Файлы data/, изменённые в рабочей копии: ими отчитывается workflow импорта."""
    import subprocess
    result = subprocess.run(["git", "status", "--porcelain", "--", "data"],
                            cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    return [line[3:].strip() for line in result.stdout.splitlines() if line.strip()]


def repo_relative(path: pathlib.Path) -> str:
    return str(path.relative_to(ROOT)).replace("\\", "/")
