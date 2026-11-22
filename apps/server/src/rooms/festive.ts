import { randomUUID, randomInt } from 'node:crypto';
import type { Client } from '@colyseus/core';
import {
  SPOTS, PSTATE, MSG, klDay, klMonth, prevSeason, seasonDaysLeft, angpaoPick, ANGPAO_BIG, GOLDFISH, goldfishPay, goldfishPaper,
  ORANGE_SEASON_PRIZES,
} from '@nanyang/shared';
import { pool, tx } from '../db.ts';
import { credit, spend } from '../wallet.ts';
import { RIDDLES, RIDDLE_PAY, riddlesOfDay, riddleChoices } from '../riddles.ts';

/**
 * 年味小玩意：抽红包、夜市捞金鱼、每天换题的灯谜、舞狮接桔子月榜。
 * 规则：
 * - 抽多少、捞到几条算不算、答对没有、谁是月榜前三，都由服务器决定；客户端只送动作。
 * - 每一笔钱都有固定的 key（同一个 key 只发一次 / 只扣一次），每样都有每天（或每月）的上限。
 * - 抽红包、捞金鱼、猜灯谜都要站在那个地方（范围 r + 1 米以内）。
 */
interface Ctx {
  state: { players: Map<string, any> };
  clients: Client[];
  playerIdOf: (sid: string) => string | undefined;
}
interface FishRound { id: string; key: string; seed: number; t0: number; paperMs: number }

const spotOf = (id: string) => SPOTS.find((s) => s.id === id)!;
const angpaoKey = (pid: string, day: string) => `angpao:${pid}:${day}`;
const riddleKey = (pid: string, day: string, n: number) => `riddle:${pid}:${day}:${n}`;
const seasonKey = (season: string, rank: number, pid: string) => `orangeseason:${season}:${rank}:${pid}`;

// 同一个进程里所有房间共用：月榜结算（每分钟看一次 + 每次开新房间看一次）
const live = new Set<Festive>();
let closing: Promise<void> = Promise.resolve();
let ticker: NodeJS.Timeout | null = null;
/** 已经过完的月份（多等 1 分钟，免得 23:59:59 接到的那颗还没写进去） */
function closeSeasons(): Promise<void> {
  closing = closing.then(async () => {
    const cutoff = klMonth(Date.now() - 60_000);
    const r = await pool.query(
      `SELECT DISTINCT s.season FROM orange_season s LEFT JOIN orange_season_closed c ON c.season=s.season WHERE s.season < $1 AND c.season IS NULL ORDER BY s.season`, [cutoff]);
    for (const { season } of r.rows as Array<{ season: string }>) {
      try { await closeOne(season); } catch (e) { console.warn('[orange season]', season, (e as Error).message); }
    }
  }).catch((e) => { console.warn('[orange season] close failed', (e as Error).message); });
  return closing;
}
/** 结算一个月：定前三名（定了就不变）→ 发钱（固定 key）→ 都发好了才记「结算完」 */
async function closeOne(season: string) {
  // 名次只定一次：同分时先到这个数的人排前面
  const top = await pool.query(
    `SELECT player_id, count FROM orange_season WHERE season=$1 AND count>0 ORDER BY count DESC, updated_at ASC, player_id LIMIT $2`, [season, ORANGE_SEASON_PRIZES.length]);
  for (let i = 0; i < top.rows.length; i++) {
    await pool.query(`INSERT INTO orange_season_awards(season, rank, player_id, count, coins) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (season, rank) DO NOTHING`,
      [season, i + 1, top.rows[i].player_id, top.rows[i].count, ORANGE_SEASON_PRIZES[i]]);
  }
  const aw = await pool.query(`SELECT rank, player_id, coins FROM orange_season_awards WHERE season=$1 ORDER BY rank`, [season]);
  let all = true;
  for (const a of aw.rows as Array<{ rank: number; player_id: string; coins: number }>) {
    try {
      const c = await credit(a.player_id, 'coins', a.coins, 'orange_season', season, seasonKey(season, a.rank, a.player_id));
      await pool.query(`UPDATE orange_season_awards SET paid_at=COALESCE(paid_at, now()) WHERE season=$1 AND rank=$2`, [season, a.rank]);
      if (!c.replay) for (const f of live) f.tellPrize(a.player_id, c.wallet);
    } catch { all = false; } // 下一分钟再试（同一个 key 不会重复发）
  }
  if (all) await pool.query(`INSERT INTO orange_season_closed(season) VALUES ($1) ON CONFLICT DO NOTHING`, [season]);
}

