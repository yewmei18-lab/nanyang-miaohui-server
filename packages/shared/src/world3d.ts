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

export const WORLD_VERSION = 'street-3d-3';
export const SPAWN = PICTURE_SPAWN;

export type SeatKind = 'villain' | 'woodfish' | 'bath' | 'mamak' | 'pray' | 'fortune' | 'bazi' | 'burn' | 'lantern' | 'ring' | 'photo';
export interface Seat3D extends SeatDef { kind: SeatKind; zone: number; /** 属于第几张桌（MAMAK） */ table?: number }

/** 木鱼禅院：开放式木殿 */
/** 木鱼禅院：2026-11-23 搬到河对岸（原来贴着天后宫），走第二座石桥过去 */
export const ZEN_HALL = { minX: 23.8, maxX: 32.8, minZ: 22.6, maxZ: 35.4, altarX: 32.2 };
/** 听雨的三口水缸：禅院南边一排 */
export const RAIN_JARS = [0, 1, 2].map((i) => ({ x: ZEN_HALL.minX + 3.7 + i * 0.8, z: ZEN_HALL.minZ + 0.9 }));
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
export const WISH_TREE = { x: 5.6, z: 14.5, standX: 1.8, standZ: 14.5, radius: 2.4 }; // 站在花坛外面
/** 香炉、功德箱 */
export const CENSER = { x: 0.5, z: 23.2 };
/** 功德箱：紧挨着香炉（2026-11-22 移近） */
export const DONATION_BOX = { x: 1.75, z: 23.55 };
/** MAMAK：店面 + 三张四人桌（模型自带 4 张红塑料凳，凳子在桌子的 4 个斜角，离桌心 0.61m） */
export const MAMAK_SHOP = { x: -4.6, z: 21.0, counterX: -3.3, counterZ: 21.2 };
export const MAMAK_TABLES = [
  { x: -1.5, z: 16.6, face: 1.445 }, { x: -1.5, z: 19.7, face: 1.445 }, { x: 2.0, z: 18.4, face: 1.445 },
];
export const MAMAK_TABLE_TOP_Y = 0.72;
export const MAMAK_STOOL_Y = 0.52;
/** 求签桌（天后宫前、功德箱右边）：签筒在桌上，站在桌前摇签 */
/** 求签桌：2026-11-22 从香炉旁（挡路）搬到天后宫右边的殿前 */
export const QIUQIAN = { x: 8.0, z: 25.9 };
/** 命理阁：入口右手边第二间店屋的骑楼下，师傅坐在桌后，客人坐小凳 */
export const MINGLI = { deskX: 5.85, z: 2.0, masterX: 6.27, stoolX: 5.3, stoolZ: 1.83, facadeX: 6.75 };
/** 烧掉烦恼：街左前方三个金炉 */
/** 2026-11-22：只留一个化忧炉，其他人排队 */
export const BURN_POTS = [{ x: -4.7, z: 3.0 }];
/** 牌坊外的小广场：左边放天灯、中间打卡拍照（背景是牌坊和街）、右边套圈 */
export const LANTERN_SPOTS = [{ x: -3.6, z: -6.6 }, { x: -4.2, z: -8.6 }, { x: -3.6, z: -10.6 }];
export const LANTERN_TABLE = { x: -5.4, z: -8.6 };
/** 拍照：两个站位面向南（镜头在南边往北拍，背景是牌坊） */
export const PHOTO = { spots: [{ x: -0.45, z: -7.4 }, { x: 0.45, z: -7.4 }], camX: 0, camY: 1.35, camZ: -11.2, standX: 0, standZ: -12.2 };
/** 套圈：站在投掷线往东（+X）丢，5 根柱子，越远奖励越多 */
export const RING = {
  stand: { x: 2.1, z: -8.4 }, origin: { x: 2.35, z: -8.4 }, boothX: 6.6,
  pegs: [{ x: 3.4, z: -7.6, coins: 2 }, { x: 3.4, z: -9.2, coins: 2 }, { x: 4.3, z: -7.9, coins: 5 }, { x: 4.3, z: -8.9, coins: 5 }, { x: 5.2, z: -8.4, coins: 10 }],
  pegR: 0.05, ringR: 0.17,
  /** 方向最多左右各 maxA 弧度（两边的柱子在 ±0.65 左右）；力度 0..1 → 丢出 minD..minD+spanD 米（最远的柱子约 2.85 米） */
  maxA: 0.8, minD: 0.8, spanD: 2.8,
};
/** 套圈落点：方向角 a（0 = 正东，正数往北/+Z）、力度 p（0..1）→ 落地点。服务器和客户端用同一个公式（没有随机） */
export function ringLanding(a: number, p: number) {
  const aa = Math.max(-RING.maxA, Math.min(RING.maxA, a)), pp = Math.max(0, Math.min(1, p));
  const d = RING.minD + pp * RING.spanD;
  return { x: RING.origin.x + Math.cos(aa) * d, z: RING.origin.z + Math.sin(aa) * d };
}
/** 第 4 批：夜市街、童玩、灯笼巷、水边、戏台后台、入口的小地方（不坐下，走近就能玩） */
export type SpotKind = 'stage' | 'story' | 'tea' | 'ice' | 'mask' | 'weekly' | 'paper' | 'batu' | 'eraser' | 'marble' | 'hop' | 'wishrack' | 'shadow' | 'fish' | 'backstage' | 'drum' | 'rain' | 'photowall' | 'stamp' | 'board' | 'cat' | 'casino' | 'angpao' | 'goldfish' | 'riddle' | 'yuelao';
export interface Spot { id: string; kind: SpotKind; x: number; z: number; r: number; label: string; face: number }
export const SPOTS: Spot[] = [
  { id: 'tea', kind: 'tea', x: -16.4, z: 17.0, r: 2.2, label: '拉一杯茶', face: Math.PI / 2 },
  { id: 'ice', kind: 'ice', x: -16.4, z: 11.0, r: 2.2, label: '做双色冰球', face: Math.PI / 2 },
  { id: 'mask', kind: 'mask', x: -16.4, z: 5.0, r: 2.2, label: '试戴面具', face: Math.PI / 2 },
  { id: 'paper', kind: 'paper', x: -13.5, z: 14.0, r: 1.8, label: '掀开一张红纸', face: -Math.PI / 2 },
  { id: 'batu', kind: 'batu', x: -13.6, z: 20.0, r: 1.8, label: '玩五粒子', face: -Math.PI / 2 },
  { id: 'eraser', kind: 'eraser', x: -9.0, z: -4.2, r: 1.8, label: '斗擦胶', face: 0 },
  { id: 'marble', kind: 'marble', x: -11.9, z: -2.4, r: 1.6, label: '玩弹珠台', face: Math.PI },
  { id: 'hop', kind: 'hop', x: -15.3, z: -6.0, r: 1.4, label: '跳飞机', face: 0 },
  { id: 'wishrack', kind: 'wishrack', x: 10.4, z: -6.3, r: 1.8, label: '看祝福、留一句话', face: Math.PI },
  { id: 'shadow', kind: 'shadow', x: 11.6, z: -2.2, r: 2.0, label: '玩对对碰', face: 0 },
  { id: 'fish', kind: 'fish', x: 18.0, z: -4.2, r: 1.8, label: '撒鱼粮', face: Math.PI / 2 },
  { id: 'stage', kind: 'stage', x: 12.6, z: 15.0, r: 1.8, label: '布袋戏台：玩戏偶 · 看几点开演', face: Math.PI / 2 },
  { id: 'backstage', kind: 'backstage', x: 16.45, z: 15.0, r: 1.8, label: '拉开布帘', face: -Math.PI / 2 },
  { id: 'drum', kind: 'drum', x: 15.5, z: 2.3, r: 1.8, label: '跟鼓师打鼓（一关比一关难）', face: 0 },
  { id: 'rain', kind: 'rain', x: ZEN_HALL.minX + 4.5, z: ZEN_HALL.minZ + 1.75, r: 1.3, label: '敲水缸听雨', face: -Math.PI / 2 },
  { id: 'photowall', kind: 'photowall', x: 4.9, z: -4.6, r: 1.8, label: '看老照片', face: 0 },
  { id: 'stamp', kind: 'stamp', x: 2.6, z: -1.3, r: 1.5, label: '领游园纸、盖章', face: 0 },
  { id: 'board', kind: 'board', x: 3.3, z: 3.6, r: 1.6, label: '看今日庙会', face: -Math.PI / 2 },
  { id: 'casino', kind: 'casino', x: -4.6, z: 0.2, r: 1.8, label: '游艺档（4 个小游戏）', face: 0 },
  // 年味小玩意（2026-11-23）：老街的红包架、夜市街的金鱼盆、灯笼巷的灯谜架
  { id: 'angpao', kind: 'angpao', x: -3.9, z: 5.6, r: 1.6, label: '抽红包（每天一个）', face: -Math.PI / 2 },
  { id: 'goldfish', kind: 'goldfish', x: -14.5, z: 1.0, r: 1.5, label: '捞金鱼（2 金币一张纸网）', face: Math.PI / 2 },
  { id: 'riddle', kind: 'riddle', x: 8.0, z: -4.0, r: 1.6, label: '猜灯谜（每天 3 题）', face: Math.PI },
  { id: 'yuelao', kind: 'yuelao', x: 13.4, z: 20.4, r: 1.8, label: '拜月老 · 抽姻缘签', face: Math.PI / 2 },
];
/** 橘猫每天藏的地方（按马来西亚日期轮换） */
export const CAT_SPOTS = [
  { x: -1.1, z: 16.1, where: 'Mamak 的红凳上' }, { x: 12.6, z: -5.9, where: '灯笼巷的灯笼箱旁' }, { x: 16.3, z: 13.4, where: '戏台后面' },
  { x: 23.6, z: -3.6, where: '石桥对岸' }, { x: -12.4, z: 31.5, where: '洗衰运的花砖边' }, { x: -15.0, z: 8.0, where: '夜市街的冰球档下' }, { x: 2.9, z: 12.2, where: '姻缘树下' },
];
/** 打小人摊的婆婆：摊位北头，坐在蒲团上面向街，自己有一块砖台 */
export const POPO = { x: -3.3, z: 13.85, yaw: Math.PI / 2, brickX: -2.62 };
/** 今日小人榜木牌 */
export const BOARD = { x: -4.6, z: 14.35 };

