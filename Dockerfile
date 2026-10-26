# syntax=docker/dockerfile:1
FROM oven/bun:1.4.4-alpine AS deps
WORKDIR /deps
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

# Development: the project is bind-mounted at /app (compose.dev.yaml); node_modules comes from a
# named volume seeded from this layer, so a dependency change means rebuilding the image.
FROM oven/bun:1.4.4-alpine AS dev
WORKDIR /app
COPY --from=deps /deps/node_modules /app/node_modules
ENV NODE_ENV=development
EXPOSE 3000
CMD ["bun", "--watch", "src/index.ts"]

FROM oven/bun:1.4.4-alpine AS prod-deps
WORKDIR /deps
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.4-alpine AS prod
LABEL org.opencontainers.image.title="Octowarden" \
      org.opencontainers.image.description="GitHub repository configuration from reusable templates: plan, apply, sync and audit settings, rulesets, labels, webhooks and files." \
      org.opencontainers.image.source="https://github.com/rojosinalma/octowarden" \
      org.opencontainers.image.url="https://github.com/rojosinalma/octowarden" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /deps/node_modules ./node_modules
COPY package.json bunfig.toml tsconfig.json octoforge.json ./
COPY bin ./bin
COPY src ./src
COPY public ./public
COPY templates ./templates
RUN mkdir -p /app/data && chown -R bun:bun /app/data
USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD ["bun", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "src/index.ts"]
