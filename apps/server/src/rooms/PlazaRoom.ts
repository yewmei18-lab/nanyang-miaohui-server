import { Room, type Client } from '@colyseus/core';
import { randomUUID } from 'node:crypto';
import {
  EMOTES, GAME_CONFIG, CONFIG_VERSION, MSG, PSTATE, SEAT_STATE, SEATS, SPAWN, COLLIDERS_SEATING, klDay,
  MAMAK_SHOP, MAMAK_TABLES, CHAT, cleanChat, FORTUNES, RING, ringLanding, LION, lionElapsed, isBlocked, insideWalk,
  stepMove, stepToward, sanitizeMove, normalizeTargetName, avatarToIndices, validateAvatar, DEFAULT_AVATAR,
  type SessionResult,
} from '@nanyang/shared';
import { PlazaState, PlayerS, SeatS, OrangeS } from './schema.ts';
import { verifyToken } from '../auth.ts';
import { pool } from '../db.ts';
import { getWallet, spend, spendBoth, credit, refund, placeMamakOrder, setOrderStatus } from '../wallet.ts';
import { hitPipeline, leaderboard, upsertTarget, sealSession, getSessionResult } from '../hits.ts';
import { metrics } from '../metrics.ts';

const V = GAME_CONFIG.villain;
const WF = GAME_CONFIG.woodfish;
const BATH = GAME_CONFIG.bath;
const S = GAME_CONFIG.seat;
const MK = GAME_CONFIG.mamak;
const PR = GAME_CONFIG.pray;
type MenuItem = (typeof MK.menu)[number];
type OrderStatus = 'ordered' | 'cooking' | 'serving' | 'delivered' | 'eating' | 'done' | 'cancelled';
interface MamakOrder { id: string; requestId: string; it: Internal; seatId: number; item: MenuItem; status: OrderStatus; eatTimer?: NodeJS.Timeout }
interface StaffTask { kind: 'visit' | 'deliver'; seatId: number; order?: MamakOrder }
type StaffPhase = 'idle' | 'walk' | 'ask' | 'cook' | 'place' | 'return';
/** Aneh 走的通道：两排桌子中间（x=-2.9）和街边（x=-0.2），不穿桌子 */
const AISLES = [{ x: -2.9, z: 18.15 }, { x: -0.2, z: 18.15 }, { x: -0.2, z: 14.6 }, { x: -3.2, z: 14.4 }, { x: 0.4, z: 20.6 }, { x: 3.4, z: 20.6 }, { x: 0.4, z: 16.2 }, { x: 3.4, z: 16.2 }];
const COUNTER = { x: MAMAK_SHOP.counterX, z: MAMAK_SHOP.counterZ };
const TICK_MS = 1000 / GAME_CONFIG.room.simulationHz;
let roomCounter = 0;
/** 每个账号每场舞狮最多接几颗（跨房间共用，换房也不能多拿） */
const ORANGE_CAP = 3;
const orangeTaken = new Map<string, number>();

interface HitSession {
  id: string;
  requestId: string;
  targetId: number;
  displayName: string;
  startsAt: number;
  endsAt: number;
  phase: 'countdown' | 'active' | 'ending' | 'done' | 'cancelled';
  seen: Set<number>;
  lastCt: number;
  accepted: number;
  rejected: number;
  combo: number;
  maxCombo: number;
  lastAcceptAt: number;
  window: number[]; // 最近 1 秒内已接受的服务器时间
  timers: NodeJS.Timeout[];
  result?: SessionResult;
}

interface Internal {
  playerId: string;
  inputs: Array<{ seq: number; mx: number; mz: number; run: boolean }>;
  credit: number;
  seatRequests: Map<string, { ok: boolean; seatId: number; reason?: string }>;
  path: Array<{ x: number; z: number }>;
  pathDeadline: number;
  stateBeforeDrop: number;
  session: HitSession | null;
  sessionRequests: Map<string, string>;
  superseded: boolean;
  reconnection?: { reject: Function };
  /** 木鱼：已确认的 seq、1 秒窗口、今日累计（待写库的增量） */
  wf: { seen: Set<number>; window: number[]; today: number; pending: number; loaded: boolean };
  /** 洗衰运：本次泡池的唯一 id、已累计的前台时间、最后心跳、已发奖励的分钟数 */
  bath: { id: string; activeMs: number; lastBeat: number; minute: number; lastTick: number } | null;
  /** MAMAK：未完成的订单（每人最多一张） */
  order: MamakOrder | null;
  /** 求签：同一个 requestId 返回同一支签 */
  fortunes: Map<string, { no: number; lucky: boolean; coins: number; again: boolean }>; lastShake: number;
  /** 正在等数据库确认的下单 requestId（防止同时点两样都扣钱） */
  orderBusy: string | null;
  lastIncense: number;
  /** 这次坐下已经打过几局（后面有人排队时只能打一局） */
  vPlayed: number;
  /** 天灯、烧烦恼、拍照：同一个 requestId 只处理一次；上次时间（防连点） */
  done: Map<string, unknown>; lastBurn: number; lastPhoto: number;
  /** 套圈这一局 */
  ring: { id: string; left: number; claimed: Set<number>; endsAt: number; lastThrow: number; won: number; seen: Set<number> } | null;
}

export class PlazaRoom extends Room<{ state: typeof PlazaState.prototype }> {
  maxClients = GAME_CONFIG.room.maxClients;
  maxMessagesPerSecond = 200;
  state = new PlazaState();
  private internal = new Map<string, Internal>();
  private unsubBoard: (() => void) | null = null;
  private unsubFlush: (() => void) | null = null;
  private wfTimer: NodeJS.Timeout | null = null;
  private staffQueue: StaffTask[] = [];
  private staff: { task: StaffTask | null; phase: StaffPhase; path: Array<{ x: number; z: number }>; until: number } = { task: null, phase: 'idle', path: [], until: 0 };
  private incense: number[] = [];
  private orangeHour = -1;
  private lanterns: Array<{ id: string; sid: string; x: number; z: number; t0: number; wish: string; pub: boolean; seed: number }> = [];
  /** 打小人排队：先到先打；空位会先留给排第一的人一段时间 */
  private vQueue: string[] = [];
  private vHoldUntil = new Map<number, number>();

  onCreate() {
    this.setPatchRate(GAME_CONFIG.room.patchMs);
    this.state.no = ++roomCounter;
    const lastEmote = new Map<string, number>();
    this.onMessage('emote', (client, m: { e?: unknown }) => {
      if (typeof m?.e !== 'string' || !(EMOTES as readonly string[]).includes(m.e)) return;
      const now = Date.now();
      if (now - (lastEmote.get(client.sessionId) ?? 0) < 1000) return;
      lastEmote.set(client.sessionId, now);
      this.broadcast('emote', { sid: client.sessionId, e: m.e });
    });
    const lastChat = new Map<string, number>();
    this.onMessage('villain.queue', (client) => this.onVillainQueue(client));
    this.onMessage('orange.give', (client, m: { to?: unknown }) => this.onOrangeGive(client, m));
    // 本地测试：把舞狮时钟拨到第 at 秒（线上不开放）
    this.onMessage('debug.lion', (_c, m: { at?: unknown }) => {
      if (process.env.ALLOW_DEBUG !== '1' || typeof m?.at !== 'number') return;
      const t = (Date.now() / 1000) % 3600; this.state.evOff = (m.at - t) * 1000; this.orangeHour = -1; this.state.oranges.clear();
    });
    this.onMessage('burn.throw', (client, m: { text?: unknown }) => this.onBurn(client, m));
    this.onMessage('lantern.launch', (client, m: { requestId?: unknown; text?: unknown; pub?: unknown }) => { void this.onLantern(client, m); });
    this.onMessage('ring.start', (client, m: { requestId?: unknown }) => { void this.onRingStart(client, m); });
    this.onMessage('ring.throw', (client, m: { seq?: unknown; a?: unknown; p?: unknown }) => { void this.onRingThrow(client, m); });
    this.onMessage('photo.shoot', (client) => this.onPhoto(client));
    this.onMessage('villain.unqueue', (client) => this.leaveVillainQueue(client.sessionId));
    this.onMessage('chat', (client, m: { t?: unknown }) => {
      const text = cleanChat(m?.t); if (!text) return;
      const now = Date.now();
      if (now - (lastChat.get(client.sessionId) ?? 0) < CHAT.minGapMs) return client.send('chat.slow', {});
      lastChat.set(client.sessionId, now);
      this.broadcast('chat', { sid: client.sessionId, t: text });
    });
    for (const s of SEATS) { const seat = new SeatS(); seat.id = s.id; this.state.seats.push(seat); }
    this.state.aneh.x = COUNTER.x; this.state.aneh.z = COUNTER.z; this.state.aneh.yaw = Math.PI / 2;
    this.setSimulationInterval(() => this.tick(), TICK_MS);

    this.unsubBoard = leaderboard.subscribe((b) => { this.broadcast(MSG.S_LEADERBOARD, b); });
    this.unsubFlush = hitPipeline.onFlush((info) => {
      if (!info.ok) this.broadcast(MSG.S_NOTICE, { kind: 'save_delayed', text: '榜单保存延迟，系统正在重试' });
    });

    this.onMessage(MSG.C_TIME, (client, m: { c?: unknown }) => {
      client.send(MSG.S_TIME, { c: typeof m?.c === 'number' ? m.c : 0, s: Date.now() });
    });
    this.onMessage(MSG.C_MOVE, (client, m: { seq?: unknown; mx?: unknown; mz?: unknown; run?: unknown }) => this.onMove(client, m));
    this.onMessage(MSG.C_FOREGROUND, (client, m: { visible?: unknown }) => {
      const it = this.internal.get(client.sessionId);
      if (it && m?.visible === false) it.inputs.length = 0; // 后台：清零输入
    });
    this.onMessage(MSG.C_SEAT_REQUEST, (client, m: { seatId?: unknown; requestId?: unknown }) => this.onSeatRequest(client, m));
    this.onMessage(MSG.C_SEAT_LEAVE, (client) => this.onSeatLeave(client));
    this.onMessage(MSG.C_SESSION_START, (client, m: { targetDisplayName?: unknown; requestId?: unknown }) => { void this.onSessionStart(client, m); });
    this.onMessage(MSG.C_HIT, (client, m: { sessionId?: unknown; seq?: unknown; ct?: unknown }) => this.onHit(client, m));
    this.onMessage(MSG.C_SESSION_END, (client, m: { sessionId?: unknown }) => this.onSessionEnd(client, m));
    this.onMessage('avatar.refresh', (client) => { void this.refreshAvatar(client); });
    this.onMessage('woodfish.hit', (client, m: { seq?: unknown }) => { void this.onWoodfish(client, m); });
    this.onMessage('bath.beat', (client, m: { visible?: unknown }) => this.onBathBeat(client, m));
    this.onMessage('mamak.call', (client) => this.onMamakCall(client));
    this.onMessage('mamak.decline', (client) => this.onMamakDecline(client));
    this.onMessage('mamak.order', (client, m: { item?: unknown; requestId?: unknown }) => { void this.onMamakOrder(client, m); });
    this.onMessage('mamak.eat', (client) => this.onMamakEat(client));
    this.onMessage('pray.incense', (client) => this.onIncense(client));
    this.onMessage('fortune.draw', (client, m: { requestId?: unknown }) => { void this.onFortune(client, m); });
    this.onMessage('fortune.today', async (client) => {
      const it = this.internal.get(client.sessionId); if (!it) return;
      const r = await pool.query('SELECT fortune_no FROM fortune_daily WHERE player_id=$1 AND day=$2', [it.playerId, klDay(Date.now())]).catch(() => null);
      client.send('fortune.today', { no: r?.rows[0]?.fortune_no ?? null });
    });
    this.onMessage('pray.donate', (client, m: { amount?: unknown; requestId?: unknown }) => { void this.onDonate(client, m); });
    this.wfTimer = setInterval(() => { void this.flushWoodfish(); }, 3000);
    this.onMessage('wallet.get', async (client) => {
      const it = this.internal.get(client.sessionId); if (!it) return;
      try { client.send(MSG.S_WALLET, await getWallet(it.playerId)); } catch { /* */ }
    });
    this.onMessage('result.get', async (client, m: { sessionId?: unknown }) => {
      const it = this.internal.get(client.sessionId); if (!it || typeof m?.sessionId !== 'string') return;
      const r = await getSessionResult(m.sessionId, it.playerId).catch(() => null);
      if (r) client.send(MSG.S_RESULT, r);
    });
  }