export class Festive {
  private fish = new Map<string, FishRound>();
  private busy = new Set<string>();

  constructor(private c: Ctx) {
    live.add(this);
    if (!ticker) { ticker = setInterval(() => { void closeSeasons(); }, 60_000); ticker.unref?.(); }
    void closeSeasons();
  }
  dispose() { live.delete(this); }

  register(on: (type: string, fn: (client: Client, m: any) => void) => void) {
    on('angpao.get', (cl) => { void this.angpaoGet(cl); });
    on('angpao.draw', (cl) => { void this.angpaoDraw(cl); });
    on('goldfish.get', (cl) => { void this.fishGet(cl); });
    on('goldfish.start', (cl, m) => { void this.fishStart(cl, m); });
    on('goldfish.end', (cl, m) => { void this.fishEnd(cl, m); });
    on('riddle.get', (cl) => { void this.riddleGet(cl); });
    on('riddle.answer', (cl, m) => { void this.riddleAnswer(cl, m); });
    on('oseason.get', (cl) => { void this.seasonGet(cl); });
  }

  /** 站在这个地方（走动状态，范围 r + 1 米） */
  private near(sid: string, spotId: string) {
    const p = this.c.state.players.get(sid); const sp = spotOf(spotId);
    return !!p && p.st === PSTATE.MOVING && Math.hypot(p.x - sp.x, p.z - sp.z) < sp.r + 1;
  }
  private lock<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (this.busy.has(key)) return Promise.resolve(undefined);
    this.busy.add(key);
    return fn().finally(() => this.busy.delete(key));
  }

  // ───────── 抽红包：每人每天一个 ─────────
  private async angpaoGet(cl: Client) {
    const pid = this.c.playerIdOf(cl.sessionId); if (!pid) return;
    const day = klDay(Date.now());
    try {
      const r = await pool.query('SELECT coins FROM angpao_draws WHERE player_id=$1 AND day=$2', [pid, day]);
      cl.send('angpao.state', { day, coins: r.rows[0]?.coins ?? null });
    } catch { cl.send('angpao.state', { day, coins: null, error: true }); }
  }
  private async angpaoDraw(cl: Client) {
    const sid = cl.sessionId; const pid = this.c.playerIdOf(sid); if (!pid) return;
    if (!this.near(sid, 'angpao')) return cl.send('angpao.result', { ok: false, reason: 'far' });
    await this.lock(`ap|${pid}`, async () => {
      const day = klDay(Date.now());
      try {
        const coins = angpaoPick(randomInt(100));
        const ins = await pool.query(`INSERT INTO angpao_draws(player_id, day, coins) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING coins`, [pid, day, coins]);
        const fresh = !!ins.rowCount;
        const got = fresh ? coins : Number((await pool.query('SELECT coins FROM angpao_draws WHERE player_id=$1 AND day=$2', [pid, day])).rows[0].coins);
        // 已经抽过也再记一次账：上次记账失败的话这次补上（同一个 key 只会发一次）
        const cr = await credit(pid, 'coins', got, 'angpao', day, angpaoKey(pid, day));
        cl.send(MSG.S_WALLET, cr.wallet);
        cl.send('angpao.result', { ok: true, day, coins: got, already: !fresh });
        if (fresh && got >= ANGPAO_BIG) {
          const name = this.c.state.players.get(sid)?.name ?? '有人';
          for (const o of this.c.clients) if (o.sessionId !== sid) o.send('angpao.big', { name, coins: got });
        }
      } catch { cl.send('angpao.result', { ok: false, reason: 'db' }); }
    });
  }

  // ───────── 夜市捞金鱼 ─────────
  private async fishDay(pid: string) {
    const r = await pool.query('SELECT rounds, streak, fish, coins FROM goldfish_daily WHERE player_id=$1 AND day=$2', [pid, klDay(Date.now())]);
    const d = r.rows[0] ?? {};
    return { rounds: Number(d.rounds ?? 0), streak: Number(d.streak ?? 0), fish: Number(d.fish ?? 0), coins: Number(d.coins ?? 0) };
  }
  private async fishGet(cl: Client) {
    const pid = this.c.playerIdOf(cl.sessionId); if (!pid) return;
    try { const d = await this.fishDay(pid); cl.send('goldfish.state', { ...d, max: GOLDFISH.roundsPerDay, paperMs: goldfishPaper(d.streak) }); }
    catch { cl.send('goldfish.state', { error: true }); }
  }
  private async fishStart(cl: Client, m: { requestId?: unknown }) {
    const sid = cl.sessionId; const pid = this.c.playerIdOf(sid);
    const rid = typeof m?.requestId === 'string' ? m.requestId.slice(0, 64) : '';
    if (!pid || !rid) return;
    if (!this.near(sid, 'goldfish')) return cl.send('goldfish.round', { ok: false, reason: 'far' });
    await this.lock(`gf|${pid}`, async () => {
      try {
        const key = `goldfish:${pid}:${rid}`; const cur = this.fish.get(sid);
        if (cur?.key === key) return cl.send('goldfish.round', { ok: true, round: cur.id, seed: cur.seed, paperMs: cur.paperMs, replay: true });
        const d = await this.fishDay(pid);
        if (d.rounds >= GOLDFISH.roundsPerDay) return cl.send('goldfish.round', { ok: false, reason: 'limit', rounds: d.rounds });
        const id = randomUUID();
        const sp = await spend(pid, 'coins', GOLDFISH.price, 'goldfish_net', id, key);
        if (!sp.ok) { if (sp.wallet) cl.send(MSG.S_WALLET, sp.wallet); return cl.send('goldfish.round', { ok: false, reason: 'insufficient' }); }
        cl.send(MSG.S_WALLET, sp.wallet);
        if (sp.replay) return cl.send('goldfish.round', { ok: false, reason: 'replay' });
        const u = await pool.query(
          `INSERT INTO goldfish_daily(player_id, day, rounds) VALUES ($1,$2,1)
           ON CONFLICT (player_id, day) DO UPDATE SET rounds=goldfish_daily.rounds+1 RETURNING rounds, streak`, [pid, klDay(Date.now())]);
        const streak = Number(u.rows[0].streak);
        const r: FishRound = { id, key, seed: randomInt(0, 2 ** 32 - 1), t0: Date.now(), paperMs: goldfishPaper(streak) };
        this.fish.set(sid, r);
        cl.send('goldfish.round', { ok: true, round: r.id, seed: r.seed, paperMs: r.paperMs, rounds: Number(u.rows[0].rounds), max: GOLDFISH.roundsPerDay, streak });
      } catch { cl.send('goldfish.round', { ok: false, reason: 'db' }); }
    });
  }
  private async fishEnd(cl: Client, m: { round?: unknown; caught?: unknown; ms?: unknown }) {
    const sid = cl.sessionId; const pid = this.c.playerIdOf(sid); if (!pid) return;
    const r = this.fish.get(sid);
    if (!r || r.id !== m?.round) return cl.send('goldfish.result', { ok: false, reason: 'no_round' });
    this.fish.delete(sid); // 一局只结算一次
    const now = Date.now();
    if (now - r.t0 > GOLDFISH.roundMs) return cl.send('goldfish.result', { ok: false, reason: 'stale', round: r.id });
    if (!this.near(sid, 'goldfish')) return cl.send('goldfish.result', { ok: false, reason: 'far', round: r.id });
    const raw = Array.isArray(m?.caught) ? m.caught : null;
    const ids = raw && raw.length <= GOLDFISH.fishCount && raw.every((x) => Number.isInteger(x) && x >= 1 && x <= GOLDFISH.fishCount) ? raw as number[] : null;
    const ms = typeof m?.ms === 'number' && Number.isFinite(m.ms) && m.ms >= 0 ? m.ms : 0;
    // 捞得到几条：服务器自己量的时间和客户端报的时间取小的，平均 1.2 秒最多一条，一局最多 6 条
    const most = Math.min(GOLDFISH.maxCatch, Math.floor(Math.min(now - r.t0, ms) / GOLDFISH.msPerFish));
    if (!ids || new Set(ids).size !== ids.length || ids.length > most) return cl.send('goldfish.result', { ok: false, reason: 'bad', round: r.id });
    const n = ids.length; const pay = goldfishPay(n);
    try {
      const day = klDay(now);
      const d = await tx(async (c) => {
        const u = await c.query(
          `UPDATE goldfish_daily SET fish=fish+$3, coins=coins+$4, streak=CASE WHEN $4::int > 0 THEN streak+1 ELSE 0 END
           WHERE player_id=$1 AND day=$2 RETURNING streak, fish, coins, rounds`, [pid, day, n, pay]);
        if (n > 0) await c.query(`INSERT INTO player_items(player_id, item, qty) VALUES ($1,'goldfish',$2) ON CONFLICT (player_id, item) DO UPDATE SET qty=player_items.qty+$2, updated_at=now()`, [pid, n]);
        const q = await c.query(`SELECT qty FROM player_items WHERE player_id=$1 AND item='goldfish'`, [pid]);
        return { ...(u.rows[0] ?? {}), total: Number(q.rows[0]?.qty ?? 0) };
      });
      let paid = 0;
      if (pay > 0) { const cr = await credit(pid, 'coins', pay, 'goldfish_win', r.id, `goldfishwin:${r.id}`); paid = cr.applied; cl.send(MSG.S_WALLET, cr.wallet); }
      cl.send('goldfish.result', {
        ok: true, round: r.id, n, pay: paid, total: d.total, streak: Number(d.streak ?? 0), rounds: Number(d.rounds ?? 0), max: GOLDFISH.roundsPerDay,
        nextPaperMs: goldfishPaper(Number(d.streak ?? 0)),
      });
    } catch { cl.send('goldfish.result', { ok: false, reason: 'db', round: r.id }); }
  }

  // ───────── 灯谜：每天 3 题，每题一次 ─────────
  private async riddleList(pid: string, day: string) {
    const picks = riddlesOfDay(day);
    const r = await pool.query('SELECT n, riddle, choice, correct FROM riddle_answers WHERE player_id=$1 AND day=$2', [pid, day]);
    return picks.map((idx, n) => {
      const R = RIDDLES[idx]; const a = r.rows.find((x: { n: number }) => x.n === n);
      return { n, q: R.q, hint: R.hint, choices: riddleChoices(day, idx), done: a ? { choice: a.choice, correct: a.correct, answer: R.answer, why: R.why } : null };
    });
  }
  private async riddleGet(cl: Client) {
    const pid = this.c.playerIdOf(cl.sessionId); if (!pid) return;
    const day = klDay(Date.now());
    try { cl.send('riddle.list', { day, pay: RIDDLE_PAY, list: await this.riddleList(pid, day) }); }
    catch { cl.send('riddle.list', { day, error: true }); }
  }
  private async riddleAnswer(cl: Client, m: { day?: unknown; n?: unknown; choice?: unknown }) {
    const sid = cl.sessionId; const pid = this.c.playerIdOf(sid); if (!pid) return;
    const day = klDay(Date.now()); const n = m?.n;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n >= 3 || typeof m?.choice !== 'string') return;
    if (!this.near(sid, 'riddle')) return cl.send('riddle.result', { ok: false, n, reason: 'far' });
    // 过了午夜：题目换了，重新拿
    if (m?.day !== day) { cl.send('riddle.result', { ok: false, n, reason: 'new_day' }); return this.riddleGet(cl); }
    const idx = riddlesOfDay(day)[n]; const R = RIDDLES[idx];
    if (!riddleChoices(day, idx).includes(m.choice)) return;
    await this.lock(`rd|${pid}|${n}`, async () => {
      try {
        const correct = m.choice === R.answer;
        const ins = await pool.query(`INSERT INTO riddle_answers(player_id, day, n, riddle, choice, correct) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING correct`,
          [pid, day, n, idx, m.choice, correct]);
        const row = ins.rowCount ? { choice: m.choice as string, correct } : (await pool.query('SELECT choice, correct FROM riddle_answers WHERE player_id=$1 AND day=$2 AND n=$3', [pid, day, n])).rows[0];
        let pay = 0;
        if (row.correct) { const cr = await credit(pid, 'coins', RIDDLE_PAY, 'riddle', `${day}:${n}`, riddleKey(pid, day, n)); pay = cr.applied; cl.send(MSG.S_WALLET, cr.wallet); }
        cl.send('riddle.result', { ok: true, n, day, choice: row.choice, correct: row.correct, answer: R.answer, why: R.why, pay, already: !ins.rowCount });
      } catch { cl.send('riddle.result', { ok: false, n, reason: 'db' }); }
    });
  }

  // ───────── 舞狮接桔子月榜 ─────────
  /** PlazaRoom 接到一颗桔子时调用（这个月 +1） */
  orangeCaught(pid: string) {
    return pool.query(
      `INSERT INTO orange_season(player_id, season, count, updated_at) VALUES ($1,$2,1,now())
       ON CONFLICT (player_id, season) DO UPDATE SET count=orange_season.count+1, updated_at=now()`, [pid, klMonth(Date.now())]).catch(() => {});
  }
  private async seasonGet(cl: Client) {
    const pid = this.c.playerIdOf(cl.sessionId); if (!pid) return;
    const now = Date.now(); const season = klMonth(now); const last = prevSeason(season);
    try {
      const [top, me, aw, lastTop] = await Promise.all([
        pool.query(`SELECT COALESCE(p.nickname,'游客') AS name, s.count FROM orange_season s JOIN players p ON p.id=s.player_id WHERE s.season=$1 AND s.count>0 ORDER BY s.count DESC, s.updated_at ASC, s.player_id LIMIT 10`, [season]),
        pool.query(`SELECT m.count, (SELECT count(*)::int FROM orange_season o WHERE o.season=$2 AND (o.count > m.count OR (o.count = m.count AND (o.updated_at, o.player_id) < (m.updated_at, m.player_id)))) AS ahead
                    FROM orange_season m WHERE m.player_id=$1 AND m.season=$2`, [pid, season]),
        pool.query(`SELECT a.rank, a.count, a.coins, COALESCE(p.nickname,'游客') AS name FROM orange_season_awards a JOIN players p ON p.id=a.player_id WHERE a.season=$1 ORDER BY a.rank`, [last]),
        pool.query(`SELECT COALESCE(p.nickname,'游客') AS name, s.count FROM orange_season s JOIN players p ON p.id=s.player_id WHERE s.season=$1 AND s.count>0 ORDER BY s.count DESC, s.updated_at ASC, s.player_id LIMIT 3`, [last]),
      ]);
      const mine = me.rows[0] && Number(me.rows[0].count) > 0 ? { rank: Number(me.rows[0].ahead) + 1, count: Number(me.rows[0].count) } : null;
      // 上个月：结算过就用定下来的名次，还没结算（月初第一分钟）就先照现在的排
      const lastList = aw.rowCount ? aw.rows.map((x: any) => ({ name: x.name, count: x.count, coins: x.coins }))
        : lastTop.rows.map((x: any, i: number) => ({ name: x.name, count: x.count, coins: ORANGE_SEASON_PRIZES[i] }));
      cl.send('oseason', { season, daysLeft: seasonDaysLeft(now), prizes: ORANGE_SEASON_PRIZES, top: top.rows, me: mine, last: { season: last, top: lastList } });
    } catch { cl.send('oseason', { error: true }); }
  }
  /** 进房间时：上个月得奖还没告诉他的，告诉一次 */
  async onJoin(sid: string, pid: string) {
    await closing;
    try {
      const r = await pool.query(`UPDATE orange_season_awards SET told_at=now() WHERE player_id=$1 AND paid_at IS NOT NULL AND told_at IS NULL RETURNING season, rank, coins`, [pid]);
      const cl = this.c.clients.find((x) => x.sessionId === sid);
      for (const a of r.rows) cl?.send('oseason.prize', { season: a.season, rank: a.rank, coins: a.coins });
    } catch { /* */ }
  }
  /** 结算时他正在线：马上告诉他 */
  tellPrize(pid: string, wallet: unknown) {
    for (const cl of this.c.clients) {
      if (this.c.playerIdOf(cl.sessionId) !== pid) continue;
      cl.send(MSG.S_WALLET, wallet);
      void this.onJoin(cl.sessionId, pid);
    }
  }
  onLeave(sid: string) { this.fish.delete(sid); }
}
