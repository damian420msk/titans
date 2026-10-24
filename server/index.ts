// Online duel server: HTTP health check + WebSocket lobby. Run: node --experimental-strip-types server/index.ts
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { Lobby, type Conn } from './lobby.ts';

const PORT = Number(process.env.PORT) || 8787;
const lobby = new Lobby();
lobby.onResult = r => console.log(`[match] ${r.names[0]} vs ${r.names[1]}: ${r.winner === null ? 'draw' : r.names[r.winner] + ' won'} (${r.reason})`);
const started = Date.now();

const http = createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (req.url === '/health' || req.url === '/') { res.writeHead(200, cors); res.end(JSON.stringify({ ok: true, uptime: Math.round((Date.now() - started) / 1000), ...lobby.stats })); return; }
  res.writeHead(404, cors); res.end('{}');
});
const wss = new WebSocketServer({ server: http, maxPayload: 2048 });

wss.on('connection', (ws: WebSocket) => {
  const LAG = Number(process.env.FAKE_LAG_MS) || 0; // testing aid: simulate network latency in both directions
  const later = (f: () => void) => LAG ? setTimeout(f, LAG) : f();
  const conn: Conn = { send: m => { const t = JSON.stringify(m); later(() => { if (ws.readyState === ws.OPEN) ws.send(t); }); } };
  let alive = true, tokens = 200, last = Date.now();
  ws.on('pong', () => { alive = true; });
  (ws as any).isAliveCheck = () => { if (!alive) { ws.terminate(); return; } alive = false; ws.ping(); };
  lobby.connect(conn);
  ws.on('message', data => {
    const now = Date.now(); tokens = Math.min(200, tokens + (now - last) * .1); last = now; // 100 messages per second sustained
    if (--tokens < 0) return;
    let m: unknown; try { m = JSON.parse(data.toString()); } catch { return; }
    later(() => { try { lobby.handle(conn, m); } catch (e) { console.error('handler error', e); } });
  });
  ws.on('close', () => lobby.disconnect(conn));
  ws.on('error', () => lobby.disconnect(conn));
});

let prev = process.hrtime.bigint();
setInterval(() => {
  const now = process.hrtime.bigint(), dt = Number(now - prev) / 1e9; prev = now;
  try { lobby.tick(dt); } catch (e) { console.error('tick error', e); }
}, 1000 / 60);
setInterval(() => { for (const ws of wss.clients) (ws as any).isAliveCheck?.(); }, 25000);

http.listen(PORT, () => console.log(`titans server on :${PORT}`));
