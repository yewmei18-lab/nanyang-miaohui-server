-- 木鱼禅院：个人敲木鱼次数（不排行，06 第 3 节）
CREATE TABLE IF NOT EXISTS woodfish_counts (
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  day date NOT NULL,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, day)
);
-- 姻缘树：每人一张姻缘牌（昵称取自玩家资料；自我介绍、选填 Instagram；照片暂未开放）
CREATE TABLE IF NOT EXISTS wish_cards (
  player_id uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  intro text NOT NULL,
  instagram text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wish_cards_updated ON wish_cards(updated_at DESC);
