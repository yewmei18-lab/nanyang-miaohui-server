-- 正式账号：username＋密码（scrypt 哈希）＋恢复码（哈希、用过即失效）。注册 = 把当前游客身份升级，进度原地保留，不复制。
ALTER TABLE players ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE players ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE players ADD COLUMN IF NOT EXISTS recovery_hash text;
ALTER TABLE players ADD COLUMN IF NOT EXISTS registered_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS players_username_unique ON players(username) WHERE username IS NOT NULL;

-- 登录后的会话（一个账号可以在多台设备登录；进庙会时同一账号只有一个窗口控制角色）
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS sessions_player ON sessions(player_id);

-- 登录 / 恢复码尝试记录（限制连续猜密码）
CREATE TABLE IF NOT EXISTS auth_attempts (
  id bigserial PRIMARY KEY,
  key text NOT NULL,
  ok boolean NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_attempts_key_at ON auth_attempts(key, at DESC);
