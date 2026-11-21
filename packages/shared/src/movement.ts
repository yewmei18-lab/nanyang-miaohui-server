import { GAME_CONFIG } from './config.ts';
import { COLLIDERS, insideWalk } from './world3d.ts';
import type { Box } from './world.ts';

export interface MoveInput { seq: number; mx: number; mz: number; run: boolean }
export interface MoveState { x: number; z: number; yaw: number; speed: number }

/** 夹紧输入：方向长度 ≤ 1，非数字归零 */
export function sanitizeMove(mx: unknown, mz: unknown): { mx: number; mz: number } {
  let x = typeof mx === 'number' && Number.isFinite(mx) ? mx : 0;
  let z = typeof mz === 'number' && Number.isFinite(mz) ? mz : 0;
  const len = Math.hypot(x, z);
  if (len > 1) { x /= len; z /= len; }
  return { mx: x, mz: z };
}

/** 圆 vs AABB 推出 */
export function resolveCollisions(x: number, z: number, r = GAME_CONFIG.movement.playerRadius, boxes: Box[] = COLLIDERS): { x: number; z: number } {
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const b of boxes) {
      const cx = Math.max(b.minX, Math.min(x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      const dx = x - cx; const dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r; z = cz + (dz / d) * r;
      } else {
        // 圆心在盒内：沿最短方向推出
        const pushes = [x - b.minX + r, b.maxX - x + r, z - b.minZ + r, b.maxZ - z + r];
        const m = Math.min(...pushes);
        if (m === pushes[0]) x = b.minX - r; else if (m === pushes[1]) x = b.maxX + r;
        else if (m === pushes[2]) z = b.minZ - r; else z = b.maxZ + r;
      }
      moved = true;
    }
    if (!moved) break;
  }
  return { x, z };
}

export function isBlocked(x: number, z: number, r = GAME_CONFIG.movement.playerRadius): boolean {
  for (const b of COLLIDERS) {
    const cx = Math.max(b.minX, Math.min(x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
    if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
  }
  return false;
}

/** 固定步长移动：客户端预测与服务器权威模拟共用 */
export function stepMove(s: MoveState, input: { mx: number; mz: number; run: boolean }, dt = GAME_CONFIG.movement.inputDt): MoveState {
  const { mx, mz } = sanitizeMove(input.mx, input.mz);
  const mag = Math.hypot(mx, mz);
  if (mag < 0.05) return { x: s.x, z: s.z, yaw: s.yaw, speed: 0 };
  const speed = (input.run ? GAME_CONFIG.movement.runSpeed : GAME_CONFIG.movement.walkSpeed) * Math.min(1, mag);
  const nx = s.x + mx / mag * speed * dt;
  const nz = s.z + mz / mag * speed * dt;
  let r = resolveCollisions(nx, nz);
  // 画面模式：只能在石板街范围内走（碰到边缘时沿边滑动）
  if (!insideWalk(r.x, r.z)) {
    if (insideWalk(r.x, s.z)) r = { x: r.x, z: s.z };
    else if (insideWalk(s.x, r.z)) r = { x: s.x, z: r.z };
    else r = { x: s.x, z: s.z };
  }
  const actual = Math.hypot(r.x - s.x, r.z - s.z) / dt;
  return { x: r.x, z: r.z, yaw: Math.atan2(mx, mz), speed: actual };
}

/** 直线自动走向目标（入座寻路的样板实现：只用于院落内近距离，路径被挡则返回 blocked） */
export function stepToward(s: MoveState, tx: number, tz: number, dt: number, speed = GAME_CONFIG.movement.walkSpeed, boxes: Box[] = COLLIDERS): { state: MoveState; arrived: boolean; blocked: boolean } {
  const dx = tx - s.x; const dz = tz - s.z; const d = Math.hypot(dx, dz);
  if (d < 0.03) return { state: { ...s, x: tx, z: tz, speed: 0 }, arrived: true, blocked: false };
  const stepLen = Math.min(d, speed * dt);
  const nx = s.x + dx / d * stepLen; const nz = s.z + dz / d * stepLen;
  const r = resolveCollisions(nx, nz, undefined, boxes);
  const progressed = Math.hypot(r.x - s.x, r.z - s.z);
  return { state: { x: r.x, z: r.z, yaw: Math.atan2(dx, dz), speed: progressed / dt }, arrived: false, blocked: progressed < stepLen * 0.2 };
}
