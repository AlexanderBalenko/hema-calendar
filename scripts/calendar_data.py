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
# Номинация без min_age — взрослая. Так в портале (поле обязательное, значение по умолчанию
# 18), так же считает фильтр по возрасту, и поэтому 18 в файл не пишется: это умолчание.
DEFAULT_MIN_AGE = 18

# Возраст обязан быть НАЗВАН словом «лет»/«года» или плюсом, и цифры не должны быть куском
# числа побольше. Без этого «1880-1890е гг.» в названии лекции превращалось в номинацию «от 80
# до 18» (поймано валидацией 06.11.2026), а «сб 18:00 - 20:30» — в детский зачёт 0–20.
# Все настоящие возрастные номинации единицу называют: «Сабля 12-14 лет», «Рапира 15+».
AGE_RANGE = re.compile(r"(?<!\d)(\d{1,2})\s*[-–—]\s*(\d{1,2})\s*(?:лет|год[аов]?)(?!\w)", re.I)
AGE_PLUS = re.compile(r"(?<!\d)(\d{1,2})\s*\+")
SOURCES = {"portal", "hemagon", "spreadsheet", "submission", "manual"}

# Типы мероприятий — подмножество EventType портала, которое вообще может оказаться в календаре.
# Хозяйственных форматов (уборка, экзамен) здесь нет и быть не может: в портале им разрешена
# единственная аудитория «своим», а календарь требует «Сообществу». Открытые тренировки и дни
# открытых дверей не пускает сам портал (решение заказчика 09.11.2026): у клуба с недельным
# ритмом они дали бы полсотни записей в год.
TYPE_ORDER = ["tournament", "festival", "camp", "seminar", "lecture", "other"]
TYPES = set(TYPE_ORDER)
# Отсутствие поля означает «турнир». Умолчание в файл не пишется — тот же приём, что у min_age
# номинации: строка type: tournament появилась бы в четырёх сотнях файлов и ничего бы не
# сообщила. Цена: тип турнира не виден в файле глазами.
DEFAULT_TYPE = "tournament"
# Номинация — это ЗАЧЁТ. У феста и лагеря он законен (турнир внутри феста), у лекции и семинара
# зачётов не бывает вовсе.
TYPES_WITH_NOMINATIONS = {"tournament", "festival", "camp"}
# Онлайн бывает у того, чему не нужна площадка. Лагерь или турнир онлайн — абсурд, но данные о
# нём сохраняем (предупреждение, не ошибка): молчать о странном нельзя, а терять его — тем более.
TYPES_ONLINE = {"seminar", "lecture", "other"}

EVENT_KEYS = {"title", "starts", "ends", "type", "city", "place", "region", "online",
              "organizer", "co_organizers", "url", "hemagon_url", "description",
              "source", "source_key", "weapons", "nominations"}
NOMINATION_KEYS = {"weapon", "text", "gender", "min_age", "max_age", "team", "beginners", "notes"}

# Слова, которые в названии турнира ничего не различают: по ним два разных турнира выглядели бы
# одинаковыми. Перенесено из серверной защиты от дублей вместе с правилом.
NOISE_WORDS = {"турнир", "кубок", "открытый", "hema", "по", "на", "и", "the", "of",
               "2024", "2025", "2026", "2027"}


class DataError(Exception):
    """Ошибка в данных: файл не пройдёт проверку, пока её не исправят."""


# Порядок полей в файле: сначала то, что человек читает первым. Задаётся здесь, чтобы файлы
# от импорта и от руки выглядели одинаково — иначе дифф пул-реквеста полон перестановок.
FIELD_ORDER = ["title", "starts", "ends", "type", "city", "place", "region", "online",
               "organizer", "co_organizers", "url", "hemagon_url", "description",
               "source", "source_key", "weapons", "nominations"]
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
    """Путь файла турнира: год каталогом, слаг именем — имя файла и есть адрес страницы,
    поэтому собирается оно в одном месте.

    Даты в имени нет намеренно (решение 06.11.2026, вместе с переходом на базу портала как
    источник правды): слаги берутся из портала (`eleonora-2027`), год в них уже есть, и адрес
    страницы переживает исправление даты — иначе поправленный на день турнир менял бы ссылку,
    по которой его уже разослали."""
    return EVENTS / starts[:4] / f"{slug_body}.yaml"


