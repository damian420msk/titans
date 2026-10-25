// HUD icons in the style of the menu: chunky rounded glyphs, warm cream-to-gold fill, dark violet outline.
// One 32x32 grid for all of them so they line up; gradients live in the hidden <svg id="icon-defs"> in index.html.
const O = 'stroke="#2c1d62" stroke-linejoin="round" stroke-linecap="round"';
const G = 'fill="url(#ig-gold)"';
const wrap = (body: string, label = '') => `<svg class="gi" viewBox="0 0 32 32" aria-hidden="true"${label}>${body}</svg>`;
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

  gift: wrap(`<rect x="4" y="12" width="24" height="16" rx="3" ${G} ${O} stroke-width="2.4"/><rect x="2.5" y="8" width="27" height="7" rx="2.5" fill="#ffb347" ${O} stroke-width="2.4"/><rect x="13.5" y="8" width="5" height="20" fill="#e5304c" ${O} stroke-width="1.8"/><path d="M16 8C13 2.5 7.5 3 8.5 6.5 9.2 8.5 13 8 16 8zM16 8c3-5.5 8.5-5 7.5-1.5C22.8 8.5 19 8 16 8z" fill="#e5304c" ${O} stroke-width="2"/>`),
  trophy: wrap(`<path d="M9 4.5h14v8.5a7 7 0 0 1-14 0z" ${G} ${O} stroke-width="2.4"/><path d="M9 7H4.5v2.5a5.5 5.5 0 0 0 5 5.4M23 7h4.5v2.5a5.5 5.5 0 0 1-5 5.4" fill="none" ${O} stroke-width="2.4"/><rect x="13.6" y="19.5" width="4.8" height="5" ${G} ${O} stroke-width="2"/><rect x="8.5" y="24" width="15" height="4.5" rx="2" fill="#f5a73a" ${O} stroke-width="2.2"/>`),
  gear: wrap(`${[0,45,90,135].map(a => `<rect x="12.6" y="1.5" width="6.8" height="29" rx="2.2" transform="rotate(${a} 16 16)" ${G} ${O} stroke-width="2"/>`).join('')}<circle cx="16" cy="16" r="9" ${G} ${O} stroke-width="2.4"/><circle cx="16" cy="16" r="3.8" fill="#4a3a8a" ${O} stroke-width="2"/>`),
  cart: wrap(`<path d="M2.5 5.5h4.5l3.5 15.5h14.5l3.5-11.5H8.3" fill="none" ${O} stroke-width="5.4"/><path d="M2.5 5.5h4.5l3.5 15.5h14.5l3.5-11.5H8.3" fill="none" stroke="url(#ig-gold)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12.5" cy="26" r="2.8" ${G} ${O} stroke-width="2"/><circle cx="23" cy="26" r="2.8" ${G} ${O} stroke-width="2"/>`),
  tasks: wrap(`<rect x="6" y="5.5" width="20" height="23" rx="3.5" ${G} ${O} stroke-width="2.4"/><rect x="11" y="2.5" width="10" height="6" rx="2.5" fill="#f5a73a" ${O} stroke-width="2.2"/>${line('M10.5 16.5l3 3 5.5-6', 2.4)}${line('M10.5 24h11', 2)}`),
  castle: wrap(`<path d="M4.5 28.5V9h5v3.5h3.5V9h6v3.5h3.5V9h5v19.5z" ${G} ${O} stroke-width="2.4"/><path d="M13 28.5v-7a3 3 0 0 1 6 0v7z" fill="#4a3a8a" ${O} stroke-width="2"/>`),
  map: wrap(`<path d="M3.5 8L11 5l10 3 7.5-3v19l-7.5 3-10-3-7.5 3z" ${G} ${O} stroke-width="2.4"/><path d="M11 5v19M21 8v19" fill="none" ${O} stroke-width="1.8"/>${line('M13.5 12.5l4.5 4.5M18 12.5L13.5 17', 2.2)}`),
  globe: wrap(`<circle cx="16" cy="16" r="12.5" ${G} ${O} stroke-width="2.4"/><ellipse cx="16" cy="16" rx="5.2" ry="12.5" fill="none" ${O} stroke-width="1.9"/><path d="M3.8 12.5h24.4M3.8 19.5h24.4" fill="none" ${O} stroke-width="1.9"/>`),
  robot: wrap(`<path d="M16 3.5v4" ${O} stroke-width="2.2"/><circle cx="16" cy="3.8" r="2" fill="#e5304c" ${O} stroke-width="1.6"/><rect x="5.5" y="7.5" width="21" height="18" rx="5" ${G} ${O} stroke-width="2.4"/><circle cx="11.8" cy="15.5" r="2.8" fill="#2c1d62"/><circle cx="20.2" cy="15.5" r="2.8" fill="#2c1d62"/><path d="M11.5 21.2h9" ${O} stroke-width="2.2"/><rect x="2.5" y="13" width="3" height="7" rx="1.5" fill="#f5a73a" ${O} stroke-width="1.6"/><rect x="26.5" y="13" width="3" height="7" rx="1.5" fill="#f5a73a" ${O} stroke-width="1.6"/>`),
  target: wrap(`<circle cx="16" cy="16" r="12.8" ${G} ${O} stroke-width="2.4"/><circle cx="16" cy="16" r="8.3" fill="#e5304c" ${O} stroke-width="2"/><circle cx="16" cy="16" r="4.2" ${G} ${O} stroke-width="2"/>`),
  lock: wrap(`<path d="M10 14V10.5a6 6 0 0 1 12 0V14" fill="none" ${O} stroke-width="5.2"/><path d="M10 14V10.5a6 6 0 0 1 12 0V14" fill="none" stroke="#e9e3ff" stroke-width="2.6"/><rect x="6" y="13.5" width="20" height="15" rx="3.5" ${G} ${O} stroke-width="2.4"/><circle cx="16" cy="20" r="2.2" fill="#2c1d62"/><path d="M16 21v3" ${O} stroke-width="2"/>`),
  link: wrap(`<g transform="rotate(-45 16 16)"><rect x="2.5" y="10.5" width="14" height="11" rx="5.5" fill="none" ${O} stroke-width="5.2"/><rect x="15.5" y="10.5" width="14" height="11" rx="5.5" fill="none" ${O} stroke-width="5.2"/><rect x="2.5" y="10.5" width="14" height="11" rx="5.5" fill="none" stroke="url(#ig-gold)" stroke-width="2.8"/><rect x="15.5" y="10.5" width="14" height="11" rx="5.5" fill="none" stroke="url(#ig-gold)" stroke-width="2.8"/></g>`),
  bag: wrap(`<path d="M10 9V7a6 6 0 0 1 12 0v2" fill="none" ${O} stroke-width="2.4"/><path d="M6.5 14a6 6 0 0 1 6-6h7a6 6 0 0 1 6 6v12.5a2.5 2.5 0 0 1-2.5 2.5h-14A2.5 2.5 0 0 1 6.5 26.5z" ${G} ${O} stroke-width="2.4"/><rect x="11" y="17" width="10" height="7" rx="2" fill="#f5a73a" ${O} stroke-width="2"/>`),
  bolt: wrap(`<path d="M19.5 2L5.5 18.5h8.5l-2.5 11.5L26.5 13h-9z" ${G} ${O} stroke-width="2.4"/>`),
  boot: wrap(`<path d="M10 3.5h9v11.5l7.5 3.5a3 3 0 0 1 1.7 2.7V26.5H6.5V3.5z" ${G} ${O} stroke-width="2.4"/><path d="M6.5 22.5h21.7" ${O} stroke-width="2.2"/>`),
  pick: wrap(`${line('M6 6.5q10-5 20 0', 4)}${line('M16 5v23', 3.4)}`),
  wind: wrap(`${line('M3.5 11h16a4 4 0 1 0-4-4', 3)}${line('M3.5 17h22a4 4 0 1 1-4 4', 3)}${line('M3.5 23h9', 3)}`),
  feather: wrap(`<path d="M26.5 4.5C14 3.5 6.5 11 7 20.5l-2.5 7 2.5.5 4-5.5c10 .5 17-6 15.5-18z" ${G} ${O} stroke-width="2.4"/><path d="M9 25c4-6 9-10 14-12.5" fill="none" ${O} stroke-width="2"/>`),
  check: wrap(`${line('M6.5 17l7 7L26 8.5', 5)}`),
  mountain: wrap(`<path d="M2 27L12 7l5 9 3.5-5.5L30 27z" ${G} ${O} stroke-width="2.4"/><path d="M12 7l-3.2 6.2 3 -1.4 2 2.2 2.2-1.6z" fill="#fff" ${O} stroke-width="1.4"/>`),
  walk: wrap(`<circle cx="18.5" cy="5.5" r="3.6" ${G} ${O} stroke-width="2.2"/>${line('M17 11l-3.5 8.5 5.5 4.5-1.5 6M16.5 12l5.5 5 5-2M14 17.5l-6.5 2', 3)}`),
  clock: wrap(`<circle cx="16" cy="16" r="12.5" ${G} ${O} stroke-width="2.4"/>${line('M16 8.5V16l5 3', 2.6)}`),
  tools: wrap(`<g transform="rotate(-45 16 16)"><rect x="13.8" y="9" width="4.4" height="20" rx="2.2" fill="#d79a5a" ${O} stroke-width="2"/><rect x="6.5" y="3" width="19" height="8.5" rx="3" ${G} ${O} stroke-width="2.2"/></g>`),
  film: wrap(`<rect x="3" y="6.5" width="26" height="19" rx="4" ${G} ${O} stroke-width="2.4"/><path d="M13 11.5v9l8-4.5z" fill="#2c1d62"/>`),
  star: wrap(`<path d="M16 3.5l3.8 8 8.7 1.1-6.4 6 1.7 8.7L16 22.9l-7.8 4.4 1.7-8.7-6.4-6 8.7-1.1z" ${G} ${O} stroke-width="2.4"/>`),
  coin: wrap(`<circle cx="16" cy="16" r="11.5" ${G} ${O} stroke-width="2.6"/><circle cx="16" cy="16" r="6.6" fill="none" stroke="#c98a1c" stroke-width="2.2"/>`),
} as const;
export type IconName = keyof typeof ICON;
export const icon = (name: IconName) => ICON[name];
export const EMOTE_ICONS: IconName[] = ['smile', 'cool', 'wow', 'angry'];

/** Fills every [data-icon="name"] placeholder of the page (static markup) with its SVG. */
export function hydrateIcons(root: ParentNode = document) { root.querySelectorAll<HTMLElement>('[data-icon]').forEach(el => { const n = el.dataset.icon as IconName; if (ICON[n]) el.innerHTML = ICON[n]; }); }
/** Inline icon for strings built in code (sized by the surrounding font size). */
export const ico = (name: IconName) => `<span class="ico">${ICON[name]}</span>`;
