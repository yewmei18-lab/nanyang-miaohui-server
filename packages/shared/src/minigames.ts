/**
 * 童玩小游戏（对对碰、跟鼓师打鼓、斗擦胶、撒鱼粮、弹珠台）：关卡、奖励、每日上限。
 * 服务器和客户端共用：
 * - 关卡难度、奖励金额、每日上限都写在这里；发不发钱只由服务器决定。
 * - 弹珠台：服务器给每一颗弹珠一个随机数（seed），落点由下面的 marbleRun(力度, seed) 算出来；
 *   客户端用同一个函数播动画，所以看到的就是服务器算的那一格。函数只用加减乘除和开方（各平台结果一样）。
 * - 打鼓：鼓师打的顺序由服务器给的 seed 决定（drumPattern），服务器知道这一关至少要多久。
 */

/** 不用花钱、赢了发钱的四个小游戏（弹珠台另算：要先付钱） */
export type MgGame = 'match' | 'drum' | 'eraser' | 'fish';
export const MG_GAMES: MgGame[] = ['match', 'drum', 'eraser', 'fish'];
/** 每个游戏在哪个地方玩（SPOTS 的 id） */
export const MG_SPOT: Record<MgGame | 'marble', string> = { match: 'shadow', drum: 'drum', eraser: 'eraser', fish: 'fish', marble: 'marble' };

export interface MgRule {
  name: string;
  maxLevel: number;
  /** 过这一关发多少金币（0 = 不发） */
  reward: (level: number) => number;
  /** 每天最多发多少金币 / 最多发几次 */
  capCoins: number;
  capWins: number;
  /** 一局至少要玩多久才算数（毫秒，防止脚本秒报） */
  minMs: (level: number) => number;
  /** 输了以后的关卡 */
  onLose: (level: number) => number;
}

// ───────── 对对碰 ─────────
/** 第 1 关 3 对，每关多 1 对，最多 8 对 */
export const matchPairs = (level: number) => Math.min(8, 2 + Math.max(1, level));
/** 可以翻几次（一次 = 翻两张）：每关越来越紧 */
export const matchMoves = (level: number) => matchPairs(level) * 2 + 2 - Math.floor(level / 2);

// ───────── 跟鼓师打鼓（像 Simon：鼓师打一串，你照顺序打回去） ─────────
/** 三样乐器：鼓、锣、钹 */
export const DRUM_PADS = ['鼓', '锣', '钹'] as const;
/** 第 n 关打几下：第 1 关 3 下，每关多 1 下 */
export const drumBeats = (level: number) => 2 + Math.max(1, level);
/** 两下之间隔多久（毫秒）：越来越快 */
export const drumGap = (level: number) => Math.max(300, 700 - level * 40);
export function drumPattern(seed: number, level: number): number[] {
  const r = rng(seed); const out: number[] = [];
  for (let i = 0; i < drumBeats(level); i++) out.push(Math.floor(r() * 3));
  return out;
}

// ───────── 斗擦胶：摊主小孩的瞄准（关卡越高瞄得越准） ─────────
export const eraserKid = (level: number) => {
  const l = Math.max(1, Math.min(6, level));
  return {
    /** 方向偏多少（弧度，左右各一半） */
    spread: [0, 1.5, 1.05, 0.75, 0.5, 0.32, 0.2][l],
    /** 力度：想弹的距离 × (lo..hi) */
    lo: [0, 0.35, 0.5, 0.62, 0.72, 0.8, 0.86][l],
    hi: [0, 1.75, 1.55, 1.4, 1.28, 1.2, 1.12][l],
  };
};

// ───────── 撒鱼粮：金锦鲤 ─────────
/** 金锦鲤游多快（画面像素/帧），每抓到一条变快一点 */
export const koiSpeed = (level: number) => 0.9 + Math.min(5, level) * 0.25;
/** 金锦鲤出现以后留多久（毫秒） */
export const KOI_STAY_MS = 9000;

