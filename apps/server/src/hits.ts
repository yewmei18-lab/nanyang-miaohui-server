import pg from 'pg';
import { GAME_CONFIG, klDay, type LeaderboardPayload, type LeaderRow, type SessionResult, type TargetTotal } from '@nanyang/shared';
import { pool, tx, pgOptions } from './db.ts';
import { ENV } from './env.ts';

/**
 * 全服打小人实时累计（07）：
 * room 收取有效事件 → ≤250ms 小批写入 hit_events（(session_id,seq) 唯一去重）
 * → 同事务只按“新插入”的事件增加今日/累计 → 写 outbox → NOTIFY
 * → 每个进程 LISTEN 后刷新榜单并推给所有房间。
 * 单进程样板也走同一条持久链路，不在房间内存里私自累计。
 */
export interface HitEvent { sessionId: string; seq: number; targetId: number; playerId: string; acceptedAt: number }

type FlushListener = (info: { ok: boolean; error?: string; pending: number }) => void;

class HitPipeline {
  private queue: HitEvent[] = [];
  private flushing: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private failures = 0;
  private listeners = new Set<FlushListener>();
  /** 每个 session 已确认落盘的事件数（用于告知“已保存”） */
  readonly persistedBySession = new Map<string, number>();
  lastError: string | null = null;

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.flush(); }, GAME_CONFIG.leaderboard.flushIntervalMs);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  onFlush(l: FlushListener) { this.listeners.add(l); return () => this.listeners.delete(l); }
  get pending() { return this.queue.length; }

  push(e: HitEvent) { this.queue.push(e); }

  /** 立即写入当前队列（结算前调用，保证本局事件已落盘） */
  async flush(): Promise<void> {
    if (this.flushing) { await this.flushing; if (!this.queue.length) return; }
    if (!this.queue.length) return;
    const batch = this.queue.splice(0, 2000);
    this.flushing = (async () => {
      try {
        await writeBatch(batch);
        this.failures = 0; this.lastError = null;
        for (const e of batch) this.persistedBySession.set(e.sessionId, (this.persistedBySession.get(e.sessionId) ?? 0) + 1);
        this.listeners.forEach((l) => l({ ok: true, pending: this.queue.length }));
      } catch (err) {
        const code = (err as { code?: string }).code ?? '';
        if (code.startsWith('23') && batch.length > 0) {
          // 完整性错误（非暂时性）：逐条写入，隔离坏事件，避免整条队列永久卡住
          const failed: HitEvent[] = [];
          for (const e of batch) {
            try { await writeBatch([e]); this.persistedBySession.set(e.sessionId, (this.persistedBySession.get(e.sessionId) ?? 0) + 1); }
            catch (e2) { if (((e2 as { code?: string }).code ?? '').startsWith('23')) console.error('[hits] dropped invalid event', e.sessionId, e.seq); else failed.push(e); }
          }
          this.queue.unshift(...failed);
          this.lastError = failed.length ? (err as Error).message : null;
          this.listeners.forEach((l) => l({ ok: failed.length === 0, pending: this.queue.length }));
          return;
        }
        // 暂时性失败：放回队首，下次重试；唯一约束保证重试不重复计数
        this.queue.unshift(...batch);
        this.failures++;
        this.lastError = (err as Error).message;
        this.listeners.forEach((l) => l({ ok: false, error: this.lastError!, pending: this.queue.length }));
      } finally {
        this.flushing = null;
      }
    })();
    await this.flushing;
  }
}

async function writeBatch(batch: HitEvent[]) {
  if (!batch.length) return;
  await tx(async (c) => {
    const sessionIds = batch.map((e) => e.sessionId);
    const seqs = batch.map((e) => e.seq);
    const targetIds = batch.map((e) => e.targetId);
    const playerIds = batch.map((e) => e.playerId);
    const ats = batch.map((e) => new Date(e.acceptedAt).toISOString());
    const days = batch.map((e) => klDay(e.acceptedAt));
    const ins = await c.query(
      `INSERT INTO hit_events(session_id, seq, target_id, player_id, accepted_at, day_bucket)
       SELECT * FROM unnest($1::uuid[], $2::int[], $3::bigint[], $4::uuid[], $5::timestamptz[], $6::date[])
       ON CONFLICT (session_id, seq) DO NOTHING
       RETURNING target_id, day_bucket, accepted_at`,
      [sessionIds, seqs, targetIds, playerIds, ats, days],
    );
    if (!ins.rowCount) return;
    // 只按新插入事件累加
    const agg = new Map<string, { targetId: number; type: 'day' | 'all'; bucket: string; n: number; last: Date }>();
    for (const r of ins.rows as Array<{ target_id: number; day_bucket: string; accepted_at: Date }>) {
      for (const [type, bucket] of [['day', r.day_bucket], ['all', '1970-01-01']] as const) {
        const k = `${r.target_id}|${type}|${bucket}`;
        const a = agg.get(k) ?? { targetId: r.target_id, type, bucket, n: 0, last: r.accepted_at };
        a.n++; if (r.accepted_at > a.last) a.last = r.accepted_at;
        agg.set(k, a);
      }
    }
    const rows = [...agg.values()];
    await c.query(
      `INSERT INTO hit_totals(target_id, bucket_type, bucket_start, count, last_reached_at)
       SELECT * FROM unnest($1::bigint[], $2::text[], $3::date[], $4::bigint[], $5::timestamptz[])
       ON CONFLICT (target_id, bucket_type, bucket_start)
       DO UPDATE SET count = hit_totals.count + EXCLUDED.count, last_reached_at = GREATEST(hit_totals.last_reached_at, EXCLUDED.last_reached_at)`,
      [rows.map((r) => r.targetId), rows.map((r) => r.type), rows.map((r) => r.bucket), rows.map((r) => r.n), rows.map((r) => r.last.toISOString())],
    );
    const changedTargets = [...new Set(rows.map((r) => r.targetId))];
    const ob = await c.query('INSERT INTO leaderboard_outbox(target_ids) VALUES ($1) RETURNING id', [changedTargets]);
    await c.query(`SELECT pg_notify($2, $1)`, [String(ob.rows[0].id), `${ENV.DB_SCHEMA ? ENV.DB_SCHEMA + '_' : ''}leaderboard`]);
  });
}

