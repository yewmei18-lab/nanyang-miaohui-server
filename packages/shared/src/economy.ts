import { GAME_CONFIG } from './config.ts';

/**
 * 精力自然恢复（07）：不足一格保留余秒；满值时重置基准，不把满值期间时间银行化。
 */
export function applyEnergyRegen(energy: number, updatedAtMs: number, nowMs: number, cfg = GAME_CONFIG.wallet): { energy: number; updatedAtMs: number } {
  const max = cfg.maxEnergy;
  if (nowMs <= updatedAtMs) return { energy: Math.min(energy, max), updatedAtMs };
  if (energy >= max) return { energy: max, updatedAtMs: nowMs };
  const n = Math.floor((nowMs - updatedAtMs) / cfg.energyRegenMs);
  if (n <= 0) return { energy, updatedAtMs };
  const next = Math.min(max, energy + n);
  if (next >= max) return { energy: max, updatedAtMs: nowMs };
  return { energy: next, updatedAtMs: updatedAtMs + n * cfg.energyRegenMs };
}

const klFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' });
/** 每日边界 Asia/Kuala_Lumpur，返回 YYYY-MM-DD */
export function klDay(ms: number): string {
  return klFmt.format(new Date(ms));
}
