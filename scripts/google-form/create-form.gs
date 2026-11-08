/**
 * Создаёт форму заявки на турнир и обе таблицы к ней. Запускается в вашем гугл-аккаунте:
 * script.google.com → новый проект → вставить этот файл → запустить `setup`.
 *
 * Запускать можно сколько угодно раз. Первый прогон создаёт форму и таблицы, следующие —
 * догоняют уже созданную форму до списка вопросов ниже: вопросы меняются по ходу работы, а
 * пересоздавать форму нельзя — её адрес уже стоит на сайте.
 *
 * Почему таблиц две, а не одна. Импорту календаря нужна таблица, читаемая без входа в
 * аккаунт, — значит, открытая по ссылке кому угодно. Контакт заявителя в такой таблице стал бы
 * публичным, а это чужие персональные данные. Поэтому:
 *
 *   • «Календарь HEMA — заявки (ответы)» — приватная, туда форма пишет ВСЁ, включая контакт и
 *     заметку модератору. Её видите только вы.
 *   • «Календарь HEMA — заявки (для импорта)» — открыта по ссылке на чтение, в неё триггер
 *     копирует только то, что и так станет публичным.
 *
 * Названия вопросов — контракт с импортом (scripts/import_spreadsheet.py читает колонки по
 * именам). Переименуете в редакторе формы — заявки перестанут доезжать молча.
 */

/**
 * Номинации спрашиваются блоками полей, а не одной строкой: оружие выбирается из справочника
 * календаря, пол и возраст приезжают полями, а не догадками из текста.
 *
 * Повторяющихся групп полей («добавить ещё») в Google-формах не существует, поэтому каждая
 * номинация живёт на СВОЕЙ странице, а в конце страницы стоит вопрос «добавить номинацию N?»:
 * «нет» перескакивает в конец формы, «да» открывает следующую страницу.
 *
 * Одна номинация на страницу — решение заказчика 07.11.2026 вместо прежней разбивки 3 + 3 + 4.
 * Прежняя была дешевле по нажатиям (при медиане 5 номинаций — два перехода вместо пяти), но
 * требовала от заявителя понимать, что лишние блоки на странице надо оставить пустыми, и он
 * видел их все сразу. Теперь страниц ровно столько, сколько у него номинаций, а «лишние
 * оставьте пустыми» из подсказки исчезло вовсе.
 *
 * Десять блоков покрывают 95% турниров; у двух турниров в данных их 21 и 23 — на такой хвост
 * в конце формы есть поле «остальные номинации строкой».
 */
const NOMINATION_BLOCKS = 10;

/**
 * Виды оружия — ровно справочник календаря (data/weapons.yaml), порядком по частоте, а не по
 * алфавиту: длинный меч и сабля стоят в каждом втором турнире, спортивные — в единицах.
 * Справочник пополнился — запустите `setup` ещё раз, список в форме обновится.
 */
const WEAPONS = [
  'Длинный меч', 'Сабля', 'Рапира', 'Меч и баклер', 'Мессер', 'Дюссак', 'Кинжал', 'Копьё',
  'Монтанте', 'Сайдсворд', 'Спортивная рапира', 'Спортивная сабля', 'Спортивная шпага',
];

const GENDER_CHOICES = ['любая', 'мужская', 'женская'];
const FEATURE_CHOICES = ['командная', 'для новичков'];

const BRANCH_CHOICES = ['Да, добавить', 'Нет, это всё'];

/**
 * Название поля блока — «Номинация 6: Возраст до», а не «Возраст до 6». Номинация в каждом
 * названии не болтовня: это же название становится колонкой приватной таблицы ответов и
 * подписью в письме о заявке, где заголовка страницы рядом уже нет и «Возраст до 6» читается
 * загадкой. Оно же служит ключом ответа — поэтому имя собирается здесь, в одном месте, и
 * триггер берёт его отсюда же (nominationsFromBlocks_).
 */
function blockField_(block, field) {
  return 'Номинация ' + block + ': ' + field;
}

/**
 * Вопрос в конце страницы. Номер следующей номинации в названии — не украшение: названия
 * вопросов служат ключами ответов, и девять одинаковых «есть ещё номинации?» склеились бы в
 * один ключ. Заявителю он тоже полезен — говорит, что именно откроет «да».
 */
function branchTitle_(next) {
  return 'Добавить номинацию ' + next + '?';
}

/** Последняя страница: сюда уводит «нет, это всё», и её видит каждый заявитель. */
const FINAL_PAGE = 'Напоследок';

