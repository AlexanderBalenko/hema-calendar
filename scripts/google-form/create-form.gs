/**
 * Создаёт форму заявки на турнир и обе таблицы к ней. Запускается ОДИН РАЗ в вашем
 * гугл-аккаунте: script.google.com → новый проект → вставить этот файл → запустить `setup`.
 *
 * Почему таблиц две, а не одна. Импорту календаря нужна таблица, читаемая без входа в
 * аккаунт, — значит, открытая по ссылке кому угодно. Контакт заявителя в такой таблице стал бы
 * публичным, а это чужие персональные данные. Поэтому:
 *
 *   • «Календарь HEMA — заявки (ответы)» — приватная, туда форма пишет ВСЁ, включая контакт и
 *     заметку модератору. Её видите только вы.
 *   • «Календарь HEMA — заявки (для импорта)» — открыта по ссылке на чтение, в неё триггер
 *     копирует только то, что и так станет публичным: название, даты, место, организатор,
 *     ссылка, номинации.
 *
 * Названия колонок второй таблицы совпадают с тем, что читает scripts/import_spreadsheet.py —
 * менять их нельзя, иначе импорт перестанет видеть заявки.
 */

/** Колонки таблицы для импорта. Порядок и написание — контракт с импортом календаря. */
const PUBLIC_COLUMNS = [
  'Название',
  'Дата начала',
  'Дата завершения',
  'Город',
  'Адрес',
  'Организатор',
  'Со-организаторы',
  'Ссылка',
  'Номинации',
];

/** Запустите эту функцию. Повторный запуск ничего не портит: он находит уже созданное. */
function setup() {
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

function createForm_() {
  const title = 'Календарь HEMA — заявка на турнир';
  const existing = DriveApp.getFilesByName(title);
  if (existing.hasNext()) {
    const form = FormApp.openById(existing.next().getId());
    Logger.log('Форма уже есть, беру её.');
    return form;
  }

  const form = FormApp.create(title);
  form.setDescription(
    'Турнир попадёт в календарь hema.ru после проверки человеком. Оставьте контакт — без него '
    + 'уточнить детали будет негде. Контакт виден только модератору и в календарь не попадает.');
  form.setCollectEmail(false);
  form.setConfirmationMessage(
    'Заявка отправлена. Турнир появится в календаре после проверки — обычно в течение суток.');

  form.addTextItem().setTitle('Название').setRequired(true)
    .setHelpText('Как турнир называется для участников.');

  form.addDateItem().setTitle('Дата начала').setRequired(true);
  form.addDateItem().setTitle('Дата завершения')
    .setHelpText('Только если турнир идёт больше одного дня.');

  form.addTextItem().setTitle('Город')
    .setHelpText('Один город, как он называется обычно: Казань, Санкт-Петербург.');
  form.addTextItem().setTitle('Адрес')
    .setHelpText('Площадка и адрес, если они уже известны. В календаре не показывается — там '
      + 'только город; адрес нужен редактору, чтобы не перепутать турниры одного дня.');

  form.addTextItem().setTitle('Организатор')
    .setHelpText('Клуб или человек, которого указывать в календаре. Главный — один.');
  form.addTextItem().setTitle('Со-организаторы')
    .setHelpText('Если турнир делают вместе несколько клубов — перечислите остальных через '
                 + 'запятую. Календарь покажет их рядом с главным.');
  form.addTextItem().setTitle('Ссылка')
    .setHelpText('Анонс, сообщество или страница регистрации.');

  form.addParagraphTextItem().setTitle('Номинации')
    .setHelpText('Перечислите через запятую: длинный меч, сабля женская, рапира командная, '
                 + 'меч и баклер для новичков. Календарь разберёт их сам.');

  form.addTextItem().setTitle('Ваш контакт').setRequired(true)
    .setHelpText('Телеграм или почта — для модератора. В календарь не попадёт.');
  form.addParagraphTextItem().setTitle('Что сказать модератору')
    .setHelpText('Необязательно.');

  Logger.log('Форма создана.');
  return form;
}

function linkResponseSheet_(form) {
  const existingId = form.getDestinationId();
  if (existingId) return SpreadsheetApp.openById(existingId);

  const sheet = SpreadsheetApp.create('Календарь HEMA — заявки (ответы)');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());
  Logger.log('Приватная таблица ответов создана.');
  return sheet;
}

function createPublicSheet_() {
  const title = 'Календарь HEMA — заявки (для импорта)';
  const existing = DriveApp.getFilesByName(title);
  const sheet = existing.hasNext()
    ? SpreadsheetApp.openById(existing.next().getId())
    : SpreadsheetApp.create(title);

  const page = sheet.getSheets()[0];
  if (page.getLastRow() === 0) {
    page.appendRow(PUBLIC_COLUMNS);
    page.setFrozenRows(1);
    // Даты — ТЕКСТОМ, а не датами таблицы: иначе выгрузка в CSV пишет их в формате локали
    // документа, и «7 ноября» из англоязычной таблицы приедет в импорт как 11 июля.
    page.getRange('B:C').setNumberFormat('@');
  }

  // Открыта по ссылке на ЧТЕНИЕ: импорт календаря ходит сюда без входа в аккаунт. Контактов
  // здесь нет — ради этого таблицы и две.
  DriveApp.getFileById(sheet.getId())
    .setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  Logger.log('Публичная таблица готова и открыта по ссылке.');
  return sheet;
}

function installTrigger_(form, publicSheet) {
  const already = ScriptApp.getProjectTriggers()
    .some((t) => t.getHandlerFunction() === 'onFormSubmit');
  if (already) {
    Logger.log('Триггер уже стоит.');
    return;
  }
  ScriptApp.newTrigger('onFormSubmit').forForm(form).onFormSubmit().create();
  PropertiesService.getScriptProperties().setProperty('PUBLIC_SHEET_ID', publicSheet.getId());
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

  page.appendRow(PUBLIC_COLUMNS.map((column) => answers[column] || ''));
}
