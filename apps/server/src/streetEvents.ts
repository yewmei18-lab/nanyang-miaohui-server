import type { Client } from '@colyseus/core';
import { GUESS, TRAY_ITEMS, PUPPET, LANTERN_WALK, BRIDGE_LAMPS, currentEvent, hourKey, seeded, guessKindForHour, playForHour, PUPPET_PLAYS, PSTATE, type GuessKind } from '@nanyang/shared';
import { pool } from './db.ts';

/**
 * :15 Mamak 开估、:30 庙口布袋戏、:45 百灯过桥（:00 舞狮在 PlazaRoom 里）。
 * 都按服务器时间推进；公开的进度放在 state.ev（JSON），同房的人看到同一个进度，刷新不会重来。
 * 奖励（开估答对的饮料券）每个账号每场只发一次（数据库唯一记录，换房也一样）。
 */
export interface EventHost {
  state: { ev: string; lamps: number; evOff: number; players: Map<string, { st: number; x: number; z: number; lamp: boolean; name: string }> };
  clients: Client[];
  playerIdOf(sid: string): string | undefined;
  broadcast(type: string, msg: unknown): void;
  stamp?(sid: string, stamp: string): void;
}

interface GuessRound { hour: number; kind: GuessKind; n: number; removed: number; items: string[]; start: number; swaps: Array<[number, number]>; answer: number; answers: Map<string, number>; revealed: boolean }
interface PuppetRound { hour: number; play: number; votes: Map<string, number>; choice: number }

export class StreetEvents {
  private guess: GuessRound | null = null;
  private puppet: PuppetRound | null = null;
  private lampsLitAt = 0;
  private lastPublic = '';
  constructor(private room: EventHost) {}

  tick(now: number) {
    const off = this.room.state.evOff; const ev = currentEvent(now, off); const hour = hourKey(now, off);
    let pub: Record<string, unknown> | null = null;
    if (ev?.id === 'guess') pub = this.tickGuess(ev.t, hour);
    else this.guess = this.guess && this.guess.hour === hour ? this.guess : null;
    if (ev?.id === 'puppet') pub = this.tickPuppet(ev.t, hour);
    if (ev?.id === 'lantern') pub = this.tickLantern(ev.t, now);
    else for (const p of this.room.state.players.values()) if (p.lamp) p.lamp = false;
    this.tickBridgeLamps(now, ev?.id === 'lantern');
    const s = pub ? JSON.stringify(pub) : '';
    if (s !== this.lastPublic) { this.lastPublic = s; this.room.state.ev = s; }
  }

