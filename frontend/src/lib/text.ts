/** Мелкая текстовая работа над данными календаря: место и оружие одной строкой. */

const normalize = (value: string) => value.toLowerCase().replace(/ё/g, 'е');

/**
 * Место одной строкой. Город и адрес в источниках сплошь и рядом дублируют друг друга
 * («Калуга» + «Калуга», «Краснодар» + «г. Краснодар ул. Красная 43/1»), и склейка через запятую
 * давала «Калуга, Калуга». Если адрес уже содержит город — показываем адрес: он подробнее.
 */
export function formatPlace(city: string | null | undefined, locationManual: string | null | undefined): string {
  const left = (city ?? '').trim();
  const right = (locationManual ?? '').trim();
  if (!left) return right;
  if (!right) return left;
  if (normalize(right).includes(normalize(left))) return right;
  return `${left}, ${right}`;
}

type NominationLike = { weapon: string; weaponCode: string | null };

/**
 * Оружие турнира для строки списка. Распознанное оружие (у номинации есть код) вытесняет
 * нераспознанный текст: источники пишут в поле оружия что угодно — «longsword - women»,
 * «advanced», «mixed», — и вперемешку с нормальными названиями это выглядит как мусор. Если
 * распознанного нет вовсе, показываем текст как есть: потерять номинацию хуже, чем показать
 * сырую строку.
 */
export function weaponSummary(nominations: readonly NominationLike[]): string[] {
  const known = [...new Set(nominations.filter((n) => n.weaponCode).map((n) => n.weapon))];
  if (known.length > 0) return known;
  return [...new Set(nominations.map((n) => n.weapon).filter((w) => w && w.trim().length > 0))];
}