  async onAuth(_client: Client, options: { token?: unknown }) {
    const who = await verifyToken(options?.token);
    if (!who) throw new Error('unauthorized');
    return who;
  }

  async onJoin(client: Client, _options: unknown, auth: { playerId: string; nickname: string | null }) {
    const av = await pool.query('SELECT config_json FROM avatars WHERE player_id=$1', [auth.playerId]);
    const parsed = av.rowCount ? validateAvatar(av.rows[0].config_json) : null;
    const cfg = parsed && parsed.ok ? parsed.value : DEFAULT_AVATAR;

    // 同一身份再次进入（刷新/换标签页）：接管旧实体，保留位置和座位
    let takeover: { key: string; p: PlayerS; it: Internal } | null = null;
    for (const [key, it] of this.internal) {
      if (it.playerId === auth.playerId && key !== client.sessionId) { takeover = { key, p: this.state.players.get(key)!, it }; break; }
    }

    const p = new PlayerS();
    p.name = auth.nickname ?? '游客';
    p.av = avatarToIndices(cfg).join(',');
    const it: Internal = {
      playerId: auth.playerId, inputs: [], credit: 0, seatRequests: new Map(), path: [], pathDeadline: 0,
      stateBeforeDrop: PSTATE.MOVING, session: null, sessionRequests: new Map(), superseded: false,
      wf: { seen: new Set(), window: [], today: 0, pending: 0, loaded: false }, bath: null, order: null, orderBusy: null, lastIncense: 0, vPlayed: 0, done: new Map(), lastBurn: 0, lastPhoto: 0, ring: null, fortunes: new Map(), lastShake: 0,
    };
    if (takeover && takeover.p) {
      const o = takeover.p;
      p.x = o.x; p.z = o.z; p.yaw = o.yaw; p.seat = o.seat; p.hitSeq = o.hitSeq; p.orng = o.orng;
      p.st = o.st === PSTATE.DISCONNECTED ? takeover.it.stateBeforeDrop : o.st;
      p.actAt = o.actAt;
      it.path = takeover.it.path; it.pathDeadline = takeover.it.pathDeadline;
      it.session = takeover.it.session; it.sessionRequests = takeover.it.sessionRequests;
      it.wf = takeover.it.wf; it.bath = takeover.it.bath; it.order = takeover.it.order; it.lastIncense = takeover.it.lastIncense;
      if (it.order) it.order.it = it;
      if (p.seat >= 0) { const seat = this.state.seats[p.seat]; if (seat && seat.by === takeover.key) seat.by = client.sessionId; }
      takeover.it.superseded = true;
      takeover.it.session = null;
      this.state.players.delete(takeover.key);
      this.internal.delete(takeover.key);
      try { takeover.it.reconnection?.reject(new Error('superseded')); } catch { /* */ }
      const old = this.clients.find((c) => c.sessionId === takeover!.key);
      old?.leave(4002, 'superseded');
    } else {
      p.x = SPAWN.x + (Math.random() - 0.5) * SPAWN.radius;
      p.z = SPAWN.z + (Math.random() - 0.5) * SPAWN.radius;
      p.yaw = 0;
      p.st = PSTATE.MOVING;
    }
    this.internal.set(client.sessionId, it);
    this.state.players.set(client.sessionId, p);
    metrics.joins++;

    try { client.send(MSG.S_WALLET, await getWallet(auth.playerId)); } catch { /* */ }
    if (!takeover) { const q = await pool.query("SELECT qty FROM player_items WHERE player_id=$1 AND item='orange'", [auth.playerId]).catch(() => null); p.orng = Math.min(255, q?.rows[0]?.qty ?? 0); }
    if (leaderboard.latest) client.send(MSG.S_LEADERBOARD, leaderboard.latest);
    if (it.session) this.sendSessionState(client, it.session);
    // 天上还在飞的天灯（只给灯，不给别人的愿望文字，除非公开）
    const now = Date.now(); this.lanterns = this.lanterns.filter((l) => now - l.t0 < GAME_CONFIG.lantern.flightMs);
    for (const l of this.lanterns) client.send('lantern', { ...l, wish: l.pub ? l.wish : undefined, mine: false });
  }

  onDrop(client: Client) {
    const it = this.internal.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (!it || !p || it.superseded) return;
    metrics.drops++;
    it.stateBeforeDrop = p.st === PSTATE.DISCONNECTED ? it.stateBeforeDrop : p.st;
    p.st = PSTATE.DISCONNECTED; p.conn = false; p.speed = 0;
    it.inputs.length = 0;
    try {
      const d = this.allowReconnection(client, GAME_CONFIG.room.reconnectGraceSec);
      // 宽限超时/被接管/尚未完成进房时会 reject：必须捕获，否则会让整个进程退出
      d.catch(() => { /* onLeave 负责清理 */ });
      it.reconnection = d;
    } catch (e) {
      console.warn('[room] allowReconnection failed', (e as Error).message);
    }
  }

  onReconnect(client: Client) {
    const it = this.internal.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (!it || !p) return;
    p.st = it.stateBeforeDrop; p.conn = true;
    it.inputs.length = 0; it.credit = 0;
    void getWallet(it.playerId).then((w) => client.send(MSG.S_WALLET, w)).catch(() => {});
    if (leaderboard.latest) client.send(MSG.S_LEADERBOARD, leaderboard.latest);
    if (it.session) this.sendSessionState(client, it.session);
  }

  onLeave(client: Client) {
    const it = this.internal.get(client.sessionId);
    if (!it || it.superseded) return;
    const p = this.state.players.get(client.sessionId);
    this.cancelOrder(it, 'left');
    this.leaveVillainQueue(client.sessionId);
    if (p && p.seat >= 0) this.freeSeat(p.seat);
    it.bath = null;
    void this.flushWoodfish();
    // 进行中的局按原 endsAt 结束并封存（不补收断线期间的点击）
    if (it.session && (it.session.phase === 'active' || it.session.phase === 'countdown')) {
      const sess = it.session;
      if (sess.phase === 'countdown') { this.cancelSession(it, sess, 'left'); }
    }
    this.state.players.delete(client.sessionId);
    this.internal.delete(client.sessionId);
  }

  onDispose() {
    for (const it of this.internal.values()) this.cancelOrder(it, 'closed');
    this.unsubBoard?.();
    this.unsubFlush?.();
    if (this.wfTimer) clearInterval(this.wfTimer);
    void this.flushWoodfish();
  }

  // ───────────────────── 移动 ─────────────────────

