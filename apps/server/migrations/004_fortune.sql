-- 求签（06 第 7 节）：每天第一次求签的签号和“天降好运”在服务器决定一次并保存，重试不重抽
CREATE TABLE IF NOT EXISTS fortune_daily (
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  day date NOT NULL,
  fortune_no integer NOT NULL,
  lucky boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, day)
);
