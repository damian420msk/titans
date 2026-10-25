// When quick search finds nobody in QUICK_SEARCH_S seconds the player gets a bot with a human-looking nick.
// Flip DISGUISE_BOT to false to show the bot honestly ("ИИ · …") instead.
export const QUICK_SEARCH_S = 20;
export const DISGUISE_BOT = true;

export const BOT_NICKS = ['Рубен', 'Тёма_77', 'Облачко', 'Громила', 'Алиса', 'Кирилл', 'SkyWolf', 'Макс', 'Дана', 'Витя_Pro', 'Каменщик', 'Lex', 'Мира', 'Шторм', 'Антон', 'Nika', 'Борис', 'Тимур', 'Ёжик', 'Dron4ik', 'Саня', 'Лиза', 'Rocky', 'Гоша', 'Титан_X', 'Влад', 'Ксюша', 'Zeus', 'Олег', 'Юля'];

export type BotPick = { level: 'normal' | 'hard'; nick: string };
/** rnd() must return [0,1). Below 1100 rating the bot is "normal", above it is a coin flip between normal and hard. */
export function pickBot(rating: number, rnd: () => number): BotPick {
  const level = rating >= 1100 && rnd() < 0.5 ? 'hard' : 'normal';
  return { level, nick: BOT_NICKS[Math.floor(rnd() * BOT_NICKS.length)] };
}
