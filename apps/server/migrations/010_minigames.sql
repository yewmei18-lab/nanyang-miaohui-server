-- 童玩小游戏：每人每个游戏的关卡（下次来接着玩）、每天领了多少金币 / 几次（每日上限）
CREATE TABLE IF NOT EXISTS minigame_progress (
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  game text NOT NULL,
  level integer NOT NULL DEFAULT 1,
  best integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, game)
);
CREATE TABLE IF NOT EXISTS minigame_daily (
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  game text NOT NULL,
  day date NOT NULL,
  wins integer NOT NULL DEFAULT 0,
  coins integer NOT NULL DEFAULT 0,
  rounds integer NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, game, day)
);
