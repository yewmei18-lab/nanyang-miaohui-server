import { WORLD_BOUNDS, TEMPLE, EAST_BANK_WALL_X, ZEN_SOUTH_WALL_Z } from './world3d.ts';

/**
 * 地图四周的围墙（白灰墙 + 红瓦顶）。以前边上是看不见的墙，走过去会突然卡住。
 * 墙中线在可走范围外 0.25m；店屋、天后宫已经挡住的地方不用砌；河道上留水口。
 * 河东岸：只留一条 4m 宽的河边步道，墙后面不能走（以前是一大片空地）。
 */
const B = WORLD_BOUNDS, O = 0.25;
export type WallSeg = { x0: number; z0: number; x1: number; z1: number };
export const WALLS: WallSeg[] = [
  // 西边：洗衰运后面、夜市街南头
  { x0: B.minX - O, z0: 26.2, x1: B.minX - O, z1: B.maxZ + O },
  { x0: B.minX - O, z0: B.minZ - O, x1: B.minX - O, z1: -8.0 },
  // 北边：天后宫两边（中间是庙本身）；河上留水口
  { x0: B.minX - O, z0: B.maxZ + O, x1: TEMPLE.x - 9.6, z1: B.maxZ + O },
  { x0: TEMPLE.x + 9.6, z0: B.maxZ + O, x1: 18.5, z1: B.maxZ + O },
  { x0: 22.5, z0: B.maxZ + O, x1: B.maxX + O, z1: B.maxZ + O },
  // 禅院东边、南边
  { x0: B.maxX + O, z0: ZEN_SOUTH_WALL_Z - O, x1: B.maxX + O, z1: B.maxZ + O },
  { x0: EAST_BANK_WALL_X + O, z0: ZEN_SOUTH_WALL_Z - O, x1: B.maxX + O, z1: ZEN_SOUTH_WALL_Z - O },
  // 河东岸步道的外墙
  { x0: EAST_BANK_WALL_X + O, z0: B.minZ - O, x1: EAST_BANK_WALL_X + O, z1: ZEN_SOUTH_WALL_Z - O },
  // 南边：夜市街南头、东边店屋到河、河到东墙
  { x0: B.minX - O, z0: B.minZ - O, x1: -9.6, z1: B.minZ - O },
  { x0: 13.1, z0: B.minZ - O, x1: 18.5, z1: B.minZ - O },
  { x0: 22.5, z0: B.minZ - O, x1: EAST_BANK_WALL_X + O, z1: B.minZ - O },
];
