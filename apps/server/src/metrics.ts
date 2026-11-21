/** 简单进程内计数（监控：断线、拒绝击打、结算失败等）；日志不记录真实姓名/敏感资料 */
export const metrics = {
  startedAt: Date.now(),
  joins: 0,
  drops: 0,
  seatGrants: 0,
  hitsAccepted: 0,
  hitsRejected: 0,
  tickSamples: [] as number[],
  recordTick(ms: number) { this.tickSamples.push(ms); if (this.tickSamples.length > 3000) this.tickSamples.shift(); },
  tickStats() {
    const s = [...this.tickSamples].sort((a, b) => a - b);
    const q = (p: number) => s.length ? Number(s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(3)) : 0;
    return { n: s.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1) };
  },
};
