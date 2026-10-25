import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { TitanRig, CLIP, RELEASE_FROM, type Clip } from '../client/play/rig.ts';

const BONES = ['Hips', 'LeftLeg', 'LeftArm', 'RightArm'];
const mark = (a: number) => Quaternion.RotationAxis(Vector3.Up(), a);
/** A clip that holds every bone at the given yaw, so the pose of a bone tells which clip drives it. */
function flat(name: string, len: number, yaw: number): Clip {
  const tracks = new Map<string, { q: { t: number[]; v: Quaternion[]; step: boolean } }>();
  for (const b of BONES) tracks.set(b, { q: { t: [0, len], v: [mark(yaw), mark(yaw)], step: false } });
  return { name, len, tracks };
}
const nodes = () => new Map(BONES.map(n => [n, { name: n, rotationQuaternion: new Quaternion(), position: new Vector3(), scaling: new Vector3(1, 1, 1), rotation: new Vector3() } as any]));
function make() {
  const n = nodes();
  const clips = new Map<string, Clip>([[CLIP.idle, flat('Idle', 4, 0)], [CLIP.walk, flat('Walk', 1.033, .5)], [CLIP.windup, flat('W', 1.2, 1)], [CLIP.hold, flat('H', 1, 1)], [CLIP.release, flat('R', 1, 1.2)]]);
  return { rig: new TitanRig(n, clips), n };
}
const yawOf = (q: Quaternion) => 2 * Math.atan2(q.y, q.w);
const run = (rig: TitanRig, secs: number, move: boolean, charge: boolean, free = true) => { for (let i = 0; i < Math.round(secs * 60); i++) { rig.update(1 / 60, move, 1, charge, free); rig.apply(); } };

test('rig: standing charge goes windup -> hold (loops) and the throw layer takes over the body', () => {
  const { rig, n } = make();
  run(rig, .3, false, false); assert.equal(rig.state, 'loco'); assert.equal(rig.layer, 0);
  run(rig, .2, false, true); assert.equal(rig.state, 'windup');
  run(rig, 1.2, false, true); assert.equal(rig.state, 'hold');
  run(rig, 2.5, false, true); assert.equal(rig.state, 'hold');
  assert.ok(rig.layer > .95);
  assert.ok(Math.abs(yawOf(n.get('LeftArm').rotationQuaternion) - 1) < .05, 'arm follows the throw clip');
  assert.ok(Math.abs(yawOf(n.get('LeftLeg').rotationQuaternion) - 1) < .05, 'standing: legs follow the throw clip too');
});

test('rig: charging on the move keeps the legs on Walk and the torso on the throw clips', () => {
  const { rig, n } = make();
  run(rig, 1.5, true, true);
  assert.ok(Math.abs(yawOf(n.get('LeftArm').rotationQuaternion) - 1) < .06, 'arm: throw clip');
  assert.ok(Math.abs(yawOf(n.get('LeftLeg').rotationQuaternion) - .5) < .06, 'leg: walk clip');
});

test('rig: release plays the release clip, then returns to idle and the layer fades out', () => {
  const { rig } = make();
  run(rig, 1.5, false, true); rig.release(); assert.equal(rig.state, 'release');
  run(rig, .02, false, false); assert.equal(rig.state, 'release');
  run(rig, 1 - RELEASE_FROM + .1, false, false); assert.equal(rig.state, 'loco');
  run(rig, .6, false, false); assert.equal(rig.layer, 0);
});

test('rig: a release event that arrives a frame after the charge ended still gets the release clip', () => {
  const { rig } = make();
  run(rig, 1.5, false, true);
  run(rig, 1 / 60, false, false); assert.equal(rig.state, 'hold', 'one frame without a charge keeps the pose');
  rig.release(); assert.equal(rig.state, 'release');
});

test('rig: a cancelled charge (no release) goes back to idle after a short grace and the layer fades out', () => {
  const { rig } = make();
  run(rig, 1.5, false, true);
  run(rig, .2, false, false); assert.equal(rig.state, 'loco');
  run(rig, .6, false, false); assert.equal(rig.layer, 0);
});

test('rig: a quick tap (release during the windup) crosses over to the release clip, not the hold clip', () => {
  const { rig } = make();
  run(rig, .3, false, true); assert.equal(rig.state, 'windup');
  rig.release(); assert.equal(rig.state, 'release');
  run(rig, .01, false, false); assert.equal(rig.state, 'release');
});

test('rig: no throw pose while falling or knocked down, and a second release event does not restart the clip', () => {
  const { rig } = make();
  run(rig, .5, false, true, false); assert.equal(rig.state, 'loco');
  const r = make().rig; run(r, 1.3, false, true); r.release(); run(r, .1, false, false); r.release(); run(r, .05, false, false);
  assert.equal(r.state, 'release');
});
