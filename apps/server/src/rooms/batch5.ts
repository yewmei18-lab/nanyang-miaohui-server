import { randomUUID } from 'node:crypto';
import type { Client } from '@colyseus/core';
import {
  STORIES, storyTarget, WEEKLY_SPOT, weeklyVendor, dailyDiscoveries, DISCOVER_REWARD, isGiftable, giftName, GIFT_TIMEOUT_MS, INVITE_TIMEOUT_MS,
  INVITE_NAMES, REDSTRING_MS, MAMAK_SHOP, GAME_CONFIG, MSG, PSTATE, klDay, STAMPS, ALL_WORKS, MASKS, type InviteKind,
} from '@nanyang/shared';
import { pool, tx } from '../db.ts';
import { credit, buyItem } from '../wallet.ts';

/**
 * 第 5 批（街坊故事、每周摊主、送礼、邀请、庙会册、统计）。
 * 规则：
 * - 故事每一步都要服务器看到你真的站在那里；同一步只能前进一次（两个窗口同时点也只算一次）。
 * - 送礼：东西先从送的人身上扣下来锁进礼物，对方收下才转过去；拒绝/超时就原样退回。
 * - 邀请：对方可以接受、略过；15 秒没回就当略过。设置里可以完全不收邀请/礼物。
 */
interface Ctx {
  state: { players: Map<string, any> };
  clients: Client[];
  playerIdOf: (sid: string) => string | undefined;
  broadcast: (t: string, m: unknown) => void;
  addItem: (playerId: string, item: string, d: number) => Promise<unknown>;
}
interface Invite { id: string; from: string; to: string; kind: InviteKind; timer: NodeJS.Timeout }
interface Duel { id: string; a: string; b: string; turn: string; seed: number }

let staleSwept = false;

export class Batch5 {
  private invites = new Map<string, Invite>();
  private duels = new Map<string, Duel>();
  private giftTimers = new Map<string, NodeJS.Timeout>();
  private lastInvite = new Map<string, number>();
  private lastLog = new Map<string, number>();
  private busy = new Set<string>();
  private tieTimers = new Map<string, NodeJS.Timeout>();

  constructor(private c: Ctx) {
    if (!staleSwept) { staleSwept = true; void this.sweepStaleGifts(); }
  }

  private client(sid: string) { return this.c.clients.find((x) => x.sessionId === sid); }
  private send(sid: string, t: string, m: unknown) { this.client(sid)?.send(t, m); }
  private sidOfPlayer(pid: string) { for (const cl of this.c.clients) if (this.c.playerIdOf(cl.sessionId) === pid) return cl.sessionId; return undefined; }
  private dist(a: string, b: string) { const p = this.c.state.players.get(a), q = this.c.state.players.get(b); return p && q ? Math.hypot(p.x - q.x, p.z - q.z) : 99; }

  register(on: (type: string, fn: (client: Client, m: any) => void) => void) {
    on('story.get', (cl) => { void this.sendStories(cl.sessionId); });
    on('story.step', (cl, m) => { void this.storyStep(cl, m); });
    on('weekly.buy', (cl, m) => { void this.weeklyBuy(cl, m); });
    on('show.set', (cl, m) => { void this.showSet(cl, m); });
    on('voucher.treat', (cl, m) => { void this.treat(cl, m); });
    on('gift.offer', (cl, m) => { void this.giftOffer(cl, m); });
    on('gift.reply', (cl, m) => { void this.giftReply(cl, m); });
    on('invite.send', (cl, m) => this.inviteSend(cl, m));
    on('invite.reply', (cl, m) => this.inviteReply(cl, m));
    on('duel.shot', (cl, m) => this.duelShot(cl, m));
    on('duel.quit', (cl, m) => this.duelQuit(cl.sessionId, typeof m?.id === 'string' ? m.id : ''));
    on('prefs.set', (cl, m) => { const p = this.c.state.players.get(cl.sessionId); if (!p) return; if (typeof m?.nogift === 'boolean') p.nogift = m.nogift; if (typeof m?.noinv === 'boolean') p.noinv = m.noinv; });
    on('album.get', (cl) => { void this.album(cl); });
    on('disc.get', (cl) => { void this.sendDiscoveries(cl.sessionId); });
    on('log', (cl, m) => { const pid = this.c.playerIdOf(cl.sessionId); const k = typeof m?.k === 'string' ? m.k : ''; if (pid && ['act', 'map_route', 'story_open', 'ig_story'].includes(k)) this.log(pid, k, typeof m?.d === 'string' ? m.d.slice(0, 32) : '', cl.sessionId); });
  }

