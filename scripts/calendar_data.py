# -*- coding: utf-8 -*-
"""Чтение и проверка календаря из YAML-файлов репозитория.

Источник правды — `data/`: справочники `cities.yaml` и `weapons.yaml`, турниры
`events/<год>/<дата>-<слаг>.yaml` по файлу на турнир. Этот модуль — единственное место, где
знают формат: им пользуются и проверка в CI, и сборка сайта, и импорты.

Проверки здесь — то, чем раньше была очередь модерации: турнир попадает в календарь, только
если прошёл их на пул-реквесте.
"""
from __future__ import annotations

import datetime as dt
import io
import pathlib
import re

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
EVENTS = DATA / "events"

GENDERS = {"any", "male", "female"}
SOURCES = {"hemagon", "spreadsheet", "submission", "manual"}

EVENT_KEYS = {"title", "starts", "ends", "city", "place", "organizer", "url", "description",
              "source", "source_key", "nominations"}
NOMINATION_KEYS = {"weapon", "text", "gender", "min_age", "max_age", "team", "beginners", "notes"}

# Слова, которые в названии турнира ничего не различают: по ним два разных турнира выглядели бы
# одинаковыми. Перенесено из серверной защиты от дублей вместе с правилом.
NOISE_WORDS = {"турнир", "кубок", "открытый", "hema", "по", "на", "и", "the", "of",
               "2024", "2025", "2026", "2027"}


class DataError(Exception):
    """Ошибка в данных: файл не пройдёт проверку, пока её не исправят."""


# Порядок полей в файле: сначала то, что человек читает первым. Задаётся здесь, чтобы файлы
# от импорта и от руки выглядели одинаково — иначе дифф пул-реквеста полон перестановок.
FIELD_ORDER = ["title", "starts", "ends", "city", "place", "organizer", "url", "description",
               "source", "source_key", "nominations"]
NOMINATION_ORDER = ["weapon", "text", "gender", "min_age", "max_age", "team", "beginners", "notes"]


def _ordered(item: dict, order: list[str]) -> dict:
    known = {k: item[k] for k in order if k in item and item[k] not in (None, "", [], {})}
    # Поля вне списка не теряем: лучше необычный порядок, чем молча пропавшее значение.
    return {**known, **{k: v for k, v in item.items() if k not in order and not k.startswith("_")}}


class _Dumper(yaml.SafeDumper):
    """Многострочный текст пишется блоком, а не строкой в кавычках: описание турнира читают
    люди прямо в файле и правят его там же, а «\\n» посреди экранированной строки для этого
    непригодны."""


def _represent_str(dumper: yaml.SafeDumper, data: str):
    if "\n" in data:
        # Хвостовые пробелы ломают блочный стиль (PyYAML молча вернётся к кавычкам), а
        # переводы строки Windows дают лишние пустые строки.
        cleaned = "\n".join(line.rstrip() for line in data.replace("\r\n", "\n").split("\n"))
        return dumper.represent_scalar("tag:yaml.org,2002:str", cleaned, style="|")
    return dumper.represent_scalar("tag:yaml.org,2002:str", data)


_Dumper.add_representer(str, _represent_str)


def dump_event(item: dict) -> str:
    """Турнир в YAML — в том же виде, в каком его пишут руками."""
    payload = _ordered(item, FIELD_ORDER)
    if payload.get("nominations"):
        payload["nominations"] = [_ordered(n, NOMINATION_ORDER) for n in payload["nominations"]]
    return yaml.dump(payload, Dumper=_Dumper, allow_unicode=True, sort_keys=False,
                     default_flow_style=False, width=100)


