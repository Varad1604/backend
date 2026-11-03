import { Controller, Get } from '@nestjs/common';
import { backendPolicies } from '../../config/policies';
import { Requires } from '../identity-access/access.decorators';

@Controller('config/policies')
export class PoliciesController {
  @Get() @Requires('platform.read') get() { return { data: backendPolicies }; }
}
