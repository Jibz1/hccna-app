FROM oven/bun:1.4.4
WORKDIR /usr/src/app

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

# Build context is the monorepo root: docker build -f apps/server/Dockerfile .
# Manifests first for better Docker layer caching
COPY package.json bun.lock bunfig.toml turbo.json ./
COPY apps/server/package.json ./apps/server/
# Mobile manifest is needed for --frozen-lockfile workspace resolution only;
# the install below is filtered to the server and shared packages.
COPY apps/mobile/package.json ./apps/mobile/
COPY packages/anti-slop/package.json ./packages/anti-slop/
COPY packages/castr/package.json ./packages/castr/
COPY packages/ccb/package.json ./packages/ccb/
COPY packages/strapi-v2/package.json ./packages/strapi-v2/
COPY packages/config/package.json ./packages/config/
COPY apps/server/scripts/check-dependency-policy.ts ./apps/server/scripts/

RUN cd apps/server && bun run scripts/check-dependency-policy.ts

COPY packages ./packages
COPY apps/server ./apps/server
# Bun validates root patches even when the install filters out the mobile app.
COPY patches ./patches
COPY scripts/sync-effect-repo.mjs ./scripts/
RUN SKIP_EFFECT_REPO_SYNC=1 bun install --frozen-lockfile --production --filter '@hccnj/server' --filter './packages/*'

# run the app
USER bun

ENV PORT=8080
ENV NODE_ENV=production

EXPOSE ${PORT}
WORKDIR /usr/src/app/apps/server
ENTRYPOINT ["bun", "./scripts/docker-entrypoint.ts"]
