-- 年味小玩意：抽红包（每人每天一个）、捞金鱼（每天几局、连赢几局）、灯谜（每题每天答一次）、舞狮接桔子月榜
CREATE TABLE IF NOT EXISTS angpao_draws (
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  day date NOT NULL,
  coins integer NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, day)
);
CREATE TABLE IF NOT EXISTS goldfish_daily (
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  day date NOT NULL,
  rounds integer NOT NULL DEFAULT 0,
  streak integer NOT NULL DEFAULT 0,
  fish integer NOT NULL DEFAULT 0,
  coins integer NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, day)
);
CREATE TABLE IF NOT EXISTS riddle_answers (
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  day date NOT NULL,
  n integer NOT NULL,
  riddle integer NOT NULL,
  choice text NOT NULL,
  correct boolean NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, day, n)
);
-- 每人每月接到几颗（updated_at = 到达这个数字的时间，同分时先到的排前面）
CREATE TABLE IF NOT EXISTS orange_season (
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  season text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, season)
);
CREATE INDEX IF NOT EXISTS orange_season_rank ON orange_season (season, count DESC, updated_at);
-- 月底前三名：每个名次只定一次（定了就不再变），发钱用 ledger 的固定 key
CREATE TABLE IF NOT EXISTS orange_season_awards (
  season text NOT NULL,
  rank integer NOT NULL,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  count integer NOT NULL,
  coins integer NOT NULL,
  paid_at timestamptz,
  told_at timestamptz,
  PRIMARY KEY (season, rank)
);
CREATE TABLE IF NOT EXISTS orange_season_closed (
  season text PRIMARY KEY,
  closed_at timestamptz NOT NULL DEFAULT now()
);
