// Yandex Games SDK wrapper. Outside Yandex (or without ?ysdk) every call is a harmless no-op, so the game runs anywhere.
// ?fakeads=1 pretends there is an SDK with 1.5 s ads: lets the whole flow be tested in a normal browser.
type Hooks = { onAdStart: () => void; onAdEnd: () => void };

class Yandex {
  available = false;
  private sdk: any = null;
  private hooks: Hooks = { onAdStart() {}, onAdEnd() {} };
  private lastAd = 0;
  private fake = false;
  private playing = false;

  async init(hooks: Hooks) {
    this.hooks = hooks;
    const q = new URLSearchParams(location.search);
    this.fake = q.has('fakeads');
    if (this.fake) { this.available = true; return; }
    if (!(q.has('ysdk') || /yandex/.test(location.hostname))) return;
    try {
      await new Promise<void>((ok, bad) => { const s = document.createElement('script'); s.src = '/sdk.js'; s.onload = () => ok(); s.onerror = () => bad(new Error('no sdk')); document.head.appendChild(s); });
      this.sdk = await (window as any).YaGames.init(); this.available = true;
    } catch (e) { console.warn('Yandex SDK not available', e); }
  }
  /** Tell Yandex that loading has finished (required before the game counts as started). */
  ready() { try { this.sdk?.features?.LoadingAPI?.ready?.(); } catch { /* optional */ } }
  gameplay(on: boolean) {
    if (on === this.playing) return; this.playing = on;
    try { on ? this.sdk?.features?.GameplayAPI?.start?.() : this.sdk?.features?.GameplayAPI?.stop?.(); } catch { /* optional */ }
  }
  /** Full-screen ad between matches, at most once per `gap` seconds. Resolves when it is over (or skipped). */
  async interstitial(gap = 90): Promise<void> {
    if (!this.available || performance.now() - this.lastAd < gap * 1000) return;
    this.lastAd = performance.now(); this.hooks.onAdStart();
    try {
      if (this.fake) await fakeAd('Реклама');
      else await new Promise<void>(done => this.sdk.adv.showFullscreenAdv({ callbacks: { onClose: () => done(), onError: () => done() } }));
    } finally { this.hooks.onAdEnd(); }
  }
  /** Rewarded video. Resolves true only if the player watched it to the end. */
  async rewarded(): Promise<boolean> {
    if (!this.available) return false;
    this.hooks.onAdStart(); let got = false;
    try {
      if (this.fake) { await fakeAd('Видео за награду'); got = true; }
      else await new Promise<void>(done => this.sdk.adv.showRewardedVideo({ callbacks: { onRewarded: () => { got = true; }, onClose: () => done(), onError: () => done() } }));
    } finally { this.hooks.onAdEnd(); this.lastAd = performance.now(); }
    return got;
  }
}
function fakeAd(label: string) {
  return new Promise<void>(done => {
    const el = document.createElement('div'); el.style.cssText = 'position:fixed;inset:0;z-index:99;background:#000d;color:#fff;display:grid;place-items:center;font:700 22px system-ui'; el.textContent = `${label} (тест)…`;
    document.body.appendChild(el); setTimeout(() => { el.remove(); done(); }, 1500);
  });
}
export const ya = new Yandex();
