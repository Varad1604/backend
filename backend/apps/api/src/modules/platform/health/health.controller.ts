import { Public } from '../../identity-access/access.decorators';
import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { HealthService } from './health.service';

/**
 * Platform health endpoints (public, no auth) matching the frozen contract:
 *   GET /api/v1/healthz -> liveness
 *   GET /api/v1/readyz  -> readiness (database + redis), 503 names the failing component
 */
@Public()
@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('healthz')
  getLiveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('readyz')
  async getReadiness() {
    const { ready, checks } = await this.health.getReadiness();
    if (!ready) {
      // Honest states (invariant 9): report exactly what is down.
      throw new HttpException({ status: 'unavailable', checks }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { status: 'ok', checks };
  }
}
