import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { pool } from './db.ts';
import { ensureWallet } from './wallet.ts';
import { verifySession } from './account.ts';

/**
 * 游客身份：服务器签发 playerId + 随机密钥；数据库只存密钥哈希。
 * 注意：游客身份可被清空浏览器重建 → 不能当作经济防刷（06/07）。公开上线前需接入正式账号。
 */
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function createGuest(): Promise<{ playerId: string; token: string }> {
  const playerId = randomUUID();
  const secret = randomBytes(24).toString('base64url');
  await pool.query('INSERT INTO players(id, guest_credential_hash) VALUES ($1,$2)', [playerId, hash(secret)]);
  await ensureWallet(playerId);
  return { playerId, token: `${playerId}.${secret}` };
}

export async function verifyToken(token: unknown): Promise<{ playerId: string; nickname: string | null } | null> {
  if (typeof token !== 'string' || token.length > 200) return null;
  if (token.startsWith('s.')) { // 正式账号登录的会话
    const pid = await verifySession(token); if (!pid) return null;
    const r = await pool.query('SELECT nickname FROM players WHERE id=$1', [pid]);
    return r.rowCount ? { playerId: pid, nickname: r.rows[0].nickname } : null;
  }
  const [playerId, secret] = token.split('.');
  if (!playerId || !secret || !UUID_RE.test(playerId)) return null;
  const r = await pool.query('SELECT guest_credential_hash, nickname FROM players WHERE id=$1', [playerId]);
  if (!r.rowCount) return null;
  const a = Buffer.from(r.rows[0].guest_credential_hash, 'hex');
  const b = Buffer.from(hash(secret), 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { playerId, nickname: r.rows[0].nickname };
}

export function bearer(h: string | undefined): string | undefined {
  if (!h) return undefined;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1];
}
