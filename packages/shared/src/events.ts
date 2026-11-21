/**
 * 街上的活动（按服务器时间排程，同房的人看到同一个进度；刷新不会重来）。
 * 第一批：每小时整点「舞狮采青 · 接旺桔」，5 分钟。
 * 时间用马来西亚时间的“整点”——马来西亚和 UTC 差整 8 小时，所以分钟数一样。
 */
export const LION = {
  durationS: 300,
  /** 0–15 秒：牌坊敲锣鼓；15–150 秒：沿街走（在 Mamak 前停下舞一段）；150–215：天后宫前采青；215 抛桔子；300 结束 */
  gongS: 15, walkEndS: 150, oranges: 215,
  /** 路线：牌坊 → 主街 → Mamak 前 → 天后宫前 */
  path: [
    { x: 0, z: -3.0 }, { x: 0.3, z: 6.0 }, { x: 0.6, z: 13.5 }, { x: 0.4, z: 17.8 }, { x: 0.4, z: 20.0 },
  ],
  /** 在路线第几段停下来舞（Mamak 前） */
  pauseAt: { seg: 3, fromS: 119, toS: 139 },
  end: { x: 0.4, z: 20.0, yaw: 0 },
  /** 抛桔子：落在狮子前方 3 米左右的半圆里 */
  orangeCount: 8, orangeCatchR: 0.7, orangeLifeS: 75,
} as const;

/** 现在这一场舞狮进行到第几秒（不在进行中返回 null）。offsetMs：测试用的时钟偏移 */
export function lionElapsed(nowMs: number, offsetMs = 0): number | null {
  const t = ((nowMs + offsetMs) / 1000) % 3600;
  return t < LION.durationS ? t : null;
}
/** 下一场开始还有几秒 */
export function lionNextIn(nowMs: number, offsetMs = 0): number {
  const t = ((nowMs + offsetMs) / 1000) % 3600;
  return t < LION.durationS ? 0 : 3600 - t;
}

/** 舞狮在第 t 秒的位置、朝向、动作 */
export function lionPose(t: number): { x: number; z: number; yaw: number; act: 'gong' | 'walk' | 'dance' | 'rear' | 'bow' } {
  const P = LION.path;
  if (t < LION.gongS) return { x: P[0].x, z: P[0].z, yaw: 0, act: 'gong' };
  if (t >= LION.walkEndS) {
    const act = t < LION.oranges - 10 ? 'dance' : t < LION.oranges + 5 ? 'rear' : 'bow';
    return { x: LION.end.x, z: LION.end.z, yaw: LION.end.yaw, act };
  }
  // 沿路线匀速走（扣掉在 Mamak 前停的时间）
  const pause = LION.pauseAt;
  const walkTotal = LION.walkEndS - LION.gongS - (pause.toS - pause.fromS);
  let w = t - LION.gongS;
  let act: 'walk' | 'dance' = 'walk';
  if (t >= pause.fromS && t < pause.toS) { w = pause.fromS - LION.gongS; act = 'dance'; }
  else if (t >= pause.toS) w -= pause.toS - pause.fromS;
  const lens = P.slice(1).map((p, i) => Math.hypot(p.x - P[i].x, p.z - P[i].z));
  const total = lens.reduce((a, b) => a + b, 0);
  let d = Math.min(1, w / walkTotal) * total;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const k = Math.min(1, d / lens[i]); const a = P[i], b = P[i + 1];
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, yaw: Math.atan2(b.x - a.x, b.z - a.z), act };
    }
    d -= lens[i];
  }
  return { x: LION.end.x, z: LION.end.z, yaw: 0, act };
}

// ───────── 每小时 4 场（马来西亚时间；分钟数和 UTC 一样） ─────────
export type EventId = 'lion' | 'guess' | 'puppet' | 'lantern';
export const EVENTS: Array<{ id: EventId; startMin: number; durS: number; name: string; place: string; x: number; z: number }> = [
  { id: 'lion', startMin: 0, durS: 300, name: '舞狮采青', place: '牌坊 → 天后宫', x: 0, z: -2 },
  { id: 'guess', startMin: 15, durS: 180, name: 'Mamak 开估', place: 'Mamak 前', x: -1.3, z: 23.2 },
  { id: 'puppet', startMin: 30, durS: 300, name: '庙口布袋戏', place: '姻缘树后的戏台', x: 6.9, z: 17.6 },
  { id: 'lantern', startMin: 45, durS: 240, name: '百灯过桥', place: '灯笼巷 → 石桥', x: 9.5, z: -4.5 },
];
/** 现在正在进行的活动（第几秒）；没有就 null */
export function currentEvent(nowMs: number, offMs = 0): { id: EventId; t: number } | null {
  const s = ((nowMs + offMs) / 1000) % 3600;
  for (const e of EVENTS) { const t = s - e.startMin * 60; if (t >= 0 && t < e.durS) return { id: e.id, t }; }
  return null;
}
/** 下一场（还没开始的）：几秒后开始 */
export function nextEvent(nowMs: number, offMs = 0): { id: EventId; inS: number } {
  const s = ((nowMs + offMs) / 1000) % 3600;
  let best: { id: EventId; inS: number } | null = null;
  for (const e of EVENTS) { let d = e.startMin * 60 - s; if (d <= 0) d += 3600; if (!best || d < best.inS) best = { id: e.id, inS: d }; }
  return best!;
}
/** 这一小时的编号（同一场活动的“唯一 key”，跨房间相同） */
export const hourKey = (nowMs: number, offMs = 0) => Math.floor((nowMs + offMs) / 3_600_000);
/** 按小时决定的伪随机（同一小时、所有房间都一样，方便断线重连后看到同一题） */
export function seeded(seed: number) { let x = (seed * 2654435761) >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

// ───────── :15 Mamak 开估 ─────────
export type GuessKind = 'count' | 'tray' | 'cups';
export const GUESS = {
  table: { x: -2.35, z: 22.75 }, host: { x: -3.15, z: 22.75 },
  introS: 10, showS: 30, answerS: 75, revealS: 95, // 0–10 档主喊人；10–30 给大家看；30–75 作答；75–95 揭晓；95–180 看结果
};
/** 茶盘题的五样东西 */
export const TRAY_ITEMS = ['tehtarik', 'milo', 'roti', 'nasilemak', 'kopi'] as const;
export const TRAY_NAMES: Record<string, string> = { tehtarik: 'Teh Tarik', milo: 'Milo Ais', roti: 'Roti Canai', nasilemak: 'Nasi Lemak', kopi: 'Kopi O' };
export function guessKindForHour(hour: number): GuessKind { return (['count', 'tray', 'cups'] as const)[((hour % 3) + 3) % 3]; }

// ───────── :30 庙口布袋戏 ─────────
export const PUPPET = { stage: { x: 8.35, z: 17.6 }, openS: 12, voteS: 125, voteEndS: 150, endS: 285 };

// ───────── :45 百灯过桥 ─────────
export const LANTERN_WALK = {
  /** 灯笼巷口（借灯处）、石桥 */
  lane: { x: 9.5, z: -4.5 }, bridge: { x0: 18.6, x1: 22.4, z: -2.0 },
  gatherS: 40, walkEndS: 190, photoS: 210,
};
/** 石桥上的 10 盏桥灯（两边各 5 盏） */
export const BRIDGE_LAMPS: Array<{ x: number; z: number }> = Array.from({ length: 10 }, (_, i) => ({ x: 18.8 + (i % 5) * 0.85, z: i < 5 ? -2.72 : -1.28 }));
