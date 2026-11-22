-- 第 5 批：街坊故事进度、送礼（东西先锁在礼物里，收下才转过去）、统计
CREATE TABLE IF NOT EXISTS story_progress (
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  story text NOT NULL,
  step integer NOT NULL DEFAULT 0,
  done_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, story)
);
CREATE TABLE IF NOT EXISTS gifts (
  id uuid PRIMARY KEY,
  from_player uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  to_player uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item text NOT NULL,
  request_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','refused','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  UNIQUE (from_player, request_id)
);
CREATE INDEX IF NOT EXISTS gifts_pending ON gifts(created_at) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS analytics_events (
  id bigserial PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind text NOT NULL,
  detail text NOT NULL DEFAULT '',
  day date NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytics_kind_day ON analytics_events(kind, day);
CREATE INDEX IF NOT EXISTS analytics_player ON analytics_events(player_id, at);
