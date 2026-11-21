-- 南洋庙会 · 阶段A 初始结构（append-only：之后只新增迁移文件）
CREATE TABLE IF NOT EXISTS players (
  id                     uuid PRIMARY KEY,
  guest_credential_hash  text NOT NULL,
  nickname               text,
  is_guest               boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS avatars (
  player_id   uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  config_json jsonb NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 钱包与账本（07）
CREATE TABLE IF NOT EXISTS wallets (
  player_id          uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  coins              integer NOT NULL CHECK (coins >= 0),
  energy             integer NOT NULL CHECK (energy >= 0 AND energy <= 100),
  energy_updated_at  timestamptz NOT NULL,
  version            integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ledger (
  id               bigserial PRIMARY KEY,
  player_id        uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  asset            text NOT NULL CHECK (asset IN ('coins','energy')),
  delta            integer NOT NULL,
  reason           text NOT NULL,
  source_id        text,
  idempotency_key  text NOT NULL UNIQUE,
  refund_of        bigint REFERENCES ledger(id),
  config_version   text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_one_refund_per_entry ON ledger(refund_of) WHERE refund_of IS NOT NULL;

-- 打小人目标
CREATE TABLE IF NOT EXISTS targets (
  id                 bigserial PRIMARY KEY,
  normalized_key     text NOT NULL UNIQUE,
  display_name       text NOT NULL,
  moderation_status  text NOT NULL DEFAULT 'visible',
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- 打小人局
CREATE TABLE IF NOT EXISTS hit_sessions (
  id              uuid PRIMARY KEY,
  player_id       uuid NOT NULL REFERENCES players(id),
  target_id       bigint NOT NULL REFERENCES targets(id),
  request_id      text NOT NULL,
  room_id         text,
  seat_id         integer,
  config_version  text NOT NULL,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  ended_at        timestamptz,
  accepted_count  integer NOT NULL DEFAULT 0,
  max_combo       integer NOT NULL DEFAULT 0,
  rejected_count  integer NOT NULL DEFAULT 0,
  status          text NOT NULL CHECK (status IN ('countdown','active','sealed','cancelled','interrupted')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, request_id)
);

-- 有效击打事件：(session_id, seq) 唯一，逐事件去重
CREATE TABLE IF NOT EXISTS hit_events (
  session_id   uuid NOT NULL REFERENCES hit_sessions(id),
  seq          integer NOT NULL,
  target_id    bigint NOT NULL REFERENCES targets(id),
  player_id    uuid NOT NULL,
  accepted_at  timestamptz NOT NULL,
  day_bucket   date NOT NULL,
  PRIMARY KEY (session_id, seq)
);

-- 目标累计：bucket_type 'day'（Asia/Kuala_Lumpur 日期）或 'all'（bucket_start = 1970-01-01）
CREATE TABLE IF NOT EXISTS hit_totals (
  target_id        bigint NOT NULL REFERENCES targets(id),
  bucket_type      text NOT NULL CHECK (bucket_type IN ('day','all')),
  bucket_start     date NOT NULL,
  count            bigint NOT NULL DEFAULT 0,
  last_reached_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (target_id, bucket_type, bucket_start)
);
CREATE INDEX IF NOT EXISTS hit_totals_rank ON hit_totals(bucket_type, bucket_start, count DESC, last_reached_at ASC, target_id ASC);

-- 榜单变化 outbox（订阅恢复游标）
CREATE TABLE IF NOT EXISTS leaderboard_outbox (
  id          bigserial PRIMARY KEY,
  target_ids  bigint[] NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
