// Where profiles live. MemoryStore (optionally mirrored to a JSON file) for local runs and tests; SupabaseStore for production,
// because a free Render disk is wiped on every restart. Selected by env vars in index.ts.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { sanitizeProfile, type Profile, type PublicEntry } from '../shared/progress.ts';

export interface Store {
  /** Synchronous fast path when the profile is already in memory (undefined = unknown, call load). */
  peek?(id: string): Profile | null | undefined;
  load(id: string): Promise<Profile | null>;
  save(p: Profile): Promise<void>;
  top(n: number): Promise<PublicEntry[]>;
}
const pub = (p: Profile): PublicEntry => ({ nick: p.nick, rating: p.rating, wins: p.wins, losses: p.losses });
const topOf = (all: Iterable<Profile>, n: number) => [...all].filter(p => p.games > 0).sort((a, b) => b.rating - a.rating || b.wins - a.wins).slice(0, n).map(pub);

export class MemoryStore implements Store {
  private map = new Map<string, Profile>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private file: string | undefined;
  constructor(file?: string) {
    this.file = file;
    if (file && existsSync(file)) { try { for (const [id, raw] of Object.entries(JSON.parse(readFileSync(file, 'utf8')))) this.map.set(id, sanitizeProfile(raw, id)); } catch (e) { console.error('profiles file unreadable', e); } }
  }
  peek(id: string) { return this.map.get(id) ?? null; }
  async load(id: string) { return this.peek(id); }
  async save(p: Profile) { this.map.set(p.id, structuredClone(p)); if (this.file && !this.timer) this.timer = setTimeout(() => { this.timer = null; try { writeFileSync(this.file!, JSON.stringify(Object.fromEntries(this.map))); } catch (e) { console.error('profiles file write failed', e); } }, 2000); }
  async top(n: number) { return topOf(this.map.values(), n); }
}

/** Supabase REST (PostgREST). Table: profiles(id text pk, rating int, games int, data jsonb). Use the service_role key, server side only.
 * Saves go through one queue: a failed save is retried with a growing pause (2 s … 60 s) and a newer save of the same profile replaces the waiting one,
 * so a short Supabase outage does not lose purchases or rewards (they stay in memory meanwhile). */
export class SupabaseStore implements Store {
  private cache = new Map<string, Profile>();
  private url: string; private key: string; private fetch: typeof fetch;
  private pending = new Map<string, Profile>();
  private chain: Promise<void> = Promise.resolve();
  private retry: ReturnType<typeof setTimeout> | null = null;
  private baseDelay: number; private delay: number;
  constructor(url: string, key: string, fetchFn: typeof fetch = fetch, retryMs = 2000) { this.url = url; this.key = key; this.fetch = fetchFn; this.baseDelay = this.delay = retryMs; }
  private h(extra: Record<string, string> = {}) { return { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', ...extra }; }
  /** Profiles not yet written to Supabase (for /health and tests). */
  get unsaved() { return this.pending.size; }
  peek(id: string) { return this.cache.get(id); }
  async load(id: string) {
    const r = await this.fetch(`${this.url}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=data`, { headers: this.h() });
    if (!r.ok) throw new Error(`supabase load ${r.status}`);
    const rows = await r.json() as { data: unknown }[]; const p = rows[0] ? sanitizeProfile(rows[0].data, id) : null;
    if (p) this.cache.set(id, p); return p;
  }
  save(p: Profile) {
    const copy = structuredClone(p); this.cache.set(p.id, copy); this.pending.set(p.id, copy);
    return this.queue();
  }
  private queue() { this.chain = this.chain.then(() => this.flush()); return this.chain; }
  private async flush() {
    for (const [id, p] of [...this.pending]) {
      try {
        const r = await this.fetch(`${this.url}/rest/v1/profiles?on_conflict=id`, { method: 'POST', headers: this.h({ Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify({ id: p.id, rating: p.rating, games: p.games, data: p }) });
        if (!r.ok) throw new Error(`supabase save ${r.status} ${await r.text()}`);
        if (this.pending.get(id) === p) this.pending.delete(id);
        this.delay = this.baseDelay;
      } catch (e) {
        console.error(`profile save failed, retry in ${Math.round(this.delay / 1000)} s (${this.pending.size} waiting)`, e);
        if (!this.retry) { this.retry = setTimeout(() => { this.retry = null; void this.queue(); }, this.delay); this.retry.unref?.(); }
        this.delay = Math.min(this.delay * 2, 60000); return;
      }
    }
  }
  async top(n: number) {
    const r = await this.fetch(`${this.url}/rest/v1/profiles?select=data&games=gt.0&order=rating.desc&limit=${n}`, { headers: this.h() });
    if (!r.ok) throw new Error(`supabase top ${r.status}`);
    return topOf((await r.json() as { data: unknown }[]).map(x => sanitizeProfile(x.data, '')), n);
  }
}
