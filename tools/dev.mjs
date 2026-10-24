import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
const ports=[Number(process.env.TITANS_SERVER_PORT??2567),5173];
for(const port of ports){await new Promise((resolve,reject)=>{const check=createServer();check.once('error',()=>reject(Error(`Порт ${port} занят. Остановите прежний сервер проекта и повторите npm run dev.`)));check.listen(port,'0.0.0.0',()=>check.close(resolve));});}
const children=[spawn(process.execPath,['--experimental-strip-types','server/index.ts'],{stdio:'inherit'}),spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','0.0.0.0','--port','5173','--strictPort'],{stdio:'inherit'})];
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;for(const c of children)c.kill();process.exitCode=code;}
for(const c of children)c.on('exit',code=>stop(code??1));
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
