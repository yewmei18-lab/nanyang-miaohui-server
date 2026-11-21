#!/bin/bash
# 本地辅助：重启游戏服务（日志写到 .run/server.log）
cd "$(dirname "$0")"
mkdir -p .run
if [ -f .run/server.pid ]; then kill "$(cat .run/server.pid)" 2>/dev/null; sleep 1; fi
nohup npx tsx src/index.ts > .run/server.log 2>&1 &
echo $! > .run/server.pid
for i in $(seq 1 30); do curl -sf localhost:${PORT:-2567}/healthz >/dev/null && echo "server up" && exit 0; sleep 0.5; done
echo "server failed"; cat .run/server.log; exit 1
