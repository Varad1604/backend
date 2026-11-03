# Local Open (frontend)

## Stack
- docker compose up -d --wait (postgres 5432/5432, redis 6379, minio 9000/9001, clamav 3310, api 3000)
- DB: `postgresql://kpmpl:change-me@127.0.0.2:55432/kpmpl?schema=public` (compose host mapping)
- S3: `http://localhost:9000` kpmpl-minio/change-me-too · ClamAV: localhost:3310

## Dev
- `pnpm dev` (vite, http://localhost:5173)
- Typecheck: `pnpm typecheck`; lint: `pnpm lint`; test: `pnpm test`

## E2E
- `E2E_BASE_URL=http://localhost:5173 npx playwright test --project=setup --project=dev --project=prod-like --grep "CSP|security headers"`
