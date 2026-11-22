import { randomUUID, randomInt } from 'node:crypto';
import type { Client } from '@colyseus/core';
import {
  CASINO_DAILY_MAX, isCasinoBet, SPOTS, SUITS, RANKS, SLOT_SYMBOLS, slotMultiplier, bjTotal, isBlackjack, bjBlackjackWin, BJ_DEALER_STANDS,
  p89Point, p89Payout, diceWinner, MSG, klDay, type CasinoGame, type Card, type P89Pick, type DicePick,
} from '@nanyang/shared';
import { pool } from '../db.ts';
import { spend, credit, refund } from '../wallet.ts';

/**
 * 游艺档（21点、89点、比大小、老虎机）——只用游戏金币。
 * 规则：
 * - 发牌、掷骰、转轮、赔多少全部在服务器算；客户端只送“押多少、押哪边、要牌/停牌”。
 * - 每一局有服务器的局号；同一个 requestId 重送不会再扣一次（扣钱和赢钱都用固定的 key）。
 * - 要站在游艺档前才能下注；每人每天四个游戏加起来最多 CASINO_DAILY_MAX 局（局一开就算）。
 * - 21点的牌放在服务器内存；结算时数据库那一行 payout 还是空的才会结算（只结一次）。
 */
interface Ctx {
  state: { players: Map<string, any> };
  playerIdOf: (sid: string) => string | undefined;
}
interface BjHand { roundId: string; pid: string; rid: string; bet: number; player: Card[]; dealer: Card[]; timer: NodeJS.Timeout }

const SPOT = SPOTS.find((s) => s.id === 'casino')!;
const GAMES: CasinoGame[] = ['bj', 'p89', 'dice', 'slot'];
const BET_KEY = (pid: string, rid: string) => `casino:bet:${pid}:${rid}`;
const WIN_KEY = (roundId: string) => `casino:win:${roundId}`;
const BJ_IDLE_MS = 5 * 60_000; // 21点开了不动：5 分钟后自动停牌结算
const BOOT = Date.now();

// 同一个进程里所有房间共用（一个人换了房间，手上的 21点 还在）
const busy = new Set<string>();
const hands = new Map<string, BjHand>(); // playerId → 正在打的 21点
const shoes = new Map<string, Card[]>(); // playerId → 6 副牌的牌靴
let staleSwept = false;

function newShoe(): Card[] {
  const s: Card[] = [];
  for (let d = 0; d < 6; d++) for (const su of SUITS) for (const r of RANKS) s.push(`${r}${su}`);
  for (let i = s.length - 1; i > 0; i--) { const j = randomInt(i + 1); [s[i], s[j]] = [s[j], s[i]]; }
  return s;
}
function draw(pid: string): Card {
  let s = shoes.get(pid);
  if (!s || s.length < 78) { s = newShoe(); shoes.set(pid, s); } // 剩不到 1/4 就换新牌靴
  return s.pop()!;
}
/** 一副新洗的 52 张（89点每局一副新牌） */
function freshDeck(): Card[] {
  const s: Card[] = [];
  for (const su of SUITS) for (const r of RANKS) s.push(`${r}${su}`);
  for (let i = s.length - 1; i > 0; i--) { const j = randomInt(i + 1); [s[i], s[j]] = [s[j], s[i]]; }
  return s;
}

/** 89点（百家乐的补牌规则）：两张 8、9 点直接开；闲 0–5 补；庄看自己点数和闲补的那张决定补不补 */
function dealP89() {
  const deck = freshDeck(); const val = (c: Card) => p89Point([c]);
  const player = [deck.pop()!, deck.pop()!], banker = [deck.pop()!, deck.pop()!];
  const pp = p89Point(player), bp = p89Point(banker);
  if (pp < 8 && bp < 8) {
    let p3: number | null = null;
    if (pp <= 5) { const c = deck.pop()!; player.push(c); p3 = val(c); }
    const b = bp;
    const bankerDraws = p3 === null ? b <= 5
      : b <= 2 ? true : b === 3 ? p3 !== 8 : b === 4 ? p3 >= 2 && p3 <= 7 : b === 5 ? p3 >= 4 && p3 <= 7 : b === 6 ? p3 === 6 || p3 === 7 : false;
    if (bankerDraws) banker.push(deck.pop()!);
  }
  const fp = p89Point(player), fb = p89Point(banker);
  const win: P89Pick = fp > fb ? 'player' : fb > fp ? 'banker' : 'tie';
  return { player, banker, pp: fp, bp: fb, win };
}

