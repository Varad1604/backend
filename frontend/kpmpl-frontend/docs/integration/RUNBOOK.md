# Runbook (frontend)

## Local open
```bash
cd frontend/kpmpl-frontend
docker compose up -d --wait
pnpm --filter kpmpl-frontend migrate:deploy
pnpm --filter kpmpl-frontend seed
pnpm dev          # http://localhost:5173
```

## E2E
- `E2E_BASE_URL=http://localhost:5173 npx playwright test --project=setup --project=dev --project=prod-like --grep "CSP|security headers"`

## Reset
- `docker compose down -v` + `pnpm --filter kpmpl-frontend seed`
- Remove `test-results` and `playwright-report` between runs.
