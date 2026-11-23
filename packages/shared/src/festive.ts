/**
 * 年味小玩意：抽红包、夜市捞金鱼、每天换题的灯谜、舞狮接桔子月榜。
 * 服务器和客户端共用：赔率、价钱、上限、池塘里有几条鱼。发不发钱只由服务器决定。
 * （灯谜的题目和答案只放在服务器，见 apps/server/src/riddles.ts，客户端答完才看到答案。）
 */
import { rng } from './minigames.ts';
import { klDay } from './economy.ts';

// ───────── 抽红包：每人每天一个（马来西亚日期） ─────────
/** 金币和机会（加起来 100） */
export const ANGPAO_ODDS: ReadonlyArray<{ coins: number; pct: number }> = [
  { coins: 2, pct: 30 }, { coins: 4, pct: 25 }, { coins: 6, pct: 20 }, { coins: 8, pct: 13 }, { coins: 12, pct: 8 }, { coins: 28, pct: 3 }, { coins: 88, pct: 1 },
];
/** 抽到这个数或以上：全房间提示一下 */
export const ANGPAO_BIG = 28;
/** roll：0..99 的整数（服务器随机） */
export function angpaoPick(roll: number): number {
  let r = Math.max(0, Math.min(99, Math.floor(roll)));
  for (const o of ANGPAO_ODDS) { if (r < o.pct) return o.coins; r -= o.pct; }
  return ANGPAO_ODDS[0].coins;
}

// ───────── 夜市捞金鱼 ─────────
export const GOLDFISH = {
  /** 一张纸网几金币；每天最多买几张 */
  price: 2, roundsPerDay: 6,
  /** 一局最多算几条；平均至少多久才捞得到一条（毫秒） */
  maxCatch: 6, msPerFish: 1200,
  /** 一局（买了纸网）最长多久，过了就作废 */
  roundMs: 3 * 60_000,
  /** 一局捞到几条拿几金币（从多到少看） */
  pay: [{ n: 5, coins: 8 }, { n: 3, coins: 4 }] as ReadonlyArray<{ n: number; coins: number }>,
  /** 画布大小；水面从 waterTop 开始（上面是盆边和小碗） */
  W: 300, H: 280, waterTop: 64,
  /** 池里几条鱼 */
  fishCount: 8,
} as const;
/** 捞到 n 条拿几金币 */
export const goldfishPay = (n: number) => GOLDFISH.pay.find((p) => n >= p.n)?.coins ?? 0;
/** 纸网在水里能撑多久（毫秒）：今天连着赢的局数越多，纸越薄 */
export const goldfishPaper = (streak: number) => Math.max(4200, 7500 - Math.max(0, Math.min(6, streak)) * 550); // 纸网泡水几毫秒会破（2026-11-23 放宽：原来 4.2 秒，瞄准的人也只捞到 1–2 条；连赢一局薄一点）
export interface PondFish { id: number; x: number; y: number; a: number; speed: number; size: number; color: 'red' | 'orange' | 'calico' | 'black' }
/** 这一局池里的鱼（同一个 seed 在服务器和手机上一样）：编号 1..8、位置、速度、大小 */
export function goldfishPond(seed: number): PondFish[] {
  const r = rng(seed); const G = GOLDFISH; const out: PondFish[] = [];
  const colors: PondFish['color'][] = ['red', 'orange', 'red', 'calico', 'orange', 'red', 'black', 'orange'];
  for (let i = 0; i < G.fishCount; i++) {
    out.push({
      id: i + 1,
      x: Math.round(30 + r() * (G.W - 60)), y: Math.round(G.waterTop + 26 + r() * (G.H - G.waterTop - 52)),
      a: Math.round(r() * 628) / 100,
      // 大部分慢慢游，有两三条特别快
      speed: Math.round((0.45 + r() * 0.5 + (i % 3 === 2 ? 0.55 : 0)) * 100) / 100,
      size: Math.round((0.85 + r() * 0.4) * 100) / 100,
      color: colors[i % colors.length],
    });
  }
  return out;
}

// ───────── 舞狮接桔子：月榜（一个马来西亚月份是一季） ─────────
export const ORANGE_SEASON_PRIZES = [50, 30, 20] as const;
/** '2026-11' */
export const klMonth = (ms: number) => klDay(ms).slice(0, 7);
/** 上一个月：'2026-01' → '2025-12' */
export function prevSeason(season: string): string {
  const [y, m] = season.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
/** 这个月还剩几天（不算今天）；0 = 今天是最后一天 */
export function seasonDaysLeft(ms: number): number {
  const d = klDay(ms); const [y, m, day] = d.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return last - day;
}
/** '2026-11' → '11 月' */
export const seasonName = (season: string) => `${Number(season.slice(5, 7))} 月`;