def save_event(path: pathlib.Path, item: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    io.open(path, "w", encoding="utf-8", newline="\n").write(dump_event(item))


def event_path(starts: str, slug_body: str) -> pathlib.Path:
    """Путь файла турнира: год каталогом, дата началом имени — имя файла и есть адрес
    страницы, поэтому собирается оно в одном месте."""
    return EVENTS / starts[:4] / f"{starts}-{slug_body}.yaml"


def _read(path: pathlib.Path):
    try:
        return yaml.safe_load(io.open(path, encoding="utf-8"))
    except yaml.YAMLError as error:
        raise DataError(f"{path.relative_to(ROOT)}: не читается как YAML — {error}") from error


def load_cities() -> list[dict]:
    return _read(DATA / "cities.yaml") or []


def load_weapons() -> list[dict]:
    return _read(DATA / "weapons.yaml") or []


def event_files() -> list[pathlib.Path]:
    return sorted(EVENTS.rglob("*.yaml"))


def load_events() -> list[dict]:
    """Все турниры, отсортированные по дате. Слаг берётся из имени файла — второго источника
    для адреса страницы нет намеренно."""
    events = []
    for path in event_files():
        raw = _read(path)
        if not isinstance(raw, dict):
            raise DataError(f"{path.relative_to(ROOT)}: ожидался турнир, а в файле {type(raw).__name__}")
        raw = dict(raw)
        raw["slug"] = path.stem
        raw["_path"] = str(path.relative_to(ROOT)).replace("\\", "/")
        events.append(raw)
    events.sort(key=lambda e: (str(e.get("starts")), str(e.get("title"))))
    return events


# --------------------------------------------------------------------------------------------
# Проверки
# --------------------------------------------------------------------------------------------

def _as_date(value, where: str, field: str) -> dt.date:
    if isinstance(value, dt.date) and not isinstance(value, dt.datetime):
        return value
    if isinstance(value, str):
        try:
            return dt.date.fromisoformat(value)
        except ValueError:
            pass
    raise DataError(f"{where}: {field} — нужна дата вида 2026-11-07, а не «{value}»")


def _letters(value: str) -> str:
    return "".join(ch for ch in value.lower() if ch.isalnum())


def _title_words(title: str) -> set[str]:
    cleaned = re.sub(r"[\"«»:,.\-–—()|!?']", " ", title.lower().replace("ё", "е"))
    return {w for w in cleaned.split() if len(w) > 2 and w not in NOISE_WORDS}


def titles_look_alike(left: str, right: str) -> bool:
    """Похожи ли названия. Правило перенесено из защиты от дублей на сервере: сравниваем слова
    (чтобы сошлись «Epic Battle» и «Epic Battle | HEMA - турнир») и сплошную строку букв (чтобы
    сошлись «SaberMeister» и «Saber Meister»).

    Сплошная строка берётся от ИСХОДНОГО названия, а не от склейки его слов: при склейке слова
    выстраиваются в своём порядке («meister» + «saber»), и ровно тот случай, ради которого
    правило писалось, переставал ловиться.
    """
    a, b = _title_words(left), _title_words(right)
    if not a or not b:
        return False
    if len(a & b) >= min(len(a), len(b)) * 0.6:
        return True
    solid_a, solid_b = _letters(left), _letters(right)
    return len(solid_a) >= 6 and len(solid_b) >= 6 and (solid_a in solid_b or solid_b in solid_a)


def validate(events: list[dict], cities: list[dict], weapons: list[dict]) -> list[tuple[str, str]]:
    """Замечания парами («error» | «warning», текст).

    Ошибка ломает сборку: такой файл нельзя показывать людям. Предупреждение — то, что решает
    человек: неполные данные источника и подозрение на дубль. Блокировать весь календарь из-за
    турнира 2025 года, у которого хемагон не дал города, неправильно — но и молчать о нём
    нельзя.
    """
    problems: list[tuple[str, str]] = []
    city_names = {c["name"].lower() for c in cities}
    weapon_codes = {w["code"] for w in weapons}
    seen_source_keys: dict[tuple[str, str], str] = {}
    by_day: dict[str, list[dict]] = {}

    def error(text: str) -> None:
        problems.append(("error", text))

    def warn(text: str) -> None:
        problems.append(("warning", text))

    for event in events:
        where = event["_path"]
        unknown = set(event) - EVENT_KEYS - {"slug", "_path"}
        if unknown:
            error(f"{where}: лишние поля {sorted(unknown)} — опечатка?")

        title = str(event.get("title") or "").strip()
        if len(title) < 3:
            error(f"{where}: название обязательно")

        try:
            starts = _as_date(event.get("starts"), where, "starts")
            ends = _as_date(event.get("ends", event.get("starts")), where, "ends")
            if ends < starts:
                error(f"{where}: ends раньше starts")
            if not event["slug"].startswith(starts.isoformat()):
                error(f"{where}: имя файла должно начинаться с даты начала ({starts})")
            by_day.setdefault(starts.isoformat(), []).append(event)
        except DataError as parse_error:
            error(str(parse_error))
            continue

        city = event.get("city")
        if city and str(city).lower() not in city_names:
            error(f"{where}: города «{city}» нет в data/cities.yaml — добавьте его туда или "
                  f"перенесите в поле place")
        if not city and not event.get("place"):
            # Предупреждение, а не ошибка: так приезжают старые турниры, у которых источник не
            # дал города. Выдумывать место нельзя, прятать турнир — тоже.
            warn(f"{where}: нет ни city, ни place — источник не дал места")

        source = event.get("source", "manual")
        if source not in SOURCES:
            error(f"{where}: source «{source}» — ожидается одно из {sorted(SOURCES)}")
        key = event.get("source_key")
        if key:
            pair = (source, str(key))
            if pair in seen_source_keys:
                error(f"{where}: такой же source_key уже у {seen_source_keys[pair]}")
            seen_source_keys[pair] = where

        for index, nomination in enumerate(event.get("nominations") or [], 1):
            at = f"{where}: номинация {index}"
            if not isinstance(nomination, dict):
                error(f"{at}: ожидался набор полей")
                continue
            unknown = set(nomination) - NOMINATION_KEYS
            if unknown:
                error(f"{at}: лишние поля {sorted(unknown)} — опечатка?")
            weapon = nomination.get("weapon")
            if weapon and weapon not in weapon_codes:
                error(f"{at}: оружия «{weapon}» нет в data/weapons.yaml; если это не вид оружия "
                      f"календаря — пишите его в поле text")
            if not weapon and not nomination.get("text"):
                error(f"{at}: нет ни weapon, ни text")
            gender = nomination.get("gender", "any")
            if gender not in GENDERS:
                error(f"{at}: gender «{gender}» — ожидается {sorted(GENDERS)}")
            for field in ("min_age", "max_age"):
                age = nomination.get(field)
                if age is not None and not (isinstance(age, int) and 0 < age < 120):
                    error(f"{at}: {field} = «{age}» — ожидается возраст числом")

    # Дубли между источниками: тот же день, то же место, похожее название. Два разных турнира
    # в один день в одном городе бывают (личный и командный зачёты), поэтому одной даты мало —
    # и поэтому это предупреждение: решает человек на пул-реквесте, а не скрипт.
    for day, same_day in by_day.items():
        for i, left in enumerate(same_day):
            for right in same_day[i + 1:]:
                same_place = (left.get("city") or left.get("place") or "").lower() == \
                             (right.get("city") or right.get("place") or "").lower()
                if same_place and titles_look_alike(str(left.get("title")), str(right.get("title"))):
                    warn(f"{left['_path']} и {right['_path']}: {day}, одно место и похожие "
                         f"названия — похоже на один турнир, заведённый дважды")

    return problems
