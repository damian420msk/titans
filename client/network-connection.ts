import {Client,type Room} from '@colyseus/sdk';
import {DuelState} from '../shared/net-schema';

export const multiplayerClient=new Client(import.meta.env.VITE_SERVER_URL||new URL('/net',location.href).toString());
let early:Promise<Room<any,DuelState>>|null=null;
/** Reserve the existing seat before expensive WebGL initialisation on a page reload. */
export function reconnectBeforeGraphics(){
  let token:string|null=null;try{token=sessionStorage.getItem('titans.reconnect');}catch{/* Optional storage. */}
  if(token){early=multiplayerClient.reconnect<DuelState>(token,DuelState).then(room=>{try{sessionStorage.setItem('titans.reconnect',room.reconnectionToken);}catch{/* Optional storage. */}return room;});}
  return early;
}
export function consumeEarlyReconnection(){const result=early;early=null;return result;}
await reconnectBeforeGraphics()?.catch(()=>{});
