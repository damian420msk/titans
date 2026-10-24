import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'tests/browser', timeout:30000, workers:1,
  use:{channel:'chromium',baseURL:'http://127.0.0.1:5173', viewport:{width:1440,height:900},launchOptions:{args:['--use-angle=swiftshader','--enable-webgl']}},
  webServer:{command:'npm run dev',url:'http://127.0.0.1:5173',reuseExistingServer:true,timeout:30000}
});