  /** 统计（同一个人 1.5 秒内只记一条，防刷） */
  log(playerId: string, kind: string, detail = '', sid?: string) {
    const key = `${sid ?? playerId}:${kind}`; const now = Date.now();
    if (kind === 'act' || kind === 'map_route') { if (now - (this.lastLog.get(key) ?? 0) < 1500) return; this.lastLog.set(key, now); }
    return pool.query('INSERT INTO analytics_events(player_id, kind, detail, day) VALUES ($1,$2,$3,$4)', [playerId, kind, detail, klDay(now)]).catch(() => {});
  }

  async sendItems(sid: string) {
    const pid = this.c.playerIdOf(sid); if (!pid) return;
    const r = await pool.query('SELECT item, qty FROM player_items WHERE player_id=$1 AND qty > 0', [pid]).catch(() => null);
    this.send(sid, 'items', { items: Object.fromEntries((r?.rows ?? []).map((x: { item: string; qty: number }) => [x.item, x.qty])) });
  }

  // ───────── 街坊故事 ─────────
  private async progress(pid: string): Promise<Record<string, number>> {
    const r = await pool.query('SELECT story, step FROM story_progress WHERE player_id=$1', [pid]);
    return Object.fromEntries(r.rows.map((x: { story: string; step: number }) => [x.story, x.step]));
  }
  async sendStories(sid: string) {
    const pid = this.c.playerIdOf(sid); if (!pid) return;
    try { this.send(sid, 'story', { prog: await this.progress(pid), day: klDay(Date.now()) }); } catch { /* 数据库暂时不通：下次再拿 */ }
  }
  private async storyStep(cl: Client, m: { story?: unknown }) {
    const sid = cl.sessionId; const pid = this.c.playerIdOf(sid); const p = this.c.state.players.get(sid);
    const story = STORIES.find((s) => s.id === m?.story); if (!pid || !p || !story) return;
    if (this.busy.has(`story:${pid}`)) return; this.busy.add(`story:${pid}`);
    try {
      const cur = (await this.progress(pid))[story.id] ?? 0;
      if (cur >= story.steps.length) return this.sendStories(sid);
      const step = story.steps[cur]; const t = storyTarget(step, klDay(Date.now()));
      if (p.st !== PSTATE.MOVING || Math.hypot(p.x - t.x, p.z - t.z) > step.r + 0.8) return cl.send('story.beat', { story: story.id, ok: false, reason: 'far' });
      // 只有“还停在这一步”的那一次能前进
      const up = await pool.query(
        `INSERT INTO story_progress(player_id, story, step) VALUES ($1,$2,1)
         ON CONFLICT (player_id, story) DO UPDATE SET step=story_progress.step+1, updated_at=now() WHERE story_progress.step=$3
         RETURNING step`, [pid, story.id, cur]);
      if (!up.rowCount) return this.sendStories(sid);
      const done = up.rows[0].step >= story.steps.length;
      if (cur === 0) void this.log(pid, 'story_start', story.id);
      if (done) {
        await pool.query('UPDATE story_progress SET done_at=now() WHERE player_id=$1 AND story=$2 AND done_at IS NULL', [pid, story.id]);
        const r = await credit(pid, 'coins', story.reward, 'story', story.id, `story:${pid}:${story.id}`);
        await this.c.addItem(pid, `keep:${story.id}`, 1);
        cl.send(MSG.S_WALLET, r.wallet); void this.log(pid, 'story_done', story.id);
      }
      cl.send('story.beat', { story: story.id, ok: true, step: cur, done, reward: done ? story.reward : 0 });
      await this.sendStories(sid);
    } catch { cl.send('story.beat', { story: story.id, ok: false, reason: 'db' }); }
    finally { this.busy.delete(`story:${pid}`); }
  }

