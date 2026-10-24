import { schema, t, type SchemaType } from '@colyseus/schema';
// Public fields only; selected cell, camera pitch and pre-release aim are never synchronized.
export const PlayerState=schema({
  side:t.uint8().default(0),x:t.float64().default(0),z:t.float64().default(0),y:t.float64().default(0),yaw:t.float32().default(0),
  ammo:t.uint8().default(3),cooldown:t.float32().default(0),refill:t.float32().default(0),falling:t.boolean().default(false),
  connected:t.boolean().default(true),ready:t.boolean().default(false),ackMove:t.uint32().default(0),ackCommand:t.uint32().default(0)
},'TitansPlayer');
export type PlayerState=SchemaType<typeof PlayerState>;
export const ShotState=schema({id:t.uint32().default(0),owner:t.uint8().default(0),x:t.uint8().default(0),z:t.uint8().default(0),startX:t.float64().default(0),startZ:t.float64().default(0),elapsed:t.float32().default(0)},'TitansShot');
export type ShotState=SchemaType<typeof ShotState>;
export const DuelState=schema({
  visualSeed:t.uint32().default(0),visualVersion:t.uint8().default(1),
  status:t.string().default('waiting'),reason:t.string().default(''),countdown:t.float32().default(0),round:t.uint32().default(1),epoch:t.uint32().default(1),
  tick:t.uint32().default(0),tickRate:t.uint8().default(30),snapshotRate:t.uint8().default(20),phase:t.string().default('playing'),message:t.string().default(''),released:t.uint32().default(0),
  players:t.map(PlayerState),floors:t.array('int8'),shots:t.map(ShotState)
},'TitansDuel');
export type DuelState=SchemaType<typeof DuelState>;