export const MG_RULES: Record<MgGame, MgRule> = {
  match: {
    name: '对对碰', maxLevel: 6,
    reward: (l) => 2 + l, capCoins: 30, capWins: 99,
    minMs: (l) => matchPairs(l) * 900,
    onLose: (l) => l,
  },
  drum: {
    name: '打大鼓', maxLevel: 12,
    // 第 1、2 关是热身，第 3 关起才有金币
    reward: (l) => (l < 3 ? 0 : Math.min(8, l - 1)), capCoins: 25, capWins: 99,
    minMs: (l) => 600 + drumBeats(l) * drumGap(l) + drumBeats(l) * 150,
    onLose: () => 1,
  },
  eraser: {
    name: '斗擦胶', maxLevel: 6,
    reward: (l) => 2 + l, capCoins: 40, capWins: 5,
    minMs: () => 2500,
    onLose: (l) => Math.max(1, l - 1),
  },
  fish: {
    name: '撒鱼粮', maxLevel: 6,
    reward: () => 2, capCoins: 10, capWins: 5,
    // 实际以服务器给的「金锦鲤几秒后出现」为准
    minMs: () => 4000,
    onLose: (l) => l,
  },
};
/** 金锦鲤几秒后出现（服务器随机，客户端照这个时间放出来） */
export const FISH_GOLD_MS = { min: 6000, max: 12000 };

// ───────── 弹珠台（付钱玩） ─────────
export const MARBLE = {
  price: 3, balls: 5, target: 180, win: 8, jackpotCoins: 15, jackpotNeed: 2, roundsPerDay: 15, roundMs: 5 * 60_000,
  W: 240, H: 320, slotY: 284, ballR: 5, pinR: 3.5,
  /** 底下 7 格：分界（x）和分数；中间窄窄的金杯 100 分，一局进 2 颗再加大奖 */
  edges: [0, 38, 76, 112, 128, 164, 202, 240],
  points: [10, 40, 20, 100, 20, 40, 10],
  jackpotSlot: 3,
};
export const MARBLE_PINS: Array<[number, number]> = (() => {
  const out: Array<[number, number]> = [];
  for (let row = 0; row < 7; row++) {
    const off = row % 2 ? 17 : 0;
    for (let x = 20 + off; x <= 222; x += 34) out.push([x, 64 + row * 30]);
  }
  return out;
})();

/** 一个可以重现的随机数（同一个 seed 在服务器和手机上得到同一串数） */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 弹珠从右边的弹道打上去，从顶上掉进钉子阵，最后落进底下一格。
 * power 0..1（越大越往左），seed 由服务器给。返回落进哪一格和每一帧的位置（客户端画动画用）。
 */
export function marbleRun(power: number, seed: number): { slot: number; path: Array<[number, number]> } {
  const M = MARBLE; const r = rng(seed);
  const p = Math.max(0, Math.min(1, Math.round(power * 1000) / 1000));
  let x = 214 - p * 180 + (r() - 0.5) * 24, y = 22, vx = -0.4 - p * 0.8 + (r() - 0.5) * 0.6, vy = 0.4;
  const R = M.ballR + M.pinR, path: Array<[number, number]> = [];
  for (let i = 0; i < 4000; i++) {
    vy += 0.11; x += vx; y += vy;
    if (x < M.ballR) { x = M.ballR; vx = -vx * 0.6; }
    if (x > M.W - M.ballR) { x = M.W - M.ballR; vx = -vx * 0.6; }
    for (const [px, py] of MARBLE_PINS) {
      const dx = x - px, dy = y - py, d2 = dx * dx + dy * dy;
      if (d2 >= R * R || d2 === 0) continue;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
      x = px + nx * R; y = py + ny * R;
      const dot = vx * nx + vy * ny;
      if (dot < 0) { vx -= 1.55 * dot * nx; vy -= 1.55 * dot * ny; }
      vx += (r() - 0.5) * 1.1;
      if (vy < 0.2) vy = 0.2;
    }
    if (vx > 4) vx = 4; if (vx < -4) vx = -4; if (vy > 6) vy = 6;
    path.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
    if (y >= M.slotY) break;
  }
  let slot = 0;
  for (let i = 0; i < M.points.length; i++) if (x >= M.edges[i]) slot = i;
  return { slot, path };
}
