import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { env } from '../../config/env';

/**
 * Prisma connection with honest-state boot behavior (invariant 9):
 * - production: a database outage at boot is fatal (fail fast, let the orchestrator retry);
 * - development/test: the API starts and /readyz reports database=down (503), never a lie.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch (error) {
      if (env.NODE_ENV === 'production') {
        throw error;
      }
      this.logger.error(`Database unavailable at boot: ${String(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