  private onMove(client: Client, m: { seq?: unknown; mx?: unknown; mz?: unknown; run?: unknown }) {
    const it = this.internal.get(client.sessionId);
    if (!it) return;
    const seq = typeof m?.seq === 'number' && Number.isInteger(m.seq) && m.seq > 0 ? m.seq : 0;
    if (!seq) return;
    const { mx, mz } = sanitizeMove(m.mx, m.mz);
    it.inputs.push({ seq, mx, mz, run: m.run === true });
    if (it.inputs.length > 45) it.inputs.splice(0, it.inputs.length - 45);
  }

  private tick() {
    const t0 = performance.now();
    this.tickInner();
    metrics.recordTick(performance.now() - t0);
  }

  private tickInner() {
    const now = Date.now();
    for (const [sid, p] of this.state.players) {
      const it = this.internal.get(sid);
      if (!it) continue;
      it.credit = Math.min(GAME_CONFIG.movement.maxInputCredit, it.credit + 1);

      if (p.st === PSTATE.MOVING) {
        let moved = false;
        // 抖动缓冲：正常每 tick 处理 1 条输入；积压超过 3 条时每 tick 追 2 条，避免成批到达时位置跳动
        let budget = it.inputs.length > 3 ? 2 : 1;
        while (it.inputs.length && it.credit > 0 && budget-- > 0) {
          const inp = it.inputs.shift()!;
          if (inp.seq <= p.lastInput) continue;
          const r = stepMove({ x: p.x, z: p.z, yaw: p.yaw, speed: p.speed }, inp);
          p.x = r.x; p.z = r.z; if (r.speed > 0.01) p.yaw = r.yaw; p.speed = r.speed;
          p.lastInput = inp.seq; it.credit--; moved = true;
        }
        if (!moved) p.speed = 0;
      } else {
        // 非自由移动状态：确认并丢弃输入，客户端据此停止预测
        if (it.inputs.length) { p.lastInput = Math.max(p.lastInput, it.inputs[it.inputs.length - 1].seq); it.inputs.length = 0; }
      }

      if (p.st === PSTATE.APPROACHING) this.tickApproach(sid, p, it, now);
      else if (p.st === PSTATE.SITTING && now - p.actAt >= S.sitDownMs) {
        p.st = PSTATE.SEATED_IDLE; p.hitSeq = 0;
        const seat = this.state.seats[p.seat]; if (seat) { seat.st = SEAT_STATE.OCCUPIED; seat.until = 0; }
        if (SEATS[p.seat]?.kind === 'bath') it.bath = { id: randomUUID(), activeMs: 0, lastBeat: now, minute: 0, lastTick: now };
        if (SEATS[p.seat]?.kind === 'mamak' && !it.order) this.enqueueVisit(p.seat, sid);
      } else if (p.st === PSTATE.STANDING) this.tickStanding(sid, p, it, now);
      if (it.bath) this.tickBath(sid, p, it, now);
    }
    this.tickStaff(now);
    this.tickLion(now);
    for (const [seatId, until] of this.vHoldUntil) if (now > until) { // 轮到的人没来：给下一个
      const seat = this.state.seats[seatId]; this.vHoldUntil.delete(seatId);
      if (seat && seat.st === SEAT_STATE.FREE) { const who = seat.hold; seat.hold = ''; this.clients.find((c) => c.sessionId === who)?.send('villain.turn', { expired: true }); this.offerVillainSeat(seatId); }
    }
    if (this.incense.length && this.incense[0] < now) { this.incense = this.incense.filter((t) => t > now); this.state.incense = this.incense.length; }
    // 预约超时释放
    for (const seat of this.state.seats) {
      if (seat.st === SEAT_STATE.RESERVED && now > seat.until) {
        const p = this.state.players.get(seat.by);
        if (p && p.st === PSTATE.APPROACHING) { p.st = PSTATE.MOVING; p.seat = -1; p.speed = 0; }
        this.freeSeat(seat.id);
      }
    }
  }

  private tickApproach(sid: string, p: PlayerS, it: Internal, now: number) {
    const target = it.path[0];
    const seat = this.state.seats[p.seat];
    if (!seat || seat.by !== sid) { p.st = PSTATE.MOVING; p.seat = -1; return; }
    if (!target) {
      // 到达座位锚点：转身坐下
      const def = SEATS[p.seat];
      p.x = def.seat.x; p.z = def.seat.z; p.yaw = def.seat.yaw; p.speed = 0;
      p.st = PSTATE.SITTING; p.actAt = now;
      seat.st = SEAT_STATE.SITTING; seat.until = 0;
      return;
    }
    const r = stepToward({ x: p.x, z: p.z, yaw: p.yaw, speed: 0 }, target.x, target.z, TICK_MS / 1000, undefined, COLLIDERS_SEATING);
    p.x = r.state.x; p.z = r.state.z; p.yaw = r.state.yaw; p.speed = r.state.speed;
    if (r.arrived) it.path.shift();
    else if (r.blocked && it.path.length > 1) {
      // 被挡：放弃（不瞬移穿桌）
      p.st = PSTATE.MOVING; p.speed = 0; this.freeSeat(p.seat); p.seat = -1;
      this.clients.find((c) => c.sessionId === sid)?.send(MSG.S_NOTICE, { kind: 'path_blocked', text: '路被挡住了，请走近一点再试' });
    }
  }

  private tickStanding(sid: string, p: PlayerS, it: Internal, now: number) {
    if (now - p.actAt < S.standUpMs) return;
    if (p.seat >= 0) {
      // 起身动作完成后释放座位并走到离开点
      this.freeSeat(p.seat);
      p.seat = -1;
    }
    const target = it.path[0];
    if (!target) { p.st = PSTATE.MOVING; p.speed = 0; return; }
    const r = stepToward({ x: p.x, z: p.z, yaw: p.yaw, speed: 0 }, target.x, target.z, TICK_MS / 1000, undefined, COLLIDERS_SEATING);
    p.x = r.state.x; p.z = r.state.z; p.yaw = r.state.yaw; p.speed = r.state.speed;
    if (r.arrived || r.blocked || now - p.actAt > 4000) it.path.shift();
    void sid;
  }

  // ───────────────────── 座位 ─────────────────────

  private onSeatRequest(client: Client, m: { seatId?: unknown; requestId?: unknown }) {
    const it = this.internal.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (!it || !p) return;
    const requestId = typeof m?.requestId === 'string' ? m.requestId.slice(0, 64) : '';
    const seatId = typeof m?.seatId === 'number' && Number.isInteger(m.seatId) ? m.seatId : -1;
    if (!requestId) return;
    const prev = it.seatRequests.get(requestId);
    if (prev) { client.send(MSG.S_SEAT_RESULT, { requestId, ...prev }); return; }
    const reply = (r: { ok: boolean; seatId: number; reason?: string }) => {
      it.seatRequests.set(requestId, r);
      if (it.seatRequests.size > 50) it.seatRequests.delete(it.seatRequests.keys().next().value!);
      client.send(MSG.S_SEAT_RESULT, { requestId, ...r });
    };
    const def = SEATS[seatId];
    const seat = this.state.seats[seatId];
    if (!def || !seat) return reply({ ok: false, seatId, reason: 'no_such_seat' });
    if (p.st !== PSTATE.MOVING || p.seat >= 0) return reply({ ok: false, seatId, reason: 'busy' });
    const dist = Math.hypot(p.x - def.seat.x, p.z - def.seat.z);
    const heldForMe = def.kind === 'villain' && seat.hold === client.sessionId;
    if (dist > S.interactRadius + 0.5 && !(heldForMe && dist < 9)) return reply({ ok: false, seatId, reason: 'too_far' });
    // 服务器单线程原子分配：只有 FREE 才能被预约
    if (seat.st !== SEAT_STATE.FREE) return reply({ ok: false, seatId, reason: 'taken' });
    // 打小人有人排队：空位只留给轮到的人；没轮到的人要先排队
    if (def.kind === 'villain') {
      if (seat.hold && seat.hold !== client.sessionId) return reply({ ok: false, seatId, reason: 'queue' });
      if (!seat.hold && this.vQueue.length && this.vQueue[0] !== client.sessionId) return reply({ ok: false, seatId, reason: 'queue' });
    }
    seat.st = SEAT_STATE.RESERVED; seat.by = client.sessionId; seat.until = Date.now() + (heldForMe ? 9000 : S.reserveMs);
    if (heldForMe) { seat.hold = ''; this.vHoldUntil.delete(seatId); }
    if (def.kind === 'villain') { this.leaveVillainQueue(client.sessionId); it.vPlayed = 0; }
    p.seat = seatId; p.st = PSTATE.APPROACHING; p.actAt = Date.now();
    it.inputs.length = 0;
    // 路径：先走到座位正前方的站立点（位于街道一侧），再进蒲团；不穿台
    const path: Array<{ x: number; z: number }> = [];
    if (heldForMe && Math.hypot(p.x - def.approach.x, p.z - def.approach.z) > 2.5) path.push({ x: -0.6, z: def.approach.z }); // 从街中间走过来，不穿砖台
    if (Math.hypot(p.x - def.approach.x, p.z - def.approach.z) > 0.25) path.push({ x: def.approach.x, z: def.approach.z });
    path.push({ x: def.seat.x, z: def.seat.z });
    it.path = path;
    reply({ ok: true, seatId });
    metrics.seatGrants++;
  }