export const hitPipeline = new HitPipeline();

// ───────────────────────── 榜单 ─────────────────────────

export async function queryTop(type: 'day' | 'all', bucket: string, n: number): Promise<LeaderRow[]> {
  const r = await pool.query(
    `SELECT t.id, t.display_name, h.count FROM hit_totals h JOIN targets t ON t.id=h.target_id
     WHERE h.bucket_type=$1 AND h.bucket_start=$2 AND t.moderation_status='visible'
     ORDER BY h.count DESC, h.last_reached_at ASC, h.target_id ASC LIMIT $3`,
    [type, bucket, n],
  );
  return r.rows.map((row, i) => ({ rank: i + 1, targetId: Number(row.id), displayName: row.display_name, count: Number(row.count) }));
}

export async function queryTotals(ids: number[], day: string): Promise<TargetTotal[]> {
  const r = await pool.query(
    `SELECT t.id, t.display_name,
       COALESCE((SELECT count FROM hit_totals WHERE target_id=t.id AND bucket_type='day' AND bucket_start=$2),0) AS today,
       COALESCE((SELECT count FROM hit_totals WHERE target_id=t.id AND bucket_type='all' AND bucket_start='1970-01-01'),0) AS all_c
     FROM targets t WHERE t.id = ANY($1::bigint[]) AND t.moderation_status='visible'`,
    [ids, day],
  );
  return r.rows.map((x) => ({ targetId: Number(x.id), displayName: x.display_name, today: Number(x.today), all: Number(x.all_c) }));
}

export async function targetStanding(targetId: number, now = Date.now()) {
  const day = klDay(now);
  const q = async (type: 'day' | 'all', bucket: string) => {
    const r = await pool.query(
      `WITH me AS (SELECT count, last_reached_at FROM hit_totals WHERE target_id=$1 AND bucket_type=$2 AND bucket_start=$3)
       SELECT (SELECT count FROM me) AS count,
              CASE WHEN (SELECT count FROM me) IS NULL THEN NULL ELSE (
                SELECT COUNT(*) + 1 FROM hit_totals h JOIN targets t ON t.id=h.target_id, me
                WHERE h.bucket_type=$2 AND h.bucket_start=$3 AND t.moderation_status='visible'
                  AND (h.count > me.count OR (h.count = me.count AND (h.last_reached_at < me.last_reached_at OR (h.last_reached_at = me.last_reached_at AND h.target_id < $1))))
              ) END AS rank`,
      [targetId, type, bucket],
    );
    return { count: Number(r.rows[0]?.count ?? 0), rank: r.rows[0]?.rank == null ? null : Number(r.rows[0].rank) };
  };
  const [today, all] = await Promise.all([q('day', day), q('all', '1970-01-01')]);
  return { day, today, all };
}

type BoardListener = (b: LeaderboardPayload) => void;

class LeaderboardService {
  private listeners = new Set<BoardListener>();
  private listenClient: pg.Client | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshing = false;
  private dirty = false;
  private seq = 0;
  latest: LeaderboardPayload | null = null;
  lastOutboxId = 0;
  private consumedOutboxId = -1; // 已读取变化的 outbox 游标（重连后从游标继续，不漏变化）

  async start() {
    await this.connectListener();
    await this.refresh();
  }

  private async connectListener() {
    const c = new pg.Client(pgOptions);
    c.on('error', () => { /* 断开后重连 */ });
    c.on('end', () => { this.listenClient = null; setTimeout(() => { void this.connectListener().then(() => this.schedule()).catch(() => {}); }, 1000); });
    await c.connect();
    await c.query(`LISTEN ${ENV.DB_SCHEMA ? ENV.DB_SCHEMA + '_' : ''}leaderboard`);
    c.on('notification', (n) => {
      const id = Number(n.payload);
      if (Number.isFinite(id) && id > this.lastOutboxId) this.lastOutboxId = id;
      this.schedule();
    });
    this.listenClient = c;
  }

