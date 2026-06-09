// Route segment config must be statically defined here (Next.js cannot
// re-export `dynamic`/`runtime`); only the handler is re-exported from EE.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export { POST } from '@enterprise/app/api/billing/request-reactivation/route';