function spinSlot(): string[] {
  const total = SLOT_SYMBOLS.reduce((a, s) => a + s.weight, 0);
  return [0, 1, 2].map(() => { let r = randomInt(total); for (const s of SLOT_SYMBOLS) { if (r < s.weight) return s.id; r -= s.weight; } return SLOT_SYMBOLS[0].id; });
}

export class Casino {
  constructor(private c: Ctx) {
    if (!staleSwept) { staleSwept = true; void this.sweepStale(); }
  }

  register(on: (type: string, fn: (client: Client, m: any) => void) => void) {
    on('casino.get', (cl) => { void this.info(cl); });
    on('casino.play', (cl, m) => { void this.play(cl, m); });
    on('casino.bj', (cl, m) => { void this.bjAction(cl, m); });
  }

  private async roundsToday(pid: string) {
    const r = await pool.query('SELECT count(*)::int n FROM casino_rounds WHERE player_id=$1 AND day=$2', [pid, klDay(Date.now())]);
    return r.rows[0].n as number;
  }
  private bjView(h: BjHand, done: boolean, payout?: number, outcome?: string) {
    return {
      roundId: h.roundId, bet: h.bet, player: h.player, pv: bjTotal(h.player),
      dealer: done ? h.dealer : [h.dealer[0], '?'], dv: done ? bjTotal(h.dealer) : bjTotal([h.dealer[0]]),
      done, payout: payout ?? null, outcome: outcome ?? null,
    };
  }

  private async info(cl: Client) {
    const pid = this.c.playerIdOf(cl.sessionId); if (!pid) return;
    try {
      const n = await this.roundsToday(pid); const h = hands.get(pid);
      cl.send('casino.info', { left: Math.max(0, CASINO_DAILY_MAX - n), max: CASINO_DAILY_MAX, bj: h ? this.bjView(h, false) : null });
    } catch { cl.send('casino.info', { left: null, max: CASINO_DAILY_MAX, bj: null }); }
  }

