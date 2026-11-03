# syntax=docker/dockerfile:1
# KPMPL API - multi-stage build (build prompt section 11: non-root, minimal runtime).
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo

# Copy workspace manifests first for layer caching, then the two packages the API needs.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY apps/api/package.json ./apps/api/package.json
# The store cache mount keeps fetched tarballs across builds: a retry after a
# transient registry failure (flaky DNS on dev machines) resumes instead of
# re-downloading the whole graph.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

COPY packages/contracts ./packages/contracts
COPY apps/api ./apps/api
RUN pnpm rebuild
# Contracts build first (contract-first): the API compile does not depend on it,
# but CI parity and future contract tests expect the same order.
RUN pnpm --filter @kpmpl/contracts build && pnpm --filter @kpmpl/api build

# Isolated production dependency tree for the API package.
RUN pnpm --filter=@kpmpl/api deploy --legacy --prod /out
RUN cp packages/contracts/openapi/openapi.yaml /out/openapi.yaml
# Generate inside the deployed dependency tree; Prisma artifacts are not portable.
RUN cd /out && node node_modules/prisma/build/index.js generate

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

COPY --from=build /out /app

# Run as the non-root 'node' user (image default user is root).
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/v1/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Apply pending migrations, then start (boring and reliable at this scale; prisma CLI
# ships in dependencies so the runtime image can run `migrate deploy`).
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node dist/main.js"]