/** Колонка, в которую триггер складывает заполненные блоки. Её читает импорт календаря. */
const NOMINATIONS_COLUMN = 'Номинации (конструктор)';

/** Типы, у которых есть ответ: только они могут стать колонкой таблицы. */
const ANSWERABLE = ['text', 'paragraph', 'date', 'list', 'radio', 'checkbox'];

/**
 * Все элементы формы по порядку. Собираются кодом, потому что блоков номинаций десять и писать
 * их руками — пятьдесят почти одинаковых вопросов.
 *
 * Поля записи: `title` — он же ключ ответа; `column` — имя колонки, если оно отличается от
 * названия вопроса; `private` — в публичную таблицу не копируется; `collapsed` — своей колонки
 * нет (блоки номинаций складываются в одну).
 */
function items_() {
  const items = [
    {
      title: 'Название', type: 'text', required: true,
      help: 'Как турнир называется для участников.',
    },
    {title: 'Дата начала', type: 'date', required: true},
    {title: 'Дата завершения', type: 'date', help: 'Только если турнир идёт больше одного дня.'},
    {
      title: 'Город', type: 'text',
      help: 'Один город, как он называется обычно: Казань, Санкт-Петербург.',
    },
    {
      title: 'Адрес', type: 'text',
      help: 'Площадка и адрес, если они уже известны. В календаре не показывается — там только '
        + 'город; адрес нужен редактору, чтобы не перепутать турниры одного дня.',
    },
    {
      title: 'Организатор', type: 'text',
      help: 'Клуб или человек, которого указывать в календаре. Главный — один.',
    },
    {
      title: 'Со-организаторы', type: 'text',
      help: 'Если турнир делают вместе несколько клубов — перечислите остальных через запятую. '
        + 'Календарь покажет их рядом с главным.',
    },
    {
      // Обязательной НЕ делаем — решение заказчика 07.11.2026. Соблазн есть: турнир без ссылки
      // читателю почти ничего не даёт. Но анонса на момент заявки может ещё не быть, и отсечь
      // такую заявку дороже, чем принять её и дождаться ссылки.
      title: 'Ссылка на анонс', type: 'text',
      help: 'Пост в соцсетях, сайт турнира или страница регистрации — то, где вы рассказываете '
        + 'про турнир. В календаре это ссылка «Анонс у организатора».',
    },
    {
      title: 'Ссылка на хемагон', type: 'text',
      help: 'Карточка турнира на hemagon.com, если вы её уже завели: там сетка, номинации и '
        + 'участники. Это отдельная от анонса ссылка — в календаре она так и подписана, «Турнир '
        + 'на Хемагоне». Нет карточки — оставьте пустым.',
    },
  ];

  // Заголовка-секции «Номинация N» внутри страницы больше нет: им стало НАЗВАНИЕ страницы,
  // и второй такой же заголовок был бы повтором на том же экране.
  for (let block = 1; block <= NOMINATION_BLOCKS; block++) {
    items.push({
      type: 'page', title: 'Номинация ' + block,
      help: block === 1
        ? 'Номинация — это оружие и то, кто в ней выступает: пол и возраст. Каждая номинация '
          + 'на своей странице, в конце страницы спросим, нужна ли следующая. Возраст «18+» — '
          + 'это «от 18», поле «до» при этом пустое. Номинаций у турнира пока нет вовсе — '
          + 'оставьте поля пустыми и ответьте «Нет, это всё»: вопрос в конце обязательный.'
        : null,
    });
    items.push({
      type: 'list', title: blockField_(block, 'Оружие'), choices: WEAPONS, collapsed: true,
      help: block === 1
        ? 'Нет нужного вида? В конце формы есть поле, где номинацию можно описать словами.'
        : null,
    });
    items.push({
      type: 'radio', title: blockField_(block, 'Пол'), choices: GENDER_CHOICES, collapsed: true,
      help: block === 1 ? 'Не выбрали — значит, номинация общая.' : null,
    });
    items.push({type: 'text', title: blockField_(block, 'Возраст от'), collapsed: true});
    items.push({
      type: 'text', title: blockField_(block, 'Возраст до'), collapsed: true,
      help: block === 1
        ? 'Пусто — значит, сверху не ограничено. Заполняйте только вместе с «от»: '
          + 'без нижней границы календарь не сможет отобрать номинацию по возрасту.'
        : null,
    });
    items.push({
      type: 'checkbox', title: blockField_(block, 'Особенности'), choices: FEATURE_CHOICES,
      collapsed: true,
    });
    if (block < NOMINATION_BLOCKS) {
      items.push({
        type: 'radio', title: branchTitle_(block + 1), choices: BRANCH_CHOICES, required: true,
        branch: true, collapsed: true,
      });
    }
  }

  items.push({type: 'page', title: FINAL_PAGE});
  items.push({
    // Поле живёт на ПОСЛЕДНЕЙ странице, а не рядом с блоками: «нет, это всё» перескакивает
    // через страницы номинаций, и на них его увидели бы не все. Здесь его видит каждый.
    title: 'Остальные номинации строкой', type: 'paragraph', column: 'Номинации',
    help: 'Сюда — то, что не влезло в блоки: вид оружия, которого нет в списке, или номинации '
      + 'сверх десяти. Пишите через запятую, возраст — со словом «лет» или плюсом: «катана '
      + '12-14 лет, сабля 18+».',
  });
  items.push({
    title: 'Ваш контакт', type: 'text', required: true, private: true,
    help: 'Телеграм или почта — для модератора. В календарь не попадёт.',
  });
  items.push({
    title: 'Что сказать модератору', type: 'paragraph', private: true, help: 'Необязательно.',
  });

  return items;
}

