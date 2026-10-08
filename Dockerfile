FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable \
  && apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN pnpm build \
  && find dist -name '*.map' -delete
RUN pnpm prune --prod

FROM node:22-slim
ARG VERSION=dev
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.source="https://github.com/phuc16/discord-mcp" \
  org.opencontainers.image.title="discord-mcp" \
  org.opencontainers.image.description="MCP server for managing Discord guilds with tiered safety, audit and automation rules" \
  org.opencontainers.image.version="${VERSION}" \
  org.opencontainers.image.revision="${GIT_SHA}"
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["node", "dist/cli/main.js"]
CMD ["--http", "--config", "/data/config.yaml"]
