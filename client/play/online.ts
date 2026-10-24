// WebSocket client for the online lobby and duels. All game rules stay on the server; this only moves messages.
import type { C2S, S2C } from '../../shared/net';

export type NetState = 'off' | 'connecting' | 'on';
export const SERVER_FALLBACK = 'wss://titans-server.onrender.com';

export function serverUrl(): string {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  const env = (import.meta.env.VITE_SERVER_URL as string | undefined);
  if (env) return env;
  return ['localhost', '127.0.0.1'].includes(location.hostname) ? `ws://${location.hostname}:8787` : SERVER_FALLBACK;
}

export class Online {
  state: NetState = 'off';
  rtt = .12;
  /** True after the first successful connection: a cold Render server can need up to a minute to wake. */
  slow = false;
  onState: (s: NetState) => void = () => {};
  onMsg: (m: S2C) => void = () => {};
  nick = () => 'Игрок';
  private ws: WebSocket | null = null;
  private pings = new Map<number, number>();
  private pingTimer = 0;
  private n = 0;
  private slowTimer = 0;

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.set('connecting'); this.slow = false;
    window.clearTimeout(this.slowTimer); this.slowTimer = window.setTimeout(() => { this.slow = true; this.onState(this.state); }, 4000);
    let ws: WebSocket;
    try { ws = new WebSocket(serverUrl()); } catch { this.set('off'); return; }
    this.ws = ws;
    ws.onopen = () => {
      window.clearTimeout(this.slowTimer); this.slow = false; this.set('on');
      this.send({ t: 'hello', nick: this.nick() });
      window.clearInterval(this.pingTimer); this.pingTimer = window.setInterval(() => this.ping(), 2500); this.ping();
    };
    ws.onmessage = e => {
      let m: S2C; try { m = JSON.parse(e.data as string); } catch { return; }
      if (m.t === 'pong') { const t0 = this.pings.get(m.n); if (t0 !== undefined) { this.pings.delete(m.n); this.rtt = this.rtt * .7 + ((performance.now() - t0) / 1000) * .3; } return; }
      this.onMsg(m);
    };
    const closed = () => { if (this.ws !== ws) return; window.clearTimeout(this.slowTimer); window.clearInterval(this.pingTimer); this.ws = null; this.set('off'); };
    ws.onclose = closed; ws.onerror = closed;
  }

  close() { const ws = this.ws; this.ws = null; window.clearInterval(this.pingTimer); window.clearTimeout(this.slowTimer); ws?.close(); this.set('off'); }
  send(m: C2S) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  private ping() { const n = ++this.n; this.pings.set(n, performance.now()); if (this.pings.size > 8) this.pings.delete(this.pings.keys().next().value!); this.send({ t: 'ping', n }); }
  private set(s: NetState) { this.state = s; this.onState(s); }
}
