# syntax=docker/dockerfile:1

# ---- сборка зависимостей (better-sqlite3 — нативный модуль) ----
FROM node:20-bookworm-slim AS deps
WORKDIR /app/server
# инструменты сборки нужны только на случай, если для платформы нет готового бинарника
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ---- рабочий образ ----
FROM node:20-bookworm-slim
ENV NODE_ENV=production \
    PORT=8000 \
    DATA_DIR=/data \
    PUBLIC_DIR=/app/public
WORKDIR /app
COPY --from=deps /app/server/node_modules server/node_modules
COPY server/package.json server/
COPY server/src server/src
COPY public public
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/src/index.js"]
