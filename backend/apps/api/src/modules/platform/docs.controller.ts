import { Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Requires } from '../identity-access/access.decorators';

function contract(): string {
  for (const file of [resolve(process.cwd(), 'packages/contracts/openapi/openapi.yaml'), resolve(process.cwd(), 'openapi.yaml')]) {
    try { return readFileSync(file, 'utf8'); } catch { /* try the packaged location */ }
  }
  throw new Error('The packaged OpenAPI contract is missing.');
}

@Controller('docs')
export class DocsController {
  @Get() @Requires('admin.users')
  get(@Res() reply: FastifyReply) {
    return reply.type('application/yaml; charset=utf-8').send(contract());
  }
}
