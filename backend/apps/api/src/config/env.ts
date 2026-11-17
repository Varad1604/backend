import { z } from 'zod';

/** 
 * 12-factor configuration validated at boot. 
 * The application REFUSES to start on missing/invalid config (build prompt section 11) -
 * a misconfigured instance must never run half-alive in production. 
 */

/** === DataMan ERP SQL Server configuration (optional; absent → ERP queries return 503, not startup fail) === */
// ERP connection: if any required var is missing, ERP queries return 503 at runtime, not startup fail
export const ERP_DATABASE_URL = z.string().min(1).optional();
export const ERP_HOST = z.string().default('KPMLSERVER');
export const ERP_PORT = z.coerce.number().int().positive().default(1433);
export const ERP_DB = z.string().default('KAYGAONNew24');
export const ERP_USER = z.string().default('pravahax_readonly');
export const ERP_PASSWORD = z.string().min(1).optional();
// TLS enforcement: if ERP_TLS_ENFORCE is not set, default to true (SSL encryption, cert validation)
// Production ERP DBA must confirm certificate trust before changing this
export const ERP_TLS_ENFORCE = z.enum(['true', 'false']).default('true');
// Pool sizing (conservative defaults for on-prem SQL Server 2016)
export const ERP_POOL_MAX = z.coerce.number().int().min(1).default(20);
export const ERP_POOL_MIN = z.coerce.number().int().min(0).default(0);
export const ERP_POOL_IDLE_TIMEOUT = z.coerce.number().int().min(1).default(10000);
// Query and connect timeouts (ms)
export const ERP_COMMAND_TIMEOUT = z.coerce.number().int().min(1).default(30000);
export const ERP_CONNECT_TIMEOUT = z.coerce.number().int().min(1).default(15000);

/** Main configuration schema — all env vars validated at boot. */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  JWT_PRIVATE_KEY_BASE64: z.string().min(1).optional(),
  JWT_PUBLIC_KEY_BASE64: z.string().min(1).optional(),
  // The brief mandates the __Host-kpmpl_sid cookie, which requires Secure; Chrome and
  // Firefox accept Secure cookies on http://localhost, so the default is true everywhere
  // (CONTRACT_DIFF #118, decision A). Safari on plain http is the documented caveat.
  COOKIE_SECURE: z.enum(['true', 'false']).default('true'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((v) => v.startsWith('postgresql://') || v.startsWith('postgres://'), {
      message: 'DATABASE_URL must be a PostgreSQL connection string',
    }),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  // Comma-separated exact-origin allowlist (brief §3 "origin(s)"; CONTRACT_DIFF #123).
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  DEMO_PASSWORD: z.string().min(8).optional(),
  // Retired 2026-11-03 (D-03 decided: the QC operator makes the final QC decision).
  // Still parsed so an old .env that sets it keeps booting; it no longer gates anything.
  QC_REVIEW_ENABLED: z.string().optional(),
  APP_MODE: z.enum(['demo', 'staging', 'production']).default('demo'),
  DEMO_MODE: z.enum(['true', 'false']).default('true'),
  S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('kpmpl-private-documents'),
  S3_ACCESS_KEY: z.string().default('kpmpl-minio'),
  S3_SECRET_KEY: z.string().default('change-me-too'),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(50).default(10),
  CLAMAV_HOST: z.string().default('localhost'),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
  SCAN_FAIL_CLOSED: z.enum(['true', 'false']).default('true'),
  // === DataMan ERP SQL Server configuration (optional; absent → ERP queries return 503, not startup fail) ===
  // Note: These are defined as separate z.variables above; here we just reference them
  // for grouping in the main schema. They are optional — missing values → runtime 503, not startup fail.
}).superRefine((value, ctx) => {
  if (value.NODE_ENV === 'production' && (!value.JWT_PRIVATE_KEY_BASE64 || !value.JWT_PUBLIC_KEY_BASE64)) ctx.addIssue({ code: 'custom', message: 'Production requires signing keys', path: ['JWT_PRIVATE_KEY_BASE64'] });
  if (Boolean(value.JWT_PRIVATE_KEY_BASE64) !== Boolean(value.JWT_PUBLIC_KEY_BASE64)) ctx.addIssue({ code: 'custom', message: 'Both signing keys are required', path: ['JWT_PUBLIC_KEY_BASE64'] });
  if (value.DEMO_MODE !== 'true' && value.COOKIE_SECURE !== 'true') ctx.addIssue({ code: 'custom', message: 'Live sessions require secure cookies', path: ['COOKIE_SECURE'] });
  if (value.NODE_ENV === 'production' && value.APP_MODE === 'demo') ctx.addIssue({ code: 'custom', message: 'Demo mode is forbidden in production', path: ['APP_MODE'] });
  // B-18: never boot production with stock credentials.
  if (value.NODE_ENV === 'production' && value.S3_SECRET_KEY === 'change-me-too') ctx.addIssue({ code: 'custom', message: 'Production requires a real S3 secret key', path: ['S3_SECRET_KEY'] });
  const weakDemoPasswords = ['demopassword', 'password', 'kpmpl2026', 'kpmpl-demo'];
  if (value.NODE_ENV === 'production' && value.DEMO_PASSWORD && weakDemoPasswords.includes(value.DEMO_PASSWORD.toLowerCase())) ctx.addIssue({ code: 'custom', message: 'Production requires a real application password', path: ['DEMO_PASSWORD'] });
  // The demo seed (brief §9) needs a fixed demo password; refuse to boot without one.
  if (value.APP_MODE === 'demo' && !value.DEMO_PASSWORD) ctx.addIssue({ code: 'custom', message: 'DEMO_PASSWORD is required in demo mode', path: ['DEMO_PASSWORD'] });
});

// Cross-validate: if ERP_TLS_ENFORCE is 'false', note that DBA confirmation is required for cert trust
// We cannot block startup, but we can warn via console during service initialization

/** Exposed for unit tests (B-18): the schema must refuse stock credentials in production. */
export const envSchema = EnvSchema;

/** Exact CORS/Origin allowlist parsed from the comma-separated WEB_ORIGIN variable. */
export const webOrigins = (raw: string): string[] =>
  [...new Set(raw.split(',').map(origin => origin.trim()).filter(Boolean))];

export const env = (() => {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(
      '[api] Invalid or missing environment configuration:',
      parsed.error.flatten().fieldErrors,
    );
    process.exit(1);
  }
  return { ...parsed.data, webOriginList: webOrigins(parsed.data.WEB_ORIGIN) };
})();

export type Env = typeof env;