  // ───────── 每周摊主 ─────────
  private async weeklyBuy(cl: Client, m: { work?: unknown; requestId?: unknown }) {
    const sid = cl.sessionId; const pid = this.c.playerIdOf(sid); const p = this.c.state.players.get(sid);
    const v = weeklyVendor(Date.now()); const w = (v.works as ReadonlyArray<{ id: string; name: string }>).find((x) => x.id === m?.work);
    const rid = typeof m?.requestId === 'string' ? m.requestId.slice(0, 64) : '';
    if (!pid || !p || !w || !rid) return cl.send('weekly.result', { ok: false, reason: 'bad' });
    if (Math.hypot(p.x - WEEKLY_SPOT.x, p.z - WEEKLY_SPOT.z) > WEEKLY_SPOT.r + 1) return cl.send('weekly.result', { ok: false, reason: 'not_here' });
    try {
      const r = await buyItem(pid, v.price, `work:${w.id}`, 'weekly_work', `weekly:${pid}:${rid}`);
      cl.send(MSG.S_WALLET, r.wallet);
      if (!r.ok) return cl.send('weekly.result', { ok: false, reason: 'insufficient' });
      cl.send('weekly.result', { ok: true, work: w.id, replay: r.replay }); void this.sendItems(sid);
      if (!r.replay) void this.log(pid, 'weekly_buy', w.id);
    } catch { cl.send('weekly.result', { ok: false, reason: 'db' }); }
  }
  private async showSet(cl: Client, m: { work?: unknown }) {
    const pid = this.c.playerIdOf(cl.sessionId); const p = this.c.state.players.get(cl.sessionId); if (!pid || !p) return;
    if (!m?.work) { p.show = ''; return; }
    const w = ALL_WORKS.find((x) => x.id === m.work); if (!w) return;
    const r = await pool.query('SELECT 1 FROM player_items WHERE player_id=$1 AND item=$2 AND qty>0', [pid, `work:${w.id}`]).catch(() => null);
    if (r?.rowCount) p.show = w.id;
  }

  // ───────── Mamak 请朋友喝 ─────────
  private async treat(cl: Client, m: { to?: unknown; requestId?: unknown }) {
    const sid = cl.sessionId; const pid = this.c.playerIdOf(sid); const p = this.c.state.players.get(sid);
    const rid = typeof m?.requestId === 'string' ? m.requestId.slice(0, 64) : '';
    const to = typeof m?.to === 'string' ? m.to : '';
    if (!pid || !p || !rid || !this.c.state.players.get(to) || to === sid) return cl.send('gift.result', { ok: false, reason: 'bad' });
    if (Math.hypot(p.x - MAMAK_SHOP.x, p.z - MAMAK_SHOP.z) > 9) return cl.send('gift.result', { ok: false, reason: 'not_mamak' });
    const price = GAME_CONFIG.mamak.menu[0].price;
    try {
      const r = await buyItem(pid, price, 'voucher', 'mamak_treat', `treat:${pid}:${rid}`);
      cl.send(MSG.S_WALLET, r.wallet);
      if (!r.ok) return cl.send('gift.result', { ok: false, reason: 'insufficient' });
      void this.log(pid, 'treat', '');
      await this.giftOffer(cl, { to, item: 'voucher', requestId: `t-${rid}` });
    } catch { cl.send('gift.result', { ok: false, reason: 'db' }); }
  }

