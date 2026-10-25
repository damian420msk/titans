// Phones play in landscape only. Three layers, because no single one works everywhere:
//  1. public/manifest.webmanifest says "landscape" (installed app, store wrapper such as TWA / Capacitor);
//  2. the first touch asks for fullscreen + a landscape lock (Android Chrome: the screen turns by itself);
//  3. a full-screen "turn the phone" cover for everything else (iPhone Safari cannot lock, a browser tab cannot lock): menu and battle alike.
export const isPortrait = () => innerHeight > innerWidth;

export function lockLandscape() {
  try { (screen.orientation as any)?.lock?.('landscape')?.catch?.(() => {}); } catch { /* not allowed outside fullscreen on most browsers */ }
}

/** `enter` requests fullscreen (may be refused: iPhone, iframes without permission, user opt-out). */
export function initOrientation(touch: boolean, enter: () => void) {
  if (!touch) return;
  // first real touch: the only moment a browser allows fullscreen and the lock
  window.addEventListener('pointerup', () => { enter(); lockLandscape(); }, { once: true });
  // a lock is dropped when fullscreen ends or the app returns from the background: ask again
  document.addEventListener('fullscreenchange', () => { if (document.fullscreenElement) lockLandscape(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) lockLandscape(); });
}
