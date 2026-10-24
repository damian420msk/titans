import { expect, type Page } from '@playwright/test';
export const state = (p: Page) => p.evaluate(() => (window as any).titans?.state());
export async function ready(p: Page) {
  await p.goto('/?test');
  await expect.poll(async () => (await state(p))?.ready).toBe(true);
}
export async function enter(p: Page) {
  await p.locator('#capture').click();
  await expect.poll(async () => (await state(p)).input.locked).toBe(true);
}
export async function aim(p: Page, x: number, z: number) {
  await p.evaluate(([x,z]) => (window as any).titans.aim(x,z), [x,z]);
  await expect.poll(async () => (await state(p)).selected).toEqual({x,z});
}
export async function place(p: Page, x: number, z: number, side = 0) {
  await p.evaluate(([x,z,side]) => (window as any).titans.place(x,z,side), [x,z,side]);
}
export async function release(p: Page) { await p.mouse.down(); await p.mouse.up(); }
export async function centre(p: Page, selector: string) {
  // Touch actions update simulation immediately; their HUD appears on the next rendered frame.
  await expect(p.locator(selector)).toBeVisible();
  const r = await p.locator(selector).boundingBox();
  if (!r) throw new Error(`Missing ${selector}`);
  return {x:r.x+r.width/2,y:r.y+r.height/2};
}
