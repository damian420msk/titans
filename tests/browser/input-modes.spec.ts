import { test, expect } from '@playwright/test';
import { state, ready, centre, aim } from './helpers';

test('window size does not select input; explicit preference persists; Auto remains Auto', async ({page}) => {
  await ready(page);expect((await state(page)).input.effective).toBe('desktop');
  await page.setViewportSize({width:640,height:390});expect((await state(page)).input.effective).toBe('desktop');await expect(page.locator('#stick')).toBeHidden();
  await page.selectOption('#input-mode','touch',{force:true});await page.reload();await expect.poll(async()=>(await state(page))?.input.preference).toBe('touch');
  expect((await state(page)).input.effective).toBe('touch');
  await page.selectOption('#input-mode','desktop',{force:true});await page.reload();await expect.poll(async()=>(await state(page))?.input.preference).toBe('desktop');
  await page.selectOption('#input-mode','auto',{force:true});await page.reload();await expect.poll(async()=>(await state(page))?.input.preference).toBe('auto');
  expect(await page.evaluate(()=>localStorage.getItem('titans.input'))).toBe('auto');
  await page.mouse.move(500,150);expect((await state(page)).input.effective).toBe('desktop');
  await page.locator('#sensitivity').evaluate((el:any)=>{el.value='1.3';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.reload();await expect.poll(async()=>(await state(page))?.input.sensitivity).toBe(1.3);
});

test('Auto reacts to deliberate touch and game keys, not hover, and suppresses compatible mouse input', async ({browser}) => {
  const context=await browser.newContext({viewport:{width:1000,height:600},hasTouch:true});const page=await context.newPage();await ready(page);
  await page.selectOption('#input-mode','auto',{force:true});
  // Use a real touch to establish intent independently of the media-query initial guess.
  await page.touchscreen.tap(700,180);expect((await state(page)).input.effective).toBe('touch');
  await page.mouse.move(300,200);expect((await state(page)).input.effective).toBe('touch');
  await page.mouse.click(300,200);expect((await state(page)).input.effective).toBe('touch');
  await page.keyboard.press('KeyW');expect((await state(page)).input.effective).toBe('desktop');
  expect((await state(page)).input.preference).toBe('auto');
  await page.reload();await expect.poll(async()=>(await state(page))?.input.preference).toBe('auto');await context.close();
});
