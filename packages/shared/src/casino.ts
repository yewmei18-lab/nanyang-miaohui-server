/**
 * 游艺档：四个小游戏，只用游戏里的金币（没有真钱）。
 * 所有发牌、掷骰、转轮和赔多少都由服务器决定；这里只放两边都要用的规则和数字。
 */
export const CASINO_BETS = [2, 5, 10] as const;
/** 每人每天最多玩几局（四个游戏加起来） */
export const CASINO_DAILY_MAX = 30;
export type CasinoGame = 'bj' | 'p89' | 'dice' | 'slot';
export const CASINO_GAMES: Record<CasinoGame, string> = { bj: '21点', p89: '89点', dice: '比大小', slot: '老虎机' };
export const isCasinoBet = (n: unknown): n is (typeof CASINO_BETS)[number] => typeof n === 'number' && (CASINO_BETS as readonly number[]).includes(n);

// ───────── 牌 ─────────
export const SUITS = ['♠', '♥', '♦', '♣'] as const;
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
/** 一张牌写成 "A♠"、"10♥" 这样的字符串 */
export type Card = string;
export const cardRank = (c: Card) => c.slice(0, -1);
export const cardSuit = (c: Card) => c.slice(-1);
export const isRed = (c: Card) => cardSuit(c) === '♥' || cardSuit(c) === '♦';

/** 21点：A 算 1 或 11（哪个不爆用哪个），J/Q/K 算 10 */
export function bjTotal(cards: Card[]): number {
  let t = 0, aces = 0;
  for (const c of cards) { const r = cardRank(c); if (r === 'A') { aces++; t += 11; } else t += ['J', 'Q', 'K'].includes(r) ? 10 : Number(r); }
  while (t > 21 && aces > 0) { t -= 10; aces--; }
  return t;
}
export const isBlackjack = (cards: Card[]) => cards.length === 2 && bjTotal(cards) === 21;
/** 21点：庄家到 17 点（含软 17）就停 */
export const BJ_DEALER_STANDS = 17;
/** 21点：拿到黑杰克（头两张 A + 10/J/Q/K）赢 1.5 倍，取整数（往下） */
export const bjBlackjackWin = (bet: number) => Math.floor(bet * 1.5);

/** 89点：A=1，2–9 照点数，10/J/Q/K=0，加起来只看个位 */
export function p89Point(cards: Card[]): number {
  let t = 0;
  for (const c of cards) { const r = cardRank(c); t += r === 'A' ? 1 : ['10', 'J', 'Q', 'K'].includes(r) ? 0 : Number(r); }
  return t % 10;
}
export type P89Pick = 'player' | 'banker' | 'tie';
export const P89_PICKS: Record<P89Pick, string> = { player: '闲', banker: '庄', tie: '和' };
/** 89点赔法（拿回多少，含本金）：押中闲 ×2；押中庄 ×2，但庄 6 点赢只赢一半；押中和 ×9；开和时押闲/庄退回本金 */
export function p89Payout(pick: P89Pick, win: P89Pick, bankerPoint: number, bet: number): number {
  if (pick === win) {
    if (win === 'tie') return bet * 9;
    if (win === 'banker' && bankerPoint === 6) return bet + Math.floor(bet / 2);
    return bet * 2;
  }
  return win === 'tie' ? bet : 0;
}

// ───────── 比大小（三粒骰子） ─────────
export type DicePick = 'big' | 'small';
export const DICE_PICKS: Record<DicePick, string> = { big: '大', small: '小' };
/** 11–17 大，4–10 小；三粒一样（围骰）大小都输。押中 ×2（含本金） */
export function diceWinner(d: number[]): DicePick | null {
  if (d[0] === d[1] && d[1] === d[2]) return null;
  const s = d[0] + d[1] + d[2];
  return s >= 11 ? 'big' : 'small';
}

// ───────── 老虎机 ─────────
/** 每个转轮 20 格；weight = 有几格。中三个一样拿回 bet×pay3；任意两个旺桔拿回 bet×2。理论返还约 95% */
export const SLOT_SYMBOLS = [
  { id: 'orange', icon: '🍊', name: '旺桔', weight: 7, pay3: 5 },
  { id: 'lantern', icon: '🏮', name: '灯笼', weight: 5, pay3: 8 },
  { id: 'hongbao', icon: '🧧', name: '红包', weight: 3, pay3: 15 },
  { id: 'lion', icon: '🦁', name: '狮头', weight: 2, pay3: 30 },
  { id: 'cat', icon: '🐱', name: '橘猫', weight: 2, pay3: 40 },
  { id: 'seven', icon: '7', name: '七', weight: 1, pay3: 100 },
] as const;
export type SlotSymbol = (typeof SLOT_SYMBOLS)[number]['id'];
export const SLOT_TWO_ORANGE = 2;
/** 这三格拿回几倍（0 = 没中） */
export function slotMultiplier(reels: string[]): number {
  if (reels.length !== 3) return 0;
  if (reels[0] === reels[1] && reels[1] === reels[2]) return SLOT_SYMBOLS.find((s) => s.id === reels[0])?.pay3 ?? 0;
  if (reels.filter((r) => r === 'orange').length === 2) return SLOT_TWO_ORANGE;
  return 0;
}
