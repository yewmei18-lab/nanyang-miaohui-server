-- MAMAK 点餐（06 第 5 节）：订单与扣币在同一事务；同一 requestId 重复点击返回同一张单
CREATE TABLE IF NOT EXISTS mamak_orders (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  item text NOT NULL,
  price integer NOT NULL,
  energy integer NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, request_id)
);
