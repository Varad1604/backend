import { Controller, Get } from '@nestjs/common';
import { Requires } from './access.decorators';

@Controller('admin')
export class AdminDashboardController {
  @Get('dashboard') @Requires('admin.users')
  dashboard() {
    return { data: { users: 0, overview: {} } };
  }
}
