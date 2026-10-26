// Quick search: QUICK_SEARCH_S seconds of quiet search, then the player is offered "invite a friend" or "fight the AI now" while the search goes on
// for BOT_OFFER_S more seconds; after that the AI fight starts by itself. The bot is shown honestly (decision 2026-10-26); DISGUISE_BOT = true would give it a human-looking nick.
export const QUICK_SEARCH_S = 15;
export const BOT_OFFER_S = 30;
export const DISGUISE_BOT = false;

export const BOT_NICKS = ['Рубен', 'Тёма_77', 'Облачко', 'Громила', 'Алиса', 'Кирилл', 'SkyWolf', 'Макс', 'Дана', 'Витя_Pro', 'Каменщик', 'Lex', 'Мира', 'Шторм', 'Антон', 'Nika', 'Борис', 'Тимур', 'Ёжик', 'Dron4ik', 'Саня', 'Лиза', 'Rocky', 'Гоша', 'Титан_X', 'Влад', 'Ксюша', 'Zeus', 'Олег', 'Юля'];

export type BotPick = { level: 'normal' | 'hard'; skill: number; nick: string };
/** The quick-match bot fits the player: skill grows with rating (0.35 at 1000 = a soft "normal", 1 at 1325+ = full "hard") and follows the last bot fights
 *  (each of the last 3 lost: easier, each won: harder). `recent` = newest first, true = won. Rewards and rating use the nearest level. rnd() picks the nick. */
export function pickBot(rating: number, rnd: () => number, recent: boolean[] = []): BotPick {
  let skill = .35 + (rating - 1000) / 500;
  for (const won of recent.slice(0, 3)) skill += won ? .05 : -.08;
  skill = Math.max(.3, Math.min(1, skill));
  return { level: skill >= .75 ? 'hard' : 'normal', skill, nick: BOT_NICKS[Math.floor(rnd() * BOT_NICKS.length)] };
}
