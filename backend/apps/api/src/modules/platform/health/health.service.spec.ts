import { describe, expect, it, vi } from 'vitest';
import { HealthService } from './health.service';
import type { PrismaService } from '../../../infra/prisma/prisma.service';
import type { RedisService } from '../../../infra/redis/redis.service';

function makeService(opts: { db: 'ok' | 'fail' | 'hang'; redis: boolean }) {
  const prisma = {
    $queryRaw: vi.fn(async () => {
      if (opts.db === 'fail') throw new Error('connection refused');
      if (opts.db === 'hang') await new Promise(() => undefined); // never resolves
      return [1];
    }),
  } as unknown as PrismaService;
  const redis = { ping: vi.fn(async () => opts.redis) } as unknown as RedisService;
  return new HealthService(prisma, redis);
}

describe('HealthService readiness matrix (honest states, invariant 9)', () => {
  it('reports ready only when both dependencies are up', async () => {
    const result = await makeService({ db: 'ok', redis: true }).getReadiness();
    expect(result).toEqual({ ready: true, checks: { database: 'up', redis: 'up' } });
  });

  it('names the database as down when the query fails', async () => {
    const result = await makeService({ db: 'fail', redis: true }).getReadiness();
    expect(result).toEqual({ ready: false, checks: { database: 'down', redis: 'up' } });
  });

  it('treats a hung database query as down (timeout, not a hang)', async () => {
    const result = await makeService({ db: 'hang', redis: true }).getReadiness();
    expect(result.ready).toBe(false);
    expect(result.checks.database).toBe('down');
  });

  it('names redis as down without affecting the database verdict', async () => {
    const result = await makeService({ db: 'ok', redis: false }).getReadiness();
    expect(result).toEqual({ ready: false, checks: { database: 'up', redis: 'down' } });
  });
});
