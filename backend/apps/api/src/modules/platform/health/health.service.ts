import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { RedisService } from '../../../infra/redis/redis.service';
import { Optional } from '@nestjs/common';
import { FileStorageService } from '../../documents/file-storage.service';

export type ComponentStatus = 'up' | 'down';
export interface ReadinessChecks {
  database: ComponentStatus;
  redis: ComponentStatus;
  storage?: ComponentStatus;
}
export interface Readiness {
  ready: boolean;
  checks: ReadinessChecks;
}

const CHECK_TIMEOUT_MS = 1500;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), ms);
      t.unref?.();
    }),
  ]);
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Optional() private readonly storage?: FileStorageService,
  ) {}

  async getReadiness(): Promise<Readiness> {
    const [database, redis, storage] = await Promise.all([this.checkDatabase(), this.checkRedis(), this.storage ? withTimeout(this.storage.readyCheck(), CHECK_TIMEOUT_MS).catch(() => false) : undefined]);
    const checks: ReadinessChecks = {
      database: database ? 'up' : 'down',
      redis: redis ? 'up' : 'down',
      ...(storage === undefined ? {} : { storage: storage ? 'up' : 'down' }),
    };
    return { ready: database && redis && storage !== false, checks };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, CHECK_TIMEOUT_MS);
      return true;
    } catch {
      return false;
    }
  }

  private checkRedis(): Promise<boolean> {
    return this.redis.ping(CHECK_TIMEOUT_MS);
  }
}
