FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git ripgrep tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /data/codex /data/workspace && chown -R node:node /data
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3100 DATA_DIR=/data AGENT_WORKSPACE=/data/workspace NEWBOT_CODEX_HOME=/data/codex CODEX_BIN=/app/node_modules/.bin/codex
ENV MALLOC_ARENA_MAX=2
ENV PATH="/app/node_modules/.bin:${PATH}"
USER node
EXPOSE 3100
VOLUME ["/data"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server/index.js"]
