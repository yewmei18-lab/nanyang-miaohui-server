/**
 * 立体庙会街布局（3D 版）。客户端渲染与服务器移动/座位共用这份数据；修改必须提升 WORLD_VERSION。
 * 坐标：面向 +Z（天后宫）时 +X 在右手边；单位米。
 *
 *   天后宫（z≈26 起台阶），台阶前：香炉（3 个拜拜位）+ 功德箱
 *   ├─ 东侧：木鱼禅院（开放式木殿，8 张矮桌 + 木鱼 + 蒲团）
 *   └─ 西侧：洗衰运（花园里 4 个下沉浴池，每池 2 个位置，有台阶走下去）
 *   主街（两排店屋之间整条都能走）：左边打小人摊（婆婆）+ 三座砖台、MAMAK + 3 张四人桌；右边姻缘树、月老庙、路牌花坛
 */
export * from './world_picture.ts';
import { SEATS as VILLAIN_SEATS, SPAWN as PICTURE_SPAWN } from './world_picture.ts';
import type { Box, SeatDef } from './world.ts';

export const WORLD_VERSION = 'street-3d-2';
export const SPAWN = PICTURE_SPAWN;

export type SeatKind = 'villain' | 'woodfish' | 'bath' | 'mamak' | 'pray' | 'fortune' | 'bazi';
export interface Seat3D extends SeatDef { kind: SeatKind; zone: number; /** 属于第几张桌（MAMAK） */ table?: number }

/** 木鱼禅院：开放式木殿 */
export const ZEN_HALL = { minX: 8.8, maxX: 17.8, minZ: 22.6, maxZ: 35.4, altarX: 17.2 };
/** 洗衰运花园 */
export const BATH_GARDEN = { minX: -17.8, maxX: -8.4, minZ: 22.6, maxZ: 35.4 };
export const POOLS = [
  { x: -14.6, z: 25.8 }, { x: -11.0, z: 28.4 }, { x: -14.6, z: 31.6 }, { x: -11.0, z: 33.4 },
];
export const POOL_R = 1.55;
/** 下沉浴池：水面高度、池底高度；池边往里 0.55m 是台阶（一路走下去） */
export const POOL_WATER_Y = -0.1;
export const POOL_FLOOR_Y = -0.5;
const POOL_STEP_W = 0.55;
/** 姻缘树：站到树前就可以写/看姻缘牌 */
export const WISH_TREE = { x: 5.6, z: 14.5, standX: 2.9, standZ: 14.5, radius: 2.4 };
/** 香炉、功德箱 */
export const CENSER = { x: 0.5, z: 23.2 };
export const DONATION_BOX = { x: 2.2, z: 23.0 };
/** MAMAK：店面 + 三张四人桌（模型自带 4 张红塑料凳，凳子在桌子的 4 个斜角，离桌心 0.61m） */
export const MAMAK_SHOP = { x: -4.6, z: 21.0, counterX: -3.3, counterZ: 21.2 };
export const MAMAK_TABLES = [
  { x: -1.5, z: 16.6, face: 1.445 }, { x: -1.5, z: 19.7, face: 1.445 }, { x: 2.0, z: 18.4, face: 1.445 },
];
export const MAMAK_TABLE_TOP_Y = 0.72;
export const MAMAK_STOOL_Y = 0.52;
/** 求签桌（天后宫前、功德箱右边）：签筒在桌上，站在桌前摇签 */
export const QIUQIAN = { x: 3.6, z: 23.45 };
/** 命理阁：入口右手边第二间店屋的骑楼下，师傅坐在桌后，客人坐小凳 */
export const MINGLI = { deskX: 5.85, z: 2.0, masterX: 6.27, stoolX: 5.3, stoolZ: 1.83, facadeX: 6.75 };
/** 打小人摊的婆婆：摊位北头，坐在蒲团上面向街，自己有一块砖台 */
export const POPO = { x: -3.3, z: 13.85, yaw: Math.PI / 2, brickX: -2.62 };
/** 今日小人榜木牌 */
export const BOARD = { x: -4.6, z: 14.35 };

let nextId = 0;
const villain: Seat3D[] = VILLAIN_SEATS.map((s) => ({ ...s, id: nextId++, kind: 'villain' as const, zone: 0 }));

// 木鱼禅院：两列四排矮桌，玩家坐在桌子西侧的蒲团上，面向东边佛台（+X）
const zenTables: Array<{ x: number; z: number }> = [];
for (const x of [11.6, 14.6]) for (const z of [25.4, 28.0, 30.6, 33.2]) zenTables.push({ x, z });
const woodfish: Seat3D[] = zenTables.map((t) => ({
  id: nextId++, kind: 'woodfish' as const, zone: 1,
  station: { x: t.x, z: t.z, w: 0.9, d: 0.6, h: 0.42 },
  seat: { x: t.x - 0.72, z: t.z, yaw: Math.PI / 2 },
  approach: { x: t.x - 1.45, z: t.z },
  hit: { x: t.x - 0.05, y: 0.55, z: t.z },
}));

