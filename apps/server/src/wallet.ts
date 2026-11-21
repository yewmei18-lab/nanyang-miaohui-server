import type pg from 'pg';
import { GAME_CONFIG, CONFIG_VERSION, applyEnergyRegen, type WalletView } from '@nanyang/shared';
import { pool, tx } from './db.ts';

/**
 * 钱包/精力：服务器事务计算，客户端不能指定 delta。
 * 所有消费/奖励/退款都有唯一 idempotencyKey；同 key 重试返回原结果。
 */
type Asset = 'coins' | 'energy';
interface WalletRow { coins: number; energy: number; energy_updated_at: Date }

export function toView(w: { coins: number; energy: number; energyUpdatedAtMs: number }, now = Date.now()): WalletView {
  const max = GAME_CONFIG.wallet.maxEnergy;
  return {
    coins: w.coins,
    energy: w.energy,
    maxEnergy: max,
    nextEnergyInMs: w.energy >= max ? null : Math.max(0, w.energyUpdatedAtMs + GAME_CONFIG.wallet.energyRegenMs - now),
  };
}

/** 锁定钱包行并先应用自然恢复（07：消费先恢复再检查） */
async function lockAndRegen(c: pg.PoolClient, playerId: string, now: number) {
  const r = await c.query<WalletRow>('SELECT coins, energy, energy_updated_at FROM wallets WHERE player_id=$1 FOR UPDATE', [playerId]);
  if (!r.rowCount) throw new Error('wallet_missing');
  const row = r.rows[0];
  const regen = applyEnergyRegen(row.energy, row.energy_updated_at.getTime(), now);
  return { coins: row.coins, energy: regen.energy, energyUpdatedAtMs: regen.updatedAtMs };
}

async function writeWallet(c: pg.PoolClient, playerId: string, w: { coins: number; energy: number; energyUpdatedAtMs: number }) {
  await c.query('UPDATE wallets SET coins=$2, energy=$3, energy_updated_at=$4, version=version+1 WHERE player_id=$1', [playerId, w.coins, w.energy, new Date(w.energyUpdatedAtMs)]);
}

/** 创建钱包 + 初始 200 金币（唯一 grant key，每个持久身份仅一次） */
export async function ensureWallet(playerId: string, now = Date.now()) {
  return tx(async (c) => {
    await c.query(
      'INSERT INTO wallets(player_id, coins, energy, energy_updated_at) VALUES ($1, 0, $2, $3) ON CONFLICT (player_id) DO NOTHING',
      [playerId, GAME_CONFIG.wallet.initialEnergy, new Date(now)],
    );
    const w = await lockAndRegen(c, playerId, now);
    const ins = await c.query(
      `INSERT INTO ledger(player_id, asset, delta, reason, source_id, idempotency_key, config_version)
       VALUES ($1,'coins',$2,'initial_grant',$5,$3,$4) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [playerId, GAME_CONFIG.wallet.initialCoins, `grant:initial:${playerId}`, CONFIG_VERSION, playerId],
    );
    if (ins.rowCount) w.coins += GAME_CONFIG.wallet.initialCoins;
    await writeWallet(c, playerId, w);
    return toView(w, now);
  });
}

export async function getWallet(playerId: string, now = Date.now()): Promise<WalletView> {
  return tx(async (c) => {
    const w = await lockAndRegen(c, playerId, now);
    await writeWallet(c, playerId, w);
    return toView(w, now);
  });
}

export type SpendResult = { ok: true; replay: boolean; wallet: WalletView; ledgerId: number } | { ok: false; error: 'insufficient' | 'wallet_missing'; wallet?: WalletView };

/** 扣除（金币或精力）。同一 idempotencyKey 重试返回原扣款，不重复扣。 */
export async function spend(playerId: string, asset: Asset, amount: number, reason: string, sourceId: string, idempotencyKey: string, now = Date.now()): Promise<SpendResult> {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('bad_amount');
  try {
    return await tx(async (c) => {
      const w = await lockAndRegen(c, playerId, now);
      const existing = await c.query('SELECT id, player_id FROM ledger WHERE idempotency_key=$1', [idempotencyKey]);
      if (existing.rowCount) {
        if (existing.rows[0].player_id !== playerId) throw new Error('idempotency_key_conflict');
        await writeWallet(c, playerId, w);
        return { ok: true as const, replay: true, wallet: toView(w, now), ledgerId: Number(existing.rows[0].id) };
      }
      if (w[asset] < amount) {
        await writeWallet(c, playerId, w);
        return { ok: false as const, error: 'insufficient' as const, wallet: toView(w, now) };
      }
      const wasFull = w.energy >= GAME_CONFIG.wallet.maxEnergy;
      w[asset] -= amount;
      if (asset === 'energy' && wasFull) w.energyUpdatedAtMs = now; // 从满值开始计恢复
      const ins = await c.query(
        `INSERT INTO ledger(player_id, asset, delta, reason, source_id, idempotency_key, config_version) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [playerId, asset, -amount, reason, sourceId, idempotencyKey, CONFIG_VERSION],
      );
      await writeWallet(c, playerId, w);
      return { ok: true as const, replay: false, wallet: toView(w, now), ledgerId: Number(ins.rows[0].id) };
    });
  } catch (e) {
    if ((e as Error).message === 'wallet_missing') return { ok: false, error: 'wallet_missing' };
    throw e;
  }
}