  // ── :15 开估 ──
  private tickGuess(t: number, hour: number) {
    if (!this.guess || this.guess.hour !== hour) {
      const r = seeded(hour * 7 + 3); const kind = guessKindForHour(hour);
      const items = [...TRAY_ITEMS].sort(() => r() - 0.5);
      const g: GuessRound = { hour, kind, items, n: 4 + Math.floor(r() * 9), removed: Math.floor(r() * 5), start: Math.floor(r() * 3), swaps: [], answer: 0, answers: new Map(), revealed: false };
      let pos = g.start;
      for (let i = 0; i < 7; i++) { const a = Math.floor(r() * 3); let b = Math.floor(r() * 2); if (b >= a) b++; g.swaps.push([a, b]); if (pos === a) pos = b; else if (pos === b) pos = a; }
      g.answer = kind === 'count' ? g.n : kind === 'tray' ? g.removed : pos;
      this.guess = g;
    }
    const g = this.guess;
    const phase = t < GUESS.introS ? 'intro' : t < GUESS.showS ? 'show' : t < GUESS.answerS ? 'answer' : 'reveal';
    if (phase === 'reveal' && !g.revealed) { g.revealed = true; void this.rewardGuess(g); }
    const pub: Record<string, unknown> = { id: 'guess', kind: g.kind, phase, answered: g.answers.size };
    // 看得到的东西才公开：桔仔在“给大家看”时公开；杯子的换位过程公开；答案只在揭晓后公开
    if (g.kind === 'count' && phase !== 'intro') pub.n = phase === 'show' || phase === 'reveal' ? g.n : -1;
    if (g.kind === 'cups') { pub.start = g.start; pub.swaps = g.swaps; }
    if (g.kind === 'tray') { pub.items = g.items; if (phase === 'answer' || phase === 'reveal') pub.remain = g.items.filter((_, i) => i !== g.removed); }
    if (phase === 'reveal') { pub.answer = g.answer; pub.right = [...g.answers.values()].filter((v) => v === g.answer).length; }
    return pub;
  }
  answerGuess(sid: string, v: unknown) {
    const off = this.room.state.evOff; const ev = currentEvent(Date.now(), off);
    const g = this.guess; const pid = this.room.playerIdOf(sid);
    if (!g || !pid || ev?.id !== 'guess' || ev.t < GUESS.showS || ev.t >= GUESS.answerS) return false;
    const max = g.kind === 'count' ? 20 : g.kind === 'tray' ? 4 : 2;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max) return false;
    g.answers.set(pid, v); return true;
  }
  private async rewardGuess(g: GuessRound) {
    for (const [pid, v] of g.answers) {
      const ok = v === g.answer; let voucher = false;
      if (ok) {
        // 每个账号每场只领一次（换房也一样）
        const r = await pool.query(`INSERT INTO player_items(player_id, item, qty) VALUES ($1,$2,1) ON CONFLICT DO NOTHING RETURNING qty`, [pid, `guesswin:${g.hour}`]).catch(() => null);
        if (r?.rowCount) { voucher = true; await pool.query(`INSERT INTO player_items(player_id, item, qty) VALUES ($1,'voucher',1) ON CONFLICT (player_id,item) DO UPDATE SET qty=player_items.qty+1, updated_at=now()`, [pid]).catch(() => {}); }
      }
      for (const c of this.room.clients) if (this.room.playerIdOf(c.sessionId) === pid) c.send('guess.result', { correct: ok, answer: g.answer, voucher });
    }
  }

  // ── :30 布袋戏 ──
  private tickPuppet(t: number, hour: number) {
    if (!this.puppet || this.puppet.hour !== hour) this.puppet = { hour, play: PUPPET_PLAYS.indexOf(playForHour(hour)), votes: new Map(), choice: -1 };
    const p = this.puppet;
    if (t >= PUPPET.voteEndS && p.choice < 0) {
      const a = [...p.votes.values()].filter((v) => v === 0).length, b = p.votes.size - a;
      p.choice = a > b ? 0 : b > a ? 1 : (seeded(hour * 13)() < 0.5 ? 0 : 1); // 平票：戏班师傅抽签
      this.room.broadcast('puppet.choice', { choice: p.choice, votes: [a, b], tie: a === b });
    }
    const a = [...p.votes.values()].filter((v) => v === 0).length;
    return { id: 'puppet', play: p.play, votes: [a, p.votes.size - a], choice: p.choice };
  }
  votePuppet(sid: string, c: unknown) {
    const ev = currentEvent(Date.now(), this.room.state.evOff); const pid = this.room.playerIdOf(sid);
    if (!this.puppet || !pid || ev?.id !== 'puppet' || ev.t < PUPPET.voteS || ev.t >= PUPPET.voteEndS || (c !== 0 && c !== 1)) return false;
    this.puppet.votes.set(pid, c); return true;
  }

  // ── :45 百灯过桥 ──
  private tickLantern(t: number, _now: number) {
    const phase = t < LANTERN_WALK.gatherS ? 'gather' : t < LANTERN_WALK.walkEndS ? 'walk' : 'photo';
    const lit = BRIDGE_LAMPS.filter((_, i) => this.room.state.lamps & (1 << i)).length;
    return { id: 'lantern', phase, lit, carriers: [...this.room.state.players.values()].filter((p) => p.lamp).length };
  }
  borrowLamp(sid: string) {
    const ev = currentEvent(Date.now(), this.room.state.evOff); const p = this.room.state.players.get(sid);
    if (!p || ev?.id !== 'lantern') return false;
    p.lamp = true; return true;
  }
  /** 桥灯：走到桥灯旁边就点亮（平时也可以一盏一盏点，10 分钟没人点就慢慢熄掉；活动结束全部熄掉重来） */
  private wasLantern = false;
  private tickBridgeLamps(now: number, lanternEvent: boolean) {
    if (this.wasLantern && !lanternEvent) { this.room.state.lamps = 0; }
    this.wasLantern = lanternEvent;
    for (const [sid, p] of this.room.state.players) {
      if (p.st !== PSTATE.MOVING) continue;
      BRIDGE_LAMPS.forEach((l, i) => {
        if (!(this.room.state.lamps & (1 << i)) && Math.hypot(p.x - l.x, p.z - l.z) < 0.9) {
          this.room.state.lamps |= 1 << i; this.lampsLitAt = now; this.room.stamp?.(sid, 'bridge');
          if (this.room.state.lamps === (1 << BRIDGE_LAMPS.length) - 1) this.room.broadcast('bridge.full', { during: lanternEvent });
        }
      });
    }
    if (!lanternEvent && this.room.state.lamps && now - this.lampsLitAt > 600_000) this.room.state.lamps = 0;
  }
}
