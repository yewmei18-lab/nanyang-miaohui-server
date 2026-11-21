import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { pool, tx } from './db.ts';

/**
 * 正式账号：username＋密码＋恢复码。
 * - 密码、恢复码都只存 scrypt 哈希（带随机盐），不存明文。
 * - 恢复码用一次就作废，重设密码时发一组新的。
 * - 连续输错：同一个 username 或同一个 IP 10 分钟内错 8 次就先锁 10 分钟。
 */
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  const h = scryptSync(secret, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
}
export function checkSecret(secret: string, stored: string | null): boolean {
  if (!stored) return false;
  const [kind, saltHex, hHex] = stored.split('$');
  if (kind !== 'scrypt' || !saltHex || !hHex) return false;
  const h = scryptSync(secret, Buffer.from(saltHex, 'hex'), 32, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(hHex, 'hex');
  return want.length === h.length && timingSafeEqual(want, h);
}
/** 恢复码：XXXX-XXXX-XXXX-XXXX（不含容易看错的 0/O/1/I） */
export function newRecoveryCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const b = randomBytes(16);
  return Array.from(b, (x) => A[x % A.length]).join('').replace(/(.{4})(?=.)/g, '$1-');
}
const normCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');

export async function tooManyAttempts(keys: string[]): Promise<boolean> {
  const r = await pool.query(`SELECT count(*)::int AS n FROM auth_attempts WHERE key = ANY($1) AND NOT ok AND at > now() - interval '10 minutes'`, [keys]);
  return r.rows[0].n >= 8;
}
export async function recordAttempt(keys: string[], ok: boolean) {
  for (const k of keys) await pool.query('INSERT INTO auth_attempts(key, ok) VALUES ($1,$2)', [k, ok]).catch(() => {});
}

/** 发一个登录会话 token（s.<id>.<secret>），数据库只存 secret 的哈希 */
export async function newSession(playerId: string): Promise<string> {
  const id = randomUUID(); const secret = randomBytes(24).toString('base64url');
  await pool.query('INSERT INTO sessions(id, player_id, token_hash) VALUES ($1,$2,$3)', [id, playerId, sha(secret)]);
  return `s.${id}.${secret}`;
}
export async function verifySession(token: string): Promise<string | null> {
  const [, id, secret] = token.split('.');
  if (!id || !secret || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const r = await pool.query('SELECT player_id, token_hash FROM sessions WHERE id=$1 AND revoked_at IS NULL', [id]);
  if (!r.rowCount) return null;
  const a = Buffer.from(r.rows[0].token_hash, 'hex'), b = Buffer.from(sha(secret), 'hex');
  return a.length === b.length && timingSafeEqual(a, b) ? r.rows[0].player_id : null;
}

export type RegisterResult = { ok: true; recoveryCode: string; token: string; already?: boolean } | { ok: false; error: string };
/**
 * 注册：把当前这个游客身份升级成正式账号（金币、造型、道具原地保留，只迁移一次）。
 * 同一个游客用同一个 username＋密码重试（例如提交时断网）→ 视为成功，但不再发新的恢复码。
 */
export async function register(playerId: string, usernameRaw: string, password: string): Promise<RegisterResult> {
  const username = usernameRaw.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) return { ok: false, error: 'username_invalid' };
  if (password.length < 6 || password.length > 72) return { ok: false, error: 'password_invalid' };
  // 事务里只改玩家这一行；登录会话在事务提交之后才建（会话表有外键指向玩家，放在事务里会自己等自己）
  const r = await tx(async (c) => {
    const me = await c.query('SELECT username, password_hash FROM players WHERE id=$1 FOR UPDATE', [playerId]);
    if (!me.rowCount) return { ok: false as const, error: 'no_player' };
    if (me.rows[0].username) {
      if (me.rows[0].username === username && checkSecret(password, me.rows[0].password_hash)) return { ok: true as const, recoveryCode: '', already: true };
      return { ok: false as const, error: 'already_registered' };
    }
    const taken = await c.query('SELECT 1 FROM players WHERE username=$1', [username]);
    if (taken.rowCount) return { ok: false as const, error: 'username_taken' };
    const code = newRecoveryCode();
    await c.query(`UPDATE players SET username=$2, password_hash=$3, recovery_hash=$4, is_guest=false, registered_at=now() WHERE id=$1`, [playerId, username, hashSecret(password), hashSecret(normCode(code))]);
    return { ok: true as const, recoveryCode: code, already: false };
  }).catch((e: { code?: string }) => (e?.code === '23505' ? { ok: false as const, error: 'username_taken' } : Promise.reject(e)));
  if (!r.ok) return r;
  return { ok: true, recoveryCode: r.recoveryCode, token: await newSession(playerId), already: r.already || undefined };
}

export async function login(usernameRaw: string, password: string, ip: string): Promise<{ ok: true; token: string; playerId: string } | { ok: false; error: string }> {
  const username = String(usernameRaw ?? '').trim().toLowerCase();
  const keys = [`u:${username}`, `ip:${ip}`];
  if (await tooManyAttempts(keys)) return { ok: false, error: 'locked' };
  const r = await pool.query('SELECT id, password_hash FROM players WHERE username=$1', [username]);
  const ok = !!r.rowCount && checkSecret(String(password ?? ''), r.rows[0].password_hash);
  await recordAttempt(keys, ok);
  if (!ok) return { ok: false, error: 'wrong' };
  return { ok: true, token: await newSession(r.rows[0].id), playerId: r.rows[0].id };
}

/** 用恢复码重设密码：旧恢复码作废、旧会话全部登出，发一组新恢复码 */
export async function resetWithCode(usernameRaw: string, code: string, newPassword: string, ip: string): Promise<{ ok: true; token: string; recoveryCode: string } | { ok: false; error: string }> {
  const username = String(usernameRaw ?? '').trim().toLowerCase();
  if (String(newPassword ?? '').length < 6 || newPassword.length > 72) return { ok: false, error: 'password_invalid' };
  const keys = [`r:${username}`, `ip:${ip}`];
  if (await tooManyAttempts(keys)) return { ok: false, error: 'locked' };
  const res = await tx(async (c) => {
    const r = await c.query('SELECT id, recovery_hash FROM players WHERE username=$1 FOR UPDATE', [username]);
    if (!r.rowCount || !checkSecret(normCode(String(code ?? '')), r.rows[0].recovery_hash)) return null;
    const next = newRecoveryCode(); const id = r.rows[0].id;
    await c.query('UPDATE players SET password_hash=$2, recovery_hash=$3 WHERE id=$1', [id, hashSecret(newPassword), hashSecret(normCode(next))]);
    await c.query('UPDATE sessions SET revoked_at=now() WHERE player_id=$1 AND revoked_at IS NULL', [id]);
    return { id, next };
  });
  await recordAttempt(keys, !!res);
  if (!res) return { ok: false, error: 'wrong' };
  return { ok: true, token: await newSession(res.id), recoveryCode: res.next };
}

/** 登录前给玩家看两边存档（不静默覆盖） */
export async function summary(playerId: string) {
  const r = await pool.query(`SELECT p.nickname, p.username, w.coins, w.energy,
     (SELECT qty FROM player_items WHERE player_id=p.id AND item='orange') AS oranges
     FROM players p LEFT JOIN wallets w ON w.player_id=p.id WHERE p.id=$1`, [playerId]);
  const x = r.rows[0] ?? {};
  return { nickname: x.nickname ?? null, username: x.username ?? null, coins: x.coins ?? 0, energy: x.energy ?? 0, oranges: x.oranges ?? 0 };
}