/** 奖励（加金币/精力，精力不超上限）。同 key 只发一次。 */
export async function credit(playerId: string, asset: Asset, amount: number, reason: string, sourceId: string, idempotencyKey: string, now = Date.now()) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('bad_amount');
  return tx(async (c) => {
    const w = await lockAndRegen(c, playerId, now);
    let applied = amount;
    if (asset === 'energy') applied = Math.min(amount, GAME_CONFIG.wallet.maxEnergy - w.energy);
    const ins = await c.query(
      `INSERT INTO ledger(player_id, asset, delta, reason, source_id, idempotency_key, config_version) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [playerId, asset, applied, reason, sourceId, idempotencyKey, CONFIG_VERSION],
    );
    if (ins.rowCount) {
      w[asset] += applied;
      if (asset === 'energy' && w.energy >= GAME_CONFIG.wallet.maxEnergy) w.energyUpdatedAtMs = now;
    }
    await writeWallet(c, playerId, w);
    return { applied: ins.rowCount ? applied : 0, replay: !ins.rowCount, wallet: toView(w, now) };
  });
}

/** 退款：必须关联原扣款，唯一 refund key，上限原扣款；没有原扣款不退款。 */
export async function refund(playerId: string, originalKey: string, reason: string, now = Date.now()) {
  return tx(async (c) => {
    const w = await lockAndRegen(c, playerId, now);
    const orig = await c.query('SELECT id, asset, delta, player_id FROM ledger WHERE idempotency_key=$1', [originalKey]);
    if (!orig.rowCount || orig.rows[0].player_id !== playerId || orig.rows[0].delta >= 0) {
      await writeWallet(c, playerId, w);
      return { ok: false as const, error: 'no_original_charge' as const, wallet: toView(w, now) };
    }
    const o = orig.rows[0];
    const amount = -o.delta as number;
    const asset = o.asset as Asset;
    const applied = asset === 'energy' ? Math.min(amount, GAME_CONFIG.wallet.maxEnergy - w.energy) : amount;
    const ins = await c.query(
      `INSERT INTO ledger(player_id, asset, delta, reason, source_id, idempotency_key, refund_of, config_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT DO NOTHING RETURNING id`,
      [playerId, asset, applied, reason, originalKey, `refund:${originalKey}`, o.id, CONFIG_VERSION],
    );
    if (ins.rowCount) w[asset] += applied;
    await writeWallet(c, playerId, w);
    return { ok: true as const, replay: !ins.rowCount, wallet: toView(w, now) };
  });
}

export async function walletRaw(playerId: string) {
  const r = await pool.query('SELECT coins, energy FROM wallets WHERE player_id=$1', [playerId]);
  return r.rows[0] as { coins: number; energy: number } | undefined;
}

export type OrderResult = { ok: true; orderId: string; replay: boolean; wallet: WalletView } | { ok: false; error: 'insufficient'; wallet: WalletView };
/** MAMAK 下单：建单 + 扣金币在同一事务；同一 requestId 返回原来那张单，不重复扣 */
export async function placeMamakOrder(playerId: string, orderId: string, requestId: string, item: { id: string; price: number; energy: number }, now = Date.now()): Promise<OrderResult> {
  return tx(async (c) => {
    const w = await lockAndRegen(c, playerId, now);
    const ex = await c.query('SELECT id FROM mamak_orders WHERE player_id=$1 AND request_id=$2', [playerId, requestId]);
    if (ex.rowCount) { await writeWallet(c, playerId, w); return { ok: true as const, orderId: ex.rows[0].id as string, replay: true, wallet: toView(w, now) }; }
    if (w.coins < item.price) { await writeWallet(c, playerId, w); return { ok: false as const, error: 'insufficient' as const, wallet: toView(w, now) }; }
    w.coins -= item.price;
    await c.query(`INSERT INTO ledger(player_id, asset, delta, reason, source_id, idempotency_key, config_version) VALUES ($1,'coins',$2,'mamak_order',$3,$4,$5)`,
      [playerId, -item.price, orderId, `mamak:${orderId}`, CONFIG_VERSION]);
    await c.query(`INSERT INTO mamak_orders(id, player_id, request_id, item, price, energy, status) VALUES ($1,$2,$3,$4,$5,$6,'ordered')`,
      [orderId, playerId, requestId, item.id, item.price, item.energy]);
    await writeWallet(c, playerId, w);
    return { ok: true as const, orderId, replay: false, wallet: toView(w, now) };
  });
}
export function setOrderStatus(orderId: string, status: string) {
  return pool.query('UPDATE mamak_orders SET status=$2, updated_at=now() WHERE id=$1', [orderId, status]).catch(() => {});
}

/** 同时扣金币和精力（套圈开局）：一个事务，任一不够都不扣；同 key 重试不重复扣 */
export async function spendBoth(playerId: string, coins: number, energy: number, reason: string, sourceId: string, key: string, now = Date.now()): Promise<SpendResult> {
  return tx(async (c) => {
    const w = await lockAndRegen(c, playerId, now);
    const ex = await c.query('SELECT id FROM ledger WHERE idempotency_key=$1', [`${key}:coins`]);
    if (ex.rowCount) { await writeWallet(c, playerId, w); return { ok: true as const, replay: true, wallet: toView(w, now), ledgerId: Number(ex.rows[0].id) }; }
    if (w.coins < coins || w.energy < energy) { await writeWallet(c, playerId, w); return { ok: false as const, error: 'insufficient' as const, wallet: toView(w, now) }; }
    const wasFull = w.energy >= GAME_CONFIG.wallet.maxEnergy;
    w.coins -= coins; w.energy -= energy; if (wasFull) w.energyUpdatedAtMs = now;
    const ins = await c.query(`INSERT INTO ledger(player_id, asset, delta, reason, source_id, idempotency_key, config_version) VALUES ($1,'coins',$2,$3,$4,$5,$6) RETURNING id`, [playerId, -coins, reason, sourceId, `${key}:coins`, CONFIG_VERSION]);
    await c.query(`INSERT INTO ledger(player_id, asset, delta, reason, source_id, idempotency_key, config_version) VALUES ($1,'energy',$2,$3,$4,$5,$6)`, [playerId, -energy, reason, sourceId, `${key}:energy`, CONFIG_VERSION]);
    await writeWallet(c, playerId, w);
    return { ok: true as const, replay: false, wallet: toView(w, now), ledgerId: Number(ins.rows[0].id) };
  });
}