  private async play(cl: Client, m: { game?: unknown; bet?: unknown; pick?: unknown; requestId?: unknown }) {
    const sid = cl.sessionId; const pid = this.c.playerIdOf(sid); const p = this.c.state.players.get(sid);
    const rid = typeof m?.requestId === 'string' ? m.requestId.slice(0, 64) : '';
    const game = m?.game as CasinoGame; const bet = m?.bet;
    const fail = (reason: string, extra: Record<string, unknown> = {}) => cl.send('casino.result', { ok: false, reason, game, requestId: rid, ...extra });
    if (!pid || !p || !rid || !GAMES.includes(game) || !isCasinoBet(bet)) return fail('bad');
    const pick = m?.pick;
    if (game === 'p89' && !['player', 'banker', 'tie'].includes(pick as string)) return fail('bad');
    if (game === 'dice' && !['big', 'small'].includes(pick as string)) return fail('bad');
    if (Math.hypot(p.x - SPOT.x, p.z - SPOT.z) > SPOT.r + 1) return fail('far');
    if (busy.has(pid)) return fail('busy');
    busy.add(pid);
    try {
      // 同一个请求再送一次：把那一局原样送回去（赢的钱用同一个 key 再补一次，已经给过就不会重复给）
      const ex = await pool.query('SELECT id, game, bet, payout, detail FROM casino_rounds WHERE player_id=$1 AND request_id=$2', [pid, rid]);
      if (ex.rowCount) {
        const r = ex.rows[0];
        if (r.payout > 0) { const w = await credit(pid, 'coins', r.payout, 'casino_win', r.id, WIN_KEY(r.id)); cl.send(MSG.S_WALLET, w.wallet); }
        const h = hands.get(pid);
        const left = Math.max(0, CASINO_DAILY_MAX - await this.roundsToday(pid));
        if (r.game === 'bj' && r.payout === null) return cl.send('casino.bj', { ...(h && h.roundId === r.id ? this.bjView(h, false) : { roundId: r.id }), left, replay: true });
        return cl.send('casino.result', { ok: true, replay: true, game: r.game, requestId: rid, roundId: r.id, bet: r.bet, payout: r.payout, detail: r.detail, left });
      }
      if (game === 'bj' && hands.has(pid)) { const h = hands.get(pid)!; return cl.send('casino.bj', { ...this.bjView(h, false), left: null, open: true }); }
      const n = await this.roundsToday(pid);
      if (n >= CASINO_DAILY_MAX) return fail('limit', { left: 0 });
      const sp = await spend(pid, 'coins', bet, 'casino_bet', game, BET_KEY(pid, rid));
      if (!sp.ok) { if (sp.wallet) cl.send(MSG.S_WALLET, sp.wallet); return fail(sp.error === 'insufficient' ? 'insufficient' : 'bad'); }
      cl.send(MSG.S_WALLET, sp.wallet);
      const roundId = randomUUID(); const day = klDay(Date.now());
      const left = Math.max(0, CASINO_DAILY_MAX - n - 1);

      if (game === 'bj') {
        const h: BjHand = { roundId, pid, rid, bet, player: [], dealer: [], timer: setTimeout(() => {}, 0) };
        h.player.push(draw(pid)); h.dealer.push(draw(pid)); h.player.push(draw(pid)); h.dealer.push(draw(pid));
        await this.insertRound(pid, rid, roundId, 'bj', bet, null, { player: h.player, dealer: h.dealer }, day, BET_KEY(pid, rid));
        hands.set(pid, h);
        // 有人头两张就是 21：马上开牌
        if (isBlackjack(h.player) || isBlackjack(h.dealer)) return await this.bjSettle(cl, h, left);
        this.armIdle(h);
        return cl.send('casino.bj', { ...this.bjView(h, false), left });
      }

      let payout = 0; let detail: Record<string, unknown>;
      if (game === 'slot') {
        const reels = spinSlot(); const mult = slotMultiplier(reels); payout = bet * mult; detail = { reels, mult };
      } else if (game === 'dice') {
        const d = [1 + randomInt(6), 1 + randomInt(6), 1 + randomInt(6)]; const win = diceWinner(d);
        payout = win === pick ? bet * 2 : 0; detail = { dice: d, sum: d[0] + d[1] + d[2], win, pick };
      } else {
        const r = dealP89(); payout = p89Payout(pick as P89Pick, r.win, r.bp, bet); detail = { ...r, pick };
      }
      await this.insertRound(pid, rid, roundId, game, bet, payout, detail, day, BET_KEY(pid, rid));
      if (payout > 0) { const w = await credit(pid, 'coins', payout, 'casino_win', roundId, WIN_KEY(roundId)); cl.send(MSG.S_WALLET, w.wallet); }
      cl.send('casino.result', { ok: true, game, requestId: rid, roundId, bet, payout, detail, left });
    } catch { fail('db'); }
    finally { busy.delete(pid); }
  }

