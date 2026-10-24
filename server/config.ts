function integer(name:string,fallback:number,min:number,max:number){const n=Number(process.env[name]??fallback);if(!Number.isInteger(n)||n<min||n>max)throw Error(`${name}: требуется целое ${min}…${max}`);return n;}
export const PORT=integer('TITANS_SERVER_PORT',2567,1024,65535);
export const TICK_RATE=integer('TITANS_TICK_RATE',30,15,60);
export const SNAPSHOT_RATE=integer('TITANS_SNAPSHOT_RATE',20,5,60);
export const LATENCY_MS=integer('TITANS_TEST_LATENCY_MS',0,0,2000);
