# ADR-011: Foundation dependency security corrections

Date: 1 November 2026. Engineering implementation record; human merge review pending.

The existing high-severity audit gate fails with 6 high and 2 critical findings.
Keep NestJS 11, Prisma 6 and Vite 6. Upgrade Vitest 3 to patched 4.1.12 (supports
Vite 6), Zod 3 to 4.6.7, and constrain Fastify to 5.12.5 and Prisma's deepmerge-ts
dependency to 8.0.2. These are explicit security-driven major changes for Vitest,
Zod and deepmerge-ts, not an undocumented stack replacement. Validate schema
generation/migrations, typechecking, API/web tests and deployment images.

Sources: GHSA-85c8-ppgw-ccpr, GHSA-mrhx-c7xc-m3w5, GHSA-ggr8-5vv4-36mx,
and the advisory details returned by pnpm audit. No audit exceptions are added.
The existing openapi-typescript/openapi-fetch generator remains in place for
the foundation review; review its documented deviation before P1 implementation.
