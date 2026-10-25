// Nick and room-name filter. Pure, no DOM: runs in the browser (instant error) and on the server (the real gate).
// Catches obscene/abusive/vulgar/hateful words, Latin look-alikes and digits for letters ("xyй", "су4а", "s.u.k.a"),
// separators between letters ("с у к а") and stretched letters ("сууука"). A few harmless words may be refused: that is the cheaper mistake.

export const NICK_MIN = 2;
export const NICK_MAX = 14;

const LAT2CYR: Record<string, string> = { a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у', k: 'к', h: 'н', b: 'в', m: 'м', t: 'т', u: 'у', i: 'и' };
const DIGIT_A: Record<string, string> = { '0': 'о', '3': 'е', '4': 'а', '6': 'б', '1': 'и', '@': 'а', '$': 'с' };
const DIGIT_B: Record<string, string> = { b: 'б', '0': 'о', '3': 'з', '4': 'ч', '6': 'б', '1': 'и', '@': 'а', '$': 'с' };
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };

const collapse = (s: string) => s.replace(/(.)\1+/g, '$1');
const foldCyr = (s: string) => collapse(s.replace(/ё/g, 'е').replace(/й/g, 'и').replace(/[ъь]/g, ''));
const base = (raw: string) => raw.normalize('NFKD').replace(/[̀-ͯ­​-‏⁠﻿]/g, '').toLowerCase();
const cyrOf = (raw: string, dig: Record<string, string>) => foldCyr(Array.from(base(raw), ch => dig[ch] ?? LAT2CYR[ch] ?? ch).join('').replace(/[^а-яё]/g, ''));
const latOf = (raw: string) => collapse(Array.from(base(raw), ch => LEET[ch] ?? ch).join('').replace(/[^a-z]/g, ''));

// Russian stems (substring of the letters-only string) — written as they are said; folded on load.
const RU = ['хуй', 'хуе', 'хуя', 'хую', 'хуил', 'пизд', 'пезд', 'ебан', 'ебал', 'еблан', 'ебло', 'ебуч', 'ебну', 'заеб', 'уеб', 'доеб', 'наеб', 'выеб', 'разъеб', 'отъеб', 'бляд', 'блят', 'сука', 'сучк', 'сучар', 'мудак', 'мудил', 'мудач', 'гандон', 'гондон', 'пидор', 'пидар', 'пидр', 'педик', 'педераст', 'педофил', 'шлюх', 'шалав', 'залуп', 'мразь', 'мразот', 'говн', 'дерьм', 'дроч', 'отсос', 'минет', 'вагин', 'пенис', 'порно', 'сиськ', 'титьк', 'ублюд', 'выблюд', 'дебил', 'идиот', 'кретин', 'тупиц', 'тварь', 'скотин', 'падаль', 'гнид', 'выродок', 'сдохн', 'изнасил', 'нацист', 'фашист', 'гитлер', 'свастик', 'ниггер', 'негр', 'чурк', 'пиндос', 'трахн', 'трахат', 'жопа', 'жопу', 'жопы', 'срака', 'сраный', 'хрен'].map(foldCyr);
// Short words that are only refused as a whole word (so "хлеб", "класс", "Дикий" stay fine).
const RU_WORDS = ['хер', 'еб', 'ебу', 'ебать', 'ебет', 'жоп', 'член', 'сиси', 'даун', 'лох', 'чмо', 'чмошник', 'жид', 'хач', 'гей', 'секс', 'сэкс', 'ссу', 'срать', 'пох', 'нах', 'пошел', 'урод', 'гнида', 'дура', 'дурак', 'тупой', 'тупая', 'сосу', 'соси', 'сосать', 'трах', 'бля', 'бляха', 'блин_'].map(foldCyr).filter(w => !w.includes('_'));
const LAT = ['fuck', 'fuk', 'fck', 'shit', 'bitch', 'cunt', 'nigg', 'fagg', 'whore', 'slut', 'rapist', 'asshole', 'dickhead', 'pussy', 'cocksuck', 'bastard', 'retard', 'porn', 'hitler', 'nazi', 'wanker', 'motherf', 'dumbass', 'jackass', 'blyat', 'blya', 'suka', 'pizd', 'huy', 'hui', 'xuy', 'xyi', 'ebat', 'ebal', 'eban', 'pidor', 'pidar', 'pidr', 'mudak', 'gandon', 'zalup', 'dolbo', 'eblan', 'ublud'].map(collapse);
const LAT_WORDS = ['ass', 'dick', 'cock', 'sex', 'fag', 'tits', 'boob', 'boobs', 'anal', 'rape', 'kys', 'gay', 'hoe', 'fu', 'wtf', 'pis', 'cum', 'dildo', 'penis', 'vagina', 'nude', 'nudes', 'milf'].map(collapse);

const URLISH = /https?:|www\.|\bt\.me|\.(ru|com|net|org|io|рф|ru)\b|@\w/i;
const ALLOWED_CHARS = /^[A-Za-zА-Яа-яЁё0-9 _.\-]+$/;

export type Check = { ok: true } | { ok: false; code: 'short' | 'chars' | 'link' | 'bad'; text: string };
export const TEXTS = {
  short: `Минимум ${NICK_MIN} символа`,
  chars: 'Только русские и английские буквы, цифры, пробел, _ . -',
  link: 'Ссылки и адреса в нике нельзя',
  bad: 'Это слово нельзя использовать, выбери другое',
};
const no = (code: 'short' | 'chars' | 'link' | 'bad'): Check => ({ ok: false, code, text: TEXTS[code] });

/** True when the text contains something we do not allow. */
export function isBad(raw: string): boolean {
  const cands = [cyrOf(raw, DIGIT_A), cyrOf(raw, DIGIT_B)], lat = latOf(raw);
  for (const c of cands) for (const s of RU) if (c.includes(s)) return true;
  for (const s of LAT) if (lat.includes(s)) return true;
  // whole name written with separators: "с у к а" is covered above; short words need the exact token
  const tokens = base(raw).split(/[^a-zа-яё0-9@$]+/).filter(Boolean);
  for (const t of tokens) {
    const tc = [cyrOf(t, DIGIT_A), cyrOf(t, DIGIT_B)], tl = latOf(t);
    if (tc.some(x => RU_WORDS.includes(x)) || LAT_WORDS.includes(tl)) return true;
  }
  if (cands.some(x => RU_WORDS.includes(x)) || LAT_WORDS.includes(lat)) return true;
  return false;
}

export function checkNick(raw: string): Check {
  const s = raw.trim();
  if (s.length < NICK_MIN) return no('short');
  if (!ALLOWED_CHARS.test(s)) return no('chars');
  if (URLISH.test(s)) return no('link');
  return isBad(s) ? no('bad') : { ok: true };
}

/** Room names: any characters, but the same bad-word and link checks. */
export function checkText(raw: string): Check {
  const s = raw.trim();
  if (URLISH.test(s)) return no('link');
  return isBad(s) ? no('bad') : { ok: true };
}
