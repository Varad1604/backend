import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../../config/env';

/**
 * Redis/Valkey client for sessions, rate limits, lockout counters and idempotency
 * short-circuits (build prompt section 7). Connection problems surface through
 * readiness checks, never as silent success.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;
  private readonly initialConnection: Promise<void>;

  constructor() {
    this.client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 1500,
      commandTimeout: 1500,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    // Swallow connection errors at the transport level; readiness handles reporting.
    this.client.on('error', (err) => this.logger.warn(`redis: ${String(err)}`));
    this.initialConnection = this.client.connect().then(() => undefined).catch((err) => { this.logger.warn(`redis connect deferred: ${String(err)}`); });
  }

  onModuleInit(): Promise<void> { return this.initialConnection; }

  /** Returns true only when a real PONG comes back within the timeout. */
  async ping(timeoutMs = 1500): Promise<boolean> {
    try {
      return await Promise.race([
        this.client.ping().then(() => true),
        new Promise<false>((resolve) => {
          const t = setTimeout(() => resolve(false), timeoutMs);
          t.unref?.();
        }),
      ]);
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