  // ───────── 送礼（锁住 → 收下 / 拒绝 / 超时退回） ─────────
  private async giftOffer(cl: Client, m: { to?: unknown; item?: unknown; requestId?: unknown }) {
    const sid = cl.sessionId; const pid = this.c.playerIdOf(sid); const p = this.c.state.players.get(sid);
    const to = typeof m?.to === 'string' ? m.to : ''; const q = this.c.state.players.get(to); const qid = this.c.playerIdOf(to);
    const item = typeof m?.item === 'string' ? m.item : ''; const rid = typeof m?.requestId === 'string' ? m.requestId.slice(0, 64) : '';
    const fail = (reason: string) => cl.send('gift.result', { ok: false, reason, item });
    if (!pid || !p || !q || !qid || !rid || !isGiftable(item)) return fail('bad');
    if (qid === pid) return fail('self');
    if (q.nogift) return fail('nogift');
    if (this.dist(sid, to) > 4) return fail('far');
    const id = randomUUID();
    try {
      const res = await tx(async (c) => {
        const ins = await c.query(`INSERT INTO gifts(id, from_player, to_player, item, request_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (from_player, request_id) DO NOTHING RETURNING id`, [id, pid, qid, item, rid]);
        if (!ins.rowCount) return 'replay';
        const pend = await c.query(`SELECT count(*)::int n FROM gifts WHERE to_player=$1 AND status='pending'`, [qid]);
        if (pend.rows[0].n > 1) throw new Error('busy');
        const d = await c.query(`UPDATE player_items SET qty=qty-1, updated_at=now() WHERE player_id=$1 AND item=$2 AND qty>=1 RETURNING qty`, [pid, item]);
        if (!d.rowCount) throw new Error('none');
        return 'ok';
      });
      if (res === 'replay') return;
      this.giftTimers.set(id, setTimeout(() => { void this.settle(id, 'expired'); }, GIFT_TIMEOUT_MS));
      cl.send('gift.result', { ok: true, pending: true, id, item, toName: q.name });
      this.send(to, 'gift.incoming', { id, item, name: giftName(item), fromName: p.name, ms: GIFT_TIMEOUT_MS });
      void this.sendItems(sid);
    } catch (e) { fail((e as Error).message === 'busy' ? 'busy' : (e as Error).message === 'none' ? 'none' : 'db'); }
  }
  private async giftReply(cl: Client, m: { id?: unknown; accept?: unknown }) {
    const pid = this.c.playerIdOf(cl.sessionId); const id = typeof m?.id === 'string' ? m.id : '';
    if (!pid || !/^[0-9a-f-]{36}$/.test(id)) return;
    const own = await pool.query('SELECT 1 FROM gifts WHERE id=$1 AND to_player=$2', [id, pid]).catch(() => null);
    if (!own?.rowCount) return;
    await this.settle(id, m?.accept === true ? 'accepted' : 'refused');
  }
  /** 一份礼物只会结算一次（status 还是 pending 才能改） */
  private async settle(id: string, status: 'accepted' | 'refused' | 'expired') {
    clearTimeout(this.giftTimers.get(id)); this.giftTimers.delete(id);
    try {
      const r = await tx(async (c) => {
        const u = await c.query(`UPDATE gifts SET status=$2, decided_at=now() WHERE id=$1 AND status='pending' RETURNING from_player, to_player, item`, [id, status]);
        if (!u.rowCount) return null;
        const g = u.rows[0] as { from_player: string; to_player: string; item: string };
        const owner = status === 'accepted' ? g.to_player : g.from_player;
        await c.query(`INSERT INTO player_items(player_id, item, qty) VALUES ($1,$2,1) ON CONFLICT (player_id, item) DO UPDATE SET qty=player_items.qty+1, updated_at=now()`, [owner, g.item]);
        return g;
      });
      if (!r) return;
      const a = this.sidOfPlayer(r.from_player), b = this.sidOfPlayer(r.to_player);
      const fromName = a ? this.c.state.players.get(a)?.name : '', toName = b ? this.c.state.players.get(b)?.name : '';
      if (a) { this.send(a, 'gift.done', { id, status, item: r.item, name: giftName(r.item), other: toName }); void this.sendItems(a); }
      if (b) { this.send(b, 'gift.done', { id, status, item: r.item, name: giftName(r.item), other: fromName, mine: true }); void this.sendItems(b); }
      if (status === 'accepted') { void this.log(r.from_player, 'gift_given', r.item); if (a && b) this.c.broadcast('act', { sid: a, a: 'gift', to: b }); }
    } catch { /* 数据库不通：礼物还在 pending，下次启动时退回 */ }
  }
  /** 服务器重启前没结算的礼物：退回给送的人 */
  private async sweepStaleGifts() {
    try {
      const ids = await pool.query(`SELECT id FROM gifts WHERE status='pending' AND created_at < now() - interval '1 minute'`);
      for (const r of ids.rows) await this.settle(r.id, 'expired');
    } catch { /* */ }
  }

