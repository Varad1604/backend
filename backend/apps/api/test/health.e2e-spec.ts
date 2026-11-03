import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infra/prisma/prisma.service';

/** Minimal shape of a Fastify instance as used here (avoids importing fastify types directly). */
interface FastifyLike {
  ready: () => Promise<void>;
  inject: (opts: { method: string; url: string }) => Promise<{ statusCode: number; json: () => unknown }>;
}

describe('GET /api/v1 platform health (contract snapshot v0.1.0)', () => {
  let app: NestFastifyApplication;
  let instance: FastifyLike;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    await app.init();
    instance = app.getHttpAdapter().getInstance() as unknown as FastifyLike;
    await instance.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it.skipIf(process.env.REQUIRE_LIVE_DEPENDENCIES !== 'true')(
    'requires live dependencies and the migrated core schema in integration mode',
    async () => {
      const res = await instance.inject({ method: 'GET', url: '/api/v1/readyz' });
      // Storage is part of readiness (brief §9): private bucket bootstrap must succeed (CONTRACT_DIFF #132).
      expect(res.statusCode, JSON.stringify(res.json())).toBe(200);
      expect(res.json()).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up', storage: 'up' } });
      const prisma = app.get(PrismaService);
      // SELECT 1 alone cannot prove migrations created the application tables.
      await Promise.all([
        prisma.user.count(), prisma.role.count(), prisma.userRole.count(),
        prisma.session.count(), prisma.auditEvent.count(), prisma.idempotencyRecord.count(),
      ]);
    },
  );

  it('healthz returns 200 {status:"ok"} without any dependency', async () => {
    const res = await instance.inject({ method: 'GET', url: '/api/v1/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('readyz answers 200 or 503 and its verdict matches its component checks', async () => {
    const res = await instance.inject({ method: 'GET', url: '/api/v1/readyz' });
    expect([200, 503]).toContain(res.statusCode);
    const body = res.json() as { status: string; checks: { database: string; redis: string; storage?: string } };
    expect(['ok', 'unavailable']).toContain(body.status);
    expect(['up', 'down']).toContain(body.checks.database);
    expect(['up', 'down']).toContain(body.checks.redis);
    if ('storage' in body.checks) expect(['up', 'down']).toContain(body.checks.storage);
    const allUp = body.checks.database === 'up' && body.checks.redis === 'up' && body.checks.storage !== 'down';
    expect(body.status === 'ok').toBe(allUp); // never claim ok while something is down
    expect(res.statusCode).toBe(allUp ? 200 : 503);
  });
});