const ITEMS = items_();

/**
 * Колонки таблицы для импорта. Список явный, а не собранный из ITEMS: это контракт с
 * `scripts/import_spreadsheet.py`, и видеть его одним куском важнее, чем не повторяться.
 * Проверку «всё ли публичное попало в колонки» делает `checkColumns_` при каждом запуске.
 */
const PUBLIC_COLUMNS = [
  'Название',
  'Дата начала',
  'Дата завершения',
  'Город',
  'Адрес',
  'Организатор',
  'Со-организаторы',
  'Ссылка на анонс',
  'Ссылка на хемагон',
  NOMINATIONS_COLUMN,
  'Номинации',
];

/**
 * Переименованные колонки: старое имя → новое. Нужно для таблицы, созданной прежней версией
 * скрипта: шапку с заявками переписывать нельзя, а ответ в неё положить надо.
 */
const RENAMED = {'Ссылка': 'Ссылка на анонс'};

/** Запустите эту функцию. Повторный запуск ничего не портит: он находит уже созданное. */
function setup() {
  checkColumns_();
  const form = createForm_();
  const responses = linkResponseSheet_(form);
  const publicSheet = createPublicSheet_();
  installTrigger_(form, publicSheet);

  const gid = publicSheet.getSheets()[0].getSheetId();
  Logger.log('ГОТОВО. Ниже — то, что нужно календарю.');
  Logger.log('SUBMIT_FORM_URL = ' + form.getPublishedUrl());
  Logger.log('FORM_SHEET_ID   = ' + publicSheet.getId());
  Logger.log('FORM_SHEET_GID  = ' + gid);
  Logger.log('Приватные ответы с контактами: ' + responses.getUrl());
  Logger.log('Редактировать форму: ' + form.getEditUrl());
}

/** Публичный вопрос без колонки — молча потерянный ответ. Лучше сказать об этом сразу. */
function checkColumns_() {
  const missing = ITEMS
    .filter((q) => !q.private && !q.collapsed && ANSWERABLE.indexOf(q.type) !== -1)
    .map((q) => q.column || q.title)
    .filter((column) => PUBLIC_COLUMNS.indexOf(column) === -1);
  if (missing.length) {
    Logger.log('ВНИМАНИЕ: эти ответы никуда не попадут — нет колонки: ' + missing.join(', '));
  }
}

/**
 * Файл с таким именем на диске. Лежащие в КОРЗИНЕ пропускаются: иначе выброшенная форма
 * находится по имени как ни в чём не бывало, и «удалить и собрать заново» не работает.
 */
function findFile_(title) {
  const found = DriveApp.getFilesByName(title);
  while (found.hasNext()) {
    const file = found.next();
    if (!file.isTrashed()) return file;
  }
  return null;
}

function createForm_() {
  const title = 'Календарь HEMA — заявка на турнир';
  const existing = findFile_(title);
  let form;
  if (existing) {
    form = FormApp.openById(existing.getId());
    Logger.log('Форма уже есть, беру её.');
  } else {
    form = FormApp.create(title);
    form.setDescription(
      'Турнир попадёт в календарь hema.ru после проверки человеком. Оставьте контакт — без него '
      + 'уточнить детали будет негде. Контакт виден только модератору и в календарь не попадает.');
    form.setCollectEmail(false);
    form.setConfirmationMessage(
      'Заявка отправлена. Турнир появится в календаре после проверки — обычно в течение суток.');
    Logger.log('Форма создана.');
  }

  syncItems_(form);
  wireBranches_(form);
  return form;
}

