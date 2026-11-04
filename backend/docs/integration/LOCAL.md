# Local Open (this machine)

## Stack
- docker compose up -d --wait
- postgres 16-alpine -> host 55432 (local WSL postgres on 5432 caused initial clashes; fixed to 5432:5432)
- redis 6379, minio 9000/9001, clamav 3310, api 3000

## Dev
- cd apps/api; pnpm --filter api dev (PORT=3000 default; DATABASE_URL, REDIS_URL, WEB_ORIGIN as above)
- Typecheck: pnpm --filter api typecheck; lint: pnpm --filter api lint

## Note
- Node 24.19.0, pnpm 10.15.0, Docker Desktop 29.7.2, WSL2 shell.
- DEMO_PASSWORD=demo-kpmpl-2026

## Alternate web port (5174)
- Use `docker compose -f docker-compose.yml -f docker-compose.port5174.yml up --build`
- Web exposed on host `http://localhost:5174` (container port 5173)
- `WEB_ORIGIN` includes `http://localhost:5174` (and `http://localhost:5173`)
- `COOKIE_SECURE=true` for HTTPS-like local cookie settings as configured
