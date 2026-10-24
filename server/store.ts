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

/** Supabase REST (PostgREST). Table: profiles(id text pk, rating int, games int, data jsonb). Use the service_role key, server side only. */
export class SupabaseStore implements Store {
  private cache = new Map<string, Profile>();
  private url: string; private key: string;
  constructor(url: string, key: string) { this.url = url; this.key = key; }
  private h(extra: Record<string, string> = {}) { return { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', ...extra }; }
  peek(id: string) { return this.cache.get(id); }
  async load(id: string) {
    const r = await fetch(`${this.url}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&select=data`, { headers: this.h() });
    if (!r.ok) throw new Error(`supabase load ${r.status}`);
    const rows = await r.json() as { data: unknown }[]; const p = rows[0] ? sanitizeProfile(rows[0].data, id) : null;
    if (p) this.cache.set(id, p); return p;
  }
  async save(p: Profile) {
    this.cache.set(p.id, structuredClone(p));
    const r = await fetch(`${this.url}/rest/v1/profiles?on_conflict=id`, { method: 'POST', headers: this.h({ Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify({ id: p.id, rating: p.rating, games: p.games, data: p }) });
    if (!r.ok) throw new Error(`supabase save ${r.status} ${await r.text()}`);
  }
  async top(n: number) {
    const r = await fetch(`${this.url}/rest/v1/profiles?select=data&games=gt.0&order=rating.desc&limit=${n}`, { headers: this.h() });
    if (!r.ok) throw new Error(`supabase top ${r.status}`);
    return topOf((await r.json() as { data: unknown }[]).map(x => sanitizeProfile(x.data, '')), n);
  }
}
