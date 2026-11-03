import { Body, Controller, Get, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { idempotencyKeySchema } from '../receiving/receiving.schemas';
import { Requires } from './access.decorators';
import { AuthService } from './auth.service';
import type { AuthRequest } from './identity.types';
import { briefRoleCodes } from './policy';

const roleSchema = z.enum(briefRoleCodes);
const username = z.string().regex(/^[a-z0-9][a-z0-9._-]{2,31}$/);
const createSchema = z.object({ username, displayName: z.string().trim().min(1).max(100), roles: z.array(roleSchema).min(1) }).strict();
const updateSchema = z.object({ displayName: z.string().trim().min(1).max(100).optional(), roles: z.array(roleSchema).min(1).optional(), active: z.boolean().optional() }).strict()
  .refine(value => Object.keys(value).length > 0, 'Enter at least one change.');

@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly auth: AuthService) {}
  @Get() @Requires('admin.users') list() { return this.auth.listUsers().then(data => ({ data })); }
  @Post() @Requires('admin.users')
  async create(@Body() body: unknown, @Req() request: AuthRequest & FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const key = idempotencyKeySchema.parse(request.headers['idempotency-key']);
    const input = createSchema.parse(body);
    const result = await this.auth.createUser(request.actor, key, input.username, input.displayName, input.roles);
    if (result.replayed) reply.header('Idempotent-Replay', 'true');
    return { data: result.body };
  }
  @Patch(':id') @Requires('admin.users')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthRequest & FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const key = idempotencyKeySchema.parse(request.headers['idempotency-key']);
    const result = await this.auth.updateUser(request.actor, z.uuid().parse(id), key, updateSchema.parse(body));
    if (result.replayed) reply.header('Idempotent-Replay', 'true');
    return { data: result.body };
  }
  @Post(':id/reset-password') @Requires('admin.users')
  async reset(@Param('id') id: string, @Req() request: AuthRequest & FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const key = idempotencyKeySchema.parse(request.headers['idempotency-key']);
    const result = await this.auth.resetPassword(request.actor, z.uuid().parse(id), key);
    if (result.replayed) reply.header('Idempotent-Replay', 'true');
    return { data: result.body };
  }
}
