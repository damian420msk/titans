import test from 'node:test';
import assert from 'node:assert/strict';
import { QualityPolicy, renderScale, settings } from '../client/play/quality.ts';

test('a phone never renders more than one pixel per CSS pixel, whatever the device pixel ratio', () => {
  for (const [w, h] of [[640, 360], [844, 390], [915, 412], [1280, 720], [2400, 1080]]) {
    for (const d of [0, 1, 2, 3]) {
      const q = settings(true, d), s = renderScale(w, h, q, 3);
      assert.ok(s <= 1); assert.ok(w * h * s * s <= q.maxPixels + 1); assert.ok(Math.max(w, h) * s <= q.maxEdge + 1);
    }
  }
  assert.equal(renderScale(915, 412, settings(true), 3), 1);
  assert.equal(renderScale(915, 412, settings(false), 2), 2, 'a desktop with a sharp screen keeps its device ratio');
  assert.ok(renderScale(1920, 1080, settings(false), 2) < 2, 'but a 4K-class buffer is capped');
  assert.ok(renderScale(2400, 1080, settings(true), 3) < .6, 'a huge tablet window is capped by the pixel budget');
});

test('budgets are smaller on phones and shrink with degradation', () => {
  const m = settings(true), d = settings(false), m2 = settings(true, 2);
  assert.ok(m.clouds < d.clouds && m.particles < d.particles && m.fragments < d.fragments && m.trailEvery > d.trailEvery && d.trailEvery === 0);
  assert.equal(m.glow, true); assert.equal(settings(true, 1).glow, false);
  assert.ok(m.farIslands < d.farIslands && m2.farIslands < m.farIslands && m2.farIslands >= 3); assert.equal(m2.shadows, false); assert.ok(m2.clouds < m.clouds);
  assert.equal(d.shadows && d.glow, true); assert.equal(settings(false, 3).shadows, true, 'desktop keeps shadows');
});

test('quality steps down only after sustained slowness, with a cooldown, and never back up', () => {
  const p = new QualityPolicy(true);
  for (let i = 0; i < 400; i++) p.sample(16.67);
  for (let i = 0; i < 10; i++) { p.sample(120); for (let j = 0; j < 70; j++) p.sample(16.67); p.sample(10000); }
  assert.equal(p.degradation, 0, 'spikes and hidden gaps are ignored');
  let changes = 0; for (let i = 0; i < 200; i++) if (p.sample(40)) changes++;
  assert.equal(changes, 1); assert.equal(p.degradation, 1);
  for (let i = 0; i < 2500; i++) p.sample(40);
  assert.equal(p.degradation, 3);
  for (let i = 0; i < 5000; i++) p.sample(16.67);
  assert.equal(p.degradation, 3, 'no oscillation back up');
});
