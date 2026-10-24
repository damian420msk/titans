import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import type { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import type { Actor } from '../shared/simulation';
import { cellAt, rules, type Side } from '../shared/world';
import type { Display } from './display';

export const ENV_AIM_TOP=.24;
// Preserve ART-005's initial world ray while moving its screen position from 13% to 24%.
export const ENV_START_PITCH=35*Math.PI/180+Math.atan((1-2*ENV_AIM_TOP)*Math.tan(55*Math.PI/360))-Math.atan((1-2*.13)*Math.tan(55*Math.PI/360));
const approach = (value: number, target: number, step: number) => value + Math.sign(target - value) * Math.min(Math.abs(target - value), step);
export class CameraRig {
  yaw = 0;
  pitch = .20;
  mode: 'env' | 'base' | 'closer' | 'art35' | 'art42' | 'art48' = 'env';
  attackBlend = 0;
  private modeMix = 0;
  shape = { distance: rules.camera.distance_m, height: rules.camera.height_above_floor_m, fov: rules.camera.fov_normal_degrees * Math.PI / 180, aimTop: .42 };
  constructor(readonly camera: FreeCamera, private scene: Scene, private display: Display, private actor: () => Actor, cancelInput: () => void, private targetSide:()=>Side=()=>1) {
    const select = document.querySelector<HTMLSelectElement>('#camera-mode')!;
    try { const stored=localStorage.getItem('titans.camera.env006');if(['env','base','closer','art35','art42','art48'].includes(stored??''))this.mode=stored as typeof this.mode; } catch { /* Optional storage. */ }
    this.modeMix = this.mode === 'closer' ? 1 : 0;
    if (this.modeMix) { this.pitch = .30; this.shape.fov = rules.camera.fov_aim_degrees * Math.PI / 180; this.shape.aimTop = .32; }
    if(this.arenaMode){this.pitch=this.initialPitch();this.shape={distance:9,height:10,fov:55*Math.PI/180,aimTop:ENV_AIM_TOP};}
    select.value = this.mode;
    select.addEventListener('change', () => { cancelInput(); this.mode = select.value as typeof this.mode;this.pitch=this.initialPitch(); try { localStorage.setItem('titans.camera.env006', this.mode); } catch { /* Optional storage. */ } });
    this.pose();
  }

  private get arenaMode(){return this.mode==='env'||this.mode.startsWith('art');}
  private initialPitch(){return this.mode==='env'?ENV_START_PITCH:this.mode.startsWith('art')?Number(this.mode.slice(3))*Math.PI/180:this.mode==='closer'?.30:.20;}

  look(dx: number, dy: number) { this.yaw += dx * .003; this.pitch = Math.max(-.23, Math.min(1.10, this.pitch + dy * .002)); }

  private pose() {
    const a = this.actor();
    this.display.root.style.setProperty('--aim-top', `${this.shape.aimTop * 100}%`);
    this.camera.fov = this.shape.fov;
    this.camera.position.set(a.pos.x - Math.sin(this.yaw) * this.shape.distance, a.y + this.shape.height, a.pos.z - Math.cos(this.yaw) * this.shape.distance);
    this.camera.setTarget(this.camera.position.add(new Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch))));
    this.camera.getViewMatrix(true); this.camera.getProjectionMatrix(true); this.scene.updateTransformMatrix(true);
  }

  read() {
    this.pose();
    const point = this.display.aimPoint();
    const ray = this.scene.createPickingRay(point.api.x, point.api.y, Matrix.Identity(), this.camera);
    const t = ray.direction.y < -.0001 ? -ray.origin.y / ray.direction.y : -1;
    const hit = t > 0 ? { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t } : null;
    return { point, ray, hit };
  }

  update(dt: number, preparing: boolean) {
    const old = this.read();
    const previous = { ...this.shape };
    const rate = dt / rules.camera.aim_transition_s;
    this.attackBlend = approach(this.attackBlend, preparing ? 1 : 0, rate);
    this.modeMix = approach(this.modeMix, this.mode === 'closer' ? 1 : 0, rate);
    // Mobile attack framing also raises and moves the camera back: it is not only an FOV change.
    const zoom = Math.max(this.modeMix, this.attackBlend);
    this.shape = this.arenaMode ? {distance:9+.4*this.attackBlend,height:10+.5*this.attackBlend,fov:(55-3*this.attackBlend)*Math.PI/180,aimTop:ENV_AIM_TOP} : {
      distance: rules.camera.distance_m + this.attackBlend,
      height: rules.camera.height_above_floor_m + 1.2 * this.attackBlend,
      fov: (rules.camera.fov_normal_degrees + (rules.camera.fov_aim_degrees - rules.camera.fov_normal_degrees) * zoom) * Math.PI / 180,
      aimTop: (.42 - .10 * this.modeMix) * (1 - this.attackBlend) + .30 * this.attackBlend
    };
    const changed = Object.keys(previous).some(k => Math.abs(previous[k as keyof typeof previous] - this.shape[k as keyof typeof previous]) > 1e-8);
    if (changed && old.hit && cellAt(old.hit, this.targetSide())) {
      // Keep the actual world point under the actual DOM reticle. A small projection solve
      // also handles an offset canvas and fractional viewport sizes, without grid snapping.
      const point = new Vector3(old.hit.x, 0, old.hit.z), epsilon = .0001;
      const project = () => { this.pose(); return Vector3.Project(point, Matrix.Identity(), this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(this.display.engine.getRenderWidth(), this.display.engine.getRenderHeight())); };
      for (let i = 0; i < 3; i++) {
        const a = project(), aim = this.display.aimPoint().render;
        const ex = a.x - aim.x, ey = a.y - aim.y;
        if (Math.hypot(ex, ey) < .005) break;
        const yaw = this.yaw, pitch = this.pitch;
        this.yaw = yaw + epsilon; const b = project(); this.yaw = yaw;
        this.pitch = pitch + epsilon; const c = project(); this.pitch = pitch;
        const jx = (b.x - a.x) / epsilon, jy = (b.y - a.y) / epsilon, kx = (c.x - a.x) / epsilon, ky = (c.y - a.y) / epsilon;
        const det = jx * ky - jy * kx;
        if (!Number.isFinite(det) || Math.abs(det) < 1e-6) break;
        this.yaw -= (ky * ex - kx * ey) / det;
        this.pitch = Math.max(-.23, Math.min(1.10, this.pitch - (jx * ey - jy * ex) / det));
      }
    }
    this.pose();
  }

  resetFacing(side:Side=0) { this.yaw = side===0?0:Math.PI; this.pitch = this.initialPitch(); }
}
