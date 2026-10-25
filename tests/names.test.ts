import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkNick, checkText } from '../shared/names.ts';

const bad = (s: string) => assert.equal(checkNick(s).ok, false, `должен быть отклонён: ${s}`);
const good = (s: string) => assert.equal(checkNick(s).ok, true, `должен проходить: ${s}`);

test('plain obscene and abusive words are refused', () => {
  for (const s of ['сука', 'Сука', 'ХУЙ', 'пиздец', 'ебать', 'fuck', 'Shit', 'bitch', 'мудак', 'пидор', 'Hitler', 'дебил']) bad(s);
});
test('separators, stretched letters, Latin look-alikes and digits do not help', () => {
  for (const s of ['с у к а', 's.u.k.a', 'S U K A', 'с_у_к_а', 'сууука', 'cyka', 'cука', 'су4ка', 'xyй', 'хуууй', 'х у й', 'п1зда', 'blyat', 'бляяядь', 'f u c k', 'f.u.c.k', 'sh1t', 'b1tch', 'bлядь', 'бл*дь'.replace('*', 'я')]) bad(s);
});
test('short words are refused only as whole words', () => {
  bad('член'); bad('ass'); bad('Dick'); bad('sex');
  for (const s of ['Хлеб', 'Класс', 'Дикий', 'Passion', 'Скиталец', 'Лебедь', 'Мандарин', 'Классик', 'Assassin']) good(s);
});
test('ordinary nicks pass', () => {
  for (const s of ['Игрок', 'Титан_77', 'Damian', 'Громила', 'Sky-Stone', 'Облачко', 'Ян', 'Тёма', 'Рубен', 'Pro100', 'Мудрый']) good(s);
});
test('length, characters and links are checked', () => {
  assert.equal(checkNick('Я').ok, false); assert.equal(checkNick(' ').ok, false);
  assert.equal(checkNick('Ты😀').ok, false); assert.equal(checkNick('Ωmega').ok, false);
  assert.equal(checkNick('site.ru').ok, false); assert.equal(checkNick('t.me/x').ok, false);
});
test('room names use the same bad-word check', () => {
  assert.equal(checkText('Дуэль на облаках').ok, true);
  assert.equal(checkText('Сервер для пидоров').ok, false);
  assert.equal(checkText('заходи на www.spam.ru').ok, false);
});
