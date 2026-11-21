import { GAME_CONFIG } from './config.ts';

/** 控制字符、零宽字符、方向控制字符 */
const INVISIBLE = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u2028-\\u202E\\u2060-\\u206F\\uFEFF]', 'g');

function clean(raw: string): string {
  return raw.normalize('NFKC').replace(INVISIBLE, '').replace(/\s+/gu, ' ').trim();
}

/**
 * 小人名字/代号：trim、NFKC、折叠空白；1–20 个 Unicode 字符（按码点）。
 * displayName 保留显示值；key 用于合并：NFKC + toLowerCase（固定规则）+ 去掉空格。
 */
export function normalizeTargetName(raw: unknown): { ok: true; displayName: string; key: string } | { ok: false; error: 'empty' | 'too_long' | 'invalid' } {
  if (typeof raw !== 'string' || raw.length > 400) return { ok: false, error: typeof raw === 'string' ? 'too_long' : 'invalid' };
  const s = clean(raw);
  const n = Array.from(s).length;
  if (n === 0) return { ok: false, error: 'empty' };
  if (n > GAME_CONFIG.villain.nameMaxChars) return { ok: false, error: 'too_long' };
  if (/[<>]/.test(s)) return { ok: false, error: 'invalid' };
  return { ok: true, displayName: s, key: s.toLowerCase().replace(/ /g, '') };
}

export function normalizeNickname(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || raw.length > 200) return { ok: false, error: 'invalid' };
  const s = clean(raw);
  const n = Array.from(s).length;
  if (n < GAME_CONFIG.nickname.minChars) return { ok: false, error: 'empty' };
  if (n > GAME_CONFIG.nickname.maxChars) return { ok: false, error: 'too_long' };
  if (/[<>]/.test(s)) return { ok: false, error: 'invalid' };
  return { ok: true, value: s };
}