/**
 * Догоняет форму до списка ITEMS: чего нет — добавляет, у списков выбора обновляет варианты.
 *
 * Формулировки уже существующих вопросов НЕ переносятся: подсказку вы могли поправить сами, и
 * затирать вашу правку скрипт не вправе. Меняется только состав вопросов и варианты выбора —
 * последние приходят из справочника календаря, а не из редактора формы.
 */
function syncItems_(form) {
  const byKey = {};
  form.getItems().forEach((item) => {
    byKey[itemKey_(item.getTitle(), itemKind_(item))] = item;
  });

  ITEMS.forEach((question, index) => {
    const found = byKey[itemKey_(question.title, question.type || 'text')];
    if (found) {
      if (question.choices && !question.branch) syncChoices_(found, question);
      return;
    }

    const item = addItem_(form, question);
    item.setTitle(question.title);
    if (question.help) item.setHelpText(question.help);
    if (question.required && item.setRequired) item.setRequired(true);
    if (question.choices && !question.branch) item.setChoiceValues(question.choices);

    // Новый элемент Google кладёт в конец формы — переносим его к своим, сразу за предыдущим
    // по списку. Вопросы, добавленные вами руками, остаются на месте.
    const before = index > 0 ? ITEMS[index - 1] : null;
    const previous = before ? byKey[itemKey_(before.title, before.type || 'text')] : null;
    const target = previous ? previous.getIndex() + 1 : 0;
    if (item.getIndex() !== target) form.moveItem(item.getIndex(), target);

    byKey[itemKey_(question.title, question.type || 'text')] = item;
    Logger.log('Добавлено: «' + question.title + '».');
  });

  reportStrangers_(form);
}

/**
 * Ключ, по которому вопрос считается «уже есть». Названия мало: в форме, собранной прежней
 * версией скрипта, вопрос «Номинации» назывался так же, как теперь называется РАЗРЫВ СТРАНИЦЫ
 * перед блоками, — и страница не создавалась, потому что скрипт считал её существующей. Так
 * форма и собралась 07.11.2026: все десять блоков на одной странице, переходы не работают.
 */
function itemKey_(title, kind) {
  return kind + ' | ' + title;
}

/** Тип элемента формы — теми же словами, что и в ITEMS. */
function itemKind_(item) {
  switch (item.getType()) {
    case FormApp.ItemType.DATE: return 'date';
    case FormApp.ItemType.PARAGRAPH_TEXT: return 'paragraph';
    case FormApp.ItemType.LIST: return 'list';
    case FormApp.ItemType.MULTIPLE_CHOICE: return 'radio';
    case FormApp.ItemType.CHECKBOX: return 'checkbox';
    case FormApp.ItemType.PAGE_BREAK: return 'page';
    case FormApp.ItemType.SECTION_HEADER: return 'header';
    default: return 'text';
  }
}

/**
 * Что в форме есть, а в списке вопросов — нет. Сам не удаляю: это может быть ваш вопрос. Но и
 * молчать нельзя — остаток прежней версии заявитель видит наравне с нужными вопросами.
 */
function reportStrangers_(form) {
  const mine = {};
  ITEMS.forEach((question) => {
    mine[itemKey_(question.title, question.type || 'text')] = true;
  });
  const strangers = form.getItems()
    .filter((item) => !mine[itemKey_(item.getTitle(), itemKind_(item))])
    .map((item) => '«' + item.getTitle() + '»');
  if (strangers.length) {
    Logger.log('В форме есть вопросы не из списка — возможно, остались от прежней версии: '
      + strangers.join(', ') + '. Лишние удалите в редакторе формы, скрипт их не трогает.');
  }
}

function addItem_(form, question) {
  switch (question.type) {
    case 'date': return form.addDateItem();
    case 'paragraph': return form.addParagraphTextItem();
    case 'list': return form.addListItem();
    case 'radio': return form.addMultipleChoiceItem();
    case 'checkbox': return form.addCheckboxItem();
    case 'page': return form.addPageBreakItem();
    case 'header': return form.addSectionHeaderItem();
    default: return form.addTextItem();
  }
}

