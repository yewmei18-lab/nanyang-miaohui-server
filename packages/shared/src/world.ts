/**
 * 主广场布局 v2 —— 按用户确认的第一画面（docs/handoff/references/10-first-scene-approved.png）。
 * Babylon 默认坐标：面向 +Z（天后宫方向）时 +X 在右手边；Y 向上；单位米。
 * 客户端渲染与服务器碰撞共用这份数据；修改必须提升 WORLD_VERSION。
 */
export const WORLD_VERSION = 'plaza-v2-first-scene';

export interface Box { id: string; minX: number; maxX: number; minZ: number; maxZ: number; height: number; kind: string }

export const WORLD_BOUNDS = { minX: -24, maxX: 24, minZ: -20, maxZ: 26 };
/** 出生点：街道南端，面向天后宫 */
export const SPAWN = { x: -0.35, z: -9.4, radius: 0.3 };

/** 主街（石板路）与两侧 */
export const STREET = { minX: -2.6, maxX: 2.6, minZ: -20, maxZ: 8.0 };

/** 打小人：六个砖台沿街道左侧排成一列，玩家坐在街道一侧的蒲团上、面向西边的摊位 */
export const VILLAIN = { stationX: -3.25, z0: -9.3, pitch: 1.3, count: 6 };

export interface SeatDef {
  id: number;
  /** 砖台（含后方铺红布的高台）占地；w 沿 Z、d 沿 X */
  station: { x: number; z: number; w: number; d: number; h: number };
  /** 蒲团（坐姿锚点）与朝向（yaw = atan2(dx, dz)） */
  seat: { x: number; z: number; yaw: number };
  /** 走近/离开点（站立锚点） */
  approach: { x: number; z: number };
  /** 纸人击打点（低台面上、靠近玩家一侧） */
  hit: { x: number; y: number; z: number };
}

const STATION = { w: 1.0, d: 1.25, h: 0.42 }; // 低台面高度；后方高台另计
const SEAT_GAP = 0.42;
function makeSeat(id: number, z: number): SeatDef {
  const x = VILLAIN.stationX;
  const front = x + STATION.d / 2; // 面向街道（+X）的一边
  const seatX = front + SEAT_GAP;
  return {
    id,
    station: { x, z, ...STATION },
    seat: { x: seatX, z, yaw: -Math.PI / 2 }, // 面向 -X（摊位）
    approach: { x: seatX + 0.85, z },
    hit: { x: front - 0.3, y: STATION.h + 0.01, z },
  };
}
export const SEATS: SeatDef[] = Array.from({ length: VILLAIN.count }, (_, i) => makeSeat(i, VILLAIN.z0 + i * VILLAIN.pitch));

function box(id: string, kind: string, minX: number, maxX: number, minZ: number, maxZ: number, height: number): Box {
  return { id, kind, minX, maxX, minZ, maxZ, height };
}

const stationBoxes = SEATS.map((s) => box(`station_${s.id}`, 'station', s.station.x - s.station.d / 2, s.station.x + s.station.d / 2, s.station.z - s.station.w / 2, s.station.z + s.station.w / 2, 0.8));

export const LANDMARKS = {
  villainStall: { x: -5.0, z: -6.9, w: 4.6, d: 2.0 }, // 打小人摊位（姨姨柜台），面向东偏南
  aunty: { x: -4.65, z: -7.0 }, // 摊位柜台后面
  board: { x: -5.3, z: -1.7 }, // 今日小人榜（摊位北端）
  mingli: { x: -6.3, z: -0.6, y: 4.3 }, // 命理阁竖招牌（店屋立面上，垂直于立面）
  mamak: { x: -5.3, z: 2.7 }, // MAMAK 店面，面向东
  mamakTables: [{ x: -2.9, z: 1.5 }, { x: -3.0, z: 4.1 }],
  temple: { x: 0, z: 15.5 },
  censer: { x: 0, z: 6.6 },
  banyan: { x: 8.8, z: 5.2 },
  yinyuanSign: { x: 6.2, z: 2.6, y: 5.6 },
  yuelao: { x: 4.7, z: 2.3 },
  planterA: { x: 3.9, z: -1.8 },
  planterB: { x: 3.7, z: -8.4 },
  signpost: { x: 2.75, z: -6.7 },
};

