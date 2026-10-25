// Pure aiming helpers (no DOM, no Babylon) so they can be tested.
export type Sample = { t: number; x: number; y: number };
export const LIFT_MS = 90;

/** Finger offset to aim with when the finger lifts at `now`: the last sample at least LIFT_MS old; if the whole touch was shorter, the first sample. */
export function liftOff(hist: Sample[], last: { x: number; y: number }, now: number): { x: number; y: number } {
  if (!hist.length) return { ...last };
  let pick: Sample | null = null;
  for (const s of hist) if (now - s.t >= LIFT_MS) pick = s;
  if (!pick) return { x: hist[0].x, y: hist[0].y };
  return { x: pick.x, y: pick.y };
}

/** Relative (touch) aim: anchor cell moved by a finger offset in px; `px` is finger px per cell. Clamped to the island. */
export function touchAim(anchor: { x: number; z: number }, d: { x: number; y: number }, pxX: number, pxZ: number, w: number, h: number) {
  return {
    x: Math.max(0, Math.min(w - 1, Math.round(anchor.x - d.x / pxX))),
    z: Math.max(0, Math.min(h - 1, Math.round(anchor.z + d.y / pxZ))),
  };
}

export type Pt = { x: number; z: number };
export const MOUSE_CATCHUP_PX = 220;

/** Mouse aiming while the camera pulls out. `prev` is last frame's aimed world point, `pAtLast` / `pNow` are the world points under the
 *  pointer's previous and current screen position in the *current* camera, `moved` is the pointer travel in px since last frame.
 *  The offset between aimed point and pointer is kept through camera motion (so pulling out never changes the target) and fades
 *  out as the mouse travels, so the aim catches up with the cursor. */
export function mouseAim(prev: Pt | null, pAtLast: Pt, pNow: Pt, moved: number): Pt {
  if (!prev) return { ...pNow };
  const k = Math.exp(-moved / MOUSE_CATCHUP_PX);
  return { x: pNow.x + (prev.x - pAtLast.x) * k, z: pNow.z + (prev.z - pAtLast.z) * k };
}
