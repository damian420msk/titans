import { validCell, type PrimaryContext } from './simulation.ts';
import type { Cell } from './world.ts';
type Base = { seq:number; round:number; epoch:number };
export type Command = Base & ({type:'move';dx:number;dz:number;yaw:number}|{type:'begin';kind:Exclude<PrimaryContext,null>}|{type:'release';target:Cell}|{type:'cancel'}|{type:'ready'});
export function validCommand(value:unknown): value is Command {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v=value as Record<string,unknown>;
  if (![v.seq,v.round,v.epoch].every(n=>Number.isSafeInteger(n)&&Number(n)>0&&Number(n)<0xffffffff)) return false;
  const fields:Record<string,string[]>={move:['dx','dz','yaw'],begin:['kind'],release:['target'],cancel:[],ready:[]};
  if(typeof v.type!=='string'||!Object.hasOwn(fields,v.type)||Object.keys(v).some(k=>!['seq','round','epoch','type',...fields[v.type as string]].includes(k)))return false;
  if(v.type==='move')return [v.dx,v.dz,v.yaw].every(n=>typeof n==='number'&&Number.isFinite(n))&&Math.hypot(Number(v.dx),Number(v.dz))<=1.000001&&Math.abs(Number(v.yaw))<=Math.PI+.001;
  if(v.type==='begin')return v.kind==='shot'||v.kind==='refill';
  if(v.type==='release')return !!v.target&&typeof v.target==='object'&&Object.keys(v.target).every(k=>k==='x'||k==='z')&&validCell(v.target as Cell);
  return true;
}