/** Варианты выбора — из справочника: добавился вид оружия, и он появляется во всех блоках. */
function syncChoices_(item, question) {
  const typed = question.type === 'list' ? item.asListItem()
    : question.type === 'checkbox' ? item.asCheckboxItem()
      : item.asMultipleChoiceItem();
  const current = typed.getChoices().map((choice) => choice.getValue());
  if (current.join('|') === question.choices.join('|')) return;
  typed.setChoiceValues(question.choices);
  Logger.log('Обновлены варианты в «' + question.title + '».');
}

/**
 * Развилки «есть ещё номинации?»: «да» — просто дальше, «нет» — прыжок на последнюю страницу.
 * Навигация переставляется на каждом запуске: она привязана к элементу страницы, а не к тексту,
 * и после любой правки состава должна снова показывать на «Напоследок».
 */
function wireBranches_(form) {
  const items = form.getItems();
  const finalPage = items.filter((item) => item.getType() === FormApp.ItemType.PAGE_BREAK
    && item.getTitle() === FINAL_PAGE)[0];
  if (!finalPage) {
    Logger.log('ВНИМАНИЕ: страницы «' + FINAL_PAGE + '» нет — развилки не настроены.');
    return;
  }
  const page = finalPage.asPageBreakItem();

  ITEMS.filter((question) => question.branch).forEach((question) => {
    const found = items.filter((item) => item.getTitle() === question.title
      && item.getType() === FormApp.ItemType.MULTIPLE_CHOICE)[0];
    if (!found) return;
    const choice = found.asMultipleChoiceItem();
    choice.setChoices([
      choice.createChoice(question.choices[0], FormApp.PageNavigationType.CONTINUE),
      choice.createChoice(question.choices[1], page),
    ]);
  });
}

function linkResponseSheet_(form) {
  // У формы без таблицы ответов getDestinationId() не возвращает пустоту — он БРОСАЕТ
  // исключение «у этой формы нет адреса для отправки ответов». Поэтому «таблица уже
  // привязана?» проверяется через try, а не условием: на первом же запуске setup падал тут.
  let existingId = null;
  try {
    existingId = form.getDestinationId();
  } catch (noDestinationYet) {
    existingId = null;
  }
  if (existingId) return SpreadsheetApp.openById(existingId);

  const sheet = SpreadsheetApp.create('Календарь HEMA — заявки (ответы)');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());
  Logger.log('Приватная таблица ответов создана.');
  return sheet;
}

function createPublicSheet_() {
  const title = 'Календарь HEMA — заявки (для импорта)';
  const existing = findFile_(title);
  const sheet = existing
    ? SpreadsheetApp.openById(existing.getId())
    : SpreadsheetApp.create(title);

  const page = sheet.getSheets()[0];
  if (page.getLastRow() === 0) {
    page.appendRow(PUBLIC_COLUMNS);
    page.setFrozenRows(1);
    // Даты — ТЕКСТОМ, а не датами таблицы: иначе выгрузка в CSV пишет их в формате локали
    // документа, и «7 ноября» из англоязычной таблицы приедет в импорт как 11 июля.
    page.getRange('B:C').setNumberFormat('@');
  } else if (readHeader_(page).join('|') !== PUBLIC_COLUMNS.join('|')) {
    // Шапка разошлась со списком колонок — обычно после того, как в форме появился новый
    // вопрос. Пустую таблицу переписываем; над собранными заявками — нет: колонки сдвинутся, и
    // прежние ответы окажутся подписаны чужими именами. Триггер в этом случае кладёт строку по
    // ТОЙ шапке, что есть (см. onFormSubmit), так что заявки не теряются — просто новое поле в
    // импорт не поедет, пока вы не допишете колонку.
    if (page.getLastRow() === 1) {
      page.getRange(1, 1, 1, PUBLIC_COLUMNS.length).setValues([PUBLIC_COLUMNS]);
      Logger.log('Шапка публичной таблицы обновлена: ' + PUBLIC_COLUMNS.join(', '));
    } else {
      Logger.log('ВНИМАНИЕ: шапка публичной таблицы отличается от нужной, а в таблице уже '
        + (page.getLastRow() - 1) + ' заявок — сам не меняю. Допишите недостающие колонки '
        + 'справа, имена должны быть такими: ' + PUBLIC_COLUMNS.join(', '));
    }
  }

  // Открыта по ссылке на ЧТЕНИЕ: импорт календаря ходит сюда без входа в аккаунт. Контактов
  // здесь нет — ради этого таблицы и две.
  DriveApp.getFileById(sheet.getId())
    .setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  Logger.log('Публичная таблица готова и открыта по ссылке.');
  return sheet;
}

