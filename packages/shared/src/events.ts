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
