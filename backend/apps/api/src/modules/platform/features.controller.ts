import { Controller, Get } from '@nestjs/common';
import { env } from '../../config/env';
import { Requires } from '../identity-access/access.decorators';
@Controller('platform')
export class FeaturesController {
  @Get('features') @Requires('platform.read')
  getFeatures() {
    // qcDecisions: D-03 decided 2026-11-03 — the QC operator records the final QC decision as a real step.
    return { data: { demoMode: env.DEMO_MODE === 'true', module2: false, qcDecisions: true,
      deductionCalculation: 'not_configured', productionRoster: 'not_configured' } };
  }
}
