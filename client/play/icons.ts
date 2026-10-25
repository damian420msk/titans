// HUD icons in the style of the menu: chunky rounded glyphs, warm cream-to-gold fill, dark violet outline.
// One 32x32 grid for all of them so they line up; gradients live in the hidden <svg id="icon-defs"> in index.html.
const O = 'stroke="#2c1d62" stroke-linejoin="round" stroke-linecap="round"';
const G = 'fill="url(#ig-gold)"';
const wrap = (body: string, label = '') => `<svg class="ic" viewBox="0 0 32 32" aria-hidden="true"${label}>${body}</svg>`;
// a thick glyph made of a dark underlay line and a gold line on top (for strokes: arrows, waves, brackets)
const line = (d: string, w = 4.2) => `<path d="${d}" fill="none" ${O} stroke-width="${w + 3.2}"/><path d="${d}" fill="none" stroke="url(#ig-gold)" stroke-linecap="round" stroke-linejoin="round" stroke-width="${w}"/>`;
const face = (features: string) => `<circle cx="16" cy="16" r="12.5" fill="url(#ig-face)" ${O} stroke-width="2.4"/>${features}`;
const eye = (x: number, y: number) => `<ellipse cx="${x}" cy="${y}" rx="1.9" ry="2.5" fill="#2c1d62"/>`;

export const ICON = {
  pause: wrap(`<rect x="7.5" y="6.5" width="6" height="19" rx="2.2" ${G} ${O} stroke-width="2.4"/><rect x="18.5" y="6.5" width="6" height="19" rx="2.2" ${G} ${O} stroke-width="2.4"/>`),
  sound: wrap(`<path d="M4.5 12.2h5L16 6.4v19.2l-6.5-5.8h-5z" ${G} ${O} stroke-width="2.4"/>${line('M20.5 12 q3 4 0 8', 2.6)}${line('M24.5 8.2 q6.2 7.8 0 15.6', 2.6)}`),
  mute: wrap(`<path d="M4.5 12.2h5L16 6.4v19.2l-6.5-5.8h-5z" ${G} ${O} stroke-width="2.4"/>${line('M21 12.5l7 7M28 12.5l-7 7', 2.8)}`),
  full: wrap(`${line('M5 12V5h7M20 5h7v7M27 20v7h-7M12 27H5v-7', 3.4)}`),
  chat: wrap(`<path d="M6 5.5h20a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H15l-6.5 5v-5H6a3 3 0 0 1-3-3v-11a3 3 0 0 1 3-3z" ${G} ${O} stroke-width="2.4"/><circle cx="10.5" cy="14" r="1.8" fill="#2c1d62"/><circle cx="16" cy="14" r="1.8" fill="#2c1d62"/><circle cx="21.5" cy="14" r="1.8" fill="#2c1d62"/>`),
  jump: wrap(`${line('M7 15l9-8 9 8', 4)}${line('M7 25l9-8 9 8', 4)}`),
  repair: wrap(`<g transform="rotate(-45 16 16)"><rect x="13.6" y="10" width="4.8" height="19" rx="2.4" fill="#d79a5a" ${O} stroke-width="2.2"/><rect x="5.5" y="3.5" width="21" height="9.5" rx="3" ${G} ${O} stroke-width="2.4"/></g>`),
  cancel: wrap(`${line('M8 8l16 16M24 8L8 24', 4.6)}`),
  heart: wrap(`<path d="M16 28.2C3.8 19.6 2.6 11.4 8 7.6c3.5-2.2 6.5-.2 8 2.8 1.5-3 4.5-5 8-2.8 5.4 3.8 4.2 12-8 20.6z" fill="url(#ig-heart)" ${O} stroke-width="2.4"/><path d="M9 11.5c1-1.6 2.6-2 3.8-1.3" fill="none" stroke="#ffd6dc" stroke-width="2" stroke-linecap="round"/>`),
  heartEmpty: wrap(`<path d="M16 28.2C3.8 19.6 2.6 11.4 8 7.6c3.5-2.2 6.5-.2 8 2.8 1.5-3 4.5-5 8-2.8 5.4 3.8 4.2 12-8 20.6z" fill="#4a3f78" stroke="#2c1d62" stroke-linejoin="round" stroke-width="2.4"/>`),
  stone: wrap(`<path d="M16 4.5l10.5 5.2v12.6L16 27.5 5.5 22.3V9.7z" fill="#cfc9bb" ${O} stroke-width="2.2"/><path d="M5.5 9.7L16 15l10.5-5.3M16 15v12.5" fill="none" ${O} stroke-width="1.8"/><path d="M16 15L5.5 9.7 16 4.5l10.5 5.2z" fill="#f1ece0" ${O} stroke-width="1.8"/>`),
  smile: wrap(face(`${eye(11.5, 13)}${eye(20.5, 13)}<path d="M9.8 18.5q6.2 6.2 12.4 0" fill="none" stroke="#2c1d62" stroke-width="2.4" stroke-linecap="round"/>`)),
  cool: wrap(face(`<path d="M5.6 12.2h20.8v2.4a4 4 0 0 1-4 4h-3.4a3 3 0 0 1-3-2.6h-3.6a3 3 0 0 1-3 2.6H9.6a4 4 0 0 1-4-4z" fill="#2c1d62"/><path d="M10.5 21q5.5 3.6 11 0" fill="none" stroke="#2c1d62" stroke-width="2.4" stroke-linecap="round"/>`)),
  wow: wrap(face(`${eye(11.5, 12.5)}${eye(20.5, 12.5)}<ellipse cx="16" cy="21.5" rx="3.4" ry="4" fill="#2c1d62"/>`)),
  angry: wrap(face(`<path d="M7.8 9l7 3M24.2 9l-7 3" stroke="#2c1d62" stroke-width="2.6" stroke-linecap="round"/>${eye(11.5, 15)}${eye(20.5, 15)}<path d="M10.2 23.5q5.8-4.4 11.6 0" fill="none" stroke="#2c1d62" stroke-width="2.4" stroke-linecap="round"/>`)),
} as const;
export type IconName = keyof typeof ICON;
export const icon = (name: IconName) => ICON[name];
export const EMOTE_ICONS: IconName[] = ['smile', 'cool', 'wow', 'angry'];
