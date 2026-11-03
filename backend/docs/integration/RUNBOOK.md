# Runbook

## Local open
```bash
cd backend
docker compose up -d --wait          # postgres 55432, redis 6379, minio 9000/9001, clamav 3310, api 3000
pnpm --filter api migrate:deploy
pnpm --filter api seed
pnpm --filter api test -- security   # REQUIRE_LIVE_DEPENDENCIES=true
```
DB: `postgresql://kpmpl:change-me@127.0.0.2:55432/kpmpl?schema=public`
S3: `http://localhost:9000` kpmpl-minio/change-me-too · ClamAV: localhost:3310

## Reset
`node dist/seed.js` (run twice), `docker compose down -v`

## Logs
`docker compose logs -f api postgres redis`

## Compose gotchas (this machine)
- postgres binds host 55432 (was 55432:5432 mismatched on WSL local postgres).
- api runs NODE_ENV=development (production boot refuses).
- .dockerignore must exist (host node_modules junctions broke the contracts build).
