import { randomUUID, randomInt } from 'node:crypto';
import type { Client } from '@colyseus/core';
import { MG_GAMES, MG_RULES, MG_SPOT, MARBLE, FISH_GOLD_MS, marbleRun, SPOTS, PSTATE, MSG, klDay, type MgGame } from '@nanyang/shared';
import { pool, tx } from '../db.ts';
import { credit, spend } from '../wallet.ts';

/**
 * 童玩小游戏的奖励（对对碰、跟鼓师打鼓、斗擦胶、撒鱼粮、弹珠台）。
 * 规则：
 * - 关卡记在服务器（下次来接着玩）；开一局时服务器发一张「局号」，赢了拿局号来领，一个局号只能用一次。
 * - 开局和领奖都要站在那个摊位前；一局太快报赢（比最快的人还快）不算。
 * - 每个游戏每天最多发多少金币 / 几次（minigame_daily），到了上限照样能玩、只是不再发。
 * - 弹珠台要先付钱：每颗弹珠落在哪一格由服务器算（给一个随机 seed + 你拉的力度，用共用的 marbleRun），客户端照同一个公式播动画。
 */
interface Ctx {
  state: { players: Map<string, any> };
  clients: Client[];
  playerIdOf: (sid: string) => string | undefined;
}
interface Round { id: string; game: MgGame; level: number; t0: number; minMs: number }
interface MarbleRound { id: string; key: string; left: number; score: number; jp: number; seen: Set<number>; lastShot: number; endsAt: number; won: number }

export class Minigames {
  private rounds = new Map<string, Round>();
  private marbles = new Map<string, MarbleRound>();
  private busy = new Set<string>();

  constructor(private c: Ctx) {}

  register(on: (type: string, fn: (client: Client, m: any) => void) => void) {
    on('mg.start', (cl, m) => { void this.start(cl, m); });
    on('mg.end', (cl, m) => { void this.end(cl, m); });
    on('marble.start', (cl, m) => { void this.marbleStart(cl, m); });
    on('marble.shot', (cl, m) => { void this.marbleShot(cl, m); });
  }

  /** 站在这个摊位前（走动状态，不是坐着/在做别的） */
  private near(sid: string, spotId: string) {
    const p = this.c.state.players.get(sid); const sp = SPOTS.find((x) => x.id === spotId);
    return !!p && !!sp && p.st === PSTATE.MOVING && Math.hypot(p.x - sp.x, p.z - sp.z) < sp.r + 0.8;
  }
  /** 已经离开房间的人留下的局：顺手清掉 */
  private sweep() {
    const live = new Set(this.c.clients.map((x) => x.sessionId));
    for (const k of this.rounds.keys()) if (!live.has(k.split('|')[0])) this.rounds.delete(k);
    for (const k of this.marbles.keys()) if (!live.has(k)) this.marbles.delete(k);
  }