  /** 记下这一局；记不进去就把刚扣的钱退回去 */
  private async insertRound(pid: string, rid: string, roundId: string, game: CasinoGame, bet: number, payout: number | null, detail: unknown, day: string, betKey: string) {
    try {
      await pool.query(
        `INSERT INTO casino_rounds(id, player_id, game, bet, payout, detail, request_id, day, settled_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [roundId, pid, game, bet, payout, JSON.stringify(detail), rid, day, payout === null ? null : new Date()]);
    } catch (e) { await refund(pid, betKey, 'casino_refund').catch(() => {}); throw e; }
  }

  private armIdle(h: BjHand) {
    clearTimeout(h.timer);
    h.timer = setTimeout(() => { if (hands.get(h.pid) === h) void this.bjSettle(null, h, null); }, BJ_IDLE_MS);
  }

  private async bjAction(cl: Client, m: { action?: unknown; roundId?: unknown }) {
    const pid = this.c.playerIdOf(cl.sessionId); if (!pid) return;
    const h = hands.get(pid);
    if (!h || h.roundId !== m?.roundId) return cl.send('casino.result', { ok: false, reason: 'no_hand', game: 'bj' });
    if (busy.has(pid)) return; busy.add(pid);
    try {
      if (m?.action === 'hit') {
        h.player.push(draw(pid)); const t = bjTotal(h.player);
        if (t >= 21) return await this.bjSettle(cl, h, null); // 爆了或刚好 21：自动开牌
        this.armIdle(h);
        return cl.send('casino.bj', { ...this.bjView(h, false), left: null });
      }
      if (m?.action === 'stand') return await this.bjSettle(cl, h, null);
    } catch { cl.send('casino.result', { ok: false, reason: 'db', game: 'bj' }); }
    finally { busy.delete(pid); }
  }

  /** 21点开牌结算：庄家补到 17 点以上；数据库里这一局还没结才结（只结一次） */
  private async bjSettle(cl: Client | null, h: BjHand, left: number | null) {
    clearTimeout(h.timer);
    const pt = bjTotal(h.player);
    const pBJ = isBlackjack(h.player), dBJ = isBlackjack(h.dealer);
    if (pt <= 21 && !pBJ && !dBJ) while (bjTotal(h.dealer) < BJ_DEALER_STANDS) h.dealer.push(draw(h.pid));
    const dt = bjTotal(h.dealer);
    let payout = 0, outcome: string;
    if (pBJ && dBJ) { payout = h.bet; outcome = 'push'; }
    else if (pBJ) { payout = h.bet + bjBlackjackWin(h.bet); outcome = 'blackjack'; }
    else if (dBJ) outcome = 'dealer_bj';
    else if (pt > 21) outcome = 'bust';
    else if (dt > 21) { payout = h.bet * 2; outcome = 'dealer_bust'; }
    else if (pt > dt) { payout = h.bet * 2; outcome = 'win'; }
    else if (pt === dt) { payout = h.bet; outcome = 'push'; }
    else outcome = 'lose';
    const detail = { player: h.player, dealer: h.dealer, pv: pt, dv: dt, outcome };
    const u = await pool.query(`UPDATE casino_rounds SET payout=$2, detail=$3, settled_at=now() WHERE id=$1 AND payout IS NULL RETURNING id`, [h.roundId, payout, JSON.stringify(detail)]);
    if (hands.get(h.pid) === h) hands.delete(h.pid);
    if (!u.rowCount) return;
    let wallet = null;
    if (payout > 0) wallet = (await credit(h.pid, 'coins', payout, 'casino_win', h.roundId, WIN_KEY(h.roundId))).wallet;
    if (!cl) return;
    if (wallet) cl.send(MSG.S_WALLET, wallet);
    if (left === null) left = Math.max(0, CASINO_DAILY_MAX - await this.roundsToday(h.pid).catch(() => CASINO_DAILY_MAX));
    cl.send('casino.bj', { ...this.bjView(h, true, payout, outcome), left });
  }

  /** 服务器重启前没打完的 21点：本金退回，这一局记成和 */
  private async sweepStale() {
    try {
      const r = await pool.query(`SELECT id, player_id, request_id, bet FROM casino_rounds WHERE game='bj' AND payout IS NULL AND at < $1`, [new Date(BOOT)]);
      for (const x of r.rows) {
        const u = await pool.query(`UPDATE casino_rounds SET payout=bet, detail=detail || '{"outcome":"void"}'::jsonb, settled_at=now() WHERE id=$1 AND payout IS NULL RETURNING id`, [x.id]);
        if (u.rowCount) await refund(x.player_id, BET_KEY(x.player_id, x.request_id), 'casino_void');
      }
    } catch { /* */ }
  }
}