// 洗衰运：每个池 2 个位置（池中心左右各 0.55m），从池边的台阶走下去
const bath: Seat3D[] = [];
for (const p of POOLS) {
  for (const side of [-1, 1]) {
    bath.push({
      id: nextId++, kind: 'bath', zone: 2,
      station: { x: p.x, z: p.z, w: POOL_R * 2, d: POOL_R * 2, h: 0 },
      seat: { x: p.x + side * 0.55, z: p.z, yaw: side < 0 ? Math.PI / 2 : -Math.PI / 2 },
      approach: { x: p.x + side * (POOL_R + 0.55), z: p.z },
      hit: { x: p.x, y: 0.3, z: p.z },
    });
  }
}

// MAMAK：每张桌 4 个凳子；坐下面向桌心
const mamak: Seat3D[] = [];
/** 桌子模型里 4 张凳子的实际位置（从模型量出来的：相对桌子朝向的角度、离桌心距离；不是均匀 90°） */
export const MAMAK_STOOLS = [{ a: 0.637, r: 0.545 }, { a: 2.333, r: 0.618 }, { a: -2.341, r: 0.61 }, { a: -0.639, r: 0.59 }];
MAMAK_TABLES.forEach((t, ti) => {
  for (const st of MAMAK_STOOLS) {
    const a = t.face + st.a;
    const sx = t.x + Math.sin(a) * st.r, sz = t.z + Math.cos(a) * st.r;
    mamak.push({
      id: nextId++, kind: 'mamak', zone: 3, table: ti,
      station: { x: t.x, z: t.z, w: 1.0, d: 1.0, h: MAMAK_TABLE_TOP_Y },
      seat: { x: sx, z: sz, yaw: a + Math.PI },
      approach: { x: t.x + Math.sin(a) * 1.3, z: t.z + Math.cos(a) * 1.3 },
      // Aneh 把点的东西放在桌上、这个人面前
      hit: { x: t.x + Math.sin(a) * 0.27, y: MAMAK_TABLE_TOP_Y, z: t.z + Math.cos(a) * 0.27 },
    });
  }
});

// 香炉前 3 个拜拜位（站着，面向天后宫）
const pray: Seat3D[] = [-0.4, 0.5, 1.4].map((x) => ({
  id: nextId++, kind: 'pray' as const, zone: 4,
  station: { x: CENSER.x, z: CENSER.z, w: 1.1, d: 1.1, h: 1.1 },
  seat: { x, z: 22.1, yaw: 0 },
  approach: { x, z: 21.4 },
  hit: { x: CENSER.x + (x - CENSER.x) * 0.25, y: 1.15, z: CENSER.z - 0.1 },
}));

// 求签：桌前两个站位
const fortune: Seat3D[] = [3.15, 4.05].map((x) => ({
  id: nextId++, kind: 'fortune' as const, zone: 5,
  station: { x: QIUQIAN.x, z: QIUQIAN.z, w: 1.1, d: 0.6, h: 0.85 },
  seat: { x, z: 22.65, yaw: 0 },
  approach: { x, z: 21.95 },
  hit: { x: QIUQIAN.x, y: 0.95, z: QIUQIAN.z },
}));
// 命理阁：客人小凳（坐下面向师傅）
const bazi: Seat3D[] = [{
  id: nextId++, kind: 'bazi', zone: 6,
  station: { x: MINGLI.deskX, z: MINGLI.z, w: 1.2, d: 0.7, h: 0.75 },
  seat: { x: MINGLI.stoolX, z: MINGLI.stoolZ, yaw: Math.PI / 2 },
  approach: { x: 4.45, z: MINGLI.stoolZ },
  hit: { x: MINGLI.deskX, y: 0.8, z: MINGLI.z },
}];

export const SEATS: Seat3D[] = [...villain, ...woodfish, ...bath, ...mamak, ...pray, ...fortune, ...bazi];