/** Шапка публичной таблицы, как она есть сейчас: по ней раскладываются ответы. */
function readHeader_(page) {
  const width = page.getLastColumn();
  if (!width) return [];
  return page.getRange(1, 1, 1, width).getValues()[0]
    .map((cell) => String(cell).trim())
    .filter((name) => name !== '');
}

function installTrigger_(form, publicSheet) {
  PropertiesService.getScriptProperties().setProperty('PUBLIC_SHEET_ID', publicSheet.getId());
  // Триггер опознаётся по ФОРМЕ, к которой привязан, а не по имени функции. Иначе так: прежнюю
  // форму выбросили, setup собрал новую — а триггер остался висеть на выброшенной. «Уже стоит»
  // было бы правдой, и заявки с новой формы молча не доезжали бы до таблицы.
  let mine = false;
  ScriptApp.getProjectTriggers().forEach((trigger) => {
    if (trigger.getHandlerFunction() !== 'onFormSubmit') return;
    if (trigger.getTriggerSourceId() === form.getId()) {
      mine = true;
      return;
    }
    ScriptApp.deleteTrigger(trigger);
    Logger.log('Удалён триггер от прежней формы.');
  });
  if (mine) {
    Logger.log('Триггер уже стоит.');
    return;
  }
  ScriptApp.newTrigger('onFormSubmit').forForm(form).onFormSubmit().create();
  Logger.log('Триггер установлен.');
}

/**
 * На каждую заявку: переносим в публичную таблицу только те поля, которые и так станут
 * публичными. Контакт и заметка остаются в приватных ответах.
 */
function onFormSubmit(event) {
  const id = PropertiesService.getScriptProperties().getProperty('PUBLIC_SHEET_ID');
  if (!id) return;
  const page = SpreadsheetApp.openById(id).getSheets()[0];

  const answers = {};
  event.response.getItemResponses().forEach((item) => {
    answers[item.getItem().getTitle()] = item.getResponse();
  });

  // Колонки берём из САМОЙ таблицы, а не из PUBLIC_COLUMNS: если таблица осталась от прежней
  // версии скрипта, строка всё равно встанет в свои колонки, а не поедет по чужим.
  const header = readHeader_(page);
  const columns = header.length ? header : PUBLIC_COLUMNS;

  const sources = {};
  ITEMS.forEach((question) => {
    if (!question.private && !question.collapsed) {
      sources[question.column || question.title] = question.title;
    }
  });

  page.appendRow(columns.map((column) => {
    if (column === NOMINATIONS_COLUMN) return nominationsFromBlocks_(answers);
    const title = sources[column];
    if (!title) return '';  // чужая колонка — не наше дело, оставляем пустой
    const value = answers[title];
    if (value !== undefined && value !== '') return cell_(value);
    // Колонка под прежним именем: ответ лежит под новым (см. RENAMED).
    const renamed = RENAMED[column];
    return renamed && answers[renamed] !== undefined ? cell_(answers[renamed]) : '';
  }));
}

/** Ответ-галочки приезжает списком — в клетку таблицы он должен попасть строкой. */
function cell_(value) {
  return Array.isArray(value) ? value.join(', ') : value;
}

/**
 * Заполненные блоки — в одну клетку, строка на номинацию, поля через «;» в твёрдом порядке:
 * оружие; пол; возраст от; возраст до; особенности.
 *
 * Почему не по колонке на поле: блоков десять, полей в блоке пять — пятьдесят колонок, в
 * которых редактору не разобраться. А импорт читает этот формат без догадок: он наш с обеих
 * сторон (scripts/import_spreadsheet.py, nominations_from_blocks).
 */
function nominationsFromBlocks_(answers) {
  const lines = [];
  for (let i = 1; i <= NOMINATION_BLOCKS; i++) {
    const weapon = String(answers[blockField_(i, 'Оружие')] || '').trim();
    if (!weapon) continue;  // пустой блок — не номинация
    lines.push([
      weapon,
      String(answers[blockField_(i, 'Пол')] || '').trim(),
      String(answers[blockField_(i, 'Возраст от')] || '').trim(),
      String(answers[blockField_(i, 'Возраст до')] || '').trim(),
      cell_(answers[blockField_(i, 'Особенности')] || ''),
    ].join('; '));
  }
  return lines.join('\n');
}
