import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseStore } from '../server/store.ts';
import { newProfile } from '../shared/progress.ts';

test('supabase store: a failed save is retried and the newest version of the profile wins', async () => {
  const bodies: any[] = []; let fail = 2;
  const fake = (async (_url: string, init?: { body?: string }) => {
    if (init?.body) bodies.push(JSON.parse(init.body));
    if (fail > 0) { fail--; return new Response('down', { status: 503 }); }
    return new Response(null, { status: 201 });
  }) as unknown as typeof fetch;
  const store = new SupabaseStore('https://x.supabase.co', 'k', fake, 5), p = newProfile('a1'), err = console.error;
  console.error = () => {};
  try {
    p.coins = 150; await store.save(p); assert.equal(store.unsaved, 1, 'kept after a failure');
    p.coins = 300; await store.save(p); // a newer save replaces the waiting one (and fails once more)
    for (let i = 0; i < 50 && store.unsaved; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(store.unsaved, 0); assert.equal(bodies.at(-1).data.coins, 300);
    assert.equal(store.peek('a1')!.coins, 300);
  } finally { console.error = err; }
});