  private async progress(pid: string, game: string) {
    const r = await pool.query('SELECT level, best FROM minigame_progress WHERE player_id=$1 AND game=$2', [pid, game]);
    return { level: Number(r.rows[0]?.level ?? 1), best: Number(r.rows[0]?.best ?? 0) };
  }
  private async today(pid: string, game: string) {
    const r = await pool.query('SELECT wins, coins, rounds FROM minigame_daily WHERE player_id=$1 AND game=$2 AND day=$3', [pid, game, klDay(Date.now())]);
    return { wins: Number(r.rows[0]?.wins ?? 0), coins: Number(r.rows[0]?.coins ?? 0), rounds: Number(r.rows[0]?.rounds ?? 0) };
  }
  /** 占用今天的额度：最多发 want，不超过每日金币和次数上限；返回真的能发多少 */
  private async reserve(pid: string, game: MgGame, want: number): Promise<number> {
    const R = MG_RULES[game]; const day = klDay(Date.now());
    return tx(async (c) => {
      await c.query('INSERT INTO minigame_daily(player_id, game, day) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [pid, game, day]);
      const r = await c.query(
        `WITH o AS (SELECT coins, wins FROM minigame_daily WHERE player_id=$1 AND game=$2 AND day=$3 FOR UPDATE)
         UPDATE minigame_daily m SET coins = m.coins + LEAST($4::int, $5::int - o.coins), wins = m.wins + 1
         FROM o WHERE m.player_id=$1 AND m.game=$2 AND m.day=$3 AND o.wins < $6 AND o.coins < $5
         RETURNING m.coins - o.coins AS pay`, [pid, game, day, want, R.capCoins, R.capWins]);
      return Number(r.rows[0]?.pay ?? 0);
    });
  }
  private status(game: MgGame, d: { wins: number; coins: number }) {
    const R = MG_RULES[game];
    return { paid: d.coins, cap: R.capCoins, wins: d.wins, capWins: R.capWins, full: d.coins >= R.capCoins || d.wins >= R.capWins };
  }

  // ───────── 对对碰 / 打鼓 / 斗擦胶 / 撒鱼粮 ─────────
  private async start(cl: Client, m: { game?: unknown }) {
    const sid = cl.sessionId; const game = m?.game as MgGame; const pid = this.c.playerIdOf(sid);
    if (!pid || !MG_GAMES.includes(game)) return;
    if (!this.near(sid, MG_SPOT[game])) return cl.send('mg.round', { game, ok: false, reason: 'not_here' });
    const key = `${sid}|${game}`; if (this.busy.has(key)) return; this.busy.add(key);
    try {
      this.sweep();
      const R = MG_RULES[game]; const pr = await this.progress(pid, game); const d = await this.today(pid, game);
      const level = Math.max(1, Math.min(R.maxLevel, pr.level));
      const seed = randomInt(0, 2 ** 32 - 1);
      const goldIn = game === 'fish' ? randomInt(FISH_GOLD_MS.min, FISH_GOLD_MS.max) : 0;
      const round: Round = { id: randomUUID(), game, level, t0: Date.now(), minMs: game === 'fish' ? goldIn : R.minMs(level) };
      this.rounds.set(key, round);
      cl.send('mg.round', { game, ok: true, round: round.id, level, best: pr.best, seed, goldIn, reward: R.reward(level), maxLevel: R.maxLevel, ...this.status(game, d) });
    } catch { cl.send('mg.round', { game, ok: false, reason: 'db' }); }
    finally { this.busy.delete(key); }
  }

  private async end(cl: Client, m: { game?: unknown; round?: unknown; win?: unknown; draw?: unknown }) {
    const sid = cl.sessionId; const game = m?.game as MgGame; const pid = this.c.playerIdOf(sid);
    if (!pid || !MG_GAMES.includes(game)) return;
    const key = `${sid}|${game}`; const r = this.rounds.get(key);
    if (!r || r.id !== m?.round) return cl.send('mg.result', { game, ok: false, reason: 'no_round' });
    this.rounds.delete(key); // 一个局号只能用一次（连按两次也只算一次）
    if (!this.near(sid, MG_SPOT[game])) return cl.send('mg.result', { game, ok: false, reason: 'not_here' });
    const R = MG_RULES[game]; const win = m?.win === true;
    try {
      const pr = await this.progress(pid, game);
      let pay = 0, want = 0, level = r.level, tooFast = false;
      if (win) {
        tooFast = Date.now() - r.t0 < r.minMs;
        if (!tooFast) {
          want = R.reward(r.level);
          if (want > 0) {
            const can = await this.reserve(pid, game, want);
            if (can > 0) { const cr = await credit(pid, 'coins', can, `mg_${game}`, r.id, `mg:${game}:${r.id}`); pay = cr.applied; cl.send(MSG.S_WALLET, cr.wallet); }
          }
          level = Math.min(R.maxLevel, r.level + 1);
        }
      } else level = m?.draw === true ? r.level : R.onLose(r.level);
      const best = win && !tooFast ? Math.max(pr.best, r.level) : pr.best;
      await pool.query(
        `INSERT INTO minigame_progress(player_id, game, level, best) VALUES ($1,$2,$3,$4)
         ON CONFLICT (player_id, game) DO UPDATE SET level=$3, best=GREATEST(minigame_progress.best, $4), updated_at=now()`, [pid, game, level, best]);
      cl.send('mg.result', { game, ok: true, round: r.id, win: win && !tooFast, tooFast, pay, want, cleared: r.level, level, best, ...this.status(game, await this.today(pid, game)) });
    } catch { cl.send('mg.result', { game, ok: false, reason: 'db' }); }
  }

  // ───────── 弹珠台：付钱玩，服务器算落点 ─────────
  private marbleView(g: MarbleRound) { return { round: g.id, left: g.left, score: g.score, jp: g.jp, won: g.won }; }

  private async marbleStart(cl: Client, m: { requestId?: unknown }) {
    const sid = cl.sessionId; const pid = this.c.playerIdOf(sid);
    const rid = typeof m?.requestId === 'string' ? m.requestId.slice(0, 64) : '';
    if (!pid || !rid) return;
    if (!this.near(sid, MG_SPOT.marble)) return cl.send('marble.round', { ok: false, reason: 'not_here' });
    const cur = this.marbles.get(sid);
    if (cur && cur.left > 0 && Date.now() < cur.endsAt) return cl.send('marble.round', { ok: true, running: true, ...this.marbleView(cur) });
    const lk = `marble|${pid}`; if (this.busy.has(lk)) return; this.busy.add(lk);
    try {
      this.sweep();
      const key = `marble:${pid}:${rid}`;
      if (cur?.key === key) return cl.send('marble.round', { ok: true, ...this.marbleView(cur) });
      const d = await this.today(pid, 'marble');
      if (d.rounds >= MARBLE.roundsPerDay) return cl.send('marble.round', { ok: false, reason: 'limit', rounds: d.rounds });
      const id = randomUUID();
      const r = await spend(pid, 'coins', MARBLE.price, 'marble_round', id, key);
      if (!r.ok) return cl.send('marble.round', { ok: false, reason: 'insufficient', wallet: r.wallet });
      cl.send(MSG.S_WALLET, r.wallet);
      if (r.replay) return cl.send('marble.round', { ok: false, reason: 'replay' });
      await pool.query(
        `INSERT INTO minigame_daily(player_id, game, day, rounds) VALUES ($1,'marble',$2,1)
         ON CONFLICT (player_id, game, day) DO UPDATE SET rounds=minigame_daily.rounds+1`, [pid, klDay(Date.now())]);
      const g: MarbleRound = { id, key, left: MARBLE.balls, score: 0, jp: 0, seen: new Set(), lastShot: 0, endsAt: Date.now() + MARBLE.roundMs, won: 0 };
      this.marbles.set(sid, g);
      cl.send('marble.round', { ok: true, rounds: d.rounds + 1, ...this.marbleView(g) });
    } catch { cl.send('marble.round', { ok: false, reason: 'db' }); }
    finally { this.busy.delete(lk); }
  }

  private async marbleShot(cl: Client, m: { round?: unknown; seq?: unknown; power?: unknown }) {
    const sid = cl.sessionId; const pid = this.c.playerIdOf(sid); const g = this.marbles.get(sid);
    const seq = typeof m?.seq === 'number' && Number.isInteger(m.seq) ? m.seq : 0;
    if (!pid || !g || g.id !== m?.round || !seq || g.seen.has(seq)) return;
    const now = Date.now();
    if (g.left <= 0 || now > g.endsAt) return cl.send('marble.ball', { round: g.id, seq, ok: false, reason: 'ended' });
    if (!this.near(sid, MG_SPOT.marble)) return cl.send('marble.ball', { round: g.id, seq, ok: false, reason: 'not_here' });
    if (now - g.lastShot < 400) return cl.send('marble.ball', { round: g.id, seq, ok: false, reason: 'slow' });
    g.seen.add(seq); g.lastShot = now; g.left--;
    const power = typeof m?.power === 'number' && Number.isFinite(m.power) ? Math.max(0, Math.min(1, Math.round(m.power * 1000) / 1000)) : 0;
    const seed = randomInt(0, 2 ** 32 - 1);
    const { slot } = marbleRun(power, seed);
    const pts = MARBLE.points[slot]; g.score += pts;
    let jackpot = 0, pay = 0;
    if (slot === MARBLE.jackpotSlot) {
      g.jp++;
      if (g.jp === MARBLE.jackpotNeed) {
        try { const r = await credit(pid, 'coins', MARBLE.jackpotCoins, 'marble_jackpot', g.id, `marblejp:${g.id}`); jackpot = r.applied; g.won += jackpot; cl.send(MSG.S_WALLET, r.wallet); } catch { /* 记账失败：不报大奖 */ }
      }
    }
    const done = g.left <= 0, win = done && g.score >= MARBLE.target;
    if (win) {
      try { const r = await credit(pid, 'coins', MARBLE.win, 'marble_win', g.id, `marblewin:${g.id}`); pay = r.applied; g.won += pay; cl.send(MSG.S_WALLET, r.wallet); } catch { /* 同上 */ }
    }
    if (jackpot || pay) void pool.query(`UPDATE minigame_daily SET coins=coins+$3, wins=wins+$4 WHERE player_id=$1 AND game='marble' AND day=$2`, [pid, klDay(now), jackpot + pay, win ? 1 : 0]).catch(() => {});
    cl.send('marble.ball', { ok: true, seq, power, seed, slot, pts, jackpot, done, win, pay, ...this.marbleView(g) });
    if (done) this.marbles.delete(sid);
  }
}