/** 可以走的地面：整条街（两排店屋之间）+ 庙前广场 + 禅院 + 浴池花园 */
export const WALK_RECTS = [
  { minX: -6.2, maxX: 6.3, minZ: -2.4, maxZ: 24.6 }, // 主街（店屋到店屋）
  { minX: 6.3, maxX: 8.8, minZ: 12.0, maxZ: 24.6 }, // 姻缘树后面、月老庙旁
  { minX: -8.6, maxX: 9.0, minZ: 22.4, maxZ: 25.9 }, // 天后宫台阶前的广场（连通东西两区）
  { minX: ZEN_HALL.minX, maxX: ZEN_HALL.altarX - 0.8, minZ: ZEN_HALL.minZ + 0.4, maxZ: ZEN_HALL.maxZ - 0.4 },
  { minX: BATH_GARDEN.minX + 0.4, maxX: BATH_GARDEN.maxX, minZ: BATH_GARDEN.minZ + 0.4, maxZ: BATH_GARDEN.maxZ - 0.4 },
];
export function insideWalk(x: number, z: number): boolean {
  for (const r of WALK_RECTS) if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return true;
  return false;
}

/** 地面高度：只有下沉浴池里面是低的（台阶一路下到池底） */
export function groundY(x: number, z: number): number {
  for (const p of POOLS) {
    const r = Math.hypot(x - p.x, z - p.z);
    if (r < POOL_R - 0.12) {
      const k = Math.min(1, (POOL_R - 0.12 - r) / POOL_STEP_W);
      return POOL_FLOOR_Y * k;
    }
  }
  return 0;
}

const b = (id: string, kind: string, cx: number, cz: number, hw: number, hd: number, h = 1): Box => ({ id, kind, minX: cx - hw, maxX: cx + hw, minZ: cz - hd, maxZ: cz + hd, height: h });
/** 碰撞：所有实心的东西（建筑、树干、桌子、浴池、柱子…）。走不进去，但不会有“看不见的墙” */
export const COLLIDERS: Box[] = [
  ...villain.map((s) => b(`station_${s.id}`, 'station', s.station.x, s.station.z, 0.25, 0.25, 0.5)),
  b('stall', 'building', -4.75, 11.5, 1.05, 1.75, 3),
  b('board', 'prop', -4.6, 14.35, 0.15, 0.15, 1.6),
  b('popo', 'npc', -3.3, 13.85, 0.3, 0.3, 1.2), b('popoBrick', 'station', -2.62, 13.85, 0.25, 0.25, 0.5),
  b('mamakShop', 'building', -5.0, 21.0, 1.6, 2.4, 3),
  ...MAMAK_TABLES.map((t, i) => b(`mamakTable_${i}`, 'table', t.x, t.z, 0.3, 0.3, 0.75)),
  b('censer', 'prop', CENSER.x, CENSER.z, 0.55, 0.55, 1.4),
  b('donation', 'prop', DONATION_BOX.x, DONATION_BOX.z, 0.32, 0.25, 0.8),
  b('signpost', 'prop', 2.7, 7.7, 0.7, 0.7, 1.0),
  b('qiuqian', 'table', QIUQIAN.x, QIUQIAN.z, 0.55, 0.28, 0.85),
  b('mingliDesk', 'table', 5.9, MINGLI.z, 0.25, 0.62, 0.75), b('mingliMaster', 'npc', MINGLI.masterX, MINGLI.z, 0.25, 0.3, 1.2),
  b('banyanTrunk', 'tree', 5.6, 14.5, 1.1, 1.1, 5),
  b('yuelao', 'building', 6.4, 21.4, 1.7, 1.5, 4),
  b('gateL', 'prop', -3.6, -3.5, 0.5, 0.5, 4), b('gateR', 'prop', 3.6, -3.5, 0.5, 0.5, 4),
  // 禅院：矮桌、西侧柱子
  ...woodfish.map((s) => b(`zentable_${s.id}`, 'table', s.station.x, s.station.z, 0.32, 0.48, 0.42)),
  ...[22.9, 26.2, 31.8, 35.1].map((z, i) => b(`zenCol${i}`, 'pillar', ZEN_HALL.minX + 0.3, z, 0.2, 0.2, 4)),
  // 花园：浴池、灯柱、椰树
  ...POOLS.map((p, i) => b(`pool_${i}`, 'pool', p.x, p.z, POOL_R - 0.25, POOL_R - 0.25, 0.6)),
  ...[[-12.8, 29.8], [-17.3, 23.1], [-8.8, 23.1], [-17.3, 34.9], [-8.8, 34.9]].map(([x, z], i) => b(`lamp${i}`, 'prop', x, z, 0.15, 0.15, 1.5)),
  b('palmG', 'tree', -17, 23.4, 0.3, 0.3, 9),
];
/** 入座/离座的自动走路：可以走进浴池、走到凳子上 */
export const COLLIDERS_SEATING: Box[] = COLLIDERS.filter((c) => c.kind !== 'pool' && !c.id.startsWith('mamakTable'));
