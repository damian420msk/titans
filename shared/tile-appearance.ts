import type { Cell, Side } from './world.ts';
export const APPEARANCE_VERSION = 1;
export const VARIANTS = ['A', 'B', 'C'] as const;
export type Variant = typeof VARIANTS[number];
// Version 1: unsigned 32-bit avalanche, canonical global side/row/column.
// Independent salts for variant and quarter-turn. Reject UINT_MAX before modulo 3.
const mix = (value:number) => { value=Math.imul(value^(value>>>16),0x7feb352d);value=Math.imul(value^(value>>>15),0x846ca68b);return (value^(value>>>16))>>>0; };
export function tileAppearance(seed:number,side:Side,cell:Cell) {
  const key=mix((seed>>>0)^Math.imul(side+1,0x9e3779b1)^Math.imul(cell.z+1,0x85ebca6b)^Math.imul(cell.x+1,0xc2b2ae35));
  let value=mix(key^0xa341316c);while(value===0xffffffff)value=mix(value^0x6d2b79f5);
  return {variant:VARIANTS[value%3],rotation:(mix(key^0xc8013ea4)&3) as 0|1|2|3};
}
