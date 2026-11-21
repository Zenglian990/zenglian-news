# One image for every role: setup (migrations and seed), api, worker and web.
# Build arg NPM_REGISTRY switches the npm registry (e.g. https://registry.npmmirror.com in mainland China).
FROM node:24-trixie-slim AS base
WORKDIR /app
# Ensure the Node runtime matches package.json engines (>=24.11) and install pg_dump + CA certs.
RUN node -e "const [maj,min]=process.versions.node.split('.').map(Number); if(maj<24||(maj===24&&min<11)) { console.error('Unsupported Node:', process.versions.node); process.exit(1); }" \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client ca-certificates \
 && rm -rf /var/lib/apt/lists/*

FROM base AS build
ARG NPM_REGISTRY=
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/backend/package.json packages/backend/
COPY packages/contracts/package.json packages/contracts/
COPY industry/package.json industry/
COPY site/package.json site/
RUN npm ci --no-audit --no-fund ${NPM_REGISTRY:+--registry=$NPM_REGISTRY}
COPY . .
RUN npm run build -w @aihot/web && npm prune --omit=dev --no-audit --no-fund

FROM base
ENV NODE_ENV=production
ENV PORT=8080
ENV AIHOT_DATA_DIR=/data
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data /app/.data && chown -R node:node /data /app/.data
USER node
EXPOSE 8080
CMD ["node", "run-all.mjs"]
