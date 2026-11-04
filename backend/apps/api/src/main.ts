import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { configureHttp } from './http';
import { AppModule } from './app.module';
import { env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // B-31: trust the front proxy (Caddy/nginx) so req.ip is the client, not the proxy —
    // per-IP rate limits are meaningless otherwise.
    new FastifyAdapter({ trustProxy: true, logger: { redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'] }, genReqId: () => randomUUID(), connectionTimeout: 10_000, requestTimeout: 30_000, bodyLimit: 102_400 }),
  );

  await configureHttp(app);

  app.enableShutdownHooks(); // graceful drain (section 11)

  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  console.log(
    `[api] listening on :${env.PORT} under /api/v1 (NODE_ENV=${env.NODE_ENV}, DEMO_MODE=${env.DEMO_MODE})`,
  );
}

void bootstrap();