def place_for(place, city) -> str | None:
    """Площадка в данных календаря — ЗАПАСНОЙ вариант города, а не адрес.

    Решение заказчика 06.11.2026: «оставь только город, не бери улицу-дом». Улица и дом в
    списке турниров ничего не решают — человек идёт за ними к организатору по ссылке, — зато
    занимают ту самую строку плашки, где должно стоять название: «Краснодар · г. Краснодар
    ул. Красная 43/1», «Воронеж · Дружинников 8». Поэтому правило простое: город известен —
    площадку не берём вовсе; города нет — площадка остаётся единственной подсказкой о месте
    («Калужская область» у выездных лагерей MWS) и сохраняется как есть.

    Адрес при этом не теряется: он остаётся в базе портала (источник правды) и в листе заявок
    формы — просто не уезжает в публичные данные календаря.
    """
    text = str(place or "").strip()
    if not text:
        return None
    return None if str(city or "").strip() else text


def links_for(announce, hemagon) -> tuple[str | None, str | None, str | None]:
    """Две ссылки турнира по своим полям: карточка хемагона — в `hemagon_url`, анонс — в `url`.

    Место ссылки решает сама ссылка, а не графа, из которой она приехала: заявитель кладёт
    карточку хемагона в графу анонса не реже, чем наоборот, а портал годами клал её туда же
    (292 события из 313). Признак один — «hemagon.» в адресе; на сайте эти две ссылки подписаны
    по-разному («Анонс у организатора» и «Турнир на Хемагоне»), и перепутанные врут читателю.

    Третьим возвращается ссылка, которой не нашлось поля: две не-хемагоновские ссылки сразу
    (сайт турнира в графе хемагона) — такое выбрасывать молча нельзя, о ней скажет отчёт
    импорта, и человек на пул-реквесте решит, какая нужнее.
    """
    url = hemagon_url = extra = None
    for value in (announce, hemagon):
        value = str(value or "").strip()
        if not value:
            continue
        if "hemagon." in value:
            if hemagon_url is None:
                hemagon_url = value
            elif value != hemagon_url:
                extra = value
        elif url is None:
            url = value
        elif value != url:
            extra = value
    return url, hemagon_url, extra


def age_from_text(text) -> tuple[int | None, int | None]:
    """Возрастная вилка из названия номинации: «12-14 лет» → (12, 14), «15+» → (15, None).

    Разбирается ровно два написания, и это не лень, а замер по живым данным (1625 номинаций с
    текстом): «N-M лет» — 171 штука, «N+» — 7. А вот «до N лет» разбирать НЕЛЬЗЯ, хотя оно
    встречается 10 раз: в большинстве это не возраст, а стаж — «меч и баклер новички до 3 лет».
    Прочитав его возрастом, календарь завёл бы номинацию для трёхлетних. «от N лет» и «U17» в
    данных не встречаются ни разу.

    Верхняя граница без нижней не возвращается никогда: номинация без min_age считается
    взрослой, и один max_age задал бы пустой диапазон 18…max (проверка данных это и ловит).
    """
    low = str(text or "")
    match = AGE_RANGE.search(low)
    if match:
        return int(match.group(1)), int(match.group(2))
    match = AGE_PLUS.search(low)
    return (int(match.group(1)), None) if match else (None, None)


