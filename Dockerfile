# 游戏服务（Colyseus + HTTP 接口）。客户端单独部署到 Vercel。
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN npm ci --workspace @nanyang/server --include-workspace-root=false --ignore-scripts && npm cache clean --force
COPY packages/shared packages/shared
COPY apps/server apps/server
ENV NODE_ENV=production PORT=2567
EXPOSE 2567
WORKDIR /app/apps/server
CMD ["node", "--import", "tsx", "src/index.ts"]
