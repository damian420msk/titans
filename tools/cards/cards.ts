// Shop card renderer: every titan in the same pose, camera and light, over a backdrop coloured by rarity.
// Not gameplay code. Open /tools/cards/cards.html?titan=atlas, screenshot #card (360×450) into public/art/ui/shop/titan_<id>.webp.
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF/2.0';
import { TITANS, type TitanId } from '../../shared/titans';

const q = new URLSearchParams(location.search);
const id = (q.get('titan') ?? 'novice') as TitanId;
const CLIP = q.get('clip') ?? 'Victory', POSE_S = +(q.get('t') ?? 4.5); // this clip at this second: the same frame for everyone
// backdrop by rarity (ROSTER.md): starter bronze, common teal, rare violet, legendary gold
const RARITY: Record<string, [string, string, string]> = {
  starter: ['#e6b48a', '#8a5a7c', '#3a2a5a'], common: ['#9ff0e6', '#3f8fb0', '#23305e'],
  rare: ['#e3b8ff', '#7a4fc4', '#2a1d5e'], legendary: ['#fff1a8', '#d7902c', '#5a2a3a'],
};
const RANK: Record<string, string> = { novice: 'starter', atlas: 'common', oceanus: 'common', hyperion: 'rare', prometheus: 'rare', kronos: 'legendary' };
const [glow, mid, dark] = RARITY[RANK[id] ?? 'common']!;
const card = document.getElementById('card')!; card.style.setProperty('--glow', glow); card.style.setProperty('--mid', mid); card.style.setProperty('--dark', dark);

const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, alpha: true });
engine.setHardwareScalingLevel(.5); // 720×900 backbuffer for a crisp 360×450 card
const scene = new Scene(engine); scene.clearColor = new Color4(0, 0, 0, 0);
const cam = new FreeCamera('cam', new Vector3(0, 2, 10), scene);
const sky = new HemisphericLight('sky', new Vector3(0, 1, 0), scene); sky.intensity = .85; sky.groundColor = new Color3(.45, .4, .55);
const key = new DirectionalLight('key', new Vector3(.5, -.6, -1), scene); key.intensity = 1.6; key.diffuse = new Color3(1, .93, .82);
const rim = new DirectionalLight('rim', new Vector3(-.4, -.2, 1), scene); rim.intensity = 1.1; rim.diffuse = new Color3(.75, .85, 1);

const file = TITANS[id]?.file ?? TITANS.novice.file;
const c = await LoadAssetContainerAsync(import.meta.env.BASE_URL + file, scene);
c.addAllToScene();
for (const g of c.animationGroups) g.stop();
const idle = c.animationGroups.find(g => g.name === CLIP);
if (idle) { idle.start(false); idle.goToFrame(POSE_S * 60); idle.pause(); }
scene.render();
// frame the figure: fit its height into the card with some headroom, a slightly low, 3/4 front view
let min = new Vector3(1e9, 1e9, 1e9), max = new Vector3(-1e9, -1e9, -1e9);
for (const m of c.meshes) { if (!m.getTotalVertices()) continue; m.refreshBoundingInfo({ applySkeleton: true }); const b = m.getBoundingInfo().boundingBox; min = Vector3.Minimize(min, b.minimumWorld); max = Vector3.Maximize(max, b.maximumWorld); }
// one fixed frame for all (every titan is 3.2 m): same scale on every card, room for the raised fist
const h = 4.15, ctr = new Vector3((min.x + max.x) / 2, 1.9, (min.z + max.z) / 2), fov = 30 * Math.PI / 180, dist = h * .62 / Math.tan(fov / 2);
const yaw = +(q.get('yaw') ?? -35) * Math.PI / 180, front = +(q.get('front') ?? 1); // front: which way the model faces along z
cam.position.set(ctr.x + Math.sin(yaw) * dist, ctr.y + h * .02, ctr.z + front * Math.cos(yaw) * dist);
cam.fov = fov; cam.minZ = .05; cam.setTarget(new Vector3(ctr.x, ctr.y - h * .02, ctr.z));
key.direction = cam.getTarget().subtract(cam.position).normalize().add(new Vector3(.35, -.45, 0));
rim.direction = new Vector3(cam.position.x - ctr.x, -.3 * dist, cam.position.z - ctr.z).normalize(); // from behind the figure, towards the camera
// a few frames for textures, then freeze the picture into an <img> (page screenshots do not always catch a transparent WebGL canvas)
for (let i = 0; i < 5; i++) { scene.render(); await new Promise(r => setTimeout(r, 50)); }
const img = document.createElement('img'); img.src = canvas.toDataURL('image/png'); img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
await new Promise(r => { img.onload = r; }); card.appendChild(img); canvas.remove(); engine.dispose();
Object.assign(window, { ready: true, dbg: { h, ctr: ctr.asArray(), cam: cam.position.asArray(), n: c.meshes.length, w: engine.getRenderWidth(), hh: engine.getRenderHeight() } });
