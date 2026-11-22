-- 游艺档（21点、89点、比大小、老虎机）：每一局一行；只用游戏金币
-- payout = 这一局拿回多少金币（含本金，0 = 输）；21点还没开牌时是 NULL
CREATE TABLE IF NOT EXISTS casino_rounds (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  game text NOT NULL CHECK (game IN ('bj','p89','dice','slot')),
  bet integer NOT NULL CHECK (bet > 0),
  payout integer CHECK (payout >= 0),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text NOT NULL,
  day date NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE (player_id, request_id)
);
CREATE INDEX IF NOT EXISTS casino_rounds_player_day ON casino_rounds(player_id, day);
CREATE INDEX IF NOT EXISTS casino_rounds_open ON casino_rounds(at) WHERE payout IS NULL;
