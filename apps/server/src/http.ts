import express from 'express';
import { validateAvatar, normalizeNickname, GAME_CONFIG, CONFIG_VERSION, WORLD_VERSION, klDay, rosterAvatar } from '@nanyang/shared';
import { createGuest, verifyToken, bearer } from './auth.ts';
import { pool } from './db.ts';
import { getWallet } from './wallet.ts';
import { queryTop, getSessionResult, hitPipeline, leaderboard } from './hits.ts';
import { metrics } from './metrics.ts';
import { ENV } from './env.ts';

export function mountHttp(app: express.Application) {
  app.use(express.json({ limit: '16kb' }));
  app.use((req, res, next) => {
    const allowed = ENV.CORS_ORIGIN.split(',').map((s) => s.trim());
    const origin = req.headers.origin;
    if (allowed.includes('*')) res.setHeader('Access-Control-Allow-Origin', '*');
    else if (origin && allowed.includes(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    next();
  });

  const auth = async (req: express.Request, res: express.Response) => {
    const who = await verifyToken(bearer(req.headers.authorization));
    if (!who) { res.status(401).json({ error: 'unauthorized' }); return null; }
    return who;
  };

  app.get('/healthz', async (_req, res) => {
    let db = false;
    try { await pool.query('SELECT 1'); db = true; } catch { /* */ }
    res.json({ ok: db, db, configVersion: CONFIG_VERSION, worldVersion: WORLD_VERSION, pendingHits: hitPipeline.pending, lastFlushError: hitPipeline.lastError, metrics: { ...metrics, tickSamples: undefined, tick: metrics.tickStats() } });
  });

  app.get('/api/config', (_req, res) => res.json({ config: GAME_CONFIG }));

  // 游客身份由后端签发；客户端不能自行指定 userId
  app.post('/api/guest', async (_req, res) => {
    try { res.json(await createGuest()); } catch (e) { res.status(503).json({ error: 'db_unavailable' }); }
  });

  app.get('/api/me', async (req, res) => {
    const who = await auth(req, res); if (!who) return;
    const a = await pool.query('SELECT config_json, version FROM avatars WHERE player_id=$1', [who.playerId]);
    const wallet = await getWallet(who.playerId);
    // 还没选角色：按进入顺序依次派发名单里的下一个角色（第 n 个玩家拿第 n 个）
    let suggested = null;
    if (!a.rows[0]) {
      const n = await pool.query('SELECT count(*)::int AS n FROM players WHERE created_at < (SELECT created_at FROM players WHERE id=$1)', [who.playerId]);
      suggested = rosterAvatar(n.rows[0].n);
    }
    res.json({ nickname: who.nickname, avatar: a.rows[0]?.config_json ?? null, avatarVersion: a.rows[0]?.version ?? 0, wallet, suggested });
  });

  // 保存外观：只接受清单枚举；version 用于乐观并发
  app.put('/api/avatar', async (req, res) => {
    const who = await auth(req, res); if (!who) return;
    const v = validateAvatar(req.body?.config);
    if (!v.ok) { res.status(400).json({ error: v.error }); return; }
    const n = normalizeNickname(req.body?.nickname);
    if (!n.ok) { res.status(400).json({ error: `nickname_${n.error}` }); return; }
    const expected = Number.isInteger(req.body?.version) ? req.body.version : 0;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query('SELECT version FROM avatars WHERE player_id=$1 FOR UPDATE', [who.playerId]);
      const curV = cur.rows[0]?.version ?? 0;
      if (curV !== expected) { await client.query('ROLLBACK'); res.status(409).json({ error: 'version_conflict', version: curV }); return; }
      if (cur.rowCount) await client.query('UPDATE avatars SET config_json=$2, version=version+1, updated_at=now() WHERE player_id=$1', [who.playerId, v.value]);
      else await client.query('INSERT INTO avatars(player_id, config_json, version) VALUES ($1,$2,1)', [who.playerId, v.value]);
      await client.query('UPDATE players SET nickname=$2 WHERE id=$1', [who.playerId, n.value]);
      await client.query('COMMIT');
      res.json({ ok: true, version: curV + 1, config: v.value, nickname: n.value });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(503).json({ error: 'db_unavailable' });
    } finally { client.release(); }
  });

  app.get('/api/leaderboard', async (req, res) => {
    try {
      const scope = req.query.scope === 'all' ? 'all' : 'day';
      const rows = await queryTop(scope, scope === 'all' ? '1970-01-01' : klDay(Date.now()), GAME_CONFIG.leaderboard.topN);
      res.json({ scope, rows, latest: leaderboard.latest });
    } catch { res.status(503).json({ error: 'db_unavailable' }); }
  });

  // ── 姻缘树：每人一张姻缘牌（昵称 + 自我介绍 + 选填 Instagram），所有人可看 ──
  const cleanText = (v: unknown, max: number) => typeof v === 'string' ? Array.from(v.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()).slice(0, max).join('') : '';
  app.get('/api/wishes', async (_req, res) => {
    try {
      const r = await pool.query(`SELECT w.player_id, p.nickname, w.intro, w.instagram, w.updated_at, a.config_json
        FROM wish_cards w JOIN players p ON p.id=w.player_id LEFT JOIN avatars a ON a.player_id=w.player_id
        ORDER BY w.updated_at DESC LIMIT 60`);
      // 不公开账号 ID：只给一个不可反查的序号
      res.json({ cards: r.rows.map((x, i) => ({ n: i + 1, nickname: x.nickname ?? '游客', intro: x.intro, instagram: x.instagram, updatedAt: x.updated_at, avatar: x.config_json })) });
    } catch { res.status(503).json({ error: 'db_unavailable' }); }
  });
  app.get('/api/wishes/me', async (req, res) => {
    const who = await auth(req, res); if (!who) return;
    const r = await pool.query('SELECT intro, instagram FROM wish_cards WHERE player_id=$1', [who.playerId]).catch(() => null);
    if (!r) { res.status(503).json({ error: 'db_unavailable' }); return; }
    res.json({ card: r.rows[0] ?? null });
  });
  app.put('/api/wishes/me', async (req, res) => {
    const who = await auth(req, res); if (!who) return;
    if (!who.nickname) { res.status(400).json({ error: 'need_nickname' }); return; }
    const intro = cleanText(req.body?.intro, GAME_CONFIG.wish.introMaxChars);
    if (!intro) { res.status(400).json({ error: 'intro_empty' }); return; }
    const igRaw = cleanText(req.body?.instagram, GAME_CONFIG.wish.igMaxChars).replace(/^@/, '');
    if (igRaw && !/^[A-Za-z0-9._]{1,30}$/.test(igRaw)) { res.status(400).json({ error: 'instagram_bad' }); return; }
    try {
      await pool.query(`INSERT INTO wish_cards(player_id, intro, instagram) VALUES ($1,$2,$3)
        ON CONFLICT (player_id) DO UPDATE SET intro=EXCLUDED.intro, instagram=EXCLUDED.instagram, updated_at=now()`, [who.playerId, intro, igRaw || null]);
      res.json({ ok: true, card: { intro, instagram: igRaw || null } });
    } catch { res.status(503).json({ error: 'db_unavailable' }); }
  });
  app.delete('/api/wishes/me', async (req, res) => {
    const who = await auth(req, res); if (!who) return;
    await pool.query('DELETE FROM wish_cards WHERE player_id=$1', [who.playerId]).catch(() => {});
    res.json({ ok: true });
  });

  app.get('/api/session/:id', async (req, res) => {
    const who = await auth(req, res); if (!who) return;
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) { res.status(400).json({ error: 'bad_id' }); return; }
    const r = await getSessionResult(req.params.id, who.playerId).catch(() => null);
    if (!r) { res.status(404).json({ error: 'not_found' }); return; }
    res.json(r);
  });
}
