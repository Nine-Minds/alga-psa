// Re-export tenant DB helpers from the shared package so this shim is safe to
// import from non-Next.js runtimes (e.g. the Temporal worker) that cannot
// resolve the server-only `@/lib/*` aliases. `getCurrentTenantId` intentionally
// lives only in the Next.js server module since it depends on headers/session.
export { createTenantKnex, runWithTenant, getTenantContext } from '@alga-psa/db/tenant';
