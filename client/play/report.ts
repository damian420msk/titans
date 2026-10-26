// Client errors go to the duel server log (POST /log as text/plain via sendBeacon: no CORS preflight, survives page unload).
// At most a few per page load, each message once, so a broken frame loop cannot flood the server.
import { serverUrl } from './online';

const sent = new Set<string>();
const MAX = 5;
const logUrl = () => serverUrl().replace(/^ws(s?):/, 'http$1:').replace(/\/$/, '') + '/log';

export function report(kind: string, msg: unknown, where = '') {
  try {
    const text = String((msg as Error)?.stack ?? (msg as Error)?.message ?? msg).slice(0, 600);
    const key = kind + text.slice(0, 120); if (sent.has(key) || sent.size >= MAX) return; sent.add(key);
    const body = JSON.stringify({ kind, msg: text, where: where.slice(0, 160), page: location.pathname + location.search.slice(0, 60), ua: navigator.userAgent.slice(0, 160) });
    if (!navigator.sendBeacon?.(logUrl(), new Blob([body], { type: 'text/plain' }))) void fetch(logUrl(), { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
  } catch { /* reporting must never break the game */ }
}

export function watchErrors() {
  addEventListener('error', e => report('error', e.error ?? e.message, `${e.filename ?? ''}:${e.lineno ?? 0}:${e.colno ?? 0}`));
  addEventListener('unhandledrejection', e => report('promise', e.reason));
}