  subscribe(l: BoardListener) { this.listeners.add(l); if (this.latest) l(this.latest); return () => this.listeners.delete(l); }

  /** 合并短间隔内的多次变化，再统一推送 */
  schedule() {
    this.dirty = true;
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => { this.refreshTimer = null; void this.refresh(); }, GAME_CONFIG.leaderboard.refreshThrottleMs);
  }

  async refresh() {
    if (this.refreshing) { this.dirty = true; return; }
    this.refreshing = true; this.dirty = false;
    try {
      const day = klDay(Date.now());
      if (this.consumedOutboxId < 0) {
        const m = await pool.query('SELECT COALESCE(MAX(id),0) AS id FROM leaderboard_outbox');
        this.consumedOutboxId = Number(m.rows[0].id);
      }
      const ob = await pool.query('SELECT id, target_ids FROM leaderboard_outbox WHERE id > $1 ORDER BY id LIMIT 500', [this.consumedOutboxId]);
      const changedIds = new Set<number>();
      for (const r of ob.rows) { for (const t of r.target_ids as number[]) changedIds.add(Number(t)); this.consumedOutboxId = Math.max(this.consumedOutboxId, Number(r.id)); }
      const [today, all, changed] = await Promise.all([
        queryTop('day', day, GAME_CONFIG.leaderboard.topN),
        queryTop('all', '1970-01-01', GAME_CONFIG.leaderboard.topN),
        changedIds.size ? queryTotals([...changedIds], day) : Promise.resolve([] as TargetTotal[]),
      ]);
      this.latest = { today, all, changed, day, updatedAt: Date.now(), seq: ++this.seq };
      this.listeners.forEach((l) => l(this.latest!));
    } catch (e) {
      console.error('[leaderboard] refresh failed', (e as Error).message);
    } finally {
      this.refreshing = false;
      if (this.dirty) this.schedule();
    }
  }

  async stop() { try { await this.listenClient?.end(); } catch { /* */ } }
}

export const leaderboard = new LeaderboardService();

// ───────────────────────── 局：创建 / 封存 ─────────────────────────

export async function upsertTarget(key: string, displayName: string): Promise<number> {
  // 先查后插：避免 ON CONFLICT DO UPDATE 改唯一键列而与拍击批量写入（外键 KEY SHARE 锁）互相等待
  const found = await pool.query('SELECT id FROM targets WHERE normalized_key=$1', [key]);
  if (found.rowCount) return Number(found.rows[0].id);
  await pool.query('INSERT INTO targets(normalized_key, display_name) VALUES ($1,$2) ON CONFLICT (normalized_key) DO NOTHING', [key, displayName]);
  const r = await pool.query('SELECT id FROM targets WHERE normalized_key=$1', [key]);
  return Number(r.rows[0].id);
}

/** 封存一局：只记录结果，不再累加榜单（拍击期间已计入） */
export async function sealSession(sessionId: string, maxCombo: number, rejected: number, endedAt: number) {
  await pool.query(
    `UPDATE hit_sessions SET status='sealed', ended_at=$2, max_combo=GREATEST(max_combo,$3), rejected_count=$4,
       accepted_count=(SELECT COUNT(*) FROM hit_events WHERE session_id=$1)
     WHERE id=$1 AND status IN ('countdown','active')`,
    [sessionId, new Date(endedAt), maxCombo, rejected],
  );
}

export async function getSessionResult(sessionId: string, playerId?: string): Promise<SessionResult | null> {
  const r = await pool.query(
    `SELECT s.id, s.player_id, s.status, s.accepted_count, s.max_combo, s.target_id, t.display_name,
            (SELECT COUNT(*) FROM hit_events e WHERE e.session_id=s.id) AS persisted
     FROM hit_sessions s JOIN targets t ON t.id=s.target_id WHERE s.id=$1`,
    [sessionId],
  );
  if (!r.rowCount) return null;
  const s = r.rows[0];
  if (playerId && s.player_id !== playerId) return null;
  const st = await targetStanding(Number(s.target_id));
  const count = s.status === 'sealed' ? Number(s.accepted_count) : Number(s.persisted);
  return {
    sessionId,
    targetDisplayName: s.display_name,
    acceptedCount: count,
    maxCombo: Number(s.max_combo),
    targetToday: st.today.count,
    targetAllTime: st.all.count,
    todayRank: st.today.rank,
    allRank: st.all.rank,
    contribution: count,
    status: s.status === 'sealed' ? 'sealed' : 'pending',
    day: st.day,
  };
}

/** 启动恢复：上次进程崩溃时仍在进行的局 → 以已落盘事件封存为 interrupted（不虚报未确认输入） */
export async function recoverInterruptedSessions() {
  const r = await pool.query(
    `UPDATE hit_sessions SET status='interrupted', ended_at=now(),
       accepted_count=(SELECT COUNT(*) FROM hit_events e WHERE e.session_id=hit_sessions.id)
     WHERE status IN ('countdown','active') RETURNING id`,
  );
  return r.rowCount ?? 0;
}