let nextId = 0;
const villain: Seat3D[] = VILLAIN_SEATS.map((s) => ({ ...s, id: nextId++, kind: 'villain' as const, zone: 0 }));

// 木鱼禅院：两列四排矮桌，玩家坐在桌子西侧的蒲团上，面向东边佛台（+X）
const zenTables: Array<{ x: number; z: number }> = [];
for (const x of [ZEN_HALL.minX + 2.8, ZEN_HALL.minX + 5.8]) for (const z of [25.4, 28.0, 30.6, 33.2]) zenTables.push({ x, z });
const woodfish: Seat3D[] = zenTables.map((t) => ({
  id: nextId++, kind: 'woodfish' as const, zone: 1,
  station: { x: t.x, z: t.z, w: 0.9, d: 0.6, h: 0.42 },
  seat: { x: t.x - 0.92, z: t.z, yaw: Math.PI / 2 }, // 往后挪，不再坐进桌子里
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
const fortune: Seat3D[] = [QIUQIAN.x - 0.45, QIUQIAN.x + 0.45].map((x) => ({
  id: nextId++, kind: 'fortune' as const, zone: 5,
  station: { x: QIUQIAN.x, z: QIUQIAN.z, w: 1.1, d: 0.6, h: 0.85 },
  seat: { x, z: QIUQIAN.z - 0.8, yaw: 0 },
  approach: { x, z: QIUQIAN.z - 1.5 },
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

const stand = (kind: SeatKind, zone: number, x: number, z: number, yaw: number, ax: number, az: number, hit: { x: number; y: number; z: number }): Seat3D =>
  ({ id: nextId++, kind, zone, station: { x: hit.x, z: hit.z, w: 0.8, d: 0.8, h: hit.y }, seat: { x, z, yaw }, approach: { x: ax, z: az }, hit });
const burn: Seat3D[] = BURN_POTS.map((p) => stand('burn', 7, p.x + 0.95, p.z, -Math.PI / 2, p.x + 1.6, p.z, { x: p.x, y: 0.95, z: p.z }));
const lantern: Seat3D[] = LANTERN_SPOTS.map((p) => stand('lantern', 8, p.x, p.z, -Math.PI / 2 - 0.3, p.x + 0.8, p.z, { x: p.x, y: 1.6, z: p.z }));
const ring: Seat3D[] = [stand('ring', 9, RING.stand.x, RING.stand.z, Math.PI / 2, RING.stand.x - 0.7, RING.stand.z, { x: 4.3, y: 0.3, z: RING.stand.z })];
const photo: Seat3D[] = PHOTO.spots.map((p, i) => stand('photo', 10, p.x, p.z, Math.PI, p.x + (i ? 0.5 : -0.5), p.z + 0.8, { x: PHOTO.camX, y: PHOTO.camY, z: PHOTO.camZ }));

export const SEATS: Seat3D[] = [...villain, ...woodfish, ...bath, ...mamak, ...pray, ...fortune, ...bazi, ...burn, ...lantern, ...ring, ...photo];

/** 可以走的地面：整条街（两排店屋之间）+ 庙前广场 + 禅院 + 浴池花园 */
export const WALK_RECTS = [
  { minX: -6.2, maxX: 6.3, minZ: -2.4, maxZ: 24.6 }, // 主街（店屋到店屋）
  { minX: -2.9, maxX: 2.9, minZ: -4.6, maxZ: -2.4 }, // 牌坊中间
  { minX: -6.0, maxX: 6.2, minZ: -12.6, maxZ: -4.6 }, // 牌坊外的小广场
  { minX: 5.6, maxX: 13.2, minZ: -6.6, maxZ: -1.3 }, // 灯笼巷（从主街往东，和主街接上）
  { minX: -13.2, maxX: -5.6, minZ: -6.6, maxZ: -1.3 }, // 童玩巷（从主街往西）
  { minX: -17.6, maxX: -13.0, minZ: -6.6, maxZ: 23.4 }, // Mamak 夜市街（一路通到洗衰运）
  { minX: 8.6, maxX: 10.8, minZ: 15.0, maxZ: 20.6 }, // 戏台后台
  { minX: 13.0, maxX: 18.6, minZ: -12.0, maxZ: 6.0 }, // 河边（近岸）
  { minX: 18.2, maxX: 22.8, minZ: -2.55, maxZ: -1.45 }, // 石桥（栏杆之间）
  { minX: 22.4, maxX: 25.6, minZ: -8.0, maxZ: 4.0 }, // 河对岸
  { minX: 6.3, maxX: 8.8, minZ: 12.0, maxZ: 24.6 }, // 姻缘树后面、月老庙旁
  { minX: -8.6, maxX: 9.0, minZ: 22.4, maxZ: 25.9 }, // 天后宫台阶前的广场（连通东西两区）
  { minX: ZEN_HALL.minX, maxX: ZEN_HALL.altarX - 0.8, minZ: ZEN_HALL.minZ + 0.4, maxZ: ZEN_HALL.maxZ - 0.4 },
  { minX: BATH_GARDEN.minX + 0.4, maxX: BATH_GARDEN.maxX, minZ: BATH_GARDEN.minZ + 0.4, maxZ: BATH_GARDEN.maxZ - 0.4 },
];
/**
 * 可以走的地方（2026-11-22 起）：整张地图的外框里面，除了房子、河、天后宫、姻缘树根这些“实心”的地方，哪里都能走。
 * （以前只能走几条长方形的路，很多空地走不进去。）小东西（桌子、摊、柱子）另外用 COLLIDERS 挡。
 */
/** 第二座石桥：庙后过河去木鱼禅院 */
export const BRIDGE2 = { x0: 18.2, x1: 22.8, z0: 28.35, z1: 29.65, z: 29.0 };
/** 天后宫：2026-11-23 放大（19 米宽），台阶跟着变宽变高；台阶脚还在 z 25.6 */
export const TEMPLE = { x: 1.0, z: 34.3, w: 19 };
/** 天后宫台阶：z0 开始往上，z1 到顶，门口平台到 door */
export const TEMPLE_STAIRS = { minX: -2.42, maxX: 4.42, z0: 25.6, z1: 29.15, top: 1.46, door: 29.65 };
/** 天后宫门口：一对石狮子、两根旗杆 */
export const TEMPLE_DECOR = { lions: [{ x: -3.45, z: 25.6 }, { x: 5.45, z: 25.6 }], poles: [{ x: -7.6, z: 25.4 }, { x: 10.3, z: 25.4 }] };
export const WORLD_BOUNDS = { minX: -17.8, maxX: 33.6, minZ: -12.9, maxZ: 37.0 };
/** 河东岸只留 4m 宽步道（外面是围墙）；禅院南边的墙 */
export const EAST_BANK_WALL_X = 26.5, ZEN_SOUTH_WALL_Z = 22.4;
const R = (minX: number, maxX: number, minZ: number, maxZ: number) => ({ minX, maxX, minZ, maxZ });
export const SOLID_RECTS = [
  // 西边一排店屋（主街和夜市街中间），中间留童玩巷
  ...[[-14.3, -7.7], [-1.25, 5.25], [5.25, 11.75], [11.75, 18.25]].map(([a, b]) => R(-12.9, -6.3, a, b)),
  // 东边一排店屋，中间留灯笼巷
  ...[[-14.3, -7.7], [-1.25, 5.25], [5.25, 11.75]].map(([a, b]) => R(6.5, 13.1, a, b)),
  // 天后宫：两边和后面是殿；正中间是台阶，可以走上去到门口
  R(TEMPLE.x - 9.6, TEMPLE_STAIRS.minX, 26.6, 45), R(TEMPLE_STAIRS.maxX, TEMPLE.x + 9.6, 26.6, 45), R(TEMPLE_STAIRS.minX, TEMPLE_STAIRS.maxX, TEMPLE_STAIRS.door, 45),
  // 河（桥上可以过）
  R(18.7, 22.3, -20, -2.6), R(18.7, 22.3, -1.4, BRIDGE2.z0 + 0.1), R(18.7, 22.3, BRIDGE2.z1 - 0.1, 45),
  // 禅院佛台
  R(ZEN_HALL.altarX - 0.8, ZEN_HALL.maxX + 0.2, ZEN_HALL.minZ, ZEN_HALL.maxZ),
  // 河东岸围墙外面
  R(EAST_BANK_WALL_X, 45, -20, ZEN_SOUTH_WALL_Z),
];
/** 圆形挡块：姻缘树的圆花坛（量过模型：半径约 3.2m，再加人身半宽）。以前是方块，比花坛小，人会走进花坛里 */
export const SOLID_CIRCLES = [{ x: 5.6, z: 14.5, r: 3.45 }];
export function insideWalk(x: number, z: number): boolean {
  const B = WORLD_BOUNDS; if (x < B.minX || x > B.maxX || z < B.minZ || z > B.maxZ) return false;
  for (const c of SOLID_CIRCLES) if (Math.hypot(x - c.x, z - c.z) < c.r) return false;
  for (const r of SOLID_RECTS) if (x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ) return false;
  return true;
}
/** 天后宫台阶：z 25.6 开始往上，28.4 到顶，门口平台到 29.4 */


/** 石桥桥面高度（沿 x 拱起） */
export const bridgeY = (x: number) => Math.max(0, Math.sin(Math.PI * (x - 18.2) / 4.6)) * 0.88;
/** 石桥桥面：中间拱起 */
export const BRIDGE_DECK = { x0: 18.2, x1: 22.8, z0: -2.65, z1: -1.35, rise: 0.88 };
/** 地面高度：下沉浴池里面是低的（台阶一路下到池底）；石桥上是拱起来的 */
export function groundY(x: number, z: number): number {
  const T = TEMPLE_STAIRS;
  if (x > T.minX && x < T.maxX && z > T.z0) return z >= T.z1 ? T.top : ((z - T.z0) / (T.z1 - T.z0)) * T.top;
  const B = BRIDGE_DECK;
  if (x > B.x0 && x < B.x1 && z > B.z0 && z < B.z1) return bridgeY(x);
  if (x > BRIDGE2.x0 && x < BRIDGE2.x1 && z > BRIDGE2.z0 && z < BRIDGE2.z1) return bridgeY(x);
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
  // 第 4 批的摊位和小东西
  ...[17.0, 11.0, 5.0, 0.0].map((z, i) => b(`nightStall${i}`, 'building', -17.4, z, 0.6, 1.3, 2.5)),
  b('paperRack', 'prop', -12.9, 14.0, 0.25, 0.9, 1.8), b('batuTable', 'table', -12.9, 20.0, 0.35, 0.45, 0.5),
  b('eraserTable', 'table', -9.0, -4.2, 0.55, 0.4, 0.8), b('marbleBoard', 'prop', -11.9, -1.95, 0.45, 0.25, 1.0),
  b('wishRack', 'prop', 10.4, -6.75, 1.1, 0.2, 1.8), b('shadowLamp', 'prop', 13.05, -2.15, 0.15, 0.15, 1.6), b('shadowWall', 'building', 11.6, -1.75, 1.3, 0.12, 2.6),
  b('weeklyTable', 'prop', -17.1, 8.0, 0.5, 0.8, 1.0),
  b('casinoTable', 'table', -5.55, 0.2, 0.35, 0.75, 0.9), // 原来烧烦恼第一个炉的位置
  // 红包架（老街西边，面向街）、金鱼盆（夜市街东边，贴着店屋后墙）、灯谜架（灯笼巷南边，面向北）
  b('angpaoRack', 'prop', -4.75, 5.6, 0.15, 0.75, 2.0), b('goldfishTub', 'prop', -13.4, 1.0, 0.55, 0.55, 0.5), b('riddleFrame', 'prop', 8.0, -5.0, 0.85, 0.12, 2.3),
  b('drumRack', 'prop', 15.5, 3.1, 0.35, 0.35, 1.2), b('photoWall', 'building', 4.9, -3.95, 1.3, 0.15, 2.4),
  b('stampTable', 'table', 2.6, -0.55, 0.45, 0.3, 0.8), b('fairBoard', 'prop', 4.15, 3.6, 0.2, 0.55, 2.0),
  ...RAIN_JARS.map((j, i) => b(`rainJar${i}`, 'prop', j.x, j.z, 0.22, 0.22, 0.6)),
  b('guessTable', 'table', -2.35, 22.75, 0.45, 0.45, 0.8), b('guessHost', 'npc', -3.15, 22.75, 0.25, 0.25, 1.5),
  b('puppetStage', 'building', 14.8, 15.0, 0.7, 1.85, 3),
  b('qiuqian', 'table', QIUQIAN.x, QIUQIAN.z, 0.55, 0.28, 0.85),
  b('mingliDesk', 'table', 5.9, MINGLI.z, 0.25, 0.62, 0.75), b('mingliMaster', 'npc', MINGLI.masterX, MINGLI.z, 0.25, 0.3, 1.2),
  b('banyanTrunk', 'tree', 5.6, 14.5, 1.1, 1.1, 5),
  b('yuelao', 'building', 16.0, 20.4, 2.1, 1.8, 4),
  b('gateL', 'prop', -3.6, -3.5, 0.5, 0.5, 4), b('gateR', 'prop', 3.6, -3.5, 0.5, 0.5, 4),
  ...BURN_POTS.map((p, i) => b(`burnPot${i}`, 'prop', p.x, p.z, 0.5, 0.5, 1)),
  b('lanternTable', 'table', LANTERN_TABLE.x, LANTERN_TABLE.z, 0.4, 0.55, 0.8),
  b('photoCam', 'prop', PHOTO.camX, -11.3, 0.4, 0.4, 1.6),
  b('ringField', 'prop', 4.35, RING.origin.z, 1.25, 1.15, 0.4), b('ringBooth', 'building', RING.boothX, RING.origin.z, 0.7, 1.4, 2.5),
  // 禅院：矮桌、西侧柱子
  ...woodfish.map((s) => b(`zentable_${s.id}`, 'table', s.station.x, s.station.z, 0.32, 0.48, 0.42)),
  ...[22.9, 26.2, 31.8, 35.1].map((z, i) => b(`zenCol${i}`, 'pillar', ZEN_HALL.minX + 0.3, z, 0.2, 0.2, 4)),
  // 禅院南北两边是木栏杆（只有西边对着桥是入口）
  b('zenRailS', 'prop', (ZEN_HALL.minX + ZEN_HALL.maxX) / 2 + 0.4, ZEN_HALL.minZ + 0.25, (ZEN_HALL.maxX - ZEN_HALL.minX) / 2 - 0.4, 0.15, 1.0),
  b('zenRailN', 'prop', (ZEN_HALL.minX + ZEN_HALL.maxX) / 2 + 0.4, ZEN_HALL.maxZ - 0.25, (ZEN_HALL.maxX - ZEN_HALL.minX) / 2 - 0.4, 0.15, 1.0),
  // 花园：浴池、灯柱、椰树
  ...POOLS.map((p, i) => b(`pool_${i}`, 'pool', p.x, p.z, POOL_R - 0.25, POOL_R - 0.25, 0.6)),
  ...[[-12.8, 29.8], [-17.3, 23.1], [-8.8, 23.1], [-17.3, 34.9], [-8.8, 34.9]].map(([x, z], i) => b(`lamp${i}`, 'prop', x, z, 0.15, 0.15, 1.5)),
  b('palmG', 'tree', -17, 23.4, 0.3, 0.3, 9),
  ...TEMPLE_DECOR.lions.map((l, i) => b(`shishi${i}`, 'prop', l.x, l.z, 0.55, 0.55, 2.2)),
  ...TEMPLE_DECOR.poles.map((l, i) => b(`flagPole${i}`, 'prop', l.x, l.z, 0.2, 0.2, 8)),
  // 椰树树干、灯柱（以前只挡镜头，人可以穿过去）
  ...[[-7.0, 30], [8.5, 30], [-12, 21], [17.6, 11.6], [10.5, 2], [-12.5, 9], [25.9, -6], [25.9, 2.6], [16, -11], [14, 4.8]].map(([x, z], i) => b(`palm${i}`, 'tree', x, z, 0.3, 0.3, 9)),
  ...[[23.4, -5], [23.4, 1.5], [17.6, -6.5], [17.6, 3.5]].map(([x, z], i) => b(`eastLamp${i}`, 'prop', x, z, 0.15, 0.15, 1.5)),
];
/** 入座/离座的自动走路：可以走进浴池、走到凳子上 */
export const COLLIDERS_SEATING: Box[] = COLLIDERS.filter((c) => c.kind !== 'pool' && !c.id.startsWith('mamakTable'));