def drop_age(text) -> str:
    """Тот же текст без возрастной записи. Нужен разбору свободного текста: по остатку видно,
    номинация это или уточнение к предыдущей («сабля, 12-14 лет» — одна номинация, не две)."""
    return AGE_PLUS.sub(" ", AGE_RANGE.sub(" ", str(text or "")))


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
    # Порядок: дата начала, затем дата ОКОНЧАНИЯ, и только потом название. Окончание в ключе не
    # для красоты. Лента и список подтягивают прошлое прокруткой вверх, и окно отсекается по
    # КОНЦУ турнира («идущий сейчас» обязан остаться в будущих). Поэтому всё, что приезжает при
    # подгрузке, кончилось раньше сегодня, — и если в тот же день начинался турнир, который ещё
    # идёт, новая строка по алфавиту садилась ПОД ним, в середину экрана, и всё ниже неё
    # прыгало на свою высоту (замечание заказчика 08.11.2026; замер: 93px вниз у каждой строки
    # под якорем). С окончанием в ключе короткий прошедший турнир встаёт выше длинного, и
    # подгруженное оказывается НАД видимой областью — там, где его и компенсирует прокрутка.
    events.sort(key=lambda e: (
        str(e.get("starts")), str(e.get("ends") or e.get("starts")), str(e.get("title")),
    ))
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
    # Макрорегионы не отдельный справочник: это множество значений, которые уже проставлены
    # городам. Заводить второй список значило бы держать два места, которые разойдутся.
    region_names = {c["region"] for c in cities}
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

        kind = event.get("type", DEFAULT_TYPE)
        if kind not in TYPES:
            error(f"{where}: type «{kind}» — ожидается одно из {sorted(TYPES)}")
            kind = DEFAULT_TYPE
        if event.get("type") == DEFAULT_TYPE:
            # Не придирка к стилю: умолчание, записанное явно, назавтра разойдётся с умолчанием
            # в коде, и файл начнёт утверждать то, чего не имел в виду.
            warn(f"{where}: type: {DEFAULT_TYPE} — это умолчание, строка лишняя")

        online = event.get("online")
        if online is not None and not isinstance(online, bool):
            error(f"{where}: online = «{online}» — ожидается true или false")
            online = bool(online)
        if online and kind not in TYPES_ONLINE:
            warn(f"{where}: online у типа «{kind}» — так не бывает; данные оставлены как есть")

        try:
            starts = _as_date(event.get("starts"), where, "starts")
            ends = _as_date(event.get("ends", event.get("starts")), where, "ends")
            if ends < starts:
                error(f"{where}: ends раньше starts")
            if not where.startswith(f"data/events/{starts.year}/"):
                error(f"{where}: файл должен лежать в data/events/{starts.year}/ — по году начала")
            by_day.setdefault(starts.isoformat(), []).append(event)
        except DataError as parse_error:
            error(str(parse_error))
            continue

        city = event.get("city")
        if city and str(city).lower() not in city_names:
            error(f"{where}: города «{city}» нет в data/cities.yaml — добавьте его туда или "
                  f"перенесите в поле place")
        if city and event.get("place"):
            # Правило place_for выше: при известном городе адреса в данных нет вовсе.
            error(f"{where}: при заполненном city поле place не нужно — календарь показывает "
                  f"только город (сейчас place: «{event['place']}»)")
        if not city and not event.get("place") and not online:
            # Предупреждение, а не ошибка: так приезжают старые турниры, у которых источник не
            # дал города. Выдумывать место нельзя, прятать турнир — тоже.
            warn(f"{where}: нет ни city, ни place — источник не дал места")

        region = event.get("region")
        if region is not None and region not in region_names:
            error(f"{where}: region «{region}» — ожидается один из {sorted(region_names)}")
        if region and city:
            # Регион выводится из города справочником. Второй источник того же значения
            # разойдётся с первым на первой же правке — ровно тот дефект, из-за которого в
            # портале дисциплины турнира берутся из номинаций, а не отдельным списком.
            error(f"{where}: при заполненном city поле region не нужно — регион берётся из "
                  f"справочника городов")
        if online and (city or event.get("place") or region):
            error(f"{where}: online: true и место одновременно — онлайн-событие не в городе")
        if not city and not online and event.get("place") and not region:
            # Не ошибка: так лежат события, приехавшие до того, как перенос научился забирать
            # макрорегион. Но молчать нельзя — без региона событие выпадает из фильтра по
            # регионам для всех, кто его хоть раз тронул.
            warn(f"{where}: место без region — событие не пройдёт фильтр по региону")

        # Со-организаторы: турнир часто делают два клуба вместе, и второй обязан быть назван —
        # иначе его работу припишут первому. Главный остаётся в organizer: он отвечает за турнир
        # и по нему же идёт поиск в списке.
        co = event.get("co_organizers")
        if co is not None:
            if not isinstance(co, list) or not all(isinstance(name, str) for name in co):
                error(f"{where}: co_organizers — список названий")
            else:
                names = [name.strip() for name in co]
                if not all(names):
                    error(f"{where}: в co_organizers пустое название")
                main = str(event.get("organizer") or "").strip().lower()
                lowered = [name.lower() for name in names]
                if main and main in lowered:
                    error(f"{where}: организатор «{event['organizer']}» повторён в co_organizers")
                if len(set(lowered)) != len(lowered):
                    error(f"{where}: в co_organizers повторяется одно и то же название")
                if not main and names:
                    error(f"{where}: есть co_organizers, но не указан главный organizer")

        hemagon = event.get("hemagon_url")
        if hemagon is not None and "hemagon." not in str(hemagon):
            error(f"{where}: hemagon_url = «{hemagon}» — это не ссылка на хемагон")
        # Обратное правило (calendar_data.links_for): карточка хемагона в поле анонса
        # подписывается на сайте «Анонсом у организатора», хотя это не он. Раскладывают ссылки
        # импорты, а держит правило эта проверка — иначе оно вернётся первым же новым источником.
        announce = event.get("url")
        if announce is not None and "hemagon." in str(announce):
            error(f"{where}: url = «{announce}» — это карточка хемагона, её поле hemagon_url")

        source = event.get("source", "manual")
        if source not in SOURCES:
            error(f"{where}: source «{source}» — ожидается одно из {sorted(SOURCES)}")
        key = event.get("source_key")
        if key:
            pair = (source, str(key))
            if pair in seen_source_keys:
                error(f"{where}: такой же source_key уже у {seen_source_keys[pair]}")
            seen_source_keys[pair] = where

        nominations = event.get("nominations") or []
        declared = event.get("weapons")
        if declared is not None:
            if not isinstance(declared, list) or not all(isinstance(code, str) for code in declared):
                error(f"{where}: weapons — список кодов оружия")
                declared = []
            else:
                for code in declared:
                    if code not in weapon_codes:
                        error(f"{where}: оружия «{code}» нет в data/weapons.yaml")
                if len(set(declared)) != len(declared):
                    error(f"{where}: в weapons повторяется один и тот же код")
            if kind == DEFAULT_TYPE:
                # Дисциплины турнира несут его номинации — так и в портале
                # (EventsService.ResolveWeaponIds), и по той же причине: иначе появится второй
                # источник правды, и первый же турнир, где список разойдётся с номинациями,
                # покажет в фильтре не то, что в карточке.
                error(f"{where}: weapons у турнира не бывает — оружие турнира задают номинации")
        if nominations and kind not in TYPES_WITH_NOMINATIONS:
            error(f"{where}: номинации у типа «{kind}» — это зачёты, их там не бывает; "
                  f"дисциплины пишутся в weapons")
        if nominations and kind != DEFAULT_TYPE and not declared:
            # Форма ошибки Fencing Fest 2026: турнир внутри заявлен, а программа — нет, и фест
            # выглядит мероприятием по одному клинку.
            warn(f"{where}: у типа «{kind}» есть номинации, но пустой weapons — заявлен турнир "
                 f"внутри, а программа мероприятия нет")

        for index, nomination in enumerate(nominations, 1):
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
            low, high = nomination.get("min_age"), nomination.get("max_age")
            # Номинация без min_age считается взрослой, 18+ (так в портале: поле обязательное,
            # значение по умолчанию 18). Поэтому один только max_age задаёт пустой диапазон
            # 18…max и прячет номинацию от всех: детскому зачёту нижнюю границу надо назвать.
            if low is None and high is not None:
                error(f"{at}: max_age без min_age. Номинация без min_age — взрослая (18+), "
                      f"и с max_age = {high} в неё не попадает никто; укажите нижнюю границу")
            if isinstance(low, int) and isinstance(high, int) and high < low:
                error(f"{at}: max_age {high} меньше min_age {low}")

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
