/**
 * 画面模式（用户确认的第一画面 references/11-first-scene-final.png 作为背景）。
 * 隐形镜头按原图透视反算：高 3.65m、俯角约 7.75°、垂直视角 70°，原图坐标 941×1672。
 * 地面坐标：镜头在 (0, 3.65, 0) 朝 +Z；与原图像素一一对应（见 pictureToGround）。
 * 其余导出沿用 world.ts（3D 模式的旧布局只作参考，不再使用）。
 */
export * from './world.ts';
import type { Box, SeatDef } from './world.ts';

export const WORLD_VERSION = 'picture-main-street-1';
export const PICTURE = {
  image: 'scenes/street_afternoon.jpg',
  /** 中段到天后宫的高清局部（原图像素范围 u0,v0,u1,v1），镜头走近时用它保持清晰 */
  detail: { image: 'scenes/street_afternoon_detail.jpg', px: [140, 380, 800, 1040] as [number, number, number, number] },
  width: 941, height: 1672,
  focalPx: 1194, camHeight: 3.65, pitch: 0.13526608554124497, fov: 1.2216767489213551,
};

/** 原图像素 → 地面坐标（米） */
export function pictureToGround(u: number, v: number): { x: number; z: number } {
  const { focalPx: f, camHeight: h, pitch: th } = PICTURE;
  const xc = (u - PICTURE.width / 2) / f, yc = -(v - PICTURE.height / 2) / f;
  const dy = yc * Math.cos(th) - Math.sin(th), dz = yc * Math.sin(th) + Math.cos(th);
  const t = -h / dy;
  return { x: t * xc, z: t * dz };
}

export const SPAWN = { ...pictureToGround(470, 1480), radius: 0.4 };

/** 可走范围（原图里的石板街），像素多边形 → 地面多边形 */
const POLY_PX: Array<[number, number]> = [
  [0, 1672], [150, 1290], [230, 1200], [300, 1095], [345, 1030], [420, 900], [440, 840],
  [560, 835], [620, 880], [690, 1000], [730, 1150], [800, 1290], [941, 1420], [941, 1672],
];
export const WALK_POLY = POLY_PX.map(([u, v]) => pictureToGround(u, v));

/** 三座砖台（原图里只有三座）：蒲团像素位置、砖台像素位置 */
const SEAT_PX: Array<{ cushion: [number, number]; station: [number, number] }> = [
  // 2026-11-22：只留两个位，其他人排队（一局 10 秒）
  { cushion: [176, 1222], station: [100, 1160] },
  { cushion: [304, 1036], station: [250, 1010] },
];
export const SEATS: SeatDef[] = SEAT_PX.map((s, id) => {
  const c = pictureToGround(...s.cushion), st = pictureToGround(...s.station);
  const yaw = Math.atan2(st.x - c.x, st.z - c.z);
  return {
    id,
    station: { x: st.x, z: st.z, w: 0.8, d: 0.8, h: 0.5 },
    seat: { x: c.x, z: c.z, yaw },
    approach: { x: c.x + 0.85, z: c.z - 0.2 },
    hit: { x: (st.x + c.x * 0.4) / 1.4, y: 0.5, z: (st.z + c.z * 0.4) / 1.4 },
  };
});

export const COLLIDERS: Box[] = SEATS.map((s) => ({
  id: `station_${s.id}`, kind: 'station', minX: s.station.x - 0.25, maxX: s.station.x + 0.25, minZ: s.station.z - 0.25, maxZ: s.station.z + 0.25, height: 0.5,
}));

export function insideWalk(x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = WALK_POLY.length - 1; i < WALK_POLY.length; j = i++) {
    const a = WALK_POLY[i], b = WALK_POLY[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
