import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatPlace, placeForDateColumn, shortPlace, weaponSummary } from './text.ts';

describe('formatPlace', () => {
  it('не повторяет город, который уже есть в адресе', () => {
    assert.equal(formatPlace('Калуга', 'Калуга'), 'Калуга');
    assert.equal(formatPlace('Краснодар', 'г. Краснодар ул. Красная 43/1'), 'г. Краснодар ул. Красная 43/1');
    assert.equal(formatPlace('Орёл', 'г. Орел, ул. Ленина 1'), 'г. Орел, ул. Ленина 1', 'ё и е — один город');
  });

  it('склеивает разное и переживает пустые', () => {
    assert.equal(formatPlace('Москва', 'Лужники'), 'Москва, Лужники');
    assert.equal(formatPlace('Москва', null), 'Москва');
    assert.equal(formatPlace(null, 'Тбилиси'), 'Тбилиси');
    assert.equal(formatPlace(null, null), '');
    assert.equal(formatPlace('  ', ' Казань '), 'Казань');
  });
});

describe('shortPlace', () => {
  it('на телефоне остаётся только короткий город', () => {
    assert.equal(shortPlace('СПб', 'Санкт-Петербург, Зал на Васильевском'), 'СПб');
    assert.equal(shortPlace('Крд', 'Краснодар'), 'Крд');
  });

  it('без короткой формы показываем то, что есть', () => {
    assert.equal(shortPlace(null, 'Алтайский край'), 'Алтайский край');
    assert.equal(shortPlace(undefined, 'Москва, Лужники'), 'Москва, Лужники');
    assert.equal(shortPlace('   ', 'Тбилиси'), 'Тбилиси', 'пробелы — не форма');
    assert.equal(shortPlace(null, ''), '');
  });
});

describe('placeForDateColumn', () => {
  it('короткое имя остаётся полным', () => {
    assert.equal(placeForDateColumn('Москва', 'Мск', 'Москва, Лужники'), 'Москва');
    assert.equal(placeForDateColumn('Краснодар', 'Крд', 'Краснодар'), 'Краснодар', 'девять букв — предел');
    assert.equal(placeForDateColumn('Омск', 'Омск', 'Омск'), 'Омск');
  });

  it('длинное имя уходит в короткую форму', () => {
    assert.equal(placeForDateColumn('Санкт-Петербург', 'СПб', 'Санкт-Петербург'), 'СПб');
    assert.equal(placeForDateColumn('Новосибирск', 'Нск', 'Новосибирск'), 'Нск', 'десять и больше — сокращаем');
    assert.equal(placeForDateColumn('Ростов-на-Дону', 'РнД', 'Ростов-на-Дону'), 'РнД');
  });

  it('без города показываем то, что есть', () => {
    assert.equal(placeForDateColumn(null, null, 'Алтайский край'), 'Алтайский край');
    assert.equal(placeForDateColumn('', '', 'Kazbekovsky District'), 'Kazbekovsky District');
  });
});

describe('weaponSummary', () => {
  const nom = (weapon: string, weaponCode: string | null = null) => ({ weapon, weaponCode });

  it('показывает распознанное оружие без повторов', () => {
    assert.deepEqual(
      weaponSummary([nom('Сабля', 'saber'), nom('Сабля', 'saber'), nom('Рапира', 'rapier')]),
      ['Сабля', 'Рапира'],
    );
  });

  it('сырой текст вытесняется распознанным оружием', () => {
    assert.deepEqual(
      weaponSummary([nom('Длинный меч', 'longsword'), nom('longsword - women'), nom('advanced')]),
      ['Длинный меч'],
    );
  });

  it('если распознать нечего — показываем текст, а не пустоту', () => {
    assert.deepEqual(weaponSummary([nom('katana'), nom('triathlon'), nom('katana')]), ['katana', 'triathlon']);
    assert.deepEqual(weaponSummary([]), []);
  });
});