  private onSeatLeave(client: Client) {
    const it = this.internal.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (!it || !p || p.seat < 0) return;
    if (it.session && (it.session.phase === 'active')) this.endSessionEarly(it.session);
    if (it.session && it.session.phase === 'countdown') this.cancelSession(it, it.session, 'left_seat');
    if (p.st === PSTATE.APPROACHING) { this.freeSeat(p.seat); p.seat = -1; p.st = PSTATE.MOVING; return; }
    it.bath = null; // 离开池子：未满一分钟的进度清零
    this.cancelOrder(it, 'left_seat'); // 吃完之前离开：取消订单、拿走食物、全额退款
    if (p.st === PSTATE.SITTING || p.st === PSTATE.SEATED_IDLE || p.st === PSTATE.HITTING) {
      const def = SEATS[p.seat];
      p.st = PSTATE.STANDING; p.actAt = Date.now(); p.speed = 0;
      const seat = this.state.seats[p.seat]; if (seat) seat.st = SEAT_STATE.STANDING;
      it.path = [{ x: def.approach.x, z: def.approach.z }];
    }
  }

  private freeSeat(seatId: number) {
    const seat = this.state.seats[seatId];
    if (!seat) return;
    seat.st = SEAT_STATE.FREE; seat.by = ''; seat.until = 0; seat.food = ''; seat.hold = '';
    if (SEATS[seatId]?.kind === 'villain') this.offerVillainSeat(seatId);
    this.staffQueue = this.staffQueue.filter((t) => !(t.kind === 'visit' && t.seatId === seatId));
    if (this.staff.task?.kind === 'visit' && this.staff.task.seatId === seatId) this.staffDone();
  }

  // ───────────────────── 打小人局 ─────────────────────

  private sendSessionState(client: Client, s: HitSession) {
    client.send(MSG.S_SESSION, {
      phase: s.phase, sessionId: s.id, requestId: s.requestId, displayName: s.displayName,
      startsAt: s.startsAt, endsAt: s.endsAt, accepted: s.accepted, maxCombo: s.maxCombo,
    });
    if (s.result) client.send(MSG.S_RESULT, s.result);
  }

  private async onSessionStart(client: Client, m: { targetDisplayName?: unknown; requestId?: unknown }) {
    const it = this.internal.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (!it || !p) return;
    const requestId = typeof m?.requestId === 'string' ? m.requestId.slice(0, 64) : '';
    if (!requestId) return;
    const err = (reason: string, extra: Record<string, unknown> = {}) => client.send(MSG.S_SESSION, { phase: 'error', requestId, reason, ...extra });
    // 同一 requestId 重复点击：返回同一局
    const existingId = it.sessionRequests.get(requestId);
    if (existingId) { if (it.session?.id === existingId) this.sendSessionState(client, it.session); return; }
    if (p.st !== PSTATE.SEATED_IDLE || p.seat < 0 || SEATS[p.seat]?.kind !== 'villain') return err('not_seated');
    if (it.session && (it.session.phase === 'countdown' || it.session.phase === 'active' || it.session.phase === 'ending')) return err('already_running');
    if (it.vPlayed >= 1 && this.vQueue.length) return err('queue_waiting'); // 后面有人排队：打完一局先让位
    const name = normalizeTargetName(m?.targetDisplayName);
    if (!name.ok) return err(`name_${name.error}`);
    it.sessionRequests.set(requestId, 'pending');
    const tStart = Date.now();
    let wallet;
    try { wallet = await getWallet(it.playerId); } catch { it.sessionRequests.delete(requestId); return err('db_unavailable'); }
    if (wallet.energy < V.energyCost) { it.sessionRequests.delete(requestId); return err('no_energy', { wallet }); }
    // 期间状态可能变化
    if (p.st !== PSTATE.SEATED_IDLE || !this.internal.has(client.sessionId)) { it.sessionRequests.delete(requestId); return err('not_seated'); }

    const now = Date.now();
    const s: HitSession = {
      id: randomUUID(), requestId, targetId: 0, displayName: name.displayName,
      startsAt: now + V.countdownMs, endsAt: now + V.countdownMs + V.durationMs, phase: 'countdown',
      seen: new Set(), lastCt: 0, accepted: 0, rejected: 0, combo: 0, maxCombo: 0, lastAcceptAt: 0, window: [], timers: [],
    };
    try {
      s.targetId = await upsertTarget(name.key, name.displayName);
      await pool.query(
        `INSERT INTO hit_sessions(id, player_id, target_id, request_id, room_id, seat_id, config_version, starts_at, ends_at, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'countdown')`,
        [s.id, it.playerId, s.targetId, requestId, this.roomId, p.seat, CONFIG_VERSION, new Date(s.startsAt), new Date(s.endsAt)],
      );
    } catch (e) {
      it.sessionRequests.delete(requestId);
      console.error('[session.start] db', (e as Error).message);
      return err('db_unavailable');
    }
    it.sessionRequests.set(requestId, s.id);
    if (Date.now() - tStart > 500) console.warn('[session.start] slow', Date.now() - tStart, 'ms');
    it.session = s; it.vPlayed++;
    this.sendSessionState(client, s);
    // 提前完成扣精力与开局，确保倒数结束那一刻的点击不会因开局确认未到而丢失（ct < startsAt 的仍按 before_start 拒收）
    s.timers.push(setTimeout(() => { void this.activateSession(client.sessionId, s); }, Math.max(0, s.startsAt - Date.now() - 250)));
  }

  private async activateSession(sid: string, s: HitSession) {
    const it = this.internal.get(sid) ?? [...this.internal.values()].find((x) => x.session === s);
    if (!it || it.session !== s || s.phase !== 'countdown') return;
    // 倒数结束正式开局：扣 5 精力一次（唯一 key）
    let r;
    try { r = await spend(it.playerId, 'energy', V.energyCost, 'villain_session', s.id, `villain:${s.id}:energy`); }
    catch { this.cancelSession(it, s, 'db_unavailable'); return; }
    if (!r.ok) { this.cancelSession(it, s, 'no_energy'); return; }
    if (s.phase !== 'countdown') return;
    s.phase = 'active';
    void pool.query(`UPDATE hit_sessions SET status='active' WHERE id=$1 AND status='countdown'`, [s.id]).catch(() => {});
    const key = this.keyOf(it);
    const p = key ? this.state.players.get(key) : undefined;
    if (p && p.st === PSTATE.SEATED_IDLE) { p.st = PSTATE.HITTING; p.actAt = Date.now(); p.hitSeq = 0; }
    const client = key ? this.clients.find((c) => c.sessionId === key) : undefined;
    if (client) { this.sendSessionState(client, s); client.send(MSG.S_WALLET, r.wallet); }
    s.timers.push(setTimeout(() => { void this.finishSession(s); }, Math.max(0, s.endsAt + V.endGraceMs - Date.now())));
  }

  private keyOf(it: Internal): string | undefined {
    for (const [k, v] of this.internal) if (v === it) return k;
    return undefined;
  }

  private cancelSession(it: Internal, s: HitSession, reason: string) {
    s.phase = 'cancelled';
    s.timers.forEach(clearTimeout);
    void pool.query(`UPDATE hit_sessions SET status='cancelled', ended_at=now() WHERE id=$1 AND status IN ('countdown','active')`, [s.id]).catch(() => {});
    const key = this.keyOf(it);
    const client = key ? this.clients.find((c) => c.sessionId === key) : undefined;
    client?.send(MSG.S_SESSION, { phase: 'cancelled', sessionId: s.id, requestId: s.requestId, reason });
    if (it.session === s) it.session = null;
  }

  private onHit(client: Client, m: { sessionId?: unknown; seq?: unknown; ct?: unknown }) {
    const it = this.internal.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    const s = it?.session;
    const now = Date.now();
    const nack = (seq: unknown, reason: string) => {
      if (s) s.rejected++;
      metrics.hitsRejected++;
      client.send(MSG.S_HIT_ACK, { sessionId: s?.id, seq, ok: false, reason, count: s?.accepted ?? 0 });
    };
    if (!it || !p || !s || m?.sessionId !== s.id) return nack(m?.seq, 'no_session');
    const seq = m.seq; const ct = m.ct;
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1 || seq > V.maxSeqPerSession) return nack(seq, 'bad_seq');
    if (s.seen.has(seq)) { client.send(MSG.S_HIT_ACK, { sessionId: s.id, seq, ok: false, reason: 'duplicate', count: s.accepted }); return; }
    if (s.phase !== 'active' && !(s.phase === 'ending' && now <= s.endsAt + V.endGraceMs)) return nack(seq, s.phase === 'countdown' ? 'countdown' : 'ended');
    if (typeof ct !== 'number' || !Number.isFinite(ct)) return nack(seq, 'bad_time');
    // 服务器单调时钟校验：客户端估算时间不可任意偏离或倒拨
    if (Math.abs(ct - now) > 1500) return nack(seq, 'clock');
    if (ct < s.lastCt - 5) return nack(seq, 'clock_backwards');
    if (ct < s.startsAt - 30) return nack(seq, 'before_start');
    if (ct > s.endsAt || now > s.endsAt + V.endGraceMs) return nack(seq, 'after_end');
    // 反作弊：滑动 1 秒窗口（不是玩法上限；阈值待实测）
    while (s.window.length && now - s.window[0] > 1000) s.window.shift();
    if (s.window.length >= V.antiCheatMaxPerSecond) { console.warn('[anticheat] rate', it.playerId.slice(0, 8), s.window.length); return nack(seq, 'rate'); }

