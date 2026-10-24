import { defineConfig } from 'vite';
export default defineConfig({server:{host:'0.0.0.0',port:5173,strictPort:true,proxy:{'/net':{target:`http://127.0.0.1:${process.env.TITANS_SERVER_PORT??2567}`,ws:true,rewrite:path=>path.replace(/^\/net/,'')}}}});