const L = LANDMARKS;
export const COLLIDERS: Box[] = [
  // 世界边界
  box('bound_w', 'bound', -25, -24, -21, 27, 3), box('bound_e', 'bound', 24, 25, -21, 27, 3),
  box('bound_s', 'bound', -25, 25, -21, -20, 3), box('bound_n', 'bound', -25, 25, 26, 27, 3),
  // 左侧：打小人摊位、红布柜台、六座砖台、MAMAK 店面与桌椅、店屋
  box('villain_stall', 'building', L.villainStall.x - L.villainStall.d / 2, L.villainStall.x + L.villainStall.d / 2, L.villainStall.z - L.villainStall.w / 2, L.villainStall.z + L.villainStall.w / 2, 3.2),
  box('stall_counter', 'wall', -4.0, -3.85, -10.0, -2.2, 0.9),
  ...stationBoxes,
  box('mamak_front', 'building', -6.6, -4.3, 0.2, 5.2, 3.6),
  ...L.mamakTables.map((t, i) => box(`mamak_table_${i}`, 'prop', t.x - 0.7, t.x + 0.7, t.z - 0.7, t.z + 0.7, 0.8)),
  box('shops_w', 'building', -24, -6.3, -20, 8, 10),
  box('shops_w2', 'building', -24, -7.6, 8, 26, 8),
  // 北端：天后宫（含台阶，第一阶段不开放）与香炉
  box('temple', 'building', -7.8, 7.8, 8.0, 26, 9),
  box('censer', 'prop', L.censer.x - 0.6, L.censer.x + 0.6, L.censer.z - 0.6, L.censer.z + 0.6, 1.4),
  // 右侧：花坛、路牌、大榕树、月老庙、东侧店屋
  box('banyan_trunk', 'tree', L.banyan.x - 1.2, L.banyan.x + 1.4, L.banyan.z - 1.2, L.banyan.z + 1.2, 6),
  box('planter_a', 'prop', L.planterA.x - 1.2, L.planterA.x + 1.4, L.planterA.z - 1.0, L.planterA.z + 1.0, 0.6),
  box('planter_b', 'prop', L.planterB.x - 1.0, L.planterB.x + 1.4, L.planterB.z - 1.0, L.planterB.z + 1.0, 0.6),
  box('signpost', 'prop', L.signpost.x - 0.15, L.signpost.x + 0.15, L.signpost.z - 0.15, L.signpost.z + 0.15, 2.4),
  box('yuelao', 'building', L.yuelao.x - 1.7, L.yuelao.x + 1.7, L.yuelao.z - 1.7, L.yuelao.z + 1.7, 4),
  box('shops_e', 'building', 9.5, 24, -20, 26, 8),
];

export const ZONES = {
  temple: { x: 0, z: 7.6, label: '天后宫', open: false },
  yuelao: { x: L.yuelao.x - 2.0, z: L.yuelao.z, label: '月老庙', open: false },
  mingli: { x: -6.1, z: -0.4, label: '命理阁', open: false },
  mamak: { x: -4.6, z: 2.7, label: 'Mamak', open: false },
  woodfish: { x: 2.3, z: -6.7, label: '木鱼禅院', open: false },
  nightMarket: { x: 2.3, z: -6.7, label: '夜市', open: false },
};

/** 兼容旧代码：院落已改为沿街摊位 */
export const COURTYARD = { cx: VILLAIN.stationX, cz: -6.0, minX: -4.6, maxX: -1.0, minZ: -10.0, maxZ: -2.0, entranceZ: [-9.3, 0.6] as [number, number] };
