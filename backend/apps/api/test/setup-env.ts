// Runs before any test module imports src/config/env (which exits on invalid config).
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';
process.env.DEMO_MODE ??= 'true';
process.env.PORT ??= '3000';
// The demo seed requires a fixed demo password (brief §9); tests use a synthetic one.
process.env.DEMO_PASSWORD ??= 'DEMO-test-password';
process.env.APP_MODE ??= 'demo';