  // ───────── 双人邀请 ─────────
  private inviteSend(cl: Client, m: { to?: unknown; kind?: unknown }) {
    const sid = cl.sessionId; const to = typeof m?.to === 'string' ? m.to : ''; const kind = m?.kind as InviteKind;
    const p = this.c.state.players.get(sid), q = this.c.state.players.get(to);
    const fail = (reason: string) => cl.send('invite.end', { id: '', kind, result: reason });
    if (!p || !q || to === sid || !(kind in INVITE_NAMES)) return fail('bad');
    if (this.c.playerIdOf(to) === this.c.playerIdOf(sid)) return fail('bad');
    if (q.noinv) return fail('noinv');
    if (this.dist(sid, to) > 6) return fail('far');
    const now = Date.now(); if (now - (this.lastInvite.get(sid) ?? 0) < 3000) return fail('slow'); this.lastInvite.set(sid, now);
    for (const iv of this.invites.values()) if (iv.to === to || iv.from === sid) return fail('busy');
    const id = randomUUID();
    const timer = setTimeout(() => { if (!this.invites.delete(id)) return; this.send(sid, 'invite.end', { id, kind, result: 'expired', other: q.name }); this.send(to, 'invite.end', { id, kind, result: 'expired' }); }, INVITE_TIMEOUT_MS);
    this.invites.set(id, { id, from: sid, to, kind, timer });
    cl.send('invite.sent', { id, kind, toName: q.name, ms: INVITE_TIMEOUT_MS });
    this.send(to, 'invite.incoming', { id, kind, fromName: p.name, from: sid, ms: INVITE_TIMEOUT_MS });
  }
  private inviteReply(cl: Client, m: { id?: unknown; accept?: unknown }) {
    const iv = this.invites.get(typeof m?.id === 'string' ? m.id : ''); if (!iv || iv.to !== cl.sessionId) return;
    this.invites.delete(iv.id); clearTimeout(iv.timer);
    const a = this.c.state.players.get(iv.from), b = this.c.state.players.get(iv.to);
    if (!a || !b) return;
    if (m?.accept !== true) { this.send(iv.from, 'invite.end', { id: iv.id, kind: iv.kind, result: 'skipped', other: b.name }); return; }
    const pa = this.c.playerIdOf(iv.from), pb = this.c.playerIdOf(iv.to);
    if (pa) void this.log(pa, 'invite_meet', iv.kind); if (pb) void this.log(pb, 'invite_meet', iv.kind);
    for (const s of [iv.from, iv.to]) this.send(s, 'invite.end', { id: iv.id, kind: iv.kind, result: 'accepted', other: s === iv.from ? b.name : a.name });
    if (iv.kind === 'photo') {
      const now = Date.now();
      this.c.broadcast('photo', { captureId: randomUUID(), at: now + GAME_CONFIG.photo.countdownMs, sids: [iv.from, iv.to], mid: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 } });
    } else if (iv.kind === 'redstring') {
      for (const [s, o] of [[iv.from, iv.to], [iv.to, iv.from]] as const) {
        const p = this.c.state.players.get(s); if (!p) continue; p.tie = o;
        clearTimeout(this.tieTimers.get(s)); this.tieTimers.set(s, setTimeout(() => { const q = this.c.state.players.get(s); if (q && q.tie === o) q.tie = ''; }, REDSTRING_MS));
      }
      if (pa) void this.c.addItem(pa, 'redstring', 1); if (pb) void this.c.addItem(pb, 'redstring', 1);
      this.c.broadcast('act', { sid: iv.from, a: 'tie', to: iv.to });
    } else {
      const d: Duel = { id: iv.id, a: iv.from, b: iv.to, turn: iv.from, seed: Math.floor(Math.random() * 1e9) };
      this.duels.set(d.id, d);
      this.send(d.a, 'duel.start', { id: d.id, seed: d.seed, me: 'a', otherName: b.name, first: true });
      this.send(d.b, 'duel.start', { id: d.id, seed: d.seed, me: 'b', otherName: a.name, first: false });
    }
  }
  /** 斗擦胶双人：只转发“谁弹了多大力”，两边用同一套算法算出一样的结果 */
  private duelShot(cl: Client, m: { id?: unknown; vx?: unknown; vy?: unknown }) {
    const d = this.duels.get(typeof m?.id === 'string' ? m.id : ''); if (!d || d.turn !== cl.sessionId) return;
    const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(-12, Math.min(12, Math.round(x * 1000) / 1000)) : 0);
    const shot = { id: d.id, by: cl.sessionId === d.a ? 'a' : 'b', vx: n(m.vx), vy: n(m.vy) };
    d.turn = cl.sessionId === d.a ? d.b : d.a;
    this.send(d.a, 'duel.shot', shot); this.send(d.b, 'duel.shot', shot);
    this.c.broadcast('fx', { sid: cl.sessionId, k: 'eraser', v: 0, x: 0, z: 0 });
  }
  duelQuit(sid: string, id: string) {
    for (const d of this.duels.values()) {
      if ((id && d.id !== id) || (d.a !== sid && d.b !== sid)) continue;
      this.duels.delete(d.id); const other = d.a === sid ? d.b : d.a; this.send(other, 'duel.end', { id: d.id, reason: 'left' });
    }
  }
  /** 有人离开房间：收掉他的邀请、对局、红绳 */
  onLeave(sid: string) {
    for (const iv of [...this.invites.values()]) if (iv.from === sid || iv.to === sid) { this.invites.delete(iv.id); clearTimeout(iv.timer); const o = iv.from === sid ? iv.to : iv.from; this.send(o, 'invite.end', { id: iv.id, kind: iv.kind, result: 'left' }); }
    this.duelQuit(sid, '');
    for (const [s, p] of this.c.state.players) if (p.tie === sid) { p.tie = ''; clearTimeout(this.tieTimers.get(s)); }
  }

  // ───────── 每日三个小发现 ─────────
  async sendDiscoveries(sid: string) {
    const pid = this.c.playerIdOf(sid); if (!pid) return;
    const day = klDay(Date.now()); const want = dailyDiscoveries(day);
    const r = await pool.query('SELECT stamp FROM stamps WHERE player_id=$1 AND day=$2', [pid, day]).catch(() => null);
    const have = new Set((r?.rows ?? []).map((x: { stamp: string }) => x.stamp));
    const got = await pool.query('SELECT 1 FROM ledger WHERE idempotency_key=$1', [`disc:${pid}:${day}`]).catch(() => null);
    this.send(sid, 'disc', { day, list: want.map((id) => ({ id, name: STAMPS.find((s) => s.id === id)?.name ?? id, done: have.has(id) })), rewarded: !!got?.rowCount, reward: DISCOVER_REWARD });
  }
  /** 盖了新章之后：三个都齐了就发一次奖励 */
  async afterStamp(sid: string, stamp: string) {
    const pid = this.c.playerIdOf(sid); if (!pid) return;
    const day = klDay(Date.now()); const want = dailyDiscoveries(day); if (!want.includes(stamp)) return;
    const r = await pool.query('SELECT stamp FROM stamps WHERE player_id=$1 AND day=$2 AND stamp = ANY($3)', [pid, day, want]).catch(() => null);
    if ((r?.rowCount ?? 0) < want.length) return void this.sendDiscoveries(sid);
    try {
      const c = await credit(pid, 'coins', DISCOVER_REWARD, 'daily_discover', day, `disc:${pid}:${day}`);
      this.send(sid, MSG.S_WALLET, c.wallet); if (!c.replay) this.send(sid, 'disc.done', { reward: DISCOVER_REWARD });
      void this.sendDiscoveries(sid);
    } catch { /* */ }
  }

  // ───────── 我的庙会册 ─────────
  private async album(cl: Client) {
    const pid = this.c.playerIdOf(cl.sessionId); if (!pid) return;
    try {
      const [items, stories, stampDays, fort, first] = await Promise.all([
        pool.query('SELECT item, qty FROM player_items WHERE player_id=$1 AND qty>0', [pid]),
        pool.query('SELECT story, step, done_at FROM story_progress WHERE player_id=$1', [pid]),
        pool.query('SELECT count(DISTINCT day)::int days, count(*)::int n FROM stamps WHERE player_id=$1', [pid]),
        pool.query('SELECT count(*)::int n FROM fortune_daily WHERE player_id=$1', [pid]).catch(() => ({ rows: [{ n: 0 }] })),
        pool.query('SELECT created_at FROM players WHERE id=$1', [pid]),
      ]);
      const it = Object.fromEntries(items.rows.map((x: { item: string; qty: number }) => [x.item, x.qty]));
      cl.send('album', {
        since: first.rows[0]?.created_at ?? null,
        stories: STORIES.map((s) => { const r = stories.rows.find((x: { story: string }) => x.story === s.id); return { id: s.id, title: s.title, keepsake: s.keepsake, step: r?.step ?? 0, total: s.steps.length, done: !!r?.done_at }; }),
        works: ALL_WORKS.map((w) => ({ id: w.id, name: w.name, qty: it[`work:${w.id}`] ?? 0 })),
        masks: MASKS.map((mk) => ({ id: mk.id, name: mk.name, own: !!it[`mask:${mk.id}`] })),
        redstring: it.redstring ?? 0, voucher: it.voucher ?? 0, oranges: it.orange ?? 0,
        stampDays: stampDays.rows[0]?.days ?? 0, stamps: stampDays.rows[0]?.n ?? 0, fortunes: fort.rows[0]?.n ?? 0,
      });
    } catch { cl.send('album', { error: true }); }
  }
}