    s.seen.add(seq); s.window.push(now); s.lastCt = Math.max(s.lastCt, ct);
    s.combo = s.lastAcceptAt && now - s.lastAcceptAt <= V.comboGapMs ? s.combo + 1 : 1;
    s.maxCombo = Math.max(s.maxCombo, s.combo);
    s.lastAcceptAt = now;
    s.accepted++;
    p.hitSeq = s.accepted;
    hitPipeline.push({ sessionId: s.id, seq, targetId: s.targetId, playerId: it.playerId, acceptedAt: Math.min(now, s.endsAt) });
    metrics.hitsAccepted++;
    client.send(MSG.S_HIT_ACK, { sessionId: s.id, seq, ok: true, count: s.accepted, combo: s.combo });
  }

  private onSessionEnd(client: Client, m: { sessionId?: unknown }) {
    const it = this.internal.get(client.sessionId);
    const s = it?.session;
    if (!it || !s || m?.sessionId !== s.id) return;
    if (s.phase === 'countdown') { this.cancelSession(it, s, 'user_cancel'); return; }
    if (s.phase === 'active') this.endSessionEarly(s);
  }

  private endSessionEarly(s: HitSession) {
    if (s.phase !== 'active') return;
    s.endsAt = Math.min(s.endsAt, Date.now());
    s.timers.forEach(clearTimeout);
    s.timers = [setTimeout(() => { void this.finishSession(s); }, V.endGraceMs)];
  }

  private async finishSession(s: HitSession) {
    if (s.phase !== 'active') return;
    s.phase = 'ending';
    const it = [...this.internal.values()].find((x) => x.session === s);
    const key = it ? this.keyOf(it) : undefined;
    const p = key ? this.state.players.get(key) : undefined;
    if (p && p.st === PSTATE.HITTING) { p.st = PSTATE.SEATED_IDLE; p.actAt = Date.now(); }
    let result: SessionResult | null = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        await hitPipeline.flush();
        // 只看本局自己的事件是否全部落盘（全服队列里别人的事件不影响本局结算）
        const persisted = hitPipeline.persistedBySession.get(s.id) ?? 0;
        if (persisted < s.accepted && attempt < 29) {
          // 还有本局事件未落盘（数据库暂时失败）→ 告知“待保存”并重试
          const c = key ? this.clients.find((x) => x.sessionId === key) : undefined;
          c?.send(MSG.S_RESULT, this.pendingResult(s));
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        await sealSession(s.id, s.maxCombo, s.rejected, s.endsAt);
        result = await getSessionResult(s.id);
        break;
      } catch (e) {
        const c = key ? this.clients.find((x) => x.sessionId === key) : undefined;
        c?.send(MSG.S_RESULT, this.pendingResult(s));
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    s.phase = 'done';
    hitPipeline.persistedBySession.delete(s.id);
    s.result = result ?? this.pendingResult(s);
    const k2 = it ? this.keyOf(it) : undefined; // 期间可能被接管/重连
    const c = k2 ? this.clients.find((x) => x.sessionId === k2) : undefined;
    c?.send(MSG.S_RESULT, s.result);
    void leaderboard.refresh();
  }

  private pendingResult(s: HitSession): SessionResult {
    return {
      sessionId: s.id, targetDisplayName: s.displayName, acceptedCount: s.accepted, maxCombo: s.maxCombo,
      targetToday: 0, targetAllTime: 0, todayRank: null, allRank: null, contribution: s.accepted, status: 'pending', day: '',
    };
  }

  // ───────────────────── 木鱼禅院 ─────────────────────

  private async onWoodfish(client: Client, m: { seq?: unknown }) {
    const it = this.internal.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (!it || !p) return;
    const seq = m?.seq;
    const nack = (reason: string) => client.send('woodfish.ack', { seq, ok: false, reason, today: it.wf.today });
    if (p.seat < 0 || SEATS[p.seat]?.kind !== 'woodfish' || p.st !== PSTATE.SEATED_IDLE) return nack('not_seated');
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) return nack('bad_seq');
    if (it.wf.seen.has(seq)) return nack('duplicate');
    const now = Date.now();
    while (it.wf.window.length && now - it.wf.window[0] > 1000) it.wf.window.shift();
    if (it.wf.window.length >= WF.antiCheatMaxPerSecond) return nack('rate');
    if (!it.wf.loaded) {
      it.wf.loaded = true;
      const r = await pool.query('SELECT count FROM woodfish_counts WHERE player_id=$1 AND day=$2', [it.playerId, klDay(now)]).catch(() => null);
      it.wf.today += r?.rows[0]?.count ?? 0;
    }
    it.wf.seen.add(seq); if (it.wf.seen.size > 5000) it.wf.seen.clear();
    it.wf.window.push(now);
    it.wf.today++; it.wf.pending++;
    p.hitSeq++; // 同房其他人看到敲木鱼的动作
    client.send('woodfish.ack', { seq, ok: true, today: it.wf.today });
  }

  /** 批量写库（每 3 秒）：只记个人次数，不排行 */
  private async flushWoodfish() {
    const day = klDay(Date.now());
    for (const it of this.internal.values()) {
      if (!it.wf.pending) continue;
      const n = it.wf.pending; it.wf.pending = 0;
      await pool.query(`INSERT INTO woodfish_counts(player_id, day, count) VALUES ($1,$2,$3)
        ON CONFLICT (player_id, day) DO UPDATE SET count=woodfish_counts.count+EXCLUDED.count, updated_at=now()`, [it.playerId, day, n])
        .catch(() => { it.wf.pending += n; });
    }
  }

  // ───────────────────── 洗衰运 ─────────────────────

  private onBathBeat(client: Client, m: { visible?: unknown }) {
    const it = this.internal.get(client.sessionId);
    if (!it?.bath) return;
    if (m?.visible === false) { it.bath.activeMs = 0; it.bath.lastBeat = 0; return; } // 切到后台：暂停并清掉未满一分钟的进度
    it.bath.lastBeat = Date.now();
    client.send('bath.progress', { activeMs: it.bath.activeMs, everyMs: BATH.rewardEveryMs });
  }

  private tickBath(sid: string, p: PlayerS, it: Internal, now: number) {
    const b = it.bath!;
    const dt = now - b.lastTick; b.lastTick = now;
    if (p.seat < 0 || SEATS[p.seat]?.kind !== 'bath' || p.st === PSTATE.STANDING || p.st === PSTATE.DISCONNECTED) { it.bath = null; return; }
    if (p.st !== PSTATE.SEATED_IDLE) return;
    if (now - b.lastBeat > BATH.heartbeatTimeoutMs) { b.activeMs = 0; return; } // 没有前台心跳：不累计
    b.activeMs += dt;
    if (b.activeMs < BATH.rewardEveryMs) return;
    b.activeMs -= BATH.rewardEveryMs;
    b.minute++;
    void this.bathReward(sid, it, b.id, b.minute);
  }

  private async bathReward(sid: string, it: Internal, bathId: string, minute: number) {
    const day = klDay(Date.now());
    try {
      const w0 = await getWallet(it.playerId);
      let energy = 0, coins = 0;
      if (w0.energy < w0.maxEnergy) energy = (await credit(it.playerId, 'energy', BATH.energy, 'bath', bathId, `bath:${bathId}:${minute}:energy`)).applied;
      const got = await pool.query(`SELECT count(*)::int AS n, COALESCE(sum(delta),0)::int AS c FROM ledger WHERE player_id=$1 AND reason='bath_coin' AND idempotency_key LIKE $2`, [it.playerId, `bathcoin:${it.playerId}:${day}:%`]);
      const rows = got.rows[0].n as number; let coinsToday = got.rows[0].c as number;
      const amount = Math.min(BATH.coins, BATH.dailyCoinCap - coinsToday);
      if (amount > 0) { coins = (await credit(it.playerId, 'coins', amount, 'bath_coin', bathId, `bathcoin:${it.playerId}:${day}:${rows + 1}`)).applied; coinsToday += coins; }
      const client = this.clients.find((c) => c.sessionId === (this.keyOf(it) ?? sid));
      if (client) {
        client.send(MSG.S_WALLET, await getWallet(it.playerId));
        client.send('bath.reward', { energy, coins, coinsToday, coinCap: BATH.dailyCoinCap });
      }
    } catch (e) { console.warn('[bath] reward failed', (e as Error).message); }
  }

  // ───────────────────── 舞狮采青 · 接旺桔 ─────────────────────

  private tickLion(now: number) {
    const t = lionElapsed(now, this.state.evOff);
    const hour = Math.floor((now + this.state.evOff) / 3_600_000);
    if (t === null || t > LION.oranges + LION.orangeLifeS) { if (this.state.oranges.length) this.state.oranges.clear(); return; }
    if (t >= LION.oranges && this.orangeHour !== hour) {
      // 抛桔子：数量跟人数走，每个在场的人都有机会；落在狮子身后（街上）不在桌子、柱子里的地方
      this.orangeHour = hour; this.state.oranges.clear();
      const n = Math.max(LION.orangeCount, this.state.players.size * 2);
      let tries = 0;
      while (this.state.oranges.length < n && tries++ < 400) {
        const a = (Math.random() - 0.5) * 2.6, r = 1.6 + Math.random() * 2.8;
        const x = LION.end.x + Math.sin(a) * r, z = LION.end.z - Math.cos(a) * r;
        if (!insideWalk(x, z) || isBlocked(x, z, 0.35 as number as 0.28)) continue;
        const o = new OrangeS(); o.id = `${hour}-${this.state.oranges.length}`; o.x = x; o.z = z; o.t0 = now + this.state.oranges.length * 120; this.state.oranges.push(o);
      }
      this.broadcast('act', { sid: '', a: 'lionThrow' });
    }
    if (!this.state.oranges.length) return;
    // 接桔子：走到桔子旁边就接到（落地之后才能接）
    for (const [sid, p] of this.state.players) {
      if (p.st !== PSTATE.MOVING) continue;
      for (const o of this.state.oranges) {
        if (o.by || now < o.t0 + 900 || Math.hypot(p.x - o.x, p.z - o.z) > LION.orangeCatchR) continue;
        const it = this.internal.get(sid); if (!it) break;
        const key = `${it.playerId}:${this.orangeHour}`; const got = orangeTaken.get(key) ?? 0;
        if (got >= ORANGE_CAP) break; // 这场已经接满，留给别人
        orangeTaken.set(key, got + 1); if (orangeTaken.size > 5000) orangeTaken.clear();
        o.by = sid; p.orng = Math.min(255, p.orng + 1);
        void this.addItem(it.playerId, 'orange', 1);
        this.clients.find((c) => c.sessionId === sid)?.send('orange.got', { total: p.orng });
        break;
      }
    }
  }
  private addItem(playerId: string, item: string, d: number) {
    return pool.query(`INSERT INTO player_items(player_id, item, qty) VALUES ($1,$2,GREATEST(0,$3)) ON CONFLICT (player_id, item) DO UPDATE SET qty=GREATEST(0, player_items.qty+$3), updated_at=now()`, [playerId, item, d]).catch(() => {});
  }
  /** 把一颗旺桔递给旁边的朋友 */
  private onOrangeGive(client: Client, m: { to?: unknown }) {
    const p = this.state.players.get(client.sessionId); const it = this.internal.get(client.sessionId);
    const to = typeof m?.to === 'string' ? m.to : ''; const q = this.state.players.get(to); const jt = this.internal.get(to);
    if (!p || !it || !q || !jt || to === client.sessionId || p.orng < 1) return;
    if (Math.hypot(p.x - q.x, p.z - q.z) > 3) return client.send(MSG.S_NOTICE, { kind: 'far', text: '再走近一点才能递给他' });
    p.orng--; q.orng = Math.min(255, q.orng + 1);
    void this.addItem(it.playerId, 'orange', -1); void this.addItem(jt.playerId, 'orange', 1);
    this.broadcast('act', { sid: client.sessionId, a: 'give', to, from: p.name, toName: q.name });
  }

  // ───────────────────── 烧掉烦恼、天灯、套圈、拍照 ─────────────────────

  private standingAt(client: Client, kind: string) {
    const it = this.internal.get(client.sessionId); const p = this.state.players.get(client.sessionId);
    if (!it || !p || p.seat < 0 || SEATS[p.seat]?.kind !== kind || p.st !== PSTATE.SEATED_IDLE) return null;
    return { it, p };
  }

  /** 烧烦恼：写的字不保存、不广播；别人只看到纸丢进炉子烧起来 */
  private onBurn(client: Client, m: { text?: unknown }) {
    const a = this.standingAt(client, 'burn'); if (!a) return;
    const t = cleanChat(typeof m?.text === 'string' ? m.text.slice(0, GAME_CONFIG.burn.maxChars * 2) : '');
    if (!t) return;
    const now = Date.now(); if (now - a.it.lastBurn < GAME_CONFIG.burn.gapMs) return; a.it.lastBurn = now;
    this.broadcast('act', { sid: client.sessionId, a: 'burn', seat: a.p.seat });
  }

  private async onLantern(client: Client, m: { requestId?: unknown; text?: unknown; pub?: unknown }) {
    const LT = GAME_CONFIG.lantern;
    const a = this.standingAt(client, 'lantern');
    const requestId = typeof m?.requestId === 'string' ? m.requestId.slice(0, 64) : '';
    if (!requestId) return;
    if (!a) return client.send('lantern.result', { requestId, ok: false, reason: 'not_here' });
    const prev = a.it.done.get(requestId); if (prev) return client.send('lantern.result', prev);
    const wish = Array.from(String(m?.text ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim()).slice(0, LT.wishMaxChars).join('');
    if (!wish) return client.send('lantern.result', { requestId, ok: false, reason: 'empty' });
    const id = randomUUID();
    let r;
    try { r = await spend(a.it.playerId, 'coins', LT.price, 'sky_lantern', id, `lantern:${a.it.playerId}:${requestId}`); } catch { return client.send('lantern.result', { requestId, ok: false, reason: 'db_unavailable' }); }
    if (!r.ok) return client.send('lantern.result', { requestId, ok: false, reason: 'insufficient', wallet: r.wallet });
    client.send(MSG.S_WALLET, r.wallet);
    const res = { requestId, ok: true, launchId: id }; a.it.done.set(requestId, res); if (a.it.done.size > 40) a.it.done.delete(a.it.done.keys().next().value!);
    client.send('lantern.result', res);
    if (r.replay) return;
    const def = SEATS[a.p.seat];
    const l = { id, sid: client.sessionId, x: def.hit.x, z: def.hit.z, t0: Date.now() + 1500, wish, pub: m?.pub === true, seed: Math.random() };
    this.lanterns.push(l); while (this.lanterns.length > LT.maxInSky) this.lanterns.shift();
    for (const c of this.clients) c.send('lantern', { ...l, wish: l.pub || c.sessionId === client.sessionId ? wish : undefined, mine: c.sessionId === client.sessionId });
  }

  private async onRingStart(client: Client, m: { requestId?: unknown }) {
    const RG = GAME_CONFIG.ring;
    const a = this.standingAt(client, 'ring');
    const requestId = typeof m?.requestId === 'string' ? m.requestId.slice(0, 64) : '';
    if (!requestId) return;
    if (!a) return client.send('ring.state', { requestId, ok: false, reason: 'not_here' });
    if (a.it.ring && Date.now() < a.it.ring.endsAt && a.it.ring.left > 0) return client.send('ring.state', { requestId, ok: false, reason: 'running' });
    const id = randomUUID();
    let r;
    try { r = await spendBoth(a.it.playerId, RG.coins, RG.energy, 'ring_toss', id, `ring:${a.it.playerId}:${requestId}`); } catch { return client.send('ring.state', { requestId, ok: false, reason: 'db_unavailable' }); }
    if (!r.ok) return client.send('ring.state', { requestId, ok: false, reason: 'insufficient', wallet: r.wallet });
    client.send(MSG.S_WALLET, r.wallet);
    if (r.replay) return;
    a.it.ring = { id, left: RG.rings, claimed: new Set(), endsAt: Date.now() + RG.sessionMs, lastThrow: 0, won: 0, seen: new Set() };
    client.send('ring.state', { requestId, ok: true, sessionId: id, left: RG.rings, endsAt: a.it.ring.endsAt, won: 0, claimed: [] });
  }

  /** 套圈判定：服务器用同一个公式算落点（没有随机），落点离柱子够近就算套中 */
  private async onRingThrow(client: Client, m: { seq?: unknown; a?: unknown; p?: unknown }) {
    const RG = GAME_CONFIG.ring;
    const st = this.standingAt(client, 'ring'); const g = st?.it.ring;
    if (!st || !g) return;
    const seq = typeof m?.seq === 'number' && Number.isInteger(m.seq) ? m.seq : 0;
    if (!seq || g.seen.has(seq)) return;
    const now = Date.now();
    if (g.left <= 0 || now > g.endsAt + 500) return client.send('ring.result', { seq, ok: false, reason: 'ended' });
    if (now - g.lastThrow < RG.throwGapMs) return client.send('ring.result', { seq, ok: false, reason: 'slow' });
    const ang = typeof m?.a === 'number' && Number.isFinite(m.a) ? m.a : 0, pow = typeof m?.p === 'number' && Number.isFinite(m.p) ? m.p : 0;
    g.seen.add(seq); g.lastThrow = now; g.left--;
    const land = ringLanding(ang, pow);
    let hit = -1;
    RING.pegs.forEach((pg, i) => { if (hit < 0 && Math.hypot(land.x - pg.x, land.z - pg.z) < RING.ringR - RING.pegR) hit = i; });
    let coins = 0;
    if (hit >= 0 && !g.claimed.has(hit)) {
      g.claimed.add(hit);
      try { const r = await credit(st.it.playerId, 'coins', RING.pegs[hit].coins, 'ring_prize', g.id, `ringprize:${g.id}:${hit}`); coins = r.applied; g.won += coins; client.send(MSG.S_WALLET, r.wallet); } catch { /* 记账失败：不报中奖金额 */ }
    }
    this.broadcast('ring', { sid: client.sessionId, seq, a: ang, p: pow, x: land.x, z: land.z, hit });
    client.send('ring.result', { seq, ok: true, hit, coins, left: g.left, won: g.won, claimed: [...g.claimed] });
    if (g.left <= 0) client.send('ring.state', { ok: true, sessionId: g.id, left: 0, endsAt: g.endsAt, won: g.won, done: true, claimed: [...g.claimed] });
  }

  /** 拍照：同一个拍照点上的人一起拍（同一时间点各自截取真实 3D 画面） */
  private onPhoto(client: Client) {
    const a = this.standingAt(client, 'photo'); if (!a) return;
    const now = Date.now(); if (now - a.it.lastPhoto < GAME_CONFIG.photo.gapMs) return;
    const sids: string[] = [];
    for (const s of SEATS) if (s.kind === 'photo') { const seat = this.state.seats[s.id]; if (seat?.by && seat.st === SEAT_STATE.OCCUPIED) sids.push(seat.by); }
    for (const sid of sids) { const it = this.internal.get(sid); if (it) it.lastPhoto = now; }
    this.broadcast('photo', { captureId: randomUUID(), at: now + GAME_CONFIG.photo.countdownMs, sids });
  }

  // ───────────────────── 打小人排队 ─────────────────────

  private villainQueuePush() {
    this.state.vq = this.vQueue.length;
    this.vQueue.forEach((sid, i) => this.clients.find((c) => c.sessionId === sid)?.send('villain.queue', { pos: i + 1, total: this.vQueue.length }));
  }
  private onVillainQueue(client: Client) {
    const p = this.state.players.get(client.sessionId); if (!p || p.st !== PSTATE.MOVING || p.seat >= 0) return;
    if (this.vQueue.includes(client.sessionId)) return this.villainQueuePush();
    this.vQueue.push(client.sessionId);
    // 有空位又没留给别人：马上轮到
    for (const s of SEATS) if (s.kind === 'villain' && this.state.seats[s.id].st === SEAT_STATE.FREE && !this.state.seats[s.id].hold) { this.offerVillainSeat(s.id); break; }
    this.villainQueuePush();
  }
  private leaveVillainQueue(sid: string) {
    const i = this.vQueue.indexOf(sid); if (i < 0) return;
    this.vQueue.splice(i, 1); this.villainQueuePush();
  }
  /** 空出来的砖台：留给排第一的人 20 秒 */
  private offerVillainSeat(seatId: number) {
    const seat = this.state.seats[seatId]; if (!seat || seat.st !== SEAT_STATE.FREE || seat.hold) return;
    while (this.vQueue.length) {
      const sid = this.vQueue.shift()!; const p = this.state.players.get(sid);
      if (!p || p.st !== PSTATE.MOVING || p.seat >= 0) continue;
      seat.hold = sid; this.vHoldUntil.set(seatId, Date.now() + 20_000);
      this.clients.find((c) => c.sessionId === sid)?.send('villain.turn', { seatId, holdMs: 20_000 });
      break;
    }
    this.villainQueuePush();
  }

  // ───────────────────── MAMAK：Aneh 送餐 ─────────────────────

  private sendTo(it: Internal, type: string, msg: unknown) {
    const k = this.keyOf(it); const c = k ? this.clients.find((x) => x.sessionId === k) : undefined;
    c?.send(type, msg);
  }
  private staffAhead(seatId: number) {
    const i = this.staffQueue.findIndex((t) => t.seatId === seatId);
    return (this.staff.task && this.staff.task.seatId !== seatId ? 1 : 0) + (i < 0 ? this.staffQueue.length : i);
  }
  private enqueueVisit(seatId: number, sid: string) {
    if (this.staff.task?.seatId === seatId || this.staffQueue.some((t) => t.seatId === seatId)) return;
    this.staffQueue.push({ kind: 'visit', seatId });
    this.clients.find((c) => c.sessionId === sid)?.send('mamak.status', { phase: 'coming', ahead: this.staffAhead(seatId) });
  }
  private onMamakCall(client: Client) {
    const it = this.internal.get(client.sessionId); const p = this.state.players.get(client.sessionId);
    if (!it || !p || p.seat < 0 || SEATS[p.seat]?.kind !== 'mamak' || p.st !== PSTATE.SEATED_IDLE || it.order) return;
    this.enqueueVisit(p.seat, client.sessionId);
  }
  private onMamakDecline(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (!p || p.seat < 0) return;
    if (this.staff.task?.kind === 'visit' && this.staff.task.seatId === p.seat) this.staffDone();
    this.staffQueue = this.staffQueue.filter((t) => !(t.kind === 'visit' && t.seatId === p.seat));
  }

  private async onMamakOrder(client: Client, m: { item?: unknown; requestId?: unknown }) {
    const it = this.internal.get(client.sessionId); const p = this.state.players.get(client.sessionId);
    if (!it || !p) return;
    const requestId = typeof m?.requestId === 'string' ? m.requestId.slice(0, 64) : '';
    const item = MK.menu.find((x) => x.id === m?.item);
    const err = (reason: string, extra: Record<string, unknown> = {}) => client.send('mamak.order', { ok: false, requestId, reason, ...extra });
    if (!requestId || !item) return err('bad_request');
    if (it.order && it.order.requestId === requestId) return client.send('mamak.order', { ok: true, requestId, orderId: it.order.id, item: it.order.item.id, status: it.order.status });
    if (p.seat < 0 || SEATS[p.seat]?.kind !== 'mamak' || p.st !== PSTATE.SEATED_IDLE) return err('not_seated');
    if (it.order || (it.orderBusy && it.orderBusy !== requestId)) return err('one_open');
    const seatId = p.seat;
    const orderId = randomUUID();
    let r;
    const mine = !it.orderBusy; it.orderBusy = requestId;
    try { r = await placeMamakOrder(it.playerId, orderId, requestId, item); } catch { return err('db_unavailable'); } finally { if (mine) it.orderBusy = null; }
    if (!r.ok) return err('insufficient', { wallet: r.wallet });
    client.send(MSG.S_WALLET, r.wallet);
    // 同一个 requestId 重复点：数据库返回原来那张单 → 只回复，不再建第二张、不再派送
    const cur = it.order as MamakOrder | null; // 等数据库期间可能已经建好（同一次点击的第一条）
    if (r.replay) return client.send('mamak.order', { ok: true, requestId, orderId: r.orderId, item: item.id, status: cur?.id === r.orderId ? cur.status : 'closed' });
    // 扣款期间离座/断线：立刻退款
    if (p.seat !== seatId || p.st !== PSTATE.SEATED_IDLE || !this.internal.has(this.keyOf(it) ?? '')) {
      void refund(it.playerId, `mamak:${r.orderId}`, 'mamak_cancel').then((x) => this.sendTo(it, MSG.S_WALLET, x.wallet)).catch(() => {});
      void setOrderStatus(r.orderId, 'cancelled');
      return err('not_seated');
    }
    const order: MamakOrder = { id: r.orderId, requestId, it, seatId, item, status: 'ordered' };
    it.order = order;
    // 正在桌边问的就是这桌：直接回去做；不然排队
    if (this.staff.task?.kind === 'visit' && this.staff.task.seatId === seatId) { this.staff.task = null; this.staffQueue.unshift({ kind: 'deliver', seatId, order }); this.staff.phase = 'idle'; }
    else {
      const qi = this.staffQueue.findIndex((t) => t.kind === 'visit' && t.seatId === seatId);
      if (qi >= 0) this.staffQueue[qi] = { kind: 'deliver', seatId, order }; else this.staffQueue.push({ kind: 'deliver', seatId, order });
    }
    client.send('mamak.order', { ok: true, requestId, orderId: order.id, item: item.id, status: order.status, ahead: this.staffAhead(seatId) });
  }

  private onMamakEat(client: Client) {
    const it = this.internal.get(client.sessionId); const p = this.state.players.get(client.sessionId);
    const o = it?.order;
    if (!it || !p || !o || o.status !== 'delivered' || p.seat !== o.seatId) return;
    o.status = 'eating'; void setOrderStatus(o.id, 'eating');
    this.broadcast('act', { sid: client.sessionId, a: 'eat', item: o.item.id });
    client.send('mamak.status', { phase: 'eating', ms: MK.eatMs, item: o.item.id });
    o.eatTimer = setTimeout(() => {
      if (o.status !== 'eating') return; // 已被取消（离座）：只退款，不给精力
      o.status = 'done'; void setOrderStatus(o.id, 'done');
      if (o.it.order === o) o.it.order = null;
      const seat = this.state.seats[o.seatId]; if (seat) seat.food = '';
      void credit(o.it.playerId, 'energy', o.item.energy, 'mamak_eat', o.id, `mamak:${o.id}:energy`).then((x) => {
        this.sendTo(o.it, MSG.S_WALLET, x.wallet);
        this.sendTo(o.it, 'mamak.status', { phase: 'done', item: o.item.id, energy: x.applied });
      }).catch(() => {});
    }, MK.eatMs);
  }

  /** 吃完之前离开或断线：取消订单、拿走食物、全额退款一次（与“吃完得精力”互斥） */
  private cancelOrder(it: Internal, reason: string) {
    const o = it.order; if (!o) return;
    it.order = null;
    if (o.status === 'done' || o.status === 'cancelled') return;
    o.status = 'cancelled'; if (o.eatTimer) clearTimeout(o.eatTimer);
    void setOrderStatus(o.id, 'cancelled');
    const seat = this.state.seats[o.seatId]; if (seat) seat.food = '';
    this.staffQueue = this.staffQueue.filter((t) => t.order !== o);
    if (this.staff.task?.order === o) this.staffDone();
    void refund(it.playerId, `mamak:${o.id}`, 'mamak_cancel').then((x) => {
      this.sendTo(it, MSG.S_WALLET, x.wallet);
      if (x.ok && !x.replay) this.sendTo(it, 'mamak.status', { phase: 'refunded', item: o.item.id, coins: o.item.price, reason });
    }).catch(() => {});
  }

  private staffDone() {
    this.staff.task = null; this.staff.phase = 'return';
    this.state.aneh.carry = ''; this.state.aneh.act = 0; this.state.aneh.seat = -1;
    this.staff.path = this.route({ x: this.state.aneh.x, z: this.state.aneh.z }, COUNTER);
  }

  /** 走道路线：直线会碰到桌子/店面就绕通道 */
  private route(a: { x: number; z: number }, b: { x: number; z: number }) {
    const clear = (p: { x: number; z: number }, q: { x: number; z: number }) => {
      for (const t of MAMAK_TABLES) {
        const dx = q.x - p.x, dz = q.z - p.z, L2 = dx * dx + dz * dz || 1;
        const k = Math.max(0, Math.min(1, ((t.x - p.x) * dx + (t.z - p.z) * dz) / L2));
        if (Math.hypot(p.x + dx * k - t.x, p.z + dz * k - t.z) < 0.95) return false;
      }
      return true;
    };
    // 所有不碰桌子的走法里挑最短的
    const len = (pts: Array<{ x: number; z: number }>) => { let L = 0, p = a; for (const q of pts) { L += Math.hypot(q.x - p.x, q.z - p.z); p = q; } return L; };
    const cands: Array<Array<{ x: number; z: number }>> = [];
    if (clear(a, b)) cands.push([b]);
    for (const w of AISLES) if (clear(a, w) && clear(w, b)) cands.push([w, b]);
    if (!cands.length) for (const w of AISLES) for (const v of AISLES) if (w !== v && clear(a, w) && clear(w, v) && clear(v, b)) cands.push([w, v, b]);
    if (cands.length) return cands.sort((x, y) => len(x) - len(y))[0];
    return [AISLES[0], b];
  }

  private tickStaff(now: number) {
    const st = this.staff, A = this.state.aneh;
    const dt = TICK_MS / 1000;
    const walk = () => {
      const t = st.path[0]; if (!t) { A.speed = 0; return true; }
      const dx = t.x - A.x, dz = t.z - A.z, d = Math.hypot(dx, dz);
      const step = MK.staffSpeed * dt;
      if (d <= step) { A.x = t.x; A.z = t.z; st.path.shift(); } else { A.x += dx / d * step; A.z += dz / d * step; }
      A.yaw = Math.atan2(dx, dz); A.speed = MK.staffSpeed;
      if (!st.path.length) { A.speed = 0; return true; }
      return false;
    };
    const faceSeat = (seatId: number) => { const s = SEATS[seatId]; A.yaw = Math.atan2(s.seat.x - A.x, s.seat.z - A.z); };
    if (!st.task) {
      if (st.phase === 'return' && !this.staffQueue.length) { if (walk()) { st.phase = 'idle'; A.yaw = Math.PI / 2; } return; }
      const next = this.staffQueue.shift();
      if (!next) { A.speed = 0; return; }
      st.task = next; A.seat = next.seatId;
      if (next.kind === 'visit') { st.phase = 'walk'; st.path = this.route({ x: A.x, z: A.z }, SEATS[next.seatId].approach); }
      else { st.phase = 'cook'; st.path = this.route({ x: A.x, z: A.z }, COUNTER); st.until = 0; next.order!.status = 'cooking'; void setOrderStatus(next.order!.id, 'cooking'); this.sendTo(next.order!.it, 'mamak.status', { phase: 'cooking', item: next.order!.item.id }); }
      return;
    }
    const task = st.task;
    if (st.phase === 'walk') {
      if (!walk()) return;
      faceSeat(task.seatId);
      if (task.kind === 'visit') {
        st.phase = 'ask'; st.until = now + MK.askTimeoutMs; A.act = 1;
        const seat = this.state.seats[task.seatId];
        this.clients.find((c) => c.sessionId === seat?.by)?.send('mamak.status', { phase: 'ask' });
      } else { st.phase = 'place'; st.until = now + 600; A.act = 2; }
    } else if (st.phase === 'ask') {
      if (now > st.until) { const seat = this.state.seats[task.seatId]; this.clients.find((c) => c.sessionId === seat?.by)?.send('mamak.status', { phase: 'left' }); this.staffDone(); }
    } else if (st.phase === 'cook') {
      if (st.path.length) { walk(); return; }
      if (!st.until) { st.until = now + MK.cookMs; A.act = 3; A.yaw = -Math.PI / 2; A.speed = 0; return; }
      if (now < st.until) return;
      const o = task.order!;
      A.carry = o.item.id; A.act = 0; o.status = 'serving'; void setOrderStatus(o.id, 'serving');
      this.sendTo(o.it, 'mamak.status', { phase: 'serving', item: o.item.id });
      st.phase = 'walk'; st.path = this.route({ x: A.x, z: A.z }, SEATS[task.seatId].approach);
    } else if (st.phase === 'place') {
      if (now < st.until) return;
      const o = task.order!;
      const seat = this.state.seats[task.seatId];
      if (o.status === 'serving' && seat) { seat.food = o.item.id; o.status = 'delivered'; void setOrderStatus(o.id, 'delivered'); this.sendTo(o.it, 'mamak.status', { phase: 'delivered', item: o.item.id }); }
      this.staffDone();
    }
  }

  // ───────────────────── 求签 ─────────────────────

  private async onFortune(client: Client, m: { requestId?: unknown }) {
    const it = this.internal.get(client.sessionId); const p = this.state.players.get(client.sessionId);
    if (!it || !p) return;
    const FT = GAME_CONFIG.fortune;
    const requestId = typeof m?.requestId === 'string' ? m.requestId.slice(0, 64) : '';
    if (!requestId) return;
    const prev = it.fortunes.get(requestId);
    if (prev) return client.send('fortune.result', { requestId, ...prev, replay: true });
    if (p.seat < 0 || SEATS[p.seat]?.kind !== 'fortune' || p.st !== PSTATE.SEATED_IDLE) return client.send('fortune.result', { requestId, error: 'not_here' });
    const now = Date.now();
    if (now - it.lastShake < FT.cooldownMs) return client.send('fortune.result', { requestId, error: 'slow' });
    it.lastShake = now;
    let no = 1 + Math.floor(Math.random() * FORTUNES.length), lucky = false, coins = 0, again = false;
    try {
      const day = klDay(now);
      // 每天只能求一次：当天第一次原子写入（签号 + 是否天降好运）；之后再来只看今天那支签
      const ins = await pool.query(`INSERT INTO fortune_daily(player_id, day, fortune_no, lucky) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING lucky`,
        [it.playerId, day, no, Math.random() < FT.firstDailyLuckChance]);
      if (!ins.rowCount) {
        const old = await pool.query('SELECT fortune_no FROM fortune_daily WHERE player_id=$1 AND day=$2', [it.playerId, day]);
        no = old.rows[0].fortune_no; again = true;
      } else {
        this.broadcast('act', { sid: client.sessionId, a: 'shake' });
        if (ins.rows[0].lucky) {
          lucky = true;
          const r = await credit(it.playerId, 'coins', FT.luckCoins, 'fortune_luck', day, `fortune:${it.playerId}:${day}`);
          coins = r.applied; client.send(MSG.S_WALLET, r.wallet);
        }
      }
    } catch (e) { console.warn('[fortune]', (e as Error).message); client.send('fortune.result', { requestId, error: 'db_unavailable' }); return; }
    const res = { no, lucky, coins, again };
    it.fortunes.set(requestId, res); if (it.fortunes.size > 20) it.fortunes.delete(it.fortunes.keys().next().value!);
    setTimeout(() => this.sendTo(it, 'fortune.result', { requestId, ...res }), again ? 0 : Math.max(0, FT.shakeMs - (Date.now() - now)));
  }

  // ───────────────────── 天后宫：上香、香油钱 ─────────────────────

  private onIncense(client: Client) {
    const it = this.internal.get(client.sessionId); const p = this.state.players.get(client.sessionId);
    if (!it || !p || p.seat < 0 || SEATS[p.seat]?.kind !== 'pray' || p.st !== PSTATE.SEATED_IDLE) return;
    const now = Date.now();
    if (now - it.lastIncense < PR.incenseCooldownMs) return;
    it.lastIncense = now;
    this.broadcast('act', { sid: client.sessionId, a: 'bow' });
    setTimeout(() => {
      this.incense.push(Date.now() + PR.incenseMs); this.incense.sort((a, b) => a - b);
      while (this.incense.length > PR.maxIncense) this.incense.shift();
      this.state.incense = this.incense.length;
    }, 3600);
  }

  private async onDonate(client: Client, m: { amount?: unknown; requestId?: unknown }) {
    const it = this.internal.get(client.sessionId); const p = this.state.players.get(client.sessionId);
    if (!it || !p) return;
    const requestId = typeof m?.requestId === 'string' ? m.requestId.slice(0, 64) : '';
    const amount = typeof m?.amount === 'number' && (PR.donateAmounts as readonly number[]).includes(m.amount) ? m.amount : 0;
    if (!requestId || !amount) return client.send('pray.donated', { ok: false, reason: 'bad_request' });
    if (p.seat < 0 || SEATS[p.seat]?.kind !== 'pray') return client.send('pray.donated', { ok: false, reason: 'not_here' });
    try {
      const r = await spend(it.playerId, 'coins', amount, 'temple_donation', requestId, `donate:${it.playerId}:${requestId}`);
      if (!r.ok) return client.send('pray.donated', { ok: false, reason: r.error, wallet: r.wallet });
      const day = klDay(Date.now());
      const sum = await pool.query(`SELECT COALESCE(-sum(delta),0)::int AS n FROM ledger WHERE player_id=$1 AND reason='temple_donation' AND created_at >= ($2::date AT TIME ZONE 'Asia/Kuala_Lumpur')`, [it.playerId, day]).catch(() => null);
      client.send(MSG.S_WALLET, r.wallet);
      client.send('pray.donated', { ok: true, amount, replay: r.replay, today: sum?.rows[0]?.n ?? amount });
      if (!r.replay) this.broadcast('act', { sid: client.sessionId, a: 'coin' });
    } catch { client.send('pray.donated', { ok: false, reason: 'db_unavailable' }); }
  }

  private async refreshAvatar(client: Client) {
    const it = this.internal.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (!it || !p) return;
    const r = await pool.query('SELECT p.nickname, a.config_json FROM players p LEFT JOIN avatars a ON a.player_id=p.id WHERE p.id=$1', [it.playerId]);
    if (!r.rowCount) return;
    const v = r.rows[0].config_json ? validateAvatar(r.rows[0].config_json) : null;
    if (v && v.ok) p.av = avatarToIndices(v.value).join(',');
    if (r.rows[0].nickname) p.name = r.rows[0].nickname;
  }
}
