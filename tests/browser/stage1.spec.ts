import { test, expect } from '@playwright/test';
import { state, ready, enter, place } from './helpers';

test('entry, actual Pointer Lock, unheld mouse look, Escape and explicit reentry', async ({page}) => {
  const errors: string[] = [];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await ready(page);
  expect((await state(page)).input.locked).toBe(false);
  await enter(page);
  expect((await state(page)).released).toBe(0); expect((await state(page)).ammo).toBe(3);
  await page.mouse.move(600,450);
  const before=await state(page);
  await page.mouse.move(640,450);await page.waitForTimeout(80);
  expect((await state(page)).yaw-before.yaw).toBeCloseTo(.12,2);
  expect((await state(page)).standardCameraInputs).toEqual([]);
  await page.keyboard.press('Escape');await expect(page.locator('#capture')).toBeVisible();
  expect((await state(page)).input.locked).toBe(false);
  const unlocked=await state(page);await page.mouse.move(680,450);expect((await state(page)).yaw).toBe(unlocked.yaw);
  await enter(page);expect((await state(page)).released).toBe(0);
  await page.keyboard.press('Escape');expect(errors).toEqual([]);
});

test('physical WASD, follow camera, blocked arsenal, edge fall resets the test round', async ({page}) => {
  await ready(page);await enter(page);const start=await state(page);
  await page.keyboard.down('KeyW');await page.waitForTimeout(400);await page.keyboard.up('KeyW');
  expect((await state(page)).pos.z).toBeGreaterThan(start.pos.z+1);
  expect((await state(page)).camera[2]).toBeGreaterThan(start.camera[2]+1);
  await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyD',key:'в'})));
  await page.waitForTimeout(250);
  await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyD',key:'в'})));
  expect((await state(page)).pos.x).toBeGreaterThan(.6);
  await place(page,0,-27);
  await page.keyboard.down('KeyS');await page.waitForTimeout(800);await page.keyboard.up('KeyS');
  expect((await state(page)).pos.z).toBeGreaterThanOrEqual(-28.65);expect((await state(page)).phase).toBe('playing');
  await place(page,12.3,-15);
  await page.keyboard.down('KeyD');await page.waitForTimeout(220);await page.keyboard.up('KeyD');
  expect((await state(page)).phase).toBe('falling');
  await expect.poll(async()=>(await state(page)).round).toBe(2);
  expect((await state(page)).pos.z).toBeCloseTo(-15.6);expect((await state(page)).ammo).toBe(3);
});

test('Pointer Lock unavailable: explicit drag fallback has an accurate hint and no duplicate camera input', async ({page}) => {
  await page.addInitScript(()=>{HTMLCanvasElement.prototype.requestPointerLock=()=>Promise.reject(new Error('test: pointer lock unavailable'));});
  await ready(page);await page.locator('#capture').click();
  await expect.poll(async()=>(await state(page)).input.fallback).toBe(true);
  await expect(page.locator('#input-hint')).toContainText('Alt');
  const start=await state(page);await page.keyboard.down('KeyW');await page.waitForTimeout(300);await page.keyboard.up('KeyW');expect((await state(page)).pos.z).toBeGreaterThan(start.pos.z+.7);
  const before=await state(page);await page.keyboard.down('Alt');await page.mouse.move(550,450);await page.mouse.down();await page.mouse.move(590,450);await page.mouse.up();await page.keyboard.up('Alt');
  expect((await state(page)).yaw-before.yaw).toBeCloseTo(.12,2);expect((await state(page)).ammo).toBe(3);
});
