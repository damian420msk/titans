// Icons: glossy 3D images (Microsoft Fluent Emoji 3D, MIT, see public/art/ui/icons/LICENSE.txt) for objects and faces,
// plus a few hand-made volumetric SVG glyphs (pearl buttons, coin) for the controls that have no emoji. All sit in a square box.
// Gradients live in the hidden <svg id="icon-defs"> in index.html.
import { assetUrl } from './assets';
const O = 'stroke="#2c1d62" stroke-linejoin="round" stroke-linecap="round"';
const P = 'fill="url(#ig-pearl)"';
const wrap = (body: string) => `<svg class="gi" viewBox="0 0 32 32" aria-hidden="true">${body}</svg>`;
const img = (n: string, cls = '') => `<img class="gi${cls}" src="${assetUrl('art/ui/icons/' + n + '.webp')}" alt="" draggable="false" decoding="async">`;
// a pearl-white glyph made of a dark underlay line and a light line on top (arrows, crosses, brackets)
const line = (d: string, w = 4.2) => `<path d="${d}" fill="none" ${O} stroke-width="${w + 3.4}"/><path d="${d}" fill="none" stroke="url(#ig-pearl)" stroke-linecap="round" stroke-linejoin="round" stroke-width="${w}"/><path d="${d}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-linecap="round" stroke-linejoin="round" stroke-width="${w * 0.28}" transform="translate(-.5 -.8)"/>`;

export const ICON = {
  pause: wrap(`<rect x="7" y="6" width="6.4" height="20" rx="2.6" ${P} ${O} stroke-width="2.4"/><rect x="18.6" y="6" width="6.4" height="20" rx="2.6" ${P} ${O} stroke-width="2.4"/><rect x="8.4" y="7.4" width="1.6" height="9" rx=".8" fill="#fff" fill-opacity=".7"/><rect x="20" y="7.4" width="1.6" height="9" rx=".8" fill="#fff" fill-opacity=".7"/>`),
  full: wrap(`${line('M5.5 12V5.5H12M20 5.5h6.5V12M26.5 20v6.5H20M12 26.5H5.5V20', 3.6)}`),
  jump: wrap(`${line('M6.5 15.5l9.5-8.5 9.5 8.5', 4.2)}${line('M6.5 26l9.5-8.5L25.5 26', 4.2)}`),
  cancel: wrap(`${line('M8 8l16 16M24 8L8 24', 5)}`),
  coin: wrap(`<circle cx="16" cy="17" r="12" fill="#b9701a"/><circle cx="16" cy="15.5" r="12" fill="url(#ig-coin)" ${O} stroke-width="2.4"/><circle cx="16" cy="15.5" r="7.6" fill="none" stroke="#c4801f" stroke-width="2"/><path d="M16 10.6l1.5 3.1 3.4.4-2.5 2.3.7 3.4-3.1-1.7-3.1 1.7.7-3.4-2.5-2.3 3.4-.4z" fill="#fff3b0" stroke="#c4801f" stroke-width=".8" stroke-linejoin="round"/><path d="M8 11.5q2-4.5 7-5.3" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="2" stroke-linecap="round"/>`),
  heartEmpty: img('heart', ' off'),
  repair: img('tools'),
  gift: img('gift'),
  trophy: img('trophy'),
  gear: img('gear'),
  money: img('money'),
  tasks: img('tasks'),
  castle: img('castle'),
  map: img('map'),
  globe: img('globe'),
  robot: img('robot'),
  target: img('target'),
  lock: img('lock'),
  link: img('link'),
  bag: img('bag'),
  bolt: img('bolt'),
  boot: img('boot'),
  pick: img('pick'),
  wind: img('wind'),
  feather: img('feather'),
  check: img('check'),
  mountain: img('mountain'),
  walk: img('walk'),
  clock: img('clock'),
  tools: img('tools'),
  film: img('film'),
  star: img('star'),
  heart: img('heart'),
  stone: img('stone'),
  smile: img('smile'),
  cool: img('cool'),
  wow: img('wow'),
  angry: img('angry'),
  sound: img('sound'),
  mute: img('mute'),
  chat: img('chat'),
} as const;
export type IconName = keyof typeof ICON;
export const icon = (name: IconName) => ICON[name];
export const EMOTE_ICONS: IconName[] = ['smile', 'cool', 'wow', 'angry'];

/** Fills every [data-icon="name"] placeholder of the page (static markup) with its SVG. */
export function hydrateIcons(root: ParentNode = document) { root.querySelectorAll<HTMLElement>('[data-icon]').forEach(el => { const n = el.dataset.icon as IconName; if (ICON[n]) el.innerHTML = ICON[n]; }); }
/** Inline icon for strings built in code (sized by the surrounding font size). */
export const ico = (name: IconName) => `<span class="ico">${ICON[name]}</span>`;
