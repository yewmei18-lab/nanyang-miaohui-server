-- 第 4 批：游园纸印章（每天一张）、祝福留言架（可删除自己的、举报别人的）
CREATE TABLE IF NOT EXISTS stamps (
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  day date NOT NULL,
  stamp text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, day, stamp)
);
CREATE TABLE IF NOT EXISTS blessings (
  id bigserial PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  hidden boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS blessings_recent ON blessings(created_at DESC) WHERE NOT hidden;
CREATE TABLE IF NOT EXISTS blessing_reports (
  blessing_id bigint NOT NULL REFERENCES blessings(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  PRIMARY KEY (blessing_id, player_id)
);
