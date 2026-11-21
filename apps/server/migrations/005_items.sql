-- 玩家身上的小东西（第一批：舞狮接到的旺桔）
CREATE TABLE IF NOT EXISTS player_items (
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item text NOT NULL,
  qty integer NOT NULL DEFAULT 0 CHECK (qty >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, item)
);
