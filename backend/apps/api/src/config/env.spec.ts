import { describe, expect, it } from 'vitest';
import { envSchema } from './env';

/** B-18: production must never boot with stock credentials. */
const productionBase = {
  NODE_ENV: 'production',
  JWT_PRIVATE_KEY_BASE64: 'a-base64-key',
  JWT_PUBLIC_KEY_BASE64: 'a-base64-key',
  DATABASE_URL: 'postgresql://kpmpl:real-secret@db:5432/kpmpl',
  S3_SECRET_KEY: 'a-real-s3-secret',
  APP_MODE: 'production',
  DEMO_MODE: 'false',
  COOKIE_SECURE: 'true',
};

describe('environment schema (B-18)', () => {
  it('accepts a fully configured production environment', () => {
    const parsed = envSchema.safeParse(productionBase);
    expect(parsed.success).toBe(true);
  });
  it('refuses the stock S3 secret key in production', () => {
    const parsed = envSchema.safeParse({ ...productionBase, S3_SECRET_KEY: 'change-me-too' });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.flatten().fieldErrors)).toContain('a real S3 secret key');
    }
  });
  it('refuses well-known weak application passwords in production', () => {
    const parsed = envSchema.safeParse({ ...productionBase, DEMO_PASSWORD: 'demopassword' });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.flatten().fieldErrors)).toContain('real application password');
    }
  });
  it('keeps the demo defaults working outside production', () => {
    const parsed = envSchema.safeParse({ NODE_ENV: 'development', APP_MODE: 'demo', DEMO_PASSWORD: 'demopassword', DEMO_MODE: 'true' });
    expect(parsed.success).toBe(true);
  });
});